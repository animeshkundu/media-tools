export interface PeakLevel {
  readonly samplesPerBin: number;
  readonly minimum: Float32Array;
  readonly maximum: Float32Array;
}

export interface PeakPyramid {
  readonly sampleCount: number;
  readonly levels: readonly PeakLevel[];
}

const MAX_BASE_BINS = 16_384;

function combineLevel(level: PeakLevel): PeakLevel {
  const bins = Math.ceil(level.minimum.length / 2);
  const minimum = new Float32Array(bins);
  const maximum = new Float32Array(bins);
  for (let index = 0; index < bins; index += 1) {
    const left = index * 2;
    const right = Math.min(left + 1, level.minimum.length - 1);
    minimum[index] = Math.min(level.minimum[left] ?? 0, level.minimum[right] ?? 0);
    maximum[index] = Math.max(level.maximum[left] ?? 0, level.maximum[right] ?? 0);
  }
  return { samplesPerBin: level.samplesPerBin * 2, minimum, maximum };
}

export function buildPeakPyramid(
  channel: Float32Array,
  sourceSampleCount = channel.length,
): PeakPyramid {
  if (channel.length === 0 || sourceSampleCount < channel.length) {
    throw new Error('Peak source is empty or has an invalid sample count.');
  }
  const sourceSamplesPerPoint = sourceSampleCount / channel.length;
  const pointStride = Math.max(1, Math.ceil(channel.length / MAX_BASE_BINS));
  const bins = Math.ceil(channel.length / pointStride);
  const minimum = new Float32Array(bins);
  const maximum = new Float32Array(bins);

  for (let bin = 0; bin < bins; bin += 1) {
    let low = 1;
    let high = -1;
    const start = bin * pointStride;
    const end = Math.min(channel.length, start + pointStride);
    for (let index = start; index < end; index += 1) {
      const sample = channel[index] ?? 0;
      if (!Number.isFinite(sample)) throw new Error('Peak samples must be finite.');
      low = Math.min(low, sample);
      high = Math.max(high, sample);
    }
    minimum[bin] = low;
    maximum[bin] = high;
  }

  const levels: PeakLevel[] = [
    {
      samplesPerBin: Math.max(1, Math.round(sourceSamplesPerPoint * pointStride)),
      minimum,
      maximum,
    },
  ];
  while (levels[levels.length - 1]!.minimum.length > 1) {
    levels.push(combineLevel(levels[levels.length - 1]!));
  }
  return { sampleCount: sourceSampleCount, levels };
}

export function buildPeakPyramidFromOverview(
  overview: Float32Array,
  sourceSampleCount: number,
): PeakPyramid {
  if (
    overview.length === 0 ||
    !Number.isSafeInteger(sourceSampleCount) ||
    sourceSampleCount < overview.length
  ) {
    throw new Error('Peak overview is empty or has an invalid source sample count.');
  }
  const pointStride = Math.max(1, Math.ceil(overview.length / MAX_BASE_BINS));
  const bins = Math.ceil(overview.length / pointStride);
  const minimum = new Float32Array(bins);
  const maximum = new Float32Array(bins);
  for (let bin = 0; bin < bins; bin += 1) {
    let peak = 0;
    const start = bin * pointStride;
    const end = Math.min(overview.length, start + pointStride);
    for (let index = start; index < end; index += 1) {
      const sample = overview[index] ?? 0;
      if (!Number.isFinite(sample)) throw new Error('Peak samples must be finite.');
      peak = Math.max(peak, Math.max(0, Math.min(1, sample)));
    }
    minimum[bin] = -peak;
    maximum[bin] = peak;
  }
  const levels: PeakLevel[] = [
    {
      samplesPerBin: Math.max(
        1,
        Math.round((sourceSampleCount / overview.length) * pointStride),
      ),
      minimum,
      maximum,
    },
  ];
  while (levels[levels.length - 1]!.minimum.length > 1) {
    levels.push(combineLevel(levels[levels.length - 1]!));
  }
  return { sampleCount: sourceSampleCount, levels };
}

export function selectPeakLevel(
  pyramid: PeakPyramid,
  samplesPerPixel: number,
): PeakLevel {
  if (!Number.isFinite(samplesPerPixel) || samplesPerPixel <= 0) {
    throw new Error('Waveform scale must be positive and finite.');
  }
  let selected = pyramid.levels[0]!;
  for (const level of pyramid.levels) {
    if (level.samplesPerBin > samplesPerPixel) break;
    selected = level;
  }
  return selected;
}

export function peakCacheBytes(
  pyramids: Readonly<Record<string, PeakPyramid>>,
): number {
  let bytes = 0;
  for (const pyramid of Object.values(pyramids)) {
    for (const level of pyramid.levels) {
      bytes += level.minimum.byteLength + level.maximum.byteLength;
      if (!Number.isSafeInteger(bytes)) {
        throw new Error('Peak cache size exceeds safe integer bounds.');
      }
    }
  }
  return bytes;
}
