# 2026-07-17: Long duration formatting

## Summary

Durations of at least one hour displayed an overflowing minutes field instead of an hours field.

## Impact

Long audio and slowed-down outputs could show values such as `61:01.0` rather than `1:01:01.0`.

## Root cause / decision path

The shared formatter split durations into minutes and seconds only. Rounding seconds independently could also produce invalid values such as `59:60.0`.

## Fix / outcome

The formatter now rounds once to total tenths, then derives normalized hours, minutes, and seconds. Sub-hour durations retain the existing `M:SS.s` form, while longer durations use `H:MM:SS.s`.

## Follow-ups

None.
