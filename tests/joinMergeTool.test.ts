import { describe, expect, it } from 'vitest';
import { MAX_PCM_ENCODE_BYTES } from '../lib/core/worker';
import {
  AGGREGATE_PCM_LIMIT_MESSAGE,
  decodedPcmBytesForTracks,
  tryRetainDecodedTrack,
} from '../entrypoints/app/JoinMergeTool';

function makeTrack(frames: number): { channelData: Float32Array[] } {
  return { channelData: [new Float32Array(frames)] };
}

describe('JoinMergeTool aggregate decoded PCM cap', () => {
  it('rejects retaining an added track when cumulative decoded PCM exceeds 256 MB', () => {
    const retainedTracks = [makeTrack(Math.floor(MAX_PCM_ENCODE_BYTES / Float32Array.BYTES_PER_ELEMENT) - 2)];
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
