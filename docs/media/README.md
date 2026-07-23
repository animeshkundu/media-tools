# Real Firefox media capture

Regenerate the committed Audio Studio screenshots with:

```sh
npm run capture
```

The capture script builds `firefox-mv3`, installs the unpacked production artifact into real Firefox through geckodriver and Marionette, resolves its runtime `moz-extension://` UUID, and drives the shared workspace at 1728×1117. It imports two generated WAV fixtures, changes speed/gain/fades/EQ/zoom/playhead, exports and validates a real MP3, and exercises malformed-input recovery.

Requirements are the repository's installed dependencies. Selenium Manager provisions the pinned geckodriver and resolves Firefox.

Generated artifacts:

- `screenshots/audio-studio-empty.png`: full empty three-pane workspace.
- `screenshots/audio-studio-imported.png`: two files imported once and arranged sequentially.
- `screenshots/audio-studio-edited.png`: selected clip and track tuning with a visible timeline.
- `screenshots/audio-studio-exported.png`: completed local MP3 export and persistent status.
- `screenshots/audio-studio-error.png`: corrupt-audio rejection toast with a recoverable empty project.
