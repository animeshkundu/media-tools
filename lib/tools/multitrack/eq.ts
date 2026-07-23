import type { EqPreset } from './schema';

export interface EqBand {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly gain: number;
  readonly q: number;
}

const PRESETS: Readonly<Record<EqPreset, readonly EqBand[]>> = {
  flat: [],
  voice: [
    { type: 'lowshelf', frequency: 120, gain: -4, q: 0.707 },
    { type: 'peaking', frequency: 2_500, gain: 3, q: 0.9 },
    { type: 'highshelf', frequency: 8_000, gain: -2, q: 0.707 },
  ],
  warm: [
    { type: 'lowshelf', frequency: 180, gain: 3, q: 0.707 },
    { type: 'peaking', frequency: 3_500, gain: -1, q: 0.8 },
    { type: 'highshelf', frequency: 7_000, gain: -2, q: 0.707 },
  ],
  bright: [
    { type: 'lowshelf', frequency: 150, gain: -2, q: 0.707 },
    { type: 'peaking', frequency: 3_500, gain: 2, q: 0.8 },
    { type: 'highshelf', frequency: 6_500, gain: 3, q: 0.707 },
  ],
};

export function eqBandsForPreset(preset: EqPreset): readonly EqBand[] {
  return PRESETS[preset];
}

type BiquadCoefficients = {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
};

export class OfflineBiquad {
  readonly #coefficients: BiquadCoefficients;
  #x1 = 0;
  #x2 = 0;
  #y1 = 0;
  #y2 = 0;

  constructor(band: EqBand, sampleRate: number) {
    this.#coefficients = coefficientsForBand(band, sampleRate);
  }

  process(input: number): number {
    const coefficients = this.#coefficients;
    const output =
      coefficients.b0 * input +
      coefficients.b1 * this.#x1 +
      coefficients.b2 * this.#x2 -
      coefficients.a1 * this.#y1 -
      coefficients.a2 * this.#y2;
    this.#x2 = this.#x1;
    this.#x1 = input;
    this.#y2 = this.#y1;
    this.#y1 = output;
    return output;
  }
}

function coefficientsForBand(band: EqBand, sampleRate: number): BiquadCoefficients {
  const frequency = Math.min(band.frequency, sampleRate * 0.45);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const amplitude = 10 ** (band.gain / 40);
  let a0: number;
  let a1: number;
  let a2: number;
  let b0: number;
  let b1: number;
  let b2: number;

  if (band.type === 'peaking') {
    const alpha = sine / (2 * band.q);
    b0 = 1 + alpha * amplitude;
    b1 = -2 * cosine;
    b2 = 1 - alpha * amplitude;
    a0 = 1 + alpha / amplitude;
    a1 = -2 * cosine;
    a2 = 1 - alpha / amplitude;
  } else if (band.type === 'lowshelf') {
    const alpha = (sine / 2) * Math.sqrt(2);
    const rootAmplitude = 2 * Math.sqrt(amplitude) * alpha;
    b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + rootAmplitude);
    b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine);
    b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - rootAmplitude);
    a0 = amplitude + 1 + (amplitude - 1) * cosine + rootAmplitude;
    a1 = -2 * (amplitude - 1 + (amplitude + 1) * cosine);
    a2 = amplitude + 1 + (amplitude - 1) * cosine - rootAmplitude;
  } else {
    const alpha = (sine / 2) * Math.sqrt(2);
    const rootAmplitude = 2 * Math.sqrt(amplitude) * alpha;
    b0 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine + rootAmplitude);
    b1 = -2 * amplitude * (amplitude - 1 + (amplitude + 1) * cosine);
    b2 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine - rootAmplitude);
    a0 = amplitude + 1 - (amplitude - 1) * cosine + rootAmplitude;
    a1 = 2 * (amplitude - 1 - (amplitude + 1) * cosine);
    a2 = amplitude + 1 - (amplitude - 1) * cosine - rootAmplitude;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
