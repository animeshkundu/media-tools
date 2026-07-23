import { describe, expect, it, vi } from 'vitest';
import { LiveSidechainDucker } from '../lib/tools/multitrack/ducking';
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
import { startMultitrackMixdown } from '../lib/tools/multitrack/startMixdown';
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
  it('disconnects the live ducking analyser from its dialogue source', () => {
    const analyser = {
      fftSize: 0,
      getFloatTimeDomainData: vi.fn(),
    } as unknown as AnalyserNode;
    const dialogue = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as AudioNode;
    const musicGain = {
      gain: {
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
    } as unknown as GainNode;
    const context = {
      createAnalyser: () => analyser,
      currentTime: 0,
    } as unknown as BaseAudioContext;
    const scheduler = {
      request: vi.fn(() => 1),
      cancel: vi.fn(),
    };
    const ducker = new LiveSidechainDucker(
      context,
      dialogue,
      musicGain,
      createEmptyTimeline().autoDucking,
      scheduler,
    );

    ducker.stop();
    expect(dialogue.disconnect).toHaveBeenCalledWith(analyser);
  });

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

  it('runs deterministic mixdown and WAV encoding behind the worker message contract', async () => {
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
                  playbackRate: 1,
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
    const input = {
      state,
      pcmByAssetId: {
        tone: {
          sampleRate: 8_000,
          channelData: [new Float32Array(800).fill(0.25)],
        },
      },
    };
    const replies: MixdownWorkerReply[] = [];
    await processMixdownRequest(
      {
        type: 'mixdown',
        format: 'wav',
        input,
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

    const globals = globalThis as Record<string, unknown>;
    const savedLamejs = globals.lamejs;
    globals.lamejs = {
      Mp3Encoder: class {
        encodeBuffer(): Int8Array {
          return new Int8Array([0xff, 0xfb, 0x90]);
        }
        flush(): Int8Array {
          return new Int8Array([0x00]);
        }
      },
    };
    const mp3Replies: MixdownWorkerReply[] = [];
    try {
      await processMixdownRequest(
        { type: 'mixdown', format: 'mp3', input },
        (reply) => mp3Replies.push(reply),
      );
    } finally {
      globals.lamejs = savedLamejs;
    }
    const mp3Result = mp3Replies.find(
      (reply): reply is Extract<MixdownWorkerReply, { type: 'result' }> =>
        reply.type === 'result',
    );
    expect(mp3Result?.mime).toBe('audio/mpeg');
    expect(mp3Result?.buffer.byteLength).toBeGreaterThan(0);
    expect(
      mp3Replies
        .filter(
          (reply): reply is Extract<MixdownWorkerReply, { type: 'progress' }> =>
            reply.type === 'progress',
        )
        .map((reply) => reply.value),
    ).toContain(1);
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

    const failedCleanupStore = manager.store('cancelled_cleanup', file);
    failedCleanupStore.cancel();
    const failedCleanupRequest = worker.posted.at(-1)!;
    worker.reply({
      type: 'error',
      requestId: failedCleanupRequest.requestId,
      message: 'storage denied',
    });
    await expect(failedCleanupStore.result).rejects.toMatchObject({
      name: 'OPFSOperationCancelledError',
      message: expect.stringContaining('cache cleanup failed: storage denied'),
    });

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

  it('terminates the mixdown worker when initial postMessage fails', async () => {
    const terminate = vi.fn();
    class ThrowingWorker {
      onmessage: ((event: MessageEvent<MixdownWorkerReply>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(): void {
        throw new Error('structured clone failed');
      }

      terminate(): void {
        terminate();
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);
    const base = createEmptyTimeline('Setup failure');
    const state: TimelineState = {
      ...base,
      assets: {
        tone: {
          id: 'tone',
          name: 'tone.wav',
          mimeType: 'audio/wav',
          byteLength: 320,
          duration: 0.01,
          sampleRate: 8_000,
          channels: 1,
          source: { kind: 'memory' },
        },
      },
      tracks: base.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              clips: [
                {
                  id: 'tone-clip',
                  assetId: 'tone',
                  startTime: 0,
                  trimStart: 0,
                  duration: 0.01,
                  playbackRate: 1,
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

    try {
      const job = startMultitrackMixdown(
        {
          state,
          pcmByAssetId: {
            tone: {
              sampleRate: 8_000,
              channelData: [new Float32Array(80)],
            },
          },
        },
        'wav',
        vi.fn(),
      );
      await expect(job.result).rejects.toThrow('structured clone failed');
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
