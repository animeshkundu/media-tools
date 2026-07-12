import { describe, expect, it } from 'vitest';
import {
  MAX_PCM_BYTES,
  convertAudio,
  decodeWav,
  type AudioConvertInput,
} from '../lib/tools/audio-convert/audio-convert';
import { startAudioConversion } from '../lib/tools/audio-convert/worker';
import type {
  AudioConvertWorkerMessage,
  AudioConvertWorkerRequest,
} from '../lib/tools/audio-convert/convert.worker';

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

function tone(sampleRate: number, frames: number, frequency = 440): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, index) => 0.75 * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
}

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<AudioConvertWorkerMessage>) => void) | null = null;
  posted?: AudioConvertWorkerRequest;
  terminated = false;

  constructor(private readonly reply?: AudioConvertWorkerMessage) {}

  postMessage(message: AudioConvertWorkerRequest): void {
    this.posted = message;
    if (this.reply) {
      queueMicrotask(() => this.onmessage?.({ data: this.reply } as MessageEvent<AudioConvertWorkerMessage>));
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('audio conversion core', () => {
  it('writes canonical little-endian WAV headers and round-trips every PCM frame', async () => {
    const sampleRate = 48_000;
    const left = Float32Array.from([-1, -0.5, 0, 0.5, 1]);
    const right = Float32Array.from([1, 0.25, 0, -0.25, -1]);
    const progress: number[] = [];

    const blob = convertAudio(
      { channelData: [left, right], sampleRate },
      { format: 'wav', bitDepth: 16 },
      { onProgress: (value) => progress.push(value) },
    );
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    expect(blob.type).toBe('audio/wav');
    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(28, true)).toBe(sampleRate * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(left.length * 4);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true);

    const decoded = decodeWav(buffer);
    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.channelData).toHaveLength(2);
    expect(decoded.channelData[0]).toHaveLength(left.length);
    for (let frame = 0; frame < left.length; frame += 1) {
      expect(decoded.channelData[0][frame]).toBeCloseTo(left[frame], 4);
      expect(decoded.channelData[1][frame]).toBeCloseTo(right[frame], 4);
    }
  });

  it('encodes a valid MPEG-1 Layer III stream with the requested visible settings', async () => {
    const sampleRate = 44_100;
    const blob = convertAudio(
      { channelData: [tone(sampleRate, sampleRate), tone(sampleRate, sampleRate, 660)], sampleRate },
      { format: 'mp3', bitrateKbps: 192 },
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let frameOffset = -1;
    for (let index = 0; index < bytes.length - 4; index += 1) {
      if (
        bytes[index] === 0xff &&
        (bytes[index + 1] & 0xe0) === 0xe0 &&
        ((bytes[index + 1] >> 3) & 0x03) === 0x03 &&
        ((bytes[index + 1] >> 1) & 0x03) === 0x01
      ) {
        frameOffset = index;
        break;
      }
    }

    expect(blob.type).toBe('audio/mpeg');
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(frameOffset).toBeGreaterThanOrEqual(0);
    const bitrateIndex = (bytes[frameOffset + 2] >> 4) & 0x0f;
    const sampleRateIndex = (bytes[frameOffset + 2] >> 2) & 0x03;
    const channelMode = (bytes[frameOffset + 3] >> 6) & 0x03;
    expect([0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex]).toBe(192);
    expect([44_100, 48_000, 32_000][sampleRateIndex]).toBe(sampleRate);
    expect(channelMode).not.toBe(3);
  });

  it.each([
    ['no channels', { channelData: [], sampleRate: 44_100 } satisfies AudioConvertInput],
    ['empty samples', { channelData: [new Float32Array()], sampleRate: 44_100 } satisfies AudioConvertInput],
    [
      'mismatched channels',
      { channelData: [new Float32Array(2), new Float32Array(1)], sampleRate: 44_100 } satisfies AudioConvertInput,
    ],
    ['invalid sample rate', { channelData: [new Float32Array(1)], sampleRate: Number.NaN } satisfies AudioConvertInput],
    ['invalid samples', { channelData: [Float32Array.of(Number.NaN)], sampleRate: 44_100 } satisfies AudioConvertInput],
    [
      'oversized decoded PCM',
      {
        channelData: [{ length: MAX_PCM_BYTES / Float32Array.BYTES_PER_ELEMENT + 1 } as Float32Array],
        sampleRate: 44_100,
      } satisfies AudioConvertInput,
    ],
  ])('rejects hostile PCM input (%s) without returning output', (_name, input) => {
    let output: Blob | undefined;
    expect(() => {
      output = convertAudio(input, { format: 'wav', bitDepth: 16 });
    }).toThrow();
    expect(output).toBeUndefined();
  });

  it('rejects malformed encoded input and unsupported MP3 settings before success', () => {
    const malformed = new ArrayBuffer(16);
    const malformedView = new DataView(malformed);
    for (const [index, character] of [...'RIFFxxxxWAVEfmt '].entries()) {
      malformedView.setUint8(index, character.charCodeAt(0));
    }

    expect(() => convertAudio({ encodedData: malformed }, { format: 'wav', bitDepth: 16 })).toThrow(
      /truncated|missing|required|valid/i,
    );
    expect(() =>
      convertAudio(
        { channelData: [new Float32Array(100)], sampleRate: 44_100 },
        { format: 'mp3', bitrateKbps: 123 as 192 },
      ),
    ).toThrow(/bitrate/i);
    expect(() =>
      convertAudio(
        { channelData: [new Float32Array(100)], sampleRate: 24_000 },
        { format: 'mp3', bitrateKbps: 192 },
      ),
    ).toThrow(/bitrate.*sample rate/i);
  });

  it('does not parse chunks outside the RIFF-declared container', () => {
    const valid = convertAudio(
      { channelData: [Float32Array.of(0)], sampleRate: 44_100 },
      { format: 'wav', bitDepth: 16 },
    );
    return valid.arrayBuffer().then((buffer) => {
      new DataView(buffer).setUint32(4, 4, true);
      expect(() => decodeWav(buffer)).toThrow(/missing required/i);
    });
  });

  it('honors an aborted conversion without reporting completion or producing output', () => {
    const controller = new AbortController();
    const progress: number[] = [];
    controller.abort();

    expect(() =>
      convertAudio(
        { channelData: [tone(44_100, 4_410)], sampleRate: 44_100 },
        { format: 'wav', bitDepth: 16 },
        { signal: controller.signal, onProgress: (value) => progress.push(value) },
      ),
    ).toThrowError(expect.objectContaining({ name: 'AbortError' }));
    expect(progress).toEqual([0]);
  });

  it('cancels by terminating the worker and rejects without a partial Blob', async () => {
    const worker = new FakeWorker();
    const job = startAudioConversion(
      { channelData: [tone(44_100, 4_410)], sampleRate: 44_100 },
      { format: 'mp3', bitrateKbps: 192 },
      () => undefined,
      () => worker,
    );

    job.cancel();

    await expect(job.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('rejects hostile input before allocating copies or starting a worker', async () => {
    let workerCreated = false;
    const job = startAudioConversion(
      {
        channelData: [{ length: MAX_PCM_BYTES / Float32Array.BYTES_PER_ELEMENT + 1 } as Float32Array],
        sampleRate: 44_100,
      },
      { format: 'wav', bitDepth: 16 },
      () => undefined,
      () => {
        workerCreated = true;
        return new FakeWorker();
      },
    );

    await expect(job.result).rejects.toThrow(/size limit/i);
    expect(workerCreated).toBe(false);
  });

  it('returns a rejected job when worker construction fails', async () => {
    const job = startAudioConversion(
      { channelData: [Float32Array.of(0)], sampleRate: 44_100 },
      { format: 'wav', bitDepth: 16 },
      () => undefined,
      () => {
        throw new Error('Worker unavailable.');
      },
    );

    await expect(job.result).rejects.toThrow('Worker unavailable.');
    expect(() => job.cancel()).not.toThrow();
  });

  it('terminates and rejects worker failures without accepting a later success', async () => {
    const worker = new FakeWorker({ type: 'error', message: 'Unsupported input.' });
    const job = startAudioConversion(
      { encodedData: new Uint8Array([1, 2, 3]).buffer },
      { format: 'wav', bitDepth: 16 },
      () => undefined,
      () => worker,
    );

    await expect(job.result).rejects.toThrow('Unsupported input.');
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
  });
});
