import { LiveSidechainDucker } from './ducking';
import { eqBandsForPreset } from './eq';
import type {
  AudioAssetId,
  AudioClip,
  AudioTrack,
  AudioTrackId,
  TimelineState,
} from './schema';
import { validateTimelineState } from './schema';
import { projectDuration } from './timeline';

type TrackGraph = {
  readonly input: GainNode;
  readonly panner: StereoPannerNode;
  readonly filters: readonly BiquadFilterNode[];
  readonly output: GainNode;
};

type ScheduledSource = {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly clipId: AudioClip['id'];
  readonly startTime: number;
  readonly clipLocalTime: number;
  readonly duration: number;
};

export interface MultitrackAudioEngineOptions {
  readonly context?: AudioContext;
}

export function timelineGraphTopologyChanged(
  previous: TimelineState,
  next: TimelineState,
): boolean {
  if (previous.tracks.length !== next.tracks.length) return true;
  return previous.tracks.some((track, trackIndex) => {
    const nextTrack = next.tracks[trackIndex];
    if (
      !nextTrack ||
      track.id !== nextTrack.id ||
      track.role !== nextTrack.role ||
      track.eqPreset !== nextTrack.eqPreset ||
      track.clips.length !== nextTrack.clips.length
    ) {
      return true;
    }
    return track.clips.some((clip, clipIndex) => {
      const nextClip = nextTrack.clips[clipIndex];
      return (
        !nextClip ||
        clip.id !== nextClip.id ||
        clip.assetId !== nextClip.assetId ||
        clip.startTime !== nextClip.startTime ||
        clip.trimStart !== nextClip.trimStart ||
        clip.duration !== nextClip.duration
      );
    });
  });
}

export class MultitrackAudioEngine {
  readonly #context: AudioContext;
  readonly #master: GainNode;
  readonly #meter: AnalyserNode;
  readonly #dialogueMonitor: GainNode;
  readonly #musicBus: GainNode;
  readonly #buffers = new Map<AudioAssetId, AudioBuffer>();
  readonly #graphs = new Map<AudioTrackId, TrackGraph>();
  readonly #sources = new Set<ScheduledSource>();
  #state: TimelineState;
  #ducker?: LiveSidechainDucker;
  #playing = false;
  #starting?: Promise<void>;
  #startToken = 0;
  #playhead = 0;
  #startedAt = 0;

  constructor(state: TimelineState, options: MultitrackAudioEngineOptions = {}) {
    validateTimelineState(state);
    this.#state = state;
    this.#playhead = state.playhead;
    this.#context = options.context ?? new AudioContext({ latencyHint: 'interactive' });
    this.#master = this.#context.createGain();
    this.#master.gain.value = state.masterGain;
    this.#meter = this.#context.createAnalyser();
    this.#meter.fftSize = 256;
    this.#dialogueMonitor = this.#context.createGain();
    this.#dialogueMonitor.gain.value = 1;
    this.#musicBus = this.#context.createGain();
    this.#musicBus.gain.value = 1;
    this.#musicBus.connect(this.#master);
    this.#master.connect(this.#meter);
    this.#meter.connect(this.#context.destination);
    this.#rebuildGraphs();
  }

  get context(): AudioContext {
    return this.#context;
  }

  get isPlaying(): boolean {
    return this.#playing;
  }

  get currentTime(): number {
    if (!this.#playing) return this.#playhead;
    return Math.min(projectDuration(this.#state), this.#playhead + this.#context.currentTime - this.#startedAt);
  }

  registerAssetBuffer(assetId: AudioAssetId, buffer: AudioBuffer): void {
    const asset = this.#state.assets[assetId];
    if (!asset) throw new Error('Cannot register a buffer for an unknown asset.');
    if (
      buffer.numberOfChannels !== asset.channels ||
      buffer.sampleRate !== asset.sampleRate ||
      Math.abs(buffer.duration - asset.duration) > 1 / asset.sampleRate
    ) {
      throw new Error('AudioBuffer does not match its immutable asset metadata.');
    }
    this.#buffers.set(assetId, buffer);
  }

  removeAssetBuffer(assetId: AudioAssetId): void {
    this.#buffers.delete(assetId);
  }

  setTimeline(state: TimelineState): void {
    validateTimelineState(state);
    const topologyChanged = timelineGraphTopologyChanged(this.#state, state);
    const wasPlaying = this.#playing;
    const position = this.currentTime;
    if (!topologyChanged) {
      this.#state = state;
      if (!wasPlaying) this.#playhead = Math.min(state.playhead, projectDuration(state));
      this.#applyMixerParameters();
      this.#refreshScheduledClipGains();
      return;
    }
    this.#stopSources();
    this.#state = state;
    this.#playhead = Math.min(wasPlaying ? position : state.playhead, projectDuration(state));
    this.#rebuildGraphs();
    if (wasPlaying) {
      this.#startedAt = this.#context.currentTime;
      this.#scheduleFrom(this.#playhead);
    }
  }

  async play(): Promise<void> {
    if (this.#playing) return;
    if (this.#starting) {
      await this.#starting;
      return;
    }
    const duration = projectDuration(this.#state);
    if (duration <= 0) throw new Error('Add a clip before starting preview.');
    if (this.#playhead >= duration) this.#playhead = 0;
    const token = this.#startToken + 1;
    this.#startToken = token;
    const starting = this.#context.resume();
    this.#starting = starting;
    try {
      await starting;
      if (token !== this.#startToken) return;
      this.#playing = true;
      this.#startedAt = this.#context.currentTime;
      this.#scheduleFrom(this.#playhead);
      this.#ducker?.start();
    } finally {
      if (this.#starting === starting) this.#starting = undefined;
    }
  }

  pause(): void {
    this.#startToken += 1;
    if (!this.#playing) return;
    this.#playhead = this.currentTime;
    this.#playing = false;
    this.#stopSources();
    this.#ducker?.stop();
    this.#configureDucker();
  }

  seek(time: number): void {
    if (!Number.isFinite(time)) throw new Error('Seek time must be finite.');
    const duration = projectDuration(this.#state);
    const nextTime = Math.max(0, Math.min(duration, time));
    const wasPlaying = this.#playing;
    this.#stopSources();
    this.#playhead = nextTime;
    if (wasPlaying) {
      this.#startedAt = this.#context.currentTime;
      this.#scheduleFrom(nextTime);
    }
  }

  async scrub(time: number, previewSeconds = 0.08): Promise<void> {
    if (!Number.isFinite(previewSeconds) || previewSeconds <= 0 || previewSeconds > 0.25) {
      throw new Error('Scrub preview must be between 0 and 0.25 seconds.');
    }
    const wasPlaying = this.#playing;
    if (wasPlaying) this.pause();
    this.seek(time);
    await this.#context.resume();
    this.#scheduleFrom(this.#playhead, previewSeconds);
  }

  setTrackVolume(trackId: AudioTrackId, gain: number): void {
    if (!Number.isFinite(gain) || gain < 0 || gain > 2) {
      throw new Error('Track volume must be between 0 and 2.');
    }
    this.#updateTrack(trackId, (track) => ({ ...track, volume: gain }));
  }

  setTrackMute(trackId: AudioTrackId, muted: boolean): void {
    this.#updateTrack(trackId, (track) => ({ ...track, muted }));
  }

  setTrackSolo(trackId: AudioTrackId, solo: boolean): void {
    this.#updateTrack(trackId, (track) => ({ ...track, solo }));
  }

  setTrackPan(trackId: AudioTrackId, pan: number): void {
    if (!Number.isFinite(pan) || pan < -1 || pan > 1) {
      throw new Error('Track pan must be between -1 and 1.');
    }
    this.#updateTrack(trackId, (track) => ({ ...track, pan }));
  }

  setMasterVolume(gain: number): void {
    if (!Number.isFinite(gain) || gain < 0 || gain > 2) {
      throw new Error('Master volume must be between 0 and 2.');
    }
    this.setTimeline({ ...this.#state, masterGain: gain });
  }

  getMasterPeak(): number {
    const samples = new Float32Array(this.#meter.fftSize);
    this.#meter.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }

  async dispose(): Promise<void> {
    this.#startToken += 1;
    this.#playing = false;
    this.#starting = undefined;
    this.#stopSources();
    this.#ducker?.stop();
    this.#ducker = undefined;
    for (const graph of this.#graphs.values()) this.#disconnectGraph(graph);
    this.#graphs.clear();
    this.#musicBus.disconnect();
    this.#dialogueMonitor.disconnect();
    this.#master.disconnect();
    this.#meter.disconnect();
    await this.#context.close();
  }

  #updateTrack(trackId: AudioTrackId, transform: (track: AudioTrack) => AudioTrack): void {
    if (!this.#state.tracks.some((track) => track.id === trackId)) {
      throw new Error('Track does not exist.');
    }
    this.setTimeline({
      ...this.#state,
      tracks: this.#state.tracks.map((track) =>
        track.id === trackId ? transform(track) : track,
      ),
    });
  }

  #rebuildGraphs(): void {
    this.#ducker?.stop();
    this.#ducker = undefined;
    for (const graph of this.#graphs.values()) this.#disconnectGraph(graph);
    this.#graphs.clear();
    const anySolo = this.#state.tracks.some((track) => track.solo);
    for (const track of this.#state.tracks) {
      const input = this.#context.createGain();
      input.gain.value = track.muted || (anySolo && !track.solo) ? 0 : track.volume;
      const panner = this.#context.createStereoPanner();
      panner.pan.value = track.pan;
      input.connect(panner);
      let previous: AudioNode = panner;
      const filters = eqBandsForPreset(track.eqPreset).map((band) => {
        const filter = this.#context.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.Q.value = band.q;
        filter.gain.value = band.gain;
        previous.connect(filter);
        previous = filter;
        return filter;
      });
      const output = this.#context.createGain();
      previous.connect(output);
      if (track.role === 'music') output.connect(this.#musicBus);
      else output.connect(this.#master);
      if (track.role === 'dialogue') output.connect(this.#dialogueMonitor);
      this.#graphs.set(track.id, { input, panner, filters, output });
    }
    this.#master.gain.value = this.#state.masterGain;
    this.#configureDucker();
  }

  #applyMixerParameters(): void {
    const time = this.#context.currentTime;
    const anySolo = this.#state.tracks.some((track) => track.solo);
    for (const track of this.#state.tracks) {
      const graph = this.#graphs.get(track.id);
      if (!graph) continue;
      graph.input.gain.setTargetAtTime(
        track.muted || (anySolo && !track.solo) ? 0 : track.volume,
        time,
        0.01,
      );
      graph.panner.pan.setTargetAtTime(track.pan, time, 0.01);
    }
    this.#master.gain.setTargetAtTime(this.#state.masterGain, time, 0.01);
    this.#ducker?.update(this.#state.autoDucking);
  }

  #configureDucker(): void {
    this.#ducker = new LiveSidechainDucker(
      this.#context,
      this.#dialogueMonitor,
      this.#musicBus,
      this.#state.autoDucking,
    );
    if (this.#playing) this.#ducker.start();
  }

  #disconnectGraph(graph: TrackGraph): void {
    graph.input.disconnect();
    graph.panner.disconnect();
    graph.filters.forEach((filter) => filter.disconnect());
    graph.output.disconnect();
  }

  #scheduleFrom(position: number, maximumDuration?: number): void {
    const scheduleTime = this.#context.currentTime + 0.01;
    for (const track of this.#state.tracks) {
      const graph = this.#graphs.get(track.id);
      if (!graph) continue;
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= position) continue;
        const timelineDelay = Math.max(0, clip.startTime - position);
        const clipLocalTime = Math.max(0, position - clip.startTime);
        const sourceDuration = Math.min(
          clip.duration - clipLocalTime,
          maximumDuration ?? Number.POSITIVE_INFINITY,
        );
        if (sourceDuration <= 0) continue;
        const buffer = this.#buffers.get(clip.assetId);
        if (!buffer) continue;
        const source = this.#context.createBufferSource();
        source.buffer = buffer;
        const clipGain = this.#context.createGain();
        this.#scheduleClipGain(
          clipGain.gain,
          clip,
          clipLocalTime,
          scheduleTime + timelineDelay,
          sourceDuration,
        );
        source.connect(clipGain);
        clipGain.connect(graph.input);
        const scheduled = {
          source,
          gain: clipGain,
          clipId: clip.id,
          startTime: scheduleTime + timelineDelay,
          clipLocalTime,
          duration: sourceDuration,
        };
        this.#sources.add(scheduled);
        source.onended = () => {
          this.#sources.delete(scheduled);
          source.disconnect();
          clipGain.disconnect();
        };
        source.start(
          scheduleTime + timelineDelay,
          clip.trimStart + clipLocalTime,
          sourceDuration,
        );
      }
    }
  }

  #scheduleClipGain(
    parameter: AudioParam,
    clip: AudioClip,
    clipLocalTime: number,
    startTime: number,
    duration: number,
  ): void {
    parameter.cancelScheduledValues(startTime);
    if (clip.gain === 0) {
      parameter.setValueAtTime(0, startTime);
      return;
    }
    const endLocalTime = clipLocalTime + duration;
    const fadeGain = (time: number): number => {
      const inGain =
        clip.fadeIn > 0 && time < clip.fadeIn
          ? Math.max(0.001, 10 ** ((-60 * (1 - time / clip.fadeIn)) / 20))
          : 1;
      const remaining = clip.duration - time;
      const outGain =
        clip.fadeOut > 0 && remaining < clip.fadeOut
          ? Math.max(0.001, 10 ** ((-60 * (1 - remaining / clip.fadeOut)) / 20))
          : 1;
      return clip.gain * Math.min(inGain, outGain);
    };
    parameter.setValueAtTime(fadeGain(clipLocalTime), startTime);
    if (clip.fadeIn > clipLocalTime && clip.fadeIn <= endLocalTime) {
      parameter.exponentialRampToValueAtTime(
        Math.max(0.001, clip.gain),
        startTime + clip.fadeIn - clipLocalTime,
      );
    }
    const fadeOutStart = clip.duration - clip.fadeOut;
    if (clip.fadeOut > 0 && fadeOutStart < endLocalTime) {
      const rampStart = Math.max(clipLocalTime, fadeOutStart);
      parameter.setValueAtTime(fadeGain(rampStart), startTime + rampStart - clipLocalTime);
      parameter.exponentialRampToValueAtTime(
        Math.max(0.001, fadeGain(endLocalTime)),
        startTime + duration,
      );
    }
  }

  #refreshScheduledClipGains(): void {
    if (this.#sources.size === 0) return;
    const clips = new Map(
      this.#state.tracks.flatMap((track) =>
        track.clips.map((clip) => [clip.id, clip] as const),
      ),
    );
    const now = this.#context.currentTime;
    for (const scheduled of this.#sources) {
      const clip = clips.get(scheduled.clipId);
      if (!clip) continue;
      const elapsed = Math.max(0, now - scheduled.startTime);
      const remaining = scheduled.duration - elapsed;
      if (remaining <= 0) continue;
      this.#scheduleClipGain(
        scheduled.gain.gain,
        clip,
        scheduled.clipLocalTime + elapsed,
        Math.max(now, scheduled.startTime),
        remaining,
      );
    }
  }

  #stopSources(): void {
    for (const scheduled of this.#sources) {
      scheduled.source.onended = null;
      try {
        scheduled.source.stop();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error;
      }
      scheduled.source.disconnect();
      scheduled.gain.disconnect();
    }
    this.#sources.clear();
  }
}
