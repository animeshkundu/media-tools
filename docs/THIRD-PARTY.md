# Third-party software

Exact shipped runtime dependency BOM. Versions are pinned in `package.json` and `package-lock.json`.

## How to refresh

After changing dependencies, run `npm install`, then update the runtime package table below from `package-lock.json` so every shipped package keeps its exact installed version and SPDX license.

| Package     | Version | SPDX license      | Purpose                      | Source / homepage                 |
| ----------- | ------: | ----------------- | ---------------------------- | --------------------------------- |
| `lamejs`    |   1.2.1 | LGPL-3.0-or-later | MP3 encoding in a Web Worker | https://github.com/zhuker/lamejs  |
| `react`     |  19.2.7 | MIT               | Application UI               | https://github.com/facebook/react |
| `react-dom` |  19.2.7 | MIT               | Browser UI renderer          | https://github.com/facebook/react |

No remote code, codec binaries, WASM modules, models, or fonts are shipped.

---

## LGPL compliance — lamejs

`lamejs` is licensed under the GNU Lesser General Public License v3.0 or later (LGPL-3.0-or-later).

**Copyright notice:** Copyright (c) 2014 Zhukov Alexander. The original LAME MP3 encoder is Copyright (c) 1999–2011 The LAME Project.

**Attribution:** The lamejs library ships as the vendored minified distribution `public/vendor/lame.min.js`, copied into each build at `vendor/lame.min.js` and loaded with `importScripts` inside the extension's encode Web Worker. Its source is the unmodified lamejs 1.2.1; only minification is applied. The library name, version, copyright, and license are recorded in this file and in `package-lock.json`.

**Library source availability:** The complete source code of lamejs 1.2.1 is available at https://github.com/zhuker/lamejs/tree/v1.2.1. The library source is not modified in this extension; the shipped `vendor/lame.min.js` is a minified build of that source. Users who wish to substitute a modified version of lamejs may do so by forking the repository, replacing `public/vendor/lame.min.js`, rebuilding the extension from source using `npm run build`, and loading the resulting unpacked extension.

**License text:** The full LGPL-3.0 license text is available at https://www.gnu.org/licenses/lgpl-3.0.html.
