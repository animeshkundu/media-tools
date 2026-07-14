# Audio Cutter

Private, offline audio cutting for Firefox and Chrome, entirely in your browser.

![Audio Cutter showing a loaded waveform and trim controls](docs/media/screenshots/audio-cutter-waveform.png)

[![CI](https://img.shields.io/github/actions/workflow/status/animeshkundu/media-tools/ci.yml?branch=main&label=CI)](https://github.com/animeshkundu/media-tools/actions/workflows/ci.yml) [![Firefox E2E](https://img.shields.io/github/actions/workflow/status/animeshkundu/media-tools/ci.yml?branch=main&label=Firefox%20E2E)](https://github.com/animeshkundu/media-tools/actions/workflows/ci.yml) [![MIT License](https://img.shields.io/github/license/animeshkundu/media-tools?label=License)](LICENSE) [![Release](https://img.shields.io/github/v/release/animeshkundu/media-tools?include_prereleases&label=Release&color=047857)](https://github.com/animeshkundu/media-tools/releases)

[Security policy](./SECURITY.md) · [Changelog](./docs/CHANGELOG.md) · [Contributing](./CONTRIBUTING.md)

## The privacy promise

> **Your audio never leaves your device; no uploads, no accounts, no telemetry; all processing local.**

This rests first on what you can audit: Audio Cutter declares zero permissions, and its built bundle contains no network code—a CI check greps both browser builds for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, and `EventSource` and fails the build if any appear. The strict no-egress content-security policy (`connect-src 'none'`) is defense in depth, blocking outbound connections from extension pages even if a bug were introduced; because a content-security policy does not restrict top-level navigation, it is not the sole line of defense. Source review verifies that the only `browser.tabs.create` call opens the extension's own app page through `browser.runtime.getURL` (same-origin) and never navigates to an external URL. The empty permission list and the CSP are also checked in CI against both built manifests. See [docs/PEER-REVIEW.md](docs/PEER-REVIEW.md) and [docs/CAPABILITY-CONTRACT.md](docs/CAPABILITY-CONTRACT.md).

## Permissions and CSP

Audio Cutter ships with an empty permission list and a strict no-egress content-security policy. Both are checked in CI against the built Chrome and Firefox manifests on every change.

Declared permissions:

```json
"permissions": []
```

Extension-page content-security policy:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'self'; base-uri 'none'
```

`connect-src 'none'` blocks outbound network connections from extension pages, `form-action 'none'` blocks form submissions, and `frame-src 'none'` blocks frames. Scripts, workers, media, images, styles, and objects are limited to the explicitly listed bundled or in-page sources. Saving audio uses a standard browser download from an in-page blob, so no `downloads` permission is requested. An empty permission list and a CSP are not a privacy proof by themselves, so the capability contract is verified through source review, the CI built-bundle scan for network primitives, both built manifests, and production-artifact tests. See [docs/PEER-REVIEW.md](docs/PEER-REVIEW.md) and [docs/CAPABILITY-CONTRACT.md](docs/CAPABILITY-CONTRACT.md).

## Features

- **Cut and trim audio** by loading a WAV or MP3, viewing its waveform, and setting precise in and out points before export.
- **Join or merge tracks** in a chosen order, normalizing mono/stereo channel layout and differing sample rates when needed.
- **Change playback speed** from 0.25× to 4×; speed and pitch change together, and the estimated output duration is shown before export.
- **Convert WAV and MP3** locally, with lossless PCM WAV or 192 kbps MP3 output.
- **No uploads, accounts, ads, telemetry, or watermarks.** Audio input, processing, and output stay in the browser.
- **Bounded processing** with a 64 MB input limit, 256 MB decoded/in-flight PCM limits, mono/stereo validation, and a processing watchdog.
- **Cancellable worker jobs** with progress reporting and no partial download after cancellation or failure.
- **Accessible controls** for file selection, trim times, status updates, and progress.
- **Real-Firefox end-to-end coverage** in CI, not browser emulation.
- **One MV3 codebase** for Chrome and Firefox.
- **Zero install-time permissions.**

## Screenshots

### Start with local audio

Drop a WAV or MP3 file, or choose one from your device.

![Audio Cutter empty state with its local audio dropzone](docs/media/screenshots/audio-cutter-empty.png)

### Read the waveform

Inspect the loaded audio as a waveform—a visual plot of sound amplitude over time.

![Audio Cutter showing a loaded waveform](docs/media/screenshots/audio-cutter-waveform.png)

### Select the trim

Drag the gold handles or enter exact in and out times to choose the audio to keep.

![Audio Cutter showing a selected trim range](docs/media/screenshots/audio-cutter-trim-selected.png)

### Export locally

Create the finished download in the browser without uploading the source audio.

![Audio Cutter confirming a completed local export](docs/media/screenshots/audio-cutter-export-done.png)

### Friendly failures

Corrupt or unsupported audio fails with a clear message instead of a misleading download.

![Audio Cutter showing a corrupt-audio error](docs/media/screenshots/audio-cutter-error.png)

[Watch the short real-Firefox demo (MP4)](docs/media/audio-cutter-demo.mp4) · [WebM alternate](docs/media/audio-cutter-demo.webm)

## Install

Audio Cutter is a developer preview. Store listings are coming soon:

- **Firefox (AMO):** coming soon
- **Chrome (Chrome Web Store):** coming soon

Until then, use a package from [GitHub Releases](https://github.com/animeshkundu/media-tools/releases) when one is available. Release archives follow the exact pattern `audio-cutter-<version>-{chrome,firefox,sources}.zip`:

- **Chrome:** unzip `audio-cutter-<version>-chrome.zip`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `audio-cutter-<version>-firefox.zip`. A temporary add-on is cleared when Firefox restarts; a signed AMO build for persistent installation is coming soon.
- **Sources:** `audio-cutter-<version>-sources.zip` contains the corresponding source package for review and independent builds.

## Verify your download

Download `audio-cutter-<version>-chrome.zip`, `audio-cutter-<version>-firefox.zip`, `audio-cutter-<version>-sources.zip`, and `SHA256SUMS` from the [Releases page](https://github.com/animeshkundu/media-tools/releases), then verify their checksums:

```sh
sha256sum -c SHA256SUMS
```

On macOS:

```sh
shasum -a 256 -c SHA256SUMS
```

Each asset also has a keyless GitHub OIDC signature bundle. Verify the checksum file before trusting it:

```sh
cosign verify-blob --new-bundle-format --bundle SHA256SUMS.sigstore.json --certificate-identity-regexp '^https://github\.com/animeshkundu/media-tools/\.github/workflows/release\.yml@refs/tags/v[^/]+$' --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
```

To verify the ZIP bundles directly, replace `<version>` with the release version:

```sh
version='<version>'
for target in chrome firefox sources; do
  archive="audio-cutter-${version}-${target}.zip"
  cosign verify-blob --new-bundle-format --bundle "${archive}.sigstore.json" --certificate-identity-regexp '^https://github\.com/animeshkundu/media-tools/\.github/workflows/release\.yml@refs/tags/v[^/]+$' --certificate-oidc-issuer https://token.actions.githubusercontent.com "${archive}"
done
```

For an independent build comparison, check out the release tag, run `npm ci`, then `npm run zip` and `npm run zip:firefox`. Compare the generated ZIP SHA-256 values with `SHA256SUMS`, or compare the build inputs with `audio-cutter-<version>-sources.zip`. Byte-for-byte equality can depend on the local toolchain and packaging metadata.

## How it works

A durable extension app page owns the interface and operation lifetime. Page-owned Web Workers analyze and decode WAV/MP3 input and perform final WAV/MP3 encoding, while the app supervises progress, cancellation, and local blob downloads. Audio is processed as PCM (pulse-code modulation: raw, uncompressed sample values) at a sample rate (the number of samples recorded each second); the waveform is the visual summary used to choose a cut. All runtime code and encoder assets are bundled with the extension and guarded by the strict no-egress CSP. Read the [vision](docs/VISION.md), [product specification](docs/PRODUCT-SPEC.md), [architecture](docs/ARCHITECTURE.md), and [design guide](docs/DESIGN.md).

## Development

Install dependencies with `npm install`, then use the scripts below:

| Task             | Chrome          | Firefox                 |
| ---------------- | --------------- | ----------------------- |
| Development      | `npm run dev`   | `npm run dev:firefox`   |
| Production build | `npm run build` | `npm run build:firefox` |

Quality and test commands:

```sh
npm run check
npm run test
npm run test:e2e
```

To load an unpacked production build:

1. Build the target browser.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output/chrome-mv3`.
3. In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `.output/firefox-mv3/manifest.json`.

## License

Licensed under the [MIT License](LICENSE).
