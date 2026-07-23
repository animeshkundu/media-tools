import { MAX_PCM_ENCODE_BYTES } from '../../core/worker';

export function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  if (left.length < 1 || left.length !== right.length) {
    throw new Error('WAV channels must be non-empty and aligned.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error('WAV sample rate is unsupported.');
  }
  const dataBytes = left.length * 4;
  const totalBytes = 44 + dataBytes;
  if (
    !Number.isSafeInteger(dataBytes) ||
    totalBytes > MAX_PCM_ENCODE_BYTES ||
    dataBytes > 0xffffffff - 36
  ) {
    throw new Error('The mixed WAV exceeds the 256 MB or RIFF output limit.');
  }
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, totalBytes - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < left.length; frame += 1) {
    writeSample(view, 44 + frame * 4, left[frame] ?? 0);
    writeSample(view, 46 + frame * 4, right[frame] ?? 0);
  }
  return buffer;
}
function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function writeSample(view: DataView, offset: number, sample: number): void {
  if (!Number.isFinite(sample)) throw new Error('Mixed audio samples must be finite.');
  const clamped = Math.max(-1, Math.min(1, sample));
  view.setInt16(offset, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
}
