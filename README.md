# Media Tools

A privacy-first Chrome and Firefox extension for editing local media. Files stay on your device: no upload, account, ads, watermark, or host permissions.

The working seed tool is **Audio Cutter**:

1. Drop an audio file into the full-page app.
2. The page decodes it with Web Audio and draws a waveform.
3. Drag the trim handles to select a region.
4. Export WAV or MP3. Cutting and encoding run in a cancellable Web Worker.
5. The finished Blob downloads locally.

## Development

```sh
npm install
npm run dev
npm run dev:firefox
npm run check
npm run build
npm run build:firefox
```

Chrome and Firefox production artifacts are emitted under `.output/`. See `CLAUDE.md` for architecture constraints and `docs/ROADMAP.md` for the build order.
