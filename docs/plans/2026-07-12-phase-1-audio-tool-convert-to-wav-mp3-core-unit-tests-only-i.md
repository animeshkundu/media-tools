# Phase 1 audio conversion core implementation plan

- Date: 2026-07-12
- Owner: animeshkundu/media-tools maintainers
- Work unit: Convert-to-WAV/MP3 core and unit tests only
- Controller marker: `unit-id: b5b6036d-89af-44b1-ba58-352d5d9648b2`
- Related research:
  [`../research/2026-07-12-phase-1-audio-tool-convert-to-wav-mp3-core-unit-tests-only-i.md`](../research/2026-07-12-phase-1-audio-tool-convert-to-wav-mp3-core-unit-tests-only-i.md)

## Scope decision

Implement only a pure, encode-only PCM conversion module and its deterministic unit tests. Do not
decode files, add a worker, expose progress/cancellation, trigger downloads, wire UI, alter shared
core code, change manifests/workflows/dependencies, or touch the existing cutter.

Before implementation begins, resolve the test-discovery conflict: Vitest currently includes only
`tests/**/*.test.ts`, but the work unit allows new files only below `lib/tools/convert/`. Obtain
explicit approval either to make the minimal `vitest.config.ts` include change or to add a thin
`tests/convert.test.ts` suite. If neither exception is approved, stop and report that focused tests
cannot be made part of `npm run check` within the stated file boundary.

## Files

Subject to the test-discovery resolution:

- Add `lib/tools/convert/convert.ts` for public types, validation, WAV encoding, MP3 encoding, and
  Blob creation.
- Add `lib/tools/convert/convert.test.ts` for direct deterministic tests if colocated test discovery
  is approved.
- If specifically approved instead, add `tests/convert.test.ts` as the focused suite while keeping
  all production implementation under `lib/tools/convert/`.
- Do not modify any prohibited file. No `docs/LEARNINGS.md`, ADR, changelog, or history update is planned:
  the durable research artifact already records the repository-specific discovery and blocker, and
  implementation introduces no architectural decision beyond the accepted product specification.

## Step-by-step implementation

1. **Establish the baseline.**
   - Run `npm ci`.
   - Run `npm run check`, `npm run build`, and `npm run build:firefox` before edits.
   - Preserve verbatim command output for the handoff and identify any pre-existing failure without
     weakening checks.
   - Inspect the installed `lamejs` 1.2.1 export and type shape; do not add or update dependencies.

2. **Define the conversion contract.**
   - Add strict exported PCM and discriminated output-setting types.
   - Expose one asynchronous function that returns a `Blob`.
   - Keep visible settings explicit: WAV bit depth and MP3 bitrate.
   - Define the supported channel count, WAV bit depths, and MP3 bitrate values in the module so
     validation and tests share a single contract.

3. **Validate before allocation or encoding.**
   - Reject absent/empty PCM, unequal channel lengths, unsupported channel counts, invalid sample
     rates, and invalid format settings.
   - Use safe-integer arithmetic for frame, byte-rate, block-alignment, and payload calculations.
   - Reject classic RIFF output that cannot be represented by 32-bit chunk sizes.
   - Ensure every invalid path rejects before producing a Blob.

4. **Implement self-contained WAV encoding.**
   - Generate a canonical little-endian PCM RIFF file with `RIFF`, `WAVE`, `fmt `, and `data` chunks.
   - Compute and write format code, channel count, sample rate, byte rate, block alignment, selected
     bit depth, and chunk sizes.
   - Interleave equal-length channels, clamp finite PCM samples to the representable range, and
     quantize consistently for the supported bit depth.
   - Return an `audio/wav` Blob.

5. **Implement MP3 encoding through the installed dependency.**
   - Import `lamejs` from the existing package and, only if required, place a narrow type declaration
     or adapter inside `lib/tools/convert/`.
   - Convert clamped float PCM to signed 16-bit mono/stereo samples.
   - Feed 1,152-frame blocks to `Mp3Encoder` with the requested bitrate, flush the encoder, concatenate
     all emitted chunks, and reject an empty result.
   - Return an `audio/mpeg` Blob.

6. **Add focused deterministic tests that fail without the module.**
   - Assert every relevant WAV header field and Blob MIME/length.
   - Parse encoded WAV PCM and verify exact frame count, channel interleaving, and sample values within
     one quantization step for mono and stereo fixtures.
   - Parse a generated MP3 frame header and verify a non-empty Layer III stream at requested supported
     bitrate/sample-rate/channel settings.
   - Cover empty PCM, zero frames, mismatched lengths, invalid sample rates, unsupported channels,
     invalid settings, and WAV size overflow.
   - Do not stub the encoders, skip tests, rely on snapshots, or relax existing coverage.

7. **Verify the implementation.**
   - Run the focused conversion test while iterating.
   - Run `npm run check` and capture its complete verbatim output.
   - Run `npm run build` and `npm run build:firefox` and capture complete output to prove both build
     targets consume the module successfully.
   - Scan changed files for secrets and generated-authorship attribution.
   - Run code review and security validation, address valid findings, and rerun after significant
     corrections.

8. **Report acceptance criteria individually.**
   - Record exact WAV frame preservation and sample-round-trip evidence for criterion 1's applicable
     encode-only portion.
   - Mark criteria 2, 3, 4, 5, and 9 as explicitly outside this core-only unit rather than claiming
     them complete.
   - Record WAV/MP3 byte-level evidence and invalid-input rejection for criterion 6.
   - Record focused conversion tests and both production builds for criterion 7, while identifying
     join/speed/UI integration as separate units.
   - Record full check/build outputs for criterion 8 and explicitly report the prohibited
     `package.json` exact-pin blocker.

## Key risks

- The current Vitest include pattern conflicts with the permitted file ownership; implementation
  cannot start until this is resolved.
- `lamejs` is old and lacks modern TypeScript declarations; package import behavior must be proven
  after installation without changing dependencies.
- MP3 adds encoder delay and padding, so this unit verifies valid frame structure and requested
  settings rather than asserting sample-exact decoded duration.
- Classic WAV has 32-bit RIFF limits; oversized output must fail before allocation because RF64 is
  out of scope.
- The pure API necessarily allocates output and cannot itself satisfy worker cancellation or bounded
  streaming gates; later integration must call it from a worker with external input caps.

## Completion gate

Implementation is ready for review only when the approved tests are discovered by `npm run test`,
all new error paths are covered, `npm run check`, Chrome build, and Firefox build pass with verbatim
output retained, no prohibited files changed, and every mission-level acceptance criterion is
reported honestly as verified, partially applicable, deferred, or blocked.

