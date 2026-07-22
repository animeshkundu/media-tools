import type { EncodeFormat } from '../../lib/core/worker';
import {
  MAX_SPEED_FACTOR,
  MIN_SPEED_FACTOR,
} from '../../lib/tools/change-speed/changeSpeed';

export const APP_PREFERENCES_STORAGE_KEY = 'media-tools:preferences';

const APP_PREFERENCES_VERSION = 1;
const TOOLS = ['cut', 'join', 'speed', 'convert'] as const;

export type Tool = (typeof TOOLS)[number];

export type AppPreferences = {
  formats: Record<Tool, EncodeFormat>;
  speedFactor: number;
  tool: Tool;
};

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultPreferences(): AppPreferences {
  return {
    formats: {
      convert: 'wav',
      cut: 'wav',
      join: 'wav',
      speed: 'wav',
    },
    speedFactor: 1,
    tool: 'cut',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTool(value: unknown): value is Tool {
  return typeof value === 'string' && TOOLS.some((tool) => tool === value);
}

function isEncodeFormat(value: unknown): value is EncodeFormat {
  return value === 'wav' || value === 'mp3';
}

function isSpeedFactor(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_SPEED_FACTOR &&
    value <= MAX_SPEED_FACTOR
  );
}

function normalizePreferences(value: unknown): AppPreferences {
  const defaults = defaultPreferences();
  if (!isRecord(value) || value.version !== APP_PREFERENCES_VERSION) {
    return defaults;
  }
  const formats = isRecord(value.formats) ? value.formats : {};

  return {
    formats: {
      convert: isEncodeFormat(formats.convert) ? formats.convert : defaults.formats.convert,
      cut: isEncodeFormat(formats.cut) ? formats.cut : defaults.formats.cut,
      join: isEncodeFormat(formats.join) ? formats.join : defaults.formats.join,
      speed: isEncodeFormat(formats.speed) ? formats.speed : defaults.formats.speed,
    },
    speedFactor: isSpeedFactor(value.speedFactor) ? value.speedFactor : defaults.speedFactor,
    tool: isTool(value.tool) ? value.tool : defaults.tool,
  };
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadAppPreferences(
  storage: PreferenceStorage | null = browserStorage(),
): AppPreferences {
  if (!storage) return defaultPreferences();

  try {
    const stored = storage.getItem(APP_PREFERENCES_STORAGE_KEY);
    return stored === null ? defaultPreferences() : normalizePreferences(JSON.parse(stored));
  } catch {
    return defaultPreferences();
  }
}

export function saveAppPreferences(
  preferences: AppPreferences,
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;

  const normalized = normalizePreferences({
    ...preferences,
    version: APP_PREFERENCES_VERSION,
  });

  try {
    storage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...normalized,
        version: APP_PREFERENCES_VERSION,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
