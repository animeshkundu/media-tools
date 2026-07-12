# Research: Audio Cutter waveform keyboard accessibility

Date: 2026-07-12

Controller correlation marker: `unit-id: 2a16e923-8337-4173-8f7f-3bf7dc593b35`

## Scope

The implementation work unit owns only:

- `lib/tools/audio-cutter/Waveform.tsx`
- A focused Vitest file for `Waveform`

The requested research and plan documents are planning artifacts. The implementation must not edit
`entrypoints/app/App.tsx`, `wxt.config.ts`, another tool, or unrelated documentation.

## Sources reviewed

- `CLAUDE.md`: cross-browser, strict TypeScript, design-system, testing, build, and real-browser
  verification guardrails.
- `AGENTS.md`: repository architecture and the requirement to preserve the durable app-page host.
- `.github/instructions/tests.instructions.md`: deterministic, isolated Vitest coverage that directly
  exercises every behavior change.
- `docs/PRODUCT-SPEC.md:56-70,281-287`: each trim handle must be independently focusable, expose its
  name and current value, support documented keyboard increments, update the selection, and announce
  its new value through a polite live region.
- `docs/DESIGN.md:18-39,82-84,141-156`: the waveform uses emerald peaks, amber boundaries, textual
  In/Out values, and a polite live-status pattern; state must not depend on color alone.
- `docs/PEER-REVIEW.md`: the accepted cross-cutting findings do not expand this UI-only work unit into
  CSP, worker decode, or other architecture changes.
- `mocks/audio-cutter.html:220-238`: the visual reference renders amber boundary lines and explicit
  In, selected-duration, and Out text.
- `lib/tools/audio-cutter/Waveform.tsx`: current implementation and boundary math.
- `entrypoints/app/App.tsx:123-137,173-175`: `Waveform` receives controlled `start`, `end`, and
  `onChange` values; the app displays textual values and has a polite status region, but `onChange`
  does not update that parent status.
- `vitest.config.ts` and `tests/audio.test.ts`: tests run in Node, include `tests/**/*.test.ts`, and
  currently have no component-DOM test harness.

## Current behavior and gaps

1. `Waveform` returns a single canvas. A canvas cannot expose two independently focusable trim
   handles, slider values, or per-handle names to assistive technology.
2. Pointer movement chooses the nearest boundary and enforces a minimum selection of
   `min(0.05 seconds, duration / 2)`. Keyboard behavior must share this constraint so pointer and
   keyboard input cannot create contradictory ranges.
3. The canvas label says “Drag the gold trim handles.” This describes the boundaries by color and
   pointer interaction only. It does not provide non-color identity or keyboard instructions.
4. The parent `onChange` callback only updates `start` and `end`; it does not update the existing app
   status text. Because `App.tsx` is explicitly out of scope, `Waveform` must preserve the same
   `aria-live="polite"` contract locally for boundary announcements rather than manipulating the DOM
   or expanding the parent API.
5. The waveform currently has no animation. Any focus or interaction treatment should remain
   instantaneous. If a transition is introduced, it must explicitly disable under
   `prefers-reduced-motion`.
6. The Node Vitest environment has no configured browser DOM. A focused test can still verify the
   keyboard-to-boundary function directly and use React server rendering to inspect initial slider
   semantics without adding a dependency or changing test configuration.

## Recommended behavior

- Wrap the canvas in a positioned container and overlay two transparent, full-height interactive
  targets aligned to the painted boundaries.
- Give each target `role="slider"` and `tabIndex={0}` with distinct “In trim handle” and “Out trim
  handle” accessible names.
- Expose `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and a human-readable `aria-valuetext`.
  Constrain each slider's range by the opposite boundary and the existing minimum selection.
- Support Left/Down to move earlier and Right/Up to move later. Use a fine step of 0.01 seconds and a
  Shift-modified coarse step of 1 second. Put these instructions in an accessible description so
  the increments are documented where the interaction occurs.
- Prevent the handled arrow key's default scrolling, call `onChange` once with the clamped range,
  and announce the changed In/Out boundary plus selected duration in an atomic polite live region.
- Keep the visible amber boundary, add a high-contrast focus-visible outline and a sufficiently wide
  hit target, and retain textual In/Out identification so interaction and state are not color-only.
- Avoid animation. Any transition class added for focus treatment must include
  `motion-reduce:transition-none`.

## Boundary and edge-case findings

- Fine and coarse movement must clamp at `0`, `duration`, and the opposite handle minus/plus the
  existing minimum selection.
- Unsupported keys must not call `onChange` or suppress native behavior.
- A non-positive or non-finite duration should not produce NaN positions or values. The adjustment
  helper should return no change, and ARIA/position calculations should use a safe finite duration.
- Floating-point additions should be normalized to stable precision so repeated fine steps do not
  accumulate visible artifacts.
- The controlled props remain the source of truth. Announcements should describe the computed next
  values, while subsequent rendering reflects the parent-approved values.

## Acceptance-criteria impact

- **Directly addressed:** criterion 2 and the waveform-specific portions of criterion 9.
- **Regression-only verification:** criterion 8 through `npm run check`, Chrome build, and Firefox
  build.
- **Unaffected and not claimed by this work unit:** criteria 1, 3, 4, 5, 6, and 7. They concern
  export accuracy, CSP, workers, offline/export behavior, and other Phase-1 tools outside the owned
  files. The implementation handoff must report them individually as out of scope rather than imply
  they were delivered.

## Risks

- Overlay targets must remain aligned when duration or boundaries change and must not break existing
  pointer input on the canvas.
- Two controls can visually overlap for a very short selection; DOM order and independent Tab focus
  must remain deterministic.
- A local live region could duplicate value speech from native slider semantics in some screen
  readers. Keep announcements concise and use `polite`, not `assertive`.
- React server-render assertions do not replace manual Chrome and Firefox keyboard/screen-reader
  inspection. The implementation needs both automated boundary coverage and real-browser evidence.
