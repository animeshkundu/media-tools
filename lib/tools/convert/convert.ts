import { type AudioPcm, encodeWav } from '../audio-cutter/audio';
import {
  startEncode,
  type EncodeFormat,
  type EncodeJob,
} from '../../core/worker';

export type { EncodeFormat, EncodeJob };

export type DecodedPcm = {
  channelData: Float32Array[];
  sampleRate: number;
};

export const CONVERT_FORMATS = ['wav', 'mp3'] as const satisfies readonly EncodeFormat[];

const MAX_PCM_BYTES = 512 * 1024 * 1024;

function validateInput(input: DecodedPcm, format: EncodeFormat): number {
  if (!CONVERT_FORMATS.includes(format)) {
    throw new Error('Select a supported output format.');
  }
  if (!Number.isInteger(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('Audio sample rate is invalid.');
  }
  if (input.channelData.length < 1 || input.channelData.length > 2) {
    throw new Error('Conversion supports mono or stereo audio.');
  }
  if (input.channelData.some((channel) => !(channel instanceof Float32Array))) {
    throw new Error('Audio channel data is invalid.');
  }

  const frameCount = input.channelData[0].length;
  if (frameCount === 0) {
    throw new Error('Audio contains no samples.');
  }
  if (input.channelData.some((channel) => channel.length !== frameCount)) {
    throw new Error('Audio channels must contain the same number of samples.');
  }

  const pcmBytes = frameCount * input.channelData.length * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(pcmBytes) || pcmBytes > MAX_PCM_BYTES) {
    throw new Error('Decoded audio exceeds the conversion size limit.');
  }
  return frameCount;
}

function startWavEncode(input: DecodedPcm, onProgress: (value: number) => void): EncodeJob {
  let settled = false;
  let rejectJob: (reason: Error) => void = () => undefined;
  const result = new Promise<Blob>((resolve, reject) => {
    rejectJob = reject;
    queueMicrotask(() => {
      if (settled) return;
      try {
        onProgress(0);
        const source: AudioPcm = {
          channels: input.channelData,
          sampleRate: input.sampleRate,
        };
        const buffer = encodeWav(source);
        if (settled) return;
        settled = true;
        onProgress(1);
        resolve(new Blob([buffer], { type: 'audio/wav' }));
      } catch (error) {
        settled = true;
        reject(error instanceof Error ? error : new Error('WAV export failed.'));
      }
    });
  });

  return {
    result,
    cancel: () => {
      if (!settled) {
        settled = true;
        rejectJob(new Error('Export cancelled.'));
      }
    },
  };
}

export function startConversion(
  input: DecodedPcm,
  format: EncodeFormat,
  onProgress: (value: number) => void = () => undefined,
): EncodeJob {
  const frameCount = validateInput(input, format);
  if (format === 'wav') {
    return startWavEncode(input, onProgress);
  }
  return startEncode(
    {
      channels: input.channelData,
      endSeconds: frameCount / input.sampleRate,
      format,
      sampleRate: input.sampleRate,
      startSeconds: 0,
    },
    onProgress,
  );
}
