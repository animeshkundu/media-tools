import lamejs from 'lamejs';
import BitStream from 'lamejs/src/js/BitStream.js';
import Lame from 'lamejs/src/js/Lame.js';
import MPEGMode from 'lamejs/src/js/MPEGMode.js';

export const MAX_ENCODED_INPUT_BYTES = 256 * 1024 * 1024;
export const MAX_PCM_BYTES = 512 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

const WAV_HEADER_BYTES = 44;
const MP3_BLOCK_FRAMES = 1_152;
const MP3_SAMPLE_RATES = new Set([8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000]);
const MP3_BITRATES = new Set([64, 96, 128, 160, 192, 256, 320]);

export type PcmAudio = {
  channelData: Float32Array[];
  sampleRate: number;
};

export type AudioConvertInput = PcmAudio | { encodedData: ArrayBuffer };

export type AudioConvertSettings =
  | { format: 'wav'; bitDepth: 8 | 16 | 24 | 32 }
  | { format: 'mp3'; bitrateKbps: 64 | 96 | 128 | 160 | 192 | 256 | 320 };

export type ConvertHooks = {
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
};

export type ConvertedAudio = {
  buffer: ArrayBuffer;
  mime: 'audio/mpeg' | 'audio/wav';
};

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
}

function reportProgress(onProgress: ConvertHooks['onProgress'], value: number): void {
  onProgress?.(Math.max(0, Math.min(1, value)));
}

function checkedProduct(...values: number[]): number {
  const result = values.reduce((product, value) => product * value, 1);
  if (!Number.isSafeInteger(result)) throw new Error('Audio size is too large.');
  return result;
}

function validatePcmBounds(audio: PcmAudio): number {
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate <= 0 || audio.sampleRate > 384_000) {
    throw new Error('Audio sample rate is invalid or unsupported.');
  }
  if (audio.channelData.length < 1 || audio.channelData.length > 2) {
    throw new Error('Conversion supports mono or stereo audio.');
  }
  const frames = audio.channelData[0]?.length ?? 0;
  if (frames === 0) throw new Error('Audio contains no samples.');
  if (audio.channelData.some((channel) => channel.length !== frames)) {
    throw new Error('Audio channels must contain the same number of samples.');
  }
  const pcmBytes = checkedProduct(frames, audio.channelData.length, Float32Array.BYTES_PER_ELEMENT);
  if (pcmBytes > MAX_PCM_BYTES) throw new Error('Decoded audio exceeds the conversion size limit.');
  return frames;
}

function validatePcm(audio: PcmAudio): number {
  const frames = validatePcmBounds(audio);
  for (const channel of audio.channelData) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new Error('Audio contains an invalid sample.');
    }
  }
  return frames;
}

function validateMp3Settings(sampleRate: number, bitrateKbps: number): void {
  if (!MP3_SAMPLE_RATES.has(sampleRate)) throw new Error('MP3 sample rate is unsupported.');
  if (!MP3_BITRATES.has(bitrateKbps) || (sampleRate < 32_000 && bitrateKbps > 160)) {
    throw new Error('MP3 bitrate is unsupported for this sample rate.');
  }
}

export function validateAudioConvertRequest(input: AudioConvertInput, settings: AudioConvertSettings): void {
  if ('channelData' in input) validatePcmBounds(input);
  else if (input.encodedData.byteLength === 0) throw new Error('Audio input is empty.');
  else if (input.encodedData.byteLength > MAX_ENCODED_INPUT_BYTES) {
    throw new Error('Audio input exceeds the conversion size limit.');
  }

  if (settings.format === 'wav') {
    if (![8, 16, 24, 32].includes(settings.bitDepth)) throw new Error('WAV PCM bit depth is unsupported.');
  } else if (!MP3_BITRATES.has(settings.bitrateKbps)) {
    throw new Error('MP3 bitrate is unsupported.');
  } else if ('channelData' in input) {
    validateMp3Settings(input.sampleRate, settings.bitrateKbps);
  }
}

function ascii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

function readPcmSample(view: DataView, offset: number, bitDepth: number): number {
  if (bitDepth === 8) return (view.getUint8(offset) - 128) / 128;
  if (bitDepth === 16) return view.getInt16(offset, true) / 0x8000;
  if (bitDepth === 24) {
    const unsigned = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    return (unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned) / 0x800000;
  }
  return view.getInt32(offset, true) / 0x80000000;
}

function writePcmSample(view: DataView, offset: number, bitDepth: number, input: number): void {
  const sample = Math.max(-1, Math.min(1, input));
  if (bitDepth === 8) {
    view.setUint8(offset, Math.max(0, Math.min(255, Math.round((sample + 1) * 127.5))));
  } else if (bitDepth === 16) {
    view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
  } else if (bitDepth === 24) {
    const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
    view.setUint8(offset, value & 0xff);
    view.setUint8(offset + 1, (value >> 8) & 0xff);
    view.setUint8(offset + 2, (value >> 16) & 0xff);
  } else {
    view.setInt32(offset, Math.round(sample < 0 ? sample * 0x80000000 : sample * 0x7fffffff), true);
  }
}

export function decodeWav(encodedData: ArrayBuffer, hooks: ConvertHooks = {}): PcmAudio {
  abortIfRequested(hooks.signal);
  if (encodedData.byteLength === 0) throw new Error('Audio input is empty.');
  if (encodedData.byteLength > MAX_ENCODED_INPUT_BYTES) throw new Error('Audio input exceeds the conversion size limit.');
  if (encodedData.byteLength < 12) throw new Error('Audio input is not a valid WAV file.');

  const view = new DataView(encodedData);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('This conversion core supports encoded PCM WAV input.');
  }
  const containerBytes = view.getUint32(4, true) + 8;
  if (containerBytes < 12 || containerBytes > view.byteLength) throw new Error('WAV input has an invalid RIFF size.');

  let format: { bitDepth: number; channels: number; sampleRate: number } | undefined;
  let dataOffset = -1;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= containerBytes) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + size > containerBytes) throw new Error('WAV input contains a truncated chunk.');
    if (id === 'fmt ') {
      if (size < 16 || view.getUint16(payload, true) !== 1) {
        throw new Error('WAV input must contain uncompressed PCM audio.');
      }
      format = {
        channels: view.getUint16(payload + 2, true),
        sampleRate: view.getUint32(payload + 4, true),
        bitDepth: view.getUint16(payload + 14, true),
      };
    } else if (id === 'data') {
      dataOffset = payload;
      dataBytes = size;
      break;
    }
    offset = payload + size + (size & 1);
  }

  if (!format || dataOffset < 0) throw new Error('WAV input is missing required format or audio data.');
  if (![8, 16, 24, 32].includes(format.bitDepth)) throw new Error('WAV PCM bit depth is unsupported.');
  if (format.channels < 1 || format.channels > 2) throw new Error('Conversion supports mono or stereo audio.');
  const bytesPerSample = format.bitDepth / 8;
  const blockAlign = checkedProduct(format.channels, bytesPerSample);
  if (dataBytes === 0 || dataBytes % blockAlign !== 0) throw new Error('WAV audio data is empty or misaligned.');
  const frames = dataBytes / blockAlign;
  const pcmBytes = checkedProduct(frames, format.channels, Float32Array.BYTES_PER_ELEMENT);
  if (pcmBytes > MAX_PCM_BYTES) throw new Error('Decoded audio exceeds the conversion size limit.');

  const channelData = Array.from({ length: format.channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    abortIfRequested(hooks.signal);
    for (let channel = 0; channel < format.channels; channel += 1) {
      channelData[channel][frame] = readPcmSample(
        view,
        dataOffset + (frame * format.channels + channel) * bytesPerSample,
        format.bitDepth,
      );
    }
    if ((frame & 0x3fff) === 0) reportProgress(hooks.onProgress, frame / frames);
  }
  reportProgress(hooks.onProgress, 1);
  return { channelData, sampleRate: format.sampleRate };
}

function encodeWav(audio: PcmAudio, bitDepth: 8 | 16 | 24 | 32, hooks: ConvertHooks): ArrayBuffer {
  const frames = validatePcm(audio);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = checkedProduct(audio.channelData.length, bytesPerSample);
  const dataBytes = checkedProduct(frames, blockAlign);
  const outputBytes = WAV_HEADER_BYTES + dataBytes;
  if (dataBytes > 0xffffffff - 36 || outputBytes > MAX_OUTPUT_BYTES) {
    throw new Error('WAV output exceeds the conversion size limit.');
  }

  const buffer = new ArrayBuffer(outputBytes);
  const view = new DataView(buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, outputBytes - 8, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, audio.channelData.length, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, checkedProduct(audio.sampleRate, blockAlign), true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  ascii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    abortIfRequested(hooks.signal);
    for (const channel of audio.channelData) {
      writePcmSample(view, offset, bitDepth, channel[frame]);
      offset += bytesPerSample;
    }
    if ((frame & 0x3fff) === 0) reportProgress(hooks.onProgress, frame / frames);
  }
  reportProgress(hooks.onProgress, 1);
  return buffer;
}

function toInt16(channel: Float32Array): Int16Array {
  const output = new Int16Array(channel.length);
  for (let index = 0; index < channel.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, channel[index]));
    output[index] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
  }
  return output;
}

function encodeMp3(audio: PcmAudio, bitrateKbps: number, hooks: ConvertHooks): ArrayBuffer {
  const frames = validatePcm(audio);
  validateMp3Settings(audio.sampleRate, bitrateKbps);
  const estimatedBytes = Math.ceil((frames / audio.sampleRate) * bitrateKbps * 125) + 16_384;
  if (estimatedBytes > MAX_OUTPUT_BYTES) throw new Error('MP3 output exceeds the conversion size limit.');

  const lameRuntime = globalThis as typeof globalThis & { BitStream?: unknown; Lame?: unknown; MPEGMode?: unknown };
  const previous = {
    BitStream: lameRuntime.BitStream,
    Lame: lameRuntime.Lame,
    MPEGMode: lameRuntime.MPEGMode,
  };
  try {
    lameRuntime.BitStream = BitStream;
    lameRuntime.Lame = Lame;
    lameRuntime.MPEGMode = MPEGMode;
    const channels = audio.channelData.map(toInt16);
    const encoder = new lamejs.Mp3Encoder(channels.length, audio.sampleRate, bitrateKbps);
    const chunks: Uint8Array[] = [];
    let outputBytes = 0;
    for (let offset = 0; offset < frames; offset += MP3_BLOCK_FRAMES) {
      abortIfRequested(hooks.signal);
      const encoded = encoder.encodeBuffer(
        channels[0].subarray(offset, offset + MP3_BLOCK_FRAMES),
        channels[1]?.subarray(offset, offset + MP3_BLOCK_FRAMES),
      );
      if (encoded.length > 0) {
        const chunk = new Uint8Array(encoded);
        chunks.push(chunk);
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) throw new Error('MP3 output exceeds the conversion size limit.');
      }
      reportProgress(hooks.onProgress, Math.min(0.99, (offset + MP3_BLOCK_FRAMES) / frames));
    }
    abortIfRequested(hooks.signal);
    const finalChunk = new Uint8Array(encoder.flush());
    if (finalChunk.length > 0) {
      chunks.push(finalChunk);
      outputBytes += finalChunk.byteLength;
    }
    if (outputBytes === 0 || outputBytes > MAX_OUTPUT_BYTES) throw new Error('MP3 encoder produced no valid output.');

    const output = new Uint8Array(outputBytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    reportProgress(hooks.onProgress, 1);
    return output.buffer;
  } finally {
    if (previous.BitStream === undefined) delete lameRuntime.BitStream;
    else lameRuntime.BitStream = previous.BitStream;
    if (previous.Lame === undefined) delete lameRuntime.Lame;
    else lameRuntime.Lame = previous.Lame;
    if (previous.MPEGMode === undefined) delete lameRuntime.MPEGMode;
    else lameRuntime.MPEGMode = previous.MPEGMode;
  }
}

function asPcm(input: AudioConvertInput, hooks: ConvertHooks): PcmAudio {
  if ('channelData' in input) return input;
  return decodeWav(input.encodedData, hooks);
}

export function convertAudioToBuffer(
  input: AudioConvertInput,
  settings: AudioConvertSettings,
  hooks: ConvertHooks = {},
): ConvertedAudio {
  reportProgress(hooks.onProgress, 0);
  abortIfRequested(hooks.signal);
  validateAudioConvertRequest(input, settings);
  const audio = asPcm(input, {
    signal: hooks.signal,
    onProgress: 'encodedData' in input ? (value) => reportProgress(hooks.onProgress, value * 0.25) : undefined,
  });
  const encodeHooks = {
    signal: hooks.signal,
    onProgress: (value: number) => reportProgress(hooks.onProgress, ('encodedData' in input ? 0.25 : 0) + value * ('encodedData' in input ? 0.75 : 1)),
  };
  if (settings.format === 'wav') {
    return { buffer: encodeWav(audio, settings.bitDepth, encodeHooks), mime: 'audio/wav' };
  }
  return { buffer: encodeMp3(audio, settings.bitrateKbps, encodeHooks), mime: 'audio/mpeg' };
}

export function convertAudio(
  input: AudioConvertInput,
  settings: AudioConvertSettings,
  hooks: ConvertHooks = {},
): Blob {
  const output = convertAudioToBuffer(input, settings, hooks);
  return new Blob([output.buffer], { type: output.mime });
}
