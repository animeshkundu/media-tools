# Repository guidance for animeshkundu/media-tools

## Project overview

Audio Cutter is a WXT Manifest V3 extension for Chrome and Firefox that cuts, joins, changes the speed of, and converts WAV and MP3 audio locally. Files stay on the user's device; nothing is uploaded.

Default branch: main

## Tech stack

WXT 0.20, React 19, strict TypeScript, and Tailwind CSS 4.

Package manager / build tool: npm

## Commands

Run the closest applicable command before handing off. Confirm command names in `package.json` rather than guessing.

- Install: `npm ci`
- Dev: `npm run dev`
- Firefox dev: `npm run dev:firefox`
- Build: `npm run build`
- Firefox build: `npm run build:firefox`
- Typecheck: `npm run compile`
- Lint: `npm run lint`
- Test: `npm run test`
- Full check: `npm run check`
- Firefox E2E: `npm run test:e2e`

## Definition of Done gate

A change is not ready for review or merge until all applicable checks below are satisfied with real command output in the PR:

- Chrome production build passes: `npm run build`
- Firefox production build passes: `npm run build:firefox`
- Typecheck passes: `npm run compile`
- Lint passes: `npm run lint`
- Tests pass: `npm run test`
- The combined compile, lint, and unit-test gate passes: `npm run check`
- Browser behavior changes pass the production-artifact Firefox E2E gate: `npm run test:e2e`
- Tests only go up: features and bug fixes add or strengthen tests; do not delete coverage to make a branch green.
- Acceptance criteria are explicitly verified against the changed behavior.
- No stub, skipped, or incomplete implementation is counted as done.
- Documentation, ADRs, changelog, and history/learnings are updated in the same PR when behavior, architecture, process, or operational knowledge changes.
- The CI `build` and `firefox-e2e` jobs are green on `ubuntu-latest` before merge.
- No attribution to tools or generated authorship appears in commits, PRs, docs, or code comments.
- UI-impacting changes include before/after screenshots or recorded browser evidence in the PR.

## Primary OS and portability

No single desktop OS is product-primary. Required automated verification runs on Ubuntu Linux (`ubuntu-latest` in `.github/workflows/ci.yml`).

- Treat `ubuntu-latest` as authoritative for required CI behavior.
- Keep path handling portable; avoid shell-specific assumptions in application code.
- Add regression coverage for platform-specific fixes rather than skipping that platform.
- Browser behavior remains a Chrome and Firefox contract even though the required CI jobs run on Linux.

## Conventions

- Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- Keep one concern per PR; split broad or vague work before implementation.
- Prefer small, reviewable changes with explicit acceptance criteria.
- Do not hide failures with retries, skipped tests, relaxed assertions, or platform carve-outs.
- Preserve existing style unless an accepted ADR says otherwise.
- Preserve the 64 MB input limit, the 256 MB decoded or in-flight PCM limits, overflow-safe bounds checks, worker cancellation, and no-partial-download behavior.
- Preserve the no-network contract. CI machine-verifies it by scanning built JavaScript for network primitives and validating production CSP and manifest egress controls.

## Project structure

- `tests/` — Vitest unit and component coverage plus the production-artifact Firefox E2E suite under `tests/e2e/`; generated Playwright output belongs in `test-results/` or `playwright-report/`, not in test sources.
- `docs/` — Product, architecture, design, capability, publishing, roadmap, ADR, plan, research, history, QA, and durable-learning records; update the relevant document in the same change when its contract changes.
- `.github/` — CI, release, dependency automation, issue templates, and pull-request guidance; workflow edits must preserve least privilege and the build, no-egress, and real-Firefox gates.
- `entrypoints/app/` — React tool UI for cut, join/merge, change speed, and WAV/MP3 conversion.
- `lib/core/` and `lib/tools/` — Shared worker, download, validation, and bounded audio-processing code.

## Decision records and durable memory

- ADRs live in `docs/adr/` for project-specific decisions; use `docs/adr/0000-template.md` as the Nygard-style template.
- Plans live in `docs/plans/YYYY-MM-DD-slug.md`.
- Research lives in `docs/research/YYYY-MM-DD-slug.md` with citations to source files or external URLs.
- Solved problems, incidents, and debugging notes live in `docs/history/YYYY-MM-DD-slug.md`.
- Durable project learnings live in `docs/LEARNINGS.md`; update it when a future contributor would otherwise rediscover the same fact.

## Handoff

Every handoff should include:

- What changed and why.
- Files touched and the important decisions made.
- Commands run with pass/fail results.
- Risks, follow-ups, and any intentionally deferred work.
- Links to PRs, issues, ADRs, plans, research, and history entries.

## Testing

- Unit/component framework: Vitest
- Unit/component test directory: `tests/`
- Unit/component test file glob: `**/*.{test,spec}.{ts,tsx,js,jsx}`
- Browser framework: Playwright using real Firefox against `.output/firefox-mv3`
- CI enforces at least four clean Firefox E2E passes with no skips, flakes, or unexpected results.
- Prefer tests that reproduce real failure modes, including malformed WAV/MP3 input, bounds, worker failure, cancellation, and partial-download prevention.
- Bug fixes include a regression test that fails before the fix.
- Keep tests deterministic and independent; clean up external state.

## Gotchas

- `npm run compile` is the standalone TypeScript gate; `npm run check` runs compile, lint, and Vitest.
- Audio input is capped at 64 MB, and decoded or in-flight PCM is capped at 256 MB before large allocations.
- Audio decode, encode, progress, and cancellation are worker-owned; cancellation terminates the worker and must not emit a partial download.
- CI scans both production bundles for network primitives, validates CSP and manifest egress controls, and separately runs the built extension in real Firefox.
