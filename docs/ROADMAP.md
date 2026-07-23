# Roadmap

## Phase 1: Audio core

- [x] Audio cutter with draggable waveform trim handles
- [x] WAV export
- [x] MP3 export through a cancellable worker
- [x] Audio join / merge
- [x] Audio format conversion
- [x] Coupled speed and pitch change
- [x] Offline volume, fades, peak normalization, and clipping preview
- [x] One redesigned studio shell shared by the extension and hosted web app
- [x] GitHub Pages web target at `/media-tools/app/` with the same audio tools

## Phase 1.5: Bounded audio workspace

- [x] Serializable non-destructive multitrack asset, clip, track, and timeline state
- [x] Four-pane editor with virtualized Canvas waveform timeline and magnetic snapping
- [x] Main-page Web Audio preview with track graph, mute/solo, pan, EQ, and transport
- [x] Deterministic worker WAV mixdown with dialogue-driven music ducking
- [x] Optional worker-owned OPFS cache for bounded inputs and slices
- [ ] Microphone recording, pending a separate permission and privacy decision
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
