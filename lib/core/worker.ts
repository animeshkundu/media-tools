export type EncodeFormat = 'wav' | 'mp3';

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;

type EncodeInput = {
  endSeconds: number;
  file: File;
  format: EncodeFormat;
  startSeconds: number;
};

type WorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'analyzed'; duration: number; sampleRate: number; waveform: Float32Array }
  | { type: 'result'; buffer: ArrayBuffer; mime: string }
  | { type: 'error'; message: string };

export type AudioAnalysis = {
  duration: number;
  sampleRate: number;
  waveform: Float32Array;
};

export type AudioJob<T> = {
  cancel: () => void;
  result: Promise<T>;
};

export type EncodeJob = AudioJob<Blob>;

function validateFile(file: File): void {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Choose an audio file smaller than 64 MB.');
  }
  if (file.size === 0) throw new Error('Choose a non-empty audio file.');
}

function startWorker<T>(
  request: object,
  file: File,
  onProgress: (value: number) => void,
  readResult: (message: WorkerMessage) => T | undefined,
): AudioJob<T> {
  validateFile(file);
  const worker = new Worker(new URL('../tools/audio-cutter/encode.worker.ts', import.meta.url));
  let settled = false;
  let rejectJob: (reason: Error) => void = () => undefined;

  const result = new Promise<T>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (settled) return;
      if (event.data.type === 'progress') {
        onProgress(Math.max(0, Math.min(1, event.data.value)));
        return;
      }
      if (event.data.type === 'error') {
        settled = true;
        worker.terminate();
        reject(new Error(event.data.message));
        return;
      }
      const value = readResult(event.data);
      if (value !== undefined) {
        settled = true;
        worker.terminate();
        resolve(value);
      }
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error('The audio worker stopped unexpectedly.'));
    };
    worker.postMessage(request);
  });

  return {
    result,
    cancel: () => {
      if (!settled) {
        settled = true;
        worker.terminate();
        rejectJob(new Error('Audio processing cancelled.'));
      }
    },
  };
}

export function startAnalyze(
  file: File,
  onProgress: (value: number) => void,
): AudioJob<AudioAnalysis> {
  return startWorker(
    { type: 'analyze', file },
    file,
    onProgress,
    (message) =>
      message.type === 'analyzed'
        ? { duration: message.duration, sampleRate: message.sampleRate, waveform: message.waveform }
        : undefined,
  );
}

export function startEncode(
  input: EncodeInput,
  onProgress: (value: number) => void,
): EncodeJob {
  return startWorker(
    { type: 'encode', ...input },
    input.file,
    onProgress,
    (message) =>
      message.type === 'result' ? new Blob([message.buffer], { type: message.mime }) : undefined,
  );
}
