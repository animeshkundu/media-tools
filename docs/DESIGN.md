# Audio Studio design system and flows

Scope: the shared React editor shipped as the Chrome and Firefox extension and as the hosted app at `/media-tools/app/`, plus the static product site. The implementation sources are [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx), [`lib/tools/multitrack/MultitrackTool.tsx`](../lib/tools/multitrack/MultitrackTool.tsx), [`lib/tools/multitrack/CanvasTimeline.tsx`](../lib/tools/multitrack/CanvasTimeline.tsx), and [`assets/tailwind.css`](../assets/tailwind.css).

## Product idea

Audio Studio is one local editing workspace, not a dashboard of disconnected transforms. A user imports WAV or MP3 assets once, arranges clips on a shared timeline, previews the mix, applies edits in context, and exports one WAV or MP3 result.

The web app and extension render the same `App` component. Product capability, layout, accessibility, and media behavior must not drift between surfaces. Only trust copy changes:

- **Hosted app:** files are processed locally in the current browser tab with no upload or telemetry. The page remains code delivered by a website.
- **Extension:** the same local processing is reinforced by zero install-time permissions, bundled executable code, and the no-egress extension-page CSP.

## Principles

1. **Import once.** File selection is global to the project. Existing assets can create more clips without another read or decode.
2. **Edit in context.** Selection connects the media library, inspector, transport, and timeline. Speed, gain, fades, EQ, pan, mute, solo, and split/delete controls act on the visible selection.
3. **Make the timeline primary.** Arrangement, zoom, trim, move, snap, playhead, and skimming share one full-width Canvas surface.
4. **Keep source media immutable.** Timeline operations change serializable offsets and mix settings, never raw source buffers.
5. **Keep long work accountable.** Decode, mix, and encode expose progress and cancellation; failed or cancelled jobs produce no partial download.
6. **State trust precisely.** “Local processing, no upload” applies to both surfaces. Zero permissions and the no-egress CSP describe only the extension.
7. **Stay calm and dense.** Graphite surfaces and restrained blue selection echo desktop iMovie. Yellow is reserved for clip boundaries, rose for the playhead/recording, and red for destructive actions and errors.

## Visual language

| Role | Value | Usage |
| --- | --- | --- |
| App base | `#0e0f12` / `#111216` | Window and workspace |
| Pane | `#202126` | Library and inspector |
| Toolbar | `#25262b` | Editing and transport controls |
| Timeline | `#1c1d21` / `#15171b` | Track headers and Canvas |
| Primary text | `#f4f5f7` | Titles, filenames, time |
| Muted text | White at 38% to 65% | Metadata and explanations |
| Primary accent | `#4ca8ff` / `#62b4ff` | Import, export, selected controls, clips |
| Trim boundary | Amber 300 | Selected clip edges and fades |
| Playhead / recording | Rose 300 | Time cursor and microphone state |
| Error / destructive | Red 200–400 | Delete hover, cancellation, alert toast |
| Border | White at 8% to 12% | Pane and control separation |

Use system sans-serif for UI copy and system monospace for time. Pane labels are 10–11 px uppercase with wide tracking; filenames and section headings carry hierarchy. The studio favors compact 6–12 px radii rather than landing-page cards.

## Three-pane desktop workspace

At 1280 px and wider the editor occupies the viewport below the 64 px app header:

1. **Media library, top-left.** Multi-file import, destination-track choice, generated tone/silence/click assets, immutable asset rows, asset reuse, and the voice-over policy.
2. **Viewer and inspector, top-right.** Project time and activity state, selected-track volume/pan/role/EQ, selected-clip speed/gain/fades, and opt-in ducking. Advanced ducking thresholds are collapsed until requested.
3. **Multitrack timeline, bottom full-width.** Track headers and a synchronized Canvas with clips, waveforms, trim edges, playhead, zoom, snapping, skimming, mute, and solo.

The editing toolbar sits above the content panes; the transport/master bar sits between inspector and timeline. They coordinate the three panes and are not separate content destinations. Desktop uses an internal, non-page-scrolling workspace so transport feedback and timeline remain visible together. Below 1280 px the library and inspector stack and normal page scrolling returns.

At 1280 px and wider, the divider between Media and Inspector and the divider above the Timeline are adjustable. Pointer drag changes the pane split; arrow keys make precise changes, Shift uses a larger step, Home and End move to safe bounds, and Enter or double-click restores the default. Sizes last for the current React session only, consistent with the session-only project contract. The controls preserve minimum useful editing space and disappear when the panes stack below the desktop breakpoint.

## Core flows

### Empty project

- Keep Import media as the strongest action.
- Show the whole editor so the interaction model is discoverable before a file is chosen.
- Disable edit, preview, and export controls that require a clip.
- Explain session-only storage and immutable assets without implying persistence.

### Import and arrange

- Accept one or many WAV/MP3 files through the same hidden file input or drag target.
- Decode and analyze sequentially in workers while enforcing per-file and aggregate limits.
- Add imported files sequentially to the chosen track and select the newest clip.
- Keep every source in the library with a `+` action that creates another clip from the existing PCM.
- Draw only visible time and track ranges and choose a bounded peak-pyramid level for the current zoom.

### Edit and audition

- The selected clip exposes 0.25x–4x coupled speed/pitch, 0%–500% gain, independent fades, and fade curve.
- The selected track exposes volume, pan, role, and EQ preset.
- Split uses the playhead; Delete removes only the clip and retains its source asset.
- Dragging moves clips; dragging amber edges trims. Magnetic snapping targets zero, playhead, beat grid, and clip boundaries within 10 screen pixels.
- Play/Pause previews the complete project. Audio skimming is explicit opt-in and auditions beneath the pointer.
- Voice-over is explicit opt-in. Record starts the browser prompt, Stop creates one bounded local mono asset, and Discard releases the stream without adding a clip.

### Export

- WAV and MP3 format choice remains adjacent to one Export action.
- Worker progress and Cancel occupy the transport, where they remain visible.
- Success appears in the persistent transport status. Errors appear as a fixed `role="alert"` toast without shifting the timeline.
- A browser download starts only after a complete worker result.

## States and accessibility

| State | Behavior |
| --- | --- |
| Empty | Studio visible, import enabled, media-dependent controls disabled. |
| Importing | Conflicting controls disabled, determinate progress and Cancel exposed. |
| Ready | Selection joins library, inspector, transport, and timeline. |
| Recording | Rose recording state, elapsed time, Stop and Discard, stream cleanup on every exit. |
| Exporting | Format locked, progress and Cancel visible, no duplicate export. |
| Success | One download and an `aria-live="polite"` local-processing confirmation. |
| Error | Useful `role="alert"` toast with the project still recoverable. |

Canvas is not the only accessible surface. Mute/solo and inspector controls are native elements; a hidden DOM clip list provides equivalent selection; the Canvas is focusable and documents Left/Right nudging (0.01 seconds, Shift for 0.1) plus Home/End playhead movement. All form controls have labels, status is polite, errors are assertive, and motion must respect `prefers-reduced-motion`.

## Production evidence

The 1728 × 1117 real-Firefox captures live under [`media/screenshots/`](media/screenshots/):

- `audio-studio-empty.png`
- `audio-studio-imported.png`
- `audio-studio-edited.png`
- `audio-studio-exported.png`
- `audio-studio-error.png`

`npm run capture` rebuilds and installs the production Firefox artifact, drives those states at 1728×1117, validates the MP3 download, and replaces the committed images.
