# Capability contract, privacy claims, and dependency provenance plan

- Date: 2026-07-12
- Implementation owner: unassigned
- Status: ready for a scoped implementation after ownership blockers are resolved

unit-id: 2a0c9b0e-7ac9-43d3-b939-57fd3703906e

## Context

The implementation unit owns only `docs/`, `README.md`, `THIRD-PARTY.md`, and `package.json`.
The current task is limited to recording research and this implementation plan; it must stop before
changing product or package files. Findings and citations are in the
[companion research](../research/2026-07-12-capability-contract-privacy-claims-and-dependency-provenance.md).

## Scope

The future implementation will:

- use the exact **local processing, no upload** contract across README and authoritative docs;
- distinguish core offline processing from optional, disclosed product network activity;
- document Chrome-only features as feature-detected enhancements with cross-browser fallbacks;
- pin direct shipped dependencies to the versions already resolved by the lockfile; and
- make `THIRD-PARTY.md` an artifact-level provenance record for React, React DOM, and vendored
  `lamejs`.

It will not change CSP configuration, CI, runtime behavior, UI implementation, workers, media tools,
or Phase 2/3 engines.

## Preconditions

- [ ] Grant the future implementation owner permission to update `package-lock.json` with the exact
      root dependency specs, or assign that synchronized change to the lockfile owner. Do not change
      `package.json` alone.
- [ ] Assign a legal/release owner to approve the LGPL notice, corresponding-source, and relink
      material for vendored `lamejs`.
- [ ] Confirm or reproduce the transformation from `lamejs@1.2.1` to
      `public/vendor/lame.min.js`; if it cannot be reproduced, assign correction of the vendored file
      to its owner.

## Implementation steps

### 1. Establish one capability and privacy vocabulary

- [ ] In `README.md`, describe the extension as **local processing, no upload**. State separately
      that core editing and export work with the network disabled.
- [ ] In `docs/VISION.md`, replace “100% offline” and “mechanically verifiable” product-wide claims
      with the scoped contract. Preserve offline use as a tested core capability.
- [ ] In `docs/PRODUCT-SPEC.md`, rename “provable local processing” and revise “provably offline” /
      “no network request” wording. Keep media-byte non-upload, bundled executable code, no hidden
      telemetry, network-disabled release tests, and explicit opt-in boundaries.
- [ ] In `docs/DESIGN.md`, replace prescribed “100% offline” / “never leaves your device” copy with
      visible **local processing, no upload** copy. Keep “Works offline” only where the core workflow
      is release-tested.
- [ ] In `docs/ARCHITECTURE.md`, separate policy promises from technical controls: minimal
      permissions, bundled executable assets, built-manifest CSP, and no required Firefox data
      collection. Do not call those controls proof that no optional network activity can exist.
- [ ] In `docs/PUBLISHING.md`, narrow store privacy copy to **local processing, no upload** and require
      listing claims to match the shipped artifact and disclosed optional features.
- [ ] Search all owned documentation for `100% offline`, `zero network`, `mechanically`,
      `provably offline`, `proven no egress`, and `nothing leaves`; review every remaining occurrence
      as historical competitor analysis, a test condition, or approved scoped wording.

### 2. Clarify the cross-browser capability contract

- [ ] Consolidate the documented Chrome-only enhancements: side panel, File System Access folder
      picker, and any future cross-origin-isolated engine.
- [ ] For each enhancement, state the capability probe and Firefox/common fallback. The full-page tab
      and Blob download remain required paths.
- [ ] Mark `mediabunny`, `gifenc`, SoundTouchJS, and ffmpeg packages as unselected future
      dependencies rather than `latest`; do not assign versions or claim packaged behavior before a
      dedicated engine PR verifies it.
- [ ] Preserve the honest current-state statement that audio decode is main-thread-owned.

### 3. Pin the shipped dependency set

- [ ] Change direct runtime specs in `package.json` to `react: 19.2.7`, `react-dom: 19.2.7`, and
      `lamejs: 1.2.1`, matching the current lockfile resolutions and minimizing graph churn.
- [ ] With the ownership precondition satisfied, regenerate only synchronized lockfile metadata using
      the existing npm workflow; reject unrelated transitive updates.
- [ ] Run `npm ci` after the change to prove manifest/lockfile consistency.
- [ ] Do not add planned media engines or change development-only dependency policy in this unit.

### 4. Complete artifact-level provenance

- [ ] Expand `THIRD-PARTY.md` for every direct shipped dependency with exact version, SPDX identifier,
      purpose, upstream package/source URL, copyright or notice location, source/relink obligations,
      and Chrome/Firefox artifact details.
- [ ] Record the checked-in `public/vendor/lame.min.js` SHA-256, its reproducible generation or
      transformation procedure, and where corresponding `lamejs` source and LGPL materials are
      retained for store review.
- [ ] Use `LGPL-3.0` unless the legal/release owner verifies a different SPDX expression from
      authoritative upstream licensing material.
- [ ] State explicitly that development tooling is not shipped in extension artifacts and avoid
      presenting the runtime SBOM as a full development dependency inventory.
- [ ] Reconcile the library table in `docs/ARCHITECTURE.md` with the completed
      `THIRD-PARTY.md`.

### 5. Verify the focused change

- [ ] Confirm the diff touches only approved documentation, `README.md`, `THIRD-PARTY.md`,
      `package.json`, and the explicitly approved synchronized `package-lock.json` change.
- [ ] Verify no direct shipped dependency spec contains `^`, `~`, `*`, a tag, URL, or `latest`.
- [ ] Verify each shipped browser dependency has one exact, matching `THIRD-PARTY.md` record.
- [ ] Build Chrome and Firefox, inspect both artifact lists and manifests, and confirm the same
      vendored `lame.min.js` checksum is packaged in each.
- [ ] Run `npm run check`, `npm run build`, and `npm run build:firefox`.
- [ ] Drive Audio Cutter in built Chrome and Firefox with the network disabled; export WAV and MP3 and
      confirm the outputs parse and play. This validates retained claims but does not broaden them.
- [ ] Run the existing production-manifest CSP check. CSP implementation changes remain outside this
      unit.
- [ ] Scan changed files for secrets, then run code review and security validation.

## Acceptance verification

| Requirement relevant to this unit | Evidence |
| --- | --- |
| Precise privacy contract | Owned docs and README consistently say **local processing, no upload**; broader claims are removed or explicitly scoped as tests. |
| Chrome-only enhancements | Each enhancement is labeled optional and feature-detected, with the common fallback documented. |
| Exact shipped dependencies | Runtime specs and synchronized lockfile metadata are exact and agree with installed/browser artifact versions. |
| Complete provenance | `THIRD-PARTY.md` records package, exact version, SPDX, upstream source, notices/obligations, vendoring method/checksum, and browser artifact use. |
| Engineering parity | `npm ci`, `npm run check`, Chrome build, Firefox build, manifest inspection, and both-browser offline Audio Cutter drives pass. |
| Scope | No runtime, CSP, CI, app, worker, or tool implementation file changes. |

The mission's cut accuracy, waveform accessibility, worker-owned decode, no-partial-download,
Phase-1 tools, and UI acceptance criteria belong to other work units. This documentation and
provenance unit must describe their status honestly but cannot implement or claim them.

## Risks and rollback

- A package manifest change without its lockfile counterpart breaks `npm ci`; treat the pair as one
  atomic change.
- The existing vendor file's provenance is not proven by its filename. Do not paper over an
  unreproducible artifact with documentation; escalate it to the vendor-file owner.
- Narrowing privacy language can accidentally weaken the actual media non-upload guarantee. Retain
  that guarantee while removing only unsupported product-wide absolutes.
- Documentation can drift back toward planned-as-shipped claims. Review future engine PRs against the
  capability contract and artifact-level provenance checklist.
- If implementation validation fails, revert the focused manifest/documentation commit rather than
  relaxing checks or widening scope.

## Planning-task completion

- [x] Record repository research, current claims, shipped dependencies, and ownership blockers.
- [x] Write a scoped step-by-step implementation plan with risks and acceptance verification.
- [x] Commit both durable planning artifacts with the correlation marker.
- [x] Stop without implementing product/package changes or opening a pull request.
