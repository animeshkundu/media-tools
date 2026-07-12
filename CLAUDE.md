# CLAUDE.md — Media Tools (privacy-first offline media tools, Chrome + Firefox)

## What this is

A cross-browser MV3 WebExtension that does media file operations **100% client-side, offline, with no upload, no ads, no account, and minimal permissions**. Built with WXT + React + TypeScript + Tailwind. Read `.docs/ext-0-overview.md` then `.docs/ext-2-media-tools.md` for the market context and plan. The wedge is being a real offline in-browser tool rather than a deprecated launcher to an upload-based website.

## Architecture (do not violate)

- **Durable host = the app page** (`entrypoints/app/`), opened in a tab. The background is glue only and never does heavy work.
- **Heavy work runs in a Web Worker** spawned by the app page, with progress, explicit cancel, and cleanup on failure.
- **Offline, no network, no remote code.** Bundle every dependency and WASM asset. CSP includes `wasm-unsafe-eval`.
- **No permissions for local-file tools.** Output via Blob download. File System Access and side panels are optional Chrome enhancements only.
- One WXT codebase targets Chrome and Firefox through `browser.*`.

## Media guardrails (verified — don't regress)

- Audio uses Web Audio for decode/slicing and native PCM WAV output. MP3 encoding is not available in WebCodecs, so use bundled `lamejs` in a worker.
- Future video tools use **WebCodecs + mediabunny** first. WebCodecs shipped in Firefox 130+, but codec availability varies by browser and OS, so capability-detect every encoder and degrade gracefully.
- `ffmpeg.wasm` is only a lazy **Chrome-first multithread fallback** for formats WebCodecs cannot serve. Firefox extension pages cannot obtain the cross-origin isolation needed for multithreaded ffmpeg; never put ffmpeg in the base bundle.
- Lossless video trim is keyframe-constrained. Offer keyframe snapping or exact re-encode and label the tradeoff honestly.
- Heavy media work is cancellable and never runs in the MV3 background. Release large buffers promptly and benchmark memory, time, cancellation, and output playback before shipping video tools.

## Commands

- `npm run dev` / `npm run dev:firefox` — HMR development.
- `npm run build` / `npm run build:firefox` — production builds.
- `npm run compile` — typecheck. `npm test` — unit tests. `npm run lint` — lint. `npm run check` — all three.
- Before declaring a product change done, `npm run check` must pass and the built extension must be loaded and driven with a real file on both browser targets when applicable.

## Conventions

- TypeScript strict; React function components and hooks; Tailwind for styling.
- Heavy/CPU work goes through `lib/core/worker.ts`; never block the UI thread.
- A new tool belongs in `lib/tools/<name>/`, is surfaced in `entrypoints/app/App.tsx`, and includes a Vitest test.
- Keep shipped dependencies and licenses current in `THIRD-PARTY.md`.
- No attribution to AI, LLM vendors, or model providers in commits, code, or docs.

## Roadmap

See `ROADMAP.md`. Audio Cutter is the working seed; continue in phase order.
