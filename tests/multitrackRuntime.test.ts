import { describe, expect, it } from 'vitest';
import {
  OPFSAssetManager,
  OPFSOperationCancelledError,
  validateOPFSAssetKey,
  validateOPFSSlice,
} from '../lib/tools/multitrack/opfs';
import type {
  OPFSWorkerReply,
  OPFSWorkerRequest,
} from '../lib/tools/multitrack/opfs.worker';
import {
  processMixdownRequest,
  type MixdownWorkerReply,
} from '../lib/tools/multitrack/mixdown.worker';
import { createEmptyTimeline, type TimelineState } from '../lib/tools/multitrack/schema';
import { encodeStereoWav } from '../lib/tools/multitrack/wav';

class FakeWorker {
  onmessage: ((event: MessageEvent<OPFSWorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: OPFSWorkerRequest[] = [];
  terminated = false;

  postMessage(message: OPFSWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(reply: OPFSWorkerReply): void {
    this.onmessage?.(new MessageEvent('message', { data: reply }));
  }
}

describe('multitrack workers and storage adapter', () => {
  it('encodes a bounded stereo PCM mix as a valid 16-bit WAV', () => {
    const buffer = encodeStereoWav(
      new Float32Array([0, 1, -1]),
      new Float32Array([0.5, -0.5, 0]),
      48_000,
    );
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(12);
  });

  it('runs deterministic mixdown and WAV encoding behind the worker message contract', () => {
    const base = createEmptyTimeline('Worker mix');
    const state: TimelineState = {
      ...base,
      assets: {
        tone: {
          id: 'tone',
          name: 'tone.wav',
          mimeType: 'audio/wav',
          byteLength: 2_000,
          duration: 0.1,
          sampleRate: 8_000,
          channels: 1,
          source: { kind: 'memory' },
        },
      },
      tracks: base.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              eqPreset: 'flat',
              clips: [
                {
                  id: 'tone-clip',
                  assetId: 'tone',
                  startTime: 0,
                  trimStart: 0,
                  duration: 0.1,
                  gain: 1,
                  fadeIn: 0,
                  fadeOut: 0,
                  fadeCurve: 'linear',
                },
              ],
            }
          : track,
      ),
    };
    const replies: MixdownWorkerReply[] = [];
    processMixdownRequest(
      {
        type: 'mixdown',
        input: {
          state,
          pcmByAssetId: {
            tone: {
              sampleRate: 8_000,
              channelData: [new Float32Array(800).fill(0.25)],
            },
          },
        },
      },
      (reply) => replies.push(reply),
    );

    expect(replies.at(-1)?.type).toBe('result');
    const result = replies.find(
      (reply): reply is Extract<MixdownWorkerReply, { type: 'result' }> =>
        reply.type === 'result',
    );
    expect(result?.mime).toBe('audio/wav');
    expect(new Uint8Array(result!.buffer, 0, 4)).toEqual(
      new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    );
  });

  it('stores, slices, cancels, and disposes through a dedicated OPFS worker', async () => {
    const worker = new FakeWorker();
    const manager = new OPFSAssetManager(
      () => worker as unknown as Worker,
      '1000-test-session',
    );
    const file = new File([new Uint8Array([1, 2, 3])], 'voice.wav', {
      type: 'audio/wav',
    });
    const store = manager.store('voice_1', file);
    const storeRequest = worker.posted[0]!;
    worker.reply({
      type: 'stored',
      requestId: storeRequest.requestId,
      path: 'multitrack-assets/1000-test-session/voice_1',
    });
    await expect(store.result).resolves.toEqual({
      kind: 'opfs',
      path: 'multitrack-assets/1000-test-session/voice_1',
    });

    const slice = manager.readSlice('voice_1', 0, 3);
    const sliceRequest = worker.posted[1]!;
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    worker.reply({ type: 'slice', requestId: sliceRequest.requestId, buffer });
    await expect(slice.result).resolves.toEqual(buffer);

    const cancelledStore = manager.store('cancelled', file);
    cancelledStore.cancel();
    expect(worker.posted.at(-2)?.type).toBe('cancel');
    expect(worker.posted.at(-1)?.type).toBe('remove');
    const cleanupRequest = worker.posted.at(-1)!;
    worker.reply({ type: 'removed', requestId: cleanupRequest.requestId });
    await expect(cancelledStore.result).rejects.toBeInstanceOf(
      OPFSOperationCancelledError,
    );

    const cleanup = manager.cleanupStaleSessions();
    const staleRequest = worker.posted.at(-1)!;
    worker.reply({ type: 'cleaned', requestId: staleRequest.requestId });
    await expect(cleanup).resolves.toBeUndefined();

    const clear = manager.clearSession();
    const clearRequest = worker.posted.at(-1)!;
    worker.reply({ type: 'cleared', requestId: clearRequest.requestId });
    await expect(clear).resolves.toBeUndefined();

    manager.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('rejects path traversal and oversized random-access reads before worker work', () => {
    expect(() => validateOPFSAssetKey('../escape')).toThrow('OPFS asset keys');
    expect(() => validateOPFSSlice(0, 8 * 1024 * 1024 + 1)).toThrow(
      'no larger than 8 MB',
    );
    const manager = new OPFSAssetManager(
      () => new FakeWorker() as unknown as Worker,
      '1000-test-session',
    );
    expect(() => manager.cleanupStaleSessions(1_000)).toThrow('at least one minute');
    manager.dispose();
  });
});
