import { cutPcm, encodeWav, type AudioPcm } from './audio';

interface Mp3EncoderInstance {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
}

type Mp3EncoderConstructor = new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderInstance;

declare const lamejs: { Mp3Encoder: Mp3EncoderConstructor };

importScripts(new URL('../vendor/lame.min.js', self.location.href).href);

type EncodeRequest = {
  channels: Float32Array[];
  endSeconds: number;
  format: 'wav' | 'mp3';
  sampleRate: number;
  startSeconds: number;
};

type WorkerReply =
  | { type: 'progress'; value: number }
  | { type: 'result'; buffer: ArrayBuffer; mime: string }
  | { type: 'error'; message: string };

const workerScope = self as unknown as {
  postMessage(message: WorkerReply, transfer: Transferable[]): void;
};

function send(reply: WorkerReply, transfer?: Transferable[]): void {
  workerScope.postMessage(reply, transfer ?? []);
}

function toInt16(source: Float32Array): Int16Array {
  const output = new Int16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function encodeMp3(source: AudioPcm): ArrayBuffer {
  const channels = source.channels.slice(0, 2);
  const left = toInt16(channels[0]);
  const right = channels[1] ? toInt16(channels[1]) : undefined;
  const encoder = new lamejs.Mp3Encoder(channels.length, source.sampleRate, 192);
  const chunks: Uint8Array[] = [];
  const blockSize = 1152;

  for (let offset = 0; offset < left.length; offset += blockSize) {
    const chunk = encoder.encodeBuffer(
      left.subarray(offset, offset + blockSize),
      right?.subarray(offset, offset + blockSize),
    );
    if (chunk.length) chunks.push(new Uint8Array(chunk));
    send({ type: 'progress', value: 0.15 + 0.8 * Math.min(1, (offset + blockSize) / left.length) });
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output.buffer;
}

self.onmessage = (event: MessageEvent<EncodeRequest>) => {
  try {
    send({ type: 'progress', value: 0.05 });
    const cut = cutPcm(
      { channels: event.data.channels, sampleRate: event.data.sampleRate },
      event.data.startSeconds,
      event.data.endSeconds,
    );
    send({ type: 'progress', value: 0.15 });
    const buffer = event.data.format === 'wav' ? encodeWav(cut) : encodeMp3(cut);
    send(
      {
        type: 'result',
        buffer,
        mime: event.data.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      },
      [buffer],
    );
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Audio export failed.' });
  }
};
