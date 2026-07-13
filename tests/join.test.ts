import { describe, expect, it, vi } from 'vitest';
import { MAX_PCM_ENCODE_BYTES, startEncode } from '../lib/core/worker';
import {
  encodeJoinedWav,
  joinPcm,
  startJoinedEncode,
  type DecodedPcmTrack,
} from '../lib/tools/join/join';

vi.mock('../lib/core/worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/core/worker')>();
  return {
    ...actual,
    startEncode: vi.fn(() => ({
      cancel: vi.fn(),
      result: Promise.resolve(new Blob()),
    })),
  };
});

function createTrack(samples: number[][], sampleRate = 8_000): DecodedPcmTrack {
  return {
    channelData: samples.map((channel) => Float32Array.from(channel)),
    sampleRate,
  };
}

describe('audio join core', () => {
  it('rejects an empty input list', () => {
    expect(() => joinPcm([])).toThrow('Select at least one audio track.');
  });

  it('copies a single track without aliasing its samples', () => {
    const input = createTrack([[0.25, -0.5]]);
    const joined = joinPcm([input]);

    expect(Array.from(joined.channelData[0] ?? [])).toEqual([0.25, -0.5]);
    expect(joined.channelData[0]).not.toBe(input.channelData[0]);
    expect(joined.sampleRate).toBe(input.sampleRate);
  });

  it('preserves the requested order and introduces no silent boundary frames', () => {
    const tracks = [createTrack([[1, 0.75]]), createTrack([[-0.5, -1]])];
    const visibleOrder = joinPcm(tracks);
    const reordered = joinPcm(tracks, [1, 0]);

    expect(Array.from(visibleOrder.channelData[0] ?? [])).toEqual([1, 0.75, -0.5, -1]);
    expect(Array.from(reordered.channelData[0] ?? [])).toEqual([-0.5, -1, 1, 0.75]);
    expect(reordered.channelData[0]).toHaveLength(4);
    expect(reordered.channelData[0]).not.toContain(0);
  });

  it('resamples to the highest rate and reconciles mono and stereo channels', () => {
    const joined = joinPcm([
      createTrack([[0, 1]], 2),
      createTrack(
        [
          [0.25, 0.5, 0.75, 1],
          [-0.25, -0.5, -0.75, -1],
        ],
        4,
      ),
    ]);

    expect(joined.sampleRate).toBe(4);
    expect(joined.channelData).toHaveLength(2);
    expect(Array.from(joined.channelData[0] ?? [])).toEqual([0, 0.5, 1, 1, 0.25, 0.5, 0.75, 1]);
    expect(Array.from(joined.channelData[1] ?? [])).toEqual([0, 0.5, 1, 1, -0.25, -0.5, -0.75, -1]);
  });

  it('rejects malformed tracks and invalid explicit order', () => {
    expect(() => joinPcm([createTrack([[1], [1, 2]])])).toThrow('same non-zero frame count');
    expect(() => joinPcm([createTrack([[1]], 0)])).toThrow('positive finite');
    expect(() => joinPcm([createTrack([[1]]), createTrack([[2]])], [0, 0])).toThrow(
      'include every input exactly once',
    );
  });

  it('rejects projected output beyond the shared encode limit before allocation', () => {
    const OriginalFloat32Array = globalThis.Float32Array;
    const allocations: number[] = [];
    const TrackingFloat32Array = new Proxy(OriginalFloat32Array, {
      construct(target, args, newTarget) {
        if (typeof args[0] === 'number') allocations.push(args[0]);
        return Reflect.construct(target, args, newTarget);
      },
    }) as unknown as Float32ArrayConstructor;
    let float32Replaced = false;

    try {
      Object.defineProperty(globalThis, 'Float32Array', {
        value: TrackingFloat32Array,
        configurable: true,
      });
      float32Replaced = true;
      const framesPastLimit = Math.floor(MAX_PCM_ENCODE_BYTES / Float32Array.BYTES_PER_ELEMENT) + 1;
      const oversizedChannel = new Proxy(new OriginalFloat32Array(1), {
        get(target, property, receiver) {
          if (property === 'length') return framesPastLimit;
          return Reflect.get(target, property, receiver);
        },
      }) as Float32Array;
      const oversizedTrack = {
        channelData: [oversizedChannel],
        sampleRate: 48_000,
      } as DecodedPcmTrack;

      expect(() => joinPcm([oversizedTrack])).toThrow('256 MB processing limit');
      expect(allocations).toEqual([]);
    } finally {
      if (float32Replaced) {
        Object.defineProperty(globalThis, 'Float32Array', {
          value: OriginalFloat32Array,
          configurable: true,
        });
      }
    }
  });

  it('encodes joined PCM as native WAV', () => {
    const wav = encodeJoinedWav([createTrack([[0.25, -0.25]], 8_000)]);
    const view = new DataView(wav);

    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint32(40, true)).toBe(4);
  });

  it('routes MP3 export through the existing bundled encoder path', () => {
    const onProgress = vi.fn();
    const input = createTrack([[0.25, -0.25]], 8_000);
    startJoinedEncode([input], 'mp3', onProgress);

    expect(startEncode).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: [expect.any(Float32Array)],
        sampleRate: 8_000,
        startSeconds: 0,
        endSeconds: input.channelData[0]!.length / input.sampleRate,
        format: 'mp3',
      }),
      onProgress,
    );
  });
});
