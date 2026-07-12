import { encodeWav } from '../audio-cutter/audio';
import { startEncode, type EncodeFormat, type EncodeJob } from '../../core/worker';

export const MAX_JOIN_OUTPUT_BYTES = 512 * 1024 * 1024;

export type DecodedPcmTrack = {
  channelData: Float32Array[];
  sampleRate: number;
};

export type JoinedPcm = DecodedPcmTrack;

function orderedTracks(
  tracks: readonly DecodedPcmTrack[],
  order?: readonly number[],
): readonly DecodedPcmTrack[] {
  if (!order) return tracks;
  if (order.length !== tracks.length) {
    throw new Error('Track order must include every input exactly once.');
  }

  const seen = new Set<number>();
  return order.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= tracks.length || seen.has(index)) {
      throw new Error('Track order must include every input exactly once.');
    }
    seen.add(index);
    return tracks[index]!;
  });
}

function validateTrack(track: DecodedPcmTrack): number {
  if (!Number.isFinite(track.sampleRate) || track.sampleRate <= 0) {
    throw new Error('Track sample rate must be a positive finite number.');
  }
  if (track.channelData.length === 0 || track.channelData.length > 2) {
    throw new Error('Join supports mono or stereo tracks.');
  }

  const frameCount = track.channelData[0]?.length ?? 0;
  if (frameCount === 0 || track.channelData.some((channel) => channel.length !== frameCount)) {
    throw new Error('Track channels must have the same non-zero frame count.');
  }
  return frameCount;
}

function normalizedFrameCount(frameCount: number, sourceRate: number, outputRate: number): number {
  const normalized = Math.round((frameCount * outputRate) / sourceRate);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error('Joined audio is too large.');
  }
  return normalized;
}

function resampleChannel(
  source: Float32Array,
  sourceRate: number,
  outputRate: number,
  outputFrames: number,
): Float32Array {
  if (source.length === 0) throw new Error('Track channels must contain audio frames.');
  if (sourceRate === outputRate) return source.slice();

  const output = new Float32Array(outputFrames);
  const maxIndex = source.length - 1;
  for (let frame = 0; frame < outputFrames; frame += 1) {
    const sourcePosition = (frame * sourceRate) / outputRate;
    const lowerIndex = Math.min(maxIndex, Math.floor(sourcePosition));
    const upperIndex = Math.min(maxIndex, lowerIndex + 1);
    const fraction = sourcePosition - lowerIndex;
    const lower = source[lowerIndex]!;
    output[frame] = lower + (source[upperIndex]! - lower) * fraction;
  }
  return output;
}

export function joinPcm(
  tracks: readonly DecodedPcmTrack[],
  order?: readonly number[],
): JoinedPcm {
  if (tracks.length === 0) throw new Error('Select at least one audio track.');

  const arrangedTracks = orderedTracks(tracks, order);
  const frameCounts = arrangedTracks.map(validateTrack);
  const sampleRate = Math.max(...arrangedTracks.map((track) => track.sampleRate));
  const channelCount = Math.max(...arrangedTracks.map((track) => track.channelData.length));
  const normalizedLengths = arrangedTracks.map((track, index) => {
    return normalizedFrameCount(frameCounts[index]!, track.sampleRate, sampleRate);
  });
  const totalFrames = normalizedLengths.reduce((total, length) => {
    const next = total + length;
    if (!Number.isSafeInteger(next) || next * channelCount * Float32Array.BYTES_PER_ELEMENT > MAX_JOIN_OUTPUT_BYTES) {
      throw new Error('Joined audio exceeds the 512 MiB decoded PCM limit.');
    }
    return next;
  }, 0);

  const channelData = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));
  let outputOffset = 0;
  arrangedTracks.forEach((track, trackIndex) => {
    const outputFrames = normalizedLengths[trackIndex]!;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      // Falling back to channel zero intentionally duplicates mono input into stereo output.
      const source = track.channelData[channelIndex] ?? track.channelData[0];
      if (!source) throw new Error('Track contains no channel data.');
      channelData[channelIndex]?.set(
        resampleChannel(source, track.sampleRate, sampleRate, outputFrames),
        outputOffset,
      );
    }
    outputOffset += outputFrames;
  });

  return { channelData, sampleRate };
}

export function encodeJoinedWav(
  tracks: readonly DecodedPcmTrack[],
  order?: readonly number[],
): ArrayBuffer {
  const joined = joinPcm(tracks, order);
  return encodeWav({ channels: joined.channelData, sampleRate: joined.sampleRate });
}

export function startJoinedEncode(
  tracks: readonly DecodedPcmTrack[],
  format: EncodeFormat,
  onProgress: (value: number) => void,
  order?: readonly number[],
): EncodeJob {
  const joined = joinPcm(tracks, order);
  return startEncode(
    {
      channels: joined.channelData,
      sampleRate: joined.sampleRate,
      startSeconds: 0,
      endSeconds: (joined.channelData[0]?.length ?? 0) / joined.sampleRate,
      format,
    },
    onProgress,
  );
}
