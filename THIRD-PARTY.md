# Third-party software bill of materials

Versions are pinned by `package-lock.json`. This list covers packages shipped in the extension bundle; development-only tooling is not shipped.

| Package     | Version | SPDX license      | Purpose                      |
| ----------- | ------: | ----------------- | ---------------------------- |
| `react`     |  19.2.4 | MIT               | Application UI               |
| `react-dom` |  19.2.4 | MIT               | Browser UI renderer          |
| `lamejs`    |   1.2.1 | LGPL-3.0-or-later | MP3 encoding in a Web Worker |

No remote code, codec binaries, WASM modules, models, or fonts are shipped in this phase.
