# Design: DAG-parallel `anchor-auto`

**Status:** Design only — not yet implemented. Authored 2026-05-31.
**Goal:** Let `anchor-auto` run *independent* rounds concurrently while keeping its
sequential robustness along true dependency edges — i.e. replace the strict linear
round sequence with a dependency DAG, and fan out the parts of the DAG that don't
conflict.

> **Framing correction (important):** anchor is **not** missing a DAG. The
> Coordinator/wave subsystem (`run-pipeline.sh --coordinator`) already does real
> DAG construction — D1–D5 dependency-edge tests, cycle/island/foundation checks,
> wave sequencing with a fan-out bias — and was used on a real multi-cluster
> project. The gap is narrower than "build a DAG": (1) **`anchor-auto` doesn't use
> that DAG** — it has its own deliberately-linear decomposer and never calls
> `--coordinator`; (2) the DAG path is **operator-orchestrated** (a human opens N
> sessions; auto-parse/locks/auto-aggregate were deferred per
> `MULTI-TRACK-RUNBOOK.md`); and (3) the coordinator wiring in `run-pipeline.sh` is
> **coupled to one project** (`build_coordinator_prompt` hard-codes Tessera/ArchFolio
> file reads; no generic `CLAUDE-COORDINATOR.md` template ships). So this design is
> really: **reconnect `anchor-auto` to the DAG anchor already has, generalize it off
> the Tessera coupling, and automate the dispatch the runbook left manual** — not
> invent a DAG.

---

## 1. Motivation

`anchor-auto.sh` today is strictly sequential: it decomposes the PRD into a linear
list (`ANCHOR-ROUND R01 … R0N`) and runs each round to completion on **one working
tree** before starting the next. Total wall-clock = Σ(round durations). For a project
that is a genuine dependency chain (e.g. the SQL engine: lexer → parser → executor →
expression engine → NULL 3VL → … ), that's optimal — almost nothing is parallelizable.

But many projects have **independent feature areas** (auth + billing + dashboard;
several disjoint-schema migrations; N independent endpoints). There, the linear
schedule wastes wall-clock: rounds that touch disjoint files and depend on a common
foundation could run at the same time.

The sequentiality was a deliberate robustness choice (see `anchor-auto.sh` header):
the older `anchor project` tool parallelized via worktrees + `git merge` and that
merge/coordination machinery was the dominant source of its flakiness. **So the bar
for this feature is: add parallelism without re-importing that flakiness.** The design
below does that by (a) only parallelizing rounds proven independent by the DAG, (b)
reusing the already-built wave/worktree/merge-verify machinery rather than inventing
new merge logic, and (c) keeping a clean fallback to today's linear behavior.

---

## 2. What already exists (reuse, don't reinvent)

`run-pipeline.sh` and `scripts/` already contain a *wave / multi-track* system that
solves most of the hard parts — it's just **operator-orchestrated**, not driven by
`anchor-auto`. Reuse it:

| Piece | File | Role in this design |
|---|---|---|
| Coordinator → DAG → wave plan | `run-pipeline.sh --coordinator` (emits `coordination/WAVE-PLAN-NN.md`) | Source of the dependency DAG + wave grouping |
| Wave init | `scripts/anchor-wave-init.sh` | Prepare a wave's worktrees |
| Per-cluster worktree setup | `scripts/multi-track-cluster-setup.sh` | Create an isolated worktree per parallel round |
| Wave-gate aggregation / merge verify | `scripts/multi-track-verify-wave-merge.sh` | Merge cluster worktrees back, verify no breakage |
| Wave-gate close in pipeline | `run-pipeline.sh --coordinator --wave-gate WAVE-NN` | Consolidation reviewer + aggregate verify at a join |
| Per-round finalize | `scripts/finalize-round.sh` | Commit/attest a completed round |
| Hung-session watchdog | `scripts/session-watchdog.sh` (sourced by `run-pipeline.sh`) | Per-session wall-clock cap — already applies to every parallel session unchanged |
| Operator runbook (the manual version of this) | `MULTI-TRACK-RUNBOOK.md` | Documents the tradeoffs; this design automates its steps |

The runbook explicitly defers "fully automated WAVE-PLAN parsing, in-script lock
primitives, automated wave-gate aggregation" to a follow-up. **This design IS that
follow-up, scoped into `anchor-auto`.**

---

## 3. Design

### 3.1 Decomposition: linear list → DAG

Change the decompose step (`anchor-auto.sh::decompose`) so the Coordinator emits a
**dependency-annotated** plan instead of a bare ordered list. Two viable formats:

- **Reuse the existing `WAVE-PLAN-NN.md`** produced by `run-pipeline.sh --coordinator`
  (preferred — it already encodes clusters + waves + dependency edges, and the
  Coordinator role is already prompt-tuned to produce it). `anchor-auto` shells to
  `--coordinator` for decomposition instead of its current inline `claude -p` prompt.
- **Or** extend the current plan grammar minimally:
  ```
  ANCHOR-ROUND R04: <scope>  [deps: R02,R03]
  ```
  with no `deps:` ⇒ depends on all prior (today's behavior). This is a smaller change
  and keeps `anchor-auto`'s self-contained decomposer, but duplicates DAG logic the
  Coordinator already has. Use this only if reusing WAVE-PLAN proves too heavy.

Either way the in-memory model is: `rounds: { id, scope, deps[] }`.

### 3.2 Scheduling: ready-set over the DAG

Replace the `for` loop in `anchor-auto.sh` (§3 "The loop") with a worklist scheduler:

```
done       = set of completed round ids (seeded from .auto-progress on --resume)
inflight   = map: round id → background pid + worktree path
PARALLELISM = min(--max-parallel N, default 4)        # cap; 1 ⇒ exactly today's behavior

loop until all rounds in done:
  ready = rounds whose deps ⊆ done, not done, not inflight
  while ready not empty and |inflight| < PARALLELISM:
    r = pop ready
    launch_round r   (in its own git worktree, backgrounded)
  wait for ANY inflight round to finish (poll pids / wait -n equivalent)
  on finish:
    rc == 0  → merge worktree to integration branch (§3.3); done += r; echo to .auto-progress-dag
    rc == 2  → escalate-stop (record which round; keep others' results); exit 2
    rc == 1  → bounded retry (today's MAX_ROUND_RETRIES); then non-convergence exit 1
```

Notes:
- **`PARALLELISM=1` must reproduce today's behavior exactly** — that's the fallback and
  the regression guard.
- bash 3.2 has no `wait -n`; emulate with a poll loop over inflight pids (the watchdog
  already establishes this pattern) — each backgrounded round writes a status file on
  exit, mirroring `session-watchdog.sh`'s status-file trick.

### 3.3 Isolation + merge (the part that must not be flaky)

- Each parallel round runs in its **own git worktree** off a shared **integration
  branch** (not `main`), created via `scripts/multi-track-cluster-setup.sh`.
- A round completes → its worktree is merged into the integration branch via
  `scripts/multi-track-verify-wave-merge.sh`, which runs the **green-test gate after
  merge**. A merge that breaks the suite is the failure mode that sank `anchor project`,
  so: **merge is itself gated** — if post-merge tests fail, that round is treated as
  `rc=1` (retry) or escalates, and the integration branch is rolled back to pre-merge.
- **Serialize merges** (one at a time, even though rounds run in parallel). Parallel
  *builds*, serial *integration* — this removes merge-vs-merge races without serializing
  the expensive part (the `claude -p` sessions).
- Only rounds the DAG marks independent (disjoint file scope) are co-scheduled. If the
  Coordinator can't prove independence, the rounds stay sequential — **conservative by
  default.** Borderline shared-file cases: keep sequential (cost of a false-parallel
  merge conflict > benefit).

### 3.4 Per-round context

`prime_round` already gives each round a scoped PRD listing "already built in prior
rounds." Under the DAG, "prior" = the round's **transitive dependencies only** (what's
actually on its worktree's base), not all lower-numbered rounds. This is more correct
than today's "all earlier rounds" and prevents a parallel round from being told about
sibling work it can't see.

### 3.5 Watchdog interaction

No change needed — `session-watchdog.sh` caps each `claude -p` session and is already
sourced per `run-pipeline.sh` invocation. With K rounds in flight there are K independent
capped sessions. One consideration: **K concurrent opus sessions contend on the same
account** (the benchmarking note: arms must run sequentially because of account
contention). So `--max-parallel` should default modestly (4) and be tunable; document
that high parallelism can induce rate-limit backoff (already handled by `is_rate_limit`).

### 3.6 Resume

`--resume` today reads a single `.auto-progress` (last completed round). Under the DAG,
completion is a **set**, not a high-water mark. Replace with `.auto-progress-dag` holding
the done-set (one round id per line). On resume: seed `done` from it, recompute the
ready-set, relaunch. Rounds interrupted mid-flight (in a worktree, not yet merged) are
simply not in the done-set, so they re-run cleanly — same idempotent property as today.

---

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Merge conflicts / broken integration branch (the `anchor project` failure class) | Only co-schedule DAG-proven-independent rounds; serialize merges; post-merge green-test gate with rollback |
| Coordinator mis-declares two rounds independent when they share files | Conservative default (unknown ⇒ sequential); merge gate catches the breakage and forces retry; log the conflict |
| Account contention across K concurrent opus sessions | Modest default `--max-parallel`; reuse existing rate-limit backoff; document |
| Complexity regression vs the "does less" robustness thesis | `--max-parallel 1` is a first-class mode = today's exact behavior; parallelism is opt-in; linear projects (most chains) see no behavior change |
| Resume semantics subtly wrong with partial waves | Done-set file + idempotent re-run of unmerged rounds (same property today relies on) |
| Worktree cruft on crash | Reuse existing cluster-setup/teardown; add a `--clean` that prunes stale worktrees |

---

## 5. Phased rollout

0. **Phase −1 (prerequisite — generalize the Coordinator):** de-couple
   `build_coordinator_prompt` from Tessera/ArchFolio (the hard-coded `SCOPING-MEMO`,
   `PHASE-2-SLICE-*-CLOSE-WALK`, "Tessera-local path-reference table" reads) and ship a
   generic `CLAUDE-COORDINATOR.md` + `WAVE-PLAN-TEMPLATE.md` via `new-project.sh`, so a
   fresh project can produce a DAG/WAVE-PLAN at all. Without this, anchor-auto has no
   reusable DAG source to consume. (This is why anchor-auto rolled its own linear
   decomposer in the first place — the DAG path wasn't project-portable.)
1. **Phase 0 (no behavior change):** teach the decomposer to emit `deps:` (or switch to
   WAVE-PLAN) but keep `PARALLELISM=1`. Ships the DAG model + correct transitive-context
   priming with zero parallel execution. Fully testable in `--dry-run`.
2. **Phase 1:** worklist scheduler + worktree-per-round + serialized gated merge, default
   `--max-parallel 1`. Add tests: a DAG with a diamond (A → {B,C} → D) runs B,C in
   parallel only when `--max-parallel ≥ 2`; merge-breaks-tests rolls back + retries.
3. **Phase 2:** raise default `--max-parallel`, wire rate-limit-aware throttling, resume
   over the done-set, `--clean`.
4. **Phase 3 (optional):** fold in the wave-gate consolidation reviewer at join points
   (`--wave-gate`) for a cold-eye pass after a parallel wave merges.

Each phase is independently shippable and falls back to linear.

## 6. Open questions

- Reuse `WAVE-PLAN-NN.md` wholesale (Coordinator already emits it) vs. extend the
  lighter `ANCHOR-ROUND … deps:` grammar? Leaning WAVE-PLAN to avoid duplicating DAG
  logic — needs a read of how complete `--coordinator` output is in practice.
- Integration branch vs. rebasing each worktree onto the latest done-set — branch is
  simpler and matches the existing multi-track scripts.
- Should escalation (`rc=2`) on one parallel round pause *all* in-flight rounds or let
  them finish-and-merge first? Proposed: let in-flight finish + merge (don't waste the
  compute), then stop before launching new ones — maximizes salvaged work before the
  operator step.

---

## 7. Honest bottom line

For dependency-chain projects (like the SQL engine this was benchmarked on), this buys
**almost nothing** — the chain is the critical path. It pays off on projects with wide,
independent feature fronts. Because it reuses the existing wave/worktree/merge-verify
machinery and keeps `--max-parallel 1 ≡ today`, the incremental risk is bounded and the
robustness thesis ("anchor-auto does less") is preserved as the default.
