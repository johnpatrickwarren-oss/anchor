# ADR 0001 — Pivot Anchor from build-orchestrator to independent-verification harness

- **Status:** Proposed (awaiting acceptance)
- **Date:** 2026-05-31
- **Decision owner:** project owner
- **Supersedes:** the multi-role build-orchestrator premise of `integrations/superpowers-claude-code/`
  (run-pipeline.sh + anchor-auto.sh) and the experimental `packages/cli` `anchor project` tool.

> *Editorial note (2026-06-10): paths in this ADR are pre-archive. `integrations/superpowers-claude-code/`,
> `packages/*`, `scripts/*`, and the design docs referenced below now live under
> [`legacy/`](../../legacy/) (e.g.
> `legacy/integrations/superpowers-claude-code/DESIGN-context-break-benchmark.md`). The ADR text
> is otherwise left as written.*

---

## Context

Anchor was built to compensate for weaker models: **decompose** work that didn't fit one context,
**separate roles** so a single session couldn't cross-contaminate (e.g. rubber-stamp its own code),
and a **memorial** to carry context forward. Each was a real win against the models of the time.

With Opus 4.8 (1M context), two benchmarks this cycle show those compensations have largely
inverted into overhead:

1. **Mini SQL engine (multi-context test).** anchor-auto (10 sequential rounds, ~4.4 h, ~40 role
   sessions) scored **52/54** on an independent oracle — one cross-cutting bug (`ORDER BY` on a
   non-selected column, a R03-projection × R09-ordering interaction the isolated round missed). A
   single dynamic session scored **54/54** in ~20 min, holding the whole model at once. anchor-auto
   had the more thorough *test suite* (86% vs 71% mutation) but was less *correct*. Its own R10
   "full acceptance sweep" passed green and **still shipped the bug**; only the independent oracle
   caught it. A corrective round (R11) fixed it to 54/54 once the failing behavior was fed back —
   proving a build→verify→fix loop works.

2. **JSON Schema 2020-12 validator (context-break calibration).** A single dynamic session built a
   full validator (1267 LOC) in ~10 min scoring **1296/1299 (99.8%)** on the official suite —
   *beating* the ajv reference (96.6%) and nailing the cross-cutting features (`unevaluated*`,
   `$dynamicRef`). It **did not break context.** Its own 37 tests passed green; the independent
   1299-case oracle found 3 real misses.

**The consistent signal across both:** the orchestrator was not the winner. *Independent
verification* was — twice, the builder's own green suite hid real bugs that only an external oracle
caught (`completion + green ≠ correct`). And we never found a task that breaks a single Opus
session (the orchestration niche remains unvalidated). Continuing to hunt for that niche has two
priors against it; see
[`integrations/superpowers-claude-code/DESIGN-context-break-benchmark.md`](../../legacy/integrations/superpowers-claude-code/DESIGN-context-break-benchmark.md)
*(linked at its post-archive `legacy/` location)*.

There is no runtime coupling to unwind: the pipeline already runs headless with **no Superpowers
MCP dependency** (disciplines are inlined as prose; no `--mcp-config`). The pivot is clean.

---

## Decision

**Re-found Anchor as an independent-verification harness around a dynamic builder**, not a
build orchestrator.

> Given a spec, *independently* derive an acceptance oracle (kept strictly separate from the
> implementation); let a dynamic single session build; grade the build against that external truth
> (conformance + property/differential); loop fix-by-fix until the oracle passes or it escalates.
> Decompose into rounds **only** when work *provably* exceeds one context — gated by the
> context-break test, which has not yet triggered.

The orchestrator becomes a **verification loop**; the reviewer role becomes an **oracle author**;
memorial becomes an **oracle library**.

### Core invariant: independence

The oracle must be derived from the **spec**, and the oracle-author session **must not see the
implementation**; the builder **must not see the oracle**. Otherwise the oracle merely confirms the
code's behavior — exactly how the builders' own green suites hid bugs in both benchmarks. This is
the one place Anchor's hardest-won muscle (role isolation, anti-cross-contamination) is *more*
valuable than ever: it is what enforces independence.

---

## New architecture (first cut)

```
spec ──> [Oracle Author]* ──> oracle artifacts ─────────────┐
              (never sees impl)   (conformance cases,        │
                                   property generators,      ▼
                                   optional ref impl)     [Grader / Runner]
spec ──> [Builder]* ──> implementation ─────────────────────►  (runs impl vs oracle;
              (never sees oracle)                                conformance + differential/
                  ▲                                              property; emits failure report)
                  │                                                     │
                  └──────────── fix loop ◄──── failure report ◄─────────┘
                                                  │
                                          (pass ──> done;  stuck ──> escalate; resumable)
```
`*` = independent `claude -p` sessions with isolated context (reusing role-isolation plumbing).

Components:
1. **Spec intake** — normalize the spec into the contract both sides build against.
2. **Oracle Author** (independent) — emit acceptance cases, property generators, and (where
   feasible) an independent reference implementation for differential testing. Never sees the impl.
3. **Builder** — a dynamic single session by default; builds to its own green suite. Never sees the
   oracle.
4. **Grader / Runner** — execute impl against the oracle (example conformance + thousands of
   generated/differential cases); produce a structured failure report.
5. **Fix loop** — feed failures back to the builder; rebuild/patch; re-grade; until pass or escalate
   (proven viable by R11).
6. **Escalation + resume** — operator gate when convergence stalls; resumable.
7. **Oracle library** (memorial, repurposed) — accumulate reusable oracle patterns, property
   generators, and known-bug checks across projects.

Reused infrastructure (unchanged): the robust long-session runner (`detect_claude_flags`,
`is_rate_limit` + backoff, logging, BLOCKED→escalate→resume), the **CPU-liveness watchdog**
(`scripts/session-watchdog.sh`), and anchor-auto's resumable loop-control shape.

---

## Salvage map

**Reuse near-as-is (model-independent plumbing):**
- `scripts/session-watchdog.sh` — CPU-liveness hung-session detection.
- `run-pipeline.sh` session-management guts — flag detection, rate-limit/retry/backoff, logging,
  BLOCKED/escalate/resume. Extract from the role-pipeline into a thin runner.
- `anchor-auto.sh` loop control — decompose→iterate→auto-advance→escalate→**resume** (+ the
  `|| rc=$?` set-e fix). Repurpose "rounds" → "fix iterations."
- The **green-gate**, with criterion changed from "builder's own tests pass" to "**independent
  oracle passes**" — the whole lesson, encoded in one swap.

**Reframe (salvage idea / prompt-craft):**
- Role-isolation machinery (separate sessions, discipline files, `build-role-context.js` cache
  bundling) → **enforce oracle independence**.
- `CLAUDE-REVIEWER.md` cold-eye discipline → the oracle-author / verifier prompt.
- Inlined brainstorm/RED-GREEN disciplines → useful prose for the oracle-author prompt; drop the
  Superpowers branding (it's only a dir name + text, no coupling).
- Memorial → the **oracle library** (compounding acceptance patterns + known-bug catalog).
- `grade.mjs` + the differential-testing approach in `/tmp/anchor-ctxbench` → working prototype of
  the Grader/Runner.

**Discard / shelve:**
- Multi-round **decomposition for building** (dormant; only on a *proven* context-break).
- Multi-track / wave / worktree / DAG parallelism (`multi-track-*.sh`, wave-gate) — not needed; also
  Tessera-coupled.
- The TS `anchor project` tool (`packages/cli`) — already flaky/de-emphasized.
- Memorial's "carry context" purpose; 4-full-session role split (collapse to builder + verifier).

---

## Consequences

**Positive**
- Builds on the thing that won *both* benchmarks (independent verification), not the thing that lost.
- **Model-resilient:** as models get more capable/autonomous, the need for external checking *grows*
  (you're watching less), so this gets *more* valuable — the opposite of the scaffolding treadmill.
- Far less machinery; no MCP entanglement; works headless today.
- Orthogonal to builder choice — wraps a dynamic session now, an orchestrated build later if the
  context-break test ever justifies it.

**Negative / risks**
- **"Who verifies the verifier?" — the central risk.** A generated oracle has its own blind spots,
  and the oracle author shares the *same model's* biases as the builder, so errors may correlate
  (both miss the same edge). Independence reduces but does not eliminate this.
  *Mitigations:* (a) **meta-validate the oracle** — seed/mutate known bugs and confirm the oracle
  catches them *before* trusting it (we did exactly this: validated `grade.mjs` against ajv); (b)
  prefer **property-based + differential** testing over example cases (higher coverage, surfaces
  un-anticipated cross-cutting bugs); (c) **diversify** the oracle author (different angle/prompt,
  optionally a different model) to decorrelate blind spots; (d) the spec is the ceiling — a wrong
  spec yields a wrong oracle; keep the human in the spec loop.
- Generating an independent **reference implementation** for differential testing can be as hard as
  the build itself; start with property assertions + conformance cases where a reference is costly.
- Spec quality bounds oracle quality — the harness verifies *conformance to the spec*, not that the
  spec is what you wanted.

---

## Alternatives considered

1. **Keep investing in the orchestrator (option A).** Rejected: two benchmarks show dynamic
   matches/beats on context-fitting tasks; the orchestration niche is unfound and unvalidated.
2. **Keep building benchmarks hoping to find the breaking niche.** Deferred, not chosen: diminishing
   returns with two priors against; one *novel* test (the typed-language study) remains optional to
   "close the door," but not a prerequisite to start the harness.
3. **DAG-parallel anchor-auto** (`DESIGN-dag-parallel-anchor-auto.md`). Shelved: only matters if the
   orchestration thesis is validated.
4. **Retire Anchor entirely.** Rejected: the independent-oracle value is real and twice-demonstrated;
   that is worth productizing.

---

## Status / next steps

1. **Accept or revise this ADR.**
2. **Meta-validation harness first** — formalize "seed N bugs → confirm the oracle kills them" as the
   gate before any oracle is trusted (generalize the ajv-validation step).
3. **Minimal end-to-end prototype** — reuse the `/tmp/anchor-ctxbench` JSON-Schema harness as the
   skeleton: spec → independent oracle-author session → builder session → grade → fix loop, on the
   reused runner + watchdog.
4. **(Optional) one novel-task context-break test** to rigorously close the orchestration question.
5. Decide whether to keep the `superpowers-claude-code` name (cosmetic; no coupling).
