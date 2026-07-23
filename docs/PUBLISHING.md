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

1. Set the same new semantic `N.N.N` version in `package.json`, `package-lock.json`, and the lockfile root package entry.
2. Move the release notes from `Unreleased` to a matching `## [N.N.N]` section in `docs/CHANGELOG.md`.
3. Run local checks, verify both browser builds, and merge the version change to `main`.
4. The [release workflow](../.github/workflows/release.yml) runs for every push to `main`. It exits successfully when `vN.N.N` already exists. For a new version it runs the full check and real-Firefox E2E gates, builds the Chrome and Firefox ZIPs and Firefox sources ZIP, validates the packaged manifest versions, generates and signs checksums, creates the version tag, and publishes the GitHub Release.
5. If asset publication fails after a tag is created, manually dispatch the Release workflow on `main` with `force` enabled. This rebuilds and replaces the GitHub Release assets but deliberately does not resubmit the same version to AMO.

Do not push release tags manually. The workflow creates the tag only after the exact `main` commit passes its release gates. It submits the listed Firefox build to AMO only on the original `main` push when the `PUBLISH_FIREFOX` repository variable is `true` and the required secrets are configured.

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

## Release asset verification

Releases created before the main-branch automation used a tag ref in their Sigstore identity. New releases use the protected `main` workflow ref. Verify either generation with:

```sh
cosign verify-blob \
  --new-bundle-format \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/animeshkundu/media-tools/\.github/workflows/release\.yml@refs/(heads/main|tags/v[^/]+)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS
```

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
`/media-tools/app/`. The deployable Vite output is committed under `site/app/`. The Pages workflow
also rebuilds it from source before validation and deployment, so a merge cannot publish stale
committed output.

Regenerate it with `npm exec -- vite build --config vite.web.config.ts`, then commit the complete
`site/app/` result. The build copies bundled `lamejs` and emits the shared audio worker. Verify that
the artifact contains `site/app/index.html`, a hashed worker, and `site/app/vendor/lame.min.js`.
Internal URLs must remain rooted at `/media-tools/`.

Website copy must describe local processing and no upload without borrowing the extension's
mechanical claims. GitHub Pages does not apply the extension manifest, zero-permission declaration,
or extension-page no-egress CSP.
