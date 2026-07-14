# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) when versioned releases are published.

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

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

[Unreleased]: https://github.com/animeshkundu/media-tools/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/animeshkundu/media-tools/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/animeshkundu/media-tools/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/animeshkundu/media-tools/releases/tag/v0.1.0
