# CI and release pipeline trigger incident

Date: 2026-07-23

## Symptom

The latest merge to `main` appeared not to start CI or a release.

## Findings

- GitHub Actions did start CI, Firefox E2E, and Pages for commit `1940b1844df5201dc99328ae3d94991c6df6145d`; all three completed successfully.
- The Release workflow could not start from a normal merge because it listened only for manually pushed `v*` tags.
- The successful CI log contained `No files were found with the provided path: .output/. No artifacts will be uploaded.` The artifact action excludes hidden paths by default, and its warning-only default let the job stay green without publishing either browser build.
- Pages deployed only when committed `site/**` files changed, so shared editor source changes could leave the hosted build stale.

## Resolution

- CI and E2E now declare explicit `main`, pull-request, merge-queue, and manual triggers and use bounded concurrency and timeouts.
- Build artifact uploads include explicit browser output directories, include hidden files, and fail when files are absent.
- Release detection now runs on every `main` push. A matching existing version tag is a successful no-op; an untagged package version must match the lockfile and changelog before full checks, real-Firefox E2E, packaging, signing, tagging, and publication.
- GitHub Release publication is separated from unprivileged build and test work. Optional AMO submission runs in its own environment-scoped job and is not repeated by manual asset recovery.
- Pages rebuilds the hosted app from source before both validation and deployment, and deployment concurrency no longer overlaps pull-request validation.

## Prevention

- Treat warnings about missing CI artifacts as failures.
- Change versions through a reviewed `main` merge; do not manually push release tags.
- Keep third-party actions pinned to reviewed commit SHAs and allow Dependabot to propose updates.
