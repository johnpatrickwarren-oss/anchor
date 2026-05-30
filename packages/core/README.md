# @anchor/core

The first step of turning Anchor from a methodology pack into a tool: the **role engine** and the **runtime-adapter seam**. Plain TypeScript, no build step — runs under Node's type-stripping (`node --test`).

## Why this exists

Anchor's value is not orchestration — that's commoditizing (Claude Code dynamic workflows, the Claude Agent SDK, Atomic all do it). Anchor's moat is opinionated **discipline content** and the cross-project **learning loop**. So this package owns the role-cycle *logic* and *disciplines*, and runs them on a commodity runtime via a thin adapter — rather than reimplementing an engine. (Design rationale: the *Anchor-as-a-tool* proposal from the Dynamic-Workflows evaluation.)

## What's here (scaffolded)

- **`runtime-adapter.ts`** — the `RuntimeAdapter` seam (`spawnRole`) that keeps the engine un-welded from any substrate, plus a deterministic `MockRuntimeAdapter` so the cycle runs end-to-end in tests with no live model or tokens.
- **`role-engine.ts`** — the deterministic state machine: Architect → Implementer → Reviewer → Memorial, filtered by tier, threading handoffs, with escalation **pause/resume** (`runRound` / `resumeRound`) — `run-pipeline.sh`'s sequencing in TypeScript.
- **`tiers.ts`** — tier → dispatched role set (`full` / `audit` / `solo` / `implementer-only` / `coordinator-only`).
- **`models.ts`** — per-role model resolution from a capability-class manifest (the `models.json` pattern; dated IDs, not `-latest`), with a per-role override seam where the dynamic selectors plug in.
- **`types.ts`** — honest measurement shape: per-role raw token usage, never a bare total (POC AC-7).

## Discipline gates (Phase 3 — implemented)

Executable gates turn Anchor disciplines from prose into code; wire them into `EngineDeps.gates` (a failing CRITICAL/MAJOR halts the run, `BLOCKED`). Use `composeGates(...)` to combine them. The first two are *fully mechanical*; the last two are *structural* (a code gate can verify the discipline was emitted, not judge its quality — a cold-eye Reviewer still does that).

- **`verifyCitations`** (`gates/citation.ts`) — ports `verify-citations.sh` + the spec template rule: every citation-table row must resolve at its pinned SHA with a verbatim snippet. Empty rows, placeholders (`TBD`, `<...>`), or paraphrased snippets fail CRITICAL; an explicit greenfield `N/A` row passes. Default `gitCitationResolver` via `git show`.
- **`checkAntiSelfConfirming`** (`gates/anti-self-confirming.ts`) — skill 13's mutation check: every supplied mutation must be *killed* (tests must fail); a survivor is a self-confirming-test CRITICAL. Default `makeFileMutationRunner` applies/runs/restores.
- **`checkGrillingEmitted`** (`gates/grilling.ts`, skill 01) — structural: the spec must carry a pre-emit grilling pass (CRITICAL / LIKELY-SURFACES / PRE-EMPTABLE buckets, or a grilling heading). Catches "no grilling at all".
- **`checkAntiScope` / `checkAntiScopeViolation`** (`gates/anti-scope.ts`, skill 06) — structural: the spec must carry an `## Anti-scope` section; and (optional) no written file may match a declared anti-scope pattern (substring or `*` glob).
- **`testGate`** (`gates/index.ts`) — the **green-test gate**: runs the project's test command (`npmTestRunner`, default `npm test`) after the implementer and **BLOCKS the round on a red suite**. Deterministic, blocking by design — the one check Anchor will not leave to a model's self-reported status ("no COMPLETE over red"). Runs in the engine process (not the agent sandbox), so the engine owns verification; `--test-cmd` points it at a faster/incremental command.

**Prompt wiring (layer 2):** the engine's default role prompts *instruct* these disciplines — the Architect writes an anti-scope section, cites inherited code, runs a grilling pass, and declares parallel units when applicable; the Implementer/Reviewer avoid/check self-confirming tests. A global note tells every role the **engine owns verification** (no role runs the suite, asks the operator to, or escalates over a discipline it can't act on). So a compliant agent produces the artifacts and the gates verify them.

## Engine — converge to green, scale to the work

Beyond the linear state machine, the engine now actively converges and right-sizes:

- **Remediation loop** — when a code-producing role's gates fail, the engine re-runs it with the findings as feedback and re-checks, up to `maxFixAttempts` (default 2), instead of stopping at the first red. The cycle *converges to green* rather than reporting failure. Each attempt is its own recorded phase.
- **Within-feature parallelism** — when the Architect declares file-disjoint **units** (`ANCHOR-UNIT [id]: <scope>`), the engine fans out one sub-implementer per unit concurrently (a $0-token JS pool), then merges (summed usage, all artifacts, worst-status-wins). `RoundConfig.units` / `EngineDeps.rolesOverride` are the seams.
- **Adaptive structure** — a high-risk directive (the same `HIGH_STAKES` signal that routes models to opus) earns a **second independent reviewer pass** (`adaptRolesForRisk`); routine work is untouched.
- **Per-phase timing** — `PhaseRecord.durationMs` records the wall-clock each role took (injectable clock via `EngineDeps.now`), so where a round's wall goes is measurable, separate from per-role token cost.

## Routing — scope decides the role set + models

`routing/` turns a directive into `{tier, per-role models}` deterministically ($0):

- **Tier auto-routing** (`classifyTier`) — scope → role set: mechanical → `implementer-only` (just the implementer), self-contained additive → `audit` (implementer + reviewer + memorial, no separate architect), complex/risky → `full`. Case-insensitive markers; high-stakes guard wins.
- **Per-role model routing** (`selectRoleModelClasses`) — opus/sonnet/haiku by change-risk: load-bearing → opus, scaled-down/mechanical tiers → sonnet, memorial → haiku. The green-test gate backstops correctness, so the `audit` reviewer routes to sonnet.
- **Routing-accuracy harness** (`test/routing-corpus.ts` + `routing-accuracy.test.ts` + `routing-calibration.test.ts`) — grades the classifier against a labeled corpus with an **asymmetric** metric (hard-fail on under-scaling, report over-scaling), a confusion matrix, a confidence-calibration ECE, and a **live oracle** (`scripts/routing-oracle.mjs`, periodic/paid) that grounds the labels by ablation.
- **Model-drift** (`routing/provenance.ts`) — `checkModelDrift` compares the API's models against the set the labels were grounded under; on a new model the CLI **fails safe** (over-provisions) until you re-ground.

## Memorial service (Phase 4 — implemented)

The cross-project learning loop — the capability no commodity runtime has. `MemorialStore` (`memorial/`) implements the `MemorialPort` seam and adds the authoring/diagnostic API:

- **Accretion** — `recordConfirmation` / `recordViolation` track per-entry V/C counts.
- **Reinforcement injection** — `applicable(config)` returns the active entries' rules; the engine folds them into role prompts (verified end-to-end in tests).
- **Pruning** (skill 02) — `prune()` promotes well-internalized entries to `stabilized` and auto-retires the fully-stabilized ones; a fresh violation re-opens a stabilized entry. Retired entries are kept, never deleted.
- **Diagnostics** — `ratios()` flags entries whose violations outpace confirmations (the "sharpen or retire" signal).
- **Persistence** — `MemoryPersistence` (tests) and `JsonFilePersistence` (a cross-project `~/.anchor/memorial.json` or a project-scoped path). Dependency-free.

## What's NOT here yet (explicit seams)

- **More gates** — the P3 ten-axis spot-checks (mostly judgment; a few lint-able). The `gates` hook is the home for them. (The structural + green-test gates are now default-composed inside `@anchor/cli`.)
- **More adapters** — `AgentSdkAdapter` ships in the sibling [`@anchor/runtime-agent-sdk`](../runtime-agent-sdk) package; `AtomicAdapter` / `ClaudeWorkflowAdapter` are still TODO. `MockRuntimeAdapter` ships here for tests.
- **A model-assisted tier tiebreaker** — for low-confidence/ambiguous directives (the 0.50-default bucket the calibration harness flags). Today they fall back to `full` (safe). The live oracle informs whether it's worth building.

## Run

```bash
cd packages/core && node --test test/*.test.ts   # or: pnpm test
```

Behavior is verified against the mock adapter (~114 tests): phase order per tier, per-role model + tier routing, escalation pause/resume, the gates (citation, anti-self-confirming, grilling, anti-scope, **green-test**), the **remediation loop** (converge-to-green), **within-feature parallelism** + merge, **adaptive structure** (2nd reviewer), per-phase timing, the no-bare-total measurement record, the memorial store (accretion, pruning/retirement, persistence, reinforcement injection), and the **routing-accuracy** harness (corpus grading, calibration ECE, model-drift + safe routing).
