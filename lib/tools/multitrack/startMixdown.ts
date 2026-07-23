import type { AudioJob } from '../../core/worker';
import {
  validateMixInput,
  type MultitrackMixInput,
  type MultitrackPcmAsset,
} from './mixdown';
import type { AudioAssetId } from './schema';
import type { MixdownWorkerReply, MixdownWorkerRequest } from './mixdown.worker';

export function startMultitrackMixdown(
  input: MultitrackMixInput,
  onProgress: (value: number) => void,
): AudioJob<Blob> {
  validateMixInput(input);
  const worker = new Worker(new URL('./mixdown.worker.ts', import.meta.url));
  let settled = false;
  let rejectJob: (reason: Error) => void = () => undefined;
  const snapshots: Record<AudioAssetId, MultitrackPcmAsset> = {};
  const transfer: Transferable[] = [];
  for (const [assetId, pcm] of Object.entries(input.pcmByAssetId)) {
    const channelData = pcm.channelData.map((channel) => channel.slice());
    snapshots[assetId] = { sampleRate: pcm.sampleRate, channelData };
    transfer.push(...channelData.map((channel) => channel.buffer));
  }
  const request: MixdownWorkerRequest = {
    type: 'mixdown',
    input: { state: input.state, pcmByAssetId: snapshots },
  };

  const result = new Promise<Blob>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event: MessageEvent<MixdownWorkerReply>) => {
      if (settled) return;
      if (event.data.type === 'progress') {
        onProgress(Math.max(0, Math.min(1, event.data.value)));
        return;
      }
      settled = true;
      worker.terminate();
      if (event.data.type === 'result') {
        resolve(new Blob([event.data.buffer], { type: event.data.mime }));
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error('The multitrack worker stopped unexpectedly.'));
    };
    worker.postMessage(request, transfer);
  });

  return {
    result,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectJob(new Error('Multitrack export cancelled.'));
    },
  };
}

