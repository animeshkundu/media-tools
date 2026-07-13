import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_BYTES,
  MAX_PCM_CHANNELS,
  MAX_PCM_ENCODE_BYTES,
  startAnalyze,
  startDecodeFile,
  startEncode,
  startFileEncode,
} from '../lib/core/worker';
import { cutPcm, encodeWav } from '../lib/tools/audio-cutter/audio';
import { processAudioRequest, type WorkerReply } from '../lib/tools/audio-cutter/encode.worker';

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

function wavFile(samples: Float32Array, sampleRate: number): File {
  return new File([encodeWav({ channels: [samples], sampleRate })], 'fixture.wav', {
    type: 'audio/wav',
  });
}

describe('audio cutter', () => {
  it('cuts generated PCM and produces the expected WAV length', () => {
    const sampleRate = 8_000;
    const samples = new Float32Array(sampleRate);
    for (let index = 0; index < samples.length; index += 1)
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate);

    const cut = cutPcm({ channels: [samples], sampleRate }, 0.25, 0.75);
    const wav = encodeWav(cut);
    const view = new DataView(wav);

    expect(cut.channels[0]).toHaveLength(4_000);
    expect(wav.byteLength).toBe(44 + 4_000 * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint32(40, true)).toBe(8_000);
  });

  it('writes a valid stereo PCM WAV header', () => {
    const wav = encodeWav({ channels: [new Float32Array(100), new Float32Array(100)], sampleRate: 48_000 });
    const view = new DataView(wav);

    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(28, true)).toBe(192_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  });

  it('decodes and cuts WAV in the worker within one source frame', async () => {
    const sampleRate = 8_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => index / sampleRate);
    const file = wavFile(samples, sampleRate);
    const replies: WorkerReply[] = [];

    await processAudioRequest(
      { type: 'encode', file, startSeconds: 0.12345, endSeconds: 0.67891, format: 'wav' },
      (reply) => replies.push(reply),
    );

    const progress = replies.filter((reply) => reply.type === 'progress').map((reply) => reply.value);
    const result = replies.find((reply) => reply.type === 'result');
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(result?.type).toBe('result');
    if (result?.type !== 'result') throw new Error('Expected encoded WAV result.');

    const view = new DataView(result.buffer);
    const frames = view.getUint32(40, true) / 2;
    expect(Math.abs(frames / sampleRate - (0.67891 - 0.12345))).toBeLessThanOrEqual(1 / sampleRate);
    expect(
      Math.abs(
        view.getInt16(44, true) / 0x7fff -
          samples[Math.round(0.12345 * sampleRate)]!,
      ),
    ).toBeLessThanOrEqual(1 / sampleRate);
  });

  it('analyzes a WAV without returning full decoded PCM and rejects corrupt WAV input', async () => {
    const file = wavFile(new Float32Array(16_000), 8_000);
    const replies: WorkerReply[] = [];
    await processAudioRequest({ type: 'analyze', file }, (reply) => replies.push(reply));

    const analyzed = replies.find((reply) => reply.type === 'analyzed');
    expect(analyzed?.type).toBe('analyzed');
    if (analyzed?.type !== 'analyzed') throw new Error('Expected analyzed audio.');
    expect(analyzed.duration).toBe(2);
    expect(analyzed.waveform.length).toBeLessThanOrEqual(2_048);

    // RIFF/WAVE-prefixed but truncated — exercises the WAV header parsing error path
    const corruptReplies: WorkerReply[] = [];
    await processAudioRequest(
      {
        type: 'analyze',
        file: new File(
          [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])],
          'corrupt.wav',
        ),
      },
      (reply) => corruptReplies.push(reply),
    );
    expect(corruptReplies.at(-1)).toMatchObject({ type: 'error' });
  });

  it('rejects non-WAV input gracefully when AudioDecoder is unavailable', async () => {
    // In the Node test environment AudioDecoder is undefined; the worker must return an error,
    // not throw an uncaught exception.
    const replies: WorkerReply[] = [];
    await processAudioRequest(
      { type: 'analyze', file: new File([new Uint8Array(64)], 'audio.mp3', { type: 'audio/mpeg' }) },
      (reply) => replies.push(reply),
    );
    expect(replies.at(-1)).toMatchObject({ type: 'error' });
  });

  it('enforces the input cap before worker creation and cancellation returns no result', async () => {
    const originalWorker = globalThis.Worker;
    let workersCreated = 0;
    let terminated = false;
    class FakeWorker {
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor() {
        workersCreated += 1;
      }

      postMessage() {}

      terminate() {
        terminated = true;
      }
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker;

    try {
      const oversized = new File([], 'too-large.wav');
      Object.defineProperty(oversized, 'size', { value: MAX_INPUT_BYTES + 1 });
      expect(() => startAnalyze(oversized, () => undefined)).toThrow(/smaller than/);
      expect(workersCreated).toBe(0);

      const job = startFileEncode(
        {
          file: new File([new Uint8Array(1)], 'fixture.wav'),
          startSeconds: 0,
          endSeconds: 1,
          format: 'wav',
        },
        () => undefined,
      );
      job.cancel();
      await expect(job.result).rejects.toThrow('cancelled');
      expect(terminated).toBe(true);
    } finally {
      globalThis.Worker = originalWorker;
    }
  });

  it('enforces the 64 MB input cap inside the worker (defense-in-depth)', async () => {
    const oversized = new File([new Uint8Array(1)], 'big.wav');
    Object.defineProperty(oversized, 'size', { value: 64 * 1024 * 1024 + 1 });
    const replies: WorkerReply[] = [];
    await processAudioRequest({ type: 'analyze', file: oversized }, (reply) => replies.push(reply));
    expect(replies.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('64 MB') });
  });

  it('rejects encode-pcm requests that exceed channel count or aggregate decoded bytes', async () => {
    const tooManyChannelsReplies: WorkerReply[] = [];
    await processAudioRequest(
      {
        type: 'encode-pcm',
        channels: Array.from({ length: MAX_PCM_CHANNELS + 1 }, () => new Float32Array([0])),
        sampleRate: 8_000,
        startSeconds: 0,
        endSeconds: 1,
        format: 'wav',
      },
      (reply) => tooManyChannelsReplies.push(reply),
    );
    expect(tooManyChannelsReplies.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('mono/stereo'),
    });

    const oversizedChannel = {
      byteLength: MAX_PCM_ENCODE_BYTES + 1,
      length: 1,
    } as unknown as Float32Array;
    const oversizedReplies: WorkerReply[] = [];
    await processAudioRequest(
      {
        type: 'encode-pcm',
        channels: [oversizedChannel],
        sampleRate: 8_000,
        startSeconds: 0,
        endSeconds: 1,
        format: 'wav',
      },
      (reply) => oversizedReplies.push(reply),
    );
    expect(oversizedReplies.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('256 MB'),
    });
  });

  it('rejects an encode request with non-finite timestamps inside the worker', async () => {
    const file = wavFile(new Float32Array(8_000), 8_000);
    const replies: WorkerReply[] = [];
    await processAudioRequest(
      { type: 'encode', file, startSeconds: Infinity, endSeconds: 1, format: 'wav' },
      (reply) => replies.push(reply),
    );
    expect(replies.at(-1)).toMatchObject({ type: 'error' });
  });

  it('MP3 over-cap output triggers error and closes every AudioData', async () => {
    // AudioDecoder is undefined in Node.js; inject stubs so decodeMp3 actually runs.
    let closedCount = 0;

    class StubAudioData {
      // 34 M frames × 2 ch × 4 bytes = 272,000,000 bytes (~259 MB) > MAX_DECODED_BYTES (256 MB = 268,435,456 bytes)
      readonly numberOfFrames = 34_000_000;
      readonly numberOfChannels = 2;
      readonly sampleRate = 44_100;
      close(): void {
        closedCount += 1;
      }
      async copyTo(dest: Float32Array): Promise<void> {
        dest.fill(0);
      }
    }

    let capturedOutput: ((data: StubAudioData) => void) | undefined;

    class StubAudioDecoder {
      decodeQueueSize = 0;
      static async isConfigSupported(): Promise<{ supported: boolean }> {
        return { supported: true };
      }
      constructor(init: { output: (data: StubAudioData) => void; error: (e: Error) => void }) {
        capturedOutput = init.output;
      }
      configure(): void {}
      decode(): void {
        // Fire output synchronously — simulates a UA that delivers decoded PCM eagerly.
        capturedOutput?.(new StubAudioData());
      }
      flush(): Promise<void> {
        return Promise.resolve();
      }
      close(): void {}
    }

    class StubEncodedAudioChunk {
      constructor() {}
    }

    const g = globalThis as Record<string, unknown>;
    const savedAudioDecoder = g.AudioDecoder;
    const savedEncodedAudioChunk = g.EncodedAudioChunk;
    try {
      g.AudioDecoder = StubAudioDecoder;
      g.EncodedAudioChunk = StubEncodedAudioChunk;

      // Minimal valid MP3 frame: MPEG1, Layer3, 32 kbps, 44100 Hz, stereo.
      // Header: 0xFF 0xFB 0x10 0x00; frame length = floor(144000*32/44100)+0 = 104 bytes.
      const mp3Data = new Uint8Array(104);
      mp3Data[0] = 0xff;
      mp3Data[1] = 0xfb;
      mp3Data[2] = 0x10;
      mp3Data[3] = 0x00;

      const replies: WorkerReply[] = [];
      await processAudioRequest(
        { type: 'analyze', file: new File([mp3Data], 'test.mp3', { type: 'audio/mpeg' }) },
        (reply) => replies.push(reply),
      );

      expect(replies.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('256 MB') });
      // Every AudioData emitted by the decoder must be closed — no leaks.
      expect(closedCount).toBeGreaterThanOrEqual(1);
    } finally {
      g.AudioDecoder = savedAudioDecoder;
      g.EncodedAudioChunk = savedEncodedAudioChunk;
    }
  });

  it('encode-pcm path cuts and encodes pre-decoded channels as a valid WAV', async () => {
    const sampleRate = 8_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => index / sampleRate);
    const replies: WorkerReply[] = [];

    await processAudioRequest(
      {
        type: 'encode-pcm',
        channels: [samples],
        sampleRate,
        startSeconds: 0.1,
        endSeconds: 0.6,
        format: 'wav',
      },
      (reply) => replies.push(reply),
    );

    const result = replies.find((reply) => reply.type === 'result');
    expect(result?.type).toBe('result');
    if (result?.type !== 'result') throw new Error('Expected encoded WAV result.');

    const view = new DataView(result.buffer);
    const frames = view.getUint32(40, true) / 2;
    expect(Math.abs(frames / sampleRate - (0.6 - 0.1))).toBeLessThanOrEqual(1 / sampleRate);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
  });

  it('validates encode-pcm byte limits before copying channel buffers in startEncode', () => {
    const originalWorker = globalThis.Worker;
    let workersCreated = 0;
    class FakeWorker {
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor() {
        workersCreated += 1;
      }

      postMessage() {}

      terminate() {}
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker;

    let sliceCalled = false;
    const oversizedChannel = {
      byteLength: MAX_PCM_ENCODE_BYTES + 1,
      // startEncode should throw before it ever snapshots or transfers channel buffers.
      buffer: new ArrayBuffer(0),
      slice: () => {
        sliceCalled = true;
        throw new Error('slice should not run');
      },
    } as unknown as Float32Array;

    try {
      expect(() =>
        startEncode(
          {
            channels: [oversizedChannel],
            sampleRate: 8_000,
            startSeconds: 0,
            endSeconds: 1,
            format: 'wav',
          },
          () => undefined,
        ),
      ).toThrow('256 MB');
      expect(sliceCalled).toBe(false);
      expect(workersCreated).toBe(0);
    } finally {
      globalThis.Worker = originalWorker;
    }
  });

  it('validates channel count limits before creating a worker in startEncode', () => {
    const originalWorker = globalThis.Worker;
    let workersCreated = 0;
    class FakeWorker {
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor() {
        workersCreated += 1;
      }

      postMessage() {}

      terminate() {}
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    try {
      expect(() =>
        startEncode(
          {
            channels: Array.from({ length: MAX_PCM_CHANNELS + 1 }, () => new Float32Array([0])),
            sampleRate: 8_000,
            startSeconds: 0,
            endSeconds: 1,
            format: 'wav',
          },
          () => undefined,
        ),
      ).toThrow('mono/stereo');
      expect(workersCreated).toBe(0);
    } finally {
      globalThis.Worker = originalWorker;
    }
  });

  it('encode-pcm path encodes as MP3 and returns a non-empty result', async () => {
    const sampleRate = 8_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin((2 * Math.PI * 440 * index) / sampleRate));
    const replies: WorkerReply[] = [];

    // lamejs is loaded via importScripts in the real worker; inject a minimal stub for Node.js tests.
    const g = globalThis as Record<string, unknown>;
    const savedLamejs = g.lamejs;
    g.lamejs = {
      Mp3Encoder: class {
        encodeBuffer(): Int8Array {
          return new Int8Array([0xff, 0xfb, 0x00]);
        }
        flush(): Int8Array {
          return new Int8Array(0);
        }
      },
    };

    try {
      await processAudioRequest(
        {
          type: 'encode-pcm',
          channels: [samples],
          sampleRate,
          startSeconds: 0,
          endSeconds: 1,
          format: 'mp3',
        },
        (reply) => replies.push(reply),
      );

      const result = replies.find((reply) => reply.type === 'result');
      expect(result?.type).toBe('result');
      if (result?.type !== 'result') throw new Error('Expected encoded MP3 result.');
      expect(result.buffer.byteLength).toBeGreaterThan(0);
      expect(result.mime).toBe('audio/mpeg');
    } finally {
      g.lamejs = savedLamejs;
    }
  });

  it('decode-file: decodes a WAV file and returns all PCM channels and sampleRate', async () => {
    const sampleRate = 8_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, i) => i / sampleRate);
    const file = wavFile(samples, sampleRate);
    const replies: WorkerReply[] = [];

    await processAudioRequest({ type: 'decode-file', file }, (reply) => replies.push(reply));

    const decoded = replies.find((reply) => reply.type === 'decoded');
    expect(decoded?.type).toBe('decoded');
    if (decoded?.type !== 'decoded') throw new Error('Expected decoded reply.');
    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.channelData).toHaveLength(1);
    expect(decoded.channelData[0]).toHaveLength(sampleRate);
    // Verify round-trip fidelity within 16-bit quantization tolerance
    const tolerance = 1 / 0x7fff;
    expect(Math.abs((decoded.channelData[0]?.[100] ?? 0) - samples[100]!)).toBeLessThanOrEqual(tolerance);
  });

  it('decode-file: deterministically rejects a WAV exceeding the 30-minute / 256-MB PCM cap from header metadata, before any allocation', async () => {
    // A WAV declaring > 30 minutes of 8-bit mono at 8 kHz: ~13.7 MB raw, well within the 64 MB
    // input cap, but readWavMetadata throws from the header BEFORE decodeWavRegion allocates
    // any Float32Array.
    const sampleRate = 8_000;
    const channels = 1;
    const bitsPerSample = 8;
    const blockAlign = channels * (bitsPerSample / 8);
    const frames = 30 * 60 * sampleRate + 1; // 1 frame past the 30-minute limit
    const dataSize = frames * blockAlign;

    const headerBuf = new ArrayBuffer(44);
    const hv = new DataView(headerBuf);
    const wa = (offset: number, text: string): void =>
      text.split('').forEach((c, i) => hv.setUint8(offset + i, c.charCodeAt(0)));
    wa(0, 'RIFF');
    hv.setUint32(4, 36 + dataSize, true);
    wa(8, 'WAVE');
    wa(12, 'fmt ');
    hv.setUint32(16, 16, true);
    hv.setUint16(20, 1, true); // PCM
    hv.setUint16(22, channels, true);
    hv.setUint32(24, sampleRate, true);
    hv.setUint32(28, sampleRate * blockAlign, true);
    hv.setUint16(32, blockAlign, true);
    hv.setUint16(34, bitsPerSample, true);
    wa(36, 'data');
    hv.setUint32(40, dataSize, true);
    // Include actual audio bytes so the file-size truncation check in readWavMetadata passes.
    const audioData = new Uint8Array(dataSize);
    const file = new File([headerBuf, audioData], 'long.wav', { type: 'audio/wav' });

    const replies: WorkerReply[] = [];
    await processAudioRequest({ type: 'decode-file', file }, (reply) => replies.push(reply));

    const last = replies.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type !== 'error') throw new Error('Expected error reply.');
    expect(last.message).toMatch(/30 minute|256 MB/);
  });

  it('decode-file: over-cap MP3 is deterministically rejected via the projected-PCM cap before consolidating decoded data', async () => {
    // Stub AudioDecoder whose first decoded output has > 256 MB worth of PCM.
    // The cap fires before any large consolidated Float32Array is built.
    let closedCount = 0;

    class StubAudioData {
      // 34 M frames × 2 ch × 4 bytes = ~260 MB > MAX_DECODED_BYTES
      readonly numberOfFrames = 34_000_000;
      readonly numberOfChannels = 2;
      readonly sampleRate = 44_100;
      close(): void {
        closedCount += 1;
      }
      async copyTo(dest: Float32Array): Promise<void> {
        dest.fill(0);
      }
    }

    let capturedOutput: ((data: StubAudioData) => void) | undefined;

    class StubAudioDecoder {
      decodeQueueSize = 0;
      static async isConfigSupported(): Promise<{ supported: boolean }> {
        return { supported: true };
      }
      constructor(init: { output: (data: StubAudioData) => void; error: (e: Error) => void }) {
        capturedOutput = init.output;
      }
      configure(): void {}
      decode(): void {
        capturedOutput?.(new StubAudioData());
      }
      flush(): Promise<void> {
        return Promise.resolve();
      }
      close(): void {}
    }

    class StubEncodedAudioChunk {
      constructor() {}
    }

    const g = globalThis as Record<string, unknown>;
    const savedAudioDecoder = g.AudioDecoder;
    const savedEncodedAudioChunk = g.EncodedAudioChunk;
    try {
      g.AudioDecoder = StubAudioDecoder;
      g.EncodedAudioChunk = StubEncodedAudioChunk;

      // Minimal valid MP3 frame: MPEG1, Layer3, 32 kbps, 44100 Hz, stereo.
      const mp3Data = new Uint8Array(104);
      mp3Data[0] = 0xff;
      mp3Data[1] = 0xfb;
      mp3Data[2] = 0x10;
      mp3Data[3] = 0x00;

      const replies: WorkerReply[] = [];
      await processAudioRequest(
        { type: 'decode-file', file: new File([mp3Data], 'test.mp3', { type: 'audio/mpeg' }) },
        (reply) => replies.push(reply),
      );

      expect(replies.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('256 MB') });
      expect(closedCount).toBeGreaterThanOrEqual(1);
    } finally {
      g.AudioDecoder = savedAudioDecoder;
      g.EncodedAudioChunk = savedEncodedAudioChunk;
    }
  });

  it('decode-file: startDecodeFile enforces the 64 MB input cap before spawning a worker', () => {
    const originalWorker = globalThis.Worker;
    let workersCreated = 0;
    class FakeWorker {
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() {
        workersCreated += 1;
      }
      postMessage() {}
      terminate() {}
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    try {
      const oversized = new File([], 'too-large.wav');
      Object.defineProperty(oversized, 'size', { value: MAX_INPUT_BYTES + 1 });
      expect(() => startDecodeFile(oversized, () => undefined)).toThrow(/smaller than/);
      expect(workersCreated).toBe(0);
    } finally {
      globalThis.Worker = originalWorker;
    }
  });
});
