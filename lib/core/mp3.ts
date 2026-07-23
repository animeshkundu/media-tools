interface Mp3EncoderInstance {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
}

type Mp3EncoderConstructor = new (
  channels: number,
  sampleRate: number,
  kbps: number,
) => Mp3EncoderInstance;

declare const lamejs: { Mp3Encoder: Mp3EncoderConstructor };

export interface Mp3Pcm {
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
}

function toInt16(source: Float32Array, start: number, end: number): Int16Array {
  const output = new Int16Array(end - start);
  for (let index = start; index < end; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] ?? 0));
    output[index - start] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export async function encodeMp3Pcm(
  source: Mp3Pcm,
  onProgress: (value: number) => void = () => undefined,
): Promise<ArrayBuffer> {
  const channels = source.channels.slice(0, 2);
  if (channels.length < 1 || !channels[0]?.length) throw new Error('No audio data to encode.');
  if (!Number.isInteger(source.sampleRate) || source.sampleRate < 8_000 || source.sampleRate > 192_000) {
    throw new Error('The MP3 sample rate is unsupported.');
  }
  const frames = channels.reduce((minimum, channel) => Math.min(minimum, channel.length), Infinity);
  const encoder = new lamejs.Mp3Encoder(channels.length, source.sampleRate, 192);
  const chunks: Uint8Array[] = [];
  const blockSize = 1_152;

  for (let offset = 0; offset < frames; offset += blockSize) {
    const end = Math.min(frames, offset + blockSize);
    const chunk = encoder.encodeBuffer(
      toInt16(channels[0]!, offset, end),
      channels[1] ? toInt16(channels[1], offset, end) : undefined,
    );
    if (chunk.length > 0) chunks.push(new Uint8Array(chunk));
    onProgress(end / frames);
    await Promise.resolve();
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) chunks.push(new Uint8Array(finalChunk));
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(size);
  let writeOffset = 0;
  for (const chunk of chunks) {
    output.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  return output.buffer;
}
