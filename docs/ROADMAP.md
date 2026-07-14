# Roadmap

## Phase 1: Audio core

- [x] Audio cutter with draggable waveform trim handles
- [x] WAV export
- [x] MP3 export through a cancellable worker
- [x] Audio join / merge
- [x] Audio format conversion
- [x] Coupled speed and pitch change

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
