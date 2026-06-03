# Project — strkit

A tiny, dependency-free TypeScript string-utilities library (pure functions, no I/O).

Build these utilities, each in its OWN file under src/, all re-exported from src/index.ts,
each with its own tests:

- `slugify(s)` — lowercase, spaces→hyphens, strip non-alphanumerics. (independent)
- `truncate(s, n)` — cut to n chars, appending "…" when cut. (independent)
- `titleCase(s)` — capitalize the first letter of each word. (independent)
- `headline(s, n)` — title-case the string THEN truncate to n. Composes titleCase + truncate.

Acceptance: every util pure + covered by tests; headline must reuse titleCase and truncate
(not reimplement them), so it depends on both.
