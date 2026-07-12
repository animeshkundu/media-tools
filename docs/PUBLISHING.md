# Publishing Media Tools

Scope: Firefox AMO publishing playbook, with optional Chrome Web Store guidance. The automated path is in [`release.yml`](../.github/workflows/release.yml).

## One-time setup

1. Create a [Firefox Add-on developer account](https://addons.mozilla.org/developers/).
2. Open the AMO **API Keys** page and generate API credentials. Save the JWT issuer and JWT secret when shown.
3. Confirm the extension ID. It is `media-tools@local` today. Before publishing, replace it with a real email-form ID or use the AMO-assigned ID for a listed add-on.
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
4. The [release workflow](../.github/workflows/release.yml) builds ZIPs for Chrome and Firefox, creates the Firefox sources ZIP, runs `wxt submit`, and attaches all ZIPs to the GitHub Release.

For first-time local verification, run `wxt submit --dry-run` to check authentication without uploading. `wxt submit init` provides an interactive setup and writes `.env.submit`. That file is local only and must never be committed.

Manual workflow runs should target a version tag so the GitHub Release action has the correct release tag.

## Review process and timelines

AMO applies automated checks and human review. Straightforward updates may clear in hours, while initial or more complex reviews often take a few days. Review can take longer if Mozilla asks about source reproduction, bundled code, permissions, or WASM.

Bundled media processing is reviewable, not automatically disqualifying. Media Converter and Muxer is a live AMO precedent for a media extension using WASM. It does not guarantee approval. Keep the source package reproducible and answer reviewer questions directly.

## Versioning

Use semantic `N.N.N` versions in `package.json` and the manifest. Every AMO upload must have a unique version higher than the previous upload. Keep the Git tag aligned, for example version `1.2.3` with tag `v1.2.3`.

## Manifest facts already set

[`wxt.config.ts`](../wxt.config.ts) already sets:

- `browser_specific_settings.gecko.id` to `media-tools@local`
- `data_collection_permissions: { required: ['none'] }`, required by AMO since 2025-11-03
- no host permissions
- extension CSP that default-denies egress (`default-src 'none'`, `connect-src 'none'`,
  `form-action 'none'`, `frame-src 'none'`, and only packaged extension-page assets)

Recheck these values in each release review, especially after changing the extension ID or adding capabilities.

## Store-listing asset checklist

- Icons at 16, 32, 48, 96, and 128 pixels, already in `public/icon/`
- Screenshots, using the existing mocks as a basis
- Short and long descriptions
- Categories
- Privacy-policy copy: "local processing, no upload"
- Support URL

Make screenshots and descriptions match the current shipped feature set.

## Chrome Web Store

The release workflow includes a manual, optional Chrome publishing job. Enable it only after adding these repository secrets:

- `CHROME_EXTENSION_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

The extension has a clear single purpose: process local media files. It also meets the no-remote-code requirement because all executable code, including WASM, is bundled with the extension. Keep those claims true as new tools are added.

This repository is local-git only today. Publishing automation activates after the first GitHub push and repository secret configuration.
