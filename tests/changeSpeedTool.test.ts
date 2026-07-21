import { describe, expect, it, vi } from 'vitest';
import { MAX_INPUT_BYTES, MAX_PCM_ENCODE_BYTES } from '../lib/core/worker';

vi.mock('@/components/Button', () => ({ Button: () => null }));
vi.mock('@/components/Progress', () => ({ Progress: () => null }));
vi.mock('@/components/ResultCard', () => ({ ResultCard: () => null }));
vi.mock('@/lib/core/download', () => ({ downloadBlob: () => undefined }));
vi.mock('@/lib/core/format', () => ({
  formatBytes: () => '',
  formatDuration: () => '',
  outputName: () => '',
}));
vi.mock('@/lib/core/worker', () => ({
  MAX_INPUT_BYTES,
  MAX_PCM_ENCODE_BYTES,
  startDecodeFile: vi.fn(() => ({
    cancel: () => undefined,
    result: Promise.resolve({ channelData: [new Float32Array(8000)], sampleRate: 8000 }),
  })),
}));
vi.mock('@/lib/core/share', () => ({ createWaveformThumbnail: () => '' }));
vi.mock('@/lib/tools/change-speed/changeSpeed', () => ({
  startChangeSpeedEncode: () => ({ cancel: () => undefined, result: Promise.resolve(new Blob()) }),
}));

const { decodeFileForChangeSpeed } = await import('../entrypoints/app/ChangeSpeedTool');

describe('ChangeSpeedTool worker-routed decode', () => {
  it('happy path: resolves with correct PCM, duration, and sampleRate from startDecodeFile', async () => {
    const frames = 48_000;
    const sampleRate = 48_000;
    const channelData = [new Float32Array(frames)];

    const { startDecodeFile } = await import('@/lib/core/worker');
    vi.mocked(startDecodeFile).mockReturnValueOnce({
      cancel: () => undefined,
      result: Promise.resolve({ channelData, sampleRate }),
    });

    const file = new File([new Uint8Array(1024)], 'test.mp3', { type: 'audio/mpeg' });
    const onProgress = vi.fn();
    const result = await decodeFileForChangeSpeed(file, onProgress);

    expect(result.channelData).toBe(channelData);
    expect(result.sampleRate).toBe(sampleRate);
    expect(result.duration).toBeCloseTo(frames / sampleRate);
    expect(startDecodeFile).toHaveBeenCalledWith(file, onProgress);
  });

  it('rejects when startDecodeFile rejects with the 256 MB pre-decode cap error', async () => {
    const { startDecodeFile } = await import('@/lib/core/worker');
    vi.mocked(startDecodeFile).mockReturnValueOnce({
      cancel: () => undefined,
      result: Promise.reject(new Error('The selected audio exceeds the 256 MB processing limit.')),
    });

    const file = new File([new Uint8Array(1024)], 'big.mp3', { type: 'audio/mpeg' });
    await expect(decodeFileForChangeSpeed(file, () => undefined)).rejects.toThrow(
      /256\s*MB/,
    );
    expect(startDecodeFile).toHaveBeenCalledWith(file, expect.any(Function));
  });

  it('rejects when startDecodeFile enforces the 64 MB input cap synchronously', async () => {
    const worker = await import('@/lib/core/worker');
    vi.mocked(worker.startDecodeFile).mockImplementationOnce(() => {
      throw new Error('Choose an audio file smaller than 64 MB.');
    });

    const oversized = new File([new Uint8Array(MAX_INPUT_BYTES + 1)], 'huge.mp3', {
      type: 'audio/mpeg',
    });
    await expect(decodeFileForChangeSpeed(oversized, () => undefined)).rejects.toThrow(
      /smaller than 64 MB/,
    );
  });

  it('rejects when decoded PCM contains no channels', async () => {
    const { startDecodeFile } = await import('@/lib/core/worker');
    vi.mocked(startDecodeFile).mockReturnValueOnce({
      cancel: () => undefined,
      result: Promise.resolve({ channelData: [], sampleRate: 44_100 }),
    });

    const file = new File([new Uint8Array(128)], 'empty.wav', { type: 'audio/wav' });
    await expect(decodeFileForChangeSpeed(file, () => undefined)).rejects.toThrow(
      'The audio file contains no decodable audio channels.',
    );
  });
});
