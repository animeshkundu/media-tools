export type AudioPcm = {
  channels: Float32Array[];
  sampleRate: number;
};

export function cutPcm(source: AudioPcm, startSeconds: number, endSeconds: number): AudioPcm {
  if (source.channels.length === 0 || source.sampleRate <= 0) {
    throw new Error('Audio contains no samples.');
  }
  const total = Math.min(...source.channels.map((channel) => channel.length));
  const start = Math.max(0, Math.min(total, Math.floor(startSeconds * source.sampleRate)));
  const end = Math.max(start, Math.min(total, Math.ceil(endSeconds * source.sampleRate)));
  if (end <= start) throw new Error('Select a non-empty audio region.');
  return {
    sampleRate: source.sampleRate,
    channels: source.channels.map((channel) => channel.slice(start, end)),
  };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeWav(source: AudioPcm): ArrayBuffer {
  if (source.channels.length === 0 || source.channels.length > 2) {
    throw new Error('WAV export supports mono or stereo audio.');
  }
  const frames = Math.min(...source.channels.map((channel) => channel.length));
  const channelCount = source.channels.length;
  const bytesPerSample = 2;
  const dataBytes = frames * channelCount * bytesPerSample;
  // The RIFF `RIFF` and `data` chunk-size fields are 32-bit; `36 + dataBytes` must fit in a
  // uint32 or setUint32 silently wraps and produces a corrupt container. The 256 MB decode cap
  // keeps us far below this, but guard before allocation as defense-in-depth (RF64 would be the
  // real fix for >4 GiB output).
  if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffffffff - 36) {
    throw new Error('The audio is too large to encode as a WAV file (exceeds the 4 GiB RIFF limit).');
  }
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
  view.setUint32(28, source.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of source.channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return buffer;
}
