# Phase-1 audio tools QA report

> **SUPERSEDED (2026-07-14):** Findings below about main-thread Web Audio describe the retired
> decode path and are preserved as a point-in-time QA record. The shipped engine now decodes MP3 with
> worker-side WebCodecs `AudioDecoder` and parses WAV PCM directly in the worker. Bundled `lamejs` is
> used for MP3 encoding only.

**Date:** 2026-07-13  
**Scope:** Audio Cutter flagship (`entrypoints/app/`, `lib/tools/audio-cutter/`, `lib/core/`) plus merged Phase-1 cores (`lib/tools/join/`, `lib/tools/change-speed/`, `lib/tools/convert/`)  
**Out of scope:** Phase-2 video, Phase-3 pitch/time-stretch, store-submission, Pro tier  

---

## Baseline verification

The following commands were run from a clean `npm ci` on 2026-07-13:

| Command | Result |
| --- | --- |
| `npm run compile` | Pass — no TypeScript errors |
| `npm run lint` | Pass — no ESLint violations |
| `npm run test` | **Pass — 7 test files, 68 tests, 0 failures** |
| `npm run build` | Pass — Chrome MV3, 486.87 kB total |
| `npm run build:firefox` | Pass — Firefox MV3, 486.87 kB total |
| CI: CSP manifest guard | Pass — both built manifests verified by `scripts/check-csp.mjs` |
| CI: egress manifest guard | Pass — both built manifests verified by `scripts/check-manifest-egress.mjs` |

Build artifacts were inspected manually. The Chrome and Firefox manifests produced identical CSP policies and both pass the `validateManifest` and `validateManifestEgress` checks that run in CI.

---

## Section 1 — Correctness and numeric edge cases

### 1.1 WAV RIFF chunk-size overflow in `encodeWav()`

**File:** `lib/tools/audio-cutter/audio.ts`, lines 26–55

`encodeWav()` computes `dataBytes = frames * channelCount * 2` as a plain JS number and writes it to
the RIFF chunk-size field with `view.setUint32(4, 36 + dataBytes, true)`. `DataView.setUint32`
silently wraps values that exceed `2^32 − 1`. For stereo PCM at 44,100 Hz the overflow threshold is
approximately 6.8 hours of audio. At exactly `frames = 1,073,741,815` the RIFF size field wraps to
`0`; the resulting file is a corrupt container.

The Audio Cutter has no pre-decode duration or file-size limit (see Section 2), so the current code
path allows a user to load a file long enough to produce a silently corrupt WAV output. The RIFF
format supports a 64-bit RF64 extension for this case; alternatively, a hard limit shorter than the
overflow threshold, verified before `encodeWav` is called, is sufficient for Phase 1.

**Cannot currently be triggered in normal use** because the main-thread `AudioContext` decode would
exhaust typical browser memory well before reaching the overflow point. The gap is nevertheless real:
a pre-rejection before `encodeWav` is the correct fix; the WAV writer itself should not assume the
caller has already enforced a safe duration.

**Work item WI-01 — Guard `encodeWav()` against RIFF chunk-size overflow**

- Target files: `lib/tools/audio-cutter/audio.ts`
- Add a guard at the top of `encodeWav()` that throws before allocation when `frames * channelCount * 2 > 2^32 − 37`.
- Add one unit test in `tests/audio.test.ts` with exactly `maxFrames + 1` frames that expects the guard to throw a message mentioning a size limit.
- Acceptance criterion: the test passes and `encodeWav()` never calls `setUint32` with a value greater than `2^32 − 1`.
- Estimated effort: ≤ 30 min.

---

### 1.2 MP3 channel truncation is silent

**Files:** `lib/tools/audio-cutter/encode.worker.ts` line 45, `entrypoints/app/App.tsx`

`encodeMp3()` calls `source.channels.slice(0, 2)` and encodes only the first two channels without
throwing, logging, or notifying the UI. If a user loads a surround-sound file (five or six channels
after `AudioContext` decode), the exported MP3 silently discards all channels after the second.

`encodeWav()` correctly throws for channel counts outside `[1, 2]`, which means WAV export and MP3
export have different policies for the same invalid input. There is no UI copy explaining the MP3
channel-downmix policy.

**Work item WI-02 — Expose MP3 channel-downmix policy before export**

- Target files: `entrypoints/app/App.tsx`, `lib/tools/audio-cutter/encode.worker.ts`
- When `audio.channels.length > 2`, either (a) display a visible note next to the format selector ("MP3 encodes the first two channels only") or (b) reject at the worker boundary and surface a clear error. Do not silently truncate.
- Add a test confirming the worker sends an error or a visible UI cue appears for three-channel input before WAV/MP3 export.
- Acceptance criterion: a user with a three-channel file sees an explicit message before or during export. The WAV path already throws; the MP3 path must not be more permissive.
- Estimated effort: ≤ 45 min.

---

### 1.3 Audio Cutter has no pre-decode input limits

**File:** `entrypoints/app/App.tsx` — the `load()` function

The function calls `file.arrayBuffer()` (reads the full file into memory), then
`context.decodeAudioData()` (a second full-file allocation), then `.getChannelData(channel).slice()`
per channel (a third independent copy of each channel). No limit is checked on file size, declared
duration, channel count, or sample rate before any of these allocations.

By contrast, `lib/tools/convert/convert.ts` checks a `MAX_PCM_BYTES = 512 MiB` guard before
encoding, and `lib/tools/join/join.ts` enforces a `MAX_JOIN_OUTPUT_BYTES = 512 MiB` limit before
output allocation. The Audio Cutter core has no equivalent protection.

**Work item WI-03 — Add pre-decode and post-decode limits to Audio Cutter**

- Target file: `entrypoints/app/App.tsx`
- Before `file.arrayBuffer()`: reject files above a defined `MAX_INPUT_BYTES` (suggested ≤ 256 MiB) and display a clear message.
- After `context.decodeAudioData()`: reject decoded buffers whose total PCM byte count (`numberOfChannels × length × 4`) exceeds a defined `MAX_PCM_BYTES` (suggested ≤ 512 MiB) and display a clear message.
- Add tests for both rejection paths in the existing test suite or a new integration test.
- Acceptance criterion: inputs above the threshold show a rejection message; inputs below the threshold continue working correctly.
- Estimated effort: ≤ 45 min.

---

### 1.4 Main-thread WAV encoding in `convert.ts`

**File:** `lib/tools/convert/convert.ts` — `startWavEncode()`

When the output format is `wav`, `startConversion()` calls `startWavEncode()`, which runs the full
`encodeWav()` computation synchronously inside a `queueMicrotask`. This executes on the main thread.
For a one-minute stereo 48,000 Hz file the WAV output is roughly 23 MB; the synchronous loop runs in
the same thread as the UI. The architecture guardrail requires heavy work to stay off the UI thread.

The MP3 path correctly delegates to `startEncode()` and the shared worker. The WAV path does not.
The `cancel()` implementation races with the microtask: calling `cancel()` before the microtask
executes correctly rejects without output; calling it after the microtask has begun encoding does
nothing, because `settled` is already `true` inside the microtask by the time the synchronous
`encodeWav` call returns and resolves the promise. The shipped test covers only the first scenario.

This is a Phase-1 core module with no UI entry today. The main-thread block does not affect the
shipped Audio Cutter user. However, the next implementation PR that adds a Convert UI will need this
fixed before shipping.

**Work item WI-04 — Move convert WAV encoding to the shared worker**

- Target file: `lib/tools/convert/convert.ts`
- Replace `startWavEncode()` with a call to `startEncode()` using `format: 'wav'`, consistent with the MP3 path. The shared worker already handles WAV encoding via `encode.worker.ts`.
- Update `tests/convert.test.ts` to verify WAV export goes through `startEncode` (matching how the MP3 test already does).
- Acceptance criterion: WAV and MP3 conversions both route through `startEncode`; the main-thread `queueMicrotask` encoding path is removed; all convert tests pass.
- Estimated effort: ≤ 40 min.

---

### 1.5 Resampling in join and change-speed runs on the main thread

**Files:** `lib/tools/join/join.ts` — `joinPcm()`, `lib/tools/change-speed/changeSpeed.ts` — `changeSpeed()`

`startJoinedEncode()` calls `joinPcm()` synchronously before `startEncode()`. `joinPcm()` includes
linear resampling of every channel of every track. For two 30-minute stereo tracks at different
sample rates, this is roughly 300 million interpolation operations on the main thread before the
worker is started.

`startChangeSpeedEncode()` calls `changeSpeed()` synchronously before `startEncode()`. At `0.25×`
speed the output length is four times the input length; for a 10-minute stereo 44,100 Hz input this
is approximately 530 million interpolation operations on the main thread.

These cores have no UI entry today and the main-thread concern does not affect the shipped tool. The
correct target architecture routes the entire compute — including resampling — through the worker.
This cannot be fixed without extending the worker protocol, which is a larger PR.

**Work item WI-05 — Move join resampling and speed resampling into the worker**

- Target files: `lib/tools/join/join.ts`, `lib/tools/change-speed/changeSpeed.ts`, `lib/core/worker.ts`, `lib/tools/audio-cutter/encode.worker.ts`
- Extend the worker message protocol with `audio-join` and `audio-speed` job kinds. Move `joinPcm()` and `changeSpeed()` into the worker.
- `startJoinedEncode()` and `startChangeSpeedEncode()` should transfer input buffers to the worker rather than computing on the main thread.
- Acceptance criterion: resampling and concatenation are not observable on the main thread during processing; the worker handles the full transform. All existing tests for these cores must continue to pass.
- Estimated effort: ≥ 1 h (architectural change; defer to the shared worker pipeline PR).

*Note: WI-05 is flagged as > 1 h and is not a quick fix. It is listed here because it represents a known architectural debt item, not an oversight.*

---

### 1.6 `cutPcm()` uses floating-point seconds as canonical trim state

**File:** `lib/tools/audio-cutter/audio.ts` lines 6–15; `entrypoints/app/App.tsx` — `start`, `end` state

The trim state is stored as floating-point seconds in React state. `cutPcm()` derives frame indices
via `Math.floor(startSeconds × sampleRate)` and `Math.ceil(endSeconds × sampleRate)`. The displayed
timecodes, handle positions, selected-duration calculation, and worker request all use the same
floating-point seconds, so all are derived consistently. For the single encode worker path the
rounding happens once in `cutPcm()`.

**Verified correct** for the single-tool case. The risk identified in the prior research document —
different rounding at different call sites — does not currently apply because there is only one call
site. This remains a risk to watch if the codebase adds additional derivations from the same state.

No work item required at current scope.

---

## Section 2 — Bounded memory

### Summary of current limits

| Path | Input-file limit | Post-decode limit | Output limit |
| --- | --- | --- | --- |
| Audio Cutter (`App.tsx`) | None | None | None (see WI-01 for RIFF overflow) |
| Convert (`convert.ts`) | None | 512 MiB (MAX_PCM_BYTES) | Inherited from WAV/MP3 encoder |
| Join (`join.ts`) | None | 512 MiB (MAX_JOIN_OUTPUT_BYTES) | Inherited from WAV/MP3 encoder |
| Change speed (`changeSpeed.ts`) | None | None | None |

### 2.1 No input-file limit before `AudioContext.decodeAudioData`

Covered by WI-03 above. The Audio Cutter reads the entire file into memory before decode, then keeps
all decoded PCM channels as `Float32Array` slices in component state for the lifetime of the editor
session. A 200 MB OGG Vorbis file at 48,000 Hz stereo decodes to roughly 200+ MB of PCM. Combined
with the file `ArrayBuffer`, the initial peak is approximately 400 MB for that input.

### 2.2 Change-speed has no output-size guard

**File:** `lib/tools/change-speed/changeSpeed.ts` lines 28–30

`outputLength = Math.max(1, Math.round(inputLength / effectiveFactor))`. At the minimum allowed
factor of `0.25`, this is `4 × inputLength`. There is a `Number.isSafeInteger` check but no byte
limit. An input of 128 MiB of PCM at `0.25×` produces 512 MiB of output, which would pass the safe-
integer check but could exhaust memory before the worker receives the buffers.

**Work item WI-06 — Add output-size guard to `changeSpeed()`**

- Target file: `lib/tools/change-speed/changeSpeed.ts`
- After computing `outputLength`, check `outputLength × source.channelData.length × 4 ≤ MAX_PCM_BYTES` (matching the convert limit of 512 MiB) and throw a user-visible error before allocation.
- Add a unit test that triggers the limit with a minimum factor and large input.
- Acceptance criterion: the guard throws before any `Float32Array` allocation; the existing factor and interpolation tests continue to pass.
- Estimated effort: ≤ 30 min.

---

## Section 3 — Progress, cancellation, cleanup, and no partial download

### 3.1 Cancel button is visible but inert during audio decode

**File:** `entrypoints/app/App.tsx`

`load()` sets `setBusy(true)` before `file.arrayBuffer()` and `decodeAudioData()`. The Cancel button
is conditionally rendered when `busy === true`. However, `jobRef.current` is only set inside
`exportAudio()`, so during decode `jobRef.current?.cancel()` is a no-op — the optional-chain short-
circuits on `undefined`. A user who clicks Cancel during a slow decode of a large file sees the
button, clicks it, and nothing changes. No feedback indicates that the cancel was ignored.

This is misleading. The correct behaviour for Phase 1 is either to hide Cancel during decode
(showing only the spinner/status) or to implement decode cancellation (hard in the current Web Audio
path; simpler once decode moves to a worker).

**Work item WI-07 — Hide Cancel button during decode or provide feedback when cancel is unavailable**

- Target file: `entrypoints/app/App.tsx`
- Introduce a second state variable (e.g. `decoding`) or distinguish `busy` phases so the Cancel button is only rendered when `jobRef.current` is set (i.e. during export, not during decode).
- Acceptance criterion: during audio decode the Cancel button is not visible; during export it is visible and correctly cancels the job. Existing export-cancel tests must continue to pass.
- Estimated effort: ≤ 30 min.

---

### 3.2 Export cancellation and no-partial-download — verified correct

`lib/core/worker.ts` — `startEncode()`:

- `cancel()` calls `worker.terminate()` then rejects the promise via `rejectJob`.
- The `onmessage` and `onerror` handlers set `settled = true` before terminating, so late messages are ignored.
- `App.tsx` — `exportAudio()`: `downloadBlob()` is called only inside the `try` block after `await job.result` resolves. The `catch` block sets an error status message and never calls `downloadBlob()`. The `finally` block only clears `busy`.

**Result: no partial download can be created on cancel or worker error.** This matches the product requirement.

---

### 3.3 Download URL revocation

`lib/core/download.ts` — `downloadBlob()`:

Creates an object URL, clicks an anchor, and revokes the URL after 1,000 ms with `window.setTimeout`. This is a standard pattern. The 1 second grace period is sufficient for the browser to start the download. The anchor is removed from the DOM immediately after the click. The object URL is revoked.

**Result: no resource leak is observable from the download path.**

---

### 3.4 Progress reporting

WAV export reports progress at 5% (start) and 15% (after `cutPcm()`). The WAV encode itself is one
synchronous `encodeWav()` call that produces no intermediate progress. The progress bar jumps from
15% to 100% (the `result` message triggers the `setProgress(1)` in `App.tsx`). This is
two-step deterministic progress, not smooth per-frame progress.

MP3 export reports progress every 1,152-sample block inside `encodeMp3()`, scaled to the range
`[0.15, 0.95]`. For a 5-minute file at 44,100 Hz this is approximately 11,900 callbacks. The
progress is smooth and monotonically increasing.

The `Progress` component clamps to `[0, 100]` and the `progressbar` ARIA values are correct.

**Gap:** WAV progress jumps are not user-visible for short files, but for a large file that takes
several hundred milliseconds to encode the bar sits at 15% for a perceptible pause then jumps to
100%. This is a UX polish item, not a correctness defect.

---

### 3.5 Worker crash during export

**File:** `lib/core/worker.ts` — `worker.onerror` handler

A JavaScript exception inside the worker that does not post an error message (for example, an
out-of-memory OOM crash or a host-terminated worker) fires `worker.onerror`. The handler sets
`settled = true`, terminates the worker, and rejects with "The audio worker stopped unexpectedly."
`App.tsx` catches this in the `exportAudio` catch block and shows it as the status message.

**Result: worker crashes are correctly surfaced and do not produce a download.** Verified by reading
the source; not exercised by a live browser test in this review.

---

## Section 4 — WCAG AA keyboard accessibility and reduced-motion

### 4.1 Waveform trim handles — largely aligned

**File:** `lib/tools/audio-cutter/Waveform.tsx`

| ARIA requirement | Implementation | Verdict |
| --- | --- | --- |
| Two independent focusable handles | `role="slider"` + `tabIndex={0}` on two `div` elements | ✓ |
| Accessible name | `aria-label="In point"` / `aria-label="Out point"` | ✓ |
| Current value | `aria-valuenow` and `aria-valuetext="x.xx seconds"` | ✓ |
| Dynamic min/max | `aria-valuemin` and `aria-valuemax` update as handles constrain each other | ✓ |
| Keyboard increment | ArrowLeft / ArrowRight = 0.01 s; Shift = 0.1 s | ✓ |
| Coarse increment documented | Instructions text in `p` with `aria-describedby` | ✓ |
| Live region announcement | `aria-live="polite"` region updated on keyboard move | ✓ |
| Visible focus ring | `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200` | ✓ |
| Orientation | `aria-orientation="horizontal"` | ✓ |

**One gap found:** the slider `div` is 44 px wide (`w-11`) and centered on the handle position
(`-translate-x-1/2`). When `end − start` is very small, both handles overlap and the one rendered
second in the DOM will intercept all pointer events. The keyboard path remains fully operable, but
the visual feedback for the focused element may be obscured. This is a polish item.

**Work item WI-08 — Prevent focus-target overlap when handles are at minimum separation**

- Target file: `lib/tools/audio-cutter/Waveform.tsx`
- When the distance between handle positions is less than `w-11` (44 px), offset one handle's `div` upward or adjust `z-index` so the focused one is always on top.
- Acceptance criterion: at minimum selection (0.05 s on a 10 s file) both handles are independently focusable and their focus rings do not completely obscure each other.
- Estimated effort: ≤ 30 min.

---

### 4.2 No `prefers-reduced-motion` overrides

**Files:** `components/Button.tsx`, `components/Progress.tsx`, `lib/core/dropzone.tsx`

All three components use Tailwind `transition` or `transition-all` classes. None has a
`motion-reduce:transition-none` or `motion-reduce:transition-opacity` override. The transitions are
decorative color and width changes, not large spatial movements, so they are unlikely to trigger
vestibular symptoms. However, the binding guardrails (`CLAUDE.md`) explicitly require
`prefers-reduced-motion` overrides, and `docs/PRODUCT-SPEC.md` lists it as a required behaviour.

**Work item WI-09 — Add `motion-reduce:transition-none` to all animated components**

- Target files: `components/Button.tsx`, `components/Progress.tsx`, `lib/core/dropzone.tsx`
- Add `motion-reduce:transition-none` to every `transition` or `transition-all` class.
- No new tests needed; the changes are CSS-only and the current render test for `Waveform` already passes.
- Acceptance criterion: when `prefers-reduced-motion: reduce` is active in browser settings, the button hover, progress fill width, and dropzone border transitions do not animate. Verify manually in one browser.
- Estimated effort: ≤ 15 min.

---

### 4.3 Status text contrast

**File:** `entrypoints/app/App.tsx` — bottom `p` element

The status line uses `text-emerald-100/60`, which is approximately `#d1fae5` at 60 % opacity over
`#07110f`. The rendered colour is approximately `#6e9080`. The contrast ratio of `#6e9080` on
`#07110f` is approximately 3.4 : 1, which falls below the WCAG AA threshold of 4.5 : 1 for normal
text at 14 px.

This cannot be verified mechanically without a browser color picker, but the 60 % opacity muted text
style is applied to several secondary labels in the cutter (`text-emerald-100/60` and
`text-emerald-100/70`) and is the most likely contrast failure. The 70 % variant raises the ratio to
approximately 4.0 : 1, still below 4.5 : 1 for 14 px text.

**Work item WI-10 — Verify and fix muted-text contrast ratios**

- Target files: `entrypoints/app/App.tsx`, `assets/tailwind.css`
- Use a browser DevTools colour-picker or automated contrast tool to measure the exact ratio of `text-emerald-100/60` and `text-emerald-100/70` on the page gradient.
- If either fails 4.5 : 1, increase the opacity or lighten the text colour until the ratio passes for all normal-weight 14 px instances.
- Acceptance criterion: all muted-text labels meet WCAG AA 4.5 : 1 against the rendered background. Record the measured ratios in the PR.
- Estimated effort: ≤ 30 min.

---

### 4.4 Status line does not distinguish state types by more than colour

**File:** `entrypoints/app/App.tsx`

The `aria-live="polite"` status region changes text content for success, error, decode, export, and
idle states. Success ("Done.") and error ("This browser could not decode…") are both presented in
the same 14 px muted-text style with no icon, prefix, or structural distinction. The
`docs/PRODUCT-SPEC.md` accessibility section requires that "cancellation, errors, and completed
downloads must be perceivable without relying on colour alone."

Because the status text currently uses the same emerald-100/60 colour for all states — not using
red for errors or green for success — status type already does not rely on colour. However, an
assistant-technology user relying solely on the live region hears "Done." or an error message without
a semantic prefix (e.g. "Error:" or "Success:").

**Work item WI-11 — Add semantic prefixes to error and success status messages**

- Target file: `entrypoints/app/App.tsx`
- Prepend "Error:" to status messages that represent decode or export failures, and keep success messages as-is or prefix with a visible non-colour cue (e.g. a checkmark character in the text).
- Acceptance criterion: a screen-reader user hears "Error: This browser could not decode that audio file." rather than just the message body, without requiring the user to have previously read the colour.
- Estimated effort: ≤ 20 min.

---

### 4.5 Dropzone focus ring

**File:** `lib/core/dropzone.tsx`

The `div` with `role="button"` has `tabIndex={0}` but no explicit focus-ring style. It inherits the
browser default (a thin blue outline on Chrome, a blue glow on Firefox). This is acceptable
behaviour but inconsistent with the waveform handles which use an explicit amber `focus-visible`
ring. The deviation from the shipped design token was not flagged by the lint or type check.

No blocking defect; noted as a polish item for WCAG 2.4.7 (Focus Visible) compliance evidence.

---

## Section 5 — Chrome and Firefox build parity

### 5.1 Built manifests

Both production manifests were inspected:

| Field | Chrome | Firefox |
| --- | --- | --- |
| `manifest_version` | 3 | 3 |
| `permissions` | `[]` | `[]` |
| `host_permissions` | absent | absent |
| `content_security_policy.extension_pages` | Identical 11-directive default-deny policy | Identical 11-directive default-deny policy |
| `background` | `service_worker: "background.js"` | `scripts: ["background.js"]` |
| `browser_specific_settings.gecko` | present (Firefox ignores it, Chrome ignores it) | present |

The Firefox MV3 background difference (`scripts` vs `service_worker`) is the correct WXT-generated
distinction. Both CSPs pass `validateManifest` and `validateManifestEgress`.

**Result: build parity confirmed at the manifest and artifact-size level.**

### 5.2 Vendor script loading in the worker

The built encode worker at `.output/chrome-mv3/assets/encode.worker-*.js` contains:

```
importScripts(new URL(`../vendor/lame.min.js`, self.location.href).href)
```

The `lame.min.js` file is present in `.output/chrome-mv3/vendor/` and `.output/firefox-mv3/vendor/`.
The relative path from `assets/` resolves to `vendor/lame.min.js` at the extension root. This is
verified correct for both browser layouts.

### 5.3 Runtime parity not verified in this review

The e2e tests (`tests/e2e/audio-cutter.firefox.spec.ts`) require a built Firefox extension loaded
through `web-ext` + Playwright. The `npm run test:e2e` command is not run as part of `npm run check`
(it requires `playwright install firefox` which is not available in the current environment), so
runtime behaviour on Chrome and Firefox is **not verified by this QA review**. The e2e tests that do
exist cover the happy path, MP3 export, cancel, and a corrupt-input rejection case against a local
HTTP server. Chrome runtime behaviour has no corresponding e2e test file.

**Work item WI-12 — Add Chrome e2e smoke test mirroring the Firefox e2e test**

- Target file: `tests/e2e/audio-cutter.chrome.spec.ts` (new file)
- Mirror the four existing Firefox e2e test cases: load+decode+keyboard-trim+WAV export, MP3 export, cancel without partial download, corrupt-input rejection.
- Acceptance criterion: `npm run test:e2e` (or a new `test:e2e:chrome` script) passes on both browsers before any Phase-1 UI PR is merged.
- Estimated effort: ≤ 45 min (mostly copy-adapt from the Firefox spec).

---

## Section 6 — UX fidelity vs `docs/DESIGN.md` and mocks

### 6.1 Design token alignment — verified

All shipped DESIGN.md tokens were checked against the production source. No divergence was found:

- Page gradient, card, badge, dropzone, progress, button, cancel button: match.
- Waveform height (`h-56`), amber handle colour (`bg-amber-400`), waveform stroke (`#34d399`): match.
- Timecodes (`font-mono text-sm text-amber-200`): match.
- "Choose another" is a raw `button` with the ghost-button class pattern, consistent with DESIGN.md ghost spec.

### 6.2 Tool picker and Phase-1 suite are absent from the app

`mocks/home.html` depicts a home screen with Audio Cutter, Audio Joiner, Audio Converter, and Speed
Changer as distinct cards. The shipped app (`entrypoints/app/App.tsx`) renders only the Audio Cutter
with no navigation, tool picker, or routing. The three Phase-1 cores (`join`, `change-speed`,
`convert`) are correctly implemented as pure logic modules but have no UI entry point. docs/ROADMAP.md
correctly marks these as in-progress.

This is an expected gap at the current phase and is not a bug. The home mock represents a target
state. Each Phase-1 PR adding a tool UI will address this incrementally.

### 6.3 Capability detection — absent for export formats

DESIGN.md specifies: "Unsupported formats remain visible but disabled, with adjacent capability copy
that says why." The current format selector has two options (`wav` and `mp3`); both are always
enabled. There is no browser capability probe for `AudioEncoder` or any alternative encode path.
Because `lamejs` is fully bundled and WAV is native PCM, no capability failure can occur in practice.
The DESIGN.md requirement becomes material when additional formats (AAC, OGG) are added in Phase 2.

No blocking defect for Phase 1. Noted as a future-proofing item to keep in scope for the next tool
PR.

### 6.4 Status copy fidelity — verified

Every DESIGN.md state table entry was checked against `App.tsx`:

| State | DESIGN.md status | Shipped status |
| --- | --- | --- |
| Empty | "Drop an audio file to begin." | `'Drop an audio file to begin.'` ✓ |
| Loading/decoding | "Decoding audio locally…" | `'Decoding audio locally…'` ✓ |
| Ready | "Drag the gold handles…" | `'Drag the gold handles to choose the part you want.'` ✓ |
| Progress | "Encoding WAV in a worker…" | `` `Encoding ${format.toUpperCase()} in a worker…` `` ✓ |
| Success | "Done. Your download was created without uploading the file." | `'Done. Your download was created without uploading the file.'` ✓ |
| Decode error | "This browser could not decode that audio file. Try WAV, MP3, M4A, or OGG." | `'This browser could not decode that audio file. Try WAV, MP3, M4A, or OGG.'` ✓ |
| Export error | Engine message or "Export failed." | `error.message` or `'Export failed.'` ✓ |
| Cancel | "Export cancelled." | `error.message` where cancel rejects with "Export cancelled." ✓ |

All status strings match.

### 6.5 `docs/THIRD-PARTY.md` is missing required fields for `lamejs`

**File:** `docs/THIRD-PARTY.md`

The current BOM records the package name, version, SPDX licence, and purpose. The guardrails require
notices, source/relink obligations, and artifact-specific build details. For `lamejs` (LGPL-3.0):

- No copy of the LGPL-3.0 notice or the full licence text is included.
- No documentation of the reproducible source relationship between `public/vendor/lame.min.js` and the npm package.
- `lame.min.js` is a minified custom build; the exact build command or source version that produced it is not recorded.
- The store submission (AMO and Chrome Web Store) requires a corresponding source package for LGPL works.

**Work item WI-13 — Complete `lamejs` provenance in `docs/THIRD-PARTY.md`**

- Target file: `docs/THIRD-PARTY.md`
- Add: the full LGPL-3.0 notice text, a statement of the corresponding-source obligation (AMO requires a `sources.zip` for LGPL works), the exact build command or provenance note for `public/vendor/lame.min.js`, and its SHA-256 digest.
- Acceptance criterion: `docs/THIRD-PARTY.md` records everything required by the guardrails and by AMO's source-submission review checklist for an LGPL-licensed file in the package.
- Estimated effort: ≤ 30 min.

---

## Section 7 — Phase-1 core module review

### 7.1 Join (`lib/tools/join/join.ts`)

**Correct:** ordering, resampling to the highest rate, mono-to-stereo upmix by channel-zero duplication, 512 MiB aggregate PCM limit, track-validation errors.

**Gaps:**
- No maximum track count limit. An API caller passing 1,000 tracks could trigger many allocations before the byte limit fires. (Low priority for a UI tool; the UI will limit the queue size independently.)
- `normalizedFrameCount()` uses `Math.round((frameCount × outputRate) / sourceRate)`. For very short tracks at large rate ratios the rounding can produce a one-frame discrepancy from expected duration. This is correct by design but untested at extremes.
- Runs on main thread (WI-05 above).

### 7.2 Change speed (`lib/tools/change-speed/changeSpeed.ts`)

**Correct:** `clampSpeedFactor` correctly bounds to `[0.25, 4]`, linear interpolation, channel preservation, identity copy at 1×, empty and single-frame edge cases, malformed-PCM rejections.

**Gaps:**
- No output-size limit (WI-06 above).
- Speed multiplier is clamped silently rather than throwing when the input is outside the valid range. The clamp is the correct UX behaviour (the UI slider will enforce limits) but the error message returned by `clampSpeedFactor` when given an invalid (zero, negative, NaN, Infinity) value says "Speed factor must be a positive finite number." This message is thrown, not a soft clamp — good. The clamp only applies when the factor is finite but outside `[0.25, 4]` — this is correct.

### 7.3 Convert (`lib/tools/convert/convert.ts`)

**Correct:** input validation (channel count, sample rate, frame count, sparse array), 512 MiB PCM limit, format-list membership check, snapshot-before-encoding to prevent mutation races.

**Gaps:**
- WAV encoding runs on main thread (WI-04 above).
- The cancel race window for WAV is real but benign for small files (the typical convert case). It is a correctness concern for large files if cancel is needed.

---

## Section 8 — Engineering and provenance

### 8.1 Dependency version pinning

All three direct dependencies and all dev dependencies in `package.json` use caret (`^`) ranges.
The `package-lock.json` resolves these to exact versions, and CI uses `npm ci` which enforces the
lockfile. The guardrails require exact pins in `package.json` itself, not just the lockfile.

| Package | package.json range | Resolved version |
| --- | --- | --- |
| `react` | `^19.2.4` | 19.2.4 |
| `react-dom` | `^19.2.4` | 19.2.4 |
| `lamejs` | `^1.2.1` | 1.2.1 |

In practice the lockfile prevents upgrades during `npm ci`. The risk is that `npm install` (without
`ci`) can silently upgrade to a new minor version. Because all three resolved versions happen to be
the minimum of their range, no drift has occurred yet. The fix is to drop the caret in `package.json`.

**Work item WI-14 — Pin exact versions in `package.json`**

- Target file: `package.json`
- Remove `^` from all direct and dev dependency version strings. Regenerate `package-lock.json` with `npm install`.
- Acceptance criterion: `package.json` contains no `^`, `~`, `>=`, or `latest` range specifiers. `npm ci` continues to install the identical resolved versions.
- Estimated effort: ≤ 20 min.

### 8.2 `npm audit` result

`npm audit --omit=dev` reported **0 vulnerabilities** for production dependencies. The full `npm audit` reported 9 advisories in development-only packages. These are not shipped and are deferred to a routine maintenance window.

---

## Work-item summary

| ID | Title | Target files | Estimated effort |
| --- | --- | --- | --- |
| WI-01 | Guard `encodeWav()` against RIFF chunk-size overflow | `lib/tools/audio-cutter/audio.ts`, `tests/audio.test.ts` | ≤ 30 min |
| WI-02 | Expose MP3 channel-downmix policy before export | `entrypoints/app/App.tsx`, `lib/tools/audio-cutter/encode.worker.ts` | ≤ 45 min |
| WI-03 | Add pre-decode and post-decode limits to Audio Cutter | `entrypoints/app/App.tsx` | ≤ 45 min |
| WI-04 | Move convert WAV encoding to the shared worker | `lib/tools/convert/convert.ts`, `tests/convert.test.ts` | ≤ 40 min |
| WI-05 | Move join resampling and speed resampling into the worker | `lib/tools/join/join.ts`, `lib/tools/change-speed/changeSpeed.ts`, `lib/core/worker.ts`, `lib/tools/audio-cutter/encode.worker.ts` | > 1 h — architectural |
| WI-06 | Add output-size guard to `changeSpeed()` | `lib/tools/change-speed/changeSpeed.ts`, `tests/changeSpeed.test.ts` | ≤ 30 min |
| WI-07 | Hide Cancel button during decode or provide inert feedback | `entrypoints/app/App.tsx` | ≤ 30 min |
| WI-08 | Prevent focus-target overlap when handles are at minimum separation | `lib/tools/audio-cutter/Waveform.tsx` | ≤ 30 min |
| WI-09 | Add `motion-reduce:transition-none` to all animated components | `components/Button.tsx`, `components/Progress.tsx`, `lib/core/dropzone.tsx` | ≤ 15 min |
| WI-10 | Verify and fix muted-text contrast ratios | `entrypoints/app/App.tsx`, `assets/tailwind.css` | ≤ 30 min |
| WI-11 | Add semantic prefixes to error and success status messages | `entrypoints/app/App.tsx` | ≤ 20 min |
| WI-12 | Add Chrome e2e smoke test mirroring the Firefox e2e test | `tests/e2e/audio-cutter.chrome.spec.ts` (new) | ≤ 45 min |
| WI-13 | Complete `lamejs` provenance in `docs/THIRD-PARTY.md` | `docs/THIRD-PARTY.md` | ≤ 30 min |
| WI-14 | Pin exact versions in `package.json` | `package.json` | ≤ 20 min |

WI-01 through WI-04 and WI-06 through WI-14 are each independently bounded to under one hour. WI-05
is the only item requiring a larger architectural PR.

---

## What could not be verified in this review

The following areas require a live browser and could not be verified by source inspection alone:

1. **Runtime AudioContext behaviour on Chrome versus Firefox.** `decodeAudioData` on large or unusual containers (e.g. FLAC, OPUS) may differ. The e2e suite covers only a synthetic WAV fixture.
2. **Actual contrast ratios.** Measurements in WI-10 require a colour picker against the rendered gradient, not the declared CSS values.
3. **Screen-reader announcement fidelity.** The ARIA attributes on the waveform handles are correct by inspection, but the actual announcement text and timing in NVDA, VoiceOver, or Orca were not verified.
4. **Worker OOM behaviour under memory pressure.** The worker termination and error-path tests are unit-level; the real browser's OOM response to a very large encode is not exercised.
5. **Chrome MV3 service-worker lifecycle.** The background `service_worker` will be terminated after inactivity. The app page owns all state, so this should be harmless, but it was not verified by a timed-idle test.
6. **Firefox 130+ WebCodecs availability** and the channel/codec matrix for any future Phase-2 features are not tested here. No Phase-2 tools ship yet, so this is a forward-planning note only.
