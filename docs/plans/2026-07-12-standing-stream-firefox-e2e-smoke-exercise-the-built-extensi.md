# Plan: Firefox built-extension E2E smoke

- **Date:** 2026-07-12
- **Owner:** Media Tools maintainers
- **Work unit:** Standing stream — Firefox E2E/smoke
- **Controller marker:** `unit-id: c249cded-a6c6-4612-a4e0-a3d2a66aa7d9`
- **Related research:**
  [`../research/2026-07-12-standing-stream-firefox-e2e-smoke-exercise-the-built-extensi.md`](../research/2026-07-12-standing-stream-firefox-e2e-smoke-exercise-the-built-extensi.md)

## Scope and outcome

Add a deterministic smoke harness that installs and drives the production Firefox artifact in real
Firefox. Cover packaging, offline processing, downloads, accessibility interactions, cancellation,
errors, and output media validation. Extend the same harness for each Phase 1 tool as those upstream
implementations land.

This work does not implement missing Audio Cutter hardening or Phase 1 product tools. If those
dependencies are not present when implementation starts, their scenarios are blockers rather than
skipped or weakened tests.

## Files to change

Expected paths; use the repository’s established naming if upstream work introduces equivalent files
before implementation.

- `package.json`, `package-lock.json` — exact-pin the Firefox WebDriver/test dependencies and add a
  Firefox E2E script; also reconcile existing drifting shipped dependency ranges as required by the
  release gate.
- `tests/e2e/firefox-smoke.mjs` — browser lifecycle, temporary add-on installation, stable extension
  origin, scenario orchestration, and cleanup.
- `tests/e2e/helpers/firefox.mjs` — isolated profile, offline/request observation, download waiting, and
  browser shutdown helpers.
- `tests/e2e/helpers/media.mjs` — deterministic WAV fixture generation plus independent WAV/MP3
  parsing/decode assertions.
- `tests/e2e/fixtures/` — only minimal checked-in malformed media that cannot be generated clearly in
  code; generated normal and long-running fixtures remain temporary.
- `tests/manifest.test.ts` or the upstream equivalent — production-manifest CSP and permission
  assertions for both built artifacts.
- `.github/workflows/ci.yml` — install a pinned Firefox version/driver, build first, run the smoke
  against `.output/firefox-mv3`, retain failure diagnostics, and keep both browser builds required.
- `docs/LEARNINGS.md` or `docs/history/2026-07-12-firefox-e2e.md` — record stable extension-origin,
  temporary-install, offline-observation, and download-test gotchas verified during implementation.
- `docs/THIRD-PARTY.md` — record any shipped dependency pin/provenance changes; development-only browser
  tooling is identified as non-shipped.

No application file should change merely to make automation easier. Add stable selectors only where
the accessible role/name is insufficient, and treat a missing accessible role/name as a product defect.

## Step-by-step implementation

1. **Establish the baseline.**
   - Create a branch containing the controller marker.
   - Run `npm ci`, `npm run check`, `npm run build`, and `npm run build:firefox`; preserve actual output.
   - Inspect both generated manifests and the Firefox artifact layout, including `app.html`, worker
     chunks, and the packaged MP3 asset.
   - Manually load the built artifact in headed Firefox once and record the exact startup/download
     behavior before introducing automation.

2. **Select and pin the Firefox automation stack.**
   - Use stock Firefox plus its supported WebDriver temporary-add-on API.
   - Exact-pin all new npm and CI action/tool versions after advisory review.
   - Keep browser tooling in development dependencies and out of extension bundles.
   - Add one explicit command that assumes artifacts already exist, so the suite cannot accidentally
     test source or the development server.

3. **Build the isolated harness.**
   - Create a fresh Firefox profile and download directory for every run.
   - Bind `audiocutter@animesh.kundus.in` to a deterministic test UUID, temporarily install the built artifact, and
     navigate to the resulting `moz-extension://` app URL.
   - Capture browser/driver logs, page errors, attempted requests, and final downloaded files.
   - Guarantee process, profile, object, and file cleanup in a top-level `finally` path.

4. **Add deterministic media verification.**
   - Generate mono and stereo WAV fixtures with known sample rate, duration, impulses, and tones.
   - Parse downloaded WAV headers and PCM independently from production helpers.
   - Decode/inspect MP3 with a test-only independent path and assert valid audio, expected visible
     settings, and duration within the codec-delay tolerance.
   - Add malformed/truncated input for the error path and a bounded larger fixture for cancellation.

5. **Exercise the Audio Cutter in built Firefox.**
   - Verify startup, offline badge, local file selection, decoded metadata, waveform, format controls,
     determinate progress, and status announcements.
   - Move each trim handle by keyboard and assert focus, accessible name/current value, documented
     increment, updated boundary, and live announcement.
   - Export a non-frame-aligned WAV and compare decoded output boundaries and sample count to the
     selected region within one source frame.
   - Export MP3 using the visible settings, then parse and decode the completed file.
   - Disable network before file selection for both formats and assert zero attempted requests.
   - Cancel during active progress and assert recovery plus no final or partial download.
   - Select malformed input and assert an actionable decode error, no success state, and no download.

6. **Add generated-manifest guards.**
   - Assert both Chrome and Firefox manifests use default-deny `extension_pages` CSP with
     `connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`, `object-src 'self'`, and
     `base-uri 'none'`.
   - Permit `'wasm-unsafe-eval'` only when a packaged WASM execution path proves it is needed.
   - Reject host permissions and egress-capable directive regressions in both artifacts.

7. **Extend the suite for upstream Phase 1 tools.**
   - Join/merge: provide ordered fixtures with distinguishable tones/impulses; verify visible order,
     output transitions, sample count, and no tool-introduced gap.
   - Convert: drive WAV and MP3 choices from the UI, then independently parse/decode each output and
     verify the requested visible settings.
   - Coupled speed/pitch: exercise supported multipliers and boundaries; verify output duration equals
     input divided by the multiplier within one frame and confirm coupled pitch movement.
   - Keep each scenario focused and non-skipped. If a product stream has not landed, report the suite
     as blocked rather than merging placeholder coverage.

8. **Integrate CI and diagnostics.**
   - Run the built-Firefox smoke after `npm run build:firefox` on `ubuntu-latest`.
   - Pin the Firefox version used for the declared contract and expose it in logs.
   - Upload browser logs and failed-download/profile diagnostics only on failure; never upload users’
     media because fixtures are generated.
   - Preserve the existing compile, lint, unit-test, and both-browser build gates.

9. **Drive and validate before handoff.**
   - Run `npm run check`, `npm run build`, `npm run build:firefox`, and the Firefox E2E command.
   - Repeat a headed, network-disabled Firefox drive with real WAV and MP3 fixtures; verify playback of
     downloads and inspect reduced-motion/high-contrast behavior.
   - Scan all changed files for secrets and prohibited attribution.
   - Run code review and security validation, resolve valid findings, and record actual verbatim command
     output and one-by-one acceptance evidence in the PR.

## Acceptance-criterion verification

1. **Cut accuracy:** built-Firefox WAV scenario independently decodes the download and compares selected
   start/end markers and sample count within one source frame.
2. **Keyboard waveform accessibility:** browser assertions cover focusable named handles, current values,
   documented key increments, live updates, non-color status text, visible focus, and reduced-motion.
   WCAG AA contrast is checked against shipped tokens and confirmed in the headed drive.
3. **No-egress CSP:** generated-manifest tests inspect both production artifacts and fail on missing or
   widened directives; offline Firefox smoke records zero attempted requests.
4. **Worker ownership/bounds/cancel/cleanup:** browser responsiveness and progress are observed while
   decode/encode runs; oversize input is rejected before work; cancellation terminates the job within
   the declared threshold and leaves no download. Worker unit/integration tests remain responsible for
   proving every `AudioData.close()` success/error/cancel path.
5. **Offline:** Firefox enters offline mode before file selection; WAV and MP3 downloads complete and
   independently parse/play with zero requests.
6. **Export:** WAV PCM duration is within one frame; MP3 parses/decodes at visible settings; malformed
   input produces an error with neither misleading success nor a download.
7. **Phase 1:** focused built-Firefox scenarios verify join order/no gap, WAV/MP3 conversion, and
   speed-duration math; CI still builds both browser artifacts. These scenarios block on the separate
   product PRs currently absent from `docs/ROADMAP.md`.
8. **Engineering:** actual output is retained for `npm run check`, both production builds, and Firefox
   E2E; package and provenance assertions reject drifting shipped versions; repository scans reject
   prohibited attribution.
9. **UI/WCAG:** built Firefox verifies the persistent offline badge, dark emerald editor, amber handles,
   determinate progress, keyboard flow, status text, focus treatment, reduced motion, and AA contrast
   against `docs/DESIGN.md` and the mocks.

## Key risks

- Firefox/driver/version drift can destabilize temporary installation; pin the declared test matrix and
  log exact versions.
- A random extension UUID makes direct navigation flaky; bind the Gecko ID to a stable test UUID.
- Headless download and accessibility behavior can differ from headed Firefox; retain a headed release
  drive until measured parity is documented.
- MP3 delay prevents applying WAV’s one-frame rule directly; test exact PCM cuts before encoding and
  use codec-aware MP3 duration/playability assertions.
- Cancellation can finish before the test acts; use deterministic bounded media and trigger only after
  observed in-progress state.
- Current upstream gaps mean the complete matrix cannot pass yet. Do not add skips, relaxed assertions,
  fake controls, or product changes in this E2E stream; report and sequence the blocking PRs.

## Completion evidence

The implementation handoff must include:

- actual verbatim output from the full check, Chrome build, Firefox build, and Firefox E2E commands;
- the Firefox and driver versions;
- generated-manifest CSP assertion results;
- downloaded-media parse/decode measurements;
- cancellation latency and proof of an empty download directory;
- zero-request offline evidence;
- one-by-one results for all nine acceptance criteria; and
- links to any upstream blocker PRs, history/learnings update, and the resulting E2E PR.
