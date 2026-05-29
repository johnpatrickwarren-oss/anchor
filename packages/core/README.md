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

Two executable gates turn Anchor disciplines from prose into code; wire them into `EngineDeps.gates` (a failing CRITICAL/MAJOR halts the run, `BLOCKED`). Use `composeGates(...)` to combine them.

- **`verifyCitations`** (`gates/citation.ts`) — ports `verify-citations.sh` + the spec template rule: every citation-table row must resolve at its pinned SHA with a verbatim snippet. Empty rows, placeholders (`TBD`, `<...>`), or paraphrased snippets fail CRITICAL; an explicit greenfield `N/A` row passes. Default `gitCitationResolver` resolves via `git show`; inject a resolver for tests.
- **`checkAntiSelfConfirming`** (`gates/anti-self-confirming.ts`) — skill 13's mutation check: every supplied mutation must be *killed* (tests must fail); a mutation the tests survive is a self-confirming-test CRITICAL. Default `makeFileMutationRunner` applies/runs/restores; inject a runner for tests.

## Memorial service (Phase 4 — implemented)

The cross-project learning loop — the capability no commodity runtime has. `MemorialStore` (`memorial/`) implements the `MemorialPort` seam and adds the authoring/diagnostic API:

- **Accretion** — `recordConfirmation` / `recordViolation` track per-entry V/C counts.
- **Reinforcement injection** — `applicable(config)` returns the active entries' rules; the engine folds them into role prompts (verified end-to-end in tests).
- **Pruning** (skill 02) — `prune()` promotes well-internalized entries to `stabilized` and auto-retires the fully-stabilized ones; a fresh violation re-opens a stabilized entry. Retired entries are kept, never deleted.
- **Diagnostics** — `ratios()` flags entries whose violations outpace confirmations (the "sharpen or retire" signal).
- **Persistence** — `MemoryPersistence` (tests) and `JsonFilePersistence` (a cross-project `~/.anchor/memorial.json` or a project-scoped path). Dependency-free.

## What's NOT here yet (explicit seams)

- **More gates** — pre-emit grilling (agent-driven), anti-scope ledger, P3 axes. The `gates` hook is the home for them.
- **More adapters** — `AgentSdkAdapter` ships in the sibling [`@anchor/runtime-agent-sdk`](../runtime-agent-sdk) package; `AtomicAdapter` / `ClaudeWorkflowAdapter` are still TODO. `MockRuntimeAdapter` ships here for tests.

## Run

```bash
cd packages/core && node --test test/*.test.ts   # or: npm test
```

Behavior is verified against the mock adapter (33 tests): phase order per tier, per-role model routing + overrides, escalation pause/resume, gate-halt, the no-bare-total measurement record, the citation + anti-self-confirming gates, and the memorial store (accretion, pruning/retirement, persistence, reinforcement injection into role prompts).
