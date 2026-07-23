export const MAX_VOLUME_PERCENT = 500;
export const NORMALIZE_TARGET_DBFS = -1;
export const WARNING_PEAK_DBFS = -2;

const LOG_FADE_FLOOR_DB = -60;
const PROGRESS_FRAMES = 16_384;

export type FadeCurve = 'linear' | 'logarithmic';

export type VolumeFadeOptions = {
  curve: FadeCurve;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  gainPercent: number;
  normalize: boolean;
};

export type VolumePcm = {
  channels: Float32Array[];
  sampleRate: number;
};

export type VolumeAnalysis = {
  effectiveGain: number;
  outputPeak: number;
  sourcePeak: number;
};

export type PeakState = 'safe' | 'warning' | 'clipping';

export type BinnedVolumePreview = {
  analysis: VolumeAnalysis;
  waveform: Float32Array;
};

export function amplitudeToDbfs(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude < 0) {
    throw new Error('Peak amplitude must be a non-negative finite number.');
  }
  return amplitude === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(amplitude);
}

export function peakState(amplitude: number): PeakState {
  const dbfs = amplitudeToDbfs(amplitude);
  if (amplitude > 1) return 'clipping';
  return dbfs >= WARNING_PEAK_DBFS ? 'warning' : 'safe';
}

export function validateVolumeFadeOptions(options: VolumeFadeOptions): void {
  if (
    !Number.isFinite(options.gainPercent) ||
    options.gainPercent < 0 ||
    options.gainPercent > MAX_VOLUME_PERCENT
  ) {
    throw new Error(`Volume must be between 0% and ${MAX_VOLUME_PERCENT}%.`);
  }
  if (!Number.isFinite(options.fadeInSeconds) || options.fadeInSeconds < 0) {
    throw new Error('Fade-in duration must be a non-negative finite number.');
  }
  if (!Number.isFinite(options.fadeOutSeconds) || options.fadeOutSeconds < 0) {
    throw new Error('Fade-out duration must be a non-negative finite number.');
  }
  if (options.curve !== 'linear' && options.curve !== 'logarithmic') {
    throw new Error('Fade curve must be linear or logarithmic.');
  }
}

function validatePcm(source: VolumePcm, options: VolumeFadeOptions): number {
  validateVolumeFadeOptions(options);
  if (!Number.isFinite(source.sampleRate) || source.sampleRate <= 0) {
    throw new Error('Sample rate must be a positive finite number.');
  }
  if (source.channels.length < 1 || source.channels.length > 2) {
    throw new Error('Audio must contain one or two channels.');
  }
  const frameCount = source.channels[0]!.length;
  if (source.channels.some((channel) => channel.length !== frameCount)) {
    throw new Error('Audio channels must have equal lengths.');
  }
  const duration = frameCount / source.sampleRate;
  if (options.fadeInSeconds > duration || options.fadeOutSeconds > duration) {
    throw new Error('Fade durations cannot exceed the audio duration.');
  }
  return frameCount;
}

function curveGain(progress: number, curve: FadeCurve): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  if (curve === 'linear') return progress;
  return 10 ** ((LOG_FADE_FLOOR_DB * (1 - progress)) / 20);
}

function envelopeGain(
  frame: number,
  frameCount: number,
  fadeInFrames: number,
  fadeOutFrames: number,
  curve: FadeCurve,
): number {
  let gain = 1;
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    const progress = fadeInFrames === 1 ? 0 : frame / (fadeInFrames - 1);
    gain *= curveGain(progress, curve);
  }
  const fadeOutStart = frameCount - fadeOutFrames;
  if (fadeOutFrames > 0 && frame >= fadeOutStart) {
    const progress = fadeOutFrames === 1 ? 0 : (frameCount - 1 - frame) / (fadeOutFrames - 1);
    gain *= curveGain(progress, curve);
  }
  return gain;
}

function gainForPeak(fadedPeak: number, options: VolumeFadeOptions): number {
  const targetPeak = 10 ** (NORMALIZE_TARGET_DBFS / 20);
  return options.normalize && fadedPeak > 0 ? targetPeak / fadedPeak : options.gainPercent / 100;
}

function analyze(
  source: VolumePcm,
  options: VolumeFadeOptions,
  onProgress?: (value: number) => void,
): VolumeAnalysis {
  const frameCount = validatePcm(source, options);
  const fadeInFrames = Math.min(frameCount, Math.round(options.fadeInSeconds * source.sampleRate));
  const fadeOutFrames = Math.min(frameCount, Math.round(options.fadeOutSeconds * source.sampleRate));
  let sourcePeak = 0;
  let fadedPeak = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const envelope = envelopeGain(
      frame,
      frameCount,
      fadeInFrames,
      fadeOutFrames,
      options.curve,
    );
    for (const channel of source.channels) {
      const sample = channel[frame]!;
      if (!Number.isFinite(sample)) throw new Error('Audio samples must be finite.');
      const amplitude = Math.abs(sample);
      sourcePeak = Math.max(sourcePeak, amplitude);
      fadedPeak = Math.max(fadedPeak, amplitude * envelope);
    }
    if (onProgress && ((frame + 1) % PROGRESS_FRAMES === 0 || frame + 1 === frameCount)) {
      onProgress(frameCount === 0 ? 1 : (frame + 1) / frameCount);
    }
  }

  const effectiveGain = gainForPeak(fadedPeak, options);
  const outputPeak = fadedPeak * effectiveGain;
  if (!Number.isFinite(effectiveGain) || !Number.isFinite(outputPeak)) {
    throw new Error('The requested gain produces invalid audio samples.');
  }
  return { effectiveGain, outputPeak, sourcePeak };
}

export function analyzeVolumeFades(
  source: VolumePcm,
  options: VolumeFadeOptions,
): VolumeAnalysis {
  return analyze(source, options);
}

export function previewBinnedVolumeFades(
  waveform: Float32Array,
  duration: number,
  options: VolumeFadeOptions,
): BinnedVolumePreview {
  validateVolumeFadeOptions(options);
  if (!Number.isFinite(duration) || duration <= 0 || waveform.length === 0) {
    throw new Error('Waveform duration and samples must be available.');
  }

  let sourcePeak = 0;
  let fadedPeak = 0;
  const envelopeBounds = new Float32Array(waveform.length);
  for (let index = 0; index < waveform.length; index += 1) {
    const amplitude = waveform[index]!;
    if (!Number.isFinite(amplitude) || amplitude < 0) {
      throw new Error('Waveform peaks must be non-negative finite numbers.');
    }
    const bucketStart = (index * duration) / waveform.length;
    const bucketEnd = ((index + 1) * duration) / waveform.length;
    const fadeInBound =
      options.fadeInSeconds === 0
        ? 1
        : curveGain(Math.min(1, bucketEnd / options.fadeInSeconds), options.curve);
    const fadeOutBound =
      options.fadeOutSeconds === 0
        ? 1
        : curveGain(
            Math.min(1, (duration - bucketStart) / options.fadeOutSeconds),
            options.curve,
          );
    // A bucket stores its peak but not the peak's exact frame. The smaller of the two
    // per-fade maxima is a conservative upper bound for their product at any frame.
    const envelopeBound = Math.min(fadeInBound, fadeOutBound);
    envelopeBounds[index] = envelopeBound;
    sourcePeak = Math.max(sourcePeak, amplitude);
    fadedPeak = Math.max(fadedPeak, amplitude * envelopeBound);
  }

  const effectiveGain = gainForPeak(fadedPeak, options);
  const outputPeak = fadedPeak * effectiveGain;
  if (!Number.isFinite(effectiveGain) || !Number.isFinite(outputPeak)) {
    throw new Error('The requested gain produces invalid audio samples.');
  }
  const output = waveform.map(
    (amplitude, index) => amplitude * envelopeBounds[index]! * effectiveGain,
  );
  return {
    analysis: { effectiveGain, outputPeak, sourcePeak },
    waveform: output,
  };
}

export function applyVolumeFadesInPlace(
  source: VolumePcm,
  options: VolumeFadeOptions,
  onProgress: (value: number) => void = () => undefined,
): VolumeAnalysis {
  const frameCount = validatePcm(source, options);
  const analysis = analyze(source, options, (value) => onProgress(value * 0.5));
  const fadeInFrames = Math.min(frameCount, Math.round(options.fadeInSeconds * source.sampleRate));
  const fadeOutFrames = Math.min(frameCount, Math.round(options.fadeOutSeconds * source.sampleRate));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const gain =
      analysis.effectiveGain *
      envelopeGain(frame, frameCount, fadeInFrames, fadeOutFrames, options.curve);
    for (const channel of source.channels) channel[frame] = channel[frame]! * gain;
    if ((frame + 1) % PROGRESS_FRAMES === 0 || frame + 1 === frameCount) {
      onProgress(0.5 + (frameCount === 0 ? 0.5 : (frame + 1) / frameCount / 2));
    }
  }
  if (frameCount === 0) onProgress(1);
  return analysis;
}
