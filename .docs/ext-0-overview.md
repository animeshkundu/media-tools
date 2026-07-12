# Three privacy-first browser extensions — program overview & shared architecture

> Decision-ready synthesis of the File / Media / Photo tools research.
> Read this first, then the three per-extension docs. Last updated 2026-07-12.
> Per-extension detail: [`ext-1-file-tools.md`](./ext-1-file-tools.md) ·
> [`ext-2-media-tools.md`](./ext-2-media-tools.md) · [`ext-3-photo-tools.md`](./ext-3-photo-tools.md).
> Incumbent source teardown: [`../research/incumbents/TEARDOWN.md`](../research/incumbents/TEARDOWN.md).

## 1. The thesis (one paragraph)

Ship **three** focused, single-purpose MV3 extensions — **File Tools**, **Media Tools**,
**Photo Tools** — cross-published to Chrome **and** Firefox from **one monorepo with a
shared core**. Each does its work **100% client-side, offline, with no upload, no ads, no
account, and near-zero permissions**. That posture is not just ethical polish — it is the
**wedge**, because the teardown proved the "market leaders" don't actually do the work in
the browser at all.

## 2. Why this wins — what the incumbent source teardown revealed

We downloaded and unpacked the actual CRX of every category leader. The finding is decisive:

- **The flagship "extensions" are deprecated Chrome-App launcher shims, not tools.**
  ZIP Extractor → opens `zipextractor.app`; Audio Cutter → `mp3cut.net` (123apps);
  Video Cutter → `online-video-cutter.com` (123apps); Loupe Collage → `getloupe.com`
  (dead since ~2013); `unzip_realtool` → `openzip.app`. All are MV2 **Chrome Apps** — a
  platform Google **ended** (you can't publish new ones) — carrying **zero in-extension
  code**. The real "tool" is a **website** that uploads your file or processes it server-/
  web-app-side, is **ad-supported** ("Remove Ads"), and **account-gated** (Sign In).
- **On Firefox these Chrome Apps never existed, and the websites work anyway** — so Firefox
  users just use the upload-based website. **The real MV3, in-browser, offline tool slot is
  empty on _both_ browsers.** The competitor to beat is a website, not an extension.
- **The genuine MV3 client-side tools that do exist are the templates, not the leaders:**
  `zipmanager` (side-panel zip, but **Chrome-locked** via File System Access API + `sidePanel`),
  `heic2jpg` (side-panel, libheif/JSZip — but **loads ad/tracking scripts**, the anti-pattern),
  `bgremover` (offscreen-document ONNX Runtime, WebGPU→WASM fallback, model cached in
  IndexedDB — the **clean** template to emulate).

**Build-better = be the real thing:** a genuine MV3 offline tool that processes the file the
moment it's dropped, nothing leaves the device, no ads, no login, minimal permissions —
mechanically verifiable (users can read the manifest). Cross-browser, one codebase.

## 3. The three extensions at a glance

|                          | **File Tools**                                                | **Media Tools**                                        | **Photo Tools**                                                                                  |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **Flagship**             | ZIP extract + create                                          | Audio cutter + Video cutter                            | Collage + HEIC + watermark                                                                       |
| **Proven Chrome demand** | ZIP Extractor 15,164 ratings (~1M+ implied)                   | Audio Cutter 200k/1,457; Video Cutter 100k/660         | Loupe Collage 100k/1,242; Watermark (Sweet Sugar) **380k/2,397**                                 |
| **Firefox competition**  | ZIP Manager ~401 (Chrome-locked); rest a search-hijack bundle | **None** — all incumbents are 123apps launchers        | Mixed: format-conversion **served** (~17–20k); collage/HEIC/watermark/bg-removal **thin/absent** |
| **Gap verdict**          | Wide open (RAR/7z/tar unserved)                               | **Biggest whitespace** — no real client-side incumbent | Real gaps in collage/HEIC/watermark/bg-removal; skip plain format-convert                        |
| **Core engine**          | `fflate` (MIT) / `zip.js` (BSD)                               | **WebCodecs + mediabunny** (MPL-2.0)                   | Canvas 2D + `libheif-js` + `onnxruntime-web`                                                     |
| **Heaviest asset**       | RAR/7z WASM (defer to Pro)                                    | `ffmpeg.wasm` (Chrome-only fallback only)              | ML model for bg-removal (~5–40 MB, lazy)                                                         |
| **Build difficulty**     | Low (mostly cheap libs)                                       | Medium (WebCodecs)                                     | Medium (canvas cheap; HEIC/ML heavy)                                                             |

## 4. Shared architecture (identical across all three)

The cross-browser constraints are the same for every extension, so the core is shared:

- **UI = a dedicated extension page** (opened in a tab), with `<input type=file multiple>` +
  drag-drop. It's the only surface identical on both browsers and roomy enough for
  drop-zone + tree/waveform/canvas + progress. A popup is too small; **`chrome.sidePanel`
  is Chrome-only** (Firefox has the incompatible `sidebar_action`) — treat side panel as an
  **optional, feature-detected** enhancement.
- **Compute = a Web Worker** spawned by that page. **Not** the MV3 service worker (no DOM,
  killed after ~30s idle) and **not `chrome.offscreen`** (Chrome-only). The service worker is
  glue only (menus, badge, opening the page). _Exception:_ WebGPU/ONNX ML (Photo's
  background-removal) needs an **offscreen document on Chrome** and a **hidden tab/page on
  Firefox** — the one place the shim diverges.
- **Output = Blob + `URL.createObjectURL` + `<a download>`** (or `downloads` API),
  universal. **File System Access API** (`showSaveFilePicker`/`showDirectoryPicker`, "save to
  folder") is **Chrome-only** → optional enhancement, degrade to download on Firefox.
- **Permissions = the minimum.** File Tools needs **none** (files are user-picked). Request
  `downloads` and any `<all_urls>` **lazily** via `optional_permissions` (heic2jpg's pattern).
- **WASM** (zip.js codec, libheif, ffmpeg.wasm, onnxruntime-web) must be **bundled locally**
  (MV3 bans remote code) and needs `content_security_policy.extension_pages:
"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`.
- **Big ML/codec models: ship the runtime, fetch the model once, cache the `ArrayBuffer` in
  IndexedDB** (bgremover's pattern) — keeps the package small and works offline after first run.
  Self-host the model (don't depend on a third-party CDN).
- **`webextension-polyfill`** + `browser_specific_settings.gecko.id` +
  `data_collection_permissions: ["none"]` (AMO, required since 2025-11-03) → one codebase,
  both stores. Firefox uses a non-persistent **event page** (has DOM) rather than a
  service worker; feature-detect `ServiceWorkerGlobalScope`-specific calls.

**Monorepo shape:** `packages/core` (drop-zone UI, Worker harness, download flow, polyfill,
manifest transform, shared components) + `packages/file`, `packages/media`, `packages/photo`
(per-tool modules + store listings). One build → 6 artifacts (3 extensions × 2 stores).

## 5. Monetization & risks (common to all three)

- **Model:** free core forever (the trust/install engine) + **one-time "Pro" unlock**
  (heavy formats, batch, save-to-folder). **Never** ads, affiliate redirects, or
  search-default changes — that is precisely the bundleware pattern that poisoned these
  categories and triggers store takedowns, and it structurally breaks the "offline, nothing
  leaves your device" pitch.
- **Store risk:** Chrome **single-purpose** policy (keep each extension genuinely one job —
  three separate extensions, not one "toolbox", is partly _why_); **no remote code**
  (bundle all WASM); **AMO requires human-readable source submission** for minified builds
  (pin build tooling, commit a reproducible build) — a recurring per-release tax on Firefox.
- **Technical ceilings:** WASM32 memory (~2–4 GB) caps single-file size for ffmpeg.wasm-style
  tools → prefer streaming (fflate/zip.js streams; mediabunny `BlobSource`). Implement
  **zip-bomb** (check uncompressed size first) and **Zip-Slip** (path-traversal) defenses
  yourself — no library does it.

## 6. Recommended build sequence

1. **Build the shared `core` first** (page + Worker + download + polyfill + manifest transform).
2. **File Tools MVP** — cheapest to nail (fflate), biggest clean gap, zero permissions →
   fastest credibility + the strongest privacy story. Flagship: ZIP extract/create + hashing + base64.
3. **Media Tools** — the **biggest whitespace** (no real client-side incumbent). Audio cut/
   join (cheap: Web Audio + lamejs) first; then video cut/compress (WebCodecs + mediabunny).
4. **Photo Tools** — lead with **collage + HEIC + watermark** (all canvas/libheif, cheap-ish,
   real gaps + 380k watermark demand); **background-removal** (MODNet/U2NetP on
   onnxruntime-web — avoid `@imgly` AGPL / BRIA non-commercial) as the marquee Pro feature.
   Skip plain PNG/JPG/WebP conversion (Firefox already serves it).

## 7. Evidence base

- **Firefox landscape:** AMO v5 API + live browser-driven store sweep (2026-07-12).
- **Chrome demand:** pinned Jan-2025 snapshot (`results/utilities.csv`) + live verification
  (chrome-stats / listings) — counts are dated/banded, ratings are the reliable relative signal.
- **Incumbent architecture:** firsthand CRX teardown of 8 extensions
  (`research/incumbents/` + `TEARDOWN.md`).
- **Libraries / MV3 / cross-browser:** primary sources (Chrome for Developers, MDN,
  Mozilla Extension Workshop), captured in each per-extension doc's appendix.
