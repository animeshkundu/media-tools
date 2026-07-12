import {
  convertAudioToBuffer,
  type AudioConvertInput,
  type AudioConvertSettings,
  type ConvertedAudio,
} from './audio-convert';

export type AudioConvertWorkerRequest = {
  input: AudioConvertInput;
  settings: AudioConvertSettings;
};

export type AudioConvertWorkerMessage =
  | { type: 'progress'; value: number }
  | ({ type: 'result' } & ConvertedAudio)
  | { type: 'error'; message: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AudioConvertWorkerRequest>) => void) | null;
  postMessage(message: AudioConvertWorkerMessage, transfer?: Transferable[]): void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    const output = convertAudioToBuffer(request.input, request.settings, {
      onProgress: (value) => workerScope.postMessage({ type: 'progress', value }),
    });
    workerScope.postMessage({ type: 'result', ...output }, [output.buffer]);
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Audio conversion failed.',
    });
  } finally {
    if ('channelData' in request.input) request.input.channelData.length = 0;
    else request.input.encodedData = new ArrayBuffer(0);
  }
};
