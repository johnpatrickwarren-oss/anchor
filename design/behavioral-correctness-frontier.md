# Design note — the behavioral-correctness frontier

*Scoping note carried over from sprag. Status: the decisions at the end are now **resolved** by the
sprag/Anchor split ([ADR-0002](adr/0002-split-deterministic-gate-from-behavioral-pack.md)); the
ladder is kept because it's the map of where behavioral correctness lives across the two tools.*

## The problem

sprag's deterministic floor answers **"is the code well-*formed*?"** — structure (god-objects,
complexity, coupling), supply chain, types, secrets, test *discipline* (`require_tests` + `mutate`),
and the gate's own integrity (fail-closed + meta-ratchet). None of it answers **"does the code do
the *right thing*?"** — behavioral correctness. That's categorically different.

## Why it's hard: the oracle problem

Behavioral correctness needs an **oracle** — something that declares what "correct" is. The oracle
can be: (1) a human-written spec/example, (2) a **property** (an invariant over all inputs), (3) a
**reference implementation** (old code, a golden snapshot), or (4) a **model**. The moment the
oracle is a model, you're back in the regime sprag was built to escape — *capped by oracle quality*,
the "who-verifies-the-verifier" problem (the same wall the [ADR-0001](adr/0001-pivot-to-verification-harness.md)
pivot hit with generated oracles). Governing principle:

> Push as far as possible with **human-authored or differential** oracles before touching a model
> oracle. If a model oracle is ever used, its output is a *candidate for judgment*, never a verdict —
> exactly how the structural checks already behave.

## The deterministic-first ladder

Cheapest / most philosophy-aligned → most expensive / model-dependent. Each rung is a possible
build; you don't have to climb past where it pays.

- **Rung 0 — shipped (sprag).** `require_tests` (tests exist) + `mutate` (tests actually catch
  injected bugs). The deterministic *shadow* of behavior. Gap: never checks the tests encode the
  right **intent**.

- **Rung 1 — Property-based invariants, authored by human OR AI, accepted deterministically.
  (Gate shipped in sprag; the authoring loop is Anchor's.)** A property is a behavioral invariant
  over *all* inputs. The refinement: don't assume the human can author it — let a **model author the
  invariant within correct limitations**, as an *authoring assistant only*, **never the gate-time
  oracle**. The who-verifies-the-verifier resolution: a proposed property is trusted only if it
  (1) **holds** on the current code and (2) **kills mutants** — proven by `arch mutate`. You can't
  fake killing a mutant, so a deterministic verifier accepts/rejects; once accepted, the property is
  committed and enforced model-free forever.
  - **The "correct limitations":** black-box (public API only); spec-derived, **impl-blind** (so the
    property can't encode the bug); relations over restatement; must-hold; must-kill-mutants. The
    last two are enforced mechanically by `arch property`; see sprag's `library/property-templates.md`.
  - **Shipped in sprag:** `arch property` (holds + mutation-kill = ACCEPT/REJECT) + the sound-shape
    catalog + the AI-authoring contract + the **impl-restatement guard**.
  - **Anchor's half:** the authoring loop — the operator interview that produces the spec, and the
    impl-blind drafting of candidates that get fed into `arch property`. See
    [`../PRD-INTERVIEW.md`](../PRD-INTERVIEW.md).

- **Rung 2 — Differential / golden / characterization testing.** Pin behavior against a reference:
  the *previous implementation* (catches "the AI refactor silently changed behavior") or *approved
  golden outputs*. Deterministic; the oracle is "the old behavior" or "the signed snapshot," not a
  model. Strong second rung; best coverage of the AI-rewrites-and-drifts case.

- **Rung 3 — Metamorphic testing.** Where there's no full oracle, encode relations that must hold
  (`f(2x) == 2·f(x)`; results stable under input reordering). Human-authored relations,
  deterministic. Useful for data/ML code where ground truth is unknown.

- **Rung 4 — Spec-precedence (process-as-check).** Enforce that an acceptance test for a behavior
  *existed / was human-approved before* the implementation — via git-history precedence or a
  signed-spec manifest. Mechanically checkable; directly attacks the "AI authored both the code AND
  its blessing test in one breath" circularity. Cheap, novel, fits the meta-ratchet family.

- **Rung 5 — Model oracle.** Only for the residue rungs 1–4 can't reach: LLM-as-judge for spec
  conformance ("does this diff satisfy this English acceptance criterion?"). Must be (a) used only
  *after* the deterministic rungs, (b) a candidate-for-judgment, not a verdict, (c) adversarial /
  multi-vote, (d) out-of-band, never per-commit. This is [Anchor Discipline 1](../DISCIPLINES.md#1-independent-cold-eye-review-load-bearing)
  territory, not a sprag gate.

## Resolved decisions

The original draft left these open; the split settles them:

1. **Charter — is behavioral correctness in sprag's scope?** Only its **deterministic** forms (Rungs
   1–4: human or impl-blind-AI authors the invariant, the machine enforces it, no model on the gate).
   The **model-oracle tier (Rung 5)** is **Anchor's**, not sprag's — putting it in sprag would
   reintroduce the who-verifies-the-verifier problem sprag's whole pitch disavows.
2. **What sprag shipped:** Rung 1's gate (`arch property`) + the impl-restatement guard. Rung 2
   (differential/golden) and Rung 4 (spec-precedence) remain the highest-value next deterministic
   rungs if/when built.
3. **What Anchor owns:** the authoring loop (the operator interview → impl-blind candidate drafting),
   and Rung 5 (independent model review) as a Discipline-1 application — model proposes, never the
   verdict.

The partition holds: sprag enforces, Anchor authors; a model only ever proposes.
