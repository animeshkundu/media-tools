# Media Tools — browser extension design doc (Chrome + Firefox, MV3)

> **SUPERSEDED (2026-07-14):** Web Audio references below are preserved as original market and
> architecture research, not as a description of the shipped decode path. The shipped engine decodes
> MP3 with worker-side WebCodecs `AudioDecoder` and parses WAV PCM directly in the worker. Bundled
> `lamejs` is used for MP3 encoding only.

Status: research complete, decision-ready. Author: research-media. Retrieved: 2026-07-12.
Scope: transforming a **local file the user provides** (audio + video) — 100% client-side, offline,
no upload. Explicitly **out of scope**: capturing tab/stream audio (`chrome.tabCapture` is
Chrome-biased and Firefox-limited) and downloading from YouTube/streams (legally fraught,
saturated). Those are different products.

---

## 1. Executive summary & recommendation

**BUILD IT. This is the strongest whitespace of the three candidate extensions.**

Tearing down the incumbent CRXs (`research/incumbents/`) produced the decisive finding: the
"market-leading" Chrome incumbents — **Audio Cutter** (~200k users) and **Video Cutter** (~100k
users) — are **deprecated MV2 Chrome-App launcher shims with zero in-extension code.** Their
manifests contain nothing but `app.launch.web_url` pointing at `mp3cut.net` and
`online-video-cutter.com` (both the **123apps** company). The actual work happens on a **website**
that is upload-first, ad-supported, and sign-in-gated. Chrome ended the Chrome Apps platform, so
these listings are **grandfathered zombies you cannot republish or compete with as an app** — and
their installs reflect a Google-Drive shortcut, not a real in-browser tool.

On **Firefox** these Chrome Apps never existed and genuine local media processing is **almost
entirely absent**: the best local audio trimmer on AMO has **2 daily users**; there is **no** local
video cutter, compressor, or video→GIF tool at all. The one real competitor with traction is
_Media Converter and Muxer_ (16,205 daily users, 3.93★) for conversion/muxing.

**So the "real MV3, in-browser, offline" slot is empty on both browsers.** The competitor to beat
is a _website_ (123apps, Clideo, VEED, EZGIF), and the wedge is concrete and defensible: **100%
offline · nothing uploaded · no file-size cap · no watermark · no ads · no sign-in · instant.** For
conversion/compression the incumbents demonstrably upload (online-audio-converter.com:
_"files are automatically deleted from our servers a few hours after…"_), so privacy is a real
differentiator there; for cutting it is more about no-ads / no-paywall / Firefox-absence.

**Why now (the answer to "if it were easy someone would have").** Client-side video was genuinely
hard before ~2024. The unlock: **WebCodecs shipped stable in Firefox desktop 130 (Sept 2024)** and
**mediabunny** (a zero-dependency, WebCodecs-based, MPL-2.0 media toolkit) reached production in 2025. Together they run most video operations **hardware-accelerated in ~tens of KB of JS on both
browsers** — no 30 MB ffmpeg.wasm for the common path. The technical barrier that kept this slot
empty just fell.

**Recommended shape:** one MV3 extension, one codebase → Chrome + Firefox, phased:

- **Phase 1 (weeks, <1 MB):** audio cutter/trimmer + joiner + speed + WAV/MP3 export (Web Audio +
  `lamejs`). Beats the entire Firefox audio landscape and the dead Chrome shim on day one.
- **Phase 2 (WebCodecs era, still small):** video trim, mute/strip audio, extract audio, audio
  format conversion, video compressor (mediabunny + WebCodecs; dedicated editor page).
- **Phase 3 (validate perf first):** video→GIF, pitch/time-stretch, exotic conversions — lazy-load
  `ffmpeg.wasm` (Chrome-first) only for what WebCodecs cannot do, behind measured benchmark gates.

---

## 2. Tools to include (ranked, with verdict)

> Verdict legend: **BUILD (MVP)** · **BUILD (fast-follow)** · **PRO/LATER** · **SKIP**.
> Build cost: **CHEAP** = Web Audio + small JS (sub-MB) · **MEDIUM** = WebCodecs + mediabunny
> (hardware-accelerated, small, Chrome + Firefox desktop) · **HEAVY** = lazy `ffmpeg.wasm` (~30 MB,
> multi-thread Chrome-only). Ranked by (real demand × gap on Firefox × ease of doing well offline).
> Detail/evidence in §3–§7.

| #   | Tool                                    | Verdict                                       | Cost   | One-line rationale                                                                                                                       |
| --- | --------------------------------------- | --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Audio cut / trim**                    | **BUILD (MVP)** — flagship                    | CHEAP  | Best demand×gap×ease. FF unserved (best local = 2 users); Chrome incumbent is a dead launcher shim. Web Audio decode→slice→`lamejs`/WAV. |
| 2   | **Audio join / merge**                  | **BUILD (MVP)**                               | CHEAP  | Same engine, concat decoded buffers. FF unserved; Chrome incumbent mediocre (3.16★).                                                     |
| 3   | **Audio format convert → WAV / MP3**    | **BUILD (MVP)**                               | CHEAP  | Huge Chrome demand (Audio Converter: 129k ratings). WAV native, MP3 via `lamejs`.                                                        |
| 4   | **Change audio speed**                  | **BUILD (MVP)**                               | CHEAP  | Resample = coupled speed+pitch, trivial; rides free on the audio engine.                                                                 |
| 5   | **Extract audio from video**            | **BUILD (fast-follow)**                       | CHEAP  | High demand ("video to mp3"). mediabunny demux + stream-copy / `AudioEncoder`. FF: only the muxer serves it.                             |
| 6   | **Mute / remove audio from video**      | **BUILD (fast-follow)**                       | CHEAP  | Strip audio track = lossless remux. Unserved everywhere.                                                                                 |
| 7   | **Video cut / trim**                    | **BUILD (fast-follow)**                       | MEDIUM | FF totally unserved; Chrome incumbent dead shim @ 3.2★. Lossless keyframe remux + frame-accurate re-encode. Needs a full page.           |
| 8   | **Audio convert → M4A/AAC, OGG/Opus**   | **BUILD (fast-follow)**                       | MEDIUM | Rounds out the converter. AAC/Opus via `AudioEncoder`; OGG-Vorbis via lib/ffmpeg.                                                        |
| 9   | **Video compressor**                    | **BUILD (fast-follow)** — marquee, perf-gated | MEDIUM | Massive web demand; strongest upload-privacy wedge. WebCodecs re-encode (hardware). Highest risk → benchmark-gate.                       |
| 10  | **Change audio pitch / time-stretch**   | **PRO/LATER**                                 | MEDIUM | Independent pitch needs a phase vocoder (`SoundTouchJS`). FF file-based unserved; niche.                                                 |
| 11  | **Video → GIF**                         | **PRO/LATER**                                 | HEAVY  | Popular; FF unserved. WebCodecs decode + `gifenc`, or ffmpeg palettegen for quality.                                                     |
| 12  | **Exotic video convert** (AVI/FLV/HEVC) | **PRO/LATER**                                 | HEAVY  | Long tail; lazy `ffmpeg.wasm`, Chrome-first (multi-thread).                                                                              |
| —   | Tab / stream audio capture              | **SKIP**                                      | —      | `chrome.tabCapture` Firefox-limited; not a local-file job.                                                                               |
| —   | Real-time equalizer / volume boost      | **SKIP**                                      | —      | Served on both (Audio Equalizer ~51k FF); it's a live-playback job, not a file transform.                                                |
| —   | YouTube / stream downloader             | **SKIP**                                      | —      | Legally fraught, saturated (VideoDownloadHelper 1.8M). Different product.                                                                |

---

## 3. Market & Chrome demand (per tool)

> Chrome `userCount` figures come from the repo's pinned Jan-2025 snapshot
> (`data/snapshots/chrome/2025-01-05/mini_extension_stats.csv`) plus the CRX teardown. **The
> snapshot's coarse `userCount` buckets (e.g. "200,000") are lower bounds** — the store reports
> users in rounded tiers. Ratings _count_ is the more reliable relative-popularity signal.

**The "incumbents" are 123apps launcher shims** (verified from CSV rows + CRX teardown §6):

| Chrome extension | userCount (bucket) | rating   | ratings (n) | author (target site)                 | what it is                             |
| ---------------- | ------------------ | -------- | ----------- | ------------------------------------ | -------------------------------------- |
| Audio Cutter     | 200,000            | 4.29     | 1,457       | mp3cut.net (123apps)                 | MV2 Chrome-App **launcher**, zero code |
| Video Cutter     | 100,000            | **3.23** | 660         | online-video-cutter.com (123apps)    | MV2 Chrome-App **launcher**, zero code |
| Audio Converter  | 200,000            | 4.87     | **129,524** | online-audio-converter.com (123apps) | web-app funnel; huge engagement        |
| Video Converter  | 400,000            | 4.74     | 38,071      | convert-video-online.com (123apps)   | web-app funnel                         |
| Audio Joiner     | 80,000             | 3.16     | 339         | audio-joiner.com (123apps)           | web-app funnel                         |

**Chrome demand read (per job):**

- **Conversion is the highest-engagement job by far.** Audio Converter's **129,524 ratings** and
  Video Converter's **38,071** dwarf the cutters. At typical extension rating rates (~0.1–1% of
  users ever rate), 129k lifetime ratings imply a **multi-million-scale userbase for the convert
  job** — though these are decade-old listings funneling to a website, so read it as demand for the
  _job_, largely captured by websites today. _(Confidence: high the job is huge; the exact live
  install count is banded/uncertain.)_
- **Cutters are real but second-tier and beatable.** Video Cutter's **3.23★** and Audio Joiner's
  **3.16★** mark low-satisfaction incumbents — and since they are _launcher shims_, that rating is
  really the 123apps website's; the in-browser slot is empty.
- **A long tail of single-purpose tools** confirms fragmented, unmet demand: Video→Audio Converter
  (8k, 4.89★), MP3 Cutter/mp3cutter.in (10k, 3.27★), Video→GIF Animation Converter (6k, 4.10★),
  MP4→MP3 (6k), MOV→MP4 (5k), MKV→MP4 (2k), WEBM→MP4 (1k), M4A→MP3 (2k), WAV→MP3 (1k), Jump Cutter
  silence-remover (10k, 4.70★). One quality suite consolidates all of these.

**Demand also lives as web-search traffic, not extensions.** The dominant tools are _websites_:
mp3cut.net, clideo.com, veed.io, cloudconvert, ezgif.com, kapwing. Users Google "audio cutter,"
"compress video online," "video to gif," land on a site that uploads their file, then hit ads,
watermarks, size caps, and paywalls. An extension one click away that does the same job **offline**
intercepts that funnel. _(Live-count verification was delegated but the sub-agent failed on input
overflow; the pinned snapshot + CRX teardown are the authoritative evidence.)_

**Bottom line:** the convert job is multi-million-scale; cut/join/extract/GIF are real, fragmented,
and served only by websites or dead shims. No genuine in-browser MV3 incumbent exists.

---

## 4. Firefox competitive landscape (per tool) — AMO evidence

> Source: AMO v5 API (`/api/v5/addons/search/`, `app=firefox`, `sort=users`), retrieved
> **2026-07-12**. Metric is `average_daily_users` (ADU). Multiple query phrasings tested per job.
> Reproducible template:
>
> ```
> curl -s -G 'https://addons.mozilla.org/api/v5/addons/search/' \
>   --data-urlencode 'q=QUERY' --data-urlencode 'app=firefox' \
>   --data-urlencode 'type=extension' --data-urlencode 'sort=users' --data-urlencode 'page_size=5' \
>   | jq -r '.results[]? | "\(.average_daily_users)u \(.ratings.count)rev \(.ratings.average)★ \(.name["en-US"]) https://addons.mozilla.org/firefox/addon/\(.slug)/"'
> ```
>
> **Deliberately honest: where Firefox is already served, it says so.**

| Job                              | Best genuine local competitor (AMO slug)                                                                                           | ADU                | Verdict                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| **Audio cut / trim**             | `ezconvert-audio-trimmer` ("cut & trim any audio format locally"); `mp3-cutter`                                                    | **2**; ~27         | **UNSERVED** — a local trimmer exists with 2 users. Wide open. |
| **Audio join / merge**           | `audio-joiner-merge-dash` (DASH-only)                                                                                              | 9                  | **UNSERVED**                                                   |
| **Audio convert**                | `media-conversion-tool` ("Media Converter and Muxer", ffmpeg.wasm, 3.93★/167 rev); `web-apps-by-123apps` (launcher, last upd 2022) | **16,205**; 19,436 | **PARTIALLY SERVED** — one beatable competitor.                |
| **Audio speed / pitch (file)**   | `speed-pitch-changer`, `capo-pitch-speed-changer` — operate on _streaming/tab_ media, not local files                              | 6,992; 32          | **UNSERVED for local files**                                   |
| **Video cut / trim**             | none — every result is a YouTube/Twitter downloader                                                                                | —                  | **UNSERVED**                                                   |
| **Video convert**                | `file-converter` (opens online-convert.com = upload); "Converter Suite & Custom Web Search" (search-hijacker)                      | 12,654; 74,738     | **UNSERVED (genuine local)** — see caveat                      |
| **Video compress**               | none                                                                                                                               | —                  | **UNSERVED**                                                   |
| **Extract audio from video**     | `media-conversion-tool` (the muxer)                                                                                                | 16,205             | **PARTIALLY SERVED** (that one)                                |
| **Video → GIF**                  | none local                                                                                                                         | —                  | **UNSERVED**                                                   |
| **Mute / remove audio**          | none                                                                                                                               | —                  | **UNSERVED**                                                   |
| `katge-video-downloader-trimmer` | brand-new (2026-07-10) YouTube downloader+trimmer                                                                                  | **0**              | Not a local-file tool; negligible                              |

---

## 5. Firefox landscape summary (honest scorecard)

| Job                               | Firefox status       | Best incumbent ADU       | Our opening                       |
| --------------------------------- | -------------------- | ------------------------ | --------------------------------- |
| Audio cut / trim                  | **Open goal**        | 2                        | Flagship; own it outright         |
| Audio join / merge                | **Open goal**        | 9                        | Own it                            |
| Audio speed (file)                | **Open goal**        | ~0 (streams only)        | Own it                            |
| Extract audio from video          | Thinly served        | 16,205 (muxer)           | Beat on UX + offline              |
| Audio convert                     | **Partially served** | 16,205 (muxer, 3.93★)    | Beatable fast-follow, not a lead  |
| Video cut / trim                  | **Open goal**        | 0                        | Own it                            |
| Video compress                    | **Open goal**        | 0                        | Marquee, own it (perf permitting) |
| Video mute / strip audio          | **Open goal**        | 0                        | Own it                            |
| Video → GIF                       | **Open goal**        | 0                        | Own it (Phase 3)                  |
| Audio pitch / time-stretch (file) | **Open goal**        | ~0                       | Pro/later                         |
| Real-time EQ / volume             | **Served — skip**    | 51,714 (Audio Equalizer) | Different job                     |

**Two honesty flags:** (1) _Conversion is genuinely partially served_ by Media Converter and Muxer
(ffmpeg.wasm-based) — lead with cut/trim/compress/GIF where nothing exists, treat conversion as a
fast-follow. (2) _The big "converter" numbers on Firefox are search-hijackers_ — "Converter Suite &
Custom Web Search" (74,738), "Photo Editor & Search" (29,859 ADU / **1 review**) are the "& Search"
adware-adjacent family, not genuine tools; a quality extension isn't competing with them on merit.

**Net:** cut, join, trim, compress, mute, GIF, and file speed/pitch are open goals; conversion has
one beatable incumbent. Be _the_ local media tool for Firefox.

---

## 6. Incumbent teardown & how we build better (the real competitor is a website)

### 6.1 The "leaders" are dead Chrome-App launchers, not extensions

Verified by unpacking the CRXs (`research/incumbents/audiocutter/manifest.json`,
`.../videocutter/manifest.json`):

```jsonc
// Audio Cutter v1.2.9 — manifest.json (entire relevant content)
{ "manifest_version": 2, "app": { "launch": { "web_url": "http://mp3cut.net/" } } }
// Video Cutter v1.0.5
{ "manifest_version": 2, "app": { "launch": { "web_url": "http://online-video-cutter.com/" } } }
```

Both ship only icons + locale strings. **No processing code exists in the extension.** They are
"open this website" buttons on the **dead Chrome Apps platform** — you cannot publish new ones, and
a real MV3 extension therefore has no MV3 competitor.

### 6.2 The real competitor is a website — and the "no-upload" wedge is per-tool

When users click, they land on a 123apps web app, e.g. `mp3cut.net`: big _Choose File_ + drag-drop
→ waveform editor → trim handles, fade in/out, format picker → download; **ads + a "Remove Ads"
upsell + Sign In**, cross-linked across the suite. **The #1 complaint across every incumbent's
reviews is literally _"it's not an app — it just opens a website"_** — so the universal, always-true
wedge is being a **real installed tool**. Whether the site _uploads_, however, is **per-tool**
(verified from each site's own copy + embedded JS config — the earlier "all upload" reading was wrong):

- **mp3cut.net** (basic audio cut) and **online-video-cutter.com** (simple trim) already process
  **client-side via WASM** — so "no upload" is a _weak_ edge on basic trimming; compete there on
  **no ads · no account · no cap · instant · offline** instead.
- **online-audio-converter.com · audio-joiner.com · convert-video-online.com** genuinely **upload to
  servers**, cap the free tier (500 MB free / 4 GB premium video; ~5 files/day), and gate the rest
  behind **Premium (~$6/mo)**. Web rivals (VEED, Kapwing, Clideo) add **watermarks** on free tiers.

**Aim the "100% offline, nothing uploaded, no watermark, no cap" pitch hardest at conversion,
joining, and video** — not at plain audio trimming, where mp3cut already runs locally.

### 6.3 The genuine MV3 client-side models to emulate

- On AMO, **Media Converter and Muxer** (`media-conversion-tool`, 16,205 ADU) proves an
  ffmpeg.wasm-based converter passes review and runs in-browser — but it's mediocre (3.93★) and
  narrow. Beat it on UX, speed (WebCodecs), and breadth.
- From the teardown, **heic2jpg** (MV3 · service worker · **side panel** · sandbox page · WASM,
  lazy) and **zipmanager** (MV3 · side panel · storage) are the right in-extension patterns:
  service worker orchestrates, heavy work runs in a page/worker, UI self-rendered, no redirect.

### 6.4 How we build better (the wedge)

1. **Be a real MV3 extension that does the work in-browser** — not a Chrome-App launcher (dead) or
   a website redirect. This alone answers the single most common incumbent complaint.
2. **The wedge, sharply:** _a real installed app · no ads · no sign-in · no watermark · no size cap ·
   offline._ Lead "nothing uploaded" hardest on **conversion + joining + video** (incumbents
   demonstrably upload there); on basic audio cut, lead on no-ads/no-account/instant.
3. **Match then beat the 123apps waveform-editor polish**, minus ads, sign-in, watermarks, and
   size caps. Process the file the instant it's dropped.
4. **Modern engine:** WebCodecs + mediabunny (hardware, tiny, cross-browser) as primary; ffmpeg.wasm
   lazy Chrome-first fallback. The incumbents can't respond: Chrome Apps are frozen, and 123apps
   won't cannibalize their ad/upload funnel with a free offline extension.
5. **Two category gaps with zero real competition:** **mute / remove audio from a video** (no
   dedicated extension exists at all) and **change speed/pitch of a local file _with export_**
   (existing tools are playback-only, e.g. Transpose 1M+ but no file output). Both are cheap
   client-side wins — strong candidates for early differentiation.

---

## 7. Technical build (libraries per tool, MV3 architecture, feasibility)

### 7.1 Three engines, and the library choice per operation

**Tier A — Web Audio + tiny JS (CHEAP, sub-MB).** `OfflineAudioContext` decodes any
browser-supported audio → slice/concat/resample in JS. Export **WAV** natively; **MP3** via
**`lamejs`** (pure-JS LAME, LGPL; MP3 encode is _not_ in WebCodecs, so lamejs is required). Covers
audio cut, join, speed (coupled), WAV/MP3 convert.

**Tier B — WebCodecs + mediabunny (MEDIUM, small, hardware-accelerated) — the primary engine.**

- **WebCodecs** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)) gives
  hardware `Video/AudioEncoder`+`Decoder`, raw codec access only — no containers.
- **mediabunny** ([mediabunny.dev](https://mediabunny.dev),
  [github](https://github.com/Vanilagy/mediabunny), **MPL-2.0**, zero-dep TS, tree-shakable to
  ~tens of KB) is the muxer/demuxer + high-level convert/trim/resize on top of WebCodecs. Formats:
  MP4, MOV, WebM, MKV, WAVE, MP3, Ogg, FLAC, ADTS, MPEG-TS. **Crucially it needs no
  SharedArrayBuffer**, so it runs full-speed on Firefox. Covers video trim (lossless remux _and_
  frame-accurate re-encode), mute/strip, extract audio, compress (re-encode), m4a/aac/opus encode,
  most container conversion.

**Tier C — ffmpeg.wasm (HEAVY, ~25-31 MB core, lazy, Chrome-first).** Only for what WebCodecs
can't do: **GIF encode**, exotic/legacy containers (AVI/FLV), HEVC, codecs the browser lacks.
Lazy-load **only when a tool needs it**, never in the base bundle.

| Operation                      | Engine                             | Cost         | Note                                              |
| ------------------------------ | ---------------------------------- | ------------ | ------------------------------------------------- |
| Audio cut / join / speed       | Web Audio                          | CHEAP        | Sample-accurate; WAV/MP3 out                      |
| Audio → WAV / MP3              | native / `lamejs`                  | CHEAP        | MP3 patents expired 2017                          |
| Audio → M4A/AAC, Opus          | WebCodecs `AudioEncoder`           | MEDIUM       | Browser encoder; no patent burden on us           |
| Audio → OGG Vorbis             | JS lib or ffmpeg                   | MEDIUM/HEAVY | Vorbis encode not in WebCodecs                    |
| Extract audio from video       | mediabunny demux (+`AudioEncoder`) | CHEAP/MEDIUM | Stream-copy when codec matches                    |
| Video trim (keyframe/lossless) | mediabunny remux                   | MEDIUM       | Fast, no quality loss; **cuts snap to keyframes** |
| Video trim (frame-accurate)    | WebCodecs re-encode GOP            | MEDIUM       | Exact but slower                                  |
| Mute / remove audio            | mediabunny remux (drop track)      | CHEAP        | Lossless                                          |
| Video compress                 | WebCodecs re-encode                | MEDIUM→HEAVY | Hardware on both desktops; perf-gate              |
| Video → GIF                    | WebCodecs decode + `gifenc`        | MEDIUM→HEAVY | GIF encode not in WebCodecs                       |
| Video convert mp4/mov/webm/mkv | mediabunny                         | MEDIUM       | Transmux when compatible, else transcode          |
| Video convert avi/flv/hevc     | ffmpeg.wasm (lazy)                 | HEAVY        | Chrome-first (multi-thread)                       |
| Audio pitch / time-stretch     | `SoundTouchJS` (phase vocoder)     | MEDIUM       | Independent pitch ≠ resample                      |

Advisor-flagged nuances baked in: "lossless trim" is **keyframe-constrained** (offer a fast
keyframe mode _and_ an exact re-encode mode); **WebCodecs API availability ≠ codec availability**
(AAC/H.264 encoders can be platform-dependent, notably Linux Firefox) → always capability-detect
and fall back.

### 7.2 MV3 cross-browser architecture (one build, both browsers)

```
Service worker (MV3, both) ── orchestration only: menus, routing, download. No DOM/long tasks/WASM.
Dedicated EXTENSION PAGE / TAB  ◄── the workhorse; works on Chrome AND Firefox.
   • Full editor UI (video needs real screen space; a popup won't do).
   • Runs Web Audio / WebCodecs / mediabunny / (lazy) ffmpeg.wasm inside a Web Worker.
   • File → decode → process → Blob → download. Streams large inputs where possible.
Side panel (optional) for the light audio tools (heic2jpg / zipmanager pattern).
chrome.offscreen (Chrome-only ENHANCEMENT) — hosts the cross-origin-isolated context for
   multi-threaded ffmpeg.wasm. Firefox: no offscreen API → dedicated page/tab; WebCodecs needs no SAB.
```

**The primary engine (WebCodecs + mediabunny) needs no SharedArrayBuffer**, so the dedicated page +
Web Worker is the shared execution model on both browsers. Offscreen/COI is a Chrome-only speed-up
for the ffmpeg fallback (see §7.3).

### 7.3 Cross-origin isolation, memory, and store constraints

- **Multi-threaded ffmpeg.wasm needs `SharedArrayBuffer` → cross-origin isolation.** Chrome
  extensions enable it via **manifest keys** `"cross_origin_embedder_policy": {"value":
"require-corp"}` + `"cross_origin_opener_policy": {"value": "same-origin"}` (Chrome 93+;
  [docs](https://developer.chrome.com/docs/extensions/develop/concepts/cross-origin-isolation)).
  **Firefox does not support these keys** ([Bug 1673477](https://bugzilla.mozilla.org/show_bug.cgi?id=1673477))
  → `moz-extension://` pages can't be isolated → **ffmpeg.wasm is single-threaded on Firefox.**
  Detect `self.crossOriginIsolated`; use `@ffmpeg/core-mt` on Chrome, `@ffmpeg/core` on Firefox —
  but prefer WebCodecs on Firefox so we never pay the single-thread penalty for the common path.
- **MV3 remote-code ban:** bundle all WASM/JS in the package (point `FFmpeg.load({coreURL,wasmURL})`
  at packaged files). CSP: `"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src
'self'"`. **Precedent:** Media Converter and Muxer (ffmpeg.wasm) is live on AMO; heic2jpg ships
  13 MB WASM on the Chrome Web Store — a bundled media-WASM extension passes review on both.
- **Memory:** WASM is 32-bit → ~2-4 GB address-space ceiling; a multi-GB video can OOM ffmpeg.
  Mitigate: prefer streaming (mediabunny), chunk, cap/warn on huge inputs, support **cancellation**,
  free buffers promptly.
- **Bundle:** Phase 1 <1 MB; Phase 2 (mediabunny + WebCodecs) still small (hundreds of KB); Phase 3
  lazy-loads the ~30 MB ffmpeg core **on demand** — base install stays light, review stays easy.
- **Permissions:** local-file work via `<input type=file>` + drag-drop needs **no host
  permissions** — a clean, trust-building manifest.

### 7.4 Locked design principles

- WebCodecs + mediabunny first; ffmpeg.wasm is a lazy, Chrome-first fallback, never in the base
  bundle. · Capability-detect every encoder; degrade gracefully. · Never upload; no network for
  processing. · Heavy work off the service worker, always cancellable. · Ship each heavy tool only
  after it clears the §7.5 benchmark gates on both browsers.

### 7.5 Benchmark acceptance gates (before shipping any heavy tool)

Measure on realistic inputs and record: installed **package size**; **max tested input**
(e.g. 1080p/10-min ≈ 1-2 GB); **peak memory**; **wall-clock** (target: compress ≥ ~0.5-1× realtime
on Chrome hardware path; record the Firefox number); **cancellation mid-run works**; **output plays**
in VLC + QuickTime + browsers. Ship only when green on Chrome _and_ Firefox.

---

## 8. Product / UX

- **Drop-first, not upload-first.** Process the instant a file is dropped; no redirect,
  no spinner-to-a-server.
- **Waveform editor** for audio (match mp3cut.net polish): trim handles, fade in/out, zoom, region
  select, format + bitrate picker, one-click export.
- **Video editor page:** timeline scrubber, in/out handles, live preview, output settings
  (resolution/bitrate for compress; fps/size for GIF), progress bar with **Cancel**.
- **Batch** where cheap (multiple audio files → convert/trim all) — a Pro hook.
- **Zero friction:** no account, no watermark, no ads in the free core, everything offline.
- **Trust signals:** "Your file never leaves your device"; works with airplane mode on (a genuine,
  demoable claim). Capability-detect and gray out an encoder that isn't available rather than
  failing after a long run.

---

## 9. Monetization & go-to-market

**Model: free offline core + one-time "Pro" unlock** (avoid subscription/server so the offline
promise holds).

- **Free:** audio cut/join/convert (mp3/wav), video trim/mute/extract-audio, basic compress — no
  ads, no watermark, no upload, no size cap beyond the device.
- **Pro (one-time ~$8-15, or low annual):** batch, high-bitrate/lossless export, video→GIF quality
  options, pitch/time-stretch, exotic-format conversion, priority (multi-thread) compression on
  Chrome. Monetize convenience/power, not the basic job.
- **Payments without breaking offline:** license-key model (Gumroad/Paddle/Lemon Squeezy) validated
  **offline** after a one-time activation; Firefox has no built-in extension payments and Chrome
  retired its licensing API, so a key model is the portable choice.
- **Contrast the incumbents:** 123apps gates 10 GB + AI behind Premium and shows ads; we give the
  whole job free and monetize power.

**GTM:**

1. **Firefox-first** — near-zero competition; become _the_ local media tool on AMO (smaller catalog
   ranks a quality tool fast). Cross-list on Chrome where the incumbents are dead shims.
2. **Intercept the web-search funnel** — store-listing SEO on the exact queries flowing to
   mp3cut.net/clideo/ezgif ("audio cutter", "trim mp3", "compress video", "video to gif", "extract
   audio"). Lead copy: _100% offline · no upload · no watermark · no limit._
3. **Suite cross-promotion** with File Tools + Photo Tools as a privacy-first "offline tools" brand.
4. **Content wedge:** short "airplane-mode" demos — same job, no internet, nothing uploaded — which
   the website competitors literally cannot claim.

---

## 10. Risks

| Risk                                                                                                     | Severity | Mitigation                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ffmpeg.wasm ~30 MB** → install friction + review scrutiny                                              | Medium   | mediabunny primary (KBs); lazy-load ffmpeg only for GIF/exotic; keep out of base package. Precedent passes review.                                                                                                                                                                    |
| **Firefox single-threaded ffmpeg** (no SAB) → slow compress                                              | Medium   | Prefer WebCodecs (hardware, no SAB) on Firefox; reserve ffmpeg for gaps; warn on huge inputs.                                                                                                                                                                                         |
| **Memory / OOM on large video** (32-bit WASM)                                                            | Medium   | Stream (mediabunny), chunk, cap/warn, cancellation, prompt buffer release.                                                                                                                                                                                                            |
| **WebCodecs codec availability ≠ API availability** (AAC/H.264 encode platform-dependent, esp. Linux FF) | Medium   | Capability-detect every encoder; graceful ffmpeg fallback; disable unsupported UI options.                                                                                                                                                                                            |
| **Licensing**                                                                                            | Medium   | `lamejs` LGPL · `mediabunny` MPL-2.0 · `gifenc` MIT — all fine commercially. **ffmpeg.wasm:** default core **LGPL**; x264/x265 core **GPL** → use the LGPL core or offload H.264/H.265 encode to WebCodecs (browser's own encoder, no patent burden on us). MP3 patents expired 2017. |
| **Store review (broad file handling + WASM)**                                                            | Low-Med  | No host permissions for local files; bundle all code; minimal manifest; precedent extensions live on both stores.                                                                                                                                                                     |
| **Adverse selection ("why is it empty?")**                                                               | Low      | Answered: demand routed to websites with working funnels; the MV3 slot stayed empty because Chrome Apps died and client-side video was hard pre-WebCodecs. WebCodecs-in-Firefox (Sept 2024) + mediabunny (2025) is the genuine "why now."                                             |
| **Perf disappointment on video**                                                                         | Med      | Benchmark gates (§7.5) before shipping any heavy tool; ship audio (Phase 1) regardless — a guaranteed win.                                                                                                                                                                            |

---

## 11. Prioritized MVP build order

**Phase 1 — Audio core (ship first, <1 MB, guaranteed win).** Audio cutter/trimmer + joiner +
speed + WAV/MP3 export (Web Audio + `lamejs`). Waveform editor UI. Ships to both stores; **beats the
entire Firefox audio landscape and the dead Chrome shim on day one.** Establishes the brand and the
offline promise.

**Phase 2 — Video via WebCodecs/mediabunny (small, cross-browser desktop).** Extract audio from
video, mute/remove audio, video trim (lossless keyframe + frame-accurate), audio→M4A/AAC/OGG
conversion, and the **video compressor** (marquee, behind §7.5 gates). Dedicated editor page. This
turns the extension into a full media toolkit and takes the unserved video whitespace.

**Phase 3 — Heavy tools, behind benchmark gates.** Video→GIF (`gifenc`), pitch/time-stretch
(`SoundTouchJS`), exotic-format conversion (lazy `ffmpeg.wasm`, Chrome-first). Ship each only after
it clears §7.5 on Chrome and Firefox.

**Sequencing rationale:** each phase is independently shippable and independently a market win;
value compounds; risky WASM work is deferred until the cheap, certain wins are banked; the bundle
stays light until a user invokes a heavy tool.

---

## Appendix A — sources

- Incumbent teardown: `docs/TEARDOWN.md`, `research/incumbents/audiocutter/manifest.json`, `.../videocutter/manifest.json`.
- Chrome demand: `data/snapshots/chrome/2025-01-05/mini_extension_stats.csv` (pinned, verified per-row).
- Firefox: AMO v5 API (query template §4); slugs `media-conversion-tool`, `ezconvert-audio-trimmer`, `web-apps-by-123apps`, `speed-pitch-changer`, `audio-equalizer-wext`, `katge-video-downloader-trimmer`.
- Firefox WebCodecs: [WebCodecs API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), [AudioEncoder — MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder) (VideoEncoder/AudioEncoder stable Firefox desktop 130+, Sept 2024).
- Extension cross-origin isolation: [Chrome docs](https://developer.chrome.com/docs/extensions/develop/concepts/cross-origin-isolation), [Firefox Bug 1673477](https://bugzilla.mozilla.org/show_bug.cgi?id=1673477).
- ffmpeg.wasm: [ffmpegwasm.netlify.app](https://ffmpegwasm.netlify.app/), [github.com/ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm).
- mediabunny: [mediabunny.dev](https://mediabunny.dev), [github.com/Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0).
- 123apps upload evidence: online-audio-converter.com privacy copy ("files … deleted from our servers a few hours after").
</content>
