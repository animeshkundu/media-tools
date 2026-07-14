# Media Tools WebExtension

A cross-browser MV3 WebExtension built with WXT, React, strict TypeScript, and Tailwind for privacy-first, offline, client-side audio and video tools.

## Docs map

The `docs/` suite is primary. Read the relevant documents before changing product behavior or architecture.

- [`docs/VISION.md`](docs/VISION.md) - product direction, positioning, boundaries, and non-goals.
- [`docs/PRODUCT-SPEC.md`](docs/PRODUCT-SPEC.md) - personas, tool requirements, acceptance criteria, release gates, and tiers.
- [`docs/DESIGN.md`](docs/DESIGN.md) - shipped design tokens, components, states, and flows. Review the design mocks under [`mocks/`](mocks/) too.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - system surfaces, engine choices, worker contracts, module boundaries, and testing strategy.
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) - AMO and Chrome Web Store packaging, source submission, secrets, and release process.
- [`docs/PEER-REVIEW.md`](docs/PEER-REVIEW.md) - cross-lab critic findings, severity, and accepted dispositions. Its FIX-NOW, SPEC, and GATE items are binding.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - phase order and current delivery status.
- [`docs/research/`](docs/research/) - original market and competitor research. Use it as background; the `docs/` suite is authoritative for current decisions.

## Architecture - do not violate

- The durable host is the app page in [`entrypoints/app/`](entrypoints/app/), opened in a tab. It owns React state, worker supervision, progress, cancellation, and downloads.
- The MV3 background service worker or Firefox event page is glue only. It may open the app page or handle lightweight extension events. Never run media decode, encode, mux, or other long work there.
- Heavy media work belongs in a Web Worker with determinate progress where available, explicit cancellation, and cleanup on success, cancellation, crash, and failure. Never block the UI thread.
- Current reality: [`entrypoints/app/App.tsx`](entrypoints/app/App.tsx) decodes audio with `AudioContext` on the main thread, then [`lib/core/worker.ts`](lib/core/worker.ts) runs WAV or MP3 cutting and encoding in [`lib/tools/audio-cutter/encode.worker.ts`](lib/tools/audio-cutter/encode.worker.ts). Do not describe decode as worker-owned until it actually is.
- Processing is local and requires no upload. Bundle executable code and required WASM with the extension. The extension CSP may allow `'wasm-unsafe-eval'` for bundled WASM, but never remote code.
- Keep required permissions minimal. Local file input and Blob downloads require no host permissions. Browser-specific APIs are optional, feature-detected enhancements, never cross-browser dependencies.
- Maintain one WXT codebase for Chrome and Firefox. Use WXT's `browser.*` surface and capability detection instead of browser forks in shared behavior.

## Guardrails and release gates

These requirements are binding even where the current seed has known debt. Do not present an unmet gate as shipped protection. The current debt includes whole-file main-thread audio decode, drifting dependency ranges, incomplete no-egress CSP, and no declared browser x OS matrix.

### Engines and browser behavior

- The required Phase 2 cross-browser video engine is **WebCodecs + mediabunny**. No video engine ships yet. Prefer this engine for paths that must work on both Chrome and Firefox. Probe the exact decoder and encoder configuration before work starts, then disable unsupported choices with a useful explanation.
- `AudioContext` and `OfflineAudioContext` are not available in Web Worker scope. Decode and encode audio with WebCodecs (`AudioDecoder` and `AudioEncoder`), or decode on the main thread and transfer PCM to the worker. Never assume Web Audio exists in a worker.
- `ffmpeg.wasm` is an optional Chrome-only enhancement, not the default engine and never a dependency of the cross-browser core. Bundling it adds a multi-megabyte install cost even when execution is lazy. Gate it by browser and capability, prove its CSP, cross-origin isolation, nested-worker, packaging, and store-loading behavior, and choose explicitly between accepting the bundle cost, a separate edition, or dropping the formats. Never fetch remote executable code after installation.
- `mediabunny` and `ffmpeg.wasm` are planned engines, not current dependencies. Do not claim a path ships until it exists in `package.json`, the browser artifacts, and production-artifact tests.
- Lossless video trim is keyframe-constrained. Show snapped boundaries before export. Frame-accurate trim requires re-encoding and must disclose time and generation-loss tradeoffs.

### Privacy and offline contract

- State the contract precisely as **local processing, no upload**. Distinguish what is technically prevented by manifest, permissions, CSP, and bundled assets from what is only promised by product policy.
- If a future optional non-executable model or asset is downloaded, say **local processing after an optional one-time asset download**. Scope the download to the exact host and keep local processing functional only after that disclosed download. Codecs, WASM, scripts, and other executable code remain bundled and must never be fetched after installation. Never claim "zero network, mechanically verifiable" or "proven no egress."
- The release CSP must default-deny egress, including `connect-src 'none'`, `form-action 'none'`, and `frame-src 'none'`, plus similarly narrow directives for other sinks. If one optional asset needs a network request, scope `connect-src` to its exact host, never `*`. Add a CI assertion over the production manifests that fails if an egress-capable directive reappears. The current [`wxt.config.ts`](wxt.config.ts) is not yet sufficient because it only restricts scripts and objects.
- No hidden telemetry. Any analytics must be explicit opt-in, separated from media processing, consistent with Firefox data-collection declarations, and reflected in the capability contract.

### Memory, hostile inputs, and cancellation

- Enforce an immediate input-size limit before decode or processing. Enforce aggregate limits across batches, tracks, decoded PCM, queued frames, and output. These are hard rejections, not warnings.
- Never read an entire file into memory when a stream, chunked demux, disk-backed sink, or incremental output path exists. Process frames and chunks sequentially, respect encoder backpressure, and release each one immediately. Call `VideoFrame.close()` and `AudioData.close()` on every path.
- Before large-file or video tools ship, define tested hard limits and a disk-backed output design. Account for Firefox OPFS quota and cancellation, File structured cloning, whole-output Blob duplication, PCM expansion, and RF64 for WAV output beyond RIFF's 4 GiB limit.
- Add metadata ceilings before allocation: dimensions, duration, track count, frame and sample counts, sample rate, channel layout, and declared sizes. Use overflow-safe size math and reject impossible or abusive values before allocating.
- Cancel must stop work within a numeric release threshold, release memory, remove partial disk state, and emit no partial download. Test cancellation plus tab close, discard, extension update, browser sleep, and worker crash during long jobs.

### Correctness and release gates

- Define explicit preserve, drop, normalize, and transcode policies for variable frame rate, B-frame reorder, edit lists, negative or nonzero timestamps, fragmented MP4, encoder delay, A/V sync, rotation, pixel aspect ratio, color range, HDR, multiple audio tracks, subtitles, chapters, cover art, and stream-copy container compatibility.
- Pin exact versions for every shipped dependency, codec, and media engine. Do not use `latest`, `^`, or other drifting ranges for shipped dependencies. [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md) must record each pinned version, SPDX license, purpose, notices, source or relink obligations, and artifact-specific build details.
- Audit the exact ffmpeg build flags and linked libraries before publishing. Do not ship GPL cores accidentally. Complete patent and licensing review for AAC, AVC, HEVC, and other gated codecs, and keep reproducible source packages for AMO review.
- A malformed-media fuzz and adversarial corpus is a release gate, not optional coverage. Include malformed and truncated containers, corrupt `moov` boxes and atoms, mismatched codec metadata, huge and zero-dimension frames, unusual sample rates and channel layouts, extreme track counts and durations, timestamp edge cases, and encoder backpressure.
- Turn performance gates into numeric pass or fail criteria: peak memory, maximum input, cancellation latency, wall-clock thresholds per browser, baseline hardware, output quality, A/V sync tolerance, and playback or seek behavior. Recording a number without a threshold is not a gate.
- Before Phase 2 ships, run a compatibility spike and publish a tested browser x OS x input container x codec x output contract. Declare minimum supported Chrome and Firefox versions and desktop OS versions for Windows, macOS, and Linux. Firefox 130 WebCodecs availability is evidence, not sufficient support proof.
- Run production-artifact integration tests on the declared Chrome and Firefox matrix. Cover WebCodecs support, worker loading, progress, cancellation, offline operation, CSP enforcement, output playback, and Chrome-only `ffmpeg.wasm` gating. Cross-browser support is a runtime contract, not a successful pair of builds.
- Keep Phase 2 frozen until representative MP4/H.264/AAC and WebM workflows demonstrate actual encoder availability, measured acceleration, bounded memory, and honest fallback behavior on the declared matrix. Validate demand, file types, failure rates, repeat use, and paid intent with the audio wedge before funding heavy video work.

## Commands

Use only scripts defined in [`package.json`](package.json).

- `npm run dev` - WXT development for Chrome.
- `npm run dev:firefox` - WXT development for Firefox.
- `npm run build` - production Chrome build.
- `npm run build:firefox` - production Firefox build.
- `npm run compile` - strict TypeScript typecheck with no emit.
- `npm test` - run the Vitest suite once.
- `npm run lint` - run ESLint across the repository.
- `npm run check` - run compile, lint, and test in that order.

## Before declaring done

- `npm run check` must pass.
- Build the relevant production artifacts, load the built extension, and drive the real tool with a real media file. Verify the downloaded output parses and plays.
- Test Chrome and Firefox wherever the behavior is cross-browser. Exercise unsupported-capability UI, progress, cancellation, offline operation, and failure cleanup when relevant.
- Tests and typechecks alone do not prove the workflow or UX.

## Conventions

- Keep TypeScript strict. Use React function components and hooks.
- Use Tailwind and the shipped theme in [`assets/tailwind.css`](assets/tailwind.css) and [`docs/DESIGN.md`](docs/DESIGN.md). Do not add CSS modules.
- Route heavy work through the worker harness. Keep the app page responsive and never move long work into the background.
- A new tool lives in `lib/tools/<name>/` with its worker and UI, gets a tab or route in [`entrypoints/app/App.tsx`](entrypoints/app/App.tsx), and includes a Vitest test.
- Keep shared infrastructure tool-agnostic under [`lib/core/`](lib/core/). Do not make one tool reach into another tool's internals.
- Do not add attribution to commits, pull requests, code, comments, or documentation.

## Roadmap

Follow [`docs/ROADMAP.md`](docs/ROADMAP.md) and build in phase order. **Audio Cutter** in [`lib/tools/audio-cutter/`](lib/tools/audio-cutter/) is the shipped flagship and seed; extend its drop-first, progress, cancellation, download, and offline UX rather than bypassing it.
