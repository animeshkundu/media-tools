export type EncodeFormat = 'wav' | 'mp3';

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_PCM_CHANNELS = 2;
export const MAX_PCM_ENCODE_BYTES = 256 * 1024 * 1024;

type PcmEncodeInput = {
  channels: Float32Array[];
  endSeconds: number;
  format: EncodeFormat;
  sampleRate: number;
  startSeconds: number;
};

type FileEncodeInput = {
  endSeconds: number;
  file: File;
  format: EncodeFormat;
  startSeconds: number;
};

type WorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'analyzed'; duration: number; sampleRate: number; waveform: Float32Array }
  | { type: 'decoded'; channelData: Float32Array[]; sampleRate: number }
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
export type DecodeJob = AudioJob<{ channelData: Float32Array[]; sampleRate: number }>;

function validateFile(file: File): void {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Choose an audio file smaller than 64 MB.');
  }
  if (file.size === 0) throw new Error('Choose a non-empty audio file.');
}

function validatePcmEncodeInput(input: PcmEncodeInput): void {
  if (input.channels.length < 1 || input.channels.length > MAX_PCM_CHANNELS) {
    throw new Error('The selected audio exceeds mono/stereo channel limits.');
  }
  let totalBytes = 0;
  for (const channel of input.channels) {
    totalBytes += channel.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PCM_ENCODE_BYTES) {
      throw new Error('The selected audio exceeds the 256 MB processing limit.');
    }
  }
}

function startFileWorker<T>(
  request: object,
  file: File,
  onProgress: (value: number) => void,
  readResult: (message: WorkerMessage) => T | undefined,
  cancelMessage = 'Audio processing cancelled.',
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
        rejectJob(new Error(cancelMessage));
      }
    },
  };
}

export function startAnalyze(
  file: File,
  onProgress: (value: number) => void,
): AudioJob<AudioAnalysis> {
  return startFileWorker(
    { type: 'analyze', file },
    file,
    onProgress,
    (message) =>
      message.type === 'analyzed'
        ? { duration: message.duration, sampleRate: message.sampleRate, waveform: message.waveform }
        : undefined,
  );
}

export function startFileEncode(
  input: FileEncodeInput,
  onProgress: (value: number) => void,
): EncodeJob {
  return startFileWorker(
    { type: 'encode', ...input },
    input.file,
    onProgress,
    (message) =>
      message.type === 'result' ? new Blob([message.buffer], { type: message.mime }) : undefined,
    'Export cancelled.',
  );
}

export function startFileTransform(
  file: File,
  request: object,
  onProgress: (value: number) => void,
  cancelMessage = 'Audio processing cancelled.',
): EncodeJob {
  return startFileWorker(
    { ...request, file },
    file,
    onProgress,
    (message) =>
      message.type === 'result' ? new Blob([message.buffer], { type: message.mime }) : undefined,
    cancelMessage,
  );
}

export function startDecodeFile(
  file: File,
  onProgress: (value: number) => void,
): DecodeJob {
  return startFileWorker(
    { type: 'decode-file', file },
    file,
    onProgress,
    (message) =>
      message.type === 'decoded'
        ? { channelData: message.channelData, sampleRate: message.sampleRate }
        : undefined,
  );
}

export function startEncode(input: PcmEncodeInput, onProgress: (value: number) => void): EncodeJob {
  validatePcmEncodeInput(input);
  const worker = new Worker(new URL('../tools/audio-cutter/encode.worker.ts', import.meta.url));
  let settled = false;
  let rejectJob: (reason: Error) => void = () => undefined;

  const result = new Promise<Blob>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (settled) return;
      if (event.data.type === 'progress') {
        onProgress(Math.max(0, Math.min(1, event.data.value)));
        return;
      }
      settled = true;
      worker.terminate();
      if (event.data.type === 'result') resolve(new Blob([event.data.buffer], { type: event.data.mime }));
      else if (event.data.type === 'error') reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error('The audio worker stopped unexpectedly.'));
    };
    const channels = input.channels.map((channel) => channel.slice());
    worker.postMessage(
      {
        type: 'encode-pcm',
        channels,
        sampleRate: input.sampleRate,
        startSeconds: input.startSeconds,
        endSeconds: input.endSeconds,
        format: input.format,
      },
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
