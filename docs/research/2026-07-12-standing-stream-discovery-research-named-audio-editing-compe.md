# Standing stream discovery: audio-editing competitors

- **Date:** 2026-07-12
- **Owner:** Media Tools maintainers
- **Correlation marker:** `unit-id: 89153391-8562-4dee-9145-f0e4242776c3`
- **Scope:** Named audio-cutting, joining, conversion, and speed competitors; patterns worth
  turning into focused Media Tools work items.

## Research question

Which competitor patterns are worth adapting for the privacy-first, offline Audio Cutter and the
remaining Phase 1 tools, without importing upload funnels, account gates, advertising, remote code,
or Phase 2/3 scope?

## Evidence boundary

This entry consolidates the repository's dated market research rather than presenting a new live
store census. Store counts are snapshots and should not be treated as current install totals. The
primary evidence is:

- [Media Tools market research](../../.docs/ext-2-media-tools.md), retrieved 2026-07-12.
- [Vision](../VISION.md), especially the incumbent positioning and Phase 1 wedge.
- [Product specification](../PRODUCT-SPEC.md), especially the Phase 1 acceptance criteria.
- [Design system](../DESIGN.md) and the [Audio Cutter mock](../../mocks/audio-cutter.html).
- Current implementation in
  [`entrypoints/app/App.tsx`](../../entrypoints/app/App.tsx),
  [`lib/tools/audio-cutter/Waveform.tsx`](../../lib/tools/audio-cutter/Waveform.tsx), and
  [`lib/tools/audio-cutter/encode.worker.ts`](../../lib/tools/audio-cutter/encode.worker.ts).

## Named competitor findings

| Competitor | Evidence-backed role | Worth adapting | Do not copy |
| --- | --- | --- | --- |
| 123apps Audio Cutter / `mp3cut.net` | The old Chrome listing is a launcher; the website supplies the actual editor. Basic cutting is already client-side. | Drop-first start, immediate waveform, visible region handles and time feedback, nearby format controls, direct completion flow. | Website redirect, ads, sign-in, upsells, cross-sell clutter, or an overstated uniqueness claim about local cutting. |
| 123apps Audio Joiner / `audio-joiner.com` | Demonstrates demand, but the researched workflow uploads and has free-tier restrictions. | A visible ordered input list and an obvious single-output action. | Upload, service caps, Premium gating of the basic job, or hidden reordering. |
| 123apps Audio Converter / `online-audio-converter.com` | The strongest demand signal in the pinned Chrome snapshot; the researched workflow uploads. | Explicit input/output summary, visible format and quality settings, early validation. | Server transfer, daily limits, account friction, or a success state before a playable output exists. |
| Clideo, VEED, and Kapwing | Named web rivals whose free funnels add watermark or paid friction. | Concise task-focused screens and settings disclosed before work starts. | Watermarks, account gates, remote processing, and ambiguous free-tier limits. |
| CloudConvert | Named as part of the dominant website conversion funnel. | Familiar conversion language: source, target, settings, convert. | Treating a local file as an upload or requiring connectivity for core conversion. |
| EZGIF | Named as a dominant single-purpose web-tool funnel. Its video/GIF focus is outside this work unit. | Single-job clarity only. | Starting Phase 2 video or Phase 3 GIF work from this discovery stream. |
| Firefox Media Converter and Muxer (`media-conversion-tool`) | A genuine local converter with meaningful AMO usage; proves demand for in-browser conversion. | Real in-extension execution, local processing, and capability-aware format choices. | A broad ffmpeg-based engine in the Phase 1 base bundle or UI breadth ahead of quality. |
| EZConvert Audio Trimmer and MP3 Cutter | Genuine Firefox local trimmers with very low researched usage. | Treat Firefox as a first-class target and keep the cutter discoverable as one focused job. | Assuming low competition removes the need for editor polish, tests, or accessibility. |
| Audio Joiner Merge DASH | Narrow Firefox joining competitor. | Preserve visible order and make the result one predictable file. | Narrowing the product to a streaming/container-specific workflow. |
| Speed Pitch Changer, Capo, and Transpose | Existing tools mainly modify playback/stream media rather than exporting a transformed local file. | Label coupled speed and pitch honestly and make durable export the differentiator. | Implying independent pitch preservation or starting the gated Phase 3 time-stretch tool. |

The source research also names format-specific extensions and a silence-removal tool as evidence of
fragmented demand. They support a coherent suite, but they do not justify adding more formats or
silence detection to Phase 1.

## Repository gap analysis

The current app already has the right high-level shape: durable tab host, local dropzone, always
visible offline badge, amber trim range, determinate worker encode progress, cancellation, and
WAV/MP3 output. The important gaps are functional rather than cosmetic:

1. Decode still uses `AudioContext` and `file.arrayBuffer()` on the UI thread.
2. No hard input or decoded-PCM limit is enforced before allocation.
3. The waveform is one pointer-driven canvas; it has no independently focusable, named,
   value-bearing keyboard handles.
4. Selection conversion uses floor/ceil frame rounding but has no decode round-trip proof that the
   exported span is within one source frame.
5. The manifest CSP does not yet default-deny connection, form, and frame sinks, and CI does not
   inspect both production manifests.
6. Dependencies use drifting ranges even though shipped versions must be exact and the software
   bill of materials needs artifact-level provenance.
7. Phase 1 join, conversion, and coupled speed tools do not exist.
8. Existing tests cover WAV structure and basic slice length only; they do not cover worker
   lifecycle, malformed input, cancellation, browser artifacts, accessibility, or real playback.

## Borrow-worthy work items

These are intentionally PR-sized. Each item must preserve the durable app-page host, keep processing
local, and avoid Phase 2 video and Phase 3 independent pitch/time-stretch. Acceptance-criteria
numbers refer to the mission criteria defined in the companion plan's
[verification matrix](../plans/2026-07-12-standing-stream-discovery-research-named-audio-editing-compe.md#acceptance-criterion-verification-matrix).

| ID | Work item | Competitor lesson adapted | Acceptance criteria |
| --- | --- | --- | --- |
| PRIV-1 | Ship a default-deny extension-page CSP and inspect both built manifests in CI; narrow privacy copy to claims enforced by the artifact. | Trust must be visible and verifiable, not merely asserted. | 3, 5, 8 |
| SUPPLY-1 | Exact-pin shipped dependencies and expand `THIRD-PARTY.md` with license, purpose, notices, source/relink obligations, and build details for the vendored MP3 encoder. | Local execution is not enough without reproducible provenance. | 6, 8 |
| AUDIO-CORE-1 | Establish a cross-browser worker-owned decode contract, preflight file and metadata ceilings before allocation, transfer bounded PCM/chunks, clamp progress, and terminate/clean up on cancel, crash, and error. | Real in-extension processing should stay responsive and predictable. | 4, 5, 6 |
| CUT-1 | Make selection boundaries frame-based end to end and add WAV/MP3 decode round-trip fixtures for non-frame-aligned ranges and edge selections. | Match editor immediacy while beating it on measurable precision. | 1, 6 |
| CUT-A11Y-1 | Overlay two semantic trim controls on the waveform with accessible names/values, documented coarse/fine arrow increments, visible focus, live value feedback, non-color status, and reduced-motion behavior. | Keep polished handles without making the canvas a pointer-only control. | 2, 9 |
| CUT-E2E-1 | Drive built Chrome and Firefox artifacts offline with real WAV and MP3 fixtures; cover success, undecodable input, progress, cancellation, worker failure, no request, no partial download, and output playback. | A direct completion flow is valuable only when the downloaded artifact is real. | 4, 5, 6, 8 |
| JOIN-1 | Add ordered multi-file join with accessible reorder/remove controls, normalization policy, no introduced gap, WAV/MP3 output, progress, cancellation, and aggregate limits. | Adapt the joiner's visible ordering without its upload funnel. | 4, 5, 7, 9 |
| CONVERT-1 | Add one-file WAV/MP3 conversion with early decode rejection and visible target settings. | Adapt familiar source-to-target language and early validation. | 4, 5, 6, 7, 9 |
| SPEED-1 | Add coupled speed-and-pitch export with visible multiplier and predicted duration; explicitly direct independent pitch needs to the later gated tool. | Exporting a local result differentiates it from playback modifiers. | 4, 5, 7, 9 |

## Priority and scope decision

Execute the binding foundation before adding tools:

1. `PRIV-1` and `SUPPLY-1`.
2. `AUDIO-CORE-1`.
3. `CUT-1`, `CUT-A11Y-1`, and `CUT-E2E-1`.
4. `JOIN-1`.
5. `CONVERT-1`.
6. `SPEED-1`.

Join, conversion, and speed remain separate pull requests. Shared audio infrastructure may be
introduced only by the smallest preceding foundation change needed by all three. No work item in
this stream starts video, GIF, exotic conversion, or independent pitch/time-stretch.

## Risks and unresolved decisions

- **Worker decode:** Web Audio contexts are unavailable in worker scope. A compatibility spike must
  prove the exact Chrome/Firefox decode path and supported input contract before implementation.
  If browser `AudioDecoder` plus demux is insufficient, any bundled decoder must be exact-pinned,
  offline, license-reviewed, size-measured, and recorded in `THIRD-PARTY.md`.
- **Bounded memory:** A file-size cap alone does not bound decoded PCM. Limits must include channels,
  sample rate, frame count, duration, per-file bytes, aggregate join bytes, and output size using
  overflow-safe arithmetic.
- **MP3 timing:** Encoder delay/padding can make naive duration assertions misleading. Tests must
  decode the produced file and define frame-accurate comparison semantics rather than relying only
  on container length.
- **Cancellation:** Worker termination prevents a result message, but tests must also prove no object
  URL/download is created and all retained references and temporary state are released.
- **Accessibility:** Semantic controls over a canvas must remain spatially aligned when resized and
  must not create duplicate or confusing announcements.
- **Scope pressure:** Competitors expose fades, zoom, batch, many formats, and video features. None
  belongs in the acceptance-critical path unless separately approved.
- **Claims:** “Local processing, no upload” is the precise contract. Avoid stronger mechanical-proof
  language unless production artifacts and runtime tests establish it.

## Follow-ups

- Implementation plan:
  [standing-stream discovery plan](../plans/2026-07-12-standing-stream-discovery-research-named-audio-editing-compe.md).
- Future changes should update `ROADMAP.md`, relevant specifications, and durable learnings only when
  behavior or an architectural decision actually lands.
