export const DEFAULT_LIBRARY_PANE_PERCENT = 34;
export const MIN_LIBRARY_PANE_PERCENT = 24;
export const MAX_LIBRARY_PANE_PERCENT = 48;

export const DEFAULT_TIMELINE_PANE_HEIGHT = 330;
export const MIN_TIMELINE_PANE_HEIGHT = 280;
export const MAX_TIMELINE_PANE_HEIGHT = 560;

const RESERVED_WORKSPACE_HEIGHT = 420;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampLibraryPanePercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIBRARY_PANE_PERCENT;
  return clamp(value, MIN_LIBRARY_PANE_PERCENT, MAX_LIBRARY_PANE_PERCENT);
}

export function resizeLibraryPane(
  startPercent: number,
  deltaPixels: number,
  containerWidth: number,
): number {
  if (!Number.isFinite(deltaPixels) || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return clampLibraryPanePercent(startPercent);
  }
  return clampLibraryPanePercent(startPercent + (deltaPixels / containerWidth) * 100);
}

export function maximumTimelinePaneHeight(workspaceHeight: number): number {
  if (!Number.isFinite(workspaceHeight) || workspaceHeight <= 0) {
    return MAX_TIMELINE_PANE_HEIGHT;
  }
  return clamp(
    workspaceHeight - RESERVED_WORKSPACE_HEIGHT,
    MIN_TIMELINE_PANE_HEIGHT,
    MAX_TIMELINE_PANE_HEIGHT,
  );
}

export function resizeTimelinePane(
  startHeight: number,
  deltaPixels: number,
  workspaceHeight: number,
): number {
  const maximum = maximumTimelinePaneHeight(workspaceHeight);
  const safeStart = Number.isFinite(startHeight) ? startHeight : DEFAULT_TIMELINE_PANE_HEIGHT;
  if (!Number.isFinite(deltaPixels)) return clamp(safeStart, MIN_TIMELINE_PANE_HEIGHT, maximum);
  return clamp(safeStart - deltaPixels, MIN_TIMELINE_PANE_HEIGHT, maximum);
}
