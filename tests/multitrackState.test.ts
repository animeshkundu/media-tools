import { describe, expect, it } from 'vitest';
import {
  createEmptyTimeline,
  validateTimelineState,
  type AudioAsset,
  type AudioClip,
  type TimelineState,
} from '../lib/tools/multitrack/schema';
import {
  collectSnapPoints,
  moveClip,
  projectDuration,
  snapTime,
  trimClipEnd,
  trimClipStart,
} from '../lib/tools/multitrack/timeline';
import { timelineGraphTopologyChanged } from '../lib/tools/multitrack/engine';

const asset: AudioAsset = {
  id: 'asset-1',
  name: 'dialogue.wav',
  mimeType: 'audio/wav',
  byteLength: 1_024,
  duration: 4,
  sampleRate: 48_000,
  channels: 1,
  source: { kind: 'opfs', path: 'assets/asset-1' },
};

const clip: AudioClip = {
  id: 'clip-1',
  assetId: asset.id,
  startTime: 1,
  trimStart: 0.5,
  duration: 2,
  gain: 1,
  fadeIn: 0.1,
  fadeOut: 0.1,
  fadeCurve: 'logarithmic',
};

function populatedTimeline(): TimelineState {
  const state = createEmptyTimeline('Podcast mix');
  return {
    ...state,
    assets: { [asset.id]: asset },
    tracks: state.tracks.map((track, index) =>
      index === 0 ? { ...track, clips: [clip] } : track,
    ),
    viewport: { startTime: 0, pixelsPerSecond: 100 },
  };
}

describe('multitrack non-destructive state', () => {
  it('round-trips as JSON and validates source-relative clip offsets', () => {
    const state = populatedTimeline();
    const restored = JSON.parse(JSON.stringify(state)) as TimelineState;

    expect(() => validateTimelineState(restored)).not.toThrow();
    expect(restored.assets['asset-1']?.source).toEqual({
      kind: 'opfs',
      path: 'assets/asset-1',
    });
    expect(projectDuration(restored)).toBe(3);
  });

  it('rejects a clip that extends beyond its immutable source asset', () => {
    const state = populatedTimeline();
    const invalid: TimelineState = {
      ...state,
      tracks: state.tracks.map((track, index) =>
        index === 0
          ? { ...track, clips: [{ ...clip, trimStart: 3.5, duration: 1 }] }
          : track,
      ),
    };

    expect(() => validateTimelineState(invalid)).toThrow(
      'Clip trim extends beyond its immutable source asset.',
    );
  });

  it('snaps moves and boundary edits without mutating the source state', () => {
    const state = populatedTimeline();
    const points = collectSnapPoints(state, clip.id);
    expect(snapTime(1.04, [1], 100)).toEqual({ time: 1, target: 1 });
    expect(points).toContain(0.5);

    const moved = moveClip(state, 'track-dialogue', clip.id, 0.54);
    expect(moved.tracks[0]?.clips[0]?.startTime).toBe(0.5);
    expect(state.tracks[0]?.clips[0]?.startTime).toBe(1);

    const leftTrimmed = trimClipStart(state, 'track-dialogue', clip.id, 1.25);
    expect(leftTrimmed.tracks[0]?.clips[0]).toMatchObject({
      startTime: 1.25,
      trimStart: 0.75,
      duration: 1.75,
    });

    const rightTrimmed = trimClipEnd(state, 'track-dialogue', clip.id, 2.5);
    expect(rightTrimmed.tracks[0]?.clips[0]?.duration).toBe(1.5);
  });

  it('distinguishes live mixer updates from graph topology edits', () => {
    const state = populatedTimeline();
    const mixerUpdate = {
      ...state,
      masterGain: 0.8,
      tracks: state.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              volume: 0.7,
              pan: -0.25,
              muted: true,
              clips: track.clips.map((current) => ({ ...current, gain: 0.5, fadeIn: 0.2 })),
            }
          : track,
      ),
    };
    expect(timelineGraphTopologyChanged(state, mixerUpdate)).toBe(false);

    const moved = moveClip(state, 'track-dialogue', clip.id, 2);
    expect(timelineGraphTopologyChanged(state, moved)).toBe(true);
    const eqChanged = {
      ...state,
      tracks: state.tracks.map((track, index) =>
        index === 0 ? { ...track, eqPreset: 'bright' as const } : track,
      ),
    };
    expect(timelineGraphTopologyChanged(state, eqChanged)).toBe(true);
  });

  it('fails safe instead of looping when unvalidated tempo reaches snap collection', () => {
    const state = populatedTimeline();
    const points = collectSnapPoints({ ...state, tempo: 0 }, clip.id);
    expect(points).toContain(0);
    expect(points).toContain(state.playhead);
  });

  it('scales overlapping fades when a boundary trim shortens a clip', () => {
    const state = populatedTimeline();
    const faded = {
      ...state,
      tracks: state.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              clips: track.clips.map((current) => ({
                ...current,
                fadeIn: 1,
                fadeOut: 1,
              })),
            }
          : track,
      ),
    };
    const trimmed = trimClipEnd(faded, 'track-dialogue', clip.id, 1.5);
    expect(trimmed.tracks[0]?.clips[0]).toMatchObject({
      duration: 0.5,
      fadeIn: 0.25,
      fadeOut: 0.25,
    });
    expect(() => validateTimelineState(trimmed)).not.toThrow();
  });
});
