# Capability contract: Audio Cutter

This document records the binding guarantees of Audio Cutter as they are enforced by the shipped code, built artifacts, and configuration. Each claim is grounded in a source location or a machine-enforced build check.

Scope: the currently shipped Audio Cutter suite (cut/trim, join/merge, change speed, and WAV/MP3 conversion). Video tools are not covered until they ship.

---

## 1. Local processing, no upload

Audio Cutter makes no outbound network requests. Audio input, intermediate data, and finished output remain on the user's device.

**Primary enforcement:**

- `wxt.config.ts` declares `permissions: []`.
- CI builds both browser targets, confirms that built JavaScript exists, and then greps the built bundle for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, and `EventSource`. If any primitive appears, CI fails. This checks the code that ships, not only the TypeScript source.
- `entrypoints/background.ts` uses `browser.tabs.create` only with `browser.runtime.getURL('/app.html')`. That URL is the extension's own same-origin app page; the background never supplies or navigates to an external URL.

The exact CI audit is:

```sh
grep -R -nE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource' .output --include='*.js'
```

A clean built bundle produces no matches. `.github/workflows/ci.yml` runs this after the Chrome and Firefox builds and fails the job if a match appears.

**Defense in depth:**

The extension manifest, compiled by `wxt.config.ts`, sets this exact Content Security Policy for extension pages:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'
```

`connect-src 'none'` blocks outbound connections from extension pages, `form-action 'none'` blocks form submissions, and `frame-src 'none'` blocks frames. `object-src 'none'` disables object and embed content entirely, while permitted resource types remain restricted to the explicitly listed bundled or in-page sources. CI runs `scripts/check-csp.mjs` against both built manifests and fails if a required directive is missing, weakened, duplicated, or supplemented by an unapproved directive. `scripts/check-manifest-egress.mjs` additionally rejects non-empty required, optional, or host permissions, content scripts, externally connectable configuration, and overly broad web-accessible resources.

The CSP is defense in depth, not the primary privacy proof. In particular, an extension-page CSP does not restrict top-level navigation. CI machine-verifies that none of the five audited network primitives appears in any built JavaScript file; the empty permission list and source review of the sole same-origin `browser.tabs.create` call provide the rest of the no-outbound-request receipt, while the CSP adds a browser-enforced barrier if a bug is introduced.

**Narrowed claim:** These controls describe the shipped extension running in an uncompromised Chrome or Firefox installation. They do not claim to control software outside the extension or a compromised browser or operating system. Audio Cutter includes no telemetry, analytics, crash reporting, upload endpoint, or background sync.

---

## 2. Minimal permissions

The extension requests no browser API permissions beyond those implicitly available to an MV3 extension.

**Enforcement:**

`wxt.config.ts` sets:

```json
"permissions": []
```

Audio Cutter does not request `tabs`, `storage`, `cookies`, `history`, `bookmarks`, `downloads`, `nativeMessaging`, microphone, camera, required host permissions, or optional host permissions. User-selected audio enters through standard file inputs or drag and drop, which require no special permission. Finished audio is saved through a user-initiated download from an in-page blob, so the `downloads` permission is unnecessary. Durable UI preferences use the app page's same-origin Web Storage and do not require the browser `storage` permission.

The CI manifest-egress guard checks both built manifests and fails if required, optional, or host permissions are non-empty. The Firefox manifest also declares:

```json
"data_collection_permissions": { "required": ["none"] }
```

That Firefox field is a machine-readable declaration to AMO and users; it is not technical enforcement. The built-bundle audit and the controls in Section 1 are the enforcement path.

---

## 3. Audio analysis, decode, and encode run off the UI thread

File analysis, WAV parsing, MP3 decode, region decode, and final WAV or MP3 encoding are delegated to a dedicated Web Worker. This keeps file decoding and encoding away from the React UI thread.

**Enforcement:**

`lib/core/worker.ts` spawns a `Worker` backed by `lib/tools/audio-cutter/encode.worker.ts` for analyze, file-decode, file-encode, and PCM-encode jobs. The worker reads the selected `File`, parses and decodes supported WAV or MP3 input, reports fractional progress from 0 to 1, and returns analyzed waveform data, decoded PCM, or a complete encoded result. Bundled `lamejs` performs MP3 encoding inside that worker.

The worker is terminated on success, cancellation, reported error, and unexpected crash (`worker.onerror`). Every job exposes a `cancel()` handle, and the worker has a 30-second stalled-processing watchdog that is reset by progress.

Join normalization/concatenation and change-speed resampling currently run on the app page before their resulting PCM is handed to the worker for final encoding. Those transforms are bounded as described below, but moving them off the UI thread remains deferred work.

---

## 4. No partial download on cancellation or error

A download is offered only after a worker returns a complete result buffer. Cancelling or encountering an error during processing does not create a partial file and does not trigger a download.

**Enforcement:**

In `lib/core/worker.ts`, a result promise resolves only after the worker sends a complete `{ type: 'result' }` message. Cancellation calls `worker.terminate()` and rejects the promise; worker and application errors reject it as well. The cut, join, speed, and conversion views call `downloadBlob` only after awaiting a successfully resolved job. Their rejection paths never call the download helper.

---

## 5. Bounded memory and input validation

Audio Cutter enforces hard input, decoded-data, channel, duration, and in-flight PCM limits. Overflow-safe integer checks guard size arithmetic, and projected transform outputs are checked before oversized output buffers are allocated.

**Enforcement:**

| Limit                                  | Value                       | Enforced in                                                                                                         |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Input file size, per file              | 64 MiB                      | `MAX_INPUT_BYTES` in `lib/core/worker.ts` and `WORKER_MAX_INPUT_BYTES` in `lib/tools/audio-cutter/encode.worker.ts` |
| Decoded PCM                            | 256 MiB                     | `MAX_DECODED_BYTES` in `lib/tools/audio-cutter/encode.worker.ts`                                                    |
| PCM passed to final encode             | 256 MiB                     | `MAX_PCM_ENCODE_BYTES` in `lib/core/worker.ts`                                                                      |
| Retained decoded PCM for join inputs   | 256 MiB aggregate           | `entrypoints/app/JoinMergeTool.tsx`                                                                                 |
| Projected joined or speed-adjusted PCM | 256 MiB                     | `lib/tools/join/join.ts` and `lib/tools/change-speed/changeSpeed.ts`                                                |
| Audio channels                         | 2 (mono or stereo)          | `MAX_PCM_CHANNELS` / `MAX_CHANNELS` and tool validators                                                             |
| Decoded duration                       | 30 minutes                  | `MAX_DURATION_SECONDS` in `lib/tools/audio-cutter/encode.worker.ts`                                                 |
| Stalled worker interval                | 30 seconds without progress | `WATCHDOG_MS` in `lib/tools/audio-cutter/encode.worker.ts`                                                          |

`validateFile` rejects empty inputs and files over 64 MiB before a worker starts; the worker repeats those checks. WAV metadata and MP3 frame preflight validate channel counts, duration, decoded byte projections, safe integer arithmetic, and supported structure before full decode. The join and change-speed paths calculate projected PCM sizes before allocating their output arrays. WAV encoding also rejects output that would overflow the classic RIFF 32-bit size fields.

---

## 6. Durable app-page host

The extension UI runs in a full browser tab, which is a durable host, rather than in a short-lived popup or the MV3 background process. Closing or dismissing a popup therefore cannot interrupt a job because Audio Cutter does not use a popup for processing.

**Enforcement:**

`entrypoints/background.ts` contains only a `browser.action.onClicked` listener that opens `browser.runtime.getURL('/app.html')` in a tab. All React state, worker supervision, progress, cancellation, and downloads live in the extension-owned app page. The background holds no job state, has no file access, makes no network request, and never opens an external URL.

The app stores a versioned preference record in same-origin `localStorage` so it can restore the last selected tool, each tool's WAV/MP3 export choice, and the Change Speed factor after a reload. Restored fields are validated against their supported values and bounds; unavailable, malformed, or unwritable storage falls back to defaults without blocking the app. Selected files, decoded audio, trim points, track lists, progress, status, busy state, and validation state remain in memory only and are never serialized.

---

## Privacy summary

| What                                       | Accessed?      | Notes                                                                                                 |
| ------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------- |
| User-selected WAV or MP3 file              | Yes            | Selected by file input or drag and drop; read and processed locally.                                  |
| Tool preferences                            | Yes            | Last tool and bounded export settings are retained in same-origin `localStorage`; media is not stored. |
| Output destination                         | On user action | The finished blob is handed to the browser's standard download flow only after successful processing. |
| Microphone or camera                       | No             | No media-capture call and no permission request.                                                      |
| Filesystem outside user selection/download | No             | No directory picker or `nativeMessaging`.                                                             |
| Browser cookies, history, or bookmarks     | No             | No corresponding API permission.                                                                      |
| External pages or tabs                     | No             | The only created tab is the extension's own app page returned by `browser.runtime.getURL`.            |
| Network or remote servers                  | No             | Built JavaScript is machine-scanned for network primitives; the strict CSP is defense in depth.       |
| Telemetry, analytics, or crash reporting   | No             | None is included.                                                                                     |

Audio input and results remain on the device. Processing occurs in the extension-owned app page and its workers, and closing the app tab allows the browser to release its in-memory audio state while retaining only the validated UI preferences described above.

---

## How to verify the contract yourself

1. **Read the source manifest configuration.** Open `wxt.config.ts`. Confirm `permissions: []`, `zip.name: 'audio-cutter'`, and the exact CSP shown in Section 1.
2. **Inspect both built manifests.** Run `npm run build` and `npm run build:firefox`; inspect `.output/chrome-mv3/manifest.json` and `.output/firefox-mv3/manifest.json`. Confirm permissions are absent or empty and `content_security_policy.extension_pages` matches the configured policy.
3. **Confirm no network-request code ships.** After both builds, run `grep -R -nE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource' .output --include='*.js'` and confirm it finds nothing. CI performs this built-bundle scan on every change and fails if any match appears.
4. **Read the background script.** Open `entrypoints/background.ts`. Confirm the sole `browser.tabs.create` call receives `browser.runtime.getURL('/app.html')`, not an external URL.
5. **Run the manifest guards.** Run `node scripts/check-csp.mjs .output/chrome-mv3/manifest.json .output/firefox-mv3/manifest.json` and `node scripts/check-manifest-egress.mjs`.
6. **Check release package identity.** Run `npm run zip` and `npm run zip:firefox`. The packages are `.output/audio-cutter-<version>-chrome.zip`, `.output/audio-cutter-<version>-firefox.zip`, and `.output/audio-cutter-<version>-sources.zip`.
7. **Run the test suite.** `npm run check` runs TypeScript compilation, linting, and Vitest. `npm run test:e2e` drives the built production Firefox artifact in real Firefox; `.github/workflows/e2e.yml` builds and lints that artifact first.

---

## Known limitations and deferred items

The following are not claimed as completed capabilities:

- **Main-thread transforms for two tools.** Join normalization/concatenation and change-speed resampling currently run on the app page; only their final encoding runs in the worker. Large inputs within the enforced limits may briefly reduce UI responsiveness during those transforms.
- **Disk-backed processing and output.** Decoded PCM and encoded output are held in memory. There is no streaming disk-backed output or RF64 path; classic WAV output is rejected before its RIFF size fields could overflow.
- **Input and output formats.** The shipped suite accepts supported PCM WAV and MP3 input and exports WAV or MP3. It does not claim arbitrary audio-codec support.
- **Video tools.** No video tool is shipped. This contract does not cover planned video work.
