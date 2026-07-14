# Audio Cutter design system and screen flows

Scope: visual and interaction guidance for the shipped offline editor and planned tool surfaces. Mocks: [Home](../mocks/home.html), [Audio cutter](../mocks/audio-cutter.html), [Batch](../mocks/batch.html), and [Settings and Pro](../mocks/pro.html).

## Design principles

1. **Drop-first, not upload-first.** The first meaningful control is a local file dropzone. The tool starts decoding or inspecting the file the instant it drops. Copy says “drop” or “choose,” never “upload.”
2. **Make local processing visible.** Keep “100% offline” near the page title. Reinforce it with “Your file never leaves your device” and “Works in airplane mode.” Basic audio cutting already runs locally on strong web competitors, so lead that flow with speed, no ads, no account, no cap, and offline access. Lead conversion, joining, and video flows with the stronger nothing-uploaded promise.
3. **Match, then beat the editor benchmark.** Match the polish of the 123apps waveform editor with clear trim handles, immediate time feedback, output controls, progress, and a direct download action. Beat it by removing ads, sign-in, watermarks, and artificial caps.
4. **Detect before work begins.** Probe browser and codec capabilities before enabling an option. Gray out unsupported formats with a short explanation instead of allowing a long job to fail late.
5. **Keep the free core frictionless.** Audio cut, join, WAV/MP3 conversion, video trim, mute, audio extraction, and basic compression need no account and have no ads, watermark, upload, or service-imposed size cap. Pro adds power and convenience rather than withholding the basic job.
6. **Stay calm and direct.** Use short labels, one clear primary action per state, and concise status text. Emerald communicates progress and completion. Amber is reserved for the active trim range. Red is reserved for cancellation and destructive actions.

## Design system

These are the shipped tokens, not a redesign. The source of truth is [`assets/tailwind.css`](../assets/tailwind.css), with composition in [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx).

### Color

| Role | Exact value | Shipped Tailwind class or CSS |
| --- | --- | --- |
| Page base | `#07110f` | `background: #07110f` |
| Page gradient | `radial-gradient(circle at top, #123b31 0, #07110f 42rem)` | `bg-[radial-gradient(circle_at_top,#123b31_0,#07110f_42rem)]` |
| Primary text | `#eefcf7` | `text-emerald-50` |
| Muted text | `#d1fae5` at 70% or 60% opacity | `text-emerald-100/70`, `text-emerald-100/60` |
| Eyebrow and hover accent | `#6ee7b7` | `text-emerald-300`, `hover:bg-emerald-300` |
| Primary accent | `#34d399` | `bg-emerald-400`, waveform stroke |
| Accent label | `#022c22` | `text-emerald-950` |
| Trim handles | `#fbbf24` | `amber-400` |
| Trim timecodes | `#fde68a` | `text-amber-200` |
| Waveform and input surface | `#0d1e1a` | `bg-[#0d1e1a]` |
| Waveform dim region | `rgba(2, 6, 5, 0.62)` | Canvas fill in `Waveform.tsx` |
| Card surface | `rgba(0, 0, 0, 0.20)` | `bg-black/20` |
| Soft surface | `rgba(255, 255, 255, 0.03)` | `bg-white/[0.03]` |
| Standard border | `rgba(255, 255, 255, 0.10)` | `border-white/10` |
| Control border | `rgba(255, 255, 255, 0.15)` | `border-white/15` |
| Dropzone border | `rgba(255, 255, 255, 0.20)` | `border-white/20` |
| Progress track | `rgba(255, 255, 255, 0.10)` | `bg-white/10` |
| Cancel border and text | `#fca5a5` at 30% for the border, `#fecaca` for text | `border-red-300/30`, `text-red-200` |
| Card shadow | `rgba(0, 0, 0, 0.30)` | `shadow-2xl shadow-black/30` |

### Type

| Role | Exact specification | Shipped Tailwind class or CSS |
| --- | --- | --- |
| Font stack | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | `font-family` in `assets/tailwind.css` |
| Color mode | Dark browser controls | `color-scheme: dark` |
| H1 | 36px below 640px, 60px from 640px, bold, tight tracking | `text-4xl sm:text-6xl font-bold tracking-tight` |
| Lead | 18px with 28px line height, muted | `text-lg text-emerald-100/70` |
| Eyebrow | 14px, semibold, uppercase, `0.22em` tracking | `text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300` |
| File title | 20px, semibold | `text-xl font-semibold` |
| Labels and status | 14px | `text-sm` |
| Timecodes | 14px system monospace | `font-mono text-sm text-amber-200` |

### Layout, spacing, and radii

| Role | Exact size | Shipped Tailwind class |
| --- | --- | --- |
| Page inset | 20px horizontal, 40px vertical | `px-5 py-10` |
| Content width | 1024px maximum, centered | `mx-auto max-w-5xl` |
| Header bottom gap | 40px | `mb-10` |
| Header flex gap | 24px | `gap-6` |
| Card padding | 20px below 640px, 32px from 640px | `p-5 sm:p-8` |
| Dropzone padding | 32px | `p-8` |
| Control padding | 16px horizontal, 12px vertical | `px-4 py-3` |
| Primary and cancel padding | 20px horizontal, 12px vertical | `px-5 py-3` |
| Ghost padding | 16px horizontal, 8px vertical | `px-4 py-2` |
| Control radius | 12px | `rounded-xl` |
| Waveform and icon radius | 16px | `rounded-2xl` |
| Card and dropzone radius | 24px | `rounded-3xl` |
| Badge and progress radius | 9999px | `rounded-full` |
| Icon tile | 56px square | `h-14 w-14` |
| Waveform height | 224px | `h-56` |
| Progress height | 8px | `h-2` |

## Primary components

### Dropzone

Use a 24px radius, a one-pixel dashed `border-white/20`, `bg-white/[0.03]`, 32px padding, and centered copy. The default icon tile is 56px, emerald, and 16px rounded. Hover changes the border to `emerald-400/70`. Active dragging changes the border to emerald-300 and the background to `emerald-300/10`. Disabled state uses a not-allowed cursor and 50% opacity. The whole zone remains keyboard reachable and opens a native file picker on Enter or Space. This behavior and token composition come from [`lib/core/dropzone.tsx`](../lib/core/dropzone.tsx).

### Waveform editor

Render the audio on a 224px high `#0d1e1a` surface with a one-pixel `border-white/10` and 16px radius. Draw one-pixel emerald `#34d399` peak columns around the vertical midpoint. Cover audio outside the selection with `rgba(2, 6, 5, 0.62)`. Draw each trim handle as a four-pixel amber `#fbbf24` line. Below it, place In, selected duration, and Out values in amber-200, 14px monospace text. Pointer input moves whichever handle is nearest while preserving a minimum selection. The shipped implementation is [`lib/tools/audio-cutter/Waveform.tsx`](../lib/tools/audio-cutter/Waveform.tsx).

### Buttons

- **Primary:** 12px radius, `bg-emerald-400`, 20px by 12px padding, semibold `text-emerald-950`, and `hover:bg-emerald-300`. Disabled state uses 50% opacity and a not-allowed cursor. See [`components/Button.tsx`](../components/Button.tsx).
- **Ghost:** 12px radius, `border-white/15`, 16px by 8px padding, and `hover:bg-white/5`. The “Choose another” action in [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx) is the shipped example.
- **Cancel:** 12px radius, `border-red-300/30`, 20px by 12px padding, semibold red-200 text, and `hover:bg-red-300/10`. Show it only while a cancellable job is active, as in [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx).

### Progress

Use an 8px high, fully rounded `bg-white/10` track with a fully rounded emerald-400 fill. Clamp values from 0 to 100 and expose `role="progressbar"`, an accessible label, and current, minimum, and maximum values. The fill width may animate, but it must remain determinate when the engine reports progress. See [`components/Progress.tsx`](../components/Progress.tsx).

### Format and settings select

Place the label above the field in 14px medium `text-emerald-100/70`. The field uses a 12px radius, `border-white/15`, `#0d1e1a`, 16px by 12px padding, and primary text. Keep native keyboard behavior. Unsupported formats remain visible but disabled, with adjacent capability copy that says why. The export control in [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx) is the shipped baseline.

### “100% offline” badge

Use a full pill with `border-emerald-300/20`, `bg-emerald-300/10`, 16px by 8px padding, 14px emerald-200 text, and no icon. It sits opposite the title at the end of the wrapping header. This exact composition ships in [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx).

### Tool-picker card

Use the card family with a 16px or 24px radius, `border-white/10`, and `bg-black/20`. Start with the shipped 56px emerald icon tile, then show a 20px semibold tool name and one muted line that describes the output. Mark availability separately from the name. “Coming” cards are visibly subdued and not actionable. A small Pro hint may identify batch or advanced-quality options, but must not imply that a free-core tool is locked. See [home.html](../mocks/home.html).

### File and batch row

Use a compact `border-white/10` row with a file icon, a truncating name, muted size and duration, and a status pill aligned to the end. Status uses neutral white for Queued, emerald for Done, and emerald plus a small determinate bar for active conversion. Keep row actions secondary. Batch itself is a Pro convenience; single-file free-core output remains available. See [batch.html](../mocks/batch.html).

### Pro and settings panel

Build settings from the shipped card, label, input, and button tokens. Toggles use a dark control track with an emerald active thumb. The Pro card clearly separates the free core from power features. Activation starts with checkout outside the extension, followed by a pasted signed license token. Validate the Ed25519 signature locally with a bundled public key and cache the entitlement in extension storage. No account or server call is required after activation. Sharing is only softly constrained by purchaser information in the token. Refund revocation cannot be guaranteed offline, so any periodic recheck is optional, opt-in, and best effort. See [pro.html](../mocks/pro.html).

## Key screens and user flows

### Home and tool picker

[home.html](../mocks/home.html) is the entry surface. It separates live Phase 1 audio tools from coming Phase 2 video tools, keeps unavailable tools visibly disabled, and places the offline trust signal in the header. The primary route is:

1. Open Audio Cutter.
2. Pick an available tool.
3. Drop or choose a local file.
4. Edit the range or output settings.
5. Export.
6. Receive the download and a clear done status.

### Flagship audio cutter

[audio-cutter.html](../mocks/audio-cutter.html) follows the shipped [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx) layout closely. After drop, decode immediately, show the file and metadata, set the whole file as the initial range, and invite the user to drag the gold handles. Keep format next to the primary “Cut & download” action. During export, disable conflicting controls, reveal Cancel, show determinate progress, and update the bottom status line. On success, download the result directly and confirm that it was created locally.

### Batch conversion

[batch.html](../mocks/batch.html) shows the Pro multi-file route. A multi-file drop creates one row per file, capability checks run before the queue starts, shared format and bitrate settings apply to every compatible row, and each row reports Queued, Converting, Done, or an actionable error. Overall progress and Cancel remain visible during work. “Export all” produces normal downloads unless an optional browser-specific folder picker is available.

### Pro unlock

[pro.html](../mocks/pro.html) keeps general settings and licensing in one calm surface. Free users retain the complete free core. A user who wants batch and advanced formats buys a one-time license outside the extension, pastes the signed key, and activates it through local verification. The unlocked entitlement is stored on the device and continues to work offline without an account.

## States

The flagship tool uses one stable page shell and swaps the work area without changing visual language.

| State | UI behavior | Status and accessibility |
| --- | --- | --- |
| Empty | Show the audio dropzone, icon tile, and “Drop an audio file here.” | Bottom status: “Drop an audio file to begin.” |
| Loading and decoding | Keep the dropzone visible but disabled at 50% opacity. Start work immediately after drop. | Bottom status: “Decoding audio locally…” |
| Ready and editing | Show the file panel, metadata, waveform, trim handles, timecodes, format select, ghost action, and primary export action. | Bottom status: “Drag the gold handles to choose the part you want.” The waveform has an accessible label that identifies the gold trim handles. |
| Progress and cancel | Disable file replacement, format changes, and export. Show Cancel and a determinate emerald progress bar. | Bottom status names the local job, for example “Encoding WAV in a worker…” Progress exposes `role="progressbar"` and numeric ARIA values. |
| Success | Fill progress to 100%, create the download, and return controls to ready state. | Bottom status: “Done. Your download was created without uploading the file.” |
| Decode error | Return to a usable empty state and preserve the selected file only if recovery is possible. | Bottom status: “This browser could not decode that audio file. Try WAV, MP3, M4A, or OGG.” |
| Capability unavailable | Gray out the unsupported format or tool before processing. Keep alternatives enabled. | Place a concise reason beside the disabled control, such as “AAC export is not available in this browser.” Do not wait for export to fail. |
| Export error | Stop progress, release the active job, and restore safe controls. | Show the engine message when it is useful, otherwise “Export failed.” |

The shipped page places the status in a centered, muted 14px line with `aria-live="polite"` so decoding, editing, export, success, and error updates are announced without interrupting the user. Preserve that pattern from [`entrypoints/app/App.tsx`](../entrypoints/app/App.tsx). Progress keeps its separate progressbar semantics from [`components/Progress.tsx`](../components/Progress.tsx).
