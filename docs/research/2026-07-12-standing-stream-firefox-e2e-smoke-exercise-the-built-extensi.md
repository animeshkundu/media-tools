# Firefox built-extension E2E research

> **SUPERSEDED (2026-07-14):** References below to main-thread Web Audio and the former extension ID
> describe the repository at research time. The shipped engine now decodes MP3 with worker-side
> WebCodecs `AudioDecoder` and parses WAV PCM directly in the worker. The shipped extension ID is
> `audiocutter@animesh.kundus.in`.

- **Date:** 2026-07-12
- **Owner:** Media Tools maintainers
- **Work unit:** Standing stream — Firefox E2E/smoke
- **Controller marker:** `unit-id: c249cded-a6c6-4612-a4e0-a3d2a66aa7d9`

## Context

The release gate requires the production Firefox artifact to be loaded into real Firefox and driven with
real media. Unit tests and a successful WXT build do not prove that the generated manifest, extension
page, worker URL, bundled MP3 encoder, downloads, keyboard interaction, or offline behavior work under
`moz-extension://`.

This research scopes an automated Firefox smoke stream. It does not implement product features or
Phase 2/3 work.

## Current repository findings

### Build and CI

- WXT produces both browser artifacts through `npm run build` and `npm run build:firefox`
  (`package.json`, scripts).
- CI compiles, lints, runs Vitest, builds Chrome and Firefox, and uploads `.output/`, but never loads
  either artifact in a browser (`.github/workflows/ci.yml`).
- There is no E2E runner, Firefox driver, media fixture, browser matrix, or smoke-test script in the
  repository.
- All dependency declarations currently use drifting caret ranges, including shipped `lamejs`; this
  conflicts with the exact-pin release gate (`package.json`; `CLAUDE.md`, “Correctness and release
  gates”).

### Firefox artifact and runtime boundaries

- The durable host is the full-page app and the background is glue only
  (`CLAUDE.md`, “Architecture”; `docs/ARCHITECTURE.md`, Sections 2 and 6).
- The Firefox build has an explicit Gecko extension ID and declares no required data collection
  (`wxt.config.ts`).
- The generated extension CSP currently lacks the required default-deny egress directives
  (`wxt.config.ts`; `CLAUDE.md`, “Privacy and offline contract”).
- A Firefox test must install the generated `.output/firefox-mv3` artifact, not serve source files or
  exercise the Vite development page. A stable test profile/extension UUID is needed so automation can
  navigate directly to the built `app.html`.
- Playwright-style page tests alone are insufficient unless the runner can install a normal Firefox
  WebExtension. The implementation should use Firefox’s supported temporary add-on/WebDriver path and
  a stock Firefox binary rather than substituting a source-page test.

### Flagship behavior presently testable

- File decode currently runs on the app main thread with `AudioContext`; only cut/encode runs in a Web
  Worker (`entrypoints/app/App.tsx`; `lib/core/worker.ts`; `lib/tools/audio-cutter/encode.worker.ts`).
- WAV and MP3 are visible export choices. MP3 code is loaded from the packaged vendor asset in the
  worker (`entrypoints/app/App.tsx`; `lib/tools/audio-cutter/encode.worker.ts`).
- A resolved worker result triggers the download; cancel terminates the worker and rejects the job,
  so the intended contract is no download before a complete result (`lib/core/worker.ts`;
  `entrypoints/app/App.tsx`).
- The waveform is a pointer-operated canvas. It has one label but no focusable trim handles, per-handle
  values, or keyboard controls (`lib/tools/audio-cutter/Waveform.tsx`).
- There is no pre-decode input-size rejection (`entrypoints/app/App.tsx`).
- Existing Vitest coverage checks pure WAV slicing/header behavior only. It does not decode the output
  round trip, test MP3, render the UI, or run a built extension (`tests/audio.test.ts`).

### Phase status

- Join/merge, format conversion, and coupled speed/pitch remain unchecked in `docs/ROADMAP.md` and have no
  implementation directories or tests.
- No Phase 2 video work should be included in this stream.

## Recommended E2E boundary

Use a Node-driven Firefox WebDriver smoke harness as an exact-pinned development-only dependency. The
harness should:

1. start a stock Firefox binary with an isolated temporary profile and deterministic download folder;
2. assign the declared Gecko ID a stable internal UUID and temporarily install the packaged Firefox
   artifact;
3. open the built extension’s `app.html`;
4. generate small deterministic WAV fixtures in the test process;
5. disable network before selecting the fixture and record any attempted request;
6. interact only through user-visible controls, including keyboard input;
7. wait for a completed download, parse/decode it independently, and assert media properties; and
8. always remove downloads, profiles, and browser processes on success or failure.

Keep pure media assertions in focused Vitest tests where possible. Reserve Firefox E2E for packaging
and integration contracts that unit tests cannot prove.

## Required smoke matrix

| Scenario | Built-extension evidence |
| --- | --- |
| Startup | Firefox installs the artifact, opens `app.html`, and shows the always-visible offline badge. |
| WAV cut | A non-frame-aligned selection exports; independent decode confirms boundaries/duration within one source frame. |
| MP3 cut | Visible bitrate/format settings are used; the download parses and decodes with nonzero audio. |
| Keyboard trim | Both named handles receive focus; documented keys update the value and live announcement. |
| Invalid input | Decode failure is announced and no success text or download appears. |
| Cancel | A long-enough job is cancelled; progress stops, controls recover, and the download directory remains empty. |
| Offline/no egress | Network is disabled before file selection; WAV and MP3 complete with zero attempted requests. |
| CSP | Generated Firefox and Chrome manifests contain the exact default-deny directives. |
| Phase 1 tools | Join order/gap, conversion, and coupled-speed duration are added to the same built-Firefox suite as each tool lands. |

## Risks and mitigations

- **Firefox add-on identity:** the runtime origin is not the manifest ID. Set a deterministic
  `extensions.webextensions.uuids` profile preference tied to `audiocutter@animesh.kundus.in`.
- **Unsigned artifact installation:** use Firefox’s temporary add-on installation for CI, while testing
  the exact files produced by the production build.
- **Download races:** use an isolated download directory, wait for temporary files to disappear, then
  parse the final file rather than relying only on UI success text.
- **MP3 encoder delay:** assert parse/playability and settings separately from exact WAV-style sample
  boundaries; retain the one-frame exactness gate for decoded PCM/WAV.
- **Network observation:** disabling connectivity alone does not prove no attempts. Combine Firefox
  offline mode with request observation and generated-manifest CSP assertions.
- **Cancellation flakiness:** use a deterministic fixture large enough to expose active progress and a
  numeric timeout, not arbitrary sleeps.
- **Headless differences:** run the core CI smoke headless, then retain a documented headed release
  drive for download/playback and accessibility inspection until parity is demonstrated.
- **Upstream blockers:** current main-thread decode, missing keyboard handles, incomplete CSP, missing
  limits, and absent Phase 1 tools prevent the full mission matrix from passing today. The smoke stream
  must report those dependencies; it must not skip, weaken, or falsely mark those gates complete.

## Sources

- `CLAUDE.md`
- `package.json`
- `wxt.config.ts`
- `.github/workflows/ci.yml`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT-SPEC.md`
- `docs/DESIGN.md`
- `entrypoints/app/App.tsx`
- `lib/core/worker.ts`
- `lib/tools/audio-cutter/Waveform.tsx`
- `lib/tools/audio-cutter/encode.worker.ts`
- `tests/audio.test.ts`

## Follow-up

Implementation details and acceptance-criterion mapping are in
[`../plans/2026-07-12-standing-stream-firefox-e2e-smoke-exercise-the-built-extensi.md`](../plans/2026-07-12-standing-stream-firefox-e2e-smoke-exercise-the-built-extensi.md).
