# Phase 1 change-speed core implementation plan

- **Date:** 2026-07-12
- **Owner:** animeshkundu/media-tools
- **Controller marker:** `unit-id: 450cfc32-1189-42d9-93ba-a1035d9a6ddd`
- **Related research:**
  [`../research/2026-07-12-phase-1-audio-tool-change-speed-coupled-speed-pitch-core-uni.md`](../research/2026-07-12-phase-1-audio-tool-change-speed-coupled-speed-pitch-core-uni.md)

## Scope

Implement only the pure coupled speed/pitch resampler and its focused unit tests. During
implementation, create only:

- `lib/tools/change-speed/changeSpeed.ts`
- `lib/tools/change-speed/changeSpeed.test.ts`

Do not edit app integration, worker/core infrastructure, Audio Cutter, configuration, workflows,
dependency manifests, or existing tests. Do not add dependencies or independent pitch/time-stretch.

## Step-by-step plan

1. **Establish the transform contract**
   - Define a self-contained PCM input/output type using `channelData: Float32Array[]` and
     `sampleRate: number`.
   - Export one pure change-speed function accepting the PCM value and a multiplier.
   - Keep the sample rate unchanged so frame count alone represents the coupled duration and pitch
     change.

2. **Validate before allocation**
   - Reject multipliers that are non-finite or not greater than zero.
   - Reject absent channels, invalid sample rates, and unequal channel lengths.
   - Compute `Math.round(inputLength / multiplier)` and reject unsafe or unallocatable output lengths
     before constructing channel buffers.
   - Leave source arrays and metadata untouched.

3. **Implement deterministic linear resampling**
   - Allocate one output `Float32Array` per input channel using the common rounded frame count.
   - For each output frame, map to source position `outputIndex * multiplier`.
   - Linearly interpolate the adjacent source samples and clamp the upper boundary to the final input
     frame.
   - Return independent output channels, including for multiplier `1`, with the original sample rate.

4. **Add focused Vitest coverage**
   - Add table-driven output-length assertions for `0.5`, `1.0`, and `2.0`.
   - Prove mono and stereo channel counts are preserved and channels are not mixed.
   - Assert zero and negative multipliers fail; cover non-finite multipliers as malformed input.
   - Resample a known ramp and assert the exact expected interpolated values.
   - Assert identity output matches but does not alias or mutate the input.
   - Exercise malformed PCM and impossible-allocation error paths.
   - Do not skip, stub, weaken, or remove any existing test.

5. **Run repository validation**
   - Run `npm run check` and retain the full verbatim compile, lint, and Vitest output for handoff.
   - Run `npm run build` and `npm run build:firefox`; retain full verbatim output for both.
   - Confirm the change adds no dependency, network call, remote code, or prohibited attribution.
   - Scan the two implementation files for secrets before committing.
   - Run the required code review and security validation after the implementation commit; address
     valid findings and rerun if changes are significant.

6. **Commit and hand off without integration**
   - Use a Conventional Commit message and include
     `unit-id: 450cfc32-1189-42d9-93ba-a1035d9a6ddd` as a commit trailer.
   - If a PR is later explicitly requested, put that marker on its own line in the PR body.
   - Report exactly what was verified and explicitly mark every mission-level criterion that remains
     out of scope rather than implying the core-only unit satisfies it.

## Acceptance-criteria verification matrix

| Criterion | Verification in this unit |
| --- | --- |
| 1. Cut accuracy | Not modified; report out of scope. No Audio Cutter file may change. |
| 2. Waveform keyboard accessibility | Not modified; report out of scope. No UI file may change. |
| 3. No-egress CSP | Not modified; prohibited configuration/workflow files remain untouched. |
| 4. Worker-owned heavy work | Not integrated in this unit. Verify the pure core has no browser or UI dependency and report worker decode/cancel/cleanup as a follow-up. |
| 5. Offline | Verify source contains no network operation or dependency; browser offline export is deferred until integration. |
| 6. WAV/MP3 export | Not modified; report out of scope. |
| 7. Phase-1 tools | Direct unit tests verify the change-speed portion: rounded duration for `0.5`, `1.0`, and `2.0`, preserved channels, and coupled resampling. Join/convert remain separate. |
| 8. Engineering | `npm run check`, `npm run build`, and `npm run build:firefox` must pass with verbatim output. Confirm no package or provenance change and no prohibited attribution. |
| 9. UI polish/WCAG | Not modified; report out of scope. |

## Key risks and mitigations

- Use the exact rounded output-length formula to avoid duration drift.
- Clamp interpolation at the last source frame to avoid undefined or non-deterministic tail samples.
- Reject malformed synchronized-channel input instead of silently truncating channels.
- Validate output size before allocation to avoid predictable range or memory failures.
- Keep the implementation dependency-free and self-contained so later worker ownership does not
  require coupling to Audio Cutter or shared core internals.
- Do not represent successful unit/build checks as evidence of browser playback, cancellation,
  cleanup, accessibility, or offline export behavior.

## Documentation disposition

These research and plan artifacts are the durable record for this scoped unit. `docs/LEARNINGS.md`, ADRs,
and changelog files should remain unchanged unless implementation reveals a genuinely reusable
repository fact; editing them preemptively would violate the work unit's narrow file ownership.

