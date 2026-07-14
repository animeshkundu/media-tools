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

## [0.1.0] - 2026-07-14

Initial developer-preview release. Private, offline audio editing that runs entirely in the browser.

### Added

- Cut and trim WAV or MP3 audio with waveform-guided in and out points.
- Join or merge tracks in a chosen order, normalizing channel layouts and differing sample rates when needed.
- Change playback speed from 0.25× to 4×, with speed and pitch changing together.
- Convert audio to lossless PCM WAV or 192 kbps MP3.
- Bounded-memory processing with a 64 MB input limit and 256 MB decoded and in-flight PCM limits.
- Real-Firefox end-to-end tests in CI and one MV3 codebase for Chrome and Firefox.

### Security

- Audio input, processing, and output remain local, with no uploads, accounts, or telemetry.
- Zero install-time permissions and a strict no-egress extension-page Content Security Policy.
- Machine-verified no-network builds: CI scans both browser bundles for network primitives and fails if any are present.

[Unreleased]: https://github.com/animeshkundu/media-tools/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/animeshkundu/media-tools/releases/tag/v0.1.0
