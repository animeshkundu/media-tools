# Plan: standing stream discovery and Phase 1 follow-through

- **Date:** 2026-07-12
- **Owner:** Media Tools maintainers
- **Correlation marker:** `unit-id: 89153391-8562-4dee-9145-f0e4242776c3`
- **Status:** Proposed; implementation requires review.

## Goal

Turn the competitor discovery into a sequenced set of focused changes that first harden Audio
Cutter, then deliver the remaining Phase 1 audio tools without starting video or independent
pitch/time-stretch work.

The companion
[research entry](../research/2026-07-12-standing-stream-discovery-research-named-audio-editing-compe.md)
is the evidence record. This plan does not claim that any mission acceptance criterion is currently
met.

## Current files and expected change surface

The exact diff for each pull request should remain narrow, but the expected files are:

- **Privacy and supply chain:** `wxt.config.ts`, `package.json`, `package-lock.json`,
  `THIRD-PARTY.md`, `.github/workflows/ci.yml`, a production-manifest assertion under `tests/` or an
  existing script location, and privacy wording in `docs/VISION.md`, `docs/PRODUCT-SPEC.md`, and
  `docs/ARCHITECTURE.md`.
- **Shared audio execution:** `lib/core/worker.ts` plus new tool-agnostic worker protocol, limits, and
  lifecycle modules under `lib/core/`; focused tests under `tests/`.
- **Audio Cutter:** `entrypoints/app/App.tsx`,
  `lib/tools/audio-cutter/Waveform.tsx`, `lib/tools/audio-cutter/audio.ts`,
  `lib/tools/audio-cutter/encode.worker.ts`, and cutter-focused tests/fixtures.
- **Join:** a new `lib/tools/audio-join/` module with its worker and view, a tab/route entry in
  `entrypoints/app/App.tsx`, and focused tests.
- **Convert:** a new `lib/tools/audio-convert/` module with its worker and view, a tab/route entry in
  `entrypoints/app/App.tsx`, and focused tests.
- **Coupled speed:** a new `lib/tools/audio-speed/` module with its worker and view, a tab/route entry
  in `entrypoints/app/App.tsx`, and focused tests.
- **Design and durable records:** `assets/tailwind.css`, `docs/DESIGN.md`, relevant mocks, `ROADMAP.md`,
  and `LEARNINGS.md` only when the corresponding behavior or decision lands.

## Step-by-step delivery plan

### 1. Freeze scope and establish fixtures

1. Record explicit acceptance checks for WAV, MP3, corrupt input, cancellation, and offline
   operation before changing production behavior.
2. Add deterministic short mono/stereo fixtures with known frame markers, tones, sample rates, and
   non-frame-aligned requested boundaries.
3. Add adversarial fixtures for truncated/invalid headers and metadata that exceeds each ceiling.
4. Define one shared frame-index convention: inclusive start, exclusive end, with displayed seconds
   derived from frame indices.
5. Define numeric input, metadata, decoded-PCM, aggregate join, and output ceilings from measured
   browser memory results; reject before allocation rather than warning.

### 2. Land privacy and reproducibility foundations

1. Extend `extension_pages` CSP to default-deny connections, forms, and frames; retain only the
   minimum script/object/base directives and include WebAssembly permission only if a packaged path
   demonstrably needs it.
2. Build Chrome and Firefox, parse both generated manifests, and fail on missing directives,
   wildcard/remote sources, host permissions, or unexpected divergence.
3. Put the manifest assertion in CI after each browser build.
4. Replace all dependency ranges with exact versions and verify lockfile consistency.
5. Expand the shipped software bill of materials for the vendored MP3 path, including notices and
   source/relink obligations.
6. Reconcile product copy with the precise “local processing, no upload” contract.

### 3. Move decode and heavy audio work into a bounded worker pipeline

1. Run a Chrome/Firefox capability spike for worker `AudioDecoder` and the exact WAV/MP3 input
   demux/decode contract. Do not assume Web Audio is available in a worker.
2. Choose the smallest cross-browser, packaged decode path that passes the spike. Record the
   decision and provenance before adding any dependency.
3. Replace encode-specific messages with a discriminated, tool-agnostic job protocol carrying
   progress in `0..1`, typed results, actionable errors, and explicit lifecycle states.
4. Preflight `File.size` immediately, then validate metadata with overflow-safe calculations before
   decoded buffers or outputs are allocated.
5. Keep file/decode/transform/encode in a per-job worker; transfer rather than clone large buffers
   where the platform permits and process bounded chunks with backpressure.
6. Close every `AudioData` in `finally` paths and release chunks/references on success, cancellation,
   worker crash, decode failure, and encode failure.
7. Keep download creation solely in the durable app page after a complete result. Cancel terminates
   the worker and cannot expose a partial result.
8. Test progress clamping/monotonicity, cancellation latency, crash cleanup, limit rejection, and no
   post-cancel result.

### 4. Make Audio Cutter exact and keyboard operable

1. Store trim boundaries as integer source-frame indices; convert pointer positions and displayed
   values at the UI boundary.
2. Slice with the shared inclusive-start/exclusive-end convention and preserve channel alignment.
3. Add a decode round-trip assertion for generated WAV and MP3 cuts, including near-start,
   near-end, minimum-length, and non-frame-aligned selections.
4. Keep the waveform canvas visual, but add two independently focusable semantic handles with
   accessible names, current/min/max values, visible focus, and spatial alignment.
5. Document and implement Arrow keys for one documented normal increment plus a modified fine or
   coarse increment. Clamp handles, preserve minimum selection, update all time/duration output, and
   announce the new boundary through a polite status.
6. Ensure instructions and states use text in addition to amber/emerald/red, meet contrast
   requirements, and disable nonessential animation under `prefers-reduced-motion`.
7. Preserve pointer behavior and verify pointer, keyboard, resize, zoom level, and both handle
   crossing boundaries.

### 5. Prove the flagship end to end

1. Run the built Chrome extension with networking disabled before file selection; cut real WAV and
   MP3 inputs to both WAV and MP3 outputs.
2. Capture network requests and require none during file open, decode, edit, encode, and download.
3. Parse and play every output; compare decoded frame count and markers to the requested selection.
4. Cancel during decode and each encoding format; verify worker termination within the numeric
   threshold, usable UI recovery, released state, and no download/object URL.
5. Exercise corrupt/unsupported input and worker failure; verify actionable error text and no
   success state.
6. Repeat on the built Firefox artifact, including keyboard-only trim operation and reduced motion.

### 6. Add Audio Join in its own pull request

1. Add a tool-local view and worker supporting multiple files, visible order, accessible reorder and
   remove actions, and aggregate preflight limits.
2. Normalize supported sample rates/channel layouts using a documented deterministic policy.
3. Concatenate bounded decoded frames in visible order with no inserted frame or silent gap.
4. Reuse the shared WAV/MP3 output contract, progress, cancellation, cleanup, and download gate.
5. Test A→B markers, reordered B→A markers, mixed sample rates/layouts, boundary continuity, limit
   rejection, malformed input, cancellation, and both output formats.
6. Build and drive both browser artifacts offline before marking the tool live.

### 7. Add WAV/MP3 conversion in its own pull request

1. Add a one-file tool-local view with source metadata, explicit WAV/MP3 choices, and visible MP3
   settings.
2. Decode and validate before enabling export; corrupt/unsupported input must never reach success.
3. Reuse shared bounded worker encode and lifecycle behavior without reaching into cutter internals.
4. Test duration/channel policy, WAV headers and round trip, MP3 requested settings/playback,
   hostile input, cancellation, and no download on failure.
5. Build and drive both browser artifacts offline before marking the tool live.

### 8. Add coupled speed and pitch in its own pull request

1. Add a tool-local view with a bounded multiplier, predicted output duration, and plain language
   that speed and pitch change together.
2. Resample in the worker with deterministic frame-count rounding and bounded memory.
3. Reuse shared output, progress, cancellation, cleanup, and download behavior.
4. Test output duration equals input duration divided by multiplier within one frame and measure a
   tonal fixture to prove pitch changes by the same ratio.
5. Point independent pitch/duration needs to the later gated tool without implementing it.
6. Build and drive both browser artifacts offline before marking the tool live.

### 9. Final integration and records

1. Keep the dark emerald shell, amber trim handles, determinate progress, visible offline badge, and
   responsive layouts aligned with the design source and mocks.
2. Update `ROADMAP.md` only as each tool actually lands; update architecture, design, third-party,
   and durable learnings in the same pull request as the behavior they describe.
3. For every pull request run `npm run check`, `npm run build`, and `npm run build:firefox`, then
   drive the affected built tool with real media in Chrome and Firefox.
4. Record actual command output, browser evidence, acceptance results, known limits, and intentionally
   deferred work in each handoff.

## Acceptance-criterion verification matrix

| Criterion | Automated verification | Browser/artifact verification |
| --- | --- | --- |
| 1. Cut region accuracy | Decode round-trip fixtures compare start/end markers and frame count within one frame for non-aligned selections. | Play and inspect real WAV/MP3 cuts in both built extensions. |
| 2. Keyboard waveform | Component tests focus each named/value-bearing handle, exercise documented key/modifier increments and clamping, and assert live text plus reduced-motion styles. | Keyboard-only Chrome/Firefox pass with visible focus, screen-reader value announcement, contrast, and non-color status. |
| 3. No-egress CSP | Production-manifest test parses both builds and rejects missing default-deny directives, remote/wildcard sources, or unexpected host permissions. | Load both artifacts and confirm normal operation under the shipped CSP. |
| 4. Worker ownership and cleanup | Worker protocol/lifecycle tests cover decode/encode ownership, preflight limits, `0..1` progress, termination, `AudioData.close()` on every path, and no result after cancel. | Cancel decode/encode and force worker failure in both browsers; verify threshold, memory/state recovery, and no download. |
| 5. Offline | Integration harness fails on any processing request and covers WAV/MP3 success with networking disabled before open. | Inspect browser network logs while opening, processing, downloading, and playing output in Chrome and Firefox. |
| 6. Export correctness | WAV parser/round trip, MP3 decode/playability/settings checks, and corrupt-input regression tests. | Play real outputs and verify unsupported input cannot expose a success state. |
| 7. Phase 1 tools | Join marker/order/gap tests; conversion duration/settings tests; speed duration and pitch-ratio tests. | Offline end-to-end drive of each separate tool in both production artifacts. |
| 8. Engineering | `npm run check`, exact-version/lockfile assertion, software-bill-of-material checks, both production builds, and repository attribution policy check. | CI must be green on the required matrix; each handoff includes verbatim command output. |
| 9. UI and WCAG | Semantic queries, focus order, contrast/token checks where automatable, status text, and reduced-motion tests. | Compare both browser builds to design mocks at desktop/mobile sizes and capture keyboard/a11y evidence. |

## Key risks and mitigations

- **Decode support differs by browser/OS:** prove the exact Phase 1 input matrix before choosing the
  worker decode engine; disable unsupported inputs early and report them honestly.
- **Memory multiplies during decode, join, and MP3 encode:** enforce metadata and aggregate ceilings,
  chunk work, transfer buffers, and measure peak memory rather than relying on source size.
- **MP3 encoder delay obscures one-frame assertions:** validate decoded audible markers and document
  padding semantics; do not weaken WAV frame-accuracy checks.
- **Semantic handles can drift from canvas rendering:** derive both from one frame-based selection
  model and test resize/alignment.
- **Shared-core refactors can couple tools:** keep infrastructure protocol-only and tool logic inside
  `lib/tools/<name>/`; land one concern per pull request.
- **Competitor feature creep:** defer fades, zoom, batch, extra formats, video, and independent
  pitch/time-stretch unless separately accepted.
- **Privacy claims can exceed controls:** keep copy precise and treat manifest and runtime checks as
  separate evidence.

## Completion gate

This plan is complete when reviewers accept the research-backed work-item sequence. Implementation
is complete only after every criterion above has its automated and artifact evidence, all required
commands have passed with verbatim output, and no blocker or reduced scope is hidden.

