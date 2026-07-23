import type { AutoDuckingSettings } from './schema';
import { validateDuckingSettings } from './schema';

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -120 : 20 * Math.log10(gain);
}

export function buildDuckingEnvelope(
  dialogue: Float32Array,
  sampleRate: number,
  settings: AutoDuckingSettings,
): Float32Array {
  validateDuckingSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error('Ducking sample rate is unsupported.');
  }
  const envelope = new Float32Array(dialogue.length);
  if (!settings.enabled) {
    envelope.fill(1);
    return envelope;
  }
  const threshold = dbToGain(settings.thresholdDb);
  const reducedGain = dbToGain(settings.reductionDb);
  const attack = Math.exp(-1 / (settings.attackSeconds * sampleRate));
  const release = Math.exp(-1 / (settings.releaseSeconds * sampleRate));
  let detector = 0;
  let gain = 1;

  for (let index = 0; index < dialogue.length; index += 1) {
    const absolute = Math.abs(dialogue[index] ?? 0);
    const detectorCoefficient = absolute > detector ? attack : release;
    detector = detectorCoefficient * detector + (1 - detectorCoefficient) * absolute;
    const target = detector >= threshold ? reducedGain : 1;
    const gainCoefficient = target < gain ? attack : release;
    gain = gainCoefficient * gain + (1 - gainCoefficient) * target;
    envelope[index] = gain;
  }
  return envelope;
}

export interface AnimationScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

const browserScheduler: AnimationScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class LiveSidechainDucker {
  readonly #context: BaseAudioContext;
  readonly #analyser: AnalyserNode;
  readonly #musicGain: GainNode;
  readonly #scheduler: AnimationScheduler;
  #settings: AutoDuckingSettings;
  #samples: Float32Array<ArrayBuffer>;
  #frame?: number;

  constructor(
    context: BaseAudioContext,
    dialogueNode: AudioNode,
    musicGain: GainNode,
    settings: AutoDuckingSettings,
    scheduler: AnimationScheduler = browserScheduler,
  ) {
    validateDuckingSettings(settings);
    this.#context = context;
    this.#musicGain = musicGain;
    this.#settings = settings;
    this.#scheduler = scheduler;
    this.#analyser = context.createAnalyser();
    this.#analyser.fftSize = 512;
    this.#samples = new Float32Array(this.#analyser.fftSize);
    dialogueNode.connect(this.#analyser);
  }

  start(): void {
    if (this.#frame !== undefined) return;
    const update = () => {
      this.#analyser.getFloatTimeDomainData(this.#samples);
      let squareSum = 0;
      for (const sample of this.#samples) squareSum += sample * sample;
      const rms = Math.sqrt(squareSum / this.#samples.length);
      const shouldDuck = this.#settings.enabled && gainToDb(rms) >= this.#settings.thresholdDb;
      const target = shouldDuck ? dbToGain(this.#settings.reductionDb) : 1;
      const timeConstant = shouldDuck
        ? this.#settings.attackSeconds
        : this.#settings.releaseSeconds;
      this.#musicGain.gain.setTargetAtTime(
        target,
        this.#context.currentTime,
        Math.max(0.001, timeConstant / 3),
      );
      this.#frame = this.#scheduler.request(update);
    };
    this.#frame = this.#scheduler.request(update);
  }

  update(settings: AutoDuckingSettings): void {
    validateDuckingSettings(settings);
    this.#settings = settings;
  }

  stop(): void {
    if (this.#frame !== undefined) this.#scheduler.cancel(this.#frame);
    this.#frame = undefined;
    this.#musicGain.gain.cancelScheduledValues(this.#context.currentTime);
    this.#musicGain.gain.setValueAtTime(1, this.#context.currentTime);
    this.#analyser.disconnect();
  }
}

