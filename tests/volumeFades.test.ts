import { describe, expect, it } from 'vitest';
import { encodeWav } from '../lib/tools/audio-cutter/audio';
import {
  processAudioRequest,
  type WorkerReply,
} from '../lib/tools/audio-cutter/encode.worker';
import { startVolumeFadesEncode } from '../lib/tools/volume-fades/startVolumeFades';
import {
  NORMALIZE_TARGET_DBFS,
  amplitudeToDbfs,
  analyzeVolumeFades,
  applyVolumeFadesInPlace,
  peakState,
  previewBinnedVolumeFades,
  type VolumeFadeOptions,
} from '../lib/tools/volume-fades/volumeFades';

const DEFAULT_OPTIONS: VolumeFadeOptions = {
  curve: 'linear',
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
  gainPercent: 100,
  normalize: false,
};

function wavFile(samples: Float32Array, sampleRate: number): File {
  return new File([encodeWav({ channels: [samples], sampleRate })], 'volume.wav', {
    type: 'audio/wav',
  });
}

function floatWavFile(sample: number): File {
  const buffer = new ArrayBuffer(48);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 40, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  writeAscii(36, 'data');
  view.setUint32(40, 4, true);
  view.setFloat32(44, sample, true);
  return new File([buffer], 'float.wav', { type: 'audio/wav' });
}

describe('volume and fades', () => {
  it('applies 0-500% gain with sample-aligned linear fade endpoints', () => {
    const channel = new Float32Array([1, 1, 1, 1, 1]);
    const progress: number[] = [];
    const analysis = applyVolumeFadesInPlace(
      { channels: [channel], sampleRate: 1 },
      {
        ...DEFAULT_OPTIONS,
        fadeInSeconds: 3,
        fadeOutSeconds: 3,
        gainPercent: 200,
      },
      (value) => progress.push(value),
    );

    expect(Array.from(channel)).toEqual([0, 1, 2, 1, 0]);
    expect(analysis).toMatchObject({ effectiveGain: 2, outputPeak: 2, sourcePeak: 1 });
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
  });

  it('uses a logarithmic -60 dB fade ramp with exact silent and unity endpoints', () => {
    const channel = new Float32Array([1, 1, 1]);
    applyVolumeFadesInPlace(
      { channels: [channel], sampleRate: 1 },
      { ...DEFAULT_OPTIONS, curve: 'logarithmic', fadeInSeconds: 3 },
    );

    expect(channel[0]).toBe(0);
    expect(channel[1]).toBeCloseTo(10 ** (-30 / 20), 6);
    expect(channel[2]).toBe(1);
  });

  it('normalizes the post-fade peak to exactly -1 dBFS while preserving sample ratios', () => {
    const channel = new Float32Array([0, 0.25, -0.5, 0.125]);
    const analysis = applyVolumeFadesInPlace(
      { channels: [channel], sampleRate: 8_000 },
      { ...DEFAULT_OPTIONS, gainPercent: 500, normalize: true },
    );

    expect(amplitudeToDbfs(analysis.outputPeak)).toBeCloseTo(NORMALIZE_TARGET_DBFS, 10);
    expect(Math.abs(channel[2]!)).toBeCloseTo(10 ** (NORMALIZE_TARGET_DBFS / 20), 6);
    expect(channel[1]! / channel[2]!).toBeCloseTo(-0.5, 6);
  });

  it('keeps silence silent when normalization is enabled', () => {
    const channel = new Float32Array(8);
    const analysis = applyVolumeFadesInPlace(
      { channels: [channel], sampleRate: 8_000 },
      { ...DEFAULT_OPTIONS, normalize: true },
    );

    expect(analysis).toEqual({ effectiveGain: 1, outputPeak: 0, sourcePeak: 0 });
    expect(channel).toEqual(new Float32Array(8));
  });

  it('classifies safe, warning, and clipping peaks without clipping floating-point DSP', () => {
    expect(peakState(0.5)).toBe('safe');
    expect(peakState(10 ** (-2 / 20))).toBe('warning');
    expect(peakState(1)).toBe('warning');
    expect(peakState(1.0001)).toBe('clipping');

    const source = { channels: [new Float32Array([0.25])], sampleRate: 8_000 };
    const analysis = applyVolumeFadesInPlace(source, {
      ...DEFAULT_OPTIONS,
      gainPercent: 500,
    });
    expect(analysis.outputPeak).toBe(1.25);
    expect(source.channels[0]![0]).toBe(1.25);
  });

  it('projects manual gain from the post-envelope estimate instead of the unfaded source peak', () => {
    const preview = previewBinnedVolumeFades(
      new Float32Array([1, 0]),
      2,
      {
        ...DEFAULT_OPTIONS,
        fadeInSeconds: 2,
        gainPercent: 150,
      },
    );

    expect(preview.waveform[0]).toBe(0.75);
    expect(preview.analysis.outputPeak).toBe(0.75);
    expect(peakState(preview.analysis.outputPeak)).toBe('safe');
  });

  it('reports manual-gain clipping when no fade attenuates the source peak', () => {
    const preview = previewBinnedVolumeFades(
      new Float32Array([0.991, 0]),
      0.01,
      {
        ...DEFAULT_OPTIONS,
        gainPercent: 101,
      },
    );

    expect(preview.analysis.outputPeak).toBeCloseTo(0.991 * 1.01, 6);
    expect(peakState(preview.analysis.outputPeak)).toBe('clipping');
  });

  it('rejects invalid controls, malformed PCM, and non-finite samples', () => {
    expect(() =>
      analyzeVolumeFades(
        { channels: [new Float32Array(1)], sampleRate: 8_000 },
        { ...DEFAULT_OPTIONS, gainPercent: 501 },
      ),
    ).toThrow('between 0% and 500%');
    expect(() =>
      analyzeVolumeFades(
        { channels: [new Float32Array(1), new Float32Array(2)], sampleRate: 8_000 },
        DEFAULT_OPTIONS,
      ),
    ).toThrow('equal lengths');
    expect(() =>
      analyzeVolumeFades(
        { channels: [new Float32Array([Number.NaN])], sampleRate: 8_000 },
        DEFAULT_OPTIONS,
      ),
    ).toThrow('finite');
    expect(() =>
      analyzeVolumeFades(
        { channels: [new Float32Array(8_000)], sampleRate: 8_000 },
        { ...DEFAULT_OPTIONS, fadeOutSeconds: 1.01 },
      ),
    ).toThrow('cannot exceed');
  });

  it('rejects non-finite float WAV samples during worker analysis', async () => {
    const replies: WorkerReply[] = [];
    await processAudioRequest(
      { type: 'analyze', file: floatWavFile(Number.NaN) },
      (reply) => replies.push(reply),
    );

    expect(replies.at(-1)).toMatchObject({
      type: 'error',
      message: 'WAV audio samples must be finite.',
    });
    expect(replies.some((reply) => reply.type === 'analyzed')).toBe(false);
  });

  it('normalizes and encodes WAV through the shared worker with monotonic progress', async () => {
    const file = wavFile(new Float32Array([0, 0.25, -0.5, 0.125]), 8_000);
    const replies: WorkerReply[] = [];
    await processAudioRequest(
      {
        type: 'volume-fades',
        file,
        format: 'wav',
        options: { ...DEFAULT_OPTIONS, normalize: true },
      },
      (reply) => replies.push(reply),
    );

    const progress = replies.filter((reply) => reply.type === 'progress').map((reply) => reply.value);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
    const result = replies.find((reply) => reply.type === 'result');
    expect(result?.type).toBe('result');
    if (result?.type !== 'result') throw new Error('Expected a WAV result.');
    const view = new DataView(result.buffer);
    const samples = Array.from(
      { length: view.getUint32(40, true) / 2 },
      (_, index) => view.getInt16(44 + index * 2, true) / 0x8000,
    );
    expect(Math.max(...samples.map(Math.abs))).toBeCloseTo(10 ** (NORMALIZE_TARGET_DBFS / 20), 4);
  });

  it('starts a cancellable file-transform worker with validated settings', async () => {
    const originalWorker = globalThis.Worker;
    let posted: unknown;
    let terminated = false;
    class FakeWorker {
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      postMessage(message: unknown) {
        posted = message;
      }

      terminate() {
        terminated = true;
      }
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker;

    try {
      const file = new File([new Uint8Array(1)], 'volume.wav');
      const job = startVolumeFadesEncode(file, DEFAULT_OPTIONS, 'wav', () => undefined);
      expect(posted).toMatchObject({
        type: 'volume-fades',
        file,
        format: 'wav',
        options: DEFAULT_OPTIONS,
      });
      job.cancel();
      await expect(job.result).rejects.toThrow('Export cancelled.');
      expect(terminated).toBe(true);
    } finally {
      globalThis.Worker = originalWorker;
    }
  });
});
