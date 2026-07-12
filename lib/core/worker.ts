export type EncodeFormat = 'wav' | 'mp3';

type EncodeInput = {
  channels: Float32Array[];
  endSeconds: number;
  format: EncodeFormat;
  sampleRate: number;
  startSeconds: number;
};

type WorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'result'; buffer: ArrayBuffer; mime: string }
  | { type: 'error'; message: string };

export type EncodeJob = {
  cancel: () => void;
  result: Promise<Blob>;
};

export function startEncode(input: EncodeInput, onProgress: (value: number) => void): EncodeJob {
  const worker = new Worker(new URL('../tools/audio-cutter/encode.worker.ts', import.meta.url));
  let settled = false;
  let rejectJob: (reason: Error) => void = () => undefined;
  const result = new Promise<Blob>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'progress') {
        onProgress(event.data.value);
        return;
      }
      settled = true;
      worker.terminate();
      if (event.data.type === 'result') resolve(new Blob([event.data.buffer], { type: event.data.mime }));
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      settled = true;
      worker.terminate();
      reject(new Error('The audio worker stopped unexpectedly.'));
    };
    const channels = input.channels.map((channel) => channel.slice());
    worker.postMessage(
      { ...input, channels },
      channels.map((channel) => channel.buffer),
    );
  });
  return {
    result,
    cancel: () => {
      if (!settled) {
        settled = true;
        worker.terminate();
        rejectJob(new Error('Export cancelled.'));
      }
    },
  };
}
