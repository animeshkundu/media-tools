# Agent instructions

The full engineering guide for this repository is in **`CLAUDE.md`** (read it first) and **`AGENTS.md`**. This file exists so GitHub-native coding agents pick up the same context.

- Read `CLAUDE.md` before making changes — it encodes the architecture and the verified guardrails.
- Before declaring any change done: `npm run check` must pass (compile + lint + test), and you must build (`npm run build`, `npm run build:firefox`) and drive the affected tool end-to-end.
- Architecture: the durable host is the full-page app opened in a tab; the background service worker is glue only; heavy work runs in a Web Worker with progress + cancel + cleanup-on-failure; 100% offline, no network, no remote code; minimal permissions.
- Add a new tool under `lib/tools/<name>/` with a Vitest test and a tab entry in the app.
- Never attribute work to AI, Claude, or Anthropic in commits, code, or docs.
