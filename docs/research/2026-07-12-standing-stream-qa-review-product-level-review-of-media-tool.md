# Standing stream QA review: product-level review of Media Tools

> **SUPERSEDED (2026-07-14):** Findings below about main-thread Web Audio describe the retired
> decode path and are preserved as a point-in-time review. The shipped engine decodes MP3 with
> worker-side WebCodecs `AudioDecoder` and parses WAV PCM directly in the worker. Bundled `lamejs` is
> used for MP3 encoding only.

- **Date:** 2026-07-12
- **Owner:** @animeshkundu
- **Work unit:** QA review of the shipped product against the vision, product specification, design system, architecture, peer-review dispositions, and roadmap
- **Correlation marker:** `unit-id: d2bbce55-d026-47c2-86de-6d9f81702283`

## Research question

What is implemented today, what prevents the Audio Cutter and Phase 1 audio suite from meeting the
binding product bar, and what order minimizes architectural rework while keeping Phase 2 and Phase 3
out of scope?

## Sources reviewed

- Product authority: `docs/VISION.md`, `docs/PRODUCT-SPEC.md`, `docs/DESIGN.md`,
  `docs/ARCHITECTURE.md`, `docs/PEER-REVIEW.md`, `docs/ROADMAP.md`, and the HTML mocks.
- Shipped surfaces: `entrypoints/app/`, `entrypoints/background.ts`, `components/`,
  `lib/core/`, `lib/tools/audio-cutter/`, `assets/tailwind.css`, and `public/vendor/lame.min.js`.
- Verification and packaging: `tests/audio.test.ts`, `wxt.config.ts`, `package.json`,
  `package-lock.json`, `docs/THIRD-PARTY.md`, and `.github/workflows/ci.yml`.
- Production artifacts generated on 2026-07-12 under `.output/chrome-mv3/` and
  `.output/firefox-mv3/`.

## Executive finding

The repository is a credible, compact Audio Cutter seed, not yet the product described by the
mission. Its strongest foundations are the full-page durable host, glue-only background, minimal
permissions, bundled MP3 encoder, shared Chrome/Firefox source, determinate encode progress, and
worker termination on cancel. The implementation is visually close to the cutter mock and both
production builds are below 500 kB.

The release-blocking gaps are structural rather than cosmetic:

1. Decode and full-file PCM expansion happen on the main thread and cannot be cancelled.
2. The canvas trim handles have no independent keyboard or range semantics.
3. The CSP does not default-deny egress and CI does not inspect built manifests.
4. No pre-decode file or decoded-memory limits exist.
5. Accuracy tests inspect a WAV header but do not decode the export or prove endpoint accuracy.
6. Phase 1 join, conversion, and coupled speed tools are absent from the app.
7. Dependencies drift, bundled `lamejs` provenance is incomplete, and the current CSP enables
   `wasm-unsafe-eval` although no WASM ships.
8. Offline, cancellation, cleanup, accessibility, and real-browser playback are not exercised in
   production-artifact tests.

Phase 2 video and Phase 3 independent pitch/time-stretch must remain frozen.

## What is already aligned

| Area | Evidence | Assessment |
| --- | --- | --- |
| Durable host | `entrypoints/background.ts` only opens `/app.html`; `entrypoints/app/App.tsx` owns state and download | Aligned |
| Cross-browser source | WXT builds Chrome MV3 and Firefox MV3 from one codebase | Aligned |
| Permissions | Both built manifests declare `permissions: []` and no host permissions | Aligned |
| Local MP3 engine | `public/vendor/lame.min.js` is packaged and loaded by `encode.worker.ts` | Aligned, provenance work remains |
| Export isolation | Cutting and WAV/MP3 encoding run in a dedicated worker | Partially aligned; decode remains on the UI thread |
| Cancellation model | `lib/core/worker.ts` terminates the worker and only downloads a resolved result | Good seed; decode and lifecycle edge cases remain |
| Progress | Worker reports values and `Progress.tsx` exposes numeric progressbar semantics | Good seed; WAV progress is effectively two-step |
| Visual baseline | Dark emerald shell, amber range, file card, output control, cancel, status, and offline badge match `docs/DESIGN.md` | Close to target |
| Build parity | Chrome and Firefox production builds succeeded and contain the same app and worker assets | Aligned at build level only |

## Acceptance-criteria gap analysis

### 1. Cut region accuracy

**Current state:** `cutPcm()` converts seconds with `floor(start)` and `ceil(end)`, while UI state is
floating-point seconds. The tests assert only an exact, cooperative half-second case and WAV header
length. They do not decode the generated file or test fractional-frame endpoints, clipping, channel
agreement, invalid ranges, or MP3 delay.

**Gap:** There is no decode round-trip proof that selected frame boundaries reproduce within one
frame. Selection should have one canonical frame-index representation so drawing, accessible values,
duration, and export cannot round differently.

### 2. Keyboard-operable waveform and WCAG AA

**Current state:** `Waveform.tsx` is one pointer-driven canvas with a descriptive label. Neither
handle is focusable and neither exposes a name, current value, minimum, or maximum. Arrow-key
behavior is absent. The live status region exists, but selection changes are not announced.
Transitions in `Button.tsx`, `Progress.tsx`, and `dropzone.tsx` have no reduced-motion override.

**Gap:** The two handles need independent range semantics, visible focus, documented fine/coarse
keyboard increments, non-color instructions, and polite announcements. Contrast, zoom, screen-reader,
keyboard-only, and reduced-motion checks are not recorded.

### 3. No-egress CSP and manifest guard

**Current state:** both built manifests contain only:

`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`

There are no source-level processing network calls and no host permissions, but the CSP leaves
network and navigation sinks open. CI builds both artifacts but does not assert their manifests.
`wasm-unsafe-eval` is enabled despite the current artifact containing no WASM.

**Gap:** Add the required default-deny directives, remove unneeded WASM permission, and fail CI when
either production manifest regresses. Product and publishing copy must distinguish enforced
properties from policy promises.

### 4. Worker-owned heavy work, limits, cancellation, and cleanup

> **SUPERSEDED decode finding:** The current-state decode details below describe the retired path.
> See the status note at the top of this record.

**Current state:** `App.tsx` reads the entire file, decodes it with `AudioContext`, copies every
channel, and retains the full PCM on the main thread. Export then copies every channel again before
transferring it. No file-size, channel-count, sample-rate, duration, frame-count, decoded-byte, or
output-size limit is checked. Cancel is unavailable during decode. The encode worker uses
`Float32Array`, not `AudioData`, so there is no `AudioData.close()` path to verify.

**Gap:** A worker-capable demux/decode design must be selected and capability-tested on both browsers
before Phase 1 grows. It must stream or bound retained PCM, close every `AudioData` on success,
cancel, and error, reject hostile metadata before allocation, and terminate within a numeric target.
The documentation's “no arbitrary cap” wording must not contradict safety limits.

### 5. Offline behavior

**Current state:** all observed executable assets are packaged, and production manifests have no host
permissions. This supports the intended behavior but does not prove it.

**Gap:** There is no browser test that disables networking before file selection, records requests,
runs WAV and MP3 cuts, downloads the results, and verifies playback. There is also no CI artifact test
for accidental remote URLs or egress-capable CSP changes.

### 6. WAV/MP3 export and decode errors

**Current state:** native 16-bit mono/stereo PCM WAV and fixed 192 kbps MP3 export exist. Decode
failure returns useful copy and no success download. The selected MP3 setting is visible.

**Gap:** WAV validation is header-only. MP3 has no parser/playback or requested-settings assertion.
More than two source channels are silently truncated for MP3 but rejected for WAV. WAV allocation has
no RIFF overflow guard. Decode failure and worker crash paths are not tested through the UI.

### 7. Phase 1 tools

**Current state:** `docs/ROADMAP.md` correctly marks join/merge, conversion, and coupled speed as undone.
The app has no tool picker or routing despite `mocks/home.html` depicting the suite.

**Gap:** Each tool needs a self-contained module, UI entry, worker job, limits, focused adversarial
tests, and real Chrome/Firefox artifact verification. Shared decode, normalization, encode, progress,
cancel, and cleanup infrastructure should land first so tools do not depend on Audio Cutter internals.

### 8. Engineering and provenance

**Current state:** `npm run check`, `npm run build`, and `npm run build:firefox` pass after `npm ci`.
Production build sizes are 483.84 kB (Chrome) and 483.83 kB (Firefox). `npm audit --omit=dev` reports
zero production vulnerabilities; installation reports nine development-tree advisories requiring a
separate maintenance assessment.

**Gap:** every direct dependency and dev dependency in `package.json` uses a caret range. The
top-level lockfile entries preserve those ranges. `docs/THIRD-PARTY.md` lists shipped package versions but
omits notices, source/relink obligations, and artifact-specific details required by the guardrails.
No automated attribution scan exists.

### 9. Product UI and design system

**Current state:** the cutter is close to the shipped theme and has an always-visible offline badge,
text status, responsive controls, and an accessible dropzone/progressbar. The current app does not
surface the Phase 1 suite, capability explanations, explicit progress text/percentage, or independent
trim handles.

**Gap:** polish must follow functional hardening, not mask it. Add the tool picker, clear state copy,
visible capability and safety-limit explanations, keyboard focus, non-color status, and
reduced-motion behavior. Validate at narrow and wide layouts with browser screenshots.

## Additional product-level inconsistencies

- `docs/VISION.md` made an overbroad auditability claim and said “no arbitrary size cap,” while binding
  guardrails require narrower claims and hard safety limits.
- `docs/ARCHITECTURE.md` still presents Web Audio as the audio engine while worker-owned decode cannot
  use `AudioContext`; the accepted peer review requires a decision before join/speed.
- The design mocks imply multiple Phase 1 tools are available, but only Audio Cutter ships.
- `docs/PUBLISHING.md` says the current CSP is already set appropriately and repeats “nothing leaves
  the device”; it does not disclose the current lack of default-deny egress directives.
- The fixed MP3 bitrate is visible, but there is no capability or channel-policy copy.

## Risks to resolve before implementation

1. **Cross-browser worker decode:** WebCodecs codec/container coverage varies by browser and OS.
   Choose a tested demux/decode path and disable unsupported inputs before work; do not fall back to
   main-thread decode.
2. **Memory multiplication:** file bytes, decoded PCM, worker transfer, cut buffers, Int16 conversion,
   MP3 chunks, and final Blob can coexist. Define aggregate limits from measured peak memory, not only
   raw file size.
3. **MP3 encoder delay:** MP3 cannot satisfy sample-exact duration in the same way as PCM WAV. Keep
   the one-frame cut-accuracy gate on decoded PCM/WAV and separately verify playable MP3, visible
   settings, and documented encoder delay.
4. **Cancellation races:** late worker messages, component unmount, file replacement, tab close, and
   worker crashes must not trigger download or stale state.
5. **Accessibility geometry:** accessible handle controls must stay synchronized with canvas pointer
   geometry and canonical frame indices without overlapping or unreachable focus targets.
6. **Provenance:** the vendored minified `lamejs` file needs a reproducible source relationship,
   notice, and LGPL obligations before store submission.
7. **Scope control:** shared audio infrastructure can enable Phase 1, but no video or independent
   pitch/time-stretch work should enter these PRs.

## Baseline verification evidence

Executed from a clean dependency install on 2026-07-12:

- `npm ci`: completed; 531 packages installed.
- `npm run check`: passed compile, lint, and 2 Vitest tests.
- `npm run build`: passed; Chrome MV3 artifact size 483.84 kB.
- `npm run build:firefox`: passed; Firefox MV3 artifact size 483.83 kB.
- `npm audit --omit=dev`: found 0 vulnerabilities.

The first attempted `npm run check` failed because dependencies and generated WXT types were absent;
`npm ci` and its `wxt prepare` postinstall restored the expected environment. This was an environment
setup failure, not a repository test failure.

## Decision

Proceed as a sequence of focused PRs: first enforce privacy/provenance gates, then establish shared
worker-owned bounded audio processing, then harden Audio Cutter, then add join, conversion, and
coupled speed in roadmap order, and finally run the cross-browser release-gate review. Do not start
Phase 2 or Phase 3.

## Related artifacts

- Plan:
  `docs/plans/2026-07-12-standing-stream-qa-review-product-level-review-of-media-tool.md`
- Binding findings: `docs/PEER-REVIEW.md`
- Delivery order: `docs/ROADMAP.md`

