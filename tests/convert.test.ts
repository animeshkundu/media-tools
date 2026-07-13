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

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

describe('audio conversion', () => {
  beforeEach(() => {
    startEncodeMock.mockReset();
  });

  it.each([
    ['mono', 1],
    ['stereo', 2],
  ])('encodes %s PCM as a native WAV with the expected header', async (_name, channelCount) => {
    const sampleRate = 48_000;
    const frameCount = 120;
    const channelData = Array.from(
      { length: channelCount },
      (_, channel) => Float32Array.from({ length: frameCount }, (_value, frame) => (frame + channel) / frameCount),
    );
    const progress: number[] = [];

    const job = startConversion({ channelData, sampleRate }, 'wav', (value) => progress.push(value));
    const blob = await job.result;
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    expect(blob.type).toBe('audio/wav');
    expect(buffer.byteLength).toBe(44 + frameCount * channelCount * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(channelCount);
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(40, true)).toBe(frameCount * channelCount * 2);
    expect(progress).toEqual([0, 1]);
    expect(startEncodeMock).not.toHaveBeenCalled();
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

  it('snapshots WAV channel selection and sample rate before deferred encoding', async () => {
    const input = {
      channelData: [Float32Array.of(0, 0.5)],
      sampleRate: 44_100,
    };

    const job = startConversion(input, 'wav');
    input.channelData = [Float32Array.of(0), Float32Array.of(0)];
    input.sampleRate = 48_000;

    const view = new DataView(await (await job.result).arrayBuffer());
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(40, true)).toBe(4);
  });

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

  it('cancels a pending native WAV without producing output', async () => {
    const onProgress = vi.fn();
    const job = startConversion(
      { channelData: [Float32Array.of(0, 0.5)], sampleRate: 44_100 },
      'wav',
      onProgress,
    );

    job.cancel();

    await expect(job.result).rejects.toThrow('Export cancelled.');
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('rejects WAV conversion above the shared 256 MB cap before WAV allocation', () => {
    const framesPastLimit = Math.floor(MAX_PCM_ENCODE_BYTES / Float32Array.BYTES_PER_ELEMENT) + 1;
    const oversizedChannel = new Proxy(new Float32Array(1), {
      get(target, property, receiver) {
        if (property === 'length') return framesPastLimit;
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as Float32Array;
    const encodeWavSpy = vi.spyOn(audio, 'encodeWav');

    expect(() =>
      startConversion(
        {
          channelData: [oversizedChannel],
          sampleRate: 44_100,
        },
        'wav',
      ),
    ).toThrow('Decoded audio exceeds the 256 MB processing limit.');
    expect(encodeWavSpy).not.toHaveBeenCalled();
    encodeWavSpy.mockRestore();
  });

  it('rejects MP3 conversion above the shared 256 MB cap before worker encode starts', () => {
    const framesPastLimit = Math.floor(MAX_PCM_ENCODE_BYTES / Float32Array.BYTES_PER_ELEMENT) + 1;
    const oversizedChannel = new Proxy(new Float32Array(1), {
      get(target, property, receiver) {
        if (property === 'length') return framesPastLimit;
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as Float32Array;

    expect(() =>
      startConversion(
        {
          channelData: [oversizedChannel],
          sampleRate: 44_100,
        },
        'mp3',
      ),
    ).toThrow('Decoded audio exceeds the 256 MB processing limit.');
    expect(startEncodeMock).not.toHaveBeenCalled();
  });
});
