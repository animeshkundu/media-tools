import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startEncode } = vi.hoisted(() => ({
  startEncode: vi.fn(() => ({
    cancel: vi.fn(),
    result: Promise.resolve(new Blob()),
  })),
}));

vi.mock('../lib/core/worker', () => ({ startEncode, MAX_PCM_ENCODE_BYTES: 256 * 1024 * 1024 }));

import {
  MAX_SPEED_FACTOR,
  MIN_SPEED_FACTOR,
  changeSpeed,
  clampSpeedFactor,
  startChangeSpeedEncode,
} from '../lib/tools/change-speed/changeSpeed';

describe('change-speed', () => {
  beforeEach(() => {
    startEncode.mockClear();
  });

  it('returns an independent identity copy at 1x', () => {
    const input = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const output = changeSpeed({ channelData: [input], sampleRate: 48_000 }, 1);

    expect(output.sampleRate).toBe(48_000);
    expect(output.channelData[0]).toEqual(input);
    expect(output.channelData[0]).not.toBe(input);
  });

  it.each([
    [0.5, 16],
    [1, 8],
    [2, 4],
  ])('uses input length divided by %s× as the output length', (factor, expectedLength) => {
    const output = changeSpeed({ channelData: [new Float32Array(8)], sampleRate: 8_000 }, factor);

    expect(output.channelData[0]).toHaveLength(expectedLength);
    const durationError = Math.abs(output.channelData[0].length / output.sampleRate - 8 / 8_000 / factor);
    expect(durationError).toBeLessThanOrEqual(1 / output.sampleRate);
  });

  it('linearly interpolates a known ramp', () => {
    const output = changeSpeed(
      { channelData: [new Float32Array([0, 0.25, 0.5])], sampleRate: 48_000 },
      0.5,
    );

    expect(Array.from(output.channelData[0])).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.5]);
  });

  it('preserves channel count without mixing channels', () => {
    const left = new Float32Array([0, 0.25, 0.5]);
    const right = new Float32Array([0.5, 0.25, 0]);
    const output = changeSpeed({ channelData: [left, right], sampleRate: 44_100 }, 2);

    expect(output.channelData).toHaveLength(2);
    expect(Array.from(output.channelData[0])).toEqual([0, 0.5]);
    expect(Array.from(output.channelData[1])).toEqual([0.5, 0]);
  });

  it('clamps positive factors to the supported range', () => {
    expect(clampSpeedFactor(0.01)).toBe(MIN_SPEED_FACTOR);
    expect(clampSpeedFactor(10)).toBe(MAX_SPEED_FACTOR);
    expect(changeSpeed({ channelData: [new Float32Array(4)], sampleRate: 8_000 }, 0.01).channelData[0]).toHaveLength(
      16,
    );
    expect(changeSpeed({ channelData: [new Float32Array(8)], sampleRate: 8_000 }, 10).channelData[0]).toHaveLength(
      2,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid factor %s', (factor) => {
    expect(() =>
      changeSpeed({ channelData: [new Float32Array(1)], sampleRate: 8_000 }, factor),
    ).toThrow('Speed factor must be a positive finite number.');
  });

  it('handles empty and single-frame channels', () => {
    const empty = changeSpeed({ channelData: [new Float32Array()], sampleRate: 8_000 }, 0.5);
    const single = changeSpeed({ channelData: [new Float32Array([0.75])], sampleRate: 8_000 }, 0.5);
    const acceleratedSingle = changeSpeed(
      { channelData: [new Float32Array([0.75])], sampleRate: 8_000 },
      MAX_SPEED_FACTOR,
    );

    expect(empty.channelData[0]).toHaveLength(0);
    expect(Array.from(single.channelData[0])).toEqual([0.75, 0.75]);
    expect(Array.from(acceleratedSingle.channelData[0])).toEqual([0.75]);
  });

  it('rejects malformed PCM before resampling', () => {
    expect(() => changeSpeed({ channelData: [], sampleRate: 8_000 }, 1)).toThrow(
      'Audio must contain at least one channel.',
    );
    expect(() =>
      changeSpeed(
        { channelData: [new Float32Array(1), new Float32Array(2)], sampleRate: 8_000 },
        1,
      ),
    ).toThrow('Audio channels must have equal lengths.');
    expect(() => changeSpeed({ channelData: [new Float32Array(1)], sampleRate: 0 }, 1)).toThrow(
      'Sample rate must be a positive finite number.',
    );
  });

  it('rejects projected output exceeding the 256 MB limit before allocating Float32Array', () => {
    // At 0.25× speed, outputLength = inputLength / 0.25 = 4× inputLength.
    // To exceed 256 MB with 1 channel: outputLength * 1 * 4 > 256 * 1024 * 1024
    //   => outputLength > 67_108_864 frames
    //   => inputLength > 16_777_216 frames
    const OriginalFloat32Array = globalThis.Float32Array;
    const oversizedAllocations: number[] = [];
    // Intercept Float32Array construction to track any oversized allocation attempts.
    const ProxyArray = new Proxy(OriginalFloat32Array, {
      construct(target, args: unknown[]) {
        const size = typeof args[0] === 'number' ? args[0] : 0;
        if (size > 67_108_864) oversizedAllocations.push(size);
        return Reflect.construct(target, args) as Float32Array;
      },
    });
    globalThis.Float32Array = ProxyArray as unknown as typeof Float32Array;

    try {
      // 16_777_217 input frames × 1 channel / 0.25 factor = 67_108_868 output frames × 4 bytes ≈ 256 MB + 32 bytes
      const overLimitInput = new OriginalFloat32Array(16_777_217);
      expect(() =>
        changeSpeed({ channelData: [overLimitInput], sampleRate: 48_000 }, 0.25),
      ).toThrow(/\b256\b.*\bMB\b/);
      // Confirm no oversized output Float32Array was created — the guard fired before any allocation.
      expect(oversizedAllocations).toHaveLength(0);
    } finally {
      globalThis.Float32Array = OriginalFloat32Array;
    }
  });

  it.each(['wav', 'mp3'] as const)('imports the existing %s encoder after resampling', (format) => {
    const onProgress = vi.fn();
    startChangeSpeedEncode(
      { channelData: [new Float32Array([0, 0.5, 1, 0.5])], sampleRate: 8_000 },
      2,
      format,
      onProgress,
    );

    expect(startEncode).toHaveBeenCalledWith(
      {
        channels: [new Float32Array([0, 1])],
        endSeconds: 2 / 8_000,
        format,
        sampleRate: 8_000,
        startSeconds: 0,
      },
      onProgress,
    );
  });
});
