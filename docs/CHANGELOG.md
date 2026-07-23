# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) when versioned releases are published.

## [Unreleased]

### Added

- A hosted web app at `/media-tools/app/` that mounts the same React editor and worker pipelines as the extension.
- Local source-audio preview in the cutter and production screenshot evidence using a near-limit WAV file.
- An offline Volume & Fades tool with 0% to 500% gain, linear or logarithmic fade envelopes, -1 dBFS peak normalization, clipping warnings, and worker-owned WAV/MP3 export.
- Unified Audio Studio with immutable serializable edits, a virtualized Canvas timeline, magnetic snapping, Web Audio preview/skimming, generated local sounds, EQ presets, and worker-rendered stereo WAV/MP3.
- Deterministic dialogue-driven music ducking and a bounded OPFS worker cache with 8 MiB random-access slices.
- Feature-detected, explicit, bounded local voice-over recording with no install-time microphone permission.

### Changed

- Replaced the separate transform tabs and repeated imports with one iMovie-style three-pane workspace for arrangement, trim, split/delete, speed, gain, fades, EQ, preview, and export.
- Redesigned the shared extension and hosted editor around a fixed desktop workspace with media library, viewer/inspector, persistent transport feedback, and a full-width timeline.
- Split privacy messaging precisely: both surfaces process locally with no upload, while zero permissions and no-egress CSP remain extension-only enforcement claims.
- GitHub Pages now validates and deploys the committed Vite web target with the static site.
### Deprecated

### Removed

### Fixed

### Security

## [0.1.3] - 2026-07-14

Parity polish patch: supply-chain, accessibility, SEO, and documentation. No shipped extension code change.

### Added

- SoftwareApplication JSON-LD, demo-video WebVTT captions, and a visible transcript on the project site.

### Changed

- Pinned every GitHub Actions workflow action to a verified commit SHA (ci, e2e, release, and the Copilot setup helper); pages.yml was already pinned.
- Reframed the unshipped video, mediabunny, and ffmpeg.wasm paths in the architecture docs from present tense to planned Phase 2 and Phase 3.

### Fixed

- Raised the site feature-number text contrast to meet WCAG 1.4.3 (at least 4.5 to 1).
- Removed em dashes across the documentation and README.

## [0.1.2] - 2026-07-14

Documentation honesty patch. No functional or bundle change; the Chrome and Firefox extension code is identical to 0.1.1.

### Fixed

- Corrected `docs/LEARNINGS.md`: removed a claim that the Firefox E2E checks export cancellation (it does not), and repointed stale references from the retired HTTP-served spec and root Playwright config to the installed-extension suite and its workflow.
- Softened the macOS row of the browser support matrix from "release-tested" and "proved" to "locally exercised, not CI-gated", keeping CI Ubuntu as the release authority.
- Aligned the site install prose with the developer-preview download button.

### Changed

- Bumped the Firefox E2E workflow action pins to match the CI workflow.

## [0.1.1] - 2026-07-14

Developer-preview hardening and accuracy release. No user-facing feature changes.

### Added

- Project site `robots.txt` and `sitemap.xml`.

### Changed

- Tightened the extension-page Content Security Policy `object-src` directive to `'none'`.
- Pinned every build dependency to an exact version.
- Upgraded the Firefox end-to-end suite to install and drive the real `moz-extension://` extension page under the enforced extension-page CSP, covering WAV cut and export, WAV to MP3, MP3 input, join, change speed, and a no-egress check.
- Corrected the documentation to match the shipped engine: worker-side WebCodecs `AudioDecoder` for MP3 decode, direct PCM parsing for WAV, and `lamejs` for MP3 encode only.

### Fixed

- Repointed the developer-preview install link from a "latest release" URL, which excludes prereleases, to the releases page.

## [0.1.0] - 2026-07-14

Initial developer-preview release. Private, offline audio editing that runs entirely in the browser.

### Added

- Cut and trim WAV or MP3 audio with waveform-guided in and out points.
- Join or merge tracks in a chosen order, normalizing channel layouts and differing sample rates when needed.
- Change playback speed from 0.25× to 4×, with speed and pitch changing together.
- Convert audio to lossless PCM WAV or 192 kbps MP3.
- Bounded-memory processing with a 64 MiB input limit and 256 MiB decoded and in-flight PCM limits.
- Real-Firefox end-to-end tests in CI and one MV3 codebase for Chrome and Firefox.

### Security

- Audio input, processing, and output remain local, with no uploads, accounts, or telemetry.
- Zero install-time permissions and a strict no-egress extension-page Content Security Policy.
- No-network build check: CI greps both built browser bundles for common network primitives (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, and `EventSource`) as one defense-in-depth layer.

[Unreleased]: https://github.com/animeshkundu/media-tools/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/animeshkundu/media-tools/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/animeshkundu/media-tools/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/animeshkundu/media-tools/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/animeshkundu/media-tools/releases/tag/v0.1.0
