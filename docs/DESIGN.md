# Audio Cutter design system and flows

Scope: the shared React editor shipped as the Chrome and Firefox extension and as the hosted app at `/media-tools/app/`, plus the static product site. The implementation sources are [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx), [`assets/tailwind.css`](../assets/tailwind.css), [`site/index.html`](../site/index.html), and [`site/styles.css`](../site/styles.css).

## Product idea

Audio Cutter is a focused local studio, not a generic file converter dashboard. The interface should feel editorial and spacious while moving from local file to result with the fewest possible decisions.

The web app and extension render the same `App` component. Product capability, tool layout, accessibility, and media behavior must not drift between surfaces. Only trust copy changes:

- **Hosted app:** files are processed locally in the current browser tab, are not uploaded, and there is no telemetry. The source is auditable, but the page is still code delivered by a website.
- **Extension:** the same local processing is reinforced mechanically by zero permissions, bundled executable code, and the no-egress extension-page CSP.

## Principles

1. **Drop first.** The first meaningful control is a local file dropzone. Say “drop,” “choose,” or “open,” never “upload.”
2. **One job per view.** Keep one title, one workspace, and one obvious export action. Tool switching lives in the rail rather than competing with the active controls.
3. **Show the file as media.** The cutter gives the waveform most of the workspace, exposes exact boundaries, and provides a local source preview.
4. **Make long work accountable.** Show determinate progress when available, keep Cancel visible during work, and never imply that a failed or cancelled job produced a partial file.
5. **State trust precisely.** Do not transfer extension-only enforcement claims to the website. “No file upload” is the common product behavior; “works offline,” “zero permissions,” and “no-egress CSP” describe the extension.
6. **Stay bold but calm.** Large type establishes hierarchy. Emerald signals local progress and success, amber is exclusive to trim boundaries, and red is exclusive to cancellation, destructive actions, and errors.
7. **Design for real inputs.** Long filenames truncate safely, metadata remains scannable, and a near-limit file must not distort the shell.

## Visual language

### Core tokens

| Role | Value | Usage |
| --- | --- | --- |
| Page base | `#06100e` | Shared app and site background |
| Deep surface | `#040a08` | Landing contrast sections and elevated dark cards |
| Workspace surface | `rgba(0, 0, 0, 0.20)` | Tool cards |
| Soft surface | `rgba(255, 255, 255, 0.025)` | Controls and grouped settings |
| Primary text | `#f3fff9` | Titles and file names |
| Muted text | Emerald 100 at 53% to 60% | Explanations and metadata; stays above 4.5:1 on the page base |
| Primary accent | `#6ee7b7` | Primary actions, active tool, waveform |
| Progress | `#6ee7b7` | Determinate progress fill |
| Trim | `#fbbf24` | In/out handles only |
| Error / cancel | Red 200/300 | Error messages and explicit cancellation |
| Standard border | White at 8% to 12% | Surface separation |
| Focus | `#fcd34d` on the site, `#6ee7b7` in the app | Keyboard focus |

The app background combines a deep green base with restrained emerald and amber radial light. It must remain legible without the decoration, and decoration never receives pointer events.

### Type

- App tool titles use 36 px on small screens, 60 px from `sm`, and 72 px on wide screens, black weight, with tight negative tracking.
- Landing hero and section titles use responsive display type with a minimum 0.82 line height. Avoid all-uppercase display text.
- Eyebrows, metadata labels, and step numbers use 10–11 px, bold, uppercase text with 0.1–0.2 em tracking.
- Time values use the system monospace stack.
- Body copy stays between 13 and 18 px with generous line height.

### Shape and depth

- The main workspace and feature blocks use 32 px outer radii.
- Inner groups use 16–24 px radii.
- Controls use 12 px radii.
- Shadows are broad and low-contrast. Borders carry most surface definition.
- The active navigation item receives an emerald-tinted surface, not a high-saturation glow.

## Shared editor shell

Desktop uses a 320 px tool rail and a fluid workspace capped at 1184 px. The rail contains:

1. Product identity and current surface.
2. Five persistent tool tabs with a glyph, short label, one-line description, and index.
3. Surface-specific trust evidence and the current input/format contract.

Below 1024 px the rail becomes a compact top area and the tool tabs become a horizontally scrollable row. The editor must remain usable at 320 px without horizontal page overflow.

The workspace header names the active tool, explains the exact outcome, and shows one short trust pill. The pill reads “Works offline” in the extension and “No file upload” on the web.

## Tool workspaces

### Empty

Use a minimum 400 px drop area for single-file tools. Center one restrained line icon, a direct “Drop a WAV or MP3 file here” title, one sentence about the result, and format/limit chips where useful. The entire surface is keyboard reachable and opens the native picker with Enter or Space.

### Audio Cutter ready

- File identity and metadata occupy the card header.
- The waveform is 256 px tall on small screens and 288 px from `sm`.
- Emerald peak columns sit on a subtle horizontal grid. Audio outside the selection is dimmed; four-pixel amber lines mark In and Out.
- Each handle remains an independent ARIA slider. Arrow keys move 0.01 seconds and Shift+Arrow moves 0.1 seconds.
- A side panel provides browser-native local source playback. The preview uses a Blob URL that is revoked when the file changes or the component unmounts.
- Exact In and Out fields remain below the waveform and stay synchronized with pointer and keyboard edits.
- Export format and the primary “Cut & download” action sit together at the bottom.

### Join / Merge

The drop area remains visible so more tracks can be added. Loaded tracks appear as numbered rows with filename, metadata, ordering actions, and Remove. The aggregate decoded PCM limit remains 256 MB. Export is unavailable until at least two tracks are retained.

### Change Speed

Make the factor the visual focus. Show the numeric factor at display size, a native range control, and separate Input and Estimate duration cards. State that speed and pitch move together.

### Volume & Fades

Keep this an export-only transform rather than a live-playback surface. The left pane shows a conservative post-transform waveform estimate, source and output peak values, and a text-labeled safe, warning, or potential-clipping state. Emerald is safe, amber covers -2 dBFS through 0 dBFS, and red is reserved for estimates above 0 dBFS. The right pane groups the 0% to 500% gain slider, -1 dBFS normalization, fade-in and fade-out duration controls, and linear or logarithmic curve selection. Enabling normalization disables manual gain and explains that the final post-fade peak controls the export gain.

### Convert

Once decoded, reduce the workspace to source identity and one clear format decision. Keep WAV (“lossless PCM”) and MP3 (“192 kbps”) language visible near the action.

### Multitrack Studio

Multitrack Studio is the one deliberate exception to the single-card transform layout. It remains one job - arrange a local mix and export one WAV - but needs four coordinated regions:

1. **Media Library:** top-left asset list, bounded WAV/MP3 import, target-track selector, locally generated tone/silence/click assets, and an explicit explanation that microphone recording is unavailable.
2. **Inspector / FX Rack:** top-right selected track and clip controls for track gain, pan, role, EQ preset, clip gain, logarithmic fades, and sidechain ducking. Noise suppression remains visibly unavailable rather than a stub.
3. **Transport / Master:** a compact center bar with playhead, play/pause, disabled record policy control, seek, BPM, magnetic snap, master gain, peak meter, worker export, progress, and cancel.
4. **Timeline:** a bottom Canvas viewport with synchronized DOM track headers. Only visible time and track rows are drawn. Dialogue is emerald, music blue, SFX amber, selected trim edges amber, and the playhead rose.

At 1280 px and wider, the library and inspector share a row. Below that width they stack, while transport controls wrap and the timeline remains horizontally scrollable. Canvas is not the only accessible surface: mute/solo controls are native buttons, inspector controls provide exact keyboard operation, and clips have an equivalent hidden selection list.

## States and accessibility

| State | Behavior |
| --- | --- |
| Empty | Dropzone and local-file copy. Status announces how to begin. |
| Loading | Disable conflicting controls, show determinate progress when available, expose Cancel. |
| Ready | Show complete media/settings workspace and preserve keyboard order from file through export. |
| Exporting | Keep progress and Cancel together; disable replacement, settings, and duplicate export. |
| Success | Trigger one browser download and announce that the file was created without upload. |
| Cancelled | Announce cancellation and guarantee that no partial file was downloaded. |
| Error | Use a visible `role="alert"` with the useful engine or bounds message and leave a recovery path. |

All interactive controls need a visible `:focus-visible` ring. Tabs expose `role="tab"`, `aria-selected`, `aria-controls`, and a matching tabpanel. Status updates use `aria-live="polite"`. Motion must collapse under `prefers-reduced-motion`.

## Landing page

The landing page leads with the hosted app because it is immediately usable, while presenting the extension as an equal choice rather than a coming-soon product. Its major sequence is:

1. Large outcome-led hero and direct “Open the web app” action.
2. Real editor screenshot with a near-limit local WAV file.
3. Four-tool bento grid.
4. Side-by-side web app / extension decision cards.
5. Three-step file-to-download flow.
6. An explicit privacy comparison that separates common behavior from extension-only platform enforcement.

The static site remains script-free. It uses only bundled images, system fonts, semantic landmarks, a skip link, and `/media-tools/`-rooted internal URLs.
