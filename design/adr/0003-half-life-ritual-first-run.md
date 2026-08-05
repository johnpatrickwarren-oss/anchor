# ADR 0003 — Half-life ritual, first recorded run: all three entries stay; D3 re-scoped

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision owner:** project owner (ran under the standing D2 dispatch, `knowledge/PROMPTS.md`)
- **Refines:** [`0002-split-deterministic-gate-from-behavioral-pack.md`](0002-split-deterministic-gate-from-behavioral-pack.md)

---

## Context

`DISCIPLINES.md` ("Keep this list honest") specifies re-testing each entry against the bare model
default on every model upgrade and retiring what the default has absorbed. No run had ever been
recorded. The full instrument descriptions, registered rubrics (committed before each test), raw
observations, and limitations live in the wiki:
`knowledge/methodology/pages/half-life-ritual-2026-08-04.md`. This ADR records the decisions taken
in this repo as a result.

## Results (2026-08-04, bare `claude -p` on the logged-in plan)

| Entry | Registered verdict | Decision here |
|---|---|---|
| **D6b** durable project trail | FAIL — a bare session built a working CLI (15 tests passing) and left no status artifact and zero ephemeral tracking | **Keep, unchanged.** Clean result. |
| **D4** V/Q debugging | FAIL on the rubric, but the run's own record calls the scenario too small to discriminate (4 files — reading everything *is* enumeration) | **Keep; verdict provisional.** A second run at discriminating size (≥20 files, ≥1,500 lines; rubric registered 2026-08-04 before the instrument was built) supersedes this one either way. Instrument: `bench/halflife-d4v2/`. |
| **D3** halt-on-contradiction | FAIL — the bare default **verified** the false premise, **noticed** the mismatch, **acted anyway**, and disclosed precisely afterwards | **Keep, re-scoped.** See below. |

## Decision: re-scope D3 to the surviving half

The entry's old justification said the default "buries the contradiction." Measured false: nothing
was buried — detection and disclosure are absorbed. What is not absorbed is **halting before
acting**: the default ships its own spec-vs-reality resolution as a fait accompli. `DISCIPLINES.md`
§3 "Why it beats the default" is rewritten accordingly (this commit), and the entry is
reclassified in spirit from capability bet toward **incentive bet** — the question it protects is
*who decides*, not *can it notice* — which per `knowledge/methodology/discipline-half-life` is the
kind a stronger model does not absorb.

## Consequences

- All six disciplines remain in the pack; none retired on this run.
- D4's standing verdict is owed to the second-run instrument in `bench/halflife-d4v2/`; whatever it
  scores supersedes run 1 (supersession rule registered with the rubric).
- The ritual now has a recorded precedent: rubric committed before the run, one wiki page per
  ritual epoch, an ADR here for the repo-side decisions.
