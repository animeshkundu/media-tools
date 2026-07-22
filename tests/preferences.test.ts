import { describe, expect, it } from 'vitest';
import {
  APP_PREFERENCES_STORAGE_KEY,
  loadAppPreferences,
  saveAppPreferences,
  type AppPreferences,
  type PreferenceStorage,
} from '../entrypoints/app/preferences';

class MemoryStorage implements PreferenceStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('app preferences', () => {
  it('round-trips only versioned durable settings', () => {
    const storage = new MemoryStorage();
    const preferences: AppPreferences = {
      formats: {
        convert: 'mp3',
        cut: 'mp3',
        join: 'wav',
        speed: 'mp3',
      },
      speedFactor: 1.75,
      tool: 'speed',
    };

    expect(saveAppPreferences(preferences, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(APP_PREFERENCES_STORAGE_KEY)!)).toEqual({
      formats: preferences.formats,
      speedFactor: 1.75,
      tool: 'speed',
      version: 1,
    });
    expect(loadAppPreferences(storage)).toEqual(preferences);
  });

  it('validates each restored field and falls back without discarding valid siblings', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        formats: {
          convert: null,
          cut: 'flac',
          join: 'mp3',
          speed: 'wav',
        },
        speedFactor: 4.01,
        tool: 'unknown',
        version: 1,
      }),
    );

    expect(loadAppPreferences(storage)).toEqual({
      formats: {
        convert: 'wav',
        cut: 'wav',
        join: 'mp3',
        speed: 'wav',
      },
      speedFactor: 1,
      tool: 'cut',
    });
  });

  it('accepts speed bounds and rejects non-finite or non-numeric factors', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        formats: {
          convert: 'wav',
          cut: 'wav',
          join: 'wav',
          speed: 'mp3',
        },
        speedFactor: 0.25,
        tool: 'convert',
        version: 1,
      }),
    );
    expect(loadAppPreferences(storage).speedFactor).toBe(0.25);

    storage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        formats: {
          convert: 'wav',
          cut: 'wav',
          join: 'wav',
          speed: 'mp3',
        },
        speedFactor: '2',
        tool: 'convert',
        version: 1,
      }),
    );
    expect(loadAppPreferences(storage).speedFactor).toBe(1);

    storage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      '{"formats":{"convert":"wav","cut":"wav","join":"wav","speed":"mp3"},' +
        '"speedFactor":1e400,"tool":"convert","version":1}',
    );
    expect(loadAppPreferences(storage).speedFactor).toBe(1);
  });

  it('uses defaults for absent, malformed, or unsupported stored data', () => {
    const defaults = {
      formats: {
        convert: 'wav',
        cut: 'wav',
        join: 'wav',
        speed: 'wav',
      },
      speedFactor: 1,
      tool: 'cut',
    };
    const storage = new MemoryStorage();

    expect(loadAppPreferences(storage)).toEqual(defaults);
    storage.setItem(APP_PREFERENCES_STORAGE_KEY, '{not-json');
    expect(loadAppPreferences(storage)).toEqual(defaults);
    storage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ formats: {}, speedFactor: 2, tool: 'speed', version: 2 }),
    );
    expect(loadAppPreferences(storage)).toEqual(defaults);
    expect(loadAppPreferences(null)).toEqual(defaults);
  });

  it('does not throw when storage reads or writes are unavailable', () => {
    const readFailure: PreferenceStorage = {
      getItem() {
        throw new Error('Storage access denied');
      },
      setItem() {
        throw new Error('Storage access denied');
      },
    };
    const defaults = loadAppPreferences(null);

    expect(loadAppPreferences(readFailure)).toEqual(defaults);
    expect(saveAppPreferences(defaults, readFailure)).toBe(false);
    expect(saveAppPreferences(defaults, null)).toBe(false);
  });
});
