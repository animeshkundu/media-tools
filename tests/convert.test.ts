import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncodeJob } from '../lib/core/worker';
import { MAX_PCM_ENCODE_BYTES } from '../lib/core/worker';
import * as audio from '../lib/tools/audio-cutter/audio';

const { startEncodeMock } = vi.hoisted(() => ({
  startEncodeMock: vi.fn(),
}));

vi.mock('../lib/core/worker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/core/worker')>()),
  startEncode: startEncodeMock,
}));

import {
  CONVERT_FORMATS,
  startConversion,
  type DecodedPcm,
} from '../lib/tools/convert/convert';

describe('audio conversion', () => {
  beforeEach(() => {
    startEncodeMock.mockReset();
  });

  it('routes WAV through the shared worker without calling the main-thread encoder', async () => {
    const channelData = [new Float32Array(48_000), new Float32Array(48_000)];
    const onProgress = vi.fn();
    const blob = new Blob([], { type: 'audio/wav' });
    const workerJob: EncodeJob = {
      cancel: vi.fn(),
      result: Promise.resolve(blob),
    };
    startEncodeMock.mockReturnValue(workerJob);
    const encodeWavSpy = vi.spyOn(audio, 'encodeWav');

    try {
      const job = startConversion({ channelData, sampleRate: 48_000 }, 'wav', onProgress);

      expect(job).toBe(workerJob);
      expect(startEncodeMock).toHaveBeenCalledWith(
        {
          channels: channelData,
          endSeconds: 1,
          format: 'wav',
          sampleRate: 48_000,
          startSeconds: 0,
        },
        onProgress,
      );
      await expect(job.result).resolves.toBe(blob);
      expect(blob.type).toBe('audio/wav');
      expect(encodeWavSpy).not.toHaveBeenCalled();
    } finally {
      encodeWavSpy.mockRestore();
    }
  });

  it('routes MP3 through the shared worker and preserves progress and cancellation', () => {
    const channelData = [new Float32Array(44_100), new Float32Array(44_100)];
    const onProgress = vi.fn();
    const cancel = vi.fn();
    const workerJob: EncodeJob = {
      cancel,
      result: Promise.resolve(new Blob([], { type: 'audio/mpeg' })),
    };
    startEncodeMock.mockReturnValue(workerJob);

    const job = startConversion({ channelData, sampleRate: 44_100 }, 'mp3', onProgress);

    expect(job).toBe(workerJob);
    expect(startEncodeMock).toHaveBeenCalledWith(
      {
        channels: channelData,
        endSeconds: 1,
        format: 'mp3',
        sampleRate: 44_100,
        startSeconds: 0,
      },
      onProgress,
    );
    job.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['no channels', { channelData: [], sampleRate: 44_100 }, 'Conversion supports mono or stereo audio.'],
    ['empty channel', { channelData: [new Float32Array()], sampleRate: 44_100 }, 'Audio contains no samples.'],
    [
      'mismatched channels',
      { channelData: [new Float32Array(2), new Float32Array(1)], sampleRate: 44_100 },
      'Audio channels must contain the same number of samples.',
    ],
    [
      'sparse channels',
      {
        channelData: Object.assign(new Array<Float32Array>(2), { 0: Float32Array.of(0) }),
        sampleRate: 44_100,
      },
      'Audio channel data is invalid.',
    ],
    ['invalid sample rate', { channelData: [new Float32Array(1)], sampleRate: 0 }, 'Audio sample rate is invalid.'],
  ] satisfies [string, DecodedPcm, string][])(
    'rejects invalid PCM (%s) before encoding',
    (_name, input, message) => {
      expect(() => startConversion(input, 'mp3')).toThrow(message);
      expect(startEncodeMock).not.toHaveBeenCalled();
    },
  );

  it('validates format selection at runtime', () => {
    expect(CONVERT_FORMATS).toEqual(['wav', 'mp3']);
    expect(() =>
      startConversion(
        { channelData: [Float32Array.of(0)], sampleRate: 44_100 },
        'flac' as 'wav',
      ),
    ).toThrow(/format/i);
    expect(startEncodeMock).not.toHaveBeenCalled();
  });

  it('preserves the worker WAV cancellation rejection contract', async () => {
    let rejectResult: (reason: Error) => void = () => undefined;
    const result = new Promise<Blob>((_resolve, reject) => {
      rejectResult = reject;
    });
    const cancel = vi.fn(() => rejectResult(new Error('Export cancelled.')));
    startEncodeMock.mockReturnValue({ cancel, result });

    const job = startConversion(
      { channelData: [Float32Array.of(0, 0.5)], sampleRate: 44_100 },
      'wav',
    );
    job.cancel();

    await expect(job.result).rejects.toThrow(/cancel/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['wav', 'mp3'] as const)(
    'rejects oversized %s PCM before worker encode or main-thread WAV allocation',
    (format) => {
      const framesPastLimit = Math.floor(MAX_PCM_ENCODE_BYTES / Float32Array.BYTES_PER_ELEMENT) + 1;
      const oversizedChannel = new Proxy(new Float32Array(1), {
        get(target, property, receiver) {
          if (property === 'length') return framesPastLimit;
          return Reflect.get(target, property, receiver);
        },
      }) as unknown as Float32Array;
      const encodeWavSpy = vi.spyOn(audio, 'encodeWav');

      try {
        expect(() =>
          startConversion(
            {
              channelData: [oversizedChannel],
              sampleRate: 44_100,
            },
            format,
          ),
        ).toThrow('Decoded audio exceeds the 256 MB processing limit.');
        expect(startEncodeMock).not.toHaveBeenCalled();
        expect(encodeWavSpy).not.toHaveBeenCalled();
      } finally {
        encodeWavSpy.mockRestore();
      }
    },
  );
});
