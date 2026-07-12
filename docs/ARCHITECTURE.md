# Architecture - Media Tools

Status: decision-ready technical design for a cross-browser MV3 WebExtension that transforms local
audio and video files 100% client-side. This is the deep companion to [`../CLAUDE.md`](../CLAUDE.md)
(the short, enforceable guardrails) and to [`./PRODUCT-SPEC.md`](./PRODUCT-SPEC.md). Read the market
context in [`../.docs/ext-2-media-tools.md`](../.docs/ext-2-media-tools.md) first.

## 1. Principles that shape every decision

1. **Nothing leaves the device.** No upload, no network for processing, no remote code. The manifest
   is the proof: no host permissions, a strict CSP, and every dependency bundled. A user can read it.
2. **The extension page is the workhorse, the background is glue.** MV3 backgrounds are ephemeral and
   have no DOM. All UI and all heavy compute live in a durable page opened in a tab.
3. **One codebase, both browsers.** WXT compiles a single MV3 source to Chrome and Firefox. Anything
   that exists on only one browser is a feature-detected enhancement, never a hard dependency.
4. **The right engine for each job, cheapest first.** Web Audio for audio, WebCodecs + mediabunny for
   video, and ffmpeg.wasm only as a lazy Chrome-first fallback for what the browser codecs cannot do.
5. **Heavy work is cancellable and accountable.** It runs in a Web Worker with progress, an explicit
   cancel, prompt buffer release, and a benchmark gate before any heavy tool ships.

## 2. System architecture (MV3 surfaces)

Three surfaces, with a strict division of labor:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BACKGROUND  (Chrome: service worker · Firefox: non-persistent event page)     │
│   Glue only. action.onClicked → open the app page. Context menus, badge.      │
│   No DOM, no long tasks, no WASM. Killed after ~30s idle on Chrome.            │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ opens
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ APP PAGE  (entrypoints/app/, opened in a TAB - the durable host)              │
│   React UI: dropzone, tool picker, waveform / video editor, progress, cancel. │
│   Holds tool state. Spawns and supervises the Web Worker. Triggers downloads. │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ postMessage(input, [transferables])   ◄── {progress|result|error}
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ WEB WORKER  (spawned by the app page - the compute engine)                     │
│   Tier A: Web Audio decode/slice/resample + lamejs MP3 / native WAV.          │
│   Tier B: WebCodecs + mediabunny demux/mux/trim/convert/compress.             │
│   Tier C: ffmpeg.wasm (lazy, Chrome-first) for GIF / exotic containers.       │
│   Reports progress, honors cancel (terminate), releases buffers on exit.      │
└─────────────────────────────────────────────────────────────────────────────┘

Optional Chrome-only enhancements (feature-detected, never required):
  • chrome.sidePanel for the light audio tools (Firefox has incompatible sidebar_action).
  • File System Access API (showSaveFilePicker) for save-to-folder; else download.
  • Cross-origin isolation (COEP/COOP manifest keys) to unlock multi-thread ffmpeg.wasm.
```

Why a tab and not a popup or the side panel: video editing needs real screen space (timeline,
preview, output settings), a popup is too small, and `chrome.sidePanel` does not exist on Firefox.
A full page is the only surface that is identical on both browsers and roomy enough. This matches the
patterns from the incumbent teardown (heic2jpg, zipmanager): the background orchestrates, the heavy
work runs in a page/worker, the UI is self-rendered, nothing redirects to a website.

### 2.1 Current state vs target (honest)

The seed tool ships today, and the worker split is partial on purpose. State it plainly so the plan
is not read as more built than it is:

- **Today:** `entrypoints/app/App.tsx` decodes audio with Web Audio **on the main thread**
  (`load()`), then hands the decoded channels to a worker for the **encode** step only
  (`lib/core/worker.ts` → `lib/tools/audio-cutter/encode.worker.ts`). Decode blocks the UI briefly on
  large files.
- **Target:** move decode and every heavy transform into the worker as the tool set grows, so the main
  thread only renders and supervises. This is a known, planned refactor, tracked with the Phase 2 work
  where video decode makes a main-thread decode untenable. The message contract in §4 is designed for
  it (the worker can own the `File`/`ArrayBuffer` from the start).

## 3. Tech choices and rationale

| Layer | Choice | Why (not the alternative) |
| --- | --- | --- |
| Build / packaging | **WXT** 0.20.x | One MV3 source → Chrome + Firefox, HMR, `zip`/`submit` built in. Alternatives (raw webpack + manual manifests) reinvent the cross-browser transform. |
| UI | **React 19 + TypeScript (strict) + Tailwind v4** | Already shipped; component model fits the editor UI; strict TS catches capability-detection gaps. |
| Audio engine | **Web Audio (`OfflineAudioContext`) + `lamejs`** | Sample-accurate decode/slice/resample in the browser; WAV is native PCM; MP3 encode is not in WebCodecs, so bundled `lamejs` (LGPL) is required. Sub-MB. |
| Video engine (primary) | **WebCodecs + `mediabunny`** | Hardware-accelerated encode/decode plus containers, **no SharedArrayBuffer**, so full speed on Firefox. Tens of KB tree-shaken. This is the "why now": WebCodecs went stable in Firefox 130 (Sept 2024). |
| Video engine (fallback) | **`ffmpeg.wasm`, lazy, Chrome-first** | Only for what WebCodecs cannot do (GIF encode, exotic/legacy containers, HEVC). ~30 MB, so never in the base bundle; multi-thread needs cross-origin isolation that Firefox extension pages cannot get. |
| Cross-browser API | **WXT-provided `browser.*`** | One API surface; feature-detect the Chrome-only extras. |
| Output | **Blob + `URL.createObjectURL` + `<a download>`** | Universal on both browsers. File System Access is a Chrome-only nicety. |

### 3.1 The engine decision in one line

**WebCodecs + mediabunny is the cross-browser video engine, not ffmpeg.wasm.** ffmpeg.wasm can only
multi-thread on Chrome (it needs `SharedArrayBuffer`, hence cross-origin isolation, which
`moz-extension://` pages cannot obtain, [Bug 1673477](https://bugzilla.mozilla.org/show_bug.cgi?id=1673477)).
Leaning on ffmpeg as the primary path would make Firefox a slow second-class citizen and bloat the
base install. WebCodecs gives the browser's own hardware encoders on both desktops with no SAB, so
the common path (trim, mute, extract, compress, container convert) is fast and small everywhere. We
pay the ffmpeg tax only on the long tail, only on Chrome, only when a user invokes it.

## 4. Data flow and message contracts

The app page owns the file and the worker owns the compute. Messages are a discriminated union so
each tool extends the same channel.

```ts
// Page → Worker: one job per worker instance. Transfer the heavy buffers.
type WorkerRequest =
  | { kind: 'audio-cut';   input: AudioJob }      // channels/sampleRate/start/end/format
  | { kind: 'audio-join';  input: JoinJob }        // ordered decoded buffers → one output
  | { kind: 'audio-speed'; input: SpeedJob }       // resample factor (coupled speed+pitch)
  | { kind: 'video-trim';  input: VideoTrimJob }   // File + in/out + mode: 'keyframe'|'exact'
  | { kind: 'video-mute';  input: VideoMuteJob }   // File → remux dropping the audio track
  | { kind: 'video-extract-audio'; input: ExtractJob }
  | { kind: 'video-compress';      input: CompressJob }; // target bitrate/resolution

// Worker → Page: progress is 0..1; result carries a transferable ArrayBuffer.
type WorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'result';   buffer: ArrayBuffer; mime: string }
  | { type: 'error';    message: string };
```

Rules the harness (`lib/core/worker.ts`) already enforces and every tool inherits:

- **Transfer, do not copy.** Channel buffers and file `ArrayBuffer`s are passed as transferables so a
  large input is not duplicated across the boundary.
- **Cancel = terminate.** The page holds a `cancel()` that terminates the worker and rejects the job
  promise. A cancelled job leaves no partial download (the download only fires on a resolved `result`).
- **One worker per job, torn down on settle.** No pooling in Phase 1; a fresh worker per export keeps
  state clean and cleanup trivial. Revisit only if spawn cost shows up in benchmarks.
- **Errors are messages, not crashes.** The worker catches, posts `{type:'error'}`, and the page turns
  it into a human status line. `worker.onerror` is the backstop.

Output flow: `result.buffer` → `new Blob([buffer], {type: mime})` → `downloadBlob(blob, outputName(...))`
(`lib/core/download.ts`, `lib/core/format.ts`). On Chrome, an optional `showSaveFilePicker` path can
replace the anchor download; Firefox always uses the anchor.

## 5. Module boundaries

```
entrypoints/
  background.ts                 glue: open app page on action click
  app/                          the durable host page (React)
    App.tsx                     shell: tool routing, file state, worker supervision, status
    (per-tool views land here as the picker grows)
components/                     presentational, token-only: Button, Progress (+ future Select, Card, Badge, Toggle)
lib/
  core/                         cross-tool infrastructure (the shared "core")
    worker.ts                   worker harness: spawn, progress, cancel, transferables
    download.ts                 Blob → download (+ optional FS Access on Chrome)
    dropzone.tsx                accessible file input + drag-drop
    format.ts                   bytes / duration / output-name helpers
    capability.ts   (planned)   WebCodecs/codec probes (isConfigSupported), FS Access + sidePanel detection
  tools/<name>/                 one folder per tool; self-contained
    audio-cutter/
      Waveform.tsx              canvas waveform + draggable handles
      encode.worker.ts          the actual DSP/encode (runs in the worker)
    (audio-join/, audio-speed/, video-trim/, video-mute/, video-extract-audio/, video-compress/ …)
```

Boundaries, stated as rules:

- **`components/` is presentational and token-only.** No business logic, no `browser.*`. Reusable.
- **`lib/core/` is tool-agnostic infrastructure.** The worker harness, download, dropzone, formatting,
  and capability detection. This is the shared core the monorepo overview calls `packages/core`.
- **`lib/tools/<name>/` is one tool, self-contained,** with its worker entry, its DSP, its view, and
  its Vitest test. A new tool is added here and surfaced in `App.tsx`; it does not reach into another
  tool. Adding a tool touches exactly one new folder plus the picker.
- **Heavy code is lazy.** `mediabunny`, `gifenc`, `SoundTouchJS`, and `ffmpeg.wasm` are dynamic
  `import()`ed inside the tool worker that needs them, never in the base chunk.

## 6. Cross-browser strategy

| Concern | Chrome | Firefox | Our handling |
| --- | --- | --- | --- |
| Background | service worker | non-persistent event page (has DOM) | Glue only; feature-detect `ServiceWorkerGlobalScope`-specific calls. |
| Heavy compute | Web Worker | Web Worker | Identical. The shared execution model, no SAB needed for the primary engine. |
| Side panel | `chrome.sidePanel` | none (`sidebar_action` differs) | Optional, feature-detected. Tab page is the shared surface. |
| Save to folder | File System Access | none | Optional; degrade to anchor download. |
| Cross-origin isolation | COEP/COOP manifest keys | not supported ([Bug 1673477]) | Only affects multi-thread ffmpeg. Chrome ships `@ffmpeg/core-mt`; Firefox does not ship ffmpeg at all and uses WebCodecs. |
| Codec availability | broad | varies (esp. Linux) | Capability-detect every encoder; gray out what is unavailable. |

**"Lazy ffmpeg" means lazy execution and browser-specific packaging.** The Chrome build includes
`@ffmpeg/core-mt` behind a dynamic import and sets the COEP/COOP manifest keys so `crossOriginIsolated`
is true and `SharedArrayBuffer` works. The Firefox build does not include ffmpeg at all; Phase 3 tools
that would need it either use WebCodecs (GIF via `gifenc` decode path) or are disabled with an honest
message on Firefox. WXT's per-browser manifest transform makes this a build-time branch, not a runtime
hack. The ~30 MB core is fetched and instantiated on first use, so the base install stays light on both.

## 7. Performance and memory budget

- **Bundle size.** Phase 1 audio core < 1 MB. Phase 2 (mediabunny + WebCodecs) stays in the hundreds
  of KB because WebCodecs is the browser's own code. Phase 3 lazy-loads the ~30 MB ffmpeg core on
  demand only; it is never counted against the base install.
- **Memory.** WASM is 32-bit, so the address space ceiling is ~2-4 GB and a multi-GB video can OOM
  ffmpeg. Mitigations: prefer streaming (mediabunny `BlobSource`), process in chunks, cap and warn on
  very large inputs, release buffers as soon as a stage completes, and keep cancellation responsive.
- **Responsiveness.** Heavy work never runs on the UI thread (target state; see §2.1). Progress is
  reported at a bounded cadence so the UI stays smooth. Decode moves into the worker in Phase 2.
- **Benchmark gates (ship-blocking for any heavy tool).** Record installed package size, max tested
  input (for example 1080p / 10-min ≈ 1-2 GB), peak memory, wall-clock (target: compress ≥ ~0.5-1×
  realtime on the Chrome hardware path, and record the Firefox number), that cancellation mid-run
  works, and that the output plays in VLC, QuickTime, and both browsers. Ship a heavy tool only when
  green on **Chrome and Firefox**.

## 8. Security and privacy model

- **No host permissions.** Files come from `<input type=file>` and drag-drop, which need none. This is
  the trust-building manifest and it is user-verifiable.
- **Least privilege, lazily.** `downloads` and any host access are requested only if a feature needs
  them, via `optional_permissions`.
- **No remote code (MV3 requirement, and our own rule).** Every dependency and WASM asset is bundled.
  `FFmpeg.load()` points at packaged files, never a CDN. The self-hosted model/codec assets are cached
  in IndexedDB after first load for offline reuse.
- **CSP.** `content_security_policy.extension_pages` is now default-deny in `wxt.config.ts`:
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:
  blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'none'; form-action 'none';
  frame-src 'none'; object-src 'self'; base-uri 'none'`. `wasm-unsafe-eval` is not currently
  allowed because no bundled WASM ships today; if that changes later, add it back only with the
  narrowest policy that still preserves the no-upload contract.
- **AMO data-collection disclosure.** `browser_specific_settings.gecko.id = media-tools@local` and
  `data_collection_permissions: { required: ['none'] }` are set (AMO has required this since
  2025-11-03). The honest answer is "none", because there is no telemetry.
- **Input-safety by tool.** Media decoders are the browser's own hardened codecs, so the classic
  archive risks (zip-bomb, path traversal) do not apply here; the relevant defense is memory (large
  input caps and streaming) and never trusting a codec to be present (capability-detect).
- **Pro entitlement without breaking offline.** The Pro unlock is an externally purchased,
  Ed25519-signed license token validated **locally** with a bundled public key, then cached. No server
  call after activation, so the offline promise holds. Trade-offs (sharing, revocation) are documented
  in [`./PRODUCT-SPEC.md`](./PRODUCT-SPEC.md); the architecture note is only that the public key is
  bundled and verification is offline.

## 9. Testing strategy

- **Unit (Vitest, per tool).** The pure DSP is the high-value target: slice/concat/resample math, WAV
  PCM encoding, MP3 frame sanity, join ordering, speed-factor resampling, and every capability probe.
  Each `lib/tools/<name>/` ships its own test. `tests/audio.test.ts` is the seed.
- **Capability detection.** Test that unsupported encoders are detected and the UI disables rather than
  attempts them, so a user never waits through a long job that cannot finish.
- **Cross-browser manual drive (release-blocking).** Load the built extension and drive each tool with
  a real file on **Chrome and Firefox**: decode, edit, export, cancel, and confirm the download plays.
  `npm run check` (compile + lint + test) must pass first.
- **Benchmark gates (heavy tools).** The §7 gate table is executed and its numbers recorded before a
  heavy tool is released. A tool that is not green on both browsers does not ship; the audio phase
  ships regardless, since it has no heavy-tool risk.
- **CI.** `.github/workflows/ci.yml` runs `compile → lint → test → build → build:firefox` on every
  push and PR and uploads the `.output/` artifacts, so a broken build or type error is caught before
  merge. Publishing is a separate tag-triggered workflow (see [`./PUBLISHING.md`](./PUBLISHING.md)).

## 10. Library table

Shipped-now vs planned-per-phase. Ship only MIT / MPL / LGPL; never the GPL ffmpeg cores.

| Package | Version | SPDX | Why | Risk / mitigation |
| --- | --- | --- | --- | --- |
| `react` / `react-dom` | 19.2.4 | MIT | App UI + renderer | none |
| `lamejs` | 1.2.1 (shipped) | LGPL-3.0-or-later | MP3 encode in a worker (MP3 not in WebCodecs) | Unmaintained; pin + vendored at `public/vendor/lame.min.js`. LGPL dynamic use is fine. |
| `mediabunny` | latest (Phase 2) | MPL-2.0 | WebCodecs muxer/demuxer + trim/convert/compress; zero-dep; no SAB → full speed on Firefox | Newer library; track releases; capability-detect encoders. |
| `gifenc` | latest (Phase 3) | MIT | GIF encode (not in WebCodecs) | Small, low risk. |
| `SoundTouchJS` | latest (Phase 3) | LGPL-2.1 | Independent pitch / time-stretch (phase vocoder) | LGPL fine. |
| `@ffmpeg/ffmpeg` + `@ffmpeg/core` (FF) / `@ffmpeg/core-mt` (Chrome) | latest (Phase 3, Chrome-first) | LGPL core only (avoid GPL x264/x265; offload H.264/H.265 encode to WebCodecs) | ~30 MB, lazy, Chrome multi-thread only. Keep out of base bundle; disable or WebCodecs-substitute on Firefox. |

`webextension-polyfill` semantics are provided by WXT's `browser` (MPL-2.0). MP3 patents expired 2017.
Keep this table and licenses in sync with [`../THIRD-PARTY.md`](../THIRD-PARTY.md) as dependencies land.

## 11. Open architectural questions (tracked, not blocking)

- **Worker pooling** for batch (Phase 2 Pro): spawn-per-job is fine for single exports; batch may want
  a small pool. Decide from benchmark data, not up front.
- **Frame-accurate trim cost** on Firefox: re-encoding a GOP is browser/OS codec dependent; the keyframe
  mode is the guaranteed-fast default and the exact mode is labeled as slower. Confirm on the §7 gate.
- **Compress on Firefox** hardware-encoder availability varies (esp. Linux); the compressor is gated on
  the §7 benchmark and may ship Chrome-first if Firefox cannot meet the target on common hardware.
