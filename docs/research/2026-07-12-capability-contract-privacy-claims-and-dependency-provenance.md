# Capability contract, privacy claims, and dependency provenance research

- Date: 2026-07-12
- Implementation owner: unassigned

unit-id: 2a0c9b0e-7ac9-43d3-b939-57fd3703906e

## Research question

What documentation and package metadata must change so the extension describes its current
capabilities precisely, uses the approved **local processing, no upload** privacy contract, and
records exact provenance for every dependency shipped in the browser artifacts?

## Current capability contract

- The shared product surface is a full-page tab on Chrome and Firefox. Browser-specific APIs must be
  optional, feature-detected enhancements rather than dependencies of the common workflow
  ([`CLAUDE.md`](../../CLAUDE.md#architecture---do-not-violate);
  [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#6-cross-browser-strategy)).
- The documented Chrome-only enhancements are the side panel, File System Access folder picker, and
  cross-origin isolation for a possible future multithreaded ffmpeg build. The tab and ordinary Blob
  download remain the cross-browser fallbacks
  ([`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#2-system-architecture-mv3-surfaces)).
- `mediabunny`, `gifenc`, SoundTouchJS, and ffmpeg packages are planned, not installed dependencies.
  The architecture library table currently labels these unselected future versions as `latest`,
  which conflicts with the rule against presenting planned engines as shipped or reproducibly
  selected ([`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#10-library-table);
  [`CLAUDE.md`](../../CLAUDE.md#engines-and-browser-behavior)).
- Audio decode still runs on the main thread while cutting and encoding run in a worker. Capability
  copy must retain that current-state distinction
  ([`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#21-current-state-vs-target-honest);
  [`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#performance-and-release-gates)).

## Privacy and offline claims

The binding contract is **local processing, no upload**. It is narrower than a product-wide promise
of zero network activity because the product documents possible explicit opt-in analytics, an
external checkout, and optional future non-executable asset downloads
([`CLAUDE.md`](../../CLAUDE.md#privacy-and-offline-contract);
[`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#success-metrics)).

Claims that need revision in the implementation:

- `docs/VISION.md` calls the product “100% offline” and “mechanically verifiable”
  ([`docs/VISION.md`](../VISION.md#north-star)).
- `docs/PRODUCT-SPEC.md` asks the Privacy-Conscious persona to process media “provably offline” and
  says processing makes no network request
  ([`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#the-privacy-conscious-creatorpro);
  [`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#privacy-and-provable-local-processing)).
- `docs/ARCHITECTURE.md` says “Nothing leaves the device” and treats the manifest as proof
  ([`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#1-principles-that-shape-every-decision)).
- `docs/DESIGN.md` prescribes “100% offline” and “Your file never leaves your device” UI copy
  ([`docs/DESIGN.md`](../DESIGN.md#design-principles)).
- `docs/PUBLISHING.md` prescribes “nothing leaves the device” store copy
  ([`docs/PUBLISHING.md`](../PUBLISHING.md#store-listing-asset-checklist)).

`README.md` already says files are not uploaded, but should use the exact contract phrase and
separate local media processing from other optional product activity
([`README.md`](../../README.md)).

The implementation should continue to describe verifiable controls as controls, not as proof of a
broader claim: no host permissions, bundled executable code, Firefox's no-data-collection
declaration, and the built manifests' default-deny CSP. Offline operation remains a release test for
the core workflow, not a claim that the extension can never perform any disclosed optional network
activity ([`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#offline-behavior);
[`docs/PUBLISHING.md`](../PUBLISHING.md#manifest-facts-already-set)).

## Shipped dependency inventory

The current production artifacts contain these direct runtime dependencies:

| Package | Declared range | Lockfile version | Package SPDX | Shipped purpose |
| --- | --- | ---: | --- | --- |
| `react` | `^19.2.4` | 19.2.7 | MIT | Application UI |
| `react-dom` | `^19.2.4` | 19.2.7 | MIT | Browser renderer |
| `lamejs` | `^1.2.1` | 1.2.1 | LGPL-3.0 | MP3 encoding |

Sources: [`package.json`](../../package.json), the root and package records in
[`package-lock.json`](../../package-lock.json), and the emitted Chrome and Firefox artifact lists
from `npm run build` and `npm run build:firefox`.

`THIRD-PARTY.md` incorrectly records React and React DOM as 19.2.4, uses
`LGPL-3.0-or-later` where the installed `lamejs` package metadata says `LGPL-3.0`, and omits the
required notices, source/relink obligations, provenance links, and artifact-specific build details
([`THIRD-PARTY.md`](../../THIRD-PARTY.md);
[`CLAUDE.md`](../../CLAUDE.md#correctness-and-release-gates)).

Development-only direct dependencies are not shipped dependency entries, but their current resolved
versions should remain distinguishable from browser-artifact provenance. The package manifest uses
caret ranges for all of them; changing that policy is outside the stated requirement to pin shipped
dependencies.

## Vendored lamejs findings

- MP3 encoding loads `public/vendor/lame.min.js` as a packaged worker asset
  ([`lib/tools/audio-cutter/encode.worker.ts`](../../lib/tools/audio-cutter/encode.worker.ts)).
- The npm dependency identifies upstream as
  [`zhuker/lamejs`](https://github.com/zhuker/lamejs), version 1.2.1, under LGPL-3.0
  ([`package-lock.json`](../../package-lock.json)).
- The vendored file has no embedded package version, source URL, license notice, or documented
  transformation procedure ([`public/vendor/lame.min.js`](../../public/vendor/lame.min.js)).
- The checked-in vendor file and `node_modules/lamejs/lame.min.js` are not byte-identical. Their
  SHA-256 values during this audit were respectively
  `58895f12c6b1baa23969dbe13c7461a3778ef248c0afa1467030451c6bc2064e` and
  `15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4`.
  Version provenance therefore cannot be established from file identity alone.

The future provenance entry must identify the exact upstream package and source, explain how the
vendored artifact was produced, record its checksum, include or point to required LGPL notices and
corresponding source/relink material, and state that the same packaged file is emitted in both
browser builds. Legal sufficiency requires owner review; an SPDX label alone is not that review.

## Ownership blockers and risks

1. `package-lock.json` is outside this unit's owned-file list. Exact pins in `package.json` must also
   update the lockfile root metadata or `npm ci` will reject the mismatch. Implementation needs an
   explicit ownership exception or a coordinated lockfile change.
2. The vendored file is also outside this unit's ownership. If its provenance cannot be reproduced
   from `lamejs@1.2.1`, correcting or regenerating it requires a separate owner; this unit can only
   document verified facts.
3. License notice, corresponding-source, and relink obligations need a named legal/release owner
   before publishing. Repository metadata is evidence, not legal approval
   ([`docs/PEER-REVIEW.md`](../PEER-REVIEW.md)).
4. Store ownership and final privacy-policy copy are unassigned
   ([`docs/PUBLISHING.md`](../PUBLISHING.md#accounts-and-ownership)).
5. Planned Chrome-only engines must not be described as shipped until their dependencies, packaged
   artifacts, capability checks, and browser-specific release tests exist.

## Baseline verification

On 2026-07-12, before planning changes:

- `npm ci` completed; npm reported nine existing dependency advisories.
- `npm run check` passed: TypeScript, ESLint, and 10 Vitest tests.
- `npm run build` passed for Chrome MV3.
- `npm run build:firefox` passed for Firefox MV3.

No product, package, lockfile, or runtime changes were made as part of this research.

## Related work

- [Implementation plan](../plans/2026-07-12-capability-contract-privacy-claims-and-dependency-provenance.md)
- [`CLAUDE.md`](../../CLAUDE.md)
- [`docs/PEER-REVIEW.md`](../PEER-REVIEW.md)

