import { describe, expect, it, vi } from 'vitest';
import { MAX_PCM_ENCODE_BYTES } from '../lib/core/worker';

vi.mock('@/components/Button', () => ({ Button: () => null }));
vi.mock('@/components/Progress', () => ({ Progress: () => null }));
vi.mock('@/lib/core/download', () => ({ downloadBlob: () => undefined }));
vi.mock(
  '@/lib/core/format',
  () => ({
    formatBytes: () => '',
    formatDuration: () => '',
    outputName: () => '',
  }),
);
vi.mock(
  '@/lib/core/worker',
  () => ({
    MAX_INPUT_BYTES: 64 * 1024 * 1024,
    MAX_PCM_ENCODE_BYTES,
  }),
);
vi.mock(
  '@/lib/tools/join/join',
  () => ({
    startJoinedEncode: () => ({ cancel: () => undefined, result: Promise.resolve(new Blob()) }),
  }),
);

const { AGGREGATE_PCM_LIMIT_MESSAGE, decodedPcmBytesForTracks, tryRetainDecodedTrack } = await import(
  '../entrypoints/app/JoinMergeTool'
);

function makeTrack(frames: number): { channelData: Float32Array[] } {
  return { channelData: [new Float32Array(frames)] };
}

describe('JoinMergeTool aggregate decoded PCM cap', () => {
  it('rejects retaining an added track when cumulative decoded PCM exceeds 256 MB', () => {
    const bytesPerFrame = Float32Array.BYTES_PER_ELEMENT;
    const framesJustBelowLimit = Math.floor(MAX_PCM_ENCODE_BYTES / bytesPerFrame) - 2;
    const retainedTracks = [makeTrack(framesJustBelowLimit)];
    const retainedBefore = retainedTracks.length;
    const retainedBytes = decodedPcmBytesForTracks(retainedTracks);
    const overLimitTrack = makeTrack(3);

    const retainAttempt = tryRetainDecodedTrack(retainedBytes, overLimitTrack);
    if (retainAttempt.ok) retainedTracks.push(overLimitTrack);

    expect(retainAttempt).toEqual({ ok: false, validation: AGGREGATE_PCM_LIMIT_MESSAGE });
    expect(AGGREGATE_PCM_LIMIT_MESSAGE).toMatch(/\b256\b.*\bMB\b/);
    expect(retainedTracks).toHaveLength(retainedBefore);
  });
});
