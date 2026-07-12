# Incumbent teardown — how the "market leaders" are actually built

Source: downloaded each extension's CRX from the Chrome Web Store and unpacked it
(`research/incumbents/<name>/`). This is what informs _how to build better_.

> ⚠️ **ID correction:** the real ZIP Extractor id is `mmfcakoljjhncfphlflcedhgogfhpbcd`
> (an earlier note used a truncated/wrong id). Verified from the CSV + a successful CRX pull.

## The single most important finding

The four flagship "incumbents" are **NOT real extensions** — they are deprecated
**Chrome App launcher shims** that just open a website:

| Extension                | Manifest                                                                                 | What it actually is                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **ZIP Extractor** v2.9   | MV2, `app.launch.web_url = https://zipextractor.app/` + Google Drive `gdrive_mime_types` | A Drive context-menu shortcut that opens the **zipextractor.app** web app. **Zero** in-extension code (9 files, all icons). |
| **Audio Cutter** v1.2.9  | MV2, `app.launch.web_url = http://mp3cut.net/` + Drive audio mime-types                  | Launcher to **mp3cut.net** (123apps). Zero code.                                                                            |
| **Video Cutter** v1.0.5  | MV2, `app.launch.web_url = http://online-video-cutter.com/`                              | Launcher to **online-video-cutter.com** (123apps). Zero code.                                                               |
| **Loupe Collage** v3.1.0 | MV2, `app.launch.web_url = http://getloupe.com/create`                                   | Launcher to **getloupe.com** (site decaying since ~2013). Zero code.                                                        |

Implications:

- These are **legacy Chrome Apps** — Google _ended_ the Chrome Apps platform; you
  cannot publish new ones. The listings are grandfathered zombies.
- Their large install counts reflect **Google-Drive integration + "shortcut to a
  site" demand**, not a real in-browser tool. The actual work happens on the
  **website** (123apps etc.), which uploads your file or runs it on their page.
- On Firefox these Chrome Apps never existed, and the websites work in any browser
  anyway — so Firefox users just use the website (with its upload/privacy cost).
- **Therefore the "real MV3 in-browser tool" slot is empty on _both_ browsers.**
  The competitor to beat is a _website_, not an extension.

## The real client-side templates to emulate

| Extension                                                | Architecture                                                                                                                                               | Libraries                                                          | Lesson                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **heic2jpg** v2.6                                        | MV3 · service worker · **side panel** · **sandbox** page · 13 MB                                                                                           | **libheif** (WASM decode) + **jimp** + **jszip** + **pako**        | Real in-browser HEIC→JPG. Lazy, sandboxed heavy work. (external hosts jivo.ru/text.ru = chat/analytics only)                                                                                                                                                                                                                                                                  |
| **bgremover** v1.0 "Background Remover – Free & Private" | MV3 · service worker · **offscreen document** · **WebGPU/WASM**                                                                                            | **BRIA RMBG** model, fetched from huggingface.co once then offline | Client-side ML is feasible. ⚠️ BRIA RMBG is **non-commercial license** — use MODNet/U2NetP instead (see library report).                                                                                                                                                                                                                                                      |
| **zipmanager** v0.3.1                                    | MV3 · service worker · **side panel** + storage · 350 KB JS · WXT + SolidJS + Tailwind, 70-locale i18n, Zip64 streaming in a blob Web Worker, zero network | bundled zip lib (no encrypted-zip)                                 | The right **UX** model for the File Tools extension — BUT **Chrome-locked**: uses File System Access API (`showDirectoryPicker`→`createWritable`) for "extract to folder" + Chrome `sidePanel`, neither in Firefox (2026). Take its UX bar, move the critical path to a dedicated page + Web Worker + download output; make FSA/side-panel optional Chrome-only enhancements. |

> ⚠️ Correction (firsthand code read): **`unzip_realtool` is NOT a real client-side unzip.** Its background.js/content.js have zero extraction logic — it opens **openzip.app** and injects deep-link icons into Google search results that hand the file to that website. It's a **second website funnel**, not a tool. This _strengthens_ the thesis: both visible "leaders" (ZIP Extractor → zipextractor.app, this → openzip.app) are website redirects. The only genuine in-browser file tool found is **zipmanager**.

## Build-better thesis (evidence-backed)

1. **Be a real MV3 extension that does the work in-browser** — not a Chrome App
   launcher (dead platform) and not a website redirect.
2. **Fully offline, zero upload** — this is the concrete differentiator vs
   123apps/remove.bg/Canva, which upload or run server-side. Lead the store listing
   with _privacy + offline + no file leaves your device_.
3. **Modern UX**: side panel (heic2jpg, zipmanager) or a dedicated editor tab;
   drag-and-drop; batch; progress; no redirect.
4. **Bundle proven client-side libs, MV3-compliant (no remote code):** File →
   `fflate` (MIT) / `zip.js` (BSD); Media → Web Audio + `lamejs` for audio,
   `ffmpeg.wasm` (~30 MB) for video; Photo → Canvas 2D + `pica` + `libheif-js`.
5. **One codebase → Chrome + Firefox.** Caveat: `chrome.offscreen` is **Chrome-only**;
   on Firefox run heavy processing in a normal extension **page/tab**, keep the
   service worker for orchestration only. `OffscreenCanvas` (the Web API) is fine in both.
6. **The incumbents can't easily respond:** Chrome Apps are frozen; the website
   players won't cannibalize their upload-based funnels.

## The actual tools' UI/UX (what users really see)

Since the "extensions" are launchers, the real UX is the web apps they open:

- **mp3cut.net** (Audio Cutter's target): upload-first — big **Choose File** + drag-drop →
  waveform editor appears → trim handles, **fade in/out**, format options → download.
  **Ad-supported**, with a **"Remove Ads"** upsell and **Sign In**. Nav across
  Video/Audio/PDF/Converters (123apps suite).
- **online-video-cutter.com** (Video Cutter's target): same 123apps pattern.
- **zipextractor.app** (ZIP Extractor's target): drop/select a zip → file tree → extract.
- The real MV3 extensions (**zipmanager**, **heic2jpg**) render their own UI in a
  **side panel** — read their extracted `*.html`/`*.css` for the in-extension patterns.

**Build-better UX wedge:** these web apps are upload-first + ad-supported + account-gated.
A real extension wins by being **offline, no upload, no ads, no sign-in, instant** —
process the file the moment it's dropped, everything local. Say it on the tile.

## Per-extension steer

- **File Tools** — model after **zipmanager** (MV3 side panel), _not_ ZIP Extractor.
  Core: unzip/extract (zip/rar/7z via `fflate`+`libarchive`), create zip. The dead
  Chrome App is the whole reason a real MV3 tool wins.
- **Media Tools** — **no real client-side incumbent exists** (all are 123apps
  launchers) → biggest whitespace. Audio cut = Web Audio + `lamejs` (cheap); video
  cut/compress = `ffmpeg.wasm` (heavy, lazy-load, run in a tab/offscreen).
- **Photo Tools** — **heic2jpg** is the working template. Firefox already serves
  _format conversion_ (~17–20k-user tools) → don't lead with that. Lead with
  **collage + HEIC + watermark (380k-demand, Sweet Sugar) + background-removal**
  (client-side, MODNet/U2NetP — avoid `@imgly` AGPL and BRIA non-commercial).
