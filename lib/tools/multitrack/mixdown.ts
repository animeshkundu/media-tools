import { MAX_PCM_ENCODE_BYTES, MAX_PCM_CHANNELS } from '../../core/worker';
import { buildDuckingEnvelope } from './ducking';
import { eqBandsForPreset, OfflineBiquad } from './eq';
import type {
  AudioAssetId,
  AudioClip,
  AudioTrackId,
  AudioTrack,
  FadeCurve,
  TimelineState,
} from './schema';
import {
  MAX_MULTITRACK_CLIPS,
  MAX_MULTITRACK_DURATION_SECONDS,
  validateTimelineState,
} from './schema';
import { projectDuration } from './timeline';

export interface MultitrackPcmAsset {
  readonly sampleRate: number;
  readonly channelData: readonly Float32Array[];
}

export interface MultitrackMixInput {
  readonly state: TimelineState;
  readonly pcmByAssetId: Readonly<Record<AudioAssetId, MultitrackPcmAsset>>;
}

export interface MultitrackMixResult {
  readonly sampleRate: number;
  readonly channelData: readonly [Float32Array, Float32Array];
}

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const WAV_BYTES_PER_STEREO_FRAME = 4;
const MIX_WORKING_BYTES_PER_OUTPUT_FRAME =
  2 * FLOAT_BYTES + FLOAT_BYTES + FLOAT_BYTES + WAV_BYTES_PER_STEREO_FRAME;

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error('Multitrack memory projection overflowed.');
  return result;
}

function checkedMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new Error('Multitrack memory projection overflowed.');
  return result;
}

export function retainedPcmBytes(
  pcmByAssetId: Readonly<Record<AudioAssetId, MultitrackPcmAsset>>,
): number {
  let bytes = 0;
  for (const pcm of Object.values(pcmByAssetId)) {
    if (pcm.channelData.length < 1 || pcm.channelData.length > MAX_PCM_CHANNELS) {
      throw new Error('Multitrack assets must contain mono or stereo PCM.');
    }
    const frames = pcm.channelData[0]?.length ?? 0;
    if (frames < 1 || pcm.channelData.some((channel) => channel.length !== frames)) {
      throw new Error('Multitrack PCM channels must be non-empty and aligned.');
    }
    for (const channel of pcm.channelData) bytes = checkedAdd(bytes, channel.byteLength);
  }
  return bytes;
}

export function assertDecodeFitsProject(
  pcmByAssetId: Readonly<Record<AudioAssetId, MultitrackPcmAsset>>,
  duration: number,
  sampleRate: number,
): void {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 192_000
  ) {
    throw new Error('Decoded-audio preflight metadata is invalid.');
  }
  const frames = Math.ceil(duration * sampleRate);
  const projectedBytes = frames * MAX_PCM_CHANNELS * FLOAT_BYTES;
  if (!Number.isSafeInteger(projectedBytes)) {
    throw new Error('Decoded-audio preflight size overflowed.');
  }
  if (checkedAdd(retainedPcmBytes(pcmByAssetId), projectedBytes) > MAX_PCM_ENCODE_BYTES) {
    throw new Error(
      'This file would exceed the 256 MB aggregate PCM limit before decoding. Remove an asset first.',
    );
  }
}

export function projectedMixWorkingBytes(input: MultitrackMixInput): number {
  validateTimelineState(input.state);
  const sampleRate = outputSampleRate(input);
  const frames = Math.ceil(projectDuration(input.state) * sampleRate);
  if (!Number.isSafeInteger(frames) || frames < 1) throw new Error('The project has no audio to export.');
  const retained = retainedPcmBytes(input.pcmByAssetId);
  const previewBuffersAndSnapshots = retained * 2;
  const outputPcm = frames * 2 * FLOAT_BYTES;
  const dialogueControl = frames * FLOAT_BYTES;
  const duckingEnvelope = frames * FLOAT_BYTES;
  const encodedWav = 44 + frames * WAV_BYTES_PER_STEREO_FRAME;
  if (![outputPcm, dialogueControl, duckingEnvelope, encodedWav].every(Number.isSafeInteger)) {
    throw new Error('Multitrack memory projection overflowed.');
  }
  return checkedAdd(
    checkedAdd(retained, previewBuffersAndSnapshots),
    checkedAdd(outputPcm, checkedAdd(dialogueControl, checkedAdd(duckingEnvelope, encodedWav))),
  );
}

export function validateMixInput(input: MultitrackMixInput): void {
  validateTimelineState(input.state);
  retainedPcmBytes(input.pcmByAssetId);
  const referenced = new Set(
    input.state.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)),
  );
  for (const assetId of referenced) {
    const pcm = input.pcmByAssetId[assetId];
    if (!pcm) throw new Error('A referenced asset is not decoded.');
    const metadata = input.state.assets[assetId]!;
    if (pcm.sampleRate !== metadata.sampleRate || pcm.channelData.length !== metadata.channels) {
      throw new Error('Decoded PCM does not match its immutable asset metadata.');
    }
  }
  if (projectedMixWorkingBytes(input) > MAX_PCM_ENCODE_BYTES) {
    throw new Error(
      'This project exceeds the 256 MB in-flight processing limit. Shorten clips or remove assets.',
    );
  }
}

function recordingStartTime(state: TimelineState, trackId: AudioTrackId): number {
  const track = state.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error('The voice-over destination track is missing.');
  const trackEnd = track.clips.reduce(
    (end, clip) => Math.max(end, clip.startTime + clip.duration),
    0,
  );
  return Math.max(state.playhead, trackEnd);
}

export function projectedVoiceOverWorkingBytes(
  input: MultitrackMixInput,
  trackId: AudioTrackId,
  sampleRate: number,
  recordingFrames: number,
): number {
  validateTimelineState(input.state);
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 192_000 ||
    !Number.isSafeInteger(recordingFrames) ||
    recordingFrames < 1
  ) {
    throw new Error('Voice-over memory projection metadata is invalid.');
  }
  const retained = retainedPcmBytes(input.pcmByAssetId);
  let outputRate = sampleRate;
  for (const track of input.state.tracks) {
    for (const clip of track.clips) {
      const pcm = input.pcmByAssetId[clip.assetId];
      if (!pcm) throw new Error('A referenced asset is not decoded.');
      outputRate = Math.max(outputRate, pcm.sampleRate);
    }
  }
  const recordingBytes = checkedMultiply(recordingFrames, FLOAT_BYTES);
  const recordedDuration = recordingFrames / sampleRate;
  const nextDuration = Math.max(
    projectDuration(input.state),
    recordingStartTime(input.state, trackId) + recordedDuration,
  );
  if (nextDuration > MAX_MULTITRACK_DURATION_SECONDS) {
    return Number.POSITIVE_INFINITY;
  }
  const outputFrames = Math.ceil(nextDuration * outputRate);
  if (!Number.isSafeInteger(outputFrames)) {
    throw new Error('Voice-over output projection overflowed.');
  }
  const retainedAfterRecording = checkedAdd(retained, recordingBytes);
  const exportWorkingSet = checkedAdd(
    checkedMultiply(retainedAfterRecording, 3),
    checkedAdd(
      44,
      checkedMultiply(outputFrames, MIX_WORKING_BYTES_PER_OUTPUT_FRAME),
    ),
  );
  const stopWorkingSet = checkedAdd(retained, checkedMultiply(recordingBytes, 2));
  return Math.max(exportWorkingSet, stopWorkingSet);
}

export function maxVoiceOverFrames(
  input: MultitrackMixInput,
  trackId: AudioTrackId,
  sampleRate: number,
  maximumSeconds: number,
): number {
  validateTimelineState(input.state);
  if (!Number.isFinite(maximumSeconds) || maximumSeconds <= 0) {
    throw new Error('The voice-over duration limit is invalid.');
  }
  const clipCount = input.state.tracks.reduce(
    (count, track) => count + track.clips.length,
    0,
  );
  if (clipCount >= MAX_MULTITRACK_CLIPS) {
    throw new Error(`A project supports at most ${MAX_MULTITRACK_CLIPS} clips.`);
  }
  const startTime = recordingStartTime(input.state, trackId);
  const durationFrames = Math.floor(
    Math.min(maximumSeconds, MAX_MULTITRACK_DURATION_SECONDS - startTime) * sampleRate,
  );
  if (!Number.isSafeInteger(durationFrames) || durationFrames < 1) {
    throw new Error('There is no project duration available for a voice-over.');
  }

  let lower = 0;
  let upper = durationFrames;
  while (lower < upper) {
    const candidate = Math.ceil((lower + upper) / 2);
    if (
      projectedVoiceOverWorkingBytes(input, trackId, sampleRate, candidate) <=
      MAX_PCM_ENCODE_BYTES
    ) {
      lower = candidate;
    } else {
      upper = candidate - 1;
    }
  }
  if (lower < 1) {
    throw new Error('There is not enough project memory available for a voice-over.');
  }
  return lower;
}

function outputSampleRate(input: MultitrackMixInput): number {
  let sampleRate = 0;
  for (const track of input.state.tracks) {
    for (const clip of track.clips) {
      sampleRate = Math.max(sampleRate, input.pcmByAssetId[clip.assetId]?.sampleRate ?? 0);
    }
  }
  if (sampleRate < 8_000 || sampleRate > 192_000) throw new Error('The project sample rate is unsupported.');
  return sampleRate;
}

function fadeValue(position: number, duration: number, curve: FadeCurve): number {
  if (position <= 0) return 0;
  if (position >= duration) return 1;
  const normalized = position / duration;
  return curve === 'linear' ? normalized : 10 ** ((-60 * (1 - normalized)) / 20);
}

export function clipEnvelopeGain(clip: AudioClip, localTime: number): number {
  const fadeIn = clip.fadeIn > 0 ? fadeValue(localTime, clip.fadeIn, clip.fadeCurve) : 1;
  const remaining = clip.duration - localTime;
  const fadeOut = clip.fadeOut > 0 ? fadeValue(remaining, clip.fadeOut, clip.fadeCurve) : 1;
  return Math.min(fadeIn, fadeOut);
}

function sampleAt(channel: Float32Array, position: number): number {
  const leftIndex = Math.max(0, Math.min(channel.length - 1, Math.floor(position)));
  const rightIndex = Math.min(channel.length - 1, leftIndex + 1);
  const fraction = position - leftIndex;
  return (channel[leftIndex] ?? 0) * (1 - fraction) + (channel[rightIndex] ?? 0) * fraction;
}

function panSamples(left: number, right: number, channels: number, pan: number): [number, number] {
  if (channels === 1) {
    const angle = ((pan + 1) * Math.PI) / 4;
    return [left * Math.cos(angle), left * Math.sin(angle)];
  }
  if (pan <= 0) {
    const angle = ((pan + 1) * Math.PI) / 2;
    return [left + right * Math.cos(angle), right * Math.sin(angle)];
  }
  const angle = (pan * Math.PI) / 2;
  return [left * Math.cos(angle), right + left * Math.sin(angle)];
}

function activeTrack(track: AudioTrack, anySolo: boolean): boolean {
  return !track.muted && (!anySolo || track.solo);
}

type PreparedClip = {
  readonly clip: AudioClip;
  readonly startFrame: number;
  readonly endFrame: number;
};

function createTrackSampler(
  track: AudioTrack,
  sampleRate: number,
  pcmByAssetId: Readonly<Record<AudioAssetId, MultitrackPcmAsset>>,
): (frame: number) => [number, number] {
  const prepared: PreparedClip[] = track.clips
    .map((clip) => ({
      clip,
      startFrame: Math.max(0, Math.floor(clip.startTime * sampleRate)),
      endFrame: Math.ceil((clip.startTime + clip.duration) * sampleRate),
    }))
    .sort((left, right) => left.startFrame - right.startFrame);
  const active: PreparedClip[] = [];
  let nextClip = 0;

  return (frame) => {
    while (prepared[nextClip] && prepared[nextClip]!.startFrame <= frame) {
      active.push(prepared[nextClip]!);
      nextClip += 1;
    }
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index]!.endFrame <= frame) active.splice(index, 1);
    }
    const time = frame / sampleRate;
    let left = 0;
    let right = 0;
    for (const { clip } of active) {
      const localTime = time - clip.startTime;
      if (localTime < 0 || localTime >= clip.duration) continue;
      const pcm = pcmByAssetId[clip.assetId]!;
      const sourcePosition =
        (clip.trimStart + localTime * clip.playbackRate) * pcm.sampleRate;
      const sourceLeft = sampleAt(pcm.channelData[0]!, sourcePosition);
      const sourceRight =
        pcm.channelData.length === 1
          ? sourceLeft
          : sampleAt(pcm.channelData[1]!, sourcePosition);
      const [pannedLeft, pannedRight] = panSamples(
        sourceLeft,
        sourceRight,
        pcm.channelData.length,
        track.pan,
      );
      const gain = clip.gain * track.volume * clipEnvelopeGain(clip, localTime);
      left += pannedLeft * gain;
      right += pannedRight * gain;
    }
    return [left, right];
  };
}

export function mixTimeline(
  input: MultitrackMixInput,
  onProgress: (value: number) => void = () => undefined,
): MultitrackMixResult {
  validateMixInput(input);
  const sampleRate = outputSampleRate(input);
  const frames = Math.ceil(projectDuration(input.state) * sampleRate);
  const dialogue = new Float32Array(frames);
  const anySolo = input.state.tracks.some((track) => track.solo);
  const dialogueTracks = input.state.tracks.filter(
    (track) => track.role === 'dialogue' && activeTrack(track, anySolo),
  );
  const dialogueSamplers = dialogueTracks.map((track) =>
    createTrackSampler(track, sampleRate, input.pcmByAssetId),
  );

  for (let frame = 0; frame < frames; frame += 1) {
    let control = 0;
    for (const sample of dialogueSamplers) {
      const [left, right] = sample(frame);
      control = Math.max(control, Math.abs(left), Math.abs(right));
    }
    dialogue[frame] = control;
    if ((frame & 0x3fff) === 0) onProgress((frame / frames) * 0.2);
  }
  const ducking = buildDuckingEnvelope(dialogue, sampleRate, input.state.autoDucking);
  const outputLeft = new Float32Array(frames);
  const outputRight = new Float32Array(frames);

  for (const [trackIndex, track] of input.state.tracks.entries()) {
    if (!activeTrack(track, anySolo)) continue;
    const leftFilters = eqBandsForPreset(track.eqPreset).map(
      (band) => new OfflineBiquad(band, sampleRate),
    );
    const rightFilters = eqBandsForPreset(track.eqPreset).map(
      (band) => new OfflineBiquad(band, sampleRate),
    );
    const sample = createTrackSampler(track, sampleRate, input.pcmByAssetId);
    for (let frame = 0; frame < frames; frame += 1) {
      let [left, right] = sample(frame);
      for (const filter of leftFilters) left = filter.process(left);
      for (const filter of rightFilters) right = filter.process(right);
      const duckGain = track.role === 'music' ? ducking[frame] ?? 1 : 1;
      outputLeft[frame] = (outputLeft[frame] ?? 0) + left * duckGain;
      outputRight[frame] = (outputRight[frame] ?? 0) + right * duckGain;
    }
    onProgress(0.2 + ((trackIndex + 1) / input.state.tracks.length) * 0.75);
  }
  const masterGain = input.state.masterGain;
  for (let frame = 0; frame < frames; frame += 1) {
    outputLeft[frame] = (outputLeft[frame] ?? 0) * masterGain;
    outputRight[frame] = (outputRight[frame] ?? 0) * masterGain;
  }
  onProgress(1);
  return { sampleRate, channelData: [outputLeft, outputRight] };
}
