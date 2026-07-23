import {
  MAX_MULTITRACK_CLIPS,
  MAX_MULTITRACK_DURATION_SECONDS,
  type AudioClip,
  type AudioClipId,
  type AudioTrackId,
  type TimelineState,
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
  if (!Number.isFinite(requestedStart)) throw new Error('Clip start time must be finite.');
  const points = state.snapEnabled ? collectSnapPoints(state, clipId) : [];
  return updateClip(state, trackId, clipId, (clip) => {
    const maximumStart = MAX_MULTITRACK_DURATION_SECONDS - clip.duration;
    const candidate = Math.max(0, Math.min(maximumStart, requestedStart));
    const snapped = state.snapEnabled
      ? snapTime(candidate, points, state.viewport.pixelsPerSecond).time
      : candidate;
    return { ...clip, startTime: Math.min(maximumStart, snapped) };
  });
}

export function trimClipStart(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  requestedStart: number,
): TimelineState {
  const points = state.snapEnabled ? collectSnapPoints(state, clipId) : [];
  return updateClip(state, trackId, clipId, (clip) => {
    const minimumStart = Math.max(
      0,
      clip.startTime - clip.trimStart / clip.playbackRate,
    );
    const maximumStart = clip.startTime + clip.duration - MIN_CLIP_DURATION_SECONDS;
    const candidate = Math.max(
      minimumStart,
      Math.min(maximumStart, requestedStart),
    );
    const snappedStart = state.snapEnabled
      ? snapTime(candidate, points, state.viewport.pixelsPerSecond).time
      : candidate;
    const nextStart = Math.max(minimumStart, Math.min(maximumStart, snappedStart));
    const delta = nextStart - clip.startTime;
    const duration = clip.duration - delta;
    return {
      ...clip,
      startTime: clip.startTime + delta,
      trimStart: clip.trimStart + delta * clip.playbackRate,
      duration,
      ...fitFades(clip.fadeIn, clip.fadeOut, duration),
    };
  });
}

export type KeyboardClipEdit = 'move' | 'trim-start' | 'trim-end';

export function nudgeClipWithKeyboard(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  direction: -1 | 1,
  increment: number,
  edit: KeyboardClipEdit,
): TimelineState {
  if (!Number.isFinite(increment) || increment <= 0) {
    throw new Error('Keyboard clip increments must be positive and finite.');
  }
  const clip = state.tracks
    .find((track) => track.id === trackId)
    ?.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return state;
  const delta = direction * increment;
  if (edit === 'trim-start') {
    return trimClipStart(state, trackId, clipId, clip.startTime + delta);
  }
  if (edit === 'trim-end') {
    return trimClipEnd(
      state,
      trackId,
      clipId,
      clip.startTime + clip.duration + delta,
    );
  }
  return moveClip(state, trackId, clipId, clip.startTime + delta);
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
    const maximumEnd = Math.min(
      MAX_MULTITRACK_DURATION_SECONDS,
      clip.startTime + (asset.duration - clip.trimStart) / clip.playbackRate,
    );
    const candidate = Math.max(
      clip.startTime + MIN_CLIP_DURATION_SECONDS,
      Math.min(maximumEnd, requestedEnd),
    );
    const nextEnd = state.snapEnabled
      ? snapTime(candidate, points, state.viewport.pixelsPerSecond).time
      : candidate;
    const boundedEnd = Math.min(maximumEnd, nextEnd);
    const duration = Math.max(
      MIN_CLIP_DURATION_SECONDS,
      Math.min(
        (asset.duration - clip.trimStart) / clip.playbackRate,
        boundedEnd - clip.startTime,
      ),
    );
    return {
      ...clip,
      duration,
      ...fitFades(clip.fadeIn, clip.fadeOut, duration),
    };
  });
}

export function changeClipSpeed(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  playbackRate: number,
): TimelineState {
  if (!Number.isFinite(playbackRate) || playbackRate < 0.25 || playbackRate > 4) {
    throw new Error('Clip speed must be between 0.25x and 4x.');
  }
  return updateClip(state, trackId, clipId, (clip) => {
    const duration = (clip.duration * clip.playbackRate) / playbackRate;
    if (clip.startTime + duration > MAX_MULTITRACK_DURATION_SECONDS) {
      throw new Error('This speed would extend the clip beyond the 30 minute project limit.');
    }
    return {
      ...clip,
      playbackRate,
      duration,
      ...fitFades(clip.fadeIn, clip.fadeOut, duration),
    };
  });
}

export function removeClip(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
): TimelineState {
  return {
    ...state,
    tracks: state.tracks.map((track) =>
      track.id === trackId
        ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }
        : track,
    ),
    selection: { trackId },
  };
}

export function splitClip(
  state: TimelineState,
  trackId: AudioTrackId,
  clipId: AudioClipId,
  splitTime: number,
  newClipId: AudioClipId,
): TimelineState {
  if (!newClipId) throw new Error('The split clip ID is missing.');
  const clipCount = state.tracks.reduce(
    (count, track) => count + track.clips.length,
    0,
  );
  if (clipCount >= MAX_MULTITRACK_CLIPS) {
    throw new Error(`A project supports at most ${MAX_MULTITRACK_CLIPS} clips.`);
  }
  if (state.tracks.some((track) => track.clips.some((clip) => clip.id === newClipId))) {
    throw new Error('The split clip ID must be unique.');
  }
  const sourceTrack = state.tracks.find((track) => track.id === trackId);
  const sourceClip = sourceTrack?.clips.find((clip) => clip.id === clipId);
  if (!sourceClip) throw new Error('Select a clip before splitting.');
  const firstDuration = splitTime - sourceClip.startTime;
  const secondDuration = sourceClip.duration - firstDuration;
  if (
    firstDuration < MIN_CLIP_DURATION_SECONDS ||
    secondDuration < MIN_CLIP_DURATION_SECONDS
  ) {
    throw new Error('Move the playhead inside the clip before splitting.');
  }
  const firstFades = fitFades(sourceClip.fadeIn, 0, firstDuration);
  const secondFades = fitFades(0, sourceClip.fadeOut, secondDuration);
  const secondClip: AudioClip = {
    ...sourceClip,
    id: newClipId,
    startTime: splitTime,
    trimStart: sourceClip.trimStart + firstDuration * sourceClip.playbackRate,
    duration: secondDuration,
    ...secondFades,
  };
  return {
    ...state,
    tracks: state.tracks.map((track) =>
      track.id === trackId
        ? {
            ...track,
            clips: track.clips.flatMap((clip) =>
              clip.id === clipId
                ? [{ ...clip, duration: firstDuration, ...firstFades }, secondClip]
                : [clip],
            ),
          }
        : track,
    ),
    selection: { trackId, clipId: newClipId },
  };
}
