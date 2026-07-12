import {
  validateAudioConvertRequest,
  type AudioConvertInput,
  type AudioConvertSettings,
} from './audio-convert';
import type { AudioConvertWorkerMessage, AudioConvertWorkerRequest } from './convert.worker';

type WorkerLike = {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<AudioConvertWorkerMessage>) => void) | null;
  postMessage(message: AudioConvertWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
};

export type AudioConvertJob = {
  cancel: () => void;
  result: Promise<Blob>;
};

function rejectedJob(error: unknown): AudioConvertJob {
  return {
    cancel: () => undefined,
    result: Promise.reject(error instanceof Error ? error : new Error('Audio conversion could not start.')),
  };
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
}

function copyInput(input: AudioConvertInput): { input: AudioConvertInput; transfer: Transferable[] } {
  if ('channelData' in input) {
    const channelData = input.channelData.map((channel) => channel.slice());
    return { input: { channelData, sampleRate: input.sampleRate }, transfer: channelData.map((channel) => channel.buffer) };
  }
  const encodedData = input.encodedData.slice(0);
  return { input: { encodedData }, transfer: [encodedData] };
}

export function startAudioConversion(
  input: AudioConvertInput,
  settings: AudioConvertSettings,
  onProgress: (value: number) => void,
  createWorker: () => WorkerLike = defaultWorkerFactory,
): AudioConvertJob {
  try {
    validateAudioConvertRequest(input, settings);
  } catch (error) {
    return rejectedJob(error);
  }
  let worker: WorkerLike;
  try {
    worker = createWorker();
  } catch (error) {
    return rejectedJob(error);
  }
  let settled = false;
  let rejectJob: (reason: Error) => void = () => undefined;

  const settle = (): boolean => {
    if (settled) return false;
    settled = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    return true;
  };

  const result = new Promise<Blob>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event) => {
      if (settled) return;
      if (event.data.type === 'progress') {
        onProgress(Math.max(0, Math.min(1, event.data.value)));
        return;
      }
      if (!settle()) return;
      if (event.data.type === 'error') {
        reject(new Error(event.data.message));
      } else if (event.data.buffer.byteLength === 0) {
        reject(new Error('Audio conversion produced no output.'));
      } else {
        resolve(new Blob([event.data.buffer], { type: event.data.mime }));
      }
    };
    worker.onerror = () => {
      if (!settle()) return;
      reject(new Error('The audio conversion worker stopped unexpectedly.'));
    };

    try {
      const copied = copyInput(input);
      worker.postMessage({ input: copied.input, settings }, copied.transfer);
    } catch (error) {
      if (settle()) reject(error instanceof Error ? error : new Error('Audio conversion could not start.'));
    }
  });

  return {
    result,
    cancel: () => {
      if (settle()) rejectJob(new DOMException('Conversion cancelled.', 'AbortError'));
    },
  };
}
