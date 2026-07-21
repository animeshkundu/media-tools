import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildShareMarkdown,
  copyText,
  createWaveformThumbnail,
  PRODUCT_URL,
  sampleWaveform,
} from '../lib/core/share';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('share helpers', () => {
  it('builds local-only markdown and escapes formatting in result text', () => {
    expect(buildShareMarkdown('Audio *cut*', 'Exported [WAV] with `trim`.')).toBe(
      "**Audio \\*cut\\***\n\nExported \\[WAV\\] with \\`trim\\`.\n\n[Try Media Tools](" +
        PRODUCT_URL +
        ')',
    );
  });

  it('samples multiple buffers into a small normalized waveform', () => {
    const peaks = sampleWaveform(
      [
        new Float32Array([0, 0.25, -0.5, 0]),
        new Float32Array([0, 1, -0.75, 0]),
      ],
      8,
    );

    expect(peaks).toHaveLength(8);
    expect(Math.max(...peaks)).toBe(1);
    expect(Array.from(peaks).every((peak) => peak >= 0 && peak <= 1)).toBe(true);
    expect(sampleWaveform([], 3)).toEqual(new Float32Array(3));
  });

  it('creates a PNG waveform thumbnail locally when canvas is available', () => {
    const context = {
      beginPath: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
      lineTo: vi.fn(),
      lineWidth: 0,
      moveTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
    };
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      toDataURL: vi.fn(() => 'data:image/png;base64,local-preview'),
      width: 0,
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => canvas),
    });

    expect(createWaveformThumbnail([new Float32Array([0, 1, 0, -1])])).toBe(
      'data:image/png;base64,local-preview',
    );
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(200);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('uses navigator.clipboard from a user action when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyText(PRODUCT_URL);

    expect(writeText).toHaveBeenCalledWith(PRODUCT_URL);
  });

  it('falls back to execCommand when Clipboard API writing is rejected', async () => {
    const textarea = {
      focus: vi.fn(),
      remove: vi.fn(),
      select: vi.fn(),
      setAttribute: vi.fn(),
      setSelectionRange: vi.fn(),
      style: {},
      value: '',
    };
    const append = vi.fn();
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Not allowed')) },
    });
    vi.stubGlobal('document', {
      body: { append },
      createElement: vi.fn(() => textarea),
      execCommand,
    });

    await copyText('local result');

    expect(textarea.value).toBe('local result');
    expect(append).toHaveBeenCalledWith(textarea);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalled();
  });

  it('reports clipboard failure when neither copy path succeeds', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {
      body: undefined,
      execCommand: vi.fn(),
    });

    await expect(copyText('local result')).rejects.toThrow(
      'Clipboard access is unavailable in this browser.',
    );
  });
});
