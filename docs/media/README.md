# Real Firefox media capture

Regenerate the committed Audio Cutter screenshots and demo videos with:

```sh
npm run capture
```

The capture script builds the `firefox-mv3` target, installs that unpacked build into a real Firefox session through geckodriver and Marionette, resolves its runtime `moz-extension://` UUID, and captures the rendered extension page at 1280×800. Both videos are assembled with `ffmpeg` from a timed sequence of screenshots taken from that same Firefox session.

Requirements are the repository's installed dependencies plus `ffmpeg` and `ffprobe` on `PATH`. Selenium Manager provisions the pinned geckodriver and resolves Firefox. The script logs the Node version, exact browser binaries, Firefox version, UUID, frame count, video durations, and generated file sizes for each run.

Generated artifacts:

- `screenshots/audio-cutter-empty.png`: initial audio dropzone.
- `screenshots/audio-cutter-waveform.png`: real WAV fixture loaded with its rendered waveform.
- `screenshots/audio-cutter-trim-selected.png`: exact In and Out points selected.
- `screenshots/audio-cutter-export-done.png`: successful cut and download confirmation.
- `screenshots/audio-cutter-error.png`: corrupt-audio rejection state.
- `audio-cutter-demo.mp4`: empty-to-trim-to-export core flow encoded as H.264.
- `audio-cutter-demo.webm`: the same genuine Firefox frames encoded as VP9.
