# AudioMass capability and large-file audit

Date: 2026-07-23  
Upstream reviewed: [`pkalogiros/AudioMass` at `2ac3801`](https://github.com/pkalogiros/AudioMass/tree/2ac3801a476822c236d9914f9ef4d2d01f9131e6)

## Result

AudioMass is a useful interaction and feature benchmark, but its large-file behavior is not a safe architecture to copy. It decodes complete inputs into Web Audio `AudioBuffer` instances and creates additional buffers for edits. Its own documentation says huge `decodeAudioData` jobs have no progress or cancellation, consume resources until completion, and can trigger garbage-collection crackle. Audio Studio must therefore keep its current 64 MiB input and 256 MiB decoded/in-flight PCM limits until the separately gated streaming, disk-backed output, quota, cancellation, and RF64 design is complete.

## Capability comparison

Audio Studio already covers the core multitrack workflow: multi-file import, reusable source assets, clip move/trim/split/delete, zoom and horizontal pan, a beat grid with magnetic snapping, gain and fades, track volume/pan/mute/solo, EQ presets, clipping feedback, local voice-over, local WAV/MP3 mixdown, and offline/no-upload operation. Its Canvas draws only visible time and track ranges from bounded peak pyramids, while decode, analysis, mixdown, storage, and encoding use cancellable workers.

The remaining AudioMass parity backlog is:

- destructive region clipboard operations: cut, copy, paste, trim-to-selection, silence, reverse, and invert;
- frequency/spectral visualization, zero-crossing selection, and named markers with keyboard navigation and marker-to-selection;
- automatic beat detection rather than manually entered tempo;
- compressor, normalization, reverb, delay, distortion, independent pitch shift, and effect preview before apply;
- graph-based pitch/speed automation, including ramps and Doppler-style presets;
- click, hum, and hard-edit repair tools;
- seamless-loop construction with silence trim, zero-crossing snap, repeat, and crossfade preview;
- undo/redo across every edit, clip duplication/rename, explicit overlap crossfades, and a vertical mixer view;
- armed-track punch-in recording with multiple takes;
- portable project save/open comparable to AudioMass `.amss` sessions.

These features cannot be represented as a single UI pass. Region and effect work must reconcile AudioMass's destructive single-buffer model with Audio Studio's immutable assets and serializable non-destructive clips. Every new DSP path must run in a bounded cancellable worker and have preview/export parity, malformed-input coverage, and production browser evidence.

## Why AudioMass feels responsive

AudioMass keeps the interface small and hand-built, computes waveform peaks, and limits waveform work to the visible range. Its multitrack mode also uses Canvas-based waveform boxes. Those choices reduce DOM and drawing work during navigation.

The tradeoff is memory and long-task safety:

- [`multitrack.js`](https://github.com/pkalogiros/AudioMass/blob/2ac3801a476822c236d9914f9ef4d2d01f9131e6/src/multitrack.js) passes complete arrays to `decodeAudioData` and creates new `AudioBuffer` objects for clip processing.
- [`engine.js`](https://github.com/pkalogiros/AudioMass/blob/2ac3801a476822c236d9914f9ef4d2d01f9131e6/src/engine.js) creates complete Web Audio buffers from channel arrays.
- The upstream [performance notes](https://github.com/pkalogiros/AudioMass/blob/2ac3801a476822c236d9914f9ef4d2d01f9131e6/src/about.html) say the waveform still clears and redraws the full Canvas each frame, filter work can freeze the UI, Web Audio array iteration can cause garbage-collection crackle, and huge decodes cannot report progress or cancel.

Audio Studio already improves the rendering side with a bounded peak pyramid, visible-range Canvas rendering, `requestAnimationFrame` coalescing, active-clip mix traversal, and worker-owned heavy jobs. It intentionally does not interpret AudioMass's absence of a tight input cap as proven large-file support.

## Required large-file track

Raising limits requires all of the following before release:

1. Incremental container parsing and decode without reading the complete source into one `ArrayBuffer`.
2. Disk-backed intermediate and final output with tested Chrome and Firefox OPFS quotas.
3. Streamed WAV output plus RF64 when RIFF's 32-bit size limit is exceeded.
4. Overflow-safe metadata ceilings and numeric limits for source bytes, decoded frames, channels, duration, project tracks, cache, and output.
5. Cancellation thresholds that cover decode, effects, mix, tab close, worker crash, quota failure, and partial-file cleanup.
6. Numeric browser/OS gates for peak memory, wall-clock time, seek responsiveness, output quality, and playback.

Until those gates pass, the accurate contract remains **local processing, no upload, with bounded WAV/MP3 inputs**.
