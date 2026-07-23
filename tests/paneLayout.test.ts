import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARY_PANE_PERCENT,
  DEFAULT_TIMELINE_PANE_HEIGHT,
  MAX_LIBRARY_PANE_PERCENT,
  MAX_TIMELINE_PANE_HEIGHT,
  MIN_LIBRARY_PANE_PERCENT,
  MIN_TIMELINE_PANE_HEIGHT,
  maximumTimelinePaneHeight,
  resizeLibraryPane,
  resizeTimelinePane,
} from '../lib/tools/multitrack/paneLayout';

describe('adjustable Audio Studio panes', () => {
  it('resizes the media library proportionally and enforces useful desktop bounds', () => {
    expect(resizeLibraryPane(DEFAULT_LIBRARY_PANE_PERCENT, 120, 1_200)).toBe(44);
    expect(resizeLibraryPane(DEFAULT_LIBRARY_PANE_PERCENT, -1_000, 1_200)).toBe(
      MIN_LIBRARY_PANE_PERCENT,
    );
    expect(resizeLibraryPane(DEFAULT_LIBRARY_PANE_PERCENT, 1_000, 1_200)).toBe(
      MAX_LIBRARY_PANE_PERCENT,
    );
  });

  it('fails safely when pointer geometry is unavailable', () => {
    expect(resizeLibraryPane(Number.NaN, 20, 0)).toBe(DEFAULT_LIBRARY_PANE_PERCENT);
    expect(
      resizeTimelinePane(Number.NaN, Number.NaN, Number.NaN),
    ).toBe(DEFAULT_TIMELINE_PANE_HEIGHT);
  });

  it('resizes the timeline from its top edge while reserving inspector space', () => {
    expect(resizeTimelinePane(DEFAULT_TIMELINE_PANE_HEIGHT, -80, 1_000)).toBe(410);
    expect(resizeTimelinePane(DEFAULT_TIMELINE_PANE_HEIGHT, 500, 1_000)).toBe(
      MIN_TIMELINE_PANE_HEIGHT,
    );
    expect(resizeTimelinePane(DEFAULT_TIMELINE_PANE_HEIGHT, -1_000, 1_400)).toBe(
      MAX_TIMELINE_PANE_HEIGHT,
    );
    expect(maximumTimelinePaneHeight(760)).toBe(340);
  });
});
