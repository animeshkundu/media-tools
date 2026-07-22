# Publishing Media Tools

Scope: Firefox AMO publishing playbook, with optional Chrome Web Store guidance. The automated path is in [`release.yml`](../.github/workflows/release.yml).

## One-time setup

1. Create a [Firefox Add-on developer account](https://addons.mozilla.org/developers/).
2. Open the AMO **API Keys** page and generate API credentials. Save the JWT issuer and JWT secret when shown.
3. Confirm the shipped extension ID, `audiocutter@animesh.kundus.in`, matches the AMO listing and release configuration.
4. Add these GitHub Actions repository secrets:
   - `FIREFOX_EXTENSION_ID`
   - `FIREFOX_JWT_ISSUER`
   - `FIREFOX_JWT_SECRET`

Keep credentials out of source control and logs.

## Listed vs self-distributed

WXT supports `--firefox-channel listed|unlisted` on `wxt submit`.

- `listed` submits to AMO for public listing and distribution through Mozilla. Use it for the normal public release.
- `unlisted` submits a self-distributed build for Mozilla signing. Use it when distributing the signed file yourself without an AMO listing.

Choose the channel deliberately. A listed release needs complete store metadata and passes AMO review before public distribution.

## Source-code submission requirement

AMO requires human-readable source for minified or bundled extensions. `wxt zip -b firefox`, exposed here as `npm run zip:firefox`, creates both the Firefox extension ZIP and the sources ZIP automatically.

WXT excludes configuration files, hidden files, tests, and excluded entrypoints from the sources archive. Inspect and test that archive before the first submission. Extract it in a clean directory, install from its lockfile, run the documented build, and compare the resulting package with the submitted extension.

`.env` files can change generated chunk hashes. Delete local `.env` files before zipping, or configure WXT's `zip.includeSources` and `zip.downloadPackages` behavior for a controlled source package. Pin Node and build-tool versions, and keep the dependency lockfile committed, so reviewers can reproduce the build.

## Release process

1. Set a new semantic version in `package.json` and confirm WXT puts it in the generated manifest.
2. Run local checks and verify both browser builds.
3. Create and push a tag such as `v1.2.3`.
4. The tag-triggered [release workflow](../.github/workflows/release.yml) runs release checks, builds ZIPs for Chrome and Firefox, creates the Firefox sources ZIP, generates and signs checksums, and attaches the release assets to the GitHub Release. It submits the listed Firefox build to AMO only when the `PUBLISH_FIREFOX` repository variable is `true` and the required secrets are configured.

For first-time local verification, run `wxt submit --dry-run` to check authentication without uploading. `wxt submit init` provides an interactive setup and writes `.env.submit`. That file is local only and must never be committed.

## Review process and timelines

AMO applies automated checks and human review. Straightforward updates may clear in hours, while initial or more complex reviews often take a few days. Review can take longer if Mozilla asks about source reproduction, bundled code, permissions, or WASM.

Bundled media processing is reviewable, not automatically disqualifying. Media Converter and Muxer is a live AMO precedent for a media extension using WASM. It does not guarantee approval. Keep the source package reproducible and answer reviewer questions directly.

## Versioning

Use semantic `N.N.N` versions in `package.json` and the manifest. Every AMO upload must have a unique version higher than the previous upload. Keep the Git tag aligned, for example version `1.2.3` with tag `v1.2.3`.

## Manifest facts already set

[`wxt.config.ts`](../wxt.config.ts) already sets:

- `browser_specific_settings.gecko.id` to `audiocutter@animesh.kundus.in`
- `data_collection_permissions: { required: ['none'] }`, required by AMO since 2025-11-03
- no host permissions
- default-deny extension CSP:

  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'`

`wasm-unsafe-eval` is intentionally absent today because the shipped build does not bundle WASM. If
that changes, review the policy and store-review implications before reintroducing it.

Recheck these values in each release review, especially after changing the extension ID or adding capabilities.

## Store-listing asset checklist

- Icons at 16, 32, 48, 96, and 128 pixels, already in `public/icon/`
- Screenshots, using the existing mocks as a basis
- Short and long descriptions
- Categories
- Privacy-policy copy: "no data collected, nothing leaves the device"
- Support URL

Make screenshots and descriptions match the current shipped feature set.

## Chrome Web Store

The current release workflow does not publish to the Chrome Web Store. Chrome publishing remains a manual step until a separately reviewed submission job and its credentials are added.

The extension has a clear single purpose: process local audio files. It also meets the no-remote-code requirement because all shipped executable code is bundled with the extension. Keep those claims true as new tools are added.

## Hosted web app

GitHub Pages publishes the static landing page at `/media-tools/` and the shared editor at
`/media-tools/app/`. The deployable Vite output is committed under `site/app/`, so the existing Pages
workflow validates and uploads it with the rest of `site/` without a separate build step.

Regenerate it with `npm exec -- vite build --config vite.web.config.ts`, then commit the complete
`site/app/` result. The build copies bundled `lamejs` and emits the shared audio worker. Verify that
the artifact contains `site/app/index.html`, a hashed worker, and `site/app/vendor/lame.min.js`.
Internal URLs must remain rooted at `/media-tools/`.

Website copy must describe local processing and no upload without borrowing the extension's
mechanical claims. GitHub Pages does not apply the extension manifest, zero-permission declaration,
or extension-page no-egress CSP.
