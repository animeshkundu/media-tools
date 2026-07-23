import { describe, expect, it } from 'vitest';
import {
  buildPeakPyramid,
  buildPeakPyramidFromOverview,
  peakCacheBytes,
  selectPeakLevel,
} from '../lib/tools/multitrack/peaks';

describe('multitrack peak pyramid', () => {
  it('preserves extrema across progressively coarser cached levels', () => {
    const samples = new Float32Array([-1, 0.25, 0.5, -0.75, 0.1, 0.2, -0.3, 0.9]);
    const pyramid = buildPeakPyramid(samples);

    expect(pyramid.levels[0]?.minimum).toEqual(samples);
    expect(pyramid.levels.at(-1)?.minimum[0]).toBe(-1);
    expect(pyramid.levels.at(-1)?.maximum[0]).toBeCloseTo(0.9);
    expect(selectPeakLevel(pyramid, 4).samplesPerBin).toBe(4);
  });

  it('maps the worker overview onto original source sample density', () => {
    const pyramid = buildPeakPyramidFromOverview(new Float32Array([0.25, 1]), 48_000);
    expect(pyramid.sampleCount).toBe(48_000);
    expect(pyramid.levels[0]?.minimum[0]).toBe(-0.25);
    expect(pyramid.levels[0]?.maximum[0]).toBe(0.25);
    expect(pyramid.levels[0]?.minimum[1]).toBe(-1);
    expect(pyramid.levels[0]?.maximum[1]).toBe(1);
    expect(pyramid.levels[0]?.samplesPerBin).toBe(24_000);
  });

  it('keeps visible min/max spans when a compact overview is the finest level', () => {
    const overview = new Float32Array(1_000).fill(0.6);
    const pyramid = buildPeakPyramidFromOverview(overview, 60 * 48_000);
    const level = selectPeakLevel(pyramid, 48_000 / 80);
    expect(level.samplesPerBin).toBe(2_880);
    expect(level.minimum[500]).toBeCloseTo(-0.6);
    expect(level.maximum[500]).toBeCloseTo(0.6);
  });

  it('rejects invalid scales and non-finite source samples', () => {
    expect(() => buildPeakPyramid(new Float32Array([Number.NaN]))).toThrow(
      'Peak samples must be finite.',
    );
    expect(() => selectPeakLevel(buildPeakPyramid(new Float32Array([0])), 0)).toThrow(
      'Waveform scale must be positive and finite.',
    );
  });

  it('reports all typed-array storage retained by the waveform cache', () => {
    const pyramid = buildPeakPyramid(new Float32Array([0.25, -0.5, 0.75, -1]));
    const expected = pyramid.levels.reduce(
      (bytes, level) => bytes + level.minimum.byteLength + level.maximum.byteLength,
      0,
    );
    expect(peakCacheBytes({ one: pyramid })).toBe(expected);
  });
});
