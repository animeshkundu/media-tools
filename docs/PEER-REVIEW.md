# Peer review: media-tools plan

Adversarial pass on VISION + PRODUCT-SPEC + ARCHITECTURE.
Verdict: **not yet decision-ready** - the plan treats WebCodecs *availability* as proof of a
usable cross-browser codec + performance stack. Scores: assumption-soundness 2/5, failure-mode
coverage 1/5, alternatives 3/5. Findings below with a disposition for each. This does not block
the audio flagship (already shipped); it gates the video roadmap and hardens the claims.

Disposition key: **FIX-NOW** (cheap, cross-cutting, do before more building) · **GATE** (must
resolve before that phase ships) · **SPEC** (add explicit policy + fixtures) · **VALIDATE**
(strategic, needs a real experiment / your call).

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | Blocker | No browser × OS × codec/container support contract. FF130 WebCodecs ≠ H.264/AAC/HEVC encoder parity or hardware accel (varies by OS, esp. Linux); `.mov`=HEVC/ProRes, `.m4a`=AAC/ALAC. `isConfigSupported()` only turns unsupported flows into disabled UI, which fails the Converter persona. | **GATE** (Phase 2): ship a tested input/container/codec × Chrome/FF × Win/mac/Linux matrix; then narrow the promise, bundle targeted software codecs, or make affected tools browser-specific. Resolves the "green on both" vs "Chrome-first" contradiction. |
| 2 | Blocker | 1-2 GB envelope unsupported by the output design: whole output accumulates in one `ArrayBuffer`→`Blob`; `File` is structured-cloned (not transferable) so a transfer needs a full read; audio decode/join expands to full PCM; FF lacks `showSaveFilePicker` → needs OPFS sink w/ quota+cancel; native RIFF WAV fails >4 GiB (needs RF64). "No cap" + "cap and warn" + current design are mutually inconsistent. | **GATE** + **SPEC**: define tested hard limits and a disk-backed sink (OPFS on FF) before large-file/video tools. |
| 3 | High | Planned "Web Audio decode/slice in the worker" was invalid because `AudioContext` and `OfflineAudioContext` are Window-only. | **RESOLVED:** the shipped worker uses WebCodecs `AudioDecoder` for MP3 and direct PCM parsing for WAV. `lamejs` is used only for MP3 encoding; the app thread does not decode audio. |
| 4 | High | "Lazy ffmpeg" conflates runtime load with install size: a bundled 30 MB core ships to every user (incl. free); fetching it post-install violates MV3 remote-code; IndexedDB caching doesn't fix that. Also the library table says FF uses `@ffmpeg/core` which contradicts "FF doesn't ship ffmpeg." | **GATE** (Phase 3): choose bundle-and-accept-size / separate companion edition / drop those formats. Prove a store-loadable ffmpeg.wasm spike (COOP/COEP, nested workers, CSP). |
| 5 | High | Media correctness under-specified: VFR, B-frame reorder, edit lists, negative/nonzero-start timestamps, fragmented MP4, A/V sync + AAC/MP3 encoder delay after cuts, rotation/PAR/color-range/HDR, multi audio/subtitle/chapter/cover tracks, stream-copy container compat. "Frame-accurate/lossless/preserve-audio" need explicit drop/preserve policies + format fixtures; QuickTime playback can't gate arbitrary WebM/VP9/Opus. | **SPEC**: add preservation policies + a fixture corpus + golden tests. |
| 6 | High | Benchmark gates record facts, not pass/fail: no max peak memory, cancel-latency, FF runtime threshold, baseline hardware, quality/A-V-sync tolerance, or min-browser matrix. One-Chrome/one-FF manual testing won't expose platform codec variation; declare min versions + desktop-only; test tab-close/discard/update/sleep on long jobs. | **SPEC**: turn each gate into a numeric pass/fail on a declared matrix. |
| 7 | High | CSP restricts `script-src`/`object-src` but leaves `connect-src`/`img-src`/`media-src`/`frame-src`/`form-action` open - zero host permissions ≠ mechanical proof of no exfiltration. | **FIX-NOW** (cross-cutting): default-deny network sinks in the manifest CSP (`connect-src 'none'` where nothing is fetched; scoped `'self'` where a model/asset is). Reconcile any opt-in analytics with the "no telemetry" wording + FF data-collection decl. |
| 8 | High | Malformed-media security dismissed: mediabunny parses attacker containers in JS; `lamejs` is unmaintained; ffmpeg adds native-derived parser surface. Tiny files can declare extreme dims/durations/track counts → OOM/CPU exhaustion. `latest` deps conflict with reproducible store review. | **FIX-NOW** + **SPEC**: pin exact dep versions; add metadata ceilings, overflow-safe allocation, malformed/truncated corpus + fuzzing, explicit `VideoFrame`/`AudioData` close + encoder backpressure tests. |
| 9 | High | Licensing not reduced to SPDX labels: LGPL vendored-min-JS/WASM needs notices + corresponding source/relink material; MPL source availability; the exact ffmpeg build's configure flags/linked libs must be audited (GPL if x264/x265 present even if uninvoked); AAC/AVC/HEVC patent review; AMO needs full source/build for minified+WASM. | **GATE** (before publishing anything with these deps): artifact-level BOM + legal review. |
| 10 | Med-high | Thesis/monetization unvalidated vs cost: weak extension competitors + empty FF category may mean low demand or preference for native tools (Audacity/VLC/HandBrake); deprecated-incumbent installs aren't transferable demand; free-heavy value + late Pro + one-time $8-15 must fund ongoing codec/browser/OS/store maintenance; the Ed25519 token needs issuance + key custody + a payment-provider integration/backend. | **VALIDATE**: prove file-types, failure rates, repeat usage, and paid intent with the **audio wedge** before funding the video roadmap. |

**Current resolution for finding 7:** Resolved in the shipped audio extension. The extension-page CSP now includes `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`, `object-src 'none'`, and `base-uri 'none'`. CI validates the exact policy and manifest egress keys in both browser builds.

**Single highest-priority fix from the review:** freeze Phase 2 and build a vertical-slice
**compatibility spike** that publishes a pass/fail *browser × OS × container/codec* matrix -
actual encoder availability, measured acceleration, and bounded-memory output for representative
MP4/H.264/AAC and WebM workflows - before committing to the video tools.

**Lead disposition:** accept all findings. The audio flagship stands; #3 is resolved by the shipped
worker decode architecture, while #1/#2/#4/#9 gate the video/Pro phases. #10 (validate the audio
wedge first) is the strategic pivot and is yours to call.
