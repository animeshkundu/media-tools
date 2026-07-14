# Phase 1 change-speed core research

- **Date:** 2026-07-12
- **Owner:** animeshkundu/media-tools
- **Controller marker:** `unit-id: 450cfc32-1189-42d9-93ba-a1035d9a6ddd`

## Context and research question

This work unit is limited to a pure, deterministic resampling transform for already-decoded PCM. It
must change speed and pitch together, preserve the sample rate and channel count, and produce an
output duration equal to the input duration divided by a positive multiplier within one frame. It
must not add UI, worker orchestration, decoding, encoding, dependencies, or independent
pitch/time-stretch behavior.

The implementation phase may add only:

- `lib/tools/change-speed/changeSpeed.ts`
- `lib/tools/change-speed/changeSpeed.test.ts`

The two durable planning artifacts are the explicit exception requested for this planning task.

## Repository findings

1. `docs/ROADMAP.md:3-10` places coupled speed and pitch in Phase 1 and leaves it unimplemented.
   Independent pitch/time-stretch remains gated in Phase 3 (`docs/ROADMAP.md:20-24`).
2. `docs/PRODUCT-SPEC.md:104-117` defines this feature as resampling where speed and pitch move
   together. Its core numerical criterion is output duration equal to input duration divided by the
   multiplier within one audio frame.
3. `docs/ARCHITECTURE.md:96-128` reserves an `audio-speed` worker job for later integration, while
   `docs/ARCHITECTURE.md:229-238` identifies pure resample math as a per-tool Vitest target.
4. `CLAUDE.md:20-26,86-93` requires tool isolation and keeps heavy work off the UI thread. This unit
   intentionally supplies only worker-ready pure DSP and does not claim that worker integration has
   landed.
5. Existing PCM code uses `Float32Array` channels and keeps the source sample rate
   (`lib/tools/audio-cutter/audio.ts:1-17`). The new tool must remain self-contained rather than
   importing audio-cutter internals.
6. Vitest is configured through `npm run test`; the repository's test guidance requires
   deterministic, focused tests and forbids skipped or weakened assertions
   (`.github/instructions/tests.instructions.md:1-14`).
7. `package.json:7-20` defines the required validation commands: `npm run check`, `npm run build`,
   and `npm run build:firefox`. No dependency is needed for linear interpolation.
8. The current branch is `copilot/featureaudio-cutter-harden`; it does not contain the controller
   marker. The marker therefore needs to be retained in the first planning commit and, if an
   implementation PR is later requested, on its own line in the PR body.

## Recommended transform contract

Expose a local PCM type with the exact requested shape:

- input and output: `{ channelData: Float32Array[]; sampleRate: number }`
- transform argument: a finite multiplier greater than zero
- output frame count: `Math.round(inputFrameCount / multiplier)`
- output sample rate: unchanged
- output channel count: unchanged

For each output frame `i`, sample each channel at source position `i * multiplier`. Use linear
interpolation between the surrounding source frames and clamp the upper lookup at the final frame.
This is deterministic, is higher quality than nearest-neighbor sampling, and gives classic coupled
speed/pitch behavior without entering Phase 3 time-stretch scope.

The transform should reject invalid multipliers before allocation. It should also reject malformed
PCM shapes that cannot represent one synchronized audio stream, such as no channels, a non-positive
or non-finite sample rate, unequal channel lengths, or an output length that cannot be safely
allocated. Inputs should not be mutated; the identity multiplier should still return independent
channel arrays.

## Test findings and proposed coverage

A colocated Vitest file is required by this narrowly owned work unit and aligns with the
per-tool-test architecture:

- table-driven frame-count checks for multipliers `0.5`, `1.0`, and `2.0`, asserting
  `Math.round(inputLength / multiplier)` exactly and therefore within one frame;
- a stereo fixture proving channel count, sample rate, and per-channel separation are preserved;
- rejection tests for zero and negative multipliers, plus non-finite multipliers as positive-number
  contract edge cases;
- a known ramp fixture with exact expected linearly interpolated samples;
- an input immutability/identity case so later worker integration can transfer ownership explicitly
  rather than receiving aliased output unexpectedly;
- malformed PCM rejection tests for empty channels and unequal channel lengths.

## Acceptance-criteria applicability

The mission-level criteria are broader than this core-only unit:

1. Cut-region round-trip accuracy is owned by Audio Cutter and is unchanged.
2. Waveform keyboard accessibility is UI work and is prohibited here.
3. No-egress CSP and its CI guard are prohibited files and are unchanged.
4. Worker decode/encode, progress, cancellation, cleanup, and hard file caps are separate integration
   work. This pure transform is worker-ready but does not satisfy or claim that integration.
5. Offline browser processing is not exercised by an unwired unit-only transform; the code adds no
   network path or dependency.
6. WAV/MP3 export and undecodable-input handling are outside this unit.
7. This unit verifies only the change-speed core: coupled resampling, preserved channels, and the
   one-frame duration bound. Join, convert, worker wiring, and browser playback remain separate.
8. The implementation must pass `npm run check`, `npm run build`, and `npm run build:firefox`.
   Dependency/provenance files remain unchanged because no dependency is added.
9. UI and WCAG styling are outside this unit and no UI file may be edited.

## Risks

- **Boundary sampling:** slowed output can request a fractional position beyond the final frame.
  Clamping the right-hand lookup prevents out-of-bounds reads and produces deterministic tail data.
- **Rounding:** using floor or ceiling instead of the specified rounded frame count can create an
  avoidable one-frame duration bias.
- **Invalid allocation:** zero, non-finite, or extremely small multipliers can imply impossible
  output sizes; validation must happen before constructing output arrays.
- **Channel drift:** independently sizing unequal input channels would desynchronize audio. Reject
  unequal lengths instead.
- **Scope creep:** worker contracts, UI, encoding, dependencies, and independent time-stretch must
  remain untouched.

## Follow-ups

- A separately gated worker unit should invoke this pure transform after worker-owned decode and add
  progress, cancellation, hard caps, and cleanup.
- A separately gated app unit should expose the coupled behavior and duration preview without
  implying independent pitch control.
- Browser-level offline/export verification belongs to that integrated unit, not this core-only one.

