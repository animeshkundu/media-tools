import {
  MAX_PCM_ENCODE_BYTES,
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
const CONVERT_PCM_LIMIT_ERROR_MESSAGE = 'Decoded audio exceeds the 256 MB processing limit.';

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
  const frameCount = input.channelData[0]?.length;
  for (let i = 0; i < input.channelData.length; i += 1) {
    if (!(i in input.channelData) || !(input.channelData[i] instanceof Float32Array)) {
      throw new Error('Audio channel data is invalid.');
    }
    if (input.channelData[i].length !== frameCount) {
      throw new Error('Audio channels must contain the same number of samples.');
    }
  }
  if (frameCount === 0) {
    throw new Error('Audio contains no samples.');
  }
  return frameCount;
}

function assertProjectedPcmWithinLimit(frameCount: number, channelCount: number): void {
  const projectedSamples = frameCount * channelCount;
  const projectedBytes = projectedSamples * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(projectedSamples) || !Number.isSafeInteger(projectedBytes)) {
    throw new Error(CONVERT_PCM_LIMIT_ERROR_MESSAGE);
  }
  if (projectedBytes > MAX_PCM_ENCODE_BYTES) {
    throw new Error(CONVERT_PCM_LIMIT_ERROR_MESSAGE);
  }
}

export function startConversion(
  input: DecodedPcm,
  format: EncodeFormat,
  onProgress: (value: number) => void = () => undefined,
): EncodeJob {
  const frameCount = validateInput(input, format);
  assertProjectedPcmWithinLimit(frameCount, input.channelData.length);
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
