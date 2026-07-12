import { startEncode, type EncodeFormat, type EncodeJob } from '../../core/worker';

export const MIN_SPEED_FACTOR = 0.25;
export const MAX_SPEED_FACTOR = 4;

export type PcmAudio = {
  channelData: Float32Array[];
  sampleRate: number;
};

export function clampSpeedFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error('Speed factor must be a positive finite number.');
  }
  return Math.min(MAX_SPEED_FACTOR, Math.max(MIN_SPEED_FACTOR, factor));
}

export function changeSpeed(source: PcmAudio, factor: number): PcmAudio {
  const effectiveFactor = clampSpeedFactor(factor);
  if (!Number.isFinite(source.sampleRate) || source.sampleRate <= 0) {
    throw new Error('Sample rate must be a positive finite number.');
  }
  if (source.channelData.length === 0) {
    throw new Error('Audio must contain at least one channel.');
  }

  const inputLength = source.channelData[0].length;
  if (source.channelData.some((channel) => channel.length !== inputLength)) {
    throw new Error('Audio channels must have equal lengths.');
  }

  const outputLength = inputLength === 0 ? 0 : Math.max(1, Math.round(inputLength / effectiveFactor));
  if (!Number.isSafeInteger(outputLength)) {
    throw new Error('Resampled audio is too large.');
  }

  const channelData = source.channelData.map((input) => {
    if (effectiveFactor === 1) return input.slice();

    const output = new Float32Array(outputLength);
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const sourcePosition = Math.min(outputIndex * effectiveFactor, inputLength - 1);
      const leftIndex = Math.max(0, Math.floor(sourcePosition));
      const rightIndex = Math.min(leftIndex + 1, inputLength - 1);
      const fraction = sourcePosition - leftIndex;
      const left = input[leftIndex];
      output[outputIndex] = left + (input[rightIndex] - left) * fraction;
    }
    return output;
  });

  return { channelData, sampleRate: source.sampleRate };
}

export function startChangeSpeedEncode(
  source: PcmAudio,
  factor: number,
  format: EncodeFormat,
  onProgress: (value: number) => void,
): EncodeJob {
  const resampled = changeSpeed(source, factor);
  const frameCount = resampled.channelData[0].length;
  return startEncode(
    {
      channels: resampled.channelData,
      endSeconds: frameCount / resampled.sampleRate,
      format,
      sampleRate: resampled.sampleRate,
      startSeconds: 0,
    },
    onProgress,
  );
}
