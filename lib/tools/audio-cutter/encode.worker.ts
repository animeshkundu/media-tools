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

type Mp3Frame = {
  channels: number;
  data: Uint8Array;
  sampleRate: number;
};

const BACKPRESSURE_OUTPUTS = 4;
const HEADER_LIMIT_BYTES = 1024 * 1024;
const MAX_CHANNELS = 2;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30 * 60;
const MAX_SAMPLE_RATE = 192_000;
const READ_FRAMES = 16_384;
const WATCHDOG_MS = 30_000;
const WAVEFORM_POINTS = 2_048;
const WORKER_MAX_INPUT_BYTES = 64 * 1024 * 1024;

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

function parseMp3Header(data: Uint8Array, offset: number): Omit<Mp3Frame, 'data'> & { length: number } | undefined {
  const first = data[offset];
  const second = data[offset + 1];
  const third = data[offset + 2];
  const fourth = data[offset + 3];
  if (
    first !== 0xff ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    (second & 0xe0) !== 0xe0
  ) {
    return undefined;
  }
  const versionBits = (second >> 3) & 0x03;
  const layerBits = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return undefined;
  }

  const mpeg1 = versionBits === 3;
  const bitrates = mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rateDivisor = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = [44_100, 48_000, 32_000][sampleRateIndex]! / rateDivisor;
  const bitrate = bitrates[bitrateIndex]!;
  const padding = (third >> 1) & 1;
  const length = Math.floor(((mpeg1 ? 144_000 : 72_000) * bitrate) / sampleRate) + padding;
  return { channels: (fourth >> 6) === 3 ? 1 : 2, length, sampleRate };
}

async function* streamMp3Frames(file: Blob, send: SendReply): AsyncGenerator<Mp3Frame> {
  const reader = file.stream().getReader();
  let pending = new Uint8Array();
  let bytesRead = 0;
  let skipped = 0;
  let id3Checked = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        const combined = new Uint8Array(pending.length + value.length);
        combined.set(pending);
        combined.set(value, pending.length);
        pending = combined;
        bytesRead += value.length;
      }

      let offset = 0;
      if (!id3Checked && pending.length >= 10) {
        id3Checked = true;
        if (String.fromCharCode(...pending.subarray(0, 3)) === 'ID3') {
          const tagSize =
            ((pending[6]! & 0x7f) << 21) |
            ((pending[7]! & 0x7f) << 14) |
            ((pending[8]! & 0x7f) << 7) |
            (pending[9]! & 0x7f);
          const totalTagSize = 10 + tagSize + ((pending[5]! & 0x10) !== 0 ? 10 : 0);
          if (totalTagSize > HEADER_LIMIT_BYTES) throw new Error('MP3 metadata exceeds the supported limit.');
          if (pending.length < totalTagSize && !done) continue;
          if (pending.length < totalTagSize) throw new Error('The MP3 metadata is truncated.');
          offset = totalTagSize;
        }
      }

      while (offset + 4 <= pending.length) {
        const header = parseMp3Header(pending, offset);
        if (!header) {
          offset += 1;
          skipped += 1;
          if (skipped > HEADER_LIMIT_BYTES) throw new Error('Only valid PCM WAV or MP3 input is supported.');
          continue;
        }
        if (offset + header.length > pending.length) {
          if (done) throw new Error('The MP3 audio data is truncated.');
          break;
        }
        yield {
          channels: header.channels,
          data: pending.slice(offset, offset + header.length),
          sampleRate: header.sampleRate,
        };
        offset += header.length;
      }
      pending = pending.slice(offset);
      send({ type: 'progress', value: 0.05 + 0.5 * Math.min(1, bytesRead / file.size) });
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function compactWaveform(peaks: number[]): Float32Array {
  if (peaks.length <= WAVEFORM_POINTS) return Float32Array.from(peaks);
  const waveform = new Float32Array(WAVEFORM_POINTS);
  for (let index = 0; index < peaks.length; index += 1) {
    const point = Math.min(WAVEFORM_POINTS - 1, Math.floor((index * WAVEFORM_POINTS) / peaks.length));
    waveform[point] = Math.max(waveform[point] ?? 0, peaks[index] ?? 0);
  }
  return waveform;
}

async function decodeMp3(
  file: Blob,
  request: AudioRequest,
  send: SendReply,
): Promise<{ duration: number; pcm?: AudioPcm; sampleRate: number; waveform?: Float32Array }> {
  if (typeof AudioDecoder === 'undefined') {
    throw new Error('This browser cannot decode MP3 audio in a worker. Use PCM WAV input.');
  }

  let decoder: AudioDecoder | undefined;
  let processing = Promise.resolve();
  let processingError: unknown;
  let stopped = false;
  let sampleRate = 0;
  let channelCount = 0;
  let decodedFrames = 0;
  let frameCount = 0;
  let pendingOutputCount = 0;
  let pendingOutputBytes = 0;
  const peaks: number[] = [];
  const selectedChunks: (Float32Array | null)[][] = [];

  const consume = async (audioData: AudioData): Promise<void> => {
    const audioBytes = audioData.numberOfFrames * audioData.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    try {
      const nextDecodedFrames = decodedFrames + audioData.numberOfFrames;
      const decodedBytes = nextDecodedFrames * audioData.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
      if (
        nextDecodedFrames / audioData.sampleRate > MAX_DURATION_SECONDS ||
        !Number.isSafeInteger(decodedBytes) ||
        decodedBytes > MAX_DECODED_BYTES
      ) {
        throw new Error('The decoded audio exceeds the 30 minute or 256 MB processing limit.');
      }

      const startFrame =
        request.type === 'encode' ? Math.max(0, Math.round(request.startSeconds * audioData.sampleRate)) : 0;
      const endFrame =
        request.type === 'encode'
          ? Math.max(startFrame, Math.round(request.endSeconds * audioData.sampleRate))
          : 0;
      let peak = 0;
      for (let channel = 0; channel < audioData.numberOfChannels; channel += 1) {
        const plane = new Float32Array(audioData.numberOfFrames);
        await audioData.copyTo(plane, { format: 'f32-planar', planeIndex: channel });
        if (request.type === 'analyze') {
          for (const sample of plane) peak = Math.max(peak, Math.abs(sample));
        } else {
          const overlapStart = Math.max(decodedFrames, startFrame);
          const overlapEnd = Math.min(nextDecodedFrames, endFrame);
          if (overlapEnd > overlapStart) {
            selectedChunks[channel] ??= [];
            selectedChunks[channel]!.push(
              plane.slice(overlapStart - decodedFrames, overlapEnd - decodedFrames),
            );
          }
        }
      }
      if (request.type === 'analyze') peaks.push(peak);
      decodedFrames = nextDecodedFrames;
    } finally {
      audioData.close();
      pendingOutputCount -= 1;
      pendingOutputBytes -= audioBytes;
    }
  };

  try {
    for await (const frame of streamMp3Frames(file, send)) {
      if (stopped || processingError) break;
      if (!decoder) {
        sampleRate = frame.sampleRate;
        channelCount = frame.channels;
        const config: AudioDecoderConfig = { codec: 'mp3', sampleRate, numberOfChannels: channelCount };
        const support = await AudioDecoder.isConfigSupported(config);
        if (!support.supported) throw new Error('This browser cannot decode this MP3 audio in a worker.');
        selectedChunks.push(...Array.from({ length: channelCount }, () => []));
        decoder = new AudioDecoder({
          error: (error) => {
            stopped = true;
            processingError = error;
          },
          output: (audioData) => {
            if (stopped) {
              audioData.close();
              return;
            }
            const outputBytes =
              audioData.numberOfFrames * audioData.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
            if (pendingOutputBytes + outputBytes > MAX_DECODED_BYTES) {
              stopped = true;
              processingError = new Error(
                'The decoded audio exceeds the 30 minute or 256 MB processing limit.',
              );
              audioData.close();
              return;
            }
            pendingOutputCount += 1;
            pendingOutputBytes += outputBytes;
            processing = processing
              .catch(() => undefined)
              .then(() => consume(audioData))
              .catch((error: unknown) => {
                stopped = true;
                processingError = error;
              });
          },
        });
        decoder.configure(config);
      } else if (sampleRate !== frame.sampleRate || channelCount !== frame.channels) {
        throw new Error('MP3 stream format changes are not supported.');
      }

      // Pre-decode hard cap: project decoded PCM bytes for this frame before feeding the decoder.
      // This bounds the native decoder's in-flight queue independently of output callback timing.
      const frameSamples = frame.sampleRate >= 32_000 ? 1152 : 576;
      const projectedPcmBytes = (frameCount + frameSamples) * channelCount * Float32Array.BYTES_PER_ELEMENT;
      if (
        projectedPcmBytes > MAX_DECODED_BYTES ||
        (frameCount + frameSamples) / sampleRate > MAX_DURATION_SECONDS
      ) {
        throw new Error('The decoded audio exceeds the 30 minute or 256 MB processing limit.');
      }

      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round((frameCount * 1_000_000) / sampleRate),
          data: frame.data,
        }),
      );
      frameCount += frameSamples;
      if (
        decoder.decodeQueueSize >= BACKPRESSURE_OUTPUTS ||
        pendingOutputCount >= BACKPRESSURE_OUTPUTS ||
        pendingOutputBytes >= MAX_DECODED_BYTES
      ) {
        await processing;
        if (processingError) throw processingError;
      }
    }
    if (!decoder) throw new Error('Only valid PCM WAV or MP3 input is supported.');
    // Only flush if we haven't stopped due to an error; flushing after a cap trip would
    // process the entire remaining stream.
    if (!stopped) {
      await decoder.flush();
    }
    await processing;
    if (processingError) throw processingError;
    if (decodedFrames < 1) throw new Error('The MP3 file contains no decodable audio.');

    if (request.type === 'analyze') {
      return {
        duration: decodedFrames / sampleRate,
        sampleRate,
        waveform: compactWaveform(peaks),
      };
    }

    // O(N) concat: iterate by index and null each entry after copying to halve peak memory.
    const channels = selectedChunks.map((chunks) => {
      const length = chunks.reduce((acc, chunk) => acc + (chunk?.length ?? 0), 0);
      const channel = new Float32Array(length);
      let offset = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        if (chunk) {
          channel.set(chunk, offset);
          offset += chunk.length;
          chunks[index] = null;
        }
      }
      return channel;
    });
    if (!channels[0]?.length) throw new Error('Select a non-empty audio region.');
    send({ type: 'progress', value: 0.6 });
    return { duration: decodedFrames / sampleRate, pcm: { channels, sampleRate }, sampleRate };
  } finally {
    if (decoder && decoder.state !== 'closed') decoder.close();
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

async function encodeWav(source: AudioPcm, send: SendReply): Promise<ArrayBuffer> {
  const channelCount = source.channels.length;
  if (channelCount < 1) throw new Error('No audio channels to encode.');
  const frames = source.channels.reduce((min, ch) => Math.min(min, ch.length), Infinity);
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
  if (channels.length < 1 || !channels[0]?.length) throw new Error('No audio data to encode.');
  const frames = channels.reduce((min, ch) => Math.min(min, ch.length), Infinity);
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

async function runAudioRequest(request: AudioRequest, send: SendReply): Promise<void> {
  if (!(request.file instanceof Blob)) throw new Error('Invalid audio request.');
  if (request.file.size === 0) throw new Error('Choose a non-empty audio file.');
  if (request.file.size > WORKER_MAX_INPUT_BYTES) throw new Error('Choose an audio file smaller than 64 MB.');
  if (request.type === 'encode') {
    if (!Number.isFinite(request.startSeconds) || !Number.isFinite(request.endSeconds)) {
      throw new Error('The selected audio region is invalid.');
    }
    if (request.format !== 'wav' && request.format !== 'mp3') throw new Error('Unsupported output format.');
  }

  send({ type: 'progress', value: 0 });
  const signature = new Uint8Array(await request.file.slice(0, 12).arrayBuffer());
  const isWav =
    signature.length >= 12 &&
    String.fromCharCode(...signature.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...signature.subarray(8, 12)) === 'WAVE';
  if (!isWav) {
    const decoded = await decodeMp3(request.file, request, send);
    if (request.type === 'analyze') {
      const waveform = decoded.waveform!;
      send({ type: 'progress', value: 1 });
      send(
        {
          type: 'analyzed',
          duration: decoded.duration,
          sampleRate: decoded.sampleRate,
          waveform,
        },
        [waveform.buffer],
      );
      return;
    }
    const pcm = decoded.pcm!;
    try {
      const buffer = request.format === 'wav' ? await encodeWav(pcm, send) : await encodeMp3(pcm, send);
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
      pcm.channels.length = 0;
    }
    return;
  }

  const metadata = await readWavMetadata(request.file);
  if (request.type === 'analyze') {
    const waveform = await analyzeWav(request.file, metadata, send);
    send({ type: 'progress', value: 1 });
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
}

export async function processAudioRequest(request: AudioRequest, send: SendReply): Promise<void> {
  let watchdogId: ReturnType<typeof setTimeout> | undefined;
  let watchdogReject: ((error: Error) => void) | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    watchdogReject = reject;
  });
  const resetWatchdog = (): void => {
    clearTimeout(watchdogId);
    watchdogId = setTimeout(
      () => watchdogReject?.(new Error('Audio processing timed out.')),
      WATCHDOG_MS,
    );
  };
  const watchedSend: SendReply = (reply, transfer) => {
    if (reply.type === 'progress') resetWatchdog();
    send(reply, transfer);
  };
  resetWatchdog();
  try {
    await Promise.race([runAudioRequest(request, watchedSend), watchdog]);
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Audio processing failed.' });
  } finally {
    clearTimeout(watchdogId);
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
