# Standing stream QA review: implementation plan

- **Date:** 2026-07-12
- **Owner:** @animeshkundu
- **Correlation marker:** `unit-id: d2bbce55-d026-47c2-86de-6d9f81702283`
- **Scope:** Audio Cutter hardening and ROADMAP Phase 1 audio tools only
- **Out of scope:** Phase 2 video and Phase 3 independent pitch/time-stretch

## Delivery strategy

Use one concern per PR. Every implementation PR starts from a green baseline, adds tests that fail
without its behavior, passes `npm run check`, builds Chrome and Firefox, loads both production
artifacts, and drives the affected tool with real media. No later tool may bypass the shared worker,
limit, cancellation, or download contracts.

## PR 1 — Privacy, manifest, dependency, and provenance gates

### Files

- `wxt.config.ts`
- `package.json`
- `package-lock.json`
- `.github/workflows/ci.yml`
- a production-manifest assertion under `tests/` or a small repository verification module
- `THIRD-PARTY.md`
- `docs/VISION.md`
- `docs/PRODUCT-SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/PUBLISHING.md`
- `docs/DESIGN.md` where privacy copy is normative
- `LEARNINGS.md` and `CHANGELOG.md`

### Steps

1. Pin every direct dependency and development dependency to its resolved exact version; regenerate
   the lockfile without broad ranges.
2. Complete the shipped-artifact BOM for React, React DOM, and vendored `lamejs`, including SPDX,
   purpose, notices, corresponding source/relink obligations, and how the vendor file enters each
   browser artifact.
3. Set the extension-page CSP to default-deny egress with `connect-src 'none'`, `form-action 'none'`,
   `frame-src 'none'`, `object-src 'self'`, and `base-uri 'none'`; also narrow other relevant sinks.
   Remove `wasm-unsafe-eval` while no bundled WASM requires it.
4. Add a deterministic check of both built manifests that rejects missing required directives,
   network-capable replacements, host permissions, remote script sources, and unnecessary
   `wasm-unsafe-eval`.
5. Run that assertion after both production builds in CI.
6. Narrow product and publishing claims to “local processing, no upload,” explicitly separating
   manifest/CSP enforcement from policy, and reconcile hard safety limits with “no arbitrary cap.”
7. Record the exact privacy contract and provenance workflow in durable docs.

### Verification

- Unit tests mutate representative Chrome and Firefox manifests to prove each forbidden regression
  fails.
- Inspect both generated manifests and packaged assets.
- Run `npm audit --omit=dev` and assess development-only advisories separately.
- Run full checks and both builds.

## PR 2 — Shared worker-owned, bounded audio pipeline

### Files

- new tool-agnostic audio infrastructure under `lib/core/`
- worker entry or entries under the owning audio modules
- `lib/core/worker.ts`
- `entrypoints/app/App.tsx`
- focused worker, limit, lifecycle, and malformed-input tests under `tests/`
- a small deterministic media fixture set under `tests/fixtures/`
- `docs/adr/` for the worker decode engine decision
- `docs/ARCHITECTURE.md`, `docs/PRODUCT-SPEC.md`, `THIRD-PARTY.md`, `LEARNINGS.md`, and
  `CHANGELOG.md`
- `package.json` and `package-lock.json` only if the selected, audited worker decoder/demuxer needs a
  new exact-pinned dependency

### Steps

1. Run a Chrome/Firefox compatibility spike for the exact worker-side WAV/MP3 and required Phase 1
   input configurations. Record the supported container/codec matrix and choose the smallest bundled,
   offline decoder/demuxer that avoids `AudioContext` on the UI thread.
2. Capture the decision in an ADR. Reject an architecture that silently falls back to main-thread
   decode or assumes Web Audio exists in workers.
3. Define one discriminated worker protocol for inspect/decode/transform/encode with progress in
   `0..1`, structured errors, transferable results, and one worker per job.
4. Establish numeric limits for input bytes, aggregate batch bytes, channels, sample rate, duration,
   frame count, decoded PCM bytes, queued audio, and output bytes. Use overflow-safe calculations and
   reject before allocation.
5. Move file inspection and decode off the UI thread. Process bounded chunks where the selected
   engine permits, respect backpressure, and close each `AudioData` in `finally` paths.
6. Make cancel terminate decode or export, reject once, ignore late messages, release worker-owned
   state, remove partial storage, and never resolve a downloadable result.
7. Handle worker crash, corrupt/truncated input, unsupported codec, oversized metadata, component
   unmount, and file replacement without stale success state.
8. Keep final download creation exclusively in the durable app page after a successful result.

### Verification

- Tests cover each limit boundary, overflow, truncated/corrupt data, unsupported configuration,
  progress clamping/monotonicity, cancel races, worker errors, and no result after cancellation.
- Instrument tests prove every created `AudioData` is closed on success, error, and cancellation.
- Browser tests verify the UI remains responsive during decode and cancellation meets the documented
  numeric latency target.
- Real Chrome and Firefox production artifacts decode supported WAV/MP3 fixtures offline.

## PR 3 — World-class Audio Cutter accuracy, accessibility, and polish

### Files

- `lib/tools/audio-cutter/audio.ts`
- `lib/tools/audio-cutter/encode.worker.ts` or its replacement using the shared pipeline
- `lib/tools/audio-cutter/Waveform.tsx`
- `entrypoints/app/App.tsx`
- `components/Button.tsx`
- `components/Progress.tsx`
- `assets/tailwind.css`
- cutter tests and round-trip fixtures under `tests/`
- `docs/DESIGN.md`, `docs/PRODUCT-SPEC.md`, `LEARNINGS.md`, and `CHANGELOG.md`
- `mocks/audio-cutter.html` if the accepted interaction differs from the current mock

### Steps

1. Make source-frame indices the canonical trim state. Derive displayed time, handle positions,
   selected duration, and worker requests from those indices.
2. Preserve pointer editing while enforcing a one-frame minimum range and deterministic clamping at
   the first and last source frame.
3. Add two independently focusable trim controls with accessible names, current time/frame values,
   minima/maxima, visible focus, and synchronized canvas positions.
4. Document and implement Arrow keys for a fine increment and modified/Page keys for a coarse
   increment. Keep handles from crossing and announce the changed boundary and selected duration in
   a polite live region.
5. Add text and structural cues for range, progress, cancel, error, and completion so meaning never
   depends on emerald, amber, or red alone.
6. Honor `prefers-reduced-motion` for button, dropzone, card, and progress transitions.
7. Route cut decode/encode through the shared bounded worker pipeline. Keep WAV PCM native and MP3
   through the exact-pinned bundled `lamejs` path with visible bitrate/channel policy.
8. Ensure cancel is available during decode and export, and suppress all partial or late downloads.
9. Polish loading, ready, capability, limit, progress, success, and failure states against
   `docs/DESIGN.md` and the cutter mock.

### Verification

- A generated non-integer-boundary fixture is selected by frame, exported to WAV, decoded again, and
  compared for first frame, last frame, sample count, channel order, and duration within one frame.
- Boundary tests cover zero, final frame, one-frame selections, reversed/invalid requests, and
  multichannel policy.
- Component tests exercise both handles with keyboard-only input and assert names, values, increments,
  clamping, focus, duration updates, and live announcements.
- Accessibility verification covers keyboard-only use, screen-reader semantics, 200% zoom, contrast,
  non-color status, and reduced motion.
- Offline Chrome and Firefox drives cut WAV and MP3, verify zero requests, parse/play the downloads,
  exercise cancel and worker crash, and confirm no partial download.

## PR 4 — Audio join/merge

### Files

- new `lib/tools/audio-join/` module with UI, DSP, and worker integration
- the app tool picker/router under `entrypoints/app/`
- shared components only where genuinely tool-agnostic
- focused join tests and fixtures under `tests/`
- `ROADMAP.md`, `docs/PRODUCT-SPEC.md`, `docs/DESIGN.md`, `LEARNINGS.md`, and `CHANGELOG.md`
- `mocks/home.html` or `mocks/batch.html` only if accepted behavior changes

### Steps

1. Add an Audio Join entry to the app and accept multiple files under aggregate limits.
2. Show visible order, metadata, compatibility state, remove controls, and keyboard-operable reorder
   controls before export.
3. Decode through the shared worker pipeline, normalize supported sample-rate and channel-layout
   differences under an explicit policy, and concatenate in visible order without inserted frames.
4. Export WAV or MP3 with determinate progress, cancellation, cleanup, and no partial download.
5. Keep files that fail inspection actionable without presenting a successful queue state.

### Verification

- Distinct-tone fixtures prove A-then-B ordering, reordered output, exact normalized duration within
  one frame, and no tool-introduced silent frame at the boundary.
- Tests cover removal, mixed rates/layouts, aggregate limits, one invalid member, cancellation at each
  stage, and worker failure.
- Offline Chrome and Firefox production drives reorder, export WAV/MP3, parse/play output, and record
  zero requests.

## PR 5 — Audio conversion to WAV/MP3

### Files

- new `lib/tools/audio-convert/` module with UI and worker integration
- app tool picker/router
- focused conversion tests and fixtures
- `ROADMAP.md`, `docs/PRODUCT-SPEC.md`, `docs/DESIGN.md`, `LEARNINGS.md`, and `CHANGELOG.md`

### Steps

1. Add the converter entry and inspect the input before enabling export.
2. Present WAV and MP3 settings, capability and channel-layout policy, estimated output constraints,
   and unsupported-input explanations before work starts.
3. Reuse shared bounded decode and encode infrastructure without importing Audio Cutter internals.
4. Preserve supported duration and channel layout, reject impossible RIFF output sizes, and keep MP3
   settings visible and reflected in the worker request.
5. Apply the common progress, cancellation, cleanup, and success-download contract.

### Verification

- Decode-round-trip tests prove PCM WAV validity and duration within one frame for every supported
  fixture.
- MP3 parser/decode tests prove playability and requested bitrate/channel settings, allowing only
  explicitly documented encoder delay.
- Corrupt, truncated, unsupported, oversized, cancellation, and worker-crash tests prove no
  misleading success or partial output.
- Offline Chrome and Firefox drives verify playback and zero requests.

## PR 6 — Coupled speed and pitch

### Files

- new `lib/tools/audio-speed/` module with UI, DSP, and worker integration
- app tool picker/router
- focused speed tests and tonal fixtures
- `ROADMAP.md`, `docs/PRODUCT-SPEC.md`, `docs/DESIGN.md`, `LEARNINGS.md`, and `CHANGELOG.md`

### Steps

1. Add the speed tool with a bounded multiplier control, output-duration preview, WAV/MP3 settings,
   and explicit “speed and pitch change together” copy.
2. Resample in the worker using overflow-safe frame math and the shared bounded pipeline.
3. Keep independent pitch/time-stretch visibly out of scope and do not add a Phase 3 engine.
4. Apply the common progress, cancel, cleanup, and download contract.

### Verification

- For minimum, typical, maximum, and fractional multipliers, decoded output duration equals input
  duration divided by the multiplier within one output frame.
- Frequency analysis of a tonal fixture proves pitch changes by the same ratio.
- Tests cover invalid factors, tiny output, limit expansion for slow factors, stereo alignment,
  cancellation, and worker failure.
- Offline Chrome and Firefox drives parse/play WAV and MP3 outputs and record zero requests.

## PR 7 — Phase 1 release-gate and product QA closure

### Files

- browser production-artifact tests and deterministic fixtures
- `.github/workflows/ci.yml`
- `docs/PRODUCT-SPEC.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, and `ROADMAP.md`
- compatibility and benchmark evidence under `docs/research/`
- `LEARNINGS.md` and `CHANGELOG.md`

### Steps

1. Run all Phase 1 tools from built Chrome and Firefox artifacts on the declared browser/OS matrix.
2. Test offline operation, request capture, progress, cancellation latency, tab close, worker crash,
   unsupported capability, failure cleanup, downloaded-file parsing, playback, and seeking.
3. Record numeric input, aggregate memory, peak memory, wall-clock, cancellation, output-size, and
   quality thresholds and mark each pass/fail rather than only recording observations.
4. Run keyboard, screen-reader, contrast, zoom, responsive-layout, and reduced-motion review.
5. Capture before/after screenshots or browser recordings for UI-impacting work.
6. Update roadmap checkboxes only for behavior proven in both browsers. Leave Phase 2 frozen.

## Acceptance-criteria verification matrix

| Criterion | Primary PR | Required proof |
| --- | --- | --- |
| 1. One-frame cut accuracy | PR 3 | WAV decode round-trip with fractional boundaries and frame/sample comparison |
| 2. Keyboard waveform/WCAG | PR 3 | Handle semantics and keyboard tests plus manual assistive-technology and reduced-motion evidence |
| 3. No-egress CSP | PR 1 | Built-manifest positive and mutation tests for Chrome and Firefox |
| 4. Worker decode/encode, limits, cleanup | PR 2; exercised by PRs 3–6 | Worker lifecycle tests, `AudioData.close()` instrumentation, numeric limit tests, cancellation latency, no result/download |
| 5. Offline | PRs 3–7 | Network disabled before file selection, zero request log, playable WAV/MP3 |
| 6. WAV/MP3 export and decode failure | PRs 3 and 5 | WAV/MP3 parse/decode, visible setting assertion, corrupt-input and no-success tests |
| 7. Join, convert, speed | PRs 4–6 | Per-tool focused adversarial tests and both-browser production drives |
| 8. Engineering/provenance | PR 1 and every PR | Exact pins, complete BOM, no attribution, `npm run check`, both builds, CI green |
| 9. UI/design/WCAG AA | PR 3 and each tool PR; closure in PR 7 | Design-token review, screenshots, keyboard/contrast/zoom/non-color/reduced-motion evidence |

## Required command and browser evidence for every implementation PR

1. Paste actual `npm run check` output.
2. Paste actual `npm run build` and `npm run build:firefox` output.
3. Load the built Chrome and Firefox extensions, not development pages.
4. Drive the affected tool with real deterministic media and inspect the downloaded output.
5. Record network requests, progress, cancel, cleanup, error, and unsupported paths applicable to the
   PR.
6. Verify each affected acceptance criterion explicitly; report blockers without reducing scope.
7. Run secret scanning and code/security review before committing the final revision.

## Completion condition

The mission is complete only after PR 7 shows all nine criteria green with actual command and browser
evidence. A successful build alone does not satisfy cross-browser behavior. No Phase 2 or Phase 3
work begins as part of this stream.

## Related research

`docs/research/2026-07-12-standing-stream-qa-review-product-level-review-of-media-tool.md`
