---
name: verify
summary: Exercise the built Audio Cutter through its browser UI.
---

1. Run `npm run build`.
2. Serve `.output/chrome-mv3` with `npx http-server .output/chrome-mv3 -p 4177 -c-1`.
3. Generate a short WAV fixture with ffmpeg when available.
4. Use Playwright with the installed Chrome executable to open `http://127.0.0.1:4177/app.html`, set the hidden file input, confirm the waveform editor appears, click **Cut & download**, and assert the browser emits a download with the expected filename and success status.
5. Probe **Choose another** and unsupported input handling.
