import { describe, expect, it, vi } from 'vitest';
import { startEncode } from '../lib/core/worker';
import {
  encodeJoinedWav,
  joinPcm,
  MAX_JOIN_OUTPUT_BYTES,
  startJoinedEncode,
  type DecodedPcmTrack,
} from '../lib/tools/join/join';

vi.mock('../lib/core/worker', () => ({
  startEncode: vi.fn(() => ({
    cancel: vi.fn(),
    result: Promise.resolve(new Blob()),
  })),
}));

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

  it('rejects aggregate PCM beyond the hard limit before output allocation', () => {
    // 1,048,576 float samples occupy 4 MiB; references are repeated to cross the 512 MiB limit.
    const shared = new Float32Array(1024 * 1024);
    const tracksToExceedLimit = Math.floor(MAX_JOIN_OUTPUT_BYTES / shared.byteLength) + 1;
    const repeatedTracks = Array.from(
      { length: tracksToExceedLimit },
      () => ({ channelData: [shared], sampleRate: 48_000 }),
    );

    expect(() => joinPcm(repeatedTracks)).toThrow('512 MiB decoded PCM limit');
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
