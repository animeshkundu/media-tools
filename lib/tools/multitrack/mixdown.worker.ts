import { encodeMp3Pcm } from '../../core/mp3';
import { mixTimeline, type MultitrackMixInput } from './mixdown';
import { encodeStereoWav } from './wav';

export type MixdownWorkerRequest = {
  readonly type: 'mixdown';
  readonly input: MultitrackMixInput;
  readonly format: 'wav' | 'mp3';
};

export type MixdownWorkerReply =
  | { readonly type: 'progress'; readonly value: number }
  | { readonly type: 'result'; readonly buffer: ArrayBuffer; readonly mime: 'audio/wav' | 'audio/mpeg' }
  | { readonly type: 'error'; readonly message: string };

type SendReply = (reply: MixdownWorkerReply, transfer?: Transferable[]) => void;

export async function processMixdownRequest(
  request: MixdownWorkerRequest,
  send: SendReply,
): Promise<void> {
  try {
    if (request.type !== 'mixdown') throw new Error('Invalid multitrack worker request.');
    if (request.format !== 'wav' && request.format !== 'mp3') {
      throw new Error('Invalid multitrack output format.');
    }
    const mixed = mixTimeline(request.input, (value) =>
      send({ type: 'progress', value: value * 0.82 }),
    );
    const buffer =
      request.format === 'wav'
        ? encodeStereoWav(mixed.channelData[0], mixed.channelData[1], mixed.sampleRate)
        : await encodeMp3Pcm(
            { channels: mixed.channelData, sampleRate: mixed.sampleRate },
            (value) => send({ type: 'progress', value: 0.82 + value * 0.18 }),
          );
    send({ type: 'progress', value: 1 });
    send(
      {
        type: 'result',
        buffer,
        mime: request.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      },
      [buffer],
    );
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : 'Multitrack export failed.',
    });
  }
}
if (typeof importScripts === 'function') {
  importScripts(new URL('../vendor/lame.min.js', self.location.href).href);
  const workerScope = self as unknown as {
    postMessage(message: MixdownWorkerReply, transfer: Transferable[]): void;
  };
  self.onmessage = (event: MessageEvent<MixdownWorkerRequest>) => {
    void processMixdownRequest(event.data, (reply, transfer) =>
      workerScope.postMessage(reply, transfer ?? []),
    );
  };
}
