import { describe, expect, it } from 'vitest';
import { formatDuration } from '../lib/core/format';

// Regression + acceptance coverage for the duration formatter.
//
// On the untouched base, formatDuration derives minutes with
// Math.floor(seconds / 60) and has no hours field, so any duration of one
// hour or more overflows the minutes field (e.g. formatDuration(3661) ->
// '61:01.0'). Long trims and slowed-down (>=60 min) outputs across the
// trim/convert/join/change-speed displays therefore read incorrectly.
//
// The primary reproduction below FAILS on the base and PASSES once hour
// carrying is implemented. The guard assertions lock the full contract so the
// sub-hour form and rounding behavior cannot regress.
describe('formatDuration', () => {
  it('renders one hour or more as H:MM:SS.s instead of overflowing minutes', () => {
    // Primary reproduction: base returns '61:01.0' (61 = floor(3661 / 60)).
    expect(formatDuration(3661)).toBe('1:01:01.0');
  });

  it('renders the exact one-hour boundary with a zero-padded minutes field', () => {
    expect(formatDuration(3600)).toBe('1:00:00.0');
  });

  it('grows the hours field naturally for multi-hour durations', () => {
    expect(formatDuration(43200)).toBe('12:00:00.0');
  });

  it('preserves the fractional tenths in the H:MM:SS.s form', () => {
    expect(formatDuration(3690.5)).toBe('1:01:30.5');
  });

  it('keeps the existing sub-hour M:SS.s form unchanged', () => {
    expect(formatDuration(0)).toBe('0:00.0');
    expect(formatDuration(61)).toBe('1:01.0');
    expect(formatDuration(3599)).toBe('59:59.0');
  });

  it('preserves fractional tenths in the sub-hour form', () => {
    expect(formatDuration(90.5)).toBe('1:30.5');
  });

  it('normalizes rounding carry across the hour boundary', () => {
    // 3599.97 must round up into '1:00:00.0', never a '59:60.0'-class overflow.
    expect(formatDuration(3599.97)).toBe('1:00:00.0');
  });

  it('guards non-finite and negative input with 0:00.0', () => {
    expect(formatDuration(-1)).toBe('0:00.0');
    expect(formatDuration(NaN)).toBe('0:00.0');
    expect(formatDuration(Infinity)).toBe('0:00.0');
  });
});
