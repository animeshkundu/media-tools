# Capability contract — Audio Cutter

This document records the binding guarantees of the Audio Cutter tool as they are actually enforced by shipped code and configuration. Each claim is grounded in a specific source location. Do not assert a guarantee here that is not enforced in code.

Scope: Audio Cutter, Phase 1. Other tools are not covered until they ship.

---

## 1. Local processing, no upload

Audio data never leaves the device. There is no server, no upload endpoint, and no background sync of any kind.

**Enforcement:**

The extension manifest, compiled by `wxt.config.ts`, sets the following Content Security Policy for all extension pages:

```
default-src 'none'
connect-src 'none'
form-action 'none'
frame-src 'none'
```

`connect-src 'none'` blocks every outbound network connection from extension pages, including `fetch`, `XMLHttpRequest`, WebSocket, and `EventSource`. `form-action 'none'` blocks form submission to any origin. These directives are enforced by the browser's CSP engine, not by application logic, and cannot be bypassed by JavaScript running inside the extension.

**Narrowed claim:** The CSP prevents outbound connections from extension pages on browsers that enforce MV3 CSP (Chrome, Firefox). It does not cover connections initiated from outside the extension (for example, by a malicious native application). CSP enforcement depends on browser integrity; a compromised browser can bypass these restrictions. No telemetry, analytics, or crash reporting is included in the extension.

---

## 2. Minimal permissions

The extension requests no browser API permissions beyond those implicitly granted to any MV3 extension.

**Enforcement:**

`wxt.config.ts` sets `permissions: []`. The extension does not request `tabs`, `storage`, `cookies`, `history`, `bookmarks`, `downloads`, `nativeMessaging`, `microphone`, `camera`, or any host permissions. Audio input is provided by the user through a standard `<input type="file">` element, which requires no special permission.

---

## 3. Heavy encode work runs off the UI thread

Encode is delegated to a dedicated Web Worker. Decode currently runs on the main thread using `AudioContext` before PCM is transferred to the worker — this is known debt and the UI may become less responsive during decode of large files. The encode step (including MP3 encoding via lamejs) runs entirely in the worker.

**Enforcement:**

`lib/core/worker.ts` spawns a new `Worker` backed by `lib/tools/audio-cutter/encode.worker.ts` for every analyze or encode job. Worker messages carry a fractional `progress` value (0–1). The worker is terminated via `worker.terminate()` on success, cancellation, error, and unexpected crash (`worker.onerror`). A `cancel()` handle is returned to the caller alongside the result `Promise` so that in-flight workers can be stopped at any time.

---

## 4. No partial download on cancel or error

A download is only offered to the user after the encode worker returns a complete result buffer. Cancelling or encountering an error during encoding does not produce a partial file and does not trigger a download.

**Enforcement:**

In `lib/core/worker.ts`, the result `Promise` resolves only when the worker sends a `{ type: 'result' }` message. On `cancel()`, `worker.terminate()` is called and the promise is rejected with `'Export cancelled.'`. On error, the promise is similarly rejected. The app in `entrypoints/app/App.tsx` triggers the download (`<a href=…>` with a Blob URL) only inside the `.then()` handler of a resolved promise. The rejection path never reaches the download step.

---

## 5. Bounded memory

Hard limits on input file size and decoded PCM data are enforced before allocation so that a maliciously large or malformed file cannot exhaust browser memory.

**Enforcement:**

| Limit | Value | Enforced in |
| --- | --- | --- |
| Input file size | 64 MB | `MAX_INPUT_BYTES = 64 * 1024 * 1024` — `lib/core/worker.ts:3` |
| Decoded / in-flight PCM (encode.worker.ts) | 256 MB | `MAX_DECODED_BYTES = 256 * 1024 * 1024` — `lib/tools/audio-cutter/encode.worker.ts:58` |
| PCM passed to startEncode | 256 MB | `MAX_PCM_ENCODE_BYTES = 256 * 1024 * 1024` — `lib/core/worker.ts:5` |
| Audio channels | 2 (mono/stereo) | `MAX_PCM_CHANNELS = 2` — `lib/core/worker.ts:4` |

`validateFile` in `lib/core/worker.ts` rejects any file over 64 MB before the worker is started. `encode.worker.ts` re-checks decoded byte counts against `MAX_DECODED_BYTES` at multiple points (pre-decode cap, per-frame accumulation, and post-decode) before feeding data to the encoder. Overflow-safe integer checks (`Number.isSafeInteger`) guard the accumulation arithmetic.

---

## 6. Durable app-page host

The extension UI runs in a full browser tab (a durable host), not inside a short-lived popup or the MV3 background service worker. Long jobs survive toolbar clicks and popup dismissals.

**Enforcement:**

`entrypoints/background.ts` contains only a `browser.action.onClicked` listener that opens a new tab pointed at `/app.html`. All React state, worker supervision, progress, cancellation, and downloads live in `entrypoints/app/App.tsx`, which is the full-page app. The background script holds no job state and performs no media processing.

---

## Privacy summary

| What | Accessed? | Notes |
| --- | --- | --- |
| User-selected audio file | Yes | Via `<input type="file">`. File stays in browser-managed memory; the extension makes no explicit disk writes. |
| Microphone | No | No `getUserMedia` call; not requested in `permissions`. |
| Filesystem outside user selection | No | No `showDirectoryPicker` or equivalent; no `nativeMessaging`. |
| Browser cookies / storage | No | Not requested in `permissions`; CSP blocks remote frames that could read them. |
| Network / remote servers | No | `connect-src 'none'` in CSP. |
| Telemetry or analytics | No | None included. |

Nothing leaves the device. Local processing happens entirely inside the extension page and its worker. When the tab is closed, all in-memory audio data is released by the browser.

---

## Known limitations and deferred items

The following items are not yet enforced and are therefore not claimed above:

- **Aggregate batch memory limit.** No cross-job or cross-session PCM accumulation cap exists today.
- **Disk-backed output.** Large output blobs are held in memory as `ArrayBuffer` until the download link is clicked. An RF64 / disk-backed path for files approaching the 4 GiB RIFF limit is not yet implemented.
- **CSP CI assertion.** There is no automated test that fails if a future `wxt.config.ts` change re-introduces an egress-capable `connect-src` directive. This is a required release gate before Phase 2 ships (per the architecture guardrails).
- **Video tools.** No video tool is shipped in Phase 1. This contract does not cover Phase 2.
