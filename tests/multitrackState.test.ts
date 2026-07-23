import { describe, expect, it } from 'vitest';
import {
  createEmptyTimeline,
  MAX_MULTITRACK_ASSETS,
  MAX_MULTITRACK_CLIPS,
  MAX_MULTITRACK_DURATION_SECONDS,
  validateTimelineState,
  type AudioAsset,
  type AudioClip,
  type TimelineState,
} from '../lib/tools/multitrack/schema';
import {
  collectSnapPoints,
  changeClipSpeed,
  moveClip,
  nudgeClipWithKeyboard,
  projectDuration,
  removeClip,
  snapTime,
  splitClip,
  trimClipEnd,
  trimClipStart,
} from '../lib/tools/multitrack/timeline';
import {
  fadeAutomationMethod,
  scheduledClipWindow,
  scheduledFadeInRampEnd,
  timelineGraphTopologyChanged,
} from '../lib/tools/multitrack/engine';

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
  playbackRate: 1,
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

  it('validates slow clips in timeline units and bounds retained media assets', () => {
    const state = populatedTimeline();
    const slow: TimelineState = {
      ...state,
      tracks: state.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              clips: [
                {
                  ...clip,
                  startTime: 0,
                  trimStart: 0,
                  duration: 8,
                  playbackRate: 0.5,
                },
              ],
            }
          : track,
      ),
    };
    expect(() => validateTimelineState(slow)).not.toThrow();

    const tooManyAssets: TimelineState = {
      ...createEmptyTimeline(),
      assets: Object.fromEntries(
        Array.from({ length: MAX_MULTITRACK_ASSETS + 1 }, (_, index) => [
          `asset-${index}`,
          { ...asset, id: `asset-${index}`, name: `asset-${index}.wav` },
        ]),
      ),
    };
    expect(() => validateTimelineState(tooManyAssets)).toThrow(
      `at most ${MAX_MULTITRACK_ASSETS} media assets`,
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

    const movedToLimit = moveClip(
      { ...state, snapEnabled: false },
      'track-dialogue',
      clip.id,
      MAX_MULTITRACK_DURATION_SECONDS,
    );
    expect(movedToLimit.tracks[0]?.clips[0]?.startTime).toBe(
      MAX_MULTITRACK_DURATION_SECONDS - clip.duration,
    );
    expect(() => validateTimelineState(movedToLimit)).not.toThrow();

    const nearLimit: TimelineState = {
      ...state,
      snapEnabled: false,
      tracks: state.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              clips: [{
                ...clip,
                startTime: MAX_MULTITRACK_DURATION_SECONDS - 1,
                duration: 0.5,
              }],
            }
          : track,
      ),
    };
    const extendedToLimit = trimClipEnd(
      nearLimit,
      'track-dialogue',
      clip.id,
      MAX_MULTITRACK_DURATION_SECONDS + 10,
    );
    expect(extendedToLimit.tracks[0]?.clips[0]?.duration).toBe(1);
    expect(() => validateTimelineState(extendedToLimit)).not.toThrow();
  });

  it('extends slow clips with source-correct trim math and keyboard boundary nudges', () => {
    const state = populatedTimeline();
    const slow: TimelineState = {
      ...state,
      snapEnabled: false,
      tracks: state.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              clips: [
                {
                  ...clip,
                  trimStart: 0.5,
                  duration: 4,
                  playbackRate: 0.5,
                },
              ],
            }
          : track,
      ),
    };

    const extended = trimClipStart(slow, 'track-dialogue', clip.id, 0);
    expect(extended.tracks[0]?.clips[0]).toMatchObject({
      startTime: 0,
      trimStart: 0,
      duration: 5,
    });
    expect(() => validateTimelineState(extended)).not.toThrow();

    const startNudged = nudgeClipWithKeyboard(
      slow,
      'track-dialogue',
      clip.id,
      -1,
      1,
      'trim-start',
    );
    expect(startNudged.tracks[0]?.clips[0]?.trimStart).toBe(0);
    const endNudged = nudgeClipWithKeyboard(
      slow,
      'track-dialogue',
      clip.id,
      -1,
      0.25,
      'trim-end',
    );
    expect(endNudged.tracks[0]?.clips[0]?.duration).toBe(3.75);
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
    expect(
      timelineGraphTopologyChanged(
        state,
        changeClipSpeed(state, 'track-dialogue', clip.id, 2),
      ),
    ).toBe(true);
    const eqChanged = {
      ...state,
      tracks: state.tracks.map((track, index) =>
        index === 0 ? { ...track, eqPreset: 'bright' as const } : track,
      ),
    };
    expect(timelineGraphTopologyChanged(state, eqChanged)).toBe(true);
  });

  it('changes speed, splits source offsets, and removes clips without touching the asset', () => {
    const state = populatedTimeline();
    const spedUp = changeClipSpeed(state, 'track-dialogue', clip.id, 2);
    expect(spedUp.tracks[0]?.clips[0]).toMatchObject({
      duration: 1,
      playbackRate: 2,
      trimStart: 0.5,
    });

    const split = splitClip(spedUp, 'track-dialogue', clip.id, 1.4, 'clip-2');
    expect(split.tracks[0]?.clips).toEqual([
      expect.objectContaining({ id: clip.id, fadeOut: 0 }),
      expect.objectContaining({
        id: 'clip-2',
        startTime: 1.4,
        playbackRate: 2,
        fadeIn: 0,
      }),
    ]);
    expect(split.tracks[0]?.clips[0]?.duration).toBeCloseTo(0.4);
    expect(split.tracks[0]?.clips[1]?.duration).toBeCloseTo(0.6);
    expect(split.tracks[0]?.clips[1]?.trimStart).toBeCloseTo(1.3);
    expect(split.assets[asset.id]).toBe(asset);

    const removed = removeClip(split, 'track-dialogue', 'clip-2');
    expect(removed.tracks[0]?.clips).toHaveLength(1);
    expect(removed.assets[asset.id]).toBe(asset);
  });

  it('keeps skim scheduling inside its preview window and matches fade automation', () => {
    expect(scheduledClipWindow({ ...clip, startTime: 10 }, 0, 0.08)).toBeUndefined();
    const window = scheduledClipWindow({ ...clip, startTime: 1.04 }, 1, 0.08);
    expect(window?.clipLocalTime).toBe(0);
    expect(window?.duration).toBeCloseTo(0.04);
    expect(window?.timelineDelay).toBeCloseTo(0.04);
    expect(fadeAutomationMethod('linear')).toBe('linear');
    expect(fadeAutomationMethod('logarithmic')).toBe('exponential');
    expect(
      scheduledFadeInRampEnd(
        { ...clip, fadeCurve: 'linear', fadeIn: 1 },
        0.2,
        0.28,
      ),
    ).toBeCloseTo(0.28);
  });

  it('rejects splitting when the project is already at the clip limit', () => {
    const state = populatedTimeline();
    const clips = Array.from({ length: MAX_MULTITRACK_CLIPS }, (_, index) => ({
      ...clip,
      id: `clip-${index}`,
    }));
    const full: TimelineState = {
      ...state,
      tracks: state.tracks.map((track, index) =>
        index === 0 ? { ...track, clips } : track,
      ),
    };
    expect(() => validateTimelineState(full)).not.toThrow();
    expect(() =>
      splitClip(full, 'track-dialogue', clips[0]!.id, 2, 'overflow-clip'),
    ).toThrow(`at most ${MAX_MULTITRACK_CLIPS} clips`);
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

    const split = splitClip(faded, 'track-dialogue', clip.id, 1.5, 'fade-split');
    expect(split.tracks[0]?.clips[0]).toMatchObject({
      duration: 0.5,
      fadeIn: 0.5,
      fadeOut: 0,
    });
    expect(split.tracks[0]?.clips[1]).toMatchObject({
      duration: 1.5,
      fadeIn: 0,
      fadeOut: 1,
    });
    expect(() => validateTimelineState(split)).not.toThrow();
  });
});
