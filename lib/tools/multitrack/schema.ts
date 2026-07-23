export type AudioAssetId = string;
export type AudioClipId = string;
export type AudioTrackId = string;
export type TrackRole = 'dialogue' | 'music' | 'sfx';
export type EqPreset = 'flat' | 'voice' | 'warm' | 'bright';
export type FadeCurve = 'linear' | 'logarithmic';

export const MAX_MULTITRACK_TRACKS = 16;
export const MAX_MULTITRACK_CLIPS = 128;
export const MAX_MULTITRACK_DURATION_SECONDS = 30 * 60;

export type OPFSAssetPointer = {
  readonly kind: 'opfs';
  readonly path: string;
};

export type MemoryAssetPointer = {
  readonly kind: 'memory';
};

export interface AudioAsset {
  readonly id: AudioAssetId;
  readonly name: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly duration: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly source: OPFSAssetPointer | MemoryAssetPointer;
}

export interface AudioClip {
  readonly id: AudioClipId;
  readonly assetId: AudioAssetId;
  readonly startTime: number;
  readonly trimStart: number;
  readonly duration: number;
  readonly gain: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
  readonly fadeCurve: FadeCurve;
}

export interface AudioTrack {
  readonly id: AudioTrackId;
  readonly name: string;
  readonly role: TrackRole;
  readonly clips: readonly AudioClip[];
  readonly volume: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly eqPreset: EqPreset;
}

export interface TimelineSelection {
  readonly trackId?: AudioTrackId;
  readonly clipId?: AudioClipId;
}

export interface TimelineViewport {
  readonly startTime: number;
  readonly pixelsPerSecond: number;
}

export interface AutoDuckingSettings {
  readonly enabled: boolean;
  readonly thresholdDb: number;
  readonly reductionDb: number;
  readonly attackSeconds: number;
  readonly releaseSeconds: number;
}

export interface TimelineState {
  readonly version: 1;
  readonly name: string;
  readonly assets: Readonly<Record<AudioAssetId, AudioAsset>>;
  readonly tracks: readonly AudioTrack[];
  readonly tempo: number;
  readonly playhead: number;
  readonly masterGain: number;
  readonly snapEnabled: boolean;
  readonly selection: TimelineSelection;
  readonly viewport: TimelineViewport;
  readonly autoDucking: AutoDuckingSettings;
}

export const DEFAULT_DUCKING: AutoDuckingSettings = {
  enabled: true,
  thresholdDb: -30,
  reductionDb: -12,
  attackSeconds: 0.03,
  releaseSeconds: 0.35,
};

export function createEmptyTimeline(name = 'Untitled mix'): TimelineState {
  return {
    version: 1,
    name,
    assets: {},
    tracks: [
      createTrack('track-dialogue', 'Dialogue', 'dialogue'),
      createTrack('track-music', 'Music', 'music'),
      createTrack('track-sfx', 'Sound effects', 'sfx'),
    ],
    tempo: 120,
    playhead: 0,
    masterGain: 1,
    snapEnabled: true,
    selection: {},
    viewport: { startTime: 0, pixelsPerSecond: 80 },
    autoDucking: DEFAULT_DUCKING,
  };
}

export function createTrack(id: AudioTrackId, name: string, role: TrackRole): AudioTrack {
  return {
    id,
    name,
    role,
    clips: [],
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    eqPreset: role === 'dialogue' ? 'voice' : 'flat',
  };
}

function assertFiniteRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside the supported range.`);
  }
}

function validateAsset(asset: AudioAsset): void {
  if (!asset.id || !asset.name || !asset.mimeType) throw new Error('Audio asset metadata is incomplete.');
  if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1) {
    throw new Error('Audio asset size is invalid.');
  }
  assertFiniteRange(asset.duration, Number.EPSILON, MAX_MULTITRACK_DURATION_SECONDS, 'Audio asset duration');
  assertFiniteRange(asset.sampleRate, 8_000, 192_000, 'Audio asset sample rate');
  if (asset.channels !== 1 && asset.channels !== 2) {
    throw new Error('Multitrack assets must be mono or stereo.');
  }
  if (asset.source.kind === 'opfs' && !asset.source.path) {
    throw new Error('The OPFS asset path is missing.');
  }
}

function validateClip(clip: AudioClip, asset: AudioAsset): void {
  if (!clip.id) throw new Error('Audio clip ID is missing.');
  assertFiniteRange(clip.startTime, 0, MAX_MULTITRACK_DURATION_SECONDS, 'Clip start time');
  assertFiniteRange(clip.trimStart, 0, asset.duration, 'Clip trim offset');
  assertFiniteRange(clip.duration, 0.001, asset.duration, 'Clip duration');
  assertFiniteRange(clip.gain, 0, 5, 'Clip gain');
  assertFiniteRange(clip.fadeIn, 0, clip.duration, 'Clip fade-in');
  assertFiniteRange(clip.fadeOut, 0, clip.duration, 'Clip fade-out');
  if (clip.fadeIn + clip.fadeOut > clip.duration + Number.EPSILON) {
    throw new Error('Clip fades cannot overlap beyond the clip duration.');
  }
  if (clip.trimStart + clip.duration > asset.duration + Number.EPSILON) {
    throw new Error('Clip trim extends beyond its immutable source asset.');
  }
  if (clip.startTime + clip.duration > MAX_MULTITRACK_DURATION_SECONDS) {
    throw new Error('Clip end exceeds the 30 minute project limit.');
  }
}

export function validateTimelineState(state: TimelineState): void {
  if (state.version !== 1 || !state.name) throw new Error('Timeline metadata is invalid.');
  if (state.tracks.length < 1 || state.tracks.length > MAX_MULTITRACK_TRACKS) {
    throw new Error(`A project supports 1 to ${MAX_MULTITRACK_TRACKS} tracks.`);
  }
  assertFiniteRange(state.tempo, 20, 300, 'Timeline tempo');
  assertFiniteRange(state.playhead, 0, MAX_MULTITRACK_DURATION_SECONDS, 'Timeline playhead');
  assertFiniteRange(state.masterGain, 0, 2, 'Master gain');
  assertFiniteRange(state.viewport.startTime, 0, MAX_MULTITRACK_DURATION_SECONDS, 'Viewport start');
  assertFiniteRange(state.viewport.pixelsPerSecond, 10, 2_000, 'Timeline zoom');
  validateDuckingSettings(state.autoDucking);

  Object.values(state.assets).forEach(validateAsset);
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  let clipCount = 0;
  for (const track of state.tracks) {
    if (!track.id || !track.name || trackIds.has(track.id)) throw new Error('Track IDs must be unique.');
    trackIds.add(track.id);
    assertFiniteRange(track.volume, 0, 2, 'Track volume');
    assertFiniteRange(track.pan, -1, 1, 'Track pan');
    for (const clip of track.clips) {
      clipCount += 1;
      if (clipIds.has(clip.id)) throw new Error('Clip IDs must be unique.');
      clipIds.add(clip.id);
      const asset = state.assets[clip.assetId];
      if (!asset) throw new Error('A clip references a missing audio asset.');
      validateClip(clip, asset);
    }
  }
  if (clipCount > MAX_MULTITRACK_CLIPS) {
    throw new Error(`A project supports at most ${MAX_MULTITRACK_CLIPS} clips.`);
  }
}

export function validateDuckingSettings(settings: AutoDuckingSettings): void {
  assertFiniteRange(settings.thresholdDb, -60, 0, 'Ducking threshold');
  assertFiniteRange(settings.reductionDb, -36, 0, 'Ducking reduction');
  assertFiniteRange(settings.attackSeconds, 0.001, 1, 'Ducking attack');
  assertFiniteRange(settings.releaseSeconds, 0.01, 5, 'Ducking release');
}

