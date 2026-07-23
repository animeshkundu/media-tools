# Learnings

Record durable project learnings here so future work can avoid rediscovering them.

## Current repo facts

- Repo: `animeshkundu/media-tools`
- Product: Audio Cutter, a WXT Manifest V3 Chrome and Firefox extension for cutting, joining/merging, changing speed, adjusting volume/fades, and converting WAV and MP3 audio locally.
- Stack: WXT 0.20, React 19, strict TypeScript, Tailwind CSS 4, Vitest, and Playwright.
- Main verification: `npm run check` for compile, lint, and unit/component tests; `npm run build` and `npm run build:firefox` for production artifacts; `npm run test:e2e` for the built extension in real Firefox.
- OS contract: No single desktop OS is product-primary; required automated verification runs on Ubuntu Linux through `ubuntu-latest`.

## Durable engineering learnings

### Keep audio memory limits enforced before allocation

- Context: A compact compressed WAV or MP3 file can expand into much larger floating-point PCM during decode and processing.
- What the repository enforces: Input files are limited to 64 MiB, audio is limited to mono or stereo, and decoded or in-flight PCM is limited to 256 MiB. WAV metadata, duration, frame counts, sample rates, chunk sizes, and arithmetic are checked before large buffers are allocated.
- What to preserve: New cut, join, change-speed, volume/fade, and conversion paths must reuse or strengthen these checks. Never allocate from untrusted media dimensions before validating safe integer arithmetic and the applicable aggregate limit.
- Related code: `lib/core/worker.ts`, `lib/tools/audio-cutter/encode.worker.ts`, and `docs/CAPABILITY-CONTRACT.md`.

### Treat cancellation as a worker-lifecycle guarantee

- Context: Audio decode and encode jobs can be long enough that cancellation and cleanup are user-visible safety behavior.
- What the repository enforces: The app owns a cancellable job handle, cancellation terminates the Web Worker and rejects the job, and download creation occurs only after a complete worker result.
- What to preserve: Keep one clear settlement path, ignore late worker messages, terminate workers on success, error, crash, or cancellation, and never create a download from an incomplete result.
- Related code: `lib/core/worker.ts` and `entrypoints/app/App.tsx`.

### Verify the no-network contract at the production boundary

- Context: Source review alone does not protect the privacy promise after bundling or manifest generation.
- What the repository enforces: CI scans built JavaScript across Chrome and Firefox artifacts for network primitives, validates the production Content Security Policy, checks manifest egress keys, and keeps install-time permissions empty.
- What to preserve: Run privacy checks against generated production artifacts, fail closed when no bundle is found, and treat any CSP, manifest, permission, dependency, or runtime-network change as a security-sensitive change.
- Related code: `.github/workflows/ci.yml`, `scripts/check-csp.mjs`, `scripts/check-manifest-egress.mjs`, and `docs/CAPABILITY-CONTRACT.md`.

### Use the built extension in real Firefox as a release gate

- Context: Successful TypeScript, unit-test, and dual-target build commands do not prove that a packaged extension works in a browser.
- What the repository enforces: A separate CI job, the Firefox E2E workflow, builds and lints `.output/firefox-mv3`, provisions Firefox and geckodriver through Selenium Manager, installs the built add-on, drives its real `moz-extension://` app page, runs the production-artifact E2E suite, and rejects missing, skipped, flaky, unexpected, or insufficient results.
- What to preserve: Browser-facing changes need real-Firefox coverage for installed-extension startup, WAV cut and export, MP3 conversion and input, join, speed, download signatures, and no-egress behavior where applicable. Add focused malformed-input, progress, or cancellation scenarios when a change relies on those paths. Do not replace this gate with mocks or a dev-server-only test.
- Related code: `.github/workflows/e2e.yml`, `tests/e2e/global-setup.ts`, `tests/e2e/playwright.config.ts`, and `tests/e2e/audio-cutter.e2e.ts`.

### Keep the hosted app on the shared editor boundary

- Context: GitHub Pages serves at `/media-tools/`, while WXT emits extension-only artifacts.
- What the repository enforces: `vite.web.config.ts` mounts the same `entrypoints/app/App.tsx` from `web/main.tsx`, copies bundled worker assets, and emits the committed `site/app/` artifact with the `/media-tools/app/` base.
- What to preserve: Never fork tool code for the website. Keep web trust copy scoped to local processing and no upload; do not claim the extension's empty permissions or no-egress CSP for a normal webpage. Pages provides no COOP/COEP headers, so the hosted target must not bypass future engine gates that require cross-origin isolation.
- Related code: `web/`, `vite.web.config.ts`, `.github/workflows/pages.yml`, and `tests/webSurface.test.ts`.

### Normalize the final envelope, not the source peak

- Context: A fade can remove the sample that held the source peak. Calculating normalization gain before applying the envelope can therefore miss the promised final target.
- What the repository enforces: Volume & Fades scans the post-envelope signal first, derives gain from that peak, and then mutates the decoded worker PCM in place. Silence stays silent rather than receiving an unbounded gain.
- What to preserve: Peak normalization must target the final DSP signal, reject non-finite controls and samples, preserve sample ratios, and avoid a second full-size PCM allocation.
- Related code: `lib/tools/volume-fades/volumeFades.ts` and `tests/volumeFades.test.ts`.
