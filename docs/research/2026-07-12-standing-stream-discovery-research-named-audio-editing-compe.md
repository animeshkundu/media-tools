# Audio Cutter competitor findings

- **Date:** 2026-07-12
- **Owner:** Media Tools maintainers
- **Scope:** Audio-cutting features and flows that can improve the shipped Audio Cutter while
  preserving local processing, no upload.

## Research question

Which interaction patterns from 123apps Online Audio Cutter (`mp3cut.net`), Audio Trimmer, Clideo,
ocenaudio, and Audacity are worth adapting into the focused, offline Audio Cutter?

## Method and evidence boundary

This is a comparative UX review, not a code or asset audit. Findings were checked on 2026-07-12
against public first-party product pages, help pages, or manuals linked in
[Sources](#first-party-sources). Product claims are reported as claims unless the first-party source
describes the concrete workflow.

No competitor code, visual assets, text, or proprietary implementation is proposed for reuse. The
recommendations are independently implemented interaction patterns using the existing Media Tools
design system.

## Named competitor findings

### 123apps Online Audio Cutter / mp3cut.net

**Flow:** upload a file, choose a fragment with two sliders, optionally apply fades, cut, then save.
The product page also advertises broad format support, audio extraction from video, and one-click
M4R ringtone output.

**Best patterns**

- Keep the trim task linear: choose file → select one range → choose options → cut.
- Put fade-in and fade-out beside the range rather than behind a general effects panel.
- Keep output choice close to the final action.

**Boundary for Media Tools:** 123apps' privacy policy says users can upload data, that provided data
is stored on its servers as needed, and that it is deleted no later than 12 hours after use. Its
flow is therefore not evidence of an offline or no-upload implementation. Broad format support,
video extraction, cloud providers, advertising, and ringtone-specific behavior are outside this
Audio Cutter discovery slice.

### Audio Trimmer

**Flow:** choose a local file, let supported browsers begin playback, drag two handles, optionally
choose fade-in/fade-out and M4R for a ringtone, crop, then download.

**Best patterns**

- Explain the complete four-step flow on the empty state.
- Treat touch-sized handles and a compact layout as requirements, not desktop enhancements.
- Offer immediate playback before committing a cut.

**Boundary for Media Tools:** the official page repeatedly calls the operation an upload and does
not promise offline operation or no upload. Media Tools should adapt the small-screen clarity, not
the service model or copy.

### Clideo Cut Audio

**Flow:** upload from a device or cloud provider; select a region with yellow handles or exact
timestamps; choose either **Extract Selected** or **Delete Selected**; optionally apply fades or a
crossfade; choose a format; export; then preview, download, return to edit, or continue in another
tool.

**Best patterns**

- Pair direct manipulation with exact start/end fields.
- Name whether the selected region is kept or removed.
- Provide a review loop after processing: preview, download, or edit again.
- Reveal only options that apply to the selected operation.

**Boundary for Media Tools:** Clideo describes files as uploaded and its workflow includes cloud
storage and subscription-only continuation. Media Tools should retain one local **keep selection**
operation for now; delete-and-crossfade is a separate editing model, not a small cutter addition.

### ocenaudio

**Flow:** open files in a native desktop editor, select and edit in the waveform, apply effects, and
save while longer opening, saving, and effect operations run in the background.

**Best patterns**

- Keep the editor responsive while expensive work runs away from the interaction surface.
- Present waveform editing as the primary task and advanced analysis as optional depth.
- Keep behavior and visual structure consistent across operating systems.

**Boundary for Media Tools:** spectral analysis, multiple open documents, and a full effects suite
would turn the focused cutter into a general editor. The transferable lesson is responsiveness and
cross-platform consistency, already aligned with the durable app-page and worker architecture.

### Audacity

**Flow:** select a waveform region by pointer or keyboard, refine it through exact Selection Toolbar
values, listen to the selection or a cut preview, apply an edit or fade, undo if needed, and export.

**Best patterns**

- Make start and end values directly editable, with a clear time format.
- Give each selection boundary complete keyboard operation, not just a keyboard-reachable canvas.
- Support quick selection playback and a cut-preview loop before export.
- Make experimentation recoverable through a visible return-to-edit path.

**Boundary for Media Tools:** multi-track editing, project history, labels, plug-ins, spectral
selection, and configurable fade curves exceed the single-job product. Media Tools can borrow
precision and auditioning without recreating a desktop digital audio workstation.

## Comparative flow

| Product              | Input wording/model                | Range control                   | Precision/review                               | Completion                      | Fit                                  |
| -------------------- | ---------------------------------- | ------------------------------- | ---------------------------------------------- | ------------------------------- | ------------------------------------ |
| 123apps / mp3cut.net | Upload; server retention disclosed | Two sliders                     | Fades                                          | Cut then save                   | Borrow linearity only                |
| Audio Trimmer        | Upload from device                 | Two handles                     | Immediate playback; optional fades             | Crop then download              | Borrow mobile clarity                |
| Clideo               | Device/cloud upload                | Handles or timestamps           | Extract/delete modes; post-export preview/edit | Export then download/cloud save | Borrow exact fields and review loop  |
| ocenaudio            | Native local file                  | Desktop waveform selection      | Background tasks keep UI responsive            | Save locally                    | Borrow responsiveness                |
| Audacity             | Native local file                  | Pointer, keyboard, exact values | Selection/cut preview; undo                    | Export locally                  | Borrow precision and keyboard parity |

## Decision: features worth borrowing now

Only two patterns are both high-value and small enough for deterministic cloud-worker issues:

1. **Keyboard-operable trim boundaries.** This closes the current pointer-only interaction gap and
   adapts Audacity's keyboard parity without adding editor scope.
2. **Exact In/Out time fields.** This adapts Clideo's dual handle/timestamp approach and Audacity's
   Selection Toolbar precision while retaining the existing single-range model.

Selection preview, simple fades, and a post-export preview/edit loop are worthwhile follow-ups, but
they are deliberately not filed here. Each crosses playback or worker/export state currently
centralized in `entrypoints/app/App.tsx`; splitting them into sub-hour issues would create overlapping
ownership or incomplete UI. Delete-selected, crossfade, ringtone output, cloud import/export, broad
format expansion, multi-track editing, and spectral tools are rejected for this slice.

## Filed work items

The two issues are independent, have disjoint file ownership, and are each scoped for less than one
hour of cloud-worker implementation. Their acceptance criteria require existing design tokens,
local processing with no network path, and independent implementation without copied code or assets.

| Issue                                                    | Borrowed pattern                              | Exclusive file ownership                                                                                              | Overlap |
| -------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| _Pending issue link_ — keyboard-operable trim boundaries | Audacity keyboard selection                   | `lib/tools/audio-cutter/Waveform.tsx`; `tests/waveform.test.tsx` (new)                                                | None    |
| _Pending issue link_ — exact In/Out time fields          | Clideo timestamps; Audacity Selection Toolbar | `entrypoints/app/App.tsx`; `lib/tools/audio-cutter/TrimTimeFields.tsx` (new); `tests/trim-time-fields.test.tsx` (new) | None    |

Ownership is disjoint by exact file path; sharing the `tests/` directory does not share a file. No
other issue in this discovery batch may modify those files. If a task needs a listed file, it must
be sequenced after the owning issue rather than expanded in parallel.

## First-party sources

Accessed 2026-07-12:

- 123apps, [Online MP3 Cutter](https://mp3cut.net/).
- 123apps, [Privacy Policy](https://123apps.com/legal).
- Audio Trimmer, [MP3 Cutter Online](https://audiotrimmer.com/).
- Clideo, [Cut Audio](https://clideo.com/cut-audio).
- Clideo Help, [How to trim my audio file](https://help.clideo.com/hc/en-us/articles/4413306580498-How-to-trim-my-audio-file).
- ocenaudio, [About ocenaudio](https://www.ocenaudio.com/en/whatis).
- ocenaudio, [Features](https://www.ocenaudio.com/en/features).
- Audacity Manual, [Audacity Selection](https://manual.audacityteam.org/man/audacity_selection.html).
- Audacity Manual, [Selection Toolbar](https://manual.audacityteam.org/man/selection_toolbar.html).
- Audacity Manual, [Playing and Recording](https://manual.audacityteam.org/man/playing_and_recording.html).
- Audacity Manual, [Fades](https://manual.audacityteam.org/man/fades.html).
- Audacity Manual, [Undo, Redo and History](https://manual.audacityteam.org/man/undo_redo_and_history.html).

## Verification

- Every named competitor in the request has a first-party source and an explicit adopt/reject
  boundary.
- Recommendations preserve the repository's local processing, no upload contract and current
  worker/durable-host architecture.
- Proposed issue ownership is file-disjoint and does not require changes in this research pull
  request outside `docs/research/**`.
- External ideas are reduced to generic interaction patterns; no code, assets, or protected copy is
  reused.
