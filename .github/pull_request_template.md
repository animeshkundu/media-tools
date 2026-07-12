## Summary

<!-- What changed and why. Link the ROADMAP item or issue. -->

## Verification

- [ ] `npm run check` passes (compile + lint + test)
- [ ] `npm run build` and `npm run build:firefox` succeed
- [ ] Loaded the built extension and drove the affected tool end-to-end (dropped a real file, verified output)
- [ ] Architecture guardrails respected (heavy work in a Web Worker; background service worker is glue only; offline, no network, no remote code; minimal permissions)
- [ ] Any new dependency has a `THIRD-PARTY.md` entry (package · version · SPDX)

## Notes

<!-- Screenshots, trade-offs, follow-ups, residual risks. -->
