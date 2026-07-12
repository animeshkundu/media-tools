import { describe, expect, it } from 'vitest';
import { cutPcm, encodeWav } from '../lib/tools/audio-cutter/audio';

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

describe('audio cutter', () => {
  it('cuts generated PCM and produces the expected WAV length', () => {
    const sampleRate = 8_000;
    const samples = new Float32Array(sampleRate);
    for (let index = 0; index < samples.length; index += 1)
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate);

    const cut = cutPcm({ channels: [samples], sampleRate }, 0.25, 0.75);
    const wav = encodeWav(cut);
    const view = new DataView(wav);

    expect(cut.channels[0]).toHaveLength(4_000);
    expect(wav.byteLength).toBe(44 + 4_000 * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint32(40, true)).toBe(8_000);
  });

  it('writes a valid stereo PCM WAV header', () => {
    const wav = encodeWav({ channels: [new Float32Array(100), new Float32Array(100)], sampleRate: 48_000 });
    const view = new DataView(wav);

    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(28, true)).toBe(192_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  });
});
