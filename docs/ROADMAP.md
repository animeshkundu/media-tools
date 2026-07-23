# Roadmap

## Phase 1: Audio core

- [x] Audio cutter with draggable waveform trim handles
- [x] WAV export
- [x] MP3 export through a cancellable worker
- [x] Audio join / merge
- [x] Audio format conversion
- [x] Coupled speed and pitch change
- [x] Offline volume, fades, peak normalization, and clipping preview
- [x] One import-once Audio Studio replacing the tab-per-transform shell
- [x] GitHub Pages web target at `/media-tools/app/` with the same unified workspace

## Phase 1.5: Bounded audio workspace

- [x] Serializable non-destructive multitrack asset, clip, track, and timeline state
- [x] iMovie-style three-pane editor with virtualized Canvas waveform timeline and magnetic snapping
- [x] Main-page Web Audio preview, audio skimming, track graph, mute/solo, pan, EQ, and transport
- [x] Clip speed, gain, fades, split/delete, zoom, arrangement, and asset reuse in one timeline
- [x] Deterministic worker WAV/MP3 mixdown with dialogue-driven music ducking
- [x] Optional worker-owned OPFS cache for bounded inputs and slices
- [x] Feature-detected, explicit, bounded local voice-over with no install-time permission
- [ ] Noise suppression, pending a bundled model, quality gate, and worker export design
- [ ] Large-file streaming and RF64, pending tested quotas, numeric limits, and disk-backed output

## Phase 2: Video with WebCodecs + mediabunny

- [ ] Extract audio from video
- [ ] Mute or remove an audio track
- [ ] Video trim: lossless keyframe mode and frame-accurate mode
- [ ] Audio export to M4A/AAC/OGG where supported
- [ ] Video compression behind cross-browser benchmark gates

## Phase 3: Heavy and specialized tools

- [ ] Video to GIF
- [ ] Independent pitch and time stretch
- [ ] Exotic format conversion with a lazy Chrome-first ffmpeg.wasm fallback

Every heavy tool must record package size, maximum tested input, peak memory, wall-clock time, cancellation behavior, and playback compatibility before release.
