# iMovie audio-suite feasibility and architecture audit

- **Date:** 2026-07-22
- **Owner:** animeshkundu/media-tools
- **Status:** Phase 1 research; no implementation approval

## Context and research question

This audit evaluates a request for an iMovie-like multitrack audio editor against the shipped Media
Tools product and architecture. It covers documented iMovie behavior, relevant web-platform
capabilities, proposed library choices, a possible Web Audio graph, and a staged implementation
strategy.

The question is not whether a browser can demonstrate each interaction in isolation. The question is
whether the feature can ship in the shared Chrome, Firefox, and hosted-web product while preserving:

- local processing with no upload, no remote code, and no hidden telemetry;
- the extension's empty install-time permission list and default-deny egress CSP;
- a durable app-page host with an ephemeral background used only as glue;
- worker-owned heavy processing, progress, cancellation, cleanup, and no partial download;
- the 64 MiB per-file input limit, 256 MiB decoded or in-flight PCM limit, 30-minute decoded-duration
  limit, and mono/stereo channel limit;
- one WXT codebase, exact dependency pins, and production-artifact runtime evidence.

## Executive decision

**Do not begin the requested Phase A application build.** The request is a product-direction change,
not an incremental extension of the current audio tools.

The selected direction for the current product remains a worker-owned, durable-export pipeline:
worker-side WebCodecs MP3 decode, direct WAV PCM parsing, pure PCM transforms, native WAV encoding,
and bundled `lamejs` MP3 encoding. Audio Cutter and Convert already follow that ownership model;
bounded Join and Change Speed transforms still run on the app page and must move before more DSP is
added. No new library or Web Audio graph is selected for production by this audit.

Three parts of the request directly conflict with binding product boundaries:

1. Audio skimming, live EQ, live effects, and AudioWorklet monitoring are real-time playback
   modifiers. `docs/VISION.md` and `docs/PRODUCT-SPEC.md` explicitly exclude that product category.
2. Live voiceover introduces a permissioned capture surface outside the current local-file job. The
   named non-goal is tab/stream capture rather than microphone recording specifically, but the shipped
   capability contract currently promises no microphone access. Voiceover therefore needs an explicit
   product and privacy-contract decision.
3. A many-stem magnetic timeline is not bounded by the existing one-file and aggregate PCM contracts.
   It needs a project-level storage, track-count, decode-window, and output-sink design before UI work.

Some requested controls can be reframed as **offline, worker-based transforms that create a durable
WAV or MP3 export**. Inline gain, fades, offline ducking, offline EQ/noise reduction, and offline
effects are technically plausible in that form, but they are not approved roadmap items. The
smallest aligned candidate is clip gain plus fade envelopes in Audio Cutter, represented in integer
sample frames and applied in the existing worker before encoding.

Video audio extraction remains Phase 2. Independent pitch/time stretch remains Phase 3. AAC/M4A is
Phase 2 and capability/licensing gated. FLAC is not on the approved roadmap. None of those paths
ships today.

## Phase 1 outcome

| Decision | Outcome |
| --- | --- |
| Application code authorized | **No** |
| Product direction | Retain bounded, offline, durable local-file exports pending an explicit product-scope decision |
| Selected production architecture | Durable React app page supervising cancellable media workers; background remains glue only |
| New runtime dependencies | None |
| Next implementation candidate | Worker-owned clip gain and fade envelopes |
| Candidate prerequisites | Approve durable-export scope, move the transform into the worker, specify clipping and fade curves, and add bounded PCM, cancellation, and output tests |

The next candidate is a recommendation for separate product and implementation approval, not approval
granted by this research document.

## 1. Repository baseline

The audit inspected the current contracts and implementation:

| Concern | Shipped state | Evidence |
| --- | --- | --- |
| Product | Four local-file jobs: cut, join, coupled speed/pitch, and WAV/MP3 conversion | `docs/VISION.md`, `docs/PRODUCT-SPEC.md`, `docs/ROADMAP.md` |
| Host | Shared React app in a durable tab; background only opens that page | `docs/ARCHITECTURE.md`, `entrypoints/background.ts`, `entrypoints/app/App.tsx` |
| Compute | Analyze, decode, and final encode use a dedicated worker; bounded join and speed transforms still run on the app page | `lib/core/worker.ts`, `lib/tools/audio-cutter/encode.worker.ts`, `docs/CAPABILITY-CONTRACT.md` |
| Waveform | Main-thread Canvas 2D peak columns with pointer and keyboard trim handles | `lib/tools/audio-cutter/Waveform.tsx` |
| Limits | 64 MiB input, 256 MiB decoded/in-flight PCM, mono/stereo, 30-minute decoded duration | `lib/core/worker.ts`, `lib/tools/audio-cutter/encode.worker.ts` |
| Privacy | No extension permissions, no remote code, no network primitives, default-deny egress CSP | `wxt.config.ts`, `scripts/check-csp.mjs`, `scripts/check-manifest-egress.mjs` |
| Runtime dependencies | React, React DOM, and `lamejs`; no media WASM or container engine | `package.json`, `docs/THIRD-PARTY.md` |

A source search under `entrypoints/` and `lib/` found no `AudioWorklet`,
`OfflineAudioContext`, `getUserMedia`, `MediaRecorder`, `OffscreenCanvas`, WebGL, multitrack,
skimming, ducking, or voiceover implementation. These are new subsystems rather than dormant
capabilities.

## 2. Documented iMovie behavior

This is a documentation audit of the Apple iMovie User Guides, not a claim of source-code,
algorithm, or measured-performance equivalence. Apple documents interactions but does not publish
the latency, DSP algorithm, threshold, or render-time details requested here.

| Behavior | Documented Mac behavior | Documented iPhone/iPad behavior | Implication |
| --- | --- | --- | --- |
| Skimming | Pointer movement over clips previews them; audio skimming is separately enabled under View | No separately named audio-skimming behavior was located in the reviewed iOS guide | "Zero stutter" and `<20 ms` are requested targets, not documented Apple behavior |
| Clip volume | A horizontal line over the waveform changes volume; a selected range and volume keyframes can vary level over time | A per-clip Audio inspector exposes volume and mute | Apple documents percentages and interaction, not the requested `0-500%` range |
| Peak indication | Waveforms use green for safe levels, yellow for distortion, and red for clipping/severe distortion | Equivalent timeline colors were not confirmed in the reviewed iOS page | Exact `-2 dBFS` and `0 dBFS` thresholds require a Media Tools specification |
| Fades | Hover reveals start/end fade handles; dragging sets fade duration | Audio > Fade reveals handles; video audio must be detached first | Apple does not document selectable linear/logarithmic curve types |
| Attached audio | An attached audio clip moves with the timeline clip to which it is attached | Audio appears below video; ordinary audio can be moved while background music has special behavior | Use Apple's "attached" terminology; this is not evidence for a full magnetic timeline |
| Detach audio | Modify > Detach Audio creates a separate green audio clip attached below the video | Detaching is documented as a prerequisite for fading video audio | Depends on an unshipped video demux/remux engine |
| Ducking | The user selects foreground audio and enables "Lower volume of other clips," then chooses a reduction | Background music is automatically ducked while a video clip's audible sound plays | Mac and iOS behavior differ; neither source documents the requested `-40 dBFS` detector |
| Noise reduction and EQ | Mac exposes automatic enhancement, background-noise reduction from 0-100%, and EQ presets | An equivalent control was not confirmed in the reviewed iOS guide | Do not claim cross-platform iMovie parity without direct device evidence |
| Voiceover | Input device, input level, a green-safe meter, and "Mute Project" are documented; the recording attaches at the playhead | A three-second countdown and purple recorded clip are documented, with Cancel, Retake, Review, and Accept | The three-second countdown is documented for iOS, not confirmed for Mac |
| Speed and pitch | Pitch changes with speed by default; "Preserve Pitch" is opt-in | Pitch is preserved by default; "Speed changes pitch" is opt-in | The Apple defaults are inverted across platforms |

Two requested details should not be presented as iMovie facts:

- Apple does not document logarithmic versus linear fade selection.
- Apple does not document a `-40 dBFS` voice detector, 10-90% duck range, `0.1x-20x` speed range,
  WSOLA, phase-vocoder implementation, or the requested benchmark numbers.

## 3. Web-capability audit

| Primitive | What it can provide | Constraint for Media Tools |
| --- | --- | --- |
| `AudioContext` | Real-time modular routing, scheduled playback, `AudioParam` automation, filters, convolution, analysis, and destination output | It is Window-owned in the portable architecture. It does not move the app's control path into the existing Web Worker and belongs to the currently excluded live-playback category |
| `OfflineAudioContext` | Renders a finite Web Audio graph faster or slower than real time depending on graph and hardware | It is not available in the existing worker scope. Using it would introduce a second, main-page-controlled export engine and does not guarantee `>10x` real time |
| `AudioWorklet` | Custom DSP on the browser's audio-rendering thread with low-latency intent | It is not a general Web Worker, requires a secure context, processes browser-sized render quanta, and gives no hard end-to-end latency guarantee |
| `AudioParam` and built-in nodes | Sample-scheduled gain envelopes, biquad filters, dynamics compression, convolution, and analysis | Useful for an experimental live graph, but not required for deterministic offline PCM transforms |
| `getUserMedia` | User-approved microphone streams in secure contexts | Adds a runtime permission prompt, capture lifecycle, device-loss cases, store disclosure, and privacy-contract change; browser/extension permission behavior needs a production-artifact spike |
| `MediaRecorder` | Encodes a `MediaStream` using a browser-supported MIME type | Formats must be probed with `isTypeSupported`; it does not guarantee WAV, MP3, AAC/M4A, or FLAC parity across Chrome and Firefox |
| `OffscreenCanvas` | Worker-owned 2D, WebGL, or WebGL2 drawing and transferable image results | Feasible only after capability detection and real extension tests. It does not guarantee sub-millisecond rendering or 60 FPS |
| WebGL | GPU-accelerated waveform geometry and compositing | It adds context-loss, accessibility-overlay, precision, and test complexity. Canvas 2D plus precomputed level-of-detail peaks remains the cheaper first benchmark |
| WebCodecs | Low-level decode/encode with explicit configuration probing | Codec availability varies by browser and OS. Every exact decoder/encoder configuration must be probed before work starts |
| WebAssembly | Packaged DSP or codec implementations in a worker | Executable assets must ship with the extension. CSP, bundle size, memory, cancellation, notices, source obligations, and exact build flags become release gates |
| `SharedArrayBuffer` | Shared PCM or render-state buffers with atomics | Availability depends on cross-origin isolation. The hosted GitHub Pages target cannot be assumed to provide the required headers, and Firefox extension constraints already gate multithreaded WASM |

No cited web standard guarantees:

- pointer-to-audio or audio-to-visual latency below 20 ms;
- a locked 60 FPS timeline;
- sub-millisecond waveform rendering;
- export faster than 10 times real time.

Those values can only be benchmark thresholds on declared hardware, browsers, operating systems,
sample rates, file sizes, and output formats. They must not appear as shipped capabilities before the
matrix passes.

## 4. Feature and feasibility matrix

Status vocabulary:

- **Conflict:** contradicts a binding product boundary and requires a product decision.
- **Candidate:** technically compatible only as a bounded durable-export transform after product
  specification and tests are approved.
- **Roadmap gate:** already belongs to a later phase and cannot be pulled forward without clearing its
  existing release gates.

| Requested target | Web-native approach | Status | Required decision or gate |
| --- | --- | --- | --- |
| Audio Skimmer Engine | Window `AudioContext`, short scheduled source regions, cursor coalescing, and a small look-ahead queue | **Conflict** | Reverse the live-playback non-goal; define gesture/autoplay UX and measured p95 latency |
| Inline Gain Bar, 0-500% | Store non-destructive gain metadata; apply a worker-side float gain before encode; predict peaks before PCM clamp | **Candidate** | Specify clipping policy and whether `500%` means exactly `20 log10(5) = 13.98 dB` |
| Visual Fade Anchors | Store fade boundaries as integer frames; apply explicit linear or equal-power envelopes in the worker | **Candidate** | Choose curves and accessible keyboard controls; do not label them as Apple-documented curves |
| Stem Anchoring System | Project graph with stable clip IDs, parent attachment, integer source/timeline frames, and deterministic move rules | **Conflict** | Approve a project editor and define track, decoded-window, storage, and output limits |
| Extract Track Action | Worker-side demux/stream copy or transcode with WebCodecs + mediabunny | **Roadmap gate** | Complete the Phase 2 codec/container/OS matrix, metadata policy, and bounded sink |
| Auto-Ducking Processor | Offline worker computes dialogue energy envelope, smooths attack/release, applies gain envelope to background PCM | **Candidate** | Specify threshold, channel linking, attack, release, look-ahead, reduction, false-positive fixtures, and whether Mac- or iOS-like UX is intended |
| EQ and De-Noiser | Offline worker biquads plus a separately evaluated gate/noise-reduction algorithm | **Candidate** | Amend product spec for durable export only; define presets, quality metrics, and adversarial inputs |
| Live VO Capture | `getUserMedia` to `MediaStreamAudioSourceNode`, metering worklet, and a probed recorder/PCM capture path | **Conflict** | Approve a new capture product scope, permission/disclosure changes, and cross-browser device tests |
| Time-Stretch and WSOLA, 0.1x-20x | Bounded offline PCM time-stretch in a worker; exact engine remains unselected | **Roadmap gate** | Phase 3 engine/license/quality benchmark; reject factors whose projected PCM exceeds 256 MiB |
| DSP Effect Matrix | Offline worker filters/delay/pitch transform; packaged impulse responses for convolution if approved | **Candidate** | Approve product scope, asset provenance, wet/dry semantics, peak policy, and quality fixtures |
| Off-thread zoomable waveform | Peak-pyramid analysis plus optional worker `OffscreenCanvas`; UI overlays remain DOM-accessible | **Candidate** | Benchmark Canvas 2D first, then gate OffscreenCanvas/WebGL by real Chrome and Firefox artifacts |
| WAV/MP3/AAC/FLAC export | Existing worker for WAV/MP3; capability-probed encoder plus container writer for later formats | **Roadmap gate** | AAC/M4A needs Phase 2 and legal review; no FLAC engine or roadmap approval exists |

### Memory consequence of the requested speed range

Slowing a fully decoded input to `0.1x` can require approximately ten times as many PCM frames. A
source already near the 256 MiB PCM ceiling therefore cannot be transformed at that factor in memory.
The speed range must be dynamically bounded by overflow-safe projected output size, not merely
clamped to a UI minimum and maximum.

The same issue applies to concurrent stems. The project must count source bytes, retained decoded
windows, transformed buffers, queued render blocks, and output bytes together. A warning is
insufficient; an over-limit project or operation must be rejected before allocation.

## 5. Selected architecture

### 5.1 Production path and selected direction

No new runtime dependency is selected.

```text
Shared React app page (extension tab or hosted app)
  | file selection, edit metadata, progress, cancel, status
  | postMessage(File or transferred PCM)
  v
Dedicated media Web Worker
  | validate metadata and projected allocations
  | MP3: WebCodecs AudioDecoder / WAV: direct PCM parser
  | pure PCM transform chain
  | WAV: native encoder / MP3: bundled lamejs
  | progress or complete result; release on every terminal path
  v
App page
  | create Blob only from a complete result
  | user-initiated download
```

The diagram is the current Audio Cutter/Convert path and the selected destination for all offline
transforms. Join normalization/concatenation and Change Speed resampling still execute on the app
page before their worker encode. Section 10 makes that migration the prerequisite for additional DSP.

For future offline gain/fade work, the transform chain would be:

```text
decode -> select region -> gain envelope -> peak scan -> encode -> complete result
```

Boundaries should be stored as integer source frames rather than floating-point seconds. UI seconds
are derived values. Resampling must establish an explicit output sample rate and map every clip
boundary to that timeline without cumulative floating-point drift.

### 5.2 Waveform rendering candidate

Do not start with WebGL. First benchmark a level-of-detail peak pyramid generated in a worker:

```text
Media worker: decode -> min/max peak levels -> transferable typed arrays
Render worker (only if justified): OffscreenCanvas 2D -> visible canvas
App page: zoom/scroll state + DOM/ARIA handles, playhead, selection, and inspector
```

Separating media and render workers prevents a canvas workload from delaying decode cancellation or
encode progress. The current main-thread Canvas 2D renderer remains the fallback until
OffscreenCanvas is proven in both production artifacts. At `1 ms/px`, the renderer reads an
appropriate peak level; it must not scan raw PCM for every paint.

### 5.3 Web Audio graph for a product-direction spike only

The following graph answers the topology question but is **not selected for production**:

```text
Window AudioContext
  clip source
    -> per-clip GainNode (gain line + scheduled fade envelope)
    -> optional BiquadFilterNode chain
    -> optional bundled AudioWorkletNode (gate / denoise / pitch experiment)
    -> clip dry bus ----------------------------+
    -> effect send -> DelayNode/ConvolverNode --+-> track GainNode
                                                   |
  dialogue track -> sidechain meter worklet -------+-> ducking control messages
                                                   |
  background track GainNode <----------------------+
                                                   v
                                         master GainNode
                                                   |
                                      DynamicsCompressorNode
                                                   |
                                         AnalyserNode -> meter
                                                   |
                                      AudioContext.destination
```

The sidechain input cannot be expressed by `DynamicsCompressorNode` alone; a custom detector/control
path is required. Message-port control can add jitter, so an actual implementation would need a
bounded worklet design and measured attack/release behavior.

A voiceover branch would be:

```text
getUserMedia -> MediaStreamAudioSourceNode -> meter/capture worklet
                                             |-> monitor gain -> destination (optional)
                                             |-> bounded PCM chunks -> recording worker -> encoder
```

Monitoring must default off to avoid acoustic feedback. Device changes, permission denial, muted or
ended tracks, tab close, extension update, and cancellation all need explicit terminal cleanup.

### 5.4 Why `OfflineAudioContext` is not the export engine

The requested single-pass `OfflineAudioContext` design is not selected because it is not available in
the existing media worker, would split transform ownership across two engines, and would return a
fully rendered in-memory buffer before the current encoders can finish. Pure worker PCM transforms
reuse the shipped validation, progress, cancellation, and encode path and are deterministic in
Vitest. A future benchmark may compare an offline Web Audio graph, but it cannot replace the worker
path merely because the API is named "offline."

## 6. Library choices

| Layer | Decision | Reason |
| --- | --- | --- |
| App and packaging | Keep WXT `0.20.27`, React/React DOM `19.2.7`, strict TypeScript `5.9.3`, and Tailwind `4.3.2` | One shared app and established design/test conventions |
| Current audio codec path | Keep WebCodecs MP3 decode, direct WAV parsing, native WAV encode, and `lamejs` `1.2.1` MP3 encode | Already bundled, bounded, tested, and worker-owned |
| Gain/fade/duck/EQ core | Prefer dependency-free typed-array DSP for the first bounded offline slice | Smallest attack surface and easiest deterministic bounds testing |
| Waveform | Keep Canvas 2D; evaluate built-in OffscreenCanvas before WebGL | No dependency is needed; complexity must be justified by profiles |
| Video containers | Keep mediabunny as an uninstalled Phase 2 candidate | It still needs an exact pin, MPL review, bundle measurement, codec matrix, and production tests |
| Preserve-pitch time stretch | Keep SoundTouchJS as an uninstalled Phase 3 candidate, not a selection | The exact package/version, current license, offline-worker API, quality, and memory behavior need review |
| Rubber Band | Do not select | Upstream uses GPL-2.0-or-later or a commercial license; WASM packaging would add legal, CSP, size, and memory gates |
| ffmpeg.wasm | Do not select for the cross-browser core | Its core is large; multithreading adds isolation/nested-worker constraints; exact FFmpeg flags and linked licenses require audit |
| AAC/M4A and FLAC | No encoder selected | Browser encoding is capability-dependent; AAC adds patent/licensing review; FLAC is not approved roadmap scope |

Any adopted dependency must be pinned exactly in `package.json` and `package-lock.json`, recorded in
`docs/THIRD-PARTY.md`, bundled with no remote fetch, checked in both output artifacts, and covered by
source/relink notices where applicable.

## 7. Baseline UI strategy

The baseline remains the shared React function-component app and shipped Tailwind design system:

- Keep one job per view, a drop-first flow, visible progress and Cancel, and a single completed
  download.
- Keep media and edit state in the durable app page; keep heavy transforms and analysis in workers.
- Preserve DOM controls for keyboard access and announcements even when pixels are canvas-rendered.
- Use the current emerald/amber/red token semantics. The requested blue/green/purple track palette
  conflicts with `docs/DESIGN.md`; adopting it requires a design-system decision and contrast tests.
- Do not reproduce proprietary Apple assets or trade dress. Behavioral research can inform clear
  interactions while Media Tools retains its own visual identity.

A multitab inspector, magnetic timeline, and persistent project graph are not a small redesign of the
current one-job workspace. They require a product specification covering project creation, unsaved
changes, recovery, keyboard editing, screen-reader alternatives to the canvas, and storage cleanup.

## 8. Performance and correctness gates

The requested numbers become candidate benchmark thresholds, not claims:

| Target | Measurement required before acceptance |
| --- | --- |
| `<20 ms` skimming response | Define pointer-event-to-audible-sample and pointer-event-to-indicator metrics; record p50/p95/p99 with output device, `baseLatency`, and `outputLatency` where available |
| Locked 60 FPS | Record frame-time distribution and dropped frames during zoom, pan, drag, and concurrent processing on the declared browser/OS matrix |
| `1 ms/px` waveform zoom | Verify correct level-of-detail selection, bounded peak memory, no raw full-buffer scan per frame, and accessible controls at maximum zoom |
| Sample-accurate edits | Represent boundaries as integer frames; golden-test trim, split, fade, gain, resample mapping, and export within one output frame |
| `>10x` real-time export | Measure each input/output codec and transform separately on declared baseline hardware; include decode, DSP, encode, and output assembly |
| Responsive cancel | Set a numeric p95 threshold; verify worker stop, memory release, canvas/AudioContext cleanup, partial-state removal, and no download |

Run the matrix on real production artifacts. A successful WXT build is not runtime support. No gate
passes from one browser, one operating system, or one codec configuration.

## 9. Required decisions before implementation

1. **Product scope:** decide whether Media Tools remains a durable local-file transformer or adds a
   real-time editor and capture product. Update `VISION.md` and `PRODUCT-SPEC.md` before code if the
   boundary changes.
2. **Permission contract:** if voiceover proceeds, define runtime permission copy, denial recovery,
   store disclosures, hosted-page Permissions Policy, and whether any manifest change is required in
   either built target.
3. **Project bounds:** define hard limits for track count, total source bytes, decoded windows, sample
   rates, duration, output expansion, and temporary storage.
4. **Storage and output:** choose memory versus OPFS-backed project/output behavior, including Firefox
   quota, crash recovery, cancellation cleanup, and classic RIFF limits.
5. **Codec and legal scope:** decide whether AAC/M4A or FLAC is funded, then approve exact encoders,
   containers, patent review, notices, and artifact-specific builds.
6. **Design direction:** either retain the shipped editor language or approve a documented timeline
   token/accessibility system; do not silently mix palettes.

## 10. Staged research and implementation plan

No stage authorizes the next one automatically.

1. **Direct behavior study:** exercise current iMovie on one declared Mac and one declared
   iPhone/iPad version. Record only original observations and reconcile the documentation gaps,
   especially iOS EQ/noise reduction, clipping colors, and Mac countdown behavior.
2. **Worker-hardening slice:** move the existing bounded Join and Change Speed transforms off the app
   page before adding more DSP.
3. **Offline envelope slice:** after product approval, add gain plus fade metadata to Audio Cutter,
   process it in the worker, and test frame boundaries, peak prediction, caps, cancellation, and WAV/
   MP3 output. Add no dependency.
4. **Waveform spike:** benchmark peak-pyramid generation and Canvas 2D. Evaluate OffscreenCanvas only
   if profiling shows a missed frame-time gate.
5. **Real-time feasibility branch:** only after the non-goal decision, prototype the Web Audio graph
   outside the shipping path. Measure latency, autoplay recovery, worklet loading under production
   CSP, device changes, CPU, and cleanup in both extension artifacts and the hosted app.
6. **Advanced DSP spikes:** compare a pure worker implementation and the exact pinned SoundTouchJS
   candidate for preserve-pitch output. Separately evaluate offline ducking/EQ quality against labeled
   fixtures. Do not combine these into one release.
7. **Video and extra formats:** follow the existing Phase 2 compatibility, bounded-output, metadata,
   licensing, and playback gates. Do not use the audio-editor request to bypass them.

## Acceptance criteria for this Phase 1 audit

- All ten requested iMovie feature families are mapped to a web approach and repository status.
- Documented Apple behavior is distinguished from requested thresholds and inferred algorithms.
- The selected production path, a non-shipping Web Audio topology, waveform strategy, and UI baseline
  are explicit.
- Current, candidate, and rejected libraries are distinguished; this audit adds no dependency.
- Product, permissions, privacy, worker, memory, codec, design, and cross-browser conflicts are
  recorded as decisions or gates rather than hidden assumptions.
- Performance numbers are treated as measurable thresholds, not browser guarantees or shipped claims.
- The next implementable slice is bounded, offline, worker-owned, and preserves no-partial-download
  behavior.

## Sources

All external sources were accessed 2026-07-22.

### Apple iMovie User Guides

- [Play or skim video in iMovie on Mac](https://support.apple.com/guide/imovie/play-or-skim-video-movfa0af02f6/mac)
- [Change audio volume in iMovie on Mac](https://support.apple.com/guide/imovie/change-audio-volume-mov3b5ded23e/mac)
- [Fade audio in iMovie on Mac](https://support.apple.com/guide/imovie/fade-audio-move7a2dcdc6/mac)
- [Correct and enhance audio in iMovie on Mac](https://support.apple.com/guide/imovie/correct-and-enhance-audio-mov86277afbd/mac)
- [Add audio effects in iMovie on Mac](https://support.apple.com/guide/imovie/add-audio-effects-mov84788882d/mac)
- [Record a voiceover in iMovie on Mac](https://support.apple.com/guide/imovie/record-a-voiceover-mov44e3a4427/mac)
- [Add music and sound clips in iMovie on Mac](https://support.apple.com/guide/imovie/add-music-and-sound-clips-mov91a895a64/mac)
- [Add audio from a video clip in iMovie on Mac](https://support.apple.com/guide/imovie/add-audio-from-a-video-clip-mov267936bb2/mac)
- [Change clip speed in iMovie on Mac](https://support.apple.com/guide/imovie/change-clip-speed-mov6c442b2eb/mac)
- [Move and split clips in iMovie on Mac](https://support.apple.com/guide/imovie/move-and-split-clips-mov16b2ea79a/mac)
- [Adjust audio in iMovie on iPhone](https://support.apple.com/guide/imovie-iphone/adjust-audio-knabf616edbf/ios)
- [Record audio in iMovie on iPhone](https://support.apple.com/guide/imovie-iphone/record-audio-kna9d75972dd/ios)
- [Edit audio clips in iMovie on iPhone](https://support.apple.com/guide/imovie-iphone/edit-audio-clips-knaddae6c843/ios)
- [Adjust video speed in iMovie on iPhone](https://support.apple.com/guide/imovie-iphone/adjust-video-speed-kna47ca84b07/ios)

### Web platform and candidate engines

- [Web Audio API specification](https://www.w3.org/TR/webaudio/)
- [MDN: AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [MDN: MediaDevices.getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MDN: MediaRecorder.isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- [MDN: OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [MDN: AudioEncoder.isConfigSupported](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder/isConfigSupported_static)
- [MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [MDN: Window.crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated)
- [Rubber Band licensing](https://breakfastquay.com/rubberband/license.html)
- [ffmpeg.wasm overview](https://ffmpegwasm.netlify.app/docs/overview/)
- [Mediabunny introduction](https://mediabunny.dev/guide/introduction)
- [SoundTouchJS upstream repository](https://github.com/cutterbl/SoundTouchJS)

## Related repository documents

- [`docs/VISION.md`](../VISION.md)
- [`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md)
- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`docs/DESIGN.md`](../DESIGN.md)
- [`docs/ROADMAP.md`](../ROADMAP.md)
- [`docs/PEER-REVIEW.md`](../PEER-REVIEW.md)
- [`docs/THIRD-PARTY.md`](../THIRD-PARTY.md)
- [`docs/CAPABILITY-CONTRACT.md`](../CAPABILITY-CONTRACT.md)
