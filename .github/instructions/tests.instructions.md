---
applyTo: "**/*.{test,spec}.{ts,tsx,js,jsx}"
---
# Test conventions

Framework: Vitest
Directory: tests/
Command: `npm run test`

- Keep tests deterministic, isolated, and independent.
- Prefer focused assertions over broad snapshots.
- Add or strengthen tests for every behavior change and bug fix.
- Do not skip, delete, or relax tests to make a branch green.
- Record new testing gotchas in `docs/LEARNINGS.md` or `docs/history/`.
