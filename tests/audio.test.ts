import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES, startAnalyze, startEncode } from '../lib/core/worker';
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

  it('analyzes a WAV without returning full decoded PCM and rejects corrupt input', async () => {
    const file = wavFile(new Float32Array(16_000), 8_000);
    const replies: WorkerReply[] = [];
    await processAudioRequest({ type: 'analyze', file }, (reply) => replies.push(reply));

    const analyzed = replies.find((reply) => reply.type === 'analyzed');
    expect(analyzed?.type).toBe('analyzed');
    if (analyzed?.type !== 'analyzed') throw new Error('Expected analyzed audio.');
    expect(analyzed.duration).toBe(2);
    expect(analyzed.waveform.length).toBeLessThanOrEqual(2_048);

    const corruptReplies: WorkerReply[] = [];
    await processAudioRequest(
      { type: 'analyze', file: new File([new Uint8Array(64)], 'bad.wav') },
      (reply) => corruptReplies.push(reply),
    );
    expect(corruptReplies.at(-1)).toMatchObject({ type: 'error' });
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

      const job = startEncode(
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
});
