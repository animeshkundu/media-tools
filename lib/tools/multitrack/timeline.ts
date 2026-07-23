import type {
  AudioClip,
  AudioClipId,
  AudioTrackId,
  TimelineState,
} from './schema';

export const MIN_CLIP_DURATION_SECONDS = 0.05;
export const SNAP_DISTANCE_PIXELS = 10;

export type SnapResult = {
  readonly time: number;
  readonly target?: number;
};

function fitFades(
  fadeIn: number,
  fadeOut: number,
  duration: number,
): Pick<AudioClip, 'fadeIn' | 'fadeOut'> {
  const total = fadeIn + fadeOut;
  if (total <= duration || total === 0) return { fadeIn, fadeOut };
  const scale = duration / total;
  return { fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
}

export function projectDuration(state: TimelineState): number {
  let end = 0;
  for (const track of state.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.startTime + clip.duration);
  }
  return end;
}

export function collectSnapPoints(
  state: TimelineState,
  excludedClipId?: AudioClipId,
): readonly number[] {
  const points = new Set<number>([0, state.playhead]);
  const beatSeconds = 60 / state.tempo;
  const duration = Math.max(projectDuration(state), state.playhead);
  if (Number.isFinite(beatSeconds) && beatSeconds > 0) {
    for (let time = 0; time <= duration + beatSeconds; time += beatSeconds) {
      points.add(Number(time.toFixed(9)));
    }
  }
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludedClipId) continue;
      points.add(clip.startTime);
      points.add(clip.startTime + clip.duration);
    }
  }
  return [...points].sort((left, right) => left - right);
}

export function snapTime(
  candidate: number,
  points: readonly number[],
  pixelsPerSecond: number,
): SnapResult {
  const threshold = SNAP_DISTANCE_PIXELS / pixelsPerSecond;
  let nearest: number | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(candidate - point);
    if (nextDistance < distance) {
      nearest = point;
      distance = nextDistance;
    }
  }
  return nearest !== undefined && distance <= threshold
    ? { time: nearest, target: nearest }
    : { time: Math.max(0, candidate) };
}

function updateClip(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  transform: (clip: AudioClip) => AudioClip,
): TimelineState {
  return {
    ...state,
    tracks: state.tracks.map((track) =>
      track.id === trackId
        ? {
            ...track,
            clips: track.clips.map((clip) => (clip.id === clipId ? transform(clip) : clip)),
          }
        : track,
    ),
  };
}

export function moveClip(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  requestedStart: number,
): TimelineState {
  const points = state.snapEnabled ? collectSnapPoints(state, clipId) : [];
  const snapped = state.snapEnabled
    ? snapTime(requestedStart, points, state.viewport.pixelsPerSecond).time
    : Math.max(0, requestedStart);
  return updateClip(state, trackId, clipId, (clip) => ({ ...clip, startTime: snapped }));
}

export function trimClipStart(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  requestedStart: number,
): TimelineState {
  const points = state.snapEnabled ? collectSnapPoints(state, clipId) : [];
  return updateClip(state, trackId, clipId, (clip) => {
    const maximumStart = clip.startTime + clip.duration - MIN_CLIP_DURATION_SECONDS;
    const candidate = Math.max(
      clip.startTime - clip.trimStart,
      Math.min(maximumStart, requestedStart),
    );
    const nextStart = state.snapEnabled
      ? snapTime(candidate, points, state.viewport.pixelsPerSecond).time
      : candidate;
    const delta = Math.max(
      -clip.trimStart,
      Math.min(clip.duration - MIN_CLIP_DURATION_SECONDS, nextStart - clip.startTime),
    );
    const duration = clip.duration - delta;
    return {
      ...clip,
      startTime: clip.startTime + delta,
      trimStart: clip.trimStart + delta,
      duration,
      ...fitFades(clip.fadeIn, clip.fadeOut, duration),
    };
  });
}

export function trimClipEnd(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  requestedEnd: number,
): TimelineState {
  const points = state.snapEnabled ? collectSnapPoints(state, clipId) : [];
  return updateClip(state, trackId, clipId, (clip) => {
    const asset = state.assets[clip.assetId]!;
    const maximumEnd = clip.startTime + asset.duration - clip.trimStart;
    const candidate = Math.max(
      clip.startTime + MIN_CLIP_DURATION_SECONDS,
      Math.min(maximumEnd, requestedEnd),
    );
    const nextEnd = state.snapEnabled
      ? snapTime(candidate, points, state.viewport.pixelsPerSecond).time
      : candidate;
    const duration = Math.max(
      MIN_CLIP_DURATION_SECONDS,
      Math.min(asset.duration - clip.trimStart, nextEnd - clip.startTime),
    );
    return {
      ...clip,
      duration,
      ...fitFades(clip.fadeIn, clip.fadeOut, duration),
    };
  });
}
