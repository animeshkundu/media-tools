import { mixTimeline, type MultitrackMixInput } from './mixdown';
import { encodeStereoWav } from './wav';

export type MixdownWorkerRequest = {
  readonly type: 'mixdown';
  readonly input: MultitrackMixInput;
};

export type MixdownWorkerReply =
  | { readonly type: 'progress'; readonly value: number }
  | { readonly type: 'result'; readonly buffer: ArrayBuffer; readonly mime: 'audio/wav' }
  | { readonly type: 'error'; readonly message: string };

type SendReply = (reply: MixdownWorkerReply, transfer?: Transferable[]) => void;

export function processMixdownRequest(request: MixdownWorkerRequest, send: SendReply): void {
  try {
    if (request.type !== 'mixdown') throw new Error('Invalid multitrack worker request.');
    const mixed = mixTimeline(request.input, (value) =>
      send({ type: 'progress', value: value * 0.9 }),
    );
    const buffer = encodeStereoWav(
      mixed.channelData[0],
      mixed.channelData[1],
      mixed.sampleRate,
    );
    send({ type: 'progress', value: 1 });
    send({ type: 'result', buffer, mime: 'audio/wav' }, [buffer]);
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : 'Multitrack export failed.',
    });
  }
}

if (typeof importScripts === 'function') {
  const workerScope = self as unknown as {
    postMessage(message: MixdownWorkerReply, transfer: Transferable[]): void;
  };
  self.onmessage = (event: MessageEvent<MixdownWorkerRequest>) => {
    processMixdownRequest(event.data, (reply, transfer) =>
      workerScope.postMessage(reply, transfer ?? []),
    );
  };
}

