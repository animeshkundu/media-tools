# Third-party software bill of materials

Versions are pinned by `package-lock.json`. This list covers packages shipped in the extension bundle; development-only tooling is not shipped.

| Package     | Version | SPDX license      | Purpose                      | Source / homepage                              |
| ----------- | ------: | ----------------- | ---------------------------- | ---------------------------------------------- |
| `react`     |  19.2.4 | MIT               | Application UI               | https://github.com/facebook/react              |
| `react-dom` |  19.2.4 | MIT               | Browser UI renderer          | https://github.com/facebook/react              |
| `lamejs`    |   1.2.1 | LGPL-3.0-or-later | MP3 encoding in a Web Worker | https://github.com/zhuker/lamejs               |

No remote code, codec binaries, WASM modules, models, or fonts are shipped in this phase.

---

## LGPL compliance — lamejs

`lamejs` is licensed under the GNU Lesser General Public License v3.0 or later (LGPL-3.0-or-later).

**Copyright notice:** Copyright (c) 2014 Zhukov Alexander. The original LAME MP3 encoder is Copyright (c) 1999–2011 The LAME Project.

**Attribution:** The lamejs library is bundled unmodified as a JavaScript module inside the extension's Web Worker. The library name, version, copyright, and license are recorded in this file and in `package-lock.json`.

**Library source availability:** The complete source code of lamejs 1.2.1 is available at https://github.com/zhuker/lamejs/tree/v1.2.1. The library is not modified in this extension. Users who wish to substitute a modified version of lamejs may do so by forking the repository, rebuilding the extension from source using `npm run build`, and loading the resulting unpacked extension.

**License text:** The full LGPL-3.0 license text is available at https://www.gnu.org/licenses/lgpl-3.0.html.
