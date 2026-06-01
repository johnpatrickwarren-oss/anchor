# Verification-harness prototype (ADR 0001)

Prototype of the rearchitected Anchor: an **independent-verification harness** around a dynamic
builder, with an **oracle gate** so an unvalidated oracle never drives a fix-loop. See
`design/adr/0001-pivot-to-verification-harness.md` for the decision and rationale.

> **Status: research prototype.** The first full run produced an important negative result (a
> generated oracle's false-positive made the fix-loop thrash at ~5× cost and corrupt the build);
> the gate added afterward is validated to catch exactly that. See **Findings** below.

## Pipeline

```
spec ─> [oracle-author]* ─> oracle/run.mjs ──┐        (* independent claude -p sessions,
spec ─> [builder]* ─────> build/src/index.ts ─> [grade] ─> failures   cwd-isolated; builder never
                                                   │           sees the oracle, oracle-author
                                                   ▼           never sees the build)
                                          [ORACLE GATE]  ← validate the oracle BEFORE trusting it
                                                   │
                                       reject ◄────┴────► trust ─> [fix-loop] (+ non-convergence guard)
```

## Files

| File | Role |
|---|---|
| `harness.mjs` | the orchestrator: oracle-author → builder → grade → **gate** → fix-loop. CLI below. |
| `prompts/` | role prompts (oracle-author, builder, fixer) — independence reinforced in-prompt |
| `grade.mjs` | grades a validator vs the official JSON-Schema draft2020-12 suite (the *trusted* oracle / ground truth) |
| `ref-ajv.mjs` | ajv adapter — used to re-validate `grade.mjs` itself (it scores ajv 1255/1299) |
| `meta-validate.mjs` | the **meta-validation gate**: seeds bugs into a known-good build, measures the oracle's kill rate |
| `grade-authored.mjs`, `meta-validate-authored.mjs` | variants pointed at a harness-*authored* oracle |
| `test-gate.mjs` | **self-contained** regression test (no deps): proves the gate rejects the saved bad oracle |
| `fixtures/known-good-validator/` | a correct JSON-Schema validator (1296/1299), used as the gate's reference build |
| `fixtures/bad-oracle-run.mjs` | the authored oracle from the first run, with its `__proto__` false-positive (case study) |
| `PRD-validator.md`, `specs/` | build specs |

## Quick start

```bash
# Self-contained — proves the gate would reject the bad oracle (no setup needed):
node test-gate.mjs

# Full tooling (fetches the ~4.3M official suite into vendor/ + installs ajv):
./setup.sh
node --check harness.mjs
ARM_VALIDATOR=fixtures/known-good-validator/index.ts node grade.mjs   # -> 1296/1299

# Full harness run (spawns long claude sessions; needs the watchdog at the path in harness.mjs):
node harness.mjs --spec PRD-validator.md --workdir /tmp/run1 --max-iters 3 \
  --reference fixtures/known-good-validator/index.ts   # reference enables the strongest gate check
```

Exit codes: `0` converged · `2` build not converged · `3` **oracle rejected** (gate) · `64` usage · `1` fatal.

## The gate (3 mechanisms, strongest first)

- **(A) Reference cross-check** (`--reference <known-good entry>`): any case the oracle fails on
  *correct* code is a false-positive → reject. Decisive, but needs a known-good reference.
- **(B) Adequacy / kill-rate floor** (`--gate-kill-rate`, default 0.7): seed bugs into the build,
  confirm the oracle kills them. Advisory — equivalent mutants cap even good oracles at ~70–80%.
- **(C) Non-convergence guard** (in the fix-loop): a no-progress iteration ⇒ suspected
  false-positive ⇒ stop instead of thrashing. General (no reference needed).

## Findings (why the gate exists)

First full run on `PRD-validator.md` (JSON-Schema 2020-12 validator):
- Build correctness vs the trusted suite: **1296/1299 — identical to a bare dynamic session.** No gain.
- The 1 case the authored oracle flagged was a **false-positive** — a bug in the oracle's *own*
  test fixture (`{ __proto__: ... }` JS literal sets the prototype, not an own key).
- The fix-loop **thrashed 3 iterations** chasing it and started adding spec-incorrect code; the
  authored oracle's own adequacy was only **71.7%** (worse than the off-the-shelf suite's 80%).
- Cost: **~51 min ≈ 5× the ~10-min solo build**, ~68% wasted on the phantom.

**Lesson (and the fix):** a generated, *untrusted* oracle is worse than no oracle. The harness's
value depends entirely on oracle quality, so the **gate is load-bearing** and must run *before* any
fix-loop; prefer trusted/reference oracles where they exist. `test-gate.mjs` confirms the gate now
rejects the exact oracle that caused the thrash.
