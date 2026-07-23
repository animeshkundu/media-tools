import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { Progress } from '../../../components/Progress';
import { downloadBlob } from '../../core/download';
import { formatBytes, formatDuration } from '../../core/format';
import {
  MAX_PCM_ENCODE_BYTES,
  startAnalyze,
  startDecodeFile,
  type AudioJob,
  type EncodeFormat,
} from '../../core/worker';
import { CanvasTimeline } from './CanvasTimeline';
import { MultitrackAudioEngine } from './engine';
import {
  assertDecodeFitsProject,
  maxVoiceOverFrames,
  projectedMixWorkingBytes,
  retainedPcmBytes,
  validateMixInput,
  type MultitrackPcmAsset,
} from './mixdown';
import { OPFSAssetManager, OPFSOperationCancelledError } from './opfs';
import {
  buildPeakPyramid,
  buildPeakPyramidFromOverview,
  peakCacheBytes,
  type PeakPyramid,
} from './peaks';
import {
  createEmptyTimeline,
  createTrack,
  MAX_MULTITRACK_ASSETS,
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
import {
  changeClipSpeed,
  projectDuration,
  removeClip,
  splitClip,
} from './timeline';
import { VoiceOverRecorder } from './voiceRecorder';

type PcmAssetMap = Record<AudioAssetId, MultitrackPcmAsset>;
type PeakMap = Record<AudioAssetId, PeakPyramid>;
type GeneratorKind = 'tone' | 'silence' | 'click';

const ACCEPTED_AUDIO = 'audio/wav,audio/mpeg,.wav,.mp3';
const GENERATED_SAMPLE_RATE = 48_000;

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function outputFileName(name: string, format: EncodeFormat): string {
  const safe = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'multitrack-mix'}.${format}`;
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
    playbackRate: 1,
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
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [skimming, setSkimming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [format, setFormat] = useState<EncodeFormat>('wav');
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
  const recorderRef = useRef<VoiceOverRecorder | undefined>(undefined);
  const voiceTrackIdRef = useRef<AudioTrackId | undefined>(undefined);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
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
  const retainedPeakBytes = useMemo(
    () => peakCacheBytes(peaksByAssetId),
    [peaksByAssetId],
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
      if (recordTimerRef.current !== undefined) clearInterval(recordTimerRef.current);
      jobRef.current?.cancel();
      if (recorderRef.current) void recorderRef.current.cancel();
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
    if (files.length === 0 || busy || recording) return;
    if (
      Object.keys(timelineRef.current.assets).length + files.length >
      MAX_MULTITRACK_ASSETS
    ) {
      setError(`A project supports at most ${MAX_MULTITRACK_ASSETS} media assets.`);
      setStatus('No files were imported. The existing project was not changed.');
      return;
    }
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
      } else {
        setStatus('Import failed. The existing project was not changed.');
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
    if (busy || recording) return;
    if (Object.keys(timelineRef.current.assets).length >= MAX_MULTITRACK_ASSETS) {
      setError(`A project supports at most ${MAX_MULTITRACK_ASSETS} media assets.`);
      return;
    }
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

  async function handleAddExistingAsset(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    if (busy || recording) return;
    const asset = timeline.assets[event.currentTarget.dataset.assetId ?? ''];
    if (!asset) {
      setError('The selected media asset is no longer available.');
      return;
    }
    setError(undefined);
    await resetPreviewEngine();
    try {
      const next = addAssetToTimeline(timeline, asset, targetTrackId);
      validateMixInput({ state: next, pcmByAssetId });
      commitTimeline(next);
      setStatus(
        `${asset.name} added to ${
          next.tracks.find((track) => track.id === targetTrackId)?.name ?? 'the timeline'
        }.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The asset could not be added.');
    }
  }

  async function finishVoiceOver(automatic = false): Promise<void> {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = undefined;
    if (recordTimerRef.current !== undefined) clearInterval(recordTimerRef.current);
    recordTimerRef.current = undefined;
    if (!recorder.hasStarted) {
      setRecording(false);
      setRecordingSeconds(0);
      voiceTrackIdRef.current = undefined;
      await recorder.cancel();
      setStatus('Voice-over permission request cancelled. No recording was added.');
      return;
    }
    setBusy(true);
    setStatus('Finalizing the local voice-over...');
    try {
      const recorded = await recorder.stop();
      const id = createId('voice');
      const voiceTrack =
        timelineRef.current.tracks.find(
          (track) => track.id === voiceTrackIdRef.current,
        ) ??
        timelineRef.current.tracks[0]!;
      const asset: AudioAsset = {
        id,
        name: `Voice over ${Object.keys(timelineRef.current.assets).length + 1}`,
        mimeType: 'audio/x-recorded-pcm',
        byteLength: recorded.channelData[0].byteLength,
        duration: recorded.duration,
        sampleRate: recorded.sampleRate,
        channels: 1,
        source: { kind: 'memory' },
      };
      const nextPcm: PcmAssetMap = {
        ...pcmRef.current,
        [id]: {
          sampleRate: recorded.sampleRate,
          channelData: recorded.channelData,
        },
      };
      const nextTimeline = addAssetToTimeline(timelineRef.current, asset, voiceTrack.id);
      validateMixInput({ state: nextTimeline, pcmByAssetId: nextPcm });
      const nextPeaks = {
        ...peaksRef.current,
        [id]: buildPeakPyramid(recorded.channelData[0]),
      };
      setPcmByAssetId(nextPcm);
      pcmRef.current = nextPcm;
      setPeaksByAssetId(nextPeaks);
      peaksRef.current = nextPeaks;
      commitTimeline(nextTimeline);
      setTargetTrackId(voiceTrack.id);
      setStatus(
        automatic
          ? 'Voice-over reached its safe recording limit and was added to Dialogue.'
          : 'Voice-over added to Dialogue. Microphone access has ended.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The voice-over could not be added.');
    } finally {
      voiceTrackIdRef.current = undefined;
      setRecording(false);
      setRecordingSeconds(0);
      setBusy(false);
    }
  }

  async function toggleRecording(): Promise<void> {
    if (recording) {
      await finishVoiceOver();
      return;
    }
    if (busy) return;
    if (Object.keys(timelineRef.current.assets).length >= MAX_MULTITRACK_ASSETS) {
      setError(`A project supports at most ${MAX_MULTITRACK_ASSETS} media assets.`);
      return;
    }
    if (!VoiceOverRecorder.isSupported()) {
      setError('Microphone recording is not supported in this browser.');
      return;
    }
    setError(undefined);
    setStatus('Choose Allow in the browser prompt to record a local voice-over.');
    if (playing) await togglePlayback();
    await resetPreviewEngine();
    const voiceTrack =
      timelineRef.current.tracks.find((track) => track.role === 'dialogue') ??
      timelineRef.current.tracks[0]!;
    const recorder = new VoiceOverRecorder(() => void finishVoiceOver(true));
    recorderRef.current = recorder;
    voiceTrackIdRef.current = voiceTrack.id;
    setRecording(true);
    try {
      await recorder.start((sampleRate) =>
        maxVoiceOverFrames(
          { state: timelineRef.current, pcmByAssetId: pcmRef.current },
          voiceTrack.id,
          sampleRate,
          5 * 60,
        ),
      );
      recordTimerRef.current = setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 0.1);
      }, 100);
      setStatus('Recording locally. Select Stop recording when the take is complete.');
    } catch (caught) {
      const isCurrentRecorder = recorderRef.current === recorder;
      await recorder.cancel();
      if (!isCurrentRecorder) return;
      recorderRef.current = undefined;
      voiceTrackIdRef.current = undefined;
      setRecording(false);
      setRecordingSeconds(0);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Microphone access was not granted.',
      );
    }
  }

  async function discardRecording(): Promise<void> {
    const recorder = recorderRef.current;
    recorderRef.current = undefined;
    voiceTrackIdRef.current = undefined;
    if (recordTimerRef.current !== undefined) clearInterval(recordTimerRef.current);
    recordTimerRef.current = undefined;
    if (recorder) await recorder.cancel();
    setRecording(false);
    setRecordingSeconds(0);
    setStatus('Voice-over discarded. No recording was added.');
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

  function updateClipSpeed(playbackRate: number): void {
    if (!selectedTrack || !selectedClip) return;
    try {
      commitTimeline(
        changeClipSpeed(
          timelineRef.current,
          selectedTrack.id,
          selectedClip.id,
          playbackRate,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Clip speed could not be changed.');
    }
  }

  function splitSelectedClip(): void {
    if (!selectedTrack || !selectedClip) return;
    try {
      commitTimeline(
        splitClip(
          timelineRef.current,
          selectedTrack.id,
          selectedClip.id,
          timelineRef.current.playhead,
          createId('clip'),
        ),
      );
      setStatus('Clip split at the playhead. Both sections still reference the original asset.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The clip could not be split.');
    }
  }

  function deleteSelectedClip(): void {
    if (!selectedTrack || !selectedClip) return;
    commitTimeline(removeClip(timelineRef.current, selectedTrack.id, selectedClip.id));
    setStatus('Clip removed from the timeline. The source asset remains in the media library.');
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
    if (busy || recording || duration <= 0) return;
    setError(undefined);
    setBusy(true);
    setProgress(0);
    setStatus(`Mixing and encoding ${format.toUpperCase()} in a worker...`);
    if (playing) await togglePlayback();
    try {
      const input = { state: timelineRef.current, pcmByAssetId: pcmRef.current };
      validateMixInput(input);
      const job = startMultitrackMixdown(input, format, setProgress);
      jobRef.current = job;
      const blob = await job.result;
      downloadBlob(blob, outputFileName(timelineRef.current.name, format));
      setProgress(1);
      setStatus(
        `Done. Your multitrack ${format.toUpperCase()} was created locally without uploading audio.`,
      );
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

  async function setAudioSkimming(enabled: boolean): Promise<void> {
    setSkimming(enabled);
    if (!enabled || duration <= 0) return;
    try {
      const engine = engineRef.current ?? createPreviewEngine();
      await engine.context.resume();
      setStatus('Audio skimming enabled. Move across the timeline to audition under the pointer.');
    } catch (caught) {
      setSkimming(false);
      setError(caught instanceof Error ? caught.message : 'Audio skimming could not start.');
    }
  }

  function skim(time: number): void {
    if (!skimming || playing || busy || recording || duration <= 0) return;
    const engine = engineRef.current ?? createPreviewEngine();
    void engine.scrub(Math.max(0, Math.min(duration, time))).catch((caught: unknown) => {
      setSkimming(false);
      setError(caught instanceof Error ? caught.message : 'Audio skimming stopped.');
    });
  }

  function receiveDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setDragging(false);
    if (busy || recording) return;
    void importFiles(event.dataTransfer.files);
  }

  const projectedBytes =
    duration > 0
      ? projectedMixWorkingBytes({ state: timeline, pcmByAssetId }) + retainedPeakBytes
      : retainedBytes * 3 + retainedPeakBytes;

  return (
    <section
      className="flex min-h-[calc(100vh-4rem)] flex-col gap-2 bg-[#111216] p-2 sm:p-3 xl:h-[calc(100vh-4rem)] xl:min-h-[44rem] xl:overflow-hidden"
      data-testid="multitrack-studio"
    >
      <div
        aria-label="Editing toolbar"
        className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#25262b] px-2.5 py-2 shadow-[0_1px_0_rgba(0,0,0,0.7)]"
        role="toolbar"
      >
        <div className="flex items-center gap-1.5">
          <button
            className="rounded-md bg-[#4ca8ff] px-3 py-2 text-xs font-bold text-[#06101a] hover:bg-[#72bbff] disabled:opacity-45"
            disabled={busy || recording}
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            Import media
          </button>
          <button
            aria-pressed={recording}
            className={`rounded-md border px-3 py-2 text-xs font-bold ${
              recording
                ? 'border-red-400/60 bg-red-500/15 text-red-200'
                : 'border-white/12 bg-white/[0.04] text-white/72 hover:bg-white/[0.08]'
            } disabled:opacity-40`}
            disabled={busy || (!recording && !VoiceOverRecorder.isSupported())}
            type="button"
            onClick={() => void toggleRecording()}
          >
            {recording ? 'Stop recording' : 'Record voice-over'}
          </button>
          {recording && (
            <button
              className="rounded-md px-2.5 py-2 text-xs font-semibold text-red-200/75 hover:bg-red-400/10"
              disabled={busy}
              type="button"
              onClick={() => void discardRecording()}
            >
              Discard
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-white/65 hover:bg-white/[0.06] disabled:opacity-35"
            disabled={busy || recording || !selectedClip}
            type="button"
            onClick={splitSelectedClip}
          >
            Split at playhead
          </button>
          <button
            className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-white/65 hover:bg-red-400/10 hover:text-red-200 disabled:opacity-35"
            disabled={busy || recording || !selectedClip}
            type="button"
            onClick={deleteSelectedClip}
          >
            Delete clip
          </button>
        </div>
      </div>

      <div className="grid min-h-[25rem] flex-[1.25] gap-2 xl:min-h-0 xl:basis-0 xl:grid-cols-[minmax(20rem,0.68fr)_minmax(38rem,1.32fr)]">
        <section
          className={`relative overflow-y-auto rounded-lg border bg-[#202126] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.24)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            dragging ? 'border-[#62b4ff] ring-2 ring-[#62b4ff]/20' : 'border-white/10'
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!busy && !recording) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={receiveDrop}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
                Media
              </p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-white">
                My media
              </h2>
            </div>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[0.62rem] font-bold text-emerald-100/55">
              {Object.keys(timeline.assets).length} local
            </span>
          </div>

          <label className="mt-2 block text-[0.65rem] font-bold uppercase tracking-[0.1em] text-emerald-100/55">
            Add new clips to
            <select
              aria-label="Destination track"
              className="mt-1 block w-full rounded-lg border border-white/12 bg-[#0a1a16] px-3 py-1.5 text-sm normal-case tracking-normal text-white"
              disabled={busy || recording}
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
            aria-label="Import audio files"
            ref={inputRef}
            accept={ACCEPTED_AUDIO}
            className="sr-only"
            disabled={busy || recording}
            multiple
            type="file"
            onChange={(event) => void importFiles(event.target.files ?? [])}
          />
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {Object.keys(timeline.assets).length === 0 && (
              <button
                className="col-span-2 rounded-lg border border-dashed border-[#62b4ff]/45 bg-[#62b4ff]/8 px-4 py-3 text-sm font-bold text-[#9fd1ff] hover:bg-[#62b4ff]/14 disabled:opacity-50 sm:col-span-4"
                disabled={busy || recording}
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                {dragging ? 'Drop to import' : 'Drop audio here or choose files'}
              </button>
            )}
            {(['tone', 'silence', 'click'] as const).map((kind) => (
              <button
                key={kind}
                className="rounded-lg border border-white/12 bg-white/[0.03] px-2 py-1.5 text-xs font-bold capitalize text-emerald-100/70 hover:bg-white/[0.07] disabled:opacity-50"
                disabled={busy || recording}
                type="button"
                onClick={() => void addGenerated(kind)}
              >
                Add {kind}
              </button>
            ))}
            <button
              className="rounded-lg border border-white/12 px-2 py-1.5 text-xs font-bold text-emerald-100/70 hover:bg-white/[0.05]"
              disabled={busy || recording}
              type="button"
              onClick={addTrack}
            >
              Add track
            </button>
          </div>

          <div className="mt-2 max-h-40 space-y-1.5 overflow-auto">
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
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[0.6rem] text-emerald-100/45">
                      {formatBytes(asset.byteLength)}
                    </span>
                    <button
                      aria-label={`Add ${asset.name} to ${timeline.tracks.find((track) => track.id === targetTrackId)?.name ?? 'timeline'}`}
                      className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-sm font-bold text-[#8ecaff] hover:bg-[#62b4ff]/10"
                      data-asset-id={asset.id}
                      disabled={busy || recording}
                      title="Add another clip from this asset"
                      type="button"
                      onClick={handleAddExistingAsset}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="mt-2 text-[0.65rem] leading-relaxed text-emerald-100/48">
            Voice-over asks only when you press Record and creates a local PCM asset. No install-time
            microphone permission is requested. Projects are session-only, so export before closing.
          </p>
        </section>

        <section className="overflow-auto rounded-lg border border-white/10 bg-[#202126] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.24)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
                Viewer / Inspector
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

          <div className="mt-3 grid min-h-24 place-items-center overflow-hidden rounded-md border border-black/80 bg-[radial-gradient(circle_at_50%_75%,rgba(76,168,255,0.12),transparent_50%),#090a0c] px-5 py-2 shadow-inner">
            <div className="w-full max-w-2xl text-center">
              <div className="flex items-center justify-center gap-1" aria-hidden="true">
                {Array.from({ length: 34 }, (_, index) => {
                  const wave = 14 + ((index * 17) % 46);
                  const active = playing || recording ? Math.max(wave, meterPeak * 70) : wave;
                  return (
                    <span
                      key={index}
                      className={`w-1 rounded-full ${
                        recording ? 'bg-red-400/75' : 'bg-[#63b7ff]/70'
                      }`}
                      style={{ height: `${active}px`, opacity: 0.28 + ((index * 13) % 60) / 100 }}
                    />
                  );
                })}
              </div>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-[-0.04em] text-white">
                {recording ? formatDuration(recordingSeconds) : formatDuration(timeline.playhead)}
              </p>
              <div className="mt-1 flex items-center justify-center gap-2 text-[0.62rem] font-bold uppercase tracking-[0.13em]">
                <span className={recording ? 'text-red-300' : playing ? 'text-[#79c1ff]' : 'text-white/38'}>
                  {recording ? 'Recording voice-over' : playing ? 'Playing mix' : duration > 0 ? 'Ready to preview' : 'Import audio to begin'}
                </span>
                {meterPeak > 0.98 && (
                  <span className="rounded bg-red-500/15 px-2 py-0.5 text-red-300">
                    Clipping
                  </span>
                )}
              </div>
            </div>
          </div>

          {selectedTrack ? (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <label className="text-xs font-bold text-emerald-100/60">
                Track volume {Math.round(selectedTrack.volume * 100)}%
                <input
                  aria-label="Selected track volume"
                  className="mt-1 w-full accent-emerald-300"
                  disabled={busy || recording}
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
                  aria-label="Selected track pan"
                  className="mt-1 w-full accent-emerald-300"
                  disabled={busy || recording}
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
                  aria-label="Selected track role"
                  className="mt-1 block w-full rounded-lg border border-white/12 bg-[#0a1a16] px-3 py-2 text-white"
                  disabled={busy || recording}
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
                  aria-label="Selected track EQ preset"
                  className="mt-1 block w-full rounded-lg border border-white/12 bg-[#0a1a16] px-3 py-2 text-white"
                  disabled={busy || recording}
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
            <div className="mt-3 grid gap-2.5 border-t border-white/8 pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-bold text-emerald-100/60">
                Speed {selectedClip.playbackRate.toFixed(2)}x
                <input
                  aria-label="Selected clip speed"
                  className="mt-1 w-full accent-[#62b4ff]"
                  disabled={busy || recording}
                  max="4"
                  min="0.25"
                  step="0.05"
                  type="range"
                  value={selectedClip.playbackRate}
                  onChange={(event) => updateClipSpeed(Number(event.target.value))}
                />
              </label>
              <label className="text-xs font-bold text-emerald-100/60">
                Clip gain {Math.round(selectedClip.gain * 100)}%
                <input
                  aria-label="Selected clip gain"
                  className="mt-1 w-full accent-amber-300"
                  disabled={busy || recording}
                  max="5"
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
                  aria-label="Selected clip fade in"
                  className="mt-1 w-full accent-amber-300"
                  disabled={busy || recording}
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
                  aria-label="Selected clip fade out"
                  className="mt-1 w-full accent-amber-300"
                  disabled={busy || recording}
                  max={Math.max(0, selectedClip.duration - selectedClip.fadeIn)}
                  min="0"
                  step="0.01"
                  type="range"
                  value={selectedClip.fadeOut}
                  onChange={(event) => updateClip({ fadeOut: Number(event.target.value) })}
                />
              </label>
              <label className="text-xs font-bold text-emerald-100/60">
                Fade curve
                <select
                  aria-label="Selected clip fade curve"
                  className="mt-1 block w-full rounded-lg border border-white/12 bg-[#15161a] px-3 py-1.5 text-white"
                  disabled={busy || recording}
                  value={selectedClip.fadeCurve}
                  onChange={(event) =>
                    updateClip({
                      fadeCurve: event.target.value as AudioClip['fadeCurve'],
                    })
                  }
                >
                  <option value="logarithmic">Natural</option>
                  <option value="linear">Linear</option>
                </select>
              </label>
            </div>
          )}

          <div className="mt-2 grid gap-2 border-t border-white/8 pt-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-xs leading-relaxed text-emerald-100/60">
              <input
                checked={timeline.autoDucking.enabled}
                className="mt-0.5 accent-emerald-300"
                disabled={busy || recording}
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
            <details className="sm:col-span-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
              <summary className="cursor-pointer text-xs font-bold text-white/55">
                Fine-tune ducking · {timeline.autoDucking.thresholdDb} dB threshold ·{' '}
                {timeline.autoDucking.reductionDb} dB reduction
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold text-white/60">
                  Threshold {timeline.autoDucking.thresholdDb} dB
                  <input
                    className="mt-2 w-full accent-[#62b4ff]"
                    disabled={busy || recording}
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
                <label className="text-xs font-bold text-white/60">
                  Reduction {timeline.autoDucking.reductionDb} dB
                  <input
                    className="mt-2 w-full accent-[#62b4ff]"
                    disabled={busy || recording}
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
            </details>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-white/10 bg-[#25262b] px-3 py-2 shadow-[0_10px_35px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              aria-label="Go to start"
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/12 text-emerald-100/70 hover:bg-white/5"
              disabled={busy || recording}
              type="button"
              onClick={() => seek(0)}
            >
              |&lt;
            </button>
            <button
              className="grid h-11 min-w-24 place-items-center rounded-xl bg-emerald-300 px-4 text-sm font-black text-emerald-950 hover:bg-emerald-200 disabled:opacity-50"
              disabled={busy || recording || duration <= 0}
              type="button"
              onClick={() => void togglePlayback()}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              aria-describedby="recording-policy"
              aria-label={recording ? 'Stop voice-over recording' : 'Record voice-over'}
              aria-pressed={recording}
              className={`grid h-10 w-10 place-items-center rounded-full border ${
                recording
                  ? 'border-red-300 bg-red-500 text-white shadow-[0_0_0_4px_rgba(248,113,113,0.13)]'
                  : 'border-red-300/35 text-red-300 hover:bg-red-400/10'
              } disabled:cursor-not-allowed disabled:opacity-35`}
              disabled={busy || (!recording && !VoiceOverRecorder.isSupported())}
              title="Record an opt-in local microphone take."
              type="button"
              onClick={() => void toggleRecording()}
            >
              <span className={`block ${recording ? 'h-3 w-3 rounded-sm bg-white' : 'h-3 w-3 rounded-full bg-current'}`} />
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
            disabled={busy || recording || duration <= 0}
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
          <select
            aria-label="Export format"
            className="rounded-lg border border-white/12 bg-[#15161a] px-3 py-2 text-xs font-bold text-white"
            disabled={busy || recording}
            value={format}
            onChange={(event) => setFormat(event.target.value as EncodeFormat)}
          >
            <option value="wav">WAV · lossless PCM</option>
            <option value="mp3">MP3 · 192 kbps</option>
          </select>
          <button
            className="rounded-lg bg-[#4ca8ff] px-4 py-2.5 text-sm font-black text-[#06101a] hover:bg-[#72bbff] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy || recording || duration <= 0}
            type="button"
            onClick={() => void exportMix()}
          >
            Export {format.toUpperCase()}
          </button>
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
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-1.5 text-[0.62rem] font-semibold text-white/45">
          <p aria-live="polite">{status}</p>
          <p className="uppercase tracking-[0.1em]">
            {formatBytes(retainedBytes)} PCM + {formatBytes(retainedPeakBytes)} peaks /{' '}
            {formatBytes(projectedBytes)} worst-case /{' '}
            {formatBytes(MAX_PCM_ENCODE_BYTES)} cap
          </p>
        </div>
        <p id="recording-policy" className="sr-only">
          Recording is optional and feature-detected. The browser prompts only after activation,
          captures one bounded local PCM take, and ends microphone access when stopped or discarded.
        </p>
      </section>

      <section className="min-h-[23rem] flex-[0.75] rounded-lg border border-white/10 bg-[#1c1d21] p-3 shadow-[0_18px_55px_rgba(0,0,0,0.25)] xl:min-h-0 xl:basis-0 xl:overflow-hidden">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
              Multitrack timeline
            </p>
            <p className="mt-1 text-xs text-emerald-100/48">
              Drag clips to move. Drag gold edges to trim. Edits only change JSON offsets.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-bold text-emerald-100/55">
              <input
                checked={skimming}
                className="accent-[#62b4ff]"
                disabled={busy || recording || duration <= 0}
                type="checkbox"
                onChange={(event) => void setAudioSkimming(event.target.checked)}
              />
              Audio skimming
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-emerald-100/55">
              Zoom
              <input
                aria-label="Timeline zoom"
                className="w-36 accent-[#62b4ff]"
                disabled={busy || recording}
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
        </div>
        <CanvasTimeline
          disabled={busy || recording}
          peaksByAssetId={peaksByAssetId}
          state={timeline}
          onChange={commitTimeline}
          onTransientChange={updateTimelineView}
          onSeek={seek}
          onSkim={skim}
          skimmingEnabled={skimming}
        />
      </section>

      {busy && <Progress value={progress} />}
      {error && (
        <p
          className="fixed bottom-4 right-4 z-40 max-w-lg rounded-xl border border-red-300/35 bg-[#3a1d24]/95 px-4 py-3 text-sm font-semibold text-red-100 shadow-2xl backdrop-blur"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}
