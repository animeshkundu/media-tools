# Plan: Audio Cutter waveform keyboard accessibility

Date: 2026-07-12

Controller correlation marker: `unit-id: 2a16e923-8337-4173-8f7f-3bf7dc593b35`

## Files

Implementation changes:

1. `lib/tools/audio-cutter/Waveform.tsx`
2. `tests/Waveform.test.ts`

No implementation changes will be made to `entrypoints/app/App.tsx`, `wxt.config.ts`, another tool,
test configuration, dependencies, or unrelated documentation.

## Step-by-step implementation

1. Establish explicit keyboard constants and a small deterministic boundary-adjustment function in
   `Waveform.tsx`. Map Left/Down to earlier and Right/Up to later; use 0.01 seconds as the fine step
   and Shift+Arrow as a 1-second coarse step. Preserve the existing minimum selection and clamp
   safely at the media and opposite-handle bounds.
2. Retain the canvas as the visual and pointer surface, but place it in a positioned wrapper with two
   independent overlaid trim-handle controls. Keep pointer behavior unchanged and ensure the
   overlays do not intercept ordinary canvas dragging outside their targets.
3. Give the controls slider semantics, deterministic Tab order, distinct In/Out names, numeric and
   human-readable current values, constrained minimum/maximum values, and a shared accessible
   description that documents fine and coarse key commands.
4. Add high-contrast focus-visible treatment and a practical hit target while preserving the
   emerald/amber design tokens and explicit In/Out wording. Do not add motion; if any visual
   transition is necessary, pair it with the reduced-motion utility.
5. Handle only supported arrow keys, prevent page scrolling for those keys, calculate the next
   controlled range, call `onChange`, and update an atomic `aria-live="polite"` message with the
   boundary name, new value, and selected duration. Keep this announcement inside `Waveform`
   because the owned parent callback has no status-update channel and `App.tsx` is out of scope.
6. Add `tests/Waveform.test.ts` under the existing Node Vitest configuration. Directly test fine and
   coarse key mapping, both handles, all arrow directions, opposite-handle/minimum-selection clamps,
   media-bound clamps, unsupported keys, invalid duration, and stable decimal math.
7. In the same focused test, server-render `Waveform` and assert that both handles are independently
   focusable sliders with distinct names, current values, constrained ranges, and keyboard
   instructions. Assert that the polite live region and non-color In/Out wording are present.
8. Confirm the test fails against the pre-change implementation, then passes with the implementation.
   Do not skip, weaken, or remove existing tests.

## Verification

1. Run the focused Vitest file and retain its actual output.
2. Run `npm run check` and retain the complete compile, lint, and test output.
3. Run `npm run build` and `npm run build:firefox`; inspect that both production artifacts complete
   with the same waveform behavior and no new permissions or network dependencies.
4. Load each built extension and drive Audio Cutter with a real audio fixture:
   - Tab to In and Out independently.
   - Exercise fine and Shift-modified coarse movement in both directions.
   - Verify bounds and minimum selection.
   - Confirm visible In/Out/selected-duration text updates.
   - Confirm focus remains visible and each new value is announced politely.
   - Enable reduced motion and verify there is no animated movement or focus transition.
   - Confirm pointer dragging still selects the nearest boundary.
5. Capture browser evidence for the UI-impacting change and report any browser or assistive-technology
   limitation explicitly.
6. Scan both changed implementation files for secrets before committing.
7. Run parallel code review and CodeQL validation after committing. Treat the production UI and
   interaction changes as non-trivial for CodeQL, address valid findings, and re-run validation after
   significant fixes.
8. Use a Conventional Commit message. Include this trailer in the first implementation commit:

   `unit-id: 2a16e923-8337-4173-8f7f-3bf7dc593b35`

## Acceptance-criteria verification matrix

1. **Cut-region accuracy:** Not changed by this work unit. Run the existing suite as a regression
   check and explicitly report that decode round-trip proof belongs to its owning work unit.
2. **Keyboard waveform accessibility:** Verify in the focused tests and both built browsers that each
   handle is independently focusable, named, valued, documented, bounded, and announced; verify
   non-color labels, focus contrast, and reduced-motion behavior.
3. **No-egress CSP:** Not changed and prohibited by ownership. Confirm builds did not alter manifests;
   do not claim the existing CSP mission criterion is completed here.
4. **Worker-owned heavy work:** Not changed and prohibited by ownership. Confirm keyboard interaction
   does not start heavy work; report worker/decode requirements as outside this unit.
5. **Offline:** No network code is added. Exercise the affected cutter UI with networking disabled as
   a regression check, while reporting full WAV/MP3 offline proof as owned elsewhere.
6. **Export:** No encoder or decode path is changed. Use the real-file browser exercise to ensure
   keyboard-selected ranges still reach the existing export flow; do not claim new format accuracy.
7. **Other Phase-1 tools:** Not changed and prohibited by ownership. Report join, convert, and speed
   as outside this unit.
8. **Engineering:** Require `npm run check`, Chrome build, Firefox build, no dependency changes, a
   secret scan, and no prohibited attribution. Include actual command output in the implementation
   handoff.
9. **UI and WCAG AA:** Preserve the dark emerald waveform and amber boundaries; verify a
   high-contrast focus indicator, keyboard operation, target sizing, textual In/Out identification,
   live announcements, and reduced-motion behavior in both browsers.

## Key risks and mitigations

- **Pointer regression:** keep the existing pointer handler and test/manual-check nearest-boundary
  dragging after adding overlays.
- **Boundary divergence:** centralize keyboard clamping around the same minimum-selection rule as
  pointer input and cover both handles at every bound.
- **Screen-reader duplication:** use one concise, atomic polite message and native slider values;
  avoid assertive announcements.
- **Canvas/overlay alignment:** derive both overlay positions from the same controlled props and safe
  duration used for drawing.
- **Test-environment limits:** combine pure interaction-math tests with server-rendered semantic
  assertions, then complete real Chrome and Firefox keyboard verification.
- **Scope creep:** do not edit the parent status API, CSP, workers, export code, dependencies, or
  other tools; report mission-level gaps rather than silently broadening this PR.
