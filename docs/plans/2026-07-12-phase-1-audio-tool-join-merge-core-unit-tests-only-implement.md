# Phase 1 audio join/merge core implementation plan

Date: 2026-07-12  
Controller marker: `unit-id: fee88d3a-57d3-40c6-8dc7-7404d0b15e45`

## Preconditions

1. Resolve the Vitest discovery conflict documented in the companion research artifact. Permit either
   `tests/join.test.ts` (preferred) or a minimal `vitest.config.ts` include change. Do not implement
   undiscoverable tests.
2. Keep implementation code ownership to new files under `lib/tools/join/`. Do not modify the app,
   worker harness, audio cutter, package metadata, manifest/CSP, CI, or dependencies.
3. If branch naming remains available to the controller, include
   `fee88d3a-57d3-40c6-8dc7-7404d0b15e45`. Include the exact marker on its own line in any later PR
   body and as a trailer in the first implementation commit.

## Files

- Add `lib/tools/join/join.ts`: public PCM input/output types, validation, deterministic channel
  normalization, linear resampling, overflow-safe length calculation, and gap-free concatenation.
- Add the focused test at the controller-approved discoverable location:
  `tests/join.test.ts` (preferred exception), or `lib/tools/join/join.test.ts` only if Vitest discovery
  is also explicitly permitted to change.
- Do not change documentation again unless implementation reveals a durable fact that is absent from
  this research.

## Implementation steps

1. Before implementation, run the existing `npm run check`, `npm run build`, and
   `npm run build:firefox` gates and record any pre-existing failures without changing unrelated code.
2. Define the ordered input and output contract with the exact
   `{ channelData: Float32Array[]; sampleRate: number }` shape, documenting that `sampleRate` must be
   finite and greater than zero.
3. Validate the complete batch before allocation: non-empty batch, finite positive sample rates,
   non-empty channel lists, consistent frame length across each input's channels, and safe normalized
   and aggregate frame counts. Throw stable, actionable errors for invalid input.
4. Select the batch's maximum sample rate and maximum channel count as deterministic output properties.
5. Normalize each segment to the target sample rate using linear interpolation and a rounded target
   frame count. Preserve existing channels by index, duplicate mono, and use the source channel mean
   only for additional channels required by a higher-channel-count batch peer.
6. Allocate each final channel once. Append every normalized segment at the previous segment's exact
   end offset; never add a transition frame, crossfade, or zero padding.
7. Return fresh channel arrays and the selected sample rate. Keep the module pure and independent of
   browser, worker, decoder, encoder, download, and audio-cutter code.
8. Add deterministic tests that fail when the implementation is absent or incorrect:
   - exact A-then-B order and exact adjacent boundary samples, proving no inserted gap;
   - output frame count equals the sum of normalized segment frame counts;
   - mixed sample rates select the documented output rate and produce expected interpolation values;
   - mono/stereo inputs normalize to stereo while preserving existing stereo channels;
   - a higher multichannel case exercises deterministic mean-fill behavior;
   - a single input returns equal content in independent arrays;
   - an empty batch rejects;
   - invalid sample rates, empty channels, inconsistent per-channel lengths, and unsafe aggregate
     lengths reject before allocation where practical.
9. Run the focused test, then `npm run check`, `npm run build`, and `npm run build:firefox`. Preserve
   actual command output for handoff. Do not claim browser end-to-end behavior because this unit has no
   browser or UI integration.
10. Scan changed files for secrets, run repository code review/security validation, and commit with a
    Conventional Commit message and the required unit-id trailer. Open no PR unless separately asked.

## Acceptance verification

1. **Cutter frame accuracy:** not modified or newly claimed; verify no regression through the existing
   suite. Full decode round-trip remains owned by the cutter unit.
2. **Waveform keyboard accessibility:** not applicable; no UI is changed.
3. **No-egress CSP:** not applicable to implementation; manifest and CI files are expressly prohibited.
   Both builds provide regression coverage only.
4. **Worker-owned heavy work:** worker decode/encode and cancellation are not part of this already-
   decoded pure function. Unit tests verify malformed PCM and unsafe size rejection; worker lifecycle
   must be verified by its separate unit.
5. **Offline WAV/MP3 processing:** not applicable until decode/encode/download integration.
6. **Export correctness:** not applicable; this unit returns PCM and owns no export encoder.
7. **Join/merge Phase 1 core:** directly verify visible order, exact normalized lengths, deterministic
   sample-rate/channel handling, no inserted boundary samples, and empty/single/error cases in Vitest.
   Convert and speed tools remain separate work units.
8. **Engineering:** require `npm run check`, `npm run build`, and `npm run build:firefox` to pass; add no
   dependency; inspect the diff and commit/PR text for prohibited attribution. Report the pre-existing
   drifting dependency ranges rather than editing prohibited `package.json`.
9. **UI polish/WCAG:** not applicable; app integration is explicitly deferred.

## Key risks

- **Blocked test execution:** current Vitest discovery excludes the owned test path. This must be
  resolved before implementation.
- **Resampling semantics:** rounded per-segment frame counts can differ from a hypothetical single
  continuous resample by at most one frame per segment. Tests must assert the documented per-segment
  policy.
- **Channel semantics:** generalized multichannel mapping is a policy choice. The mean-fill rule must
  remain documented and tested; later export capability may impose stricter layouts.
- **Memory:** the pure API necessarily materializes the joined PCM. Pre-allocation checks reduce unsafe
  allocation risk but do not replace the separate aggregate file/decoded-PCM caps and disk-backed
  design required for the shipped tool.
- **Scope overstatement:** green unit tests and Chrome/Firefox builds do not prove decode, worker
  cancellation, offline export, playback, or UI behavior. Those remain explicit follow-up gates.
