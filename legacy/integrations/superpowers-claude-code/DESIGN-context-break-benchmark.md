# Design: the "breaks-a-single-context" benchmark

**Status:** Design only — not yet built. Authored 2026-05-31.
**Question it answers:** Is there a task regime where a *managed/decomposed* build (anchor-auto:
rounds + memorial + independent roles) is measurably **more correct** than an *unmanaged* single
dynamic Opus 4.8 session — i.e., does anchor-auto's orchestration actually earn its cost where a
single session degrades? This is the test we never ran; until it's run, anchor-auto's value is
unproven (see the SQL-engine result: dynamic won a context-*fitting* task on speed, cost, and
correctness).

---

## 1. The flaw this design fixes

The SQL-engine benchmark was **mis-sized**: the task fit in one context, so the dynamic session
held the whole thing (54/54) and decomposition was pure overhead. We *assumed* "10 rounds = big
enough" and were wrong.

**Therefore the central rule here: dynamic must be DEMONSTRATED to degrade before the comparison
is valid.** If the dynamic single session does not degrade, the result is **inconclusive (task too
small)** — NOT a win for anchor-auto. This is a hard gate, not a footnote.

We operationalize it as a **scaling study**: measure correctness as a function of task complexity
for *both* arms, and look for whether/where a gap opens. The shape of the curves is the finding —
a single point can't answer the question.

---

## 2. What "breaks a single context" actually means (and what it doesn't)

It is NOT raw repo size. A dynamic session with tool use reads a huge existing codebase
on demand and never holds it all at once — so "extend a 50k-LOC repo" mostly does NOT break
context; it just reads what it needs. The binding constraint is the **simultaneously-relevant
working set**: the number of *interacting* decisions/invariants the model must keep mutually
consistent at once. Single sessions degrade by **dropping or contradicting far-apart requirements**
as attention fills (exactly the cross-cutting ORDER-BY miss, but at scale).

So the task must force a large, *coherent, internally-interacting artifact the model itself
produces* — where getting part N right depends on remembering decisions from parts 1..N-1. That
is precisely the regime decomposition + memorial were invented for.

Two complementary degradation signals:
- **Behavioral (primary):** oracle pass-rate. At small scale both arms ≈100%; the question is
  whether dynamic's rate drops with scale while anchor-auto's holds.
- **Mechanical (corroborating):** does the dynamic session exhaust/compact context, and what is
  its peak context usage vs the window? If the harness exposes token/context telemetry, record it;
  a forced auto-compaction mid-build is direct evidence the working set exceeded the window.

---

## 3. Task selection

Criteria: (a) self-contained, deterministic, dependency-free (clean oracle, like the SQL engine);
(b) **hundreds of gradable behaviors with dense cross-cutting interactions**; (c) a **scale dial**
(add feature-families to grow the interacting working set); (d) resists pure recall (so the model
must hold context, not pattern-match training data); (e) a correct **reference implementation** is
buildable so the oracle can be validated.

**Recommended task: a small statically-typed language — lexer → parser → type checker → evaluator.**
Why it's ideal: type systems are nearly all cross-cutting interaction (inference ↔ generics ↔
variants ↔ pattern-match exhaustiveness ↔ scoping ↔ coercion), grading is unambiguous (well-typed?
inferred type? runtime value? specific error?), and it has a clean scale dial:

| Tier | Added feature-families (cumulative) | Purpose |
|---|---|---|
| S1 | ints/bools, arithmetic, comparisons, `let`, `if` | calibration floor (expect both ≈100%) |
| S2 | + functions, closures, recursion, basic Hindley-Milner inference | |
| S3 | + records, tuples, variants/sum types, pattern matching + exhaustiveness | interactions multiply |
| S4 | + parametric generics, type classes/traits, modules/imports | |
| S5 | + effects/exceptions, mutable refs, exhaustive error taxonomy, edge-case conformance | the working set should now exceed one coherent pass |

Scale by including S1..Sk. **Novelty knob:** rename keywords/operators and tweak 2–3 semantic rules
away from any real language (e.g., a deliberately unusual coercion or shadowing rule) so success
requires holding *this spec*, not reciting Haskell/OCaml.

**Faster alternative:** a JSON Schema validator graded by the *official* JSON-Schema-Test-Suite
(hundreds of cases, a ready-made validated independent oracle). Trade-off: the model knows JSON
Schema well, so prior recall may blunt the context-stress (it affects both arms equally, so it
doesn't bias the *comparison*, but it may keep the task from breaking context at all). Use only if
building the typed-language reference proves too costly.

---

## 4. The oracle (independent, validated, hidden)

- Build a **correct reference implementation** of the chosen spec (operator-owned; arms never see it
  or the oracle).
- **Validate the oracle to 100% against the reference before trusting it** (the rule we already
  follow). A measurement tool that hasn't been validated is not used.
- Grade with **two layers**:
  1. **Hand-written conformance cases** per feature-family, *deliberately including cross-cutting
     interaction cases* (e.g., "pattern-match exhaustiveness over a generic variant inside a
     module-imported type") — that's where both decomposition and single-session degrade.
  2. **Differential / property-based testing:** generate thousands of random well-typed and
     ill-typed programs, run them through the reference and each arm, flag any divergence. This
     gives a high-resolution score and surfaces cross-cutting bugs no hand case anticipated — a
     direct upgrade over 54 fixed cases.
- Report **oracle pass-rate per scale tier** for each arm; that vector is the primary result.

---

## 5. Arm protocols (fairness)

Both arms receive the **identical PRD** for the chosen scale tier and are graded by the **identical
hidden oracle**. Same model (Opus 4.8) and routing fairness. Runs are **sequential, not concurrent**
(same account contends — learned this session), on a **stable wired/confirmed network**, under the
**CPU-liveness watchdog** (frozen ≠ slow; learned this session).

- **Arm D (dynamic):** ONE Claude session, free tool use, the full PRD, told to build to a green
  suite, run until it declares done. No manual context management by the operator. If the harness
  auto-compacts, that counts as part of "single session under load" — and is logged as a
  degradation signal. Record peak context if available.
- **Arm A (anchor-auto):** decompose → sequential rounds on one tree + memorial + independent
  roles, as today. Same PRD, same oracle.

**Neither arm sees the oracle, the reference, or the differential generator.** The PRD describes
behavior in spec terms only (as the operator would).

---

## 6. Confounds to control (name them, per benchmarking-rigor)

- **Mis-sizing** → the §1 validity gate (dynamic must degrade) + scaling study.
- **No-build `.js`↔`.ts` import resolution** → fix consistently for both arms (rewrite specifiers
  or add a build step; same for both); the resolution path must not be what fails.
- **Prior-knowledge recall** → novelty knob (§3) so the task can't be answered from training.
- **Tool-on-demand defeating context pressure** → greenfield artifact the model *produces* and must
  keep self-consistent (not navigation of an existing repo).
- **Oracle validity** → validated to 100% on the reference first; differential generator seeded
  deterministically and itself sanity-checked.
- **Equivalent mutants / noisy mutation scores** → same operator set both arms; report killed/total
  with survivor samples; treat mutation as *secondary* (test adequacy), oracle as *primary*.
- **One-shot luck** → run each arm **≥3 times per tier**; report distribution, not a single run.
- **Operator contamination** → the corrective-round trick (R11) is NOT used here; we grade as-built.

---

## 7. Metrics

| Metric | Role |
|---|---|
| **Oracle pass-rate per scale tier** (hand + differential) | **PRIMARY** — the correctness curve |
| Peak context usage / forced compactions (Arm D) | degradation mechanism evidence |
| Mutation score | secondary (test-suite adequacy) |
| Completion (did it finish? rounds? escalations?) | capability |
| Wall-clock + cost (sessions, tokens) | efficiency — excluding any infra/network waste |

---

## 8. Decision rule (what each outcome means for Anchor)

Run the scaling study and read the curves at the tier where **Arm D first drops clearly below
~100%** (the demonstrated context-break point):

1. **Arm A holds materially higher than Arm D at the break point** (e.g., A ~90% vs D ~70%, across
   ≥3 runs) → **the orchestration thesis is validated.** Decomposition+memorial earn their cost on
   oversized work. Rearchitect around *this* niche; invest in anchor-auto.
2. **Arm A degrades about as much as Arm D** → decomposition does NOT rescue correctness; it just
   costs more. → Anchor's future is the **thin independent-verification harness over dynamic**
   (the §"direction" from the rearchitecture discussion), not the orchestrator.
3. **Arm D never drops below ~100% even at S5** → for this task class, single-context isn't the
   binding constraint at all → the orchestration thesis is wrong here; either find a genuinely
   harder task class or accept that dynamic+verification is the answer.

Crucially, outcomes 2 and 3 are NOT "anchor-auto lost a fair fight" — they're "orchestration isn't
the lever." Only outcome 1 justifies continued investment in the orchestrator.

---

## 9. Execution plan (phased; cheap calibration first)

0. **Build + validate** the reference impl and oracle for tiers S1..S5 (the bulk of the work;
   reuse the SQL-bench harness shape — `ARM_SRC` env, `node --test`, differential runner).
1. **Calibrate the break point (Arm D only):** run dynamic at S1, S2, S3, … and plot oracle
   pass-rate. STOP scaling when Arm D clearly degrades (e.g., <90%) — that tier is the test point.
   *If Arm D never degrades through S5, report that and stop — the thesis is likely outcome 3.*
2. **Run both arms ≥3× at the break tier** (and one tier below as a control where both should be
   ~100%). Sequential, stable network, watchdog on.
3. **Grade + analyze:** oracle curves, context telemetry, mutation, cost; apply the §8 decision
   rule; write the verdict to memory.

Estimated cost: Phase 0 is the real investment (building a correct typed-language reference +
oracle is itself a multi-hour task). Phases 1–3 are mostly automated runs. Budget for the dynamic
calibration sweep to be cheap; the anchor-auto runs at high tiers are the expensive part
(many rounds × role-sessions).

---

## 10. Open questions

- Does the harness expose per-session context/token telemetry? If yes, mechanical degradation
  becomes directly measurable (best evidence); if no, we rely on the behavioral curve + observed
  auto-compaction.
- Typed-language reference is the rigorous choice but costs the most to build. Is a JSON-Schema /
  official-suite run an acceptable *first* pass to cheaply check whether ANY large-conformance task
  breaks Arm D, before committing to the bespoke reference? (Recommended: yes — run the cheap
  JSON-Schema calibration first; only build the bespoke typed-language reference if even that
  doesn't break Arm D, or if recall is judged to be masking the result.)
- Where is "one context" for Opus 4.8 (1M) actually exceeded by a *produced* artifact? Phase 1
  calibration answers this empirically rather than by guess — which is the whole point.
