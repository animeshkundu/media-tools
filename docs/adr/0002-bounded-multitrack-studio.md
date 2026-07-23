# ADR-0002: Ship a bounded multitrack editor with separate preview and export engines

## Status

Accepted

## Date

2026-07-23

## Context

Media Tools needs one non-destructive workspace for arranging dialogue, music, and sound effects. Requiring a new import in separate Cut, Join, Speed, Volume, Convert, and Studio tabs makes compound edits slow and obscures how operations combine. A literal browser DAW with multi-gigabyte assets would conflict with the shipped 64 MiB per-file and 256 MiB decoded or in-flight processing limits. Web Audio is available on the durable app page but not in a Web Worker, while the repository requires heavy export work to remain worker-owned.

## Decision

We will replace the tab-per-transform shell with one iMovie-style Audio Studio. Users import each source once, reuse immutable assets across clips, edit on one timeline, and export one WAV or MP3 mix. The studio has two deliberately separate execution paths:

- The durable app page owns a framework-agnostic `MultitrackAudioEngine` for user-initiated preview. It builds Web Audio track graphs, schedules immutable decoded buffers, and supports play, pause, seek, scrub, mute, solo, gain, pan, EQ presets, and live dialogue-driven ducking.
- A dedicated worker owns authoritative WAV and MP3 export. It validates the serializable timeline, performs deterministic speed resampling, fades, EQ, pan, mute/solo, sample-accurate ducking, and mixing, then uses native PCM WAV or bundled `lamejs` MP3 encoding and returns a complete result before download.
- Timeline edits are immutable JSON offset math. Raw PCM is held outside the timeline state and never modified.
- OPFS is an optional worker-owned, session-isolated cache for already bounded inputs. Reads are limited to 8 MiB slices, normal teardown clears the current session, and a later session removes stale cache directories. OPFS does not raise the 64 MiB input, 30 minute duration, or 256 MiB worst-case in-flight limits and is not a claim of multi-gigabyte support.
- Generated tone, silence, and click assets replace remotely fetched stock sounds.
- Voice-over is a feature-detected, explicit in-page action. It calls `getUserMedia` only after the user presses Record, requests no install-time manifest permission, captures bounded mono PCM for at most five minutes and within remaining project memory, stops every media track on stop/discard/failure, and adds the take as another immutable local asset. Model-based noise suppression remains out of scope.

## Consequences

### Positive

- The editor stays responsive while decode, storage streaming, mixdown, and encoding run in workers.
- Preview can use native Web Audio without making browser-specific audio APIs part of the export contract.
- Worker export is deterministic and covered by pure DSP tests.
- Existing no-egress, zero-permission, cancellation, and bounded-memory contracts remain intact.
- Compound edits no longer require reimporting a source or switching tools.

### Negative

- Preview and export use equivalent but separate DSP implementations and can have small audible differences.
- The conservative memory projection includes retained PCM, Web Audio copies, transfer snapshots, output PCM, ducking, and WAV output, so practical project size is lower than the raw 256 MiB number.
- Arrangements are session-only. The schema is serializable, but reopening a project with its source assets remains future work and the UI does not claim persistence.
- Voice-over capture uses a short-lived main-page Web Audio callback because media input and `AudioContext` are unavailable in workers; authoritative rendering remains worker-owned.

### Neutral

- Preview transport is an editor aid for creating a durable local export. It does not modify audio from tabs, streams, or other applications.
- Large-file streaming and RF64 output remain gated future work.

## Notes

Related contracts: [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md), [`../CAPABILITY-CONTRACT.md`](../CAPABILITY-CONTRACT.md), and [`../ROADMAP.md`](../ROADMAP.md).
