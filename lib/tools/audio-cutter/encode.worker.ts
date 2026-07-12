import type { AudioPcm } from './audio';

interface Mp3EncoderInstance {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
}

type Mp3EncoderConstructor = new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderInstance;

declare const lamejs: { Mp3Encoder: Mp3EncoderConstructor };

export type AudioRequest =
  | { type: 'analyze'; file: File }
  | {
      type: 'encode';
      file: File;
      endSeconds: number;
      format: 'wav' | 'mp3';
      startSeconds: number;
    };

export type WorkerReply =
  | { type: 'progress'; value: number }
  | { type: 'analyzed'; duration: number; sampleRate: number; waveform: Float32Array }
  | { type: 'result'; buffer: ArrayBuffer; mime: string }
  | { type: 'error'; message: string };

type WavMetadata = {
  bitsPerSample: number;
  blockAlign: number;
  channels: number;
  dataOffset: number;
  dataSize: number;
  format: number;
  frames: number;
  sampleRate: number;
};

type SendReply = (reply: WorkerReply, transfer?: Transferable[]) => void;

const HEADER_LIMIT_BYTES = 1024 * 1024;
const MAX_CHANNELS = 2;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30 * 60;
const MAX_SAMPLE_RATE = 192_000;
const READ_FRAMES = 16_384;
const WAVEFORM_POINTS = 2_048;

function ascii(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

async function readWavMetadata(file: Blob): Promise<WavMetadata> {
  const header = await file.slice(0, Math.min(file.size, HEADER_LIMIT_BYTES)).arrayBuffer();
  const view = new DataView(header);
  if (view.byteLength < 12 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
    throw new Error('Only valid PCM WAV input is supported.');
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataOffset = 0;
  let dataSize = 0;

  for (let offset = 12; offset + 8 <= view.byteLength; ) {
    const chunk = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const contentOffset = offset + 8;
    const nextOffset = contentOffset + size + (size & 1);
    if (!Number.isSafeInteger(nextOffset) || nextOffset > file.size + 1) {
      throw new Error('The WAV file contains invalid chunk sizes.');
    }
    if (chunk === 'fmt ') {
      if (size < 16 || contentOffset + 16 > view.byteLength) {
        throw new Error('The WAV format header is truncated.');
      }
      format = view.getUint16(contentOffset, true);
      channels = view.getUint16(contentOffset + 2, true);
      sampleRate = view.getUint32(contentOffset + 4, true);
      blockAlign = view.getUint16(contentOffset + 12, true);
      bitsPerSample = view.getUint16(contentOffset + 14, true);
    } else if (chunk === 'data') {
      dataOffset = contentOffset;
      dataSize = size;
      break;
    }
    if (nextOffset > view.byteLength) {
      throw new Error('WAV metadata exceeds the supported limit.');
    }
    offset = nextOffset;
  }

  const bytesPerSample = bitsPerSample / 8;
  if (
    !dataOffset ||
    !dataSize ||
    (format !== 1 && format !== 3) ||
    channels < 1 ||
    channels > MAX_CHANNELS ||
    sampleRate < 8_000 ||
    sampleRate > MAX_SAMPLE_RATE ||
    ![8, 16, 24, 32].includes(bitsPerSample) ||
    (format === 3 && bitsPerSample !== 32) ||
    blockAlign !== channels * bytesPerSample
  ) {
    throw new Error('The WAV format is not supported. Use mono or stereo PCM WAV audio.');
  }
  if (dataOffset + dataSize > file.size) throw new Error('The WAV audio data is truncated.');

  const frames = Math.floor(dataSize / blockAlign);
  const duration = frames / sampleRate;
  const decodedBytes = frames * channels * Float32Array.BYTES_PER_ELEMENT;
  if (
    frames < 1 ||
    duration > MAX_DURATION_SECONDS ||
    !Number.isSafeInteger(decodedBytes) ||
    decodedBytes > MAX_DECODED_BYTES
  ) {
    throw new Error('The decoded audio exceeds the 30 minute or 256 MB processing limit.');
  }
  return { bitsPerSample, blockAlign, channels, dataOffset, dataSize, format, frames, sampleRate };
}

function readSample(view: DataView, offset: number, metadata: WavMetadata): number {
  if (metadata.format === 3) return Math.max(-1, Math.min(1, view.getFloat32(offset, true)));
  if (metadata.bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
  if (metadata.bitsPerSample === 16) return view.getInt16(offset, true) / 0x8000;
  if (metadata.bitsPerSample === 24) {
    const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
    return value / 0x800000;
  }
  return view.getInt32(offset, true) / 0x80000000;
}

async function analyzeWav(
  file: Blob,
  metadata: WavMetadata,
  send: SendReply,
): Promise<Float32Array> {
  const pointCount = Math.min(WAVEFORM_POINTS, metadata.frames);
  const waveform = new Float32Array(pointCount);
  for (let frameOffset = 0; frameOffset < metadata.frames; frameOffset += READ_FRAMES) {
    const frameCount = Math.min(READ_FRAMES, metadata.frames - frameOffset);
    const buffer = await file
      .slice(
        metadata.dataOffset + frameOffset * metadata.blockAlign,
        metadata.dataOffset + (frameOffset + frameCount) * metadata.blockAlign,
      )
      .arrayBuffer();
    const view = new DataView(buffer);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const point = Math.min(pointCount - 1, Math.floor(((frameOffset + frame) * pointCount) / metadata.frames));
      let peak = waveform[point] ?? 0;
      for (let channel = 0; channel < metadata.channels; channel += 1) {
        const offset = frame * metadata.blockAlign + channel * (metadata.bitsPerSample / 8);
        peak = Math.max(peak, Math.abs(readSample(view, offset, metadata)));
      }
      waveform[point] = peak;
    }
    send({ type: 'progress', value: 0.05 + (0.9 * (frameOffset + frameCount)) / metadata.frames });
  }
  return waveform;
}

async function decodeWavRegion(
  file: Blob,
  metadata: WavMetadata,
  startSeconds: number,
  endSeconds: number,
  send: SendReply,
): Promise<AudioPcm> {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new Error('The selected audio region is invalid.');
  }
  const startFrame = Math.max(0, Math.min(metadata.frames, Math.round(startSeconds * metadata.sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(metadata.frames, Math.round(endSeconds * metadata.sampleRate)));
  const selectedFrames = endFrame - startFrame;
  const selectedBytes = selectedFrames * metadata.channels * Float32Array.BYTES_PER_ELEMENT;
  if (selectedFrames < 1) throw new Error('Select a non-empty audio region.');
  if (!Number.isSafeInteger(selectedBytes) || selectedBytes > MAX_DECODED_BYTES) {
    throw new Error('The selected audio exceeds the 256 MB processing limit.');
  }

  const channels = Array.from({ length: metadata.channels }, () => new Float32Array(selectedFrames));
  for (let relativeFrame = 0; relativeFrame < selectedFrames; relativeFrame += READ_FRAMES) {
    const frameCount = Math.min(READ_FRAMES, selectedFrames - relativeFrame);
    const sourceFrame = startFrame + relativeFrame;
    const buffer = await file
      .slice(
        metadata.dataOffset + sourceFrame * metadata.blockAlign,
        metadata.dataOffset + (sourceFrame + frameCount) * metadata.blockAlign,
      )
      .arrayBuffer();
    const view = new DataView(buffer);
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < metadata.channels; channel += 1) {
        const offset = frame * metadata.blockAlign + channel * (metadata.bitsPerSample / 8);
        channels[channel]![relativeFrame + frame] = readSample(view, offset, metadata);
      }
    }
    send({ type: 'progress', value: 0.05 + (0.55 * (relativeFrame + frameCount)) / selectedFrames });
  }
  return { channels, sampleRate: metadata.sampleRate };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

async function encodeWav(source: AudioPcm, send: SendReply): Promise<ArrayBuffer> {
  const frames = source.channels[0]?.length ?? 0;
  const channelCount = source.channels.length;
  const dataBytes = frames * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, source.sampleRate, true);
  view.setUint32(28, source.sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let frameOffset = 0; frameOffset < frames; frameOffset += READ_FRAMES) {
    const frameEnd = Math.min(frames, frameOffset + READ_FRAMES);
    for (let frame = frameOffset; frame < frameEnd; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = Math.max(-1, Math.min(1, source.channels[channel]?.[frame] ?? 0));
        view.setInt16(44 + (frame * channelCount + channel) * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
    }
    send({ type: 'progress', value: 0.6 + (0.35 * frameEnd) / frames });
    await Promise.resolve();
  }
  return buffer;
}

function toInt16(source: Float32Array, start: number, end: number): Int16Array {
  const output = new Int16Array(end - start);
  for (let index = start; index < end; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] ?? 0));
    output[index - start] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

async function encodeMp3(source: AudioPcm, send: SendReply): Promise<ArrayBuffer> {
  const channels = source.channels.slice(0, 2);
  const frames = channels[0]?.length ?? 0;
  const encoder = new lamejs.Mp3Encoder(channels.length, source.sampleRate, 192);
  const chunks: Uint8Array[] = [];
  const blockSize = 1152;

  for (let offset = 0; offset < frames; offset += blockSize) {
    const end = Math.min(frames, offset + blockSize);
    const chunk = encoder.encodeBuffer(
      toInt16(channels[0]!, offset, end),
      channels[1] ? toInt16(channels[1], offset, end) : undefined,
    );
    if (chunk.length) chunks.push(new Uint8Array(chunk));
    send({ type: 'progress', value: 0.6 + 0.35 * (end / frames) });
    await Promise.resolve();
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output.buffer;
}

export async function processAudioRequest(request: AudioRequest, send: SendReply): Promise<void> {
  try {
    send({ type: 'progress', value: 0 });
    const metadata = await readWavMetadata(request.file);
    if (request.type === 'analyze') {
      const waveform = await analyzeWav(request.file, metadata, send);
      send(
        {
          type: 'analyzed',
          duration: metadata.frames / metadata.sampleRate,
          sampleRate: metadata.sampleRate,
          waveform,
        },
        [waveform.buffer],
      );
      return;
    }

    const decoded = await decodeWavRegion(
      request.file,
      metadata,
      request.startSeconds,
      request.endSeconds,
      send,
    );
    try {
      const buffer =
        request.format === 'wav' ? await encodeWav(decoded, send) : await encodeMp3(decoded, send);
      send({ type: 'progress', value: 1 });
      send(
        {
          type: 'result',
          buffer,
          mime: request.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
        },
        [buffer],
      );
    } finally {
      decoded.channels.length = 0;
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Audio processing failed.' });
  }
}

if (typeof importScripts === 'function') {
  importScripts(new URL('../vendor/lame.min.js', self.location.href).href);
  const workerScope = self as unknown as {
    postMessage(message: WorkerReply, transfer: Transferable[]): void;
  };
  self.onmessage = (event: MessageEvent<AudioRequest>) => {
    void processAudioRequest(event.data, (reply, transfer) =>
      workerScope.postMessage(reply, transfer ?? []),
    );
  };
}
