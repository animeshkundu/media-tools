# Media Tools Product Specification

*Scope: product requirements, release tiers, acceptance criteria, quality gates, success measures, and monetization for the Chrome and Firefox extension.*

Related planning: [VISION](./VISION.md) · [DESIGN](./DESIGN.md) · [ARCHITECTURE](./ARCHITECTURE.md)

## Personas + jobs-to-be-done

### The Trimmer

The Trimmer wants a ringtone, a short clip, or the silence removed from an MP3. Ads and login walls have made a small job take too long. **JTBD:** “Cut this clip and download it, right now, without an account.”

### The Converter

The Converter has a `.m4a`, `.mov`, or `.webm` file that a device, editor, or upload form will not accept. Upload sites add waiting, caps, and watermarks to a routine compatibility task. **JTBD:** “Convert this file without it leaving my laptop.”

### The Privacy-Conscious Creator/Pro

This person handles client work, legal or medical media, or unreleased material. Sending the source to an unknown server is not acceptable, even if the site promises later deletion. **JTBD:** “Process this on my machine, provably offline.”

### The Firefox User

The Firefox User has almost no credible local-file media tools to choose from today. They want the same polished workflow available on Chrome without switching browsers or opening an upload site. **JTBD:** “Give me a real local media tool for Firefox.”

## Tool set by tier

Delivery phase and paid entitlement are separate decisions. Several Phase 2 tools remain in the free core.

| Tool | Tier/Phase | Engine cost | One-line rationale |
| --- | --- | --- | --- |
| Audio cut / trim | MVP / Phase 1, flagship | CHEAP | The shipped seed addresses the strongest demand, gap, and implementation fit. |
| Audio join / merge | MVP / Phase 1 | CHEAP | It reuses decoded audio buffers and fills an open Firefox job. |
| Audio format convert to WAV / MP3 | MVP / Phase 1 | CHEAP | Conversion has proven demand, with native PCM WAV and bundled `lamejs` for MP3. |
| Change audio speed, coupled speed and pitch | MVP / Phase 1 | CHEAP | Resampling adds a useful export job on the same audio engine. |
| Adjust volume, fades, and peak normalization | MVP / Phase 1 | CHEAP | Direct PCM gain envelopes add a durable export job without becoming a live-playback modifier. |
| Unified Audio Studio | Audio workspace / Phase 1.5 | MEDIUM | One import-once timeline combines trim, arrangement, speed, gain, fades, EQ, voice-over, preview, and WAV/MP3 mixdown without weakening local-processing limits. |
| Extract audio from video | Fast-follow / Phase 2 | MEDIUM | Mediabunny can demux or transcode the audio without an upload. |
| Mute / remove audio from video | Fast-follow / Phase 2 | MEDIUM | Lossless track removal fills a category gap with no dedicated extension competitor. |
| Video cut / trim | Fast-follow / Phase 2 | MEDIUM | Firefox is unserved, and users need both fast keyframe cuts and exact cuts. |
| Audio convert to M4A/AAC, OGG/Opus | Fast-follow / Phase 2 | MEDIUM | These targets round out common device and publishing compatibility. |
| Video compressor | Fast-follow / Phase 2, marquee, performance-gated | MEDIUM | It has a strong upload-privacy wedge, but ships only after both browsers pass the benchmark gates. |
| Change audio pitch / time-stretch with export | Pro / later / Phase 3 | HEAVY | Independent pitch and duration control fills the playback-only export gap. |
| Video to GIF | Pro / later / Phase 3 | HEAVY | The job is unserved on Firefox and benefits from paid quality controls. |
| Exotic video convert, AVI/FLV/HEVC | Pro / later / Phase 3 | HEAVY | It serves the long tail through lazy ffmpeg.wasm without burdening the base install. |

### Explicitly skipped

| Tool | Reason |
| --- | --- |
| Tab or stream audio capture | Firefox support is limited, broader access weakens the permission story, and capture is not a local-file job. |
| Real-time equalizer or volume boost for tabs and streams | Both stores already serve it, and it changes other playback rather than exporting a transformed file. Project-local Audio Studio preview and offline export remain in scope. |
| YouTube or stream downloader | It is legally fraught, saturated by tools such as VideoDownloadHelper at 1.8 million users, and belongs to a different product. |

## Per-tool functional requirements + acceptance criteria

The requirements below define target behavior. Shared privacy, offline, performance, cancellation, capability detection, and accessibility requirements apply to every tool.

### Audio cut / trim

**Functional requirements**

- Show a waveform with in and out handles that select one continuous region by pointer or keyboard.
- Export the selection as WAV or MP3, with the chosen range and format visible before processing starts.
- Encode outside the UI thread, report progress, and offer explicit cancellation without creating a partial download.
- Preserve the shipped drop-first workflow, with no account or upload step, while enforcing the published input and memory safety limits.

**Acceptance criteria**

- Given a decodable audio fixture, when a region is selected and exported, then the output contains exactly that selected span within one audio frame.
- Given the network is disabled before the file is opened, when the user completes a WAV or MP3 cut, then the output downloads and plays successfully.
- Given an encode is in progress, when the user cancels, then processing stops, transferred buffers are released, and no partial download is created.
- Given focus is on either trim handle, when the user presses the documented arrow keys, then the boundary moves, the selected duration updates, and the new value is announced.

### Audio join / merge

**Functional requirements**

- Accept multiple decodable audio files and show their current output order.
- Let the user reorder or remove inputs before export.
- Normalize sample rate and channel layout as needed, then concatenate without an unintended gap.
- Export the joined result as WAV or MP3 with progress and cancellation.

**Acceptance criteria**

- Given two known fixtures, when they are exported in A then B order, then the decoded output contains A followed by B and its duration equals the normalized source durations within one audio frame.
- Given the inputs are reordered before export, when the job completes, then the output follows the visible new order.
- Given inputs with different supported sample rates, when they are joined, then one playable output is produced without a boundary crash or silent gap introduced by the tool.
- Given the network is disabled or the user cancels mid-run, then no network request is made and no partial download remains.

### Audio format convert to WAV / MP3

**Functional requirements**

- Decode one browser-supported audio input and offer WAV and MP3 as explicit output choices.
- Preserve duration and channel layout where the target supports them, and show the selected output settings before export.
- Encode WAV locally and use the bundled `lamejs` worker path for MP3.
- Reject an undecodable input before export with a useful, format-focused message.

**Acceptance criteria**

- Given each supported audio fixture, when WAV is selected, then the result is valid PCM WAV and its decoded duration matches the source within one audio frame.
- Given each supported audio fixture, when MP3 is selected, then the result is a playable MP3 with the requested visible settings.
- Given an unsupported or corrupt input, when decoding is attempted, then the tool reports the problem and does not offer a misleading successful download.
- Given the network is disabled or encoding is cancelled, then conversion does not contact a server and no partial file is downloaded.

### Change audio speed, coupled speed and pitch

**Functional requirements**

- Let the user choose a playback-speed multiplier for the local file and preview the resulting duration.
- Resample the audio so speed and pitch change together, and label that coupling plainly.
- Export the transformed audio as WAV or MP3 with progress and cancellation.

**Acceptance criteria**

- Given a known input and selected multiplier, when export completes, then output duration equals input duration divided by that multiplier within one audio frame.
- Given a tonal fixture, when speed is changed through resampling, then measured pitch changes by the same ratio rather than being independently preserved.
- Given the user needs independent pitch or duration control, then the UI identifies the Phase 3 pitch and time-stretch tool instead of implying this tool can do it.
- Given the network is disabled, when the speed export completes, then a playable output is downloaded without a processing request. When the user cancels instead, processing stops, buffers are released, and no download is created.

### Adjust volume, fades, and peak normalization

**Functional requirements**

- Let the user set export gain from 0% through 500%, with the equivalent decibel value visible.
- Offer sample-aligned fade-in and fade-out durations with linear-amplitude and logarithmic -60 dB ramp curves.
- Offer one-click peak normalization against the final post-fade signal with a -1 dBFS target while preserving relative dynamics.
- Show conservative source and output peak estimates, using amber from -2 dBFS through 0 dBFS and red above 0 dBFS, before export starts.
- Decode, transform, and encode WAV or MP3 entirely in the cancellable worker without allocating a second full-size PCM output.

**Acceptance criteria**

- Given a constant PCM fixture and linear fades, when the transform runs, then the first and last selected fade samples are silent, the unity endpoints are sample-aligned, and the output duration is unchanged.
- Given a non-silent fixture and normalization enabled, when export completes, then the post-fade output peak is -1 dBFS within one 16-bit PCM quantization step and sample ratios are preserved.
- Given manual gain projects a peak above 0 dBFS, when settings change, then the UI identifies potential clipping before export without silently clamping the floating-point transform.
- Given the network is disabled or export is cancelled, then the worker makes no processing request, emits no partial download, and leaves the source file unchanged.

### Unified Audio Studio

**Functional requirements**

- Replace separate transform tabs with one responsive workspace containing a Media Library, context-aware Viewer/Inspector, Transport/Master bar, and bottom multitrack Canvas timeline. A source is imported and decoded once, then reusable across clips and operations.
- Keep `AudioAsset`, `AudioClip`, `AudioTrack`, and `TimelineState` serializable. Assets are immutable; clip moves, splits, deletes, trims, speed, gain, and fades only change project state.
- Render only the visible Canvas time and track range. Cap retained media assets and their multi-level peak pyramids at 128, coalesce pan, zoom, playhead, and drag redraws through `requestAnimationFrame`, and magnetically snap to zero, playhead, beat grid, and clip boundaries within a 10 pixel threshold.
- Preview through a main-page Web Audio graph per track and provide play, pause, seek, scrub, opt-in audio skimming, mute, solo, volume, pan, clip speed, EQ presets, and dialogue-driven music ducking.
- Render authoritative stereo WAV or MP3 in a dedicated cancellable worker with deterministic speed resampling, fades, EQ, pan, mute/solo, auto-ducking, mixdown, and encoding.
- Optionally stream bounded source files into OPFS in a worker and expose bounded random-access slices. OPFS must not raise the 64 MiB per-file, 30 minute project, mono/stereo, or 256 MiB worst-case in-flight limits.
- Generate tone, silence, and click assets locally and never fetch stock audio. Offer feature-detected voice-over only after explicit activation: request no install-time manifest permission, cap mono PCM before capture against stop-time consolidation and the complete export working set for at most five minutes, stop media tracks on every exit or late permission resolution, and add a completed take as an immutable local asset. Model-based noise suppression remains unavailable.

**Acceptance criteria**

- Given one WAV and one generated tone on different tracks, when the user exports WAV and MP3, then each complete output has the visible project duration and the expected format.
- Given a clip move, split, speed change, or pointer/keyboard boundary trim, when timeline state is serialized and restored, then immutable asset metadata is unchanged and the same clip position, source offset, duration, playback rate, gain, and fades are restored.
- Given snapping is enabled, when a boundary is moved within 10 screen pixels of a beat, playhead, zero, or another clip edge, then it lands exactly on that point; disabling snapping preserves the requested time.
- Given dialogue crosses the configured threshold, when music is present, then preview applies a smoothed live duck and worker export applies deterministic attack, reduction, and release without changing dialogue gain.
- Given a projected project would exceed 256 MiB after accounting for retained PCM, Web Audio copies, worker snapshots, stereo mix, dialogue detector, ducking envelope, and WAV output, then it is rejected before those allocations.
- Given export is cancelled or a worker fails, then no partial download is created. Given the network is disabled, import, preview, editing, OPFS caching where available, and WAV/MP3 export continue without an outbound request.
- Given OPFS is unavailable, then the tool reports bounded-memory storage honestly and remains usable inside the same hard limits; it never claims multi-gigabyte support.
- Given the editor is closed, then its arrangement is not presented as saved: the UI tells the user that projects are session-only and normal teardown clears that session's OPFS cache.
- Given Record voice-over is activated on a capable browser, then the browser prompt appears only after that action; Stop adds one bounded local clip, while Discard, denial, limit auto-stop, error, unmount, and cancellation during the pending prompt stop every microphone track.

### Extract audio from video

**Functional requirements**

- Inspect the local container and list available audio tracks when more than one exists.
- Extract by stream copy when the selected output can preserve the source codec, otherwise offer a locally supported transcode target.
- Produce an audio-only file, show progress for long operations, and support cancellation.
- Check target encoder support before starting, then disable unavailable choices with an explanation.

**Acceptance criteria**

- Given a video with one audio track, when extraction completes, then the output contains audio and no video track, and its timeline matches the source audio track.
- Given a compatible stream-copy case, when extraction completes, then the encoded audio packets are not re-encoded.
- Given a requested encoder is unavailable on the current browser and OS, when the file is inspected, then that option is disabled before a long job begins.
- Given the network is disabled or extraction is cancelled, then no request or partial download is produced.

### Mute / remove audio from video

This is a primary differentiation gap. It must remain a first-class tool, not a hidden option inside conversion.

**Functional requirements**

- Remove all audio tracks from a local video by remuxing the remaining tracks.
- Preserve the video stream without re-encoding and show that the operation is lossless for video quality.
- Keep container timing valid, report progress, and support cancellation.

**Acceptance criteria**

- Given a video with one or more audio tracks, when removal completes, then container inspection finds no audio track in the output.
- Given a supported remux fixture, when removal completes, then the video packets are preserved without a video re-encode and the result has no visual generation loss.
- Given the muted result, when it is opened in supported browsers, VLC, and QuickTime, then video playback succeeds without audio.
- Given the network is disabled or the operation is cancelled, then processing stays local and no partial download remains.

### Video cut / trim

**Functional requirements**

- Provide a timeline, preview, and in and out selection for one continuous video region.
- Offer **Lossless keyframe mode**, which remuxes without re-encoding, snaps requested boundaries to valid keyframes, and displays the actual output boundaries before export.
- Offer **Frame-accurate mode**, which re-encodes the required video and honors the selected frames, while labeling it as slower and subject to generation loss.
- Probe the required decoder and encoder configurations before export, then show progress and cancellation for either mode.

**Acceptance criteria**

- Given a selection that does not begin on a keyframe, when Lossless keyframe mode is chosen, then the UI shows the snapped boundary and the output uses that disclosed boundary without re-encoding the video stream.
- Given the same selection in Frame-accurate mode, when export completes, then the first and last output frames match the chosen range within one video frame.
- Given H.264 or another requested encoder is unavailable on the current platform, when the user configures Frame-accurate mode, then the unsupported option is disabled before processing starts.
- Given either mode runs with the network disabled, when export completes, then no processing request occurs and the output is playable. When the user cancels instead, work stops, buffers are released, and no download is created.

### Audio convert to M4A/AAC, OGG/Opus

**Functional requirements**

- Offer M4A/AAC and OGG/Opus targets for supported local audio inputs.
- Probe each exact WebCodecs encoder configuration with `isConfigSupported` before enabling export.
- Preserve source duration and channel layout where the target supports them, and expose the chosen target clearly.
- Run conversion with progress, cancellation, and actionable unsupported-platform messaging.

**Acceptance criteria**

- Given a supported AAC configuration, when M4A/AAC export completes, then the result parses as an M4A container with AAC audio and plays in the supported target players.
- Given a supported Opus configuration, when OGG/Opus export completes, then the result parses as Ogg with Opus audio and plays successfully.
- Given an unavailable AAC or Opus encoder, including a platform-dependent case on Firefox, when capabilities are checked, then the format is disabled before export with a plain explanation.
- Given the network is disabled or the user cancels, then conversion remains local and no partial download is created.

### Video compressor

This is the Phase 2 marquee tool. It does not ship until it passes every benchmark gate on both browsers.

**Functional requirements**

- Let the user choose supported output resolution and bitrate settings, with an estimated trade-off between size and quality.
- Capability-check the requested video and audio encoders before starting.
- Re-encode through WebCodecs and mediabunny, preserve audio by default, and report determinate progress where the engine exposes it.
- Support immediate cancellation, prompt buffer cleanup, and clear warnings for inputs beyond the tested envelope.

**Acceptance criteria**

- Given the standard compression fixture and a lower target bitrate, when compression completes, then the result is smaller than the fixture, has the selected resolution, and remains playable.
- Given an unsupported encoder configuration, when settings are chosen, then the unavailable path is disabled before a long run starts.
- Given compression is cancelled mid-run, then worker activity stops, large buffers are released, the UI returns to a usable state, and no partial download appears.
- Given the release candidate, when all Section 7.5 measurements are recorded on Chrome and Firefox, then it ships only if every package, input, memory, timing, cancellation, and playback gate is green.

### Change audio pitch / time-stretch with export

**Functional requirements**

- Use SoundTouchJS to offer independent pitch shifting and time-stretching for a local audio file.
- Export the transformed result, including combined settings, without turning this into a playback-only feature.
- Keep the Phase 1 coupled speed control distinct and explain which tool fits each job.

**Acceptance criteria**

- Given a tonal fixture and a pitch-only change, when export completes, then frequency analysis reflects the selected pitch change while duration remains at the selected duration setting.
- Given a time-only change, when export completes, then duration follows the selected setting without the coupled pitch shift produced by simple resampling.
- Given the network is disabled or the operation is cancelled, then the Pro entitlement remains locally valid, processing stays local, and no partial download is created.

### Video to GIF

**Functional requirements**

- Let the user select a video range and supported GIF size, frame-rate, and quality options.
- Decode locally and encode with bundled `gifenc`, with a higher-quality palette path only where it passes the release gates.
- Show progress, support cancellation, and keep heavy assets out of the base bundle.

**Acceptance criteria**

- Given a supported video fixture and selected range, when export completes, then the output is an animated GIF with the chosen dimensions and the expected frame sequence.
- Given quality settings are changed, when the same fixture is exported, then the chosen settings are reflected in the output configuration and disclosed processing cost.
- Given the network is disabled or encoding is cancelled, then no remote asset is fetched and no partial GIF is downloaded.

### Exotic video convert, AVI/FLV/HEVC

**Functional requirements**

- Handle only formats and codec configurations that have passed capability and performance tests, with Chrome-first implementation.
- Load the packaged LGPL ffmpeg.wasm core only when this tool is invoked, never in the base bundle, and avoid GPL x264/x265 cores.
- Explain browser-specific support before work begins and keep every long operation cancellable.

**Acceptance criteria**

- Given a validated exotic-format fixture, when a supported conversion is requested, then the output has the selected supported container and codec and passes the playback gate.
- Given the base extension is installed but this tool is never opened, then the roughly 30 MB ffmpeg core is absent from the base bundle and never executed.
- Given the network is disabled or the operation is cancelled, then the packaged engine needs no remote code, stops cleanly, and creates no partial download.

## Non-functional requirements

### Privacy and provable local processing

- Media bytes must never be uploaded. Processing must make no network request and must complete with the browser network disabled.
- Local-file tools use `<input type="file">` and drag and drop with no required host permissions. `downloads` and any host access, if ever needed for an optional enhancement, must be requested lazily.
- All JavaScript, workers, codecs, and WASM must be bundled with the extension. Remote code is forbidden.
- The manifest must continue to declare no required data collection on Firefox. Users must be able to inspect the manifest, observe minimal permissions, disconnect the network, and complete an export.
- No hidden telemetry is permitted. Explicit opt-in measurement is separated from processing and is never required to use free or Pro tools.

### Offline behavior

- The free core must work after installation with the network fully disabled, including file selection, editing, processing, cancellation, and download.
- Phase 3 engines may be lazy in execution and browser-specific packaging, but they must load from packaged extension assets rather than a CDN. The roughly 30 MB ffmpeg core must never enter the base bundle.
- An imported Pro license must validate and remain usable offline. External checkout is outside the processing flow and is never required again for normal offline use.

### Performance and release gates

Every heavy tool, and the Phase 2 video compressor in particular, must record and pass the Section 7.5 benchmark set on Chrome and Firefox before release:

1. **Installed package size:** record the browser-specific package and confirm the heavy engine is excluded from the base install.
2. **Maximum tested input:** record the largest passing fixture and its properties. The research reference case is a 1080p, 10-minute file at about 1 to 2 GB, not an untested product promise.
3. **Peak memory:** measure the high-water mark, stream through mediabunny where possible, and release large buffers promptly.
4. **Wall-clock time:** record both browsers. For compression, target about 0.5 to 1 times real-time or better on the Chrome hardware path, and report the Firefox result separately.
5. **Cancellation:** cancel at the midpoint, confirm work stops, confirm memory is reclaimed, and confirm no partial download is emitted.
6. **Output playback:** verify the full output and seek behavior in VLC, QuickTime, and supported browsers.

A tool is not “green” when only one browser passes. Unsupported encoders must be detected before a long run, not discovered after it.

The shipped audio pipeline delegates WAV and MP3 decode to the worker created by `lib/core/worker.ts`. MP3 uses WebCodecs `AudioDecoder`, WAV uses direct PCM parsing, and bundled `lamejs` is used only for MP3 encoding. `entrypoints/app/App.tsx` supervises jobs and does not decode audio on the main thread.

### Bundle size

- **Phase 1:** keep the base package below 1 MB with worker-side WebCodecs MP3 decode, direct WAV PCM parsing, and bundled `lamejs` for MP3 encode only.
- **Phase 2:** keep WebCodecs and mediabunny additions to hundreds of KB through tree-shaking and targeted imports.
- **Phase 3:** load roughly 30 MB ffmpeg.wasm assets only for tools that need them. They must never be part of the base bundle or common startup path.

### Accessibility

- Every dropzone must be focusable and operable with Enter and Space. The shipped implementation already does this with `role="button"`, `tabIndex`, and key handling in `lib/core/dropzone.tsx`.
- Every trim or range handle must be independently focusable, have an accessible name and current value, and support documented keyboard increments. The shipped `lib/tools/audio-cutter/Waveform.tsx` implementation provides two focusable sliders with fine and coarse keyboard steps.
- Status changes must use a polite live region. The shipped app already provides `aria-live="polite"` in `entrypoints/app/App.tsx`.
- Long operations must expose `role="progressbar"` with minimum, maximum, and current values. The shipped `components/Progress.tsx` already provides these semantics.
- Cancellation, errors, unsupported capabilities, snapped keyframe boundaries, and completed downloads must be perceivable without relying on color alone.

## Success metrics

Measurement must preserve the privacy promise. Allowed sources are aggregate AMO and Chrome Web Store dashboards, aggregate payment-console data, and explicit opt-in analytics. There is no hidden event stream, device fingerprint, or required analytics consent.

| Metric | Target or signal | Honest measurement method |
| --- | --- | --- |
| Activation | At least 50% complete one export in the first session | Measure only within an explicitly opt-in product analytics cohort. Report cohort size and consent rate, and do not present it as behavior of every install. |
| Retention | W1 and W4 return rate | Measure first-week and fourth-week return within the same opt-in cohort. Store active-user trends may be shown separately, not joined to individuals. |
| Free to Pro conversion | 1% to 3% of active users | Count paid licenses in the payment console. Use aggregate store active-user estimates for a coarse overall rate and the opt-in cohort for a labeled funnel view. Do not pretend the denominator is exact. |
| Quality | AMO and Chrome Web Store average rating of at least 4.5 | Use public store dashboards and read review sentiment for the “it is a real app” signal, capability failures, output defects, and privacy trust. |

Operational quality also requires benchmark pass rates, cancellation success, valid output playback, and review monitoring. None of these justify collecting hidden per-file metadata.

## Monetization

### Free core and Pro split

The shipped free offline core is the trust and install engine:

- Audio cut, join, change speed, volume/fades, and WAV/MP3 conversion
- No ads, watermark, upload, or account; published safety limits bound input and memory use

Planned Phase 2 additions to the free core are video trim, mute, audio extraction, and basic video compression. The proposed Pro tier is a one-time unlock, expected in the roughly $8 to $15 range. It would monetize power and convenience:

- Batch workflows
- Advanced high-bitrate and lossless export options
- Video-to-GIF quality controls
- Independent pitch and time-stretch with export
- Exotic-format conversion
- Priority access to Chrome multi-thread ffmpeg processing where supported

Delivery phase does not decide entitlement. Basic Phase 2 video jobs stay free. Lossless keyframe video trim and ordinary WAV export are not removed from the free core merely because advanced lossless options can be Pro. There are never ads, affiliate redirects, search-default changes, or a server-processing subscription.

### Planned offline entitlement design

The Phase 3 proposal places checkout outside the extension through a provider such as Gumroad, Paddle, or Lemon Squeezy. A purchase would return an Ed25519-signed license token containing the product, purchaser email, and issue date. The extension would import the token, verify the signature locally with a bundled public key, check that the product matches, and cache the entitlement in extension storage.

The private signing key would never ship in the extension. A modified payload or invalid signature would be rejected. After a valid import, Pro startup and media processing would require no server call. A user could keep a backup of the token and re-import it after clearing extension storage.

This proposed design makes deliberate trade-offs:

- **Sharing and leakage:** an offline token can be copied. Binding the purchaser email in the signed payload is soft enforcement, not device locking. Some sharing is accepted as the cost of avoiding identifiers and mandatory online checks.
- **Refunds and revocation:** a purely offline token cannot be force-revoked. A best-effort revocation check may be offered on a long interval, but it must be optional, explicitly opt-in, and never required for Pro to keep working offline. Refund handling must state this limitation plainly.
- **Privacy:** the imported email stays in local extension storage as part of the token. It is not sent during processing or silently correlated with store activity.
- **Portability:** Firefox has no native extension payment system, and Chrome retired its extension licensing API. External purchase plus local signature verification is the practical cross-store model.

The result is intentionally less restrictive than a server-backed license. That is the honest price of keeping the product's offline promise intact.
