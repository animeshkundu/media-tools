import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../../components/Button';
import { Progress } from '../../../components/Progress';
import { downloadBlob } from '../../core/download';
import { formatBytes, formatDuration } from '../../core/format';
import {
  MAX_PCM_ENCODE_BYTES,
  startAnalyze,
  startDecodeFile,
  type AudioJob,
} from '../../core/worker';
import { CanvasTimeline } from './CanvasTimeline';
import { MultitrackAudioEngine } from './engine';
import {
  assertDecodeFitsProject,
  projectedMixWorkingBytes,
  retainedPcmBytes,
  validateMixInput,
  type MultitrackPcmAsset,
} from './mixdown';
import { OPFSAssetManager, OPFSOperationCancelledError } from './opfs';
import {
  buildPeakPyramid,
  buildPeakPyramidFromOverview,
  type PeakPyramid,
} from './peaks';
import {
  createEmptyTimeline,
  createTrack,
  type AudioAsset,
  type AudioAssetId,
  type AudioClip,
  type AudioTrack,
  type AudioTrackId,
  type EqPreset,
  type TimelineState,
  type TrackRole,
} from './schema';
import { startMultitrackMixdown } from './startMixdown';
import { projectDuration } from './timeline';

type PcmAssetMap = Record<AudioAssetId, MultitrackPcmAsset>;
type PeakMap = Record<AudioAssetId, PeakPyramid>;
type GeneratorKind = 'tone' | 'silence' | 'click';

const ACCEPTED_AUDIO = 'audio/wav,audio/mpeg,.wav,.mp3';
const GENERATED_SAMPLE_RATE = 48_000;

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function outputFileName(name: string): string {
  const safe = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'multitrack-mix'}.wav`;
}

function trackEnd(track: AudioTrack): number {
  return track.clips.reduce(
    (end, clip) => Math.max(end, clip.startTime + clip.duration),
    0,
  );
}

function createClip(asset: AudioAsset, track: AudioTrack, playhead: number): AudioClip {
  return {
    id: createId('clip'),
    assetId: asset.id,
    startTime: Math.max(playhead, trackEnd(track)),
    trimStart: 0,
    duration: asset.duration,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: 'logarithmic',
  };
}

function addAssetToTimeline(
  state: TimelineState,
  asset: AudioAsset,
  targetTrackId: AudioTrackId,
): TimelineState {
  const target = state.tracks.find((track) => track.id === targetTrackId) ?? state.tracks[0]!;
  const clip = createClip(asset, target, state.playhead);
  return {
    ...state,
    assets: { ...state.assets, [asset.id]: asset },
    tracks: state.tracks.map((track) =>
      track.id === target.id ? { ...track, clips: [...track.clips, clip] } : track,
    ),
    selection: { trackId: target.id, clipId: clip.id },
  };
}

function generatedPcm(kind: GeneratorKind): Float32Array {
  const duration = kind === 'click' ? 0.25 : 1;
  const channel = new Float32Array(Math.round(GENERATED_SAMPLE_RATE * duration));
  if (kind === 'silence') return channel;
  for (let index = 0; index < channel.length; index += 1) {
    const time = index / GENERATED_SAMPLE_RATE;
    if (kind === 'tone') {
      channel[index] = Math.sin(2 * Math.PI * 440 * time) * 0.28;
    } else {
      const envelope = Math.exp(-time * 45);
      channel[index] =
        (Math.sin(2 * Math.PI * 1_200 * time) + Math.sin(2 * Math.PI * 1_800 * time)) *
        envelope *
        0.22;
    }
  }
  return channel;
}

export function MultitrackTool() {
  const [timeline, setTimeline] = useState(() => createEmptyTimeline('My audio project'));
  const [pcmByAssetId, setPcmByAssetId] = useState<PcmAssetMap>({});
  const [peaksByAssetId, setPeaksByAssetId] = useState<PeakMap>({});
  const [targetTrackId, setTargetTrackId] = useState<AudioTrackId>('track-dialogue');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [meterPeak, setMeterPeak] = useState(0);
  const [status, setStatus] = useState(
    'Import a WAV or MP3, or add a generated sound to begin.',
  );
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<AudioJob<unknown> | undefined>(undefined);
  const engineRef = useRef<MultitrackAudioEngine | undefined>(undefined);
  const opfsRef = useRef<OPFSAssetManager | undefined>(undefined);
  const transportPendingRef = useRef(false);
  const animationRef = useRef<number | undefined>(undefined);
  const timelineRef = useRef(timeline);
  const pcmRef = useRef(pcmByAssetId);
  const peaksRef = useRef(peaksByAssetId);

  const duration = projectDuration(timeline);
  const selectedTrack = timeline.tracks.find(
    (track) => track.id === timeline.selection.trackId,
  );
  const selectedClip = selectedTrack?.clips.find(
    (clip) => clip.id === timeline.selection.clipId,
  );
  const retainedBytes = useMemo(
    () => retainedPcmBytes(pcmByAssetId),
    [pcmByAssetId],
  );

  useEffect(() => {
    let mounted = true;
    const manager = OPFSAssetManager.isSupported() ? new OPFSAssetManager() : undefined;
    if (manager) {
      opfsRef.current = manager;
      const cleanup = manager.cleanupStaleSessions();
      void cleanup.catch((caught: unknown) => {
        if (!mounted) return;
        setStatus(
          `Bounded memory is ready, but stale OPFS cache cleanup failed: ${
            caught instanceof Error ? caught.message : 'unknown storage error'
          }`,
        );
      });
    }
    return () => {
      mounted = false;
      if (animationRef.current !== undefined) cancelAnimationFrame(animationRef.current);
      jobRef.current?.cancel();
      if (manager) {
        opfsRef.current = undefined;
        const cleanup = manager.clearSession();
        void cleanup.then(
          () => manager.dispose(),
          () => manager.dispose(),
        );
      }
      if (engineRef.current) void engineRef.current.dispose();
    };
  }, []);

  function commitTimeline(next: TimelineState): void {
    setTimeline(next);
    timelineRef.current = next;
    engineRef.current?.setTimeline(next);
  }

  function updateTimelineView(next: TimelineState): void {
    setTimeline(next);
    timelineRef.current = next;
  }

  async function resetPreviewEngine(): Promise<void> {
    if (animationRef.current !== undefined) cancelAnimationFrame(animationRef.current);
    animationRef.current = undefined;
    setPlaying(false);
    setMeterPeak(0);
    if (engineRef.current) await engineRef.current.dispose();
    engineRef.current = undefined;
  }

  function createPreviewEngine(): MultitrackAudioEngine {
    const engine = new MultitrackAudioEngine(timelineRef.current);
    for (const [assetId, pcm] of Object.entries(pcmRef.current)) {
      const buffer = engine.context.createBuffer(
        pcm.channelData.length,
        pcm.channelData[0]!.length,
        pcm.sampleRate,
      );
      pcm.channelData.forEach((channel, channelIndex) =>
        buffer.getChannelData(channelIndex).set(channel),
      );
      engine.registerAssetBuffer(assetId, buffer);
    }
    engineRef.current = engine;
    return engine;
  }

  function startTransportAnimation(engine: MultitrackAudioEngine): void {
    const update = () => {
      const current = engine.currentTime;
      setTimeline((state) => {
        const next = { ...state, playhead: current };
        timelineRef.current = next;
        return next;
      });
      setMeterPeak(engine.getMasterPeak());
      if (engine.isPlaying && current < projectDuration(timelineRef.current)) {
        animationRef.current = requestAnimationFrame(update);
      } else {
        engine.pause();
        setPlaying(false);
        setMeterPeak(0);
        animationRef.current = undefined;
      }
    };
    animationRef.current = requestAnimationFrame(update);
  }

  async function togglePlayback(): Promise<void> {
    if (transportPendingRef.current) return;
    transportPendingRef.current = true;
    setError(undefined);
    try {
      const engine = engineRef.current ?? createPreviewEngine();
      if (playing) {
        engine.pause();
        if (animationRef.current !== undefined) cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
        setTimeline((state) => {
          const next = { ...state, playhead: engine.currentTime };
          timelineRef.current = next;
          return next;
        });
        setPlaying(false);
        setMeterPeak(0);
      } else {
        await engine.play();
        setPlaying(true);
        startTransportAnimation(engine);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Preview could not start.');
    } finally {
      transportPendingRef.current = false;
    }
  }

  async function cacheFile(assetId: AudioAssetId, file: File): Promise<AudioAsset['source']> {
    const manager = opfsRef.current;
    if (!manager) return { kind: 'memory' };
    let stored = false;
    try {
      const job = manager.store(assetId, file);
      jobRef.current = job;
      const pointer = await job.result;
      stored = true;
      const verification = manager.readSlice(assetId, 0, Math.min(file.size, 12));
      jobRef.current = verification;
      await verification.result;
      return pointer;
    } catch (caught) {
      let cleanupMessage = '';
      if (stored) {
        try {
          await manager.remove(assetId);
        } catch (cleanupError) {
          cleanupMessage = ` Cache cleanup also failed: ${
            cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup error'
          }`;
        }
      }
      if (caught instanceof OPFSOperationCancelledError) throw caught;
      setStatus(
        `Loaded in bounded memory. OPFS cache was unavailable: ${
          caught instanceof Error ? caught.message : 'unknown storage error'
        }.${cleanupMessage}`,
      );
      return { kind: 'memory' };
    }
  }

  async function importFiles(fileList: FileList | readonly File[]): Promise<void> {
    const files = Array.from(fileList);
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(undefined);
    setProgress(0);
    setStatus(`Reading ${files.length} local file${files.length === 1 ? '' : 's'} in workers...`);
    await resetPreviewEngine();
    let workingState = timelineRef.current;
    const workingPcm: PcmAssetMap = { ...pcmRef.current };
    const workingPeaks: PeakMap = { ...peaksRef.current };
    const cachedDuringImport: AudioAssetId[] = [];
    try {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex]!;
        const analysisJob = startAnalyze(file, (value) =>
          setProgress((fileIndex + value * 0.45) / files.length),
        );
        jobRef.current = analysisJob;
        const analysis = await analysisJob.result;
        assertDecodeFitsProject(workingPcm, analysis.duration, analysis.sampleRate);
        const decodeJob = startDecodeFile(file, (value) =>
          setProgress((fileIndex + 0.45 + value * 0.45) / files.length),
        );
        jobRef.current = decodeJob;
        const decoded = await decodeJob.result;
        if (decoded.channelData.length < 1 || decoded.channelData.length > 2) {
          throw new Error('Multitrack Studio supports mono or stereo assets.');
        }
        const assetId = createId('asset');
        const source = await cacheFile(assetId, file);
        if (source.kind === 'opfs') cachedDuringImport.push(assetId);
        const asset: AudioAsset = {
          id: assetId,
          name: file.name,
          mimeType: file.type || 'audio/wav',
          byteLength: file.size,
          duration: analysis.duration,
          sampleRate: decoded.sampleRate,
          channels: decoded.channelData.length as 1 | 2,
          source,
        };
        workingState = addAssetToTimeline(workingState, asset, targetTrackId);
        workingPcm[assetId] = {
          sampleRate: decoded.sampleRate,
          channelData: decoded.channelData,
        };
        workingPeaks[assetId] = buildPeakPyramidFromOverview(
          analysis.waveform,
          decoded.channelData[0]!.length,
        );
        validateMixInput({ state: workingState, pcmByAssetId: workingPcm });
        setProgress((fileIndex + 0.95) / files.length);
      }
      setTimeline(workingState);
      timelineRef.current = workingState;
      setPcmByAssetId(workingPcm);
      pcmRef.current = workingPcm;
      setPeaksByAssetId(workingPeaks);
      peaksRef.current = workingPeaks;
      setProgress(1);
      setStatus(
        `Ready. ${files.length} file${files.length === 1 ? '' : 's'} added without upload.`,
      );
    } catch (caught) {
      const manager = opfsRef.current;
      if (manager && cachedDuringImport.length > 0) {
        const cleanupResults = await Promise.allSettled(
          cachedDuringImport.map((assetId) => manager.remove(assetId)),
        );
        const failedCleanup = cleanupResults.some((result) => result.status === 'rejected');
        setStatus(
          failedCleanup
            ? 'Import rolled back. Some temporary cache entries will be retried during session cleanup.'
            : 'Import rolled back and its temporary cache entries were removed.',
        );
      }
      setError(caught instanceof Error ? caught.message : 'The audio files could not be imported.');
      setProgress(0);
    } finally {
      jobRef.current = undefined;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function addGenerated(kind: GeneratorKind): Promise<void> {
    if (busy) return;
    setError(undefined);
    await resetPreviewEngine();
    try {
      const channel = generatedPcm(kind);
      const id = createId('generated');
      const label = kind === 'tone' ? '440 Hz tone' : kind === 'silence' ? 'Silence' : 'Studio click';
      const asset: AudioAsset = {
        id,
        name: label,
        mimeType: 'audio/x-generated',
        byteLength: channel.byteLength,
        duration: channel.length / GENERATED_SAMPLE_RATE,
        sampleRate: GENERATED_SAMPLE_RATE,
        channels: 1,
        source: { kind: 'memory' },
      };
      const nextTimeline = addAssetToTimeline(timelineRef.current, asset, targetTrackId);
      const nextPcm = {
        ...pcmRef.current,
        [id]: { sampleRate: GENERATED_SAMPLE_RATE, channelData: [channel] },
      };
      validateMixInput({ state: nextTimeline, pcmByAssetId: nextPcm });
      const nextPeaks = { ...peaksRef.current, [id]: buildPeakPyramid(channel) };
      setTimeline(nextTimeline);
      timelineRef.current = nextTimeline;
      setPcmByAssetId(nextPcm);
      pcmRef.current = nextPcm;
      setPeaksByAssetId(nextPeaks);
      peaksRef.current = nextPeaks;
      setStatus(`${label} added to ${nextTimeline.tracks.find((track) => track.id === targetTrackId)?.name ?? 'the timeline'}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Generated audio could not be added.');
    }
  }

  function updateTrack(trackId: AudioTrackId, patch: Partial<AudioTrack>): void {
    commitTimeline({
      ...timeline,
      tracks: timeline.tracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    });
  }

  function updateClip(patch: Partial<AudioClip>): void {
    if (!selectedTrack || !selectedClip) return;
    commitTimeline({
      ...timeline,
      tracks: timeline.tracks.map((track) =>
        track.id === selectedTrack.id
          ? {
              ...track,
              clips: track.clips.map((clip) =>
                clip.id === selectedClip.id ? { ...clip, ...patch } : clip,
              ),
            }
          : track,
      ),
    });
  }

  function addTrack(): void {
    if (timeline.tracks.length >= 16) {
      setError('A project supports at most 16 tracks.');
      return;
    }
    const index = timeline.tracks.length + 1;
    const id = createId('track');
    commitTimeline({
      ...timeline,
      tracks: [...timeline.tracks, createTrack(id, `Track ${index}`, 'sfx')],
      selection: { trackId: id },
    });
    setTargetTrackId(id);
  }

  async function exportMix(): Promise<void> {
    if (busy || duration <= 0) return;
    setError(undefined);
    setBusy(true);
    setProgress(0);
    setStatus('Mixing and encoding WAV in a worker...');
    if (playing) await togglePlayback();
    try {
      const input = { state: timelineRef.current, pcmByAssetId: pcmRef.current };
      validateMixInput(input);
      const job = startMultitrackMixdown(input, setProgress);
      jobRef.current = job;
      const blob = await job.result;
      downloadBlob(blob, outputFileName(timelineRef.current.name));
      setProgress(1);
      setStatus('Done. Your multitrack WAV was created locally without uploading audio.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Multitrack export failed.');
      setProgress(0);
    } finally {
      jobRef.current = undefined;
      setBusy(false);
    }
  }

  function seek(time: number): void {
    const nextTime = Math.max(0, Math.min(duration, time));
    engineRef.current?.seek(nextTime);
    commitTimeline({ ...timelineRef.current, playhead: nextTime });
  }

  function updateTempo(rawValue: string): void {
    if (rawValue.trim() === '') return;
    const tempo = Number(rawValue);
    if (!Number.isFinite(tempo) || tempo < 20 || tempo > 300) return;
    updateTimelineView({ ...timelineRef.current, tempo });
  }

  const projectedBytes =
    duration > 0
      ? projectedMixWorkingBytes({ state: timeline, pcmByAssetId })
      : retainedBytes * 3;

  return (
    <section className="space-y-3" data-testid="multitrack-studio">
      <div className="grid gap-3 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(22rem,1.1fr)]">
        <section className="rounded-3xl border border-white/10 bg-black/20 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
                Media library
              </p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-white">
                Assets
              </h2>
            </div>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[0.62rem] font-bold text-emerald-100/55">
              {Object.keys(timeline.assets).length} local
            </span>
          </div>

          <label className="mt-4 block text-[0.65rem] font-bold uppercase tracking-[0.1em] text-emerald-100/55">
            Add new clips to
            <select
              className="mt-1.5 block w-full rounded-xl border border-white/12 bg-[#0a1a16] px-3 py-2.5 text-sm normal-case tracking-normal text-white"
              disabled={busy}
              value={targetTrackId}
              onChange={(event) => setTargetTrackId(event.target.value)}
            >
              {timeline.tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </label>

          <input
            ref={inputRef}
            accept={ACCEPTED_AUDIO}
            className="sr-only"
            disabled={busy}
            multiple
            type="file"
            onChange={(event) => void importFiles(event.target.files ?? [])}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="col-span-2 rounded-xl bg-emerald-300 px-4 py-3 text-sm font-black text-emerald-950 hover:bg-emerald-200 disabled:opacity-50"
              disabled={busy}
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              Import WAV or MP3
            </button>
            {(['tone', 'silence', 'click'] as const).map((kind) => (
              <button
                key={kind}
                className="rounded-xl border border-white/12 bg-white/[0.03] px-3 py-2 text-xs font-bold capitalize text-emerald-100/70 hover:bg-white/[0.07] disabled:opacity-50"
                disabled={busy}
                type="button"
                onClick={() => void addGenerated(kind)}
              >
                Add {kind}
              </button>
            ))}
            <button
              className="rounded-xl border border-white/12 px-3 py-2 text-xs font-bold text-emerald-100/70 hover:bg-white/[0.05]"
              type="button"
              onClick={addTrack}
            >
              Add track
            </button>
          </div>

          <div className="mt-4 max-h-40 space-y-1.5 overflow-auto">
            {Object.values(timeline.assets).length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/12 px-3 py-5 text-center text-xs leading-relaxed text-emerald-100/50">
                Raw assets stay immutable. Timeline clips only store offsets, gain, and fades.
              </p>
            ) : (
              Object.values(timeline.assets).map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">{asset.name}</p>
                    <p className="mt-0.5 text-[0.62rem] text-emerald-100/50">
                      {formatDuration(asset.duration)} / {asset.channels === 1 ? 'mono' : 'stereo'} /{' '}
                      {asset.source.kind === 'opfs' ? 'OPFS cached' : 'memory'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[0.6rem] text-emerald-100/45">
                    {formatBytes(asset.byteLength)}
                  </span>
                </div>
              ))
            )}
          </div>
          <p className="mt-3 text-[0.65rem] leading-relaxed text-emerald-100/48">
            Microphone recording is intentionally disabled: the core extension keeps zero microphone
            permission. Stock sounds are generated locally and never fetched. Projects are
            session-only in this release, so export before closing this tab.
          </p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-black/20 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
                Inspector / FX rack
              </p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-white">
                {selectedClip
                  ? timeline.assets[selectedClip.assetId]?.name
                  : selectedTrack?.name ?? 'Select a clip'}
              </h2>
            </div>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[0.62rem] font-bold text-emerald-100/55">
              Non-destructive
            </span>
          </div>

          {selectedTrack ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-emerald-100/60">
                Track volume {Math.round(selectedTrack.volume * 100)}%
                <input
                  className="mt-2 w-full accent-emerald-300"
                  max="2"
                  min="0"
                  step="0.01"
                  type="range"
                  value={selectedTrack.volume}
                  onChange={(event) =>
                    updateTrack(selectedTrack.id, { volume: Number(event.target.value) })
                  }
                />
              </label>
              <label className="text-xs font-bold text-emerald-100/60">
                Pan {selectedTrack.pan.toFixed(2)}
                <input
                  className="mt-2 w-full accent-emerald-300"
                  max="1"
                  min="-1"
                  step="0.01"
                  type="range"
                  value={selectedTrack.pan}
                  onChange={(event) =>
                    updateTrack(selectedTrack.id, { pan: Number(event.target.value) })
                  }
                />
              </label>
              <label className="text-xs font-bold text-emerald-100/60">
                Track role
                <select
                  className="mt-2 block w-full rounded-xl border border-white/12 bg-[#0a1a16] px-3 py-2.5 text-white"
                  value={selectedTrack.role}
                  onChange={(event) =>
                    updateTrack(selectedTrack.id, {
                      role: event.target.value as TrackRole,
                    })
                  }
                >
                  <option value="dialogue">Dialogue</option>
                  <option value="music">Music</option>
                  <option value="sfx">Sound effect</option>
                </select>
              </label>
              <label className="text-xs font-bold text-emerald-100/60">
                EQ preset
                <select
                  className="mt-2 block w-full rounded-xl border border-white/12 bg-[#0a1a16] px-3 py-2.5 text-white"
                  value={selectedTrack.eqPreset}
                  onChange={(event) =>
                    updateTrack(selectedTrack.id, {
                      eqPreset: event.target.value as EqPreset,
                    })
                  }
                >
                  <option value="flat">Flat</option>
                  <option value="voice">Voice clarity</option>
                  <option value="warm">Warm</option>
                  <option value="bright">Bright</option>
                </select>
              </label>
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-white/12 px-4 py-7 text-center text-sm text-emerald-100/50">
              Select a track or clip in the timeline to reveal its controls.
            </p>
          )}

          {selectedClip && (
            <div className="mt-4 grid gap-4 border-t border-white/8 pt-4 sm:grid-cols-3">
              <label className="text-xs font-bold text-emerald-100/60">
                Clip gain {Math.round(selectedClip.gain * 100)}%
                <input
                  className="mt-2 w-full accent-amber-300"
                  max="2"
                  min="0"
                  step="0.01"
                  type="range"
                  value={selectedClip.gain}
                  onChange={(event) => updateClip({ gain: Number(event.target.value) })}
                />
              </label>
              <label className="text-xs font-bold text-emerald-100/60">
                Fade in {selectedClip.fadeIn.toFixed(2)}s
                <input
                  className="mt-2 w-full accent-amber-300"
                  max={Math.max(0, selectedClip.duration - selectedClip.fadeOut)}
                  min="0"
                  step="0.01"
                  type="range"
                  value={selectedClip.fadeIn}
                  onChange={(event) => updateClip({ fadeIn: Number(event.target.value) })}
                />
              </label>
              <label className="text-xs font-bold text-emerald-100/60">
                Fade out {selectedClip.fadeOut.toFixed(2)}s
                <input
                  className="mt-2 w-full accent-amber-300"
                  max={Math.max(0, selectedClip.duration - selectedClip.fadeIn)}
                  min="0"
                  step="0.01"
                  type="range"
                  value={selectedClip.fadeOut}
                  onChange={(event) => updateClip({ fadeOut: Number(event.target.value) })}
                />
              </label>
            </div>
          )}

          <div className="mt-4 grid gap-3 border-t border-white/8 pt-4 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-xs leading-relaxed text-emerald-100/60">
              <input
                checked={timeline.autoDucking.enabled}
                className="mt-0.5 accent-emerald-300"
                type="checkbox"
                onChange={(event) =>
                  commitTimeline({
                    ...timeline,
                    autoDucking: {
                      ...timeline.autoDucking,
                      enabled: event.target.checked,
                    },
                  })
                }
              />
              Auto-duck music under dialogue
            </label>
            <p className="text-xs leading-relaxed text-emerald-100/48">
              Preview follows a live RMS sidechain. Export uses deterministic sample-accurate
              attack and release.
            </p>
            <label className="text-xs font-bold text-emerald-100/60">
              Threshold {timeline.autoDucking.thresholdDb} dB
              <input
                className="mt-2 w-full accent-emerald-300"
                max="0"
                min="-60"
                step="1"
                type="range"
                value={timeline.autoDucking.thresholdDb}
                onChange={(event) =>
                  commitTimeline({
                    ...timeline,
                    autoDucking: {
                      ...timeline.autoDucking,
                      thresholdDb: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="text-xs font-bold text-emerald-100/60">
              Reduction {timeline.autoDucking.reductionDb} dB
              <input
                className="mt-2 w-full accent-emerald-300"
                max="0"
                min="-36"
                step="1"
                type="range"
                value={timeline.autoDucking.reductionDb}
                onChange={(event) =>
                  commitTimeline({
                    ...timeline,
                    autoDucking: {
                      ...timeline.autoDucking,
                      reductionDb: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
          <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[0.65rem] leading-relaxed text-emerald-100/48">
            Noise suppression is not enabled in this release. It requires a separately reviewed,
            fully bundled model and deterministic worker export path.
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#07130f]/95 px-4 py-3 shadow-[0_18px_55px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              aria-label="Go to start"
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/12 text-emerald-100/70 hover:bg-white/5"
              disabled={busy}
              type="button"
              onClick={() => seek(0)}
            >
              |&lt;
            </button>
            <button
              className="grid h-11 min-w-24 place-items-center rounded-xl bg-emerald-300 px-4 text-sm font-black text-emerald-950 hover:bg-emerald-200 disabled:opacity-50"
              disabled={busy || duration <= 0}
              type="button"
              onClick={() => void togglePlayback()}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              aria-describedby="recording-policy"
              className="grid h-10 w-10 cursor-not-allowed place-items-center rounded-full border border-red-300/20 text-red-200/45"
              disabled
              title="Recording would require microphone permission."
              type="button"
            >
              ●
            </button>
          </div>
          <p
            className="min-w-24 font-mono text-lg font-black tracking-tight text-white"
            aria-label={`Playhead ${formatDuration(timeline.playhead)}`}
          >
            {formatDuration(timeline.playhead)}
          </p>
          <input
            aria-label="Timeline playhead"
            className="min-w-40 flex-1 accent-rose-300"
            disabled={busy || duration <= 0}
            max={Math.max(duration, 0.01)}
            min="0"
            step="0.01"
            type="range"
            value={Math.min(timeline.playhead, Math.max(duration, 0.01))}
            onChange={(event: ChangeEvent<HTMLInputElement>) => seek(Number(event.target.value))}
          />
          <label className="text-[0.62rem] font-bold uppercase tracking-[0.1em] text-emerald-100/50">
            BPM
            <input
              className="ml-2 w-16 rounded-lg border border-white/12 bg-[#0a1a16] px-2 py-1.5 text-sm text-white"
              max="300"
              min="20"
              type="number"
              value={timeline.tempo}
              onChange={(event) => updateTempo(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-emerald-100/55">
            <input
              checked={timeline.snapEnabled}
              className="accent-amber-300"
              type="checkbox"
              onChange={(event) =>
                updateTimelineView({ ...timeline, snapEnabled: event.target.checked })
              }
            />
            Magnetic snap
          </label>
          <label className="text-[0.62rem] font-bold uppercase tracking-[0.1em] text-emerald-100/50">
            Master
            <input
              aria-label="Master volume"
              className="ml-2 w-20 accent-emerald-300"
              max="2"
              min="0"
              step="0.01"
              type="range"
              value={timeline.masterGain}
              onChange={(event) =>
                commitTimeline({ ...timeline, masterGain: Number(event.target.value) })
              }
            />
          </label>
          <div
            aria-label={`Master peak ${Math.round(meterPeak * 100)} percent`}
            className="h-2 w-20 overflow-hidden rounded-full bg-white/10"
            role="meter"
            aria-valuemax={1}
            aria-valuemin={0}
            aria-valuenow={meterPeak}
          >
            <div
              className={`h-full ${meterPeak > 0.98 ? 'bg-red-400' : 'bg-emerald-300'}`}
              style={{ width: `${Math.min(100, meterPeak * 100)}%` }}
            />
          </div>
          <Button disabled={busy || duration <= 0} onClick={exportMix}>
            Export mix WAV
          </Button>
          {busy && (
            <button
              className="rounded-xl border border-red-300/30 px-3 py-2 text-xs font-bold text-red-200"
              type="button"
              onClick={() => jobRef.current?.cancel()}
            >
              Cancel
            </button>
          )}
        </div>
        <p id="recording-policy" className="sr-only">
          Recording is unavailable because this extension does not request microphone permission.
        </p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-black/20 p-3 shadow-[0_28px_90px_rgba(0,0,0,0.25)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
              Multitrack timeline
            </p>
            <p className="mt-1 text-xs text-emerald-100/48">
              Drag clips to move. Drag gold edges to trim. Edits only change JSON offsets.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-emerald-100/55">
            Zoom
            <input
              aria-label="Timeline zoom"
              className="w-36 accent-emerald-300"
              max="500"
              min="20"
              step="10"
              type="range"
              value={timeline.viewport.pixelsPerSecond}
              onChange={(event) =>
                updateTimelineView({
                  ...timeline,
                  viewport: {
                    ...timeline.viewport,
                    pixelsPerSecond: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>
        <CanvasTimeline
          peaksByAssetId={peaksByAssetId}
          state={timeline}
          onChange={commitTimeline}
          onTransientChange={updateTimelineView}
          onSeek={seek}
        />
      </section>

      {busy && <Progress value={progress} />}
      {error && (
        <p
          className="rounded-xl border border-red-300/30 bg-red-300/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[0.64rem] font-semibold text-emerald-100/48">
        <p aria-live="polite">{status}</p>
        <p className="uppercase tracking-[0.1em]">
          {formatBytes(retainedBytes)} PCM / {formatBytes(projectedBytes)} worst-case in-flight /{' '}
          {formatBytes(MAX_PCM_ENCODE_BYTES)} hard cap
        </p>
      </div>
    </section>
  );
}
