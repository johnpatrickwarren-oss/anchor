# Case study — `anchor project`: automatic decomposition + dependency-aware parallel stages

**Date:** 2026-05-30 · **Command:** `anchor project` (this repo's `packages/`) · **Runtime:** Claude Agent SDK (Claude Code subscription auth)

The gap this proves out: before `anchor project`, the tool scaled the *role set* per round automatically (tier-router) and could fan out independent features — but only from a **hand-authored** `wave` plan. Nothing read *a project* and decomposed it into the parallel work itself. `anchor project` closes that: one project brief in → a Coordinator decomposes it into features + a dependency graph → independent features run **concurrently within a stage**, dependents are **sequenced** across stages, each feature **self-routing its own tier/models**. No hand-written plan.

## What was run

A single directive ([`artifacts/PROJECT.md`](artifacts/PROJECT.md)) describing a tiny string-utils library: `slugify`, `truncate`, `titleCase` (independent), and `headline` (which must *compose* `titleCase` + `truncate`, not reimplement them) plus a barrel `index`.

```bash
anchor project --directive coordination/PROJECT.md --repo <dir> --project-id strkit --memorial …
```

## What the Coordinator decided (automatically)

```
decomposed "strkit" → 5 feature(s) in 3 stage(s):
  stage 1 — 3 in parallel:
    - slugify    : src/slugify.ts + test
    - truncate   : src/truncate.ts + test
    - titleCase  : src/titleCase.ts + test
  stage 2:
    - headline (after titleCase, truncate) : composes the two
  stage 3:
    - index (after slugify, truncate, titleCase, headline) : barrel re-export
```

The dependency graph — three independent utils, a composer that needs two of them, a barrel that needs all — was inferred from the brief, not specified by hand. Stage 1's three features ran **concurrently** (one git worktree each off the integration branch); stages 2 and 3 ran after their inputs merged in.

## Result — `project strkit → COMPLETE`

```
stage 1 [COMPLETE] slugify:COMPLETE truncate:COMPLETE titleCase:COMPLETE
stage 2 [COMPLETE] headline:COMPLETE
stage 3 [COMPLETE] index:COMPLETE
```

Each feature completed only over a green suite (the per-feature green-test gate). The work landed on a `anchor/strkit/integration` branch — see [`artifacts/integration-git-log.txt`](artifacts/integration-git-log.txt) for the staged commit/merge order (scaffold → stage 1 → headline → index).

## Independent verification (not trusting the COMPLETE)

- **Cross-stage dependency visibility — the load-bearing claim.** A stage-2 feature must see code that stage-1 produced. [`artifacts/produced-headline.ts`](artifacts/produced-headline.ts) opens with:
  ```ts
  import { titleCase } from './titleCase.ts';
  import { truncate } from './truncate.ts';
  ```
  i.e. `headline` (stage 2) imported and reused the modules `titleCase` + `truncate` (stage 1) — proving the stage-2 worktree, branched off the integration branch *after* stage 1 merged, actually saw the earlier code. Not a reimplementation.
- **Re-ran the full suite** on the integrated result (`npm test`): **57/57 pass, 0 fail** across all five features.
- The barrel ([`artifacts/produced-index.ts`](artifacts/produced-index.ts)) re-exports all four utilities.

## Honest limits

- **Stop-on-stage-failure (v1):** if any feature in a stage doesn't reach green, later stages are not launched and their features are reported `skipped` (the project is PARTIAL). Per-branch continuation — letting independent downstream branches proceed when an unrelated feature fails — is future work.
- **Within-stage file-disjointness is the Coordinator's responsibility.** Concurrent features in a stage are merged assuming no file overlap; the Coordinator is instructed to keep a stage file-disjoint, but a bad plan that overlaps files could conflict at merge (surfaced as an error, not silently mismerged).
- Single run; a strong existence proof of the mechanism, not a benchmark.

## Bottom line

One project directive, zero hand-authored plan → automatic decomposition into a dependency graph, parallel execution within stages, correct sequencing across them, and independently-verified green code that genuinely composes across stages. This is the methodology's Coordinator role, now in the tool.
