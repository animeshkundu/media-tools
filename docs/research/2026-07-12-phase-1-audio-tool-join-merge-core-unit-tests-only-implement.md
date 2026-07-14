# Phase 1 audio join/merge core research

> **SUPERSEDED (2026-07-14):** The statement below that worker decode did not exist describes this
> work unit at research time. The shipped engine now decodes MP3 with worker-side WebCodecs
> `AudioDecoder` and parses WAV PCM directly in the worker.

Date: 2026-07-12  
Controller marker: `unit-id: fee88d3a-57d3-40c6-8dc7-7404d0b15e45`

## Scope

This work unit is limited to pure PCM join logic and deterministic unit tests. The later implementation
may add only new implementation files under `lib/tools/join/`; it must not add decode, encode, worker,
UI, routing, download, CSP, CI, dependency, or shared-core changes. These exclusions agree with the
request even though the repository's general convention normally wires each new tool into
`entrypoints/app/App.tsx` (`CLAUDE.md:86-93`).

The requested planning artifacts are the only files changed by this research task.

## Repository findings

- Audio join/merge is the next unchecked Phase 1 item (`docs/ROADMAP.md:3-10`).
- The product requirement is to preserve visible order, normalize sample rate and channel layout, and
  concatenate without an unintended gap (`docs/PRODUCT-SPEC.md`, Audio join/merge section).
- The architecture explicitly identifies pure concat/resample math and join ordering as high-value
  Vitest targets (`docs/ARCHITECTURE.md:229-238`).
- The existing pure PCM code uses `Float32Array[]`, validates unusable PCM, and truncates all channels
  to the shortest channel (`lib/tools/audio-cutter/audio.ts:1-17`). The new contract deliberately names
  the field `channelData`, so the join module should define its own self-contained type rather than
  importing audio-cutter internals.
- Existing audio tests use generated deterministic arrays and focused assertions
  (`tests/audio.test.ts:1-39`).
- Strict TypeScript is required, ESLint applies to all TypeScript, and the supported validation scripts
  are `compile`, `lint`, `test`, `check`, `build`, and `build:firefox` (`package.json:7-20`).
- No dependency is needed. This avoids the repository's exact-version and third-party provenance
  requirements.
- The peer review warns that joining decoded PCM can have high aggregate memory cost and requires hard
  limits before a complete large-file tool ships (`docs/PEER-REVIEW.md:15-17`). This pure unit cannot
  enforce pre-decode file caps, but it should reject invalid dimensions and unsafe output lengths before
  allocation.
- Worker-owned decode is a separate prerequisite because Web Audio is unavailable in workers
  (`CLAUDE.md:32-36`; `docs/PEER-REVIEW.md:17`). This unit accepts already-decoded PCM and must not
  imply that worker decode exists.

## Proposed deterministic normalization policy

1. Reject an empty input list and malformed PCM: non-positive/non-finite sample rates, no channels,
   unequal channel lengths within an input, or lengths that cannot be summed safely.
2. Choose the highest input sample rate as the output sample rate. This is independent of input order
   and avoids downsampling.
3. Choose the highest input channel count as the output channel count, also independent of order.
4. Resample each channel with deterministic linear interpolation to
   `round(sourceFrames * outputRate / sourceRate)` frames. Clamp the final lookup to the last source
   frame so every normalized segment has the calculated duration within one output frame.
5. Preserve channels by index. Duplicate mono across all output channels. For a non-mono input with
   fewer channels than the output, fill additional channels with that input's arithmetic channel mean.
   This avoids arbitrary channel cycling and does not discard any existing channel.
6. Precompute normalized segment lengths and their overflow-safe sum, allocate each output channel
   once, and copy normalized segments at cumulative offsets. No padding or silence is inserted between
   offsets.
7. Return fresh arrays, including for a single input, so callers cannot accidentally alias or mutate
   their source buffers through the result.

## Test-discovery blocker

The requested ownership boundary says tests must be new files under `lib/tools/join/`, for example
`lib/tools/join/join.test.ts`. However, `vitest.config.ts:3-7` includes only
`tests/**/*.test.ts`. Therefore `npm test` will not discover a test located under the owned directory.
The prohibited-file list also prevents changing `vitest.config.ts`, `package.json`, or an existing
test under `tests/`.

Implementation cannot honestly satisfy both “tests only under `lib/tools/join/`” and “focused tests run
by `npm test`” until the controller permits one minimal exception:

- preferred: add `tests/join.test.ts`; or
- alternative: extend `vitest.config.ts` to include `lib/tools/**/*.test.ts`.

No implementation should begin until that ownership/test-discovery conflict is resolved.

## Scope mapping to mission acceptance criteria

| Criterion | Applicability to this unit |
| --- | --- |
| 1. Cutter frame accuracy | Out of scope; audio-cutter files are prohibited. Regression-only via existing suite. |
| 2. Waveform keyboard accessibility | Out of scope; no UI changes are permitted. |
| 3. No-egress CSP and manifest guard | Out of scope; config and CI files are prohibited. |
| 4. Worker decode/encode, cancel, cleanup, caps | Decode/worker lifecycle is out of scope. This pure core can validate PCM shape and output-size arithmetic only. |
| 5. Offline WAV/MP3 end-to-end | Out of scope; no decode, encode, download, or UI wiring is owned. |
| 6. WAV/MP3 export correctness | Out of scope; no encoder is owned. |
| 7. Phase 1 tools | This unit covers only join/merge PCM ordering, normalization, and gap-free concatenation. |
| 8. Engineering gates | Applicable: no dependencies or attribution; run check plus both production builds after implementation. Existing drifting dependency ranges are pre-existing and prohibited from modification here. |
| 9. UI polish/WCAG | Out of scope; no UI files are owned. |

This mapping is intentionally explicit so the core unit is not misrepresented as a shipped join tool.
