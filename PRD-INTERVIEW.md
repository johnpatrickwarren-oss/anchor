# Anchor — the unit-property interview

Elicits behavioral **invariants** of a single function or module — things true over *all* inputs —
that feed sprag's `arch property` (a candidate is accepted only if it *holds* on the code and *kills
mutants*; the model authors, the gate decides). It is the unit-level companion to
[Discipline 2 (Spec-first contract)](DISCIPLINES.md#2-spec-first-contract-load-bearing), which
covers eliciting the *project* spec from an operator who may not code.

An operator — developer or not — almost never writes a formal invariant like `∀x. f(f(x)) === f(x)`.
That's *why* AI authoring exists. So don't ask for the invariant. **Ask good questions; the answers
are the spec.** Someone who can't write the invariant can answer "if you run it twice, should
anything change?" — the questions do the translation. Three jobs in one:

1. **Spec-derived by construction.** The questions precede the code, so a property drawn from the
   answers can't encode an implementation bug.
2. **It is the coding spec too.** The same answers brief the build.
3. **Authoring collapses to answering.** No code, no assertions — plain-language answers.

## Impl-blind authoring

The operator's answers become a behavioral spec; a model drafts candidate properties from it; sprag's
`arch property` accepts only the ones that *hold* and *kill mutants*; a human reviews the short
shortlist; the survivors are committed and enforced model-free. The model enters at exactly one place
— **drafting** — and never sits on the gate: it proposes, a model-free check disposes. Mechanizing
that flow is a tool's job (a future `arch propose`, sprag-adjacent), not something Anchor runs.

**Impl-blind is load-bearing, not a nicety.** An adversarial test (bad answers → junk properties →
the gate) found the deterministic filter catches *weak* and *wrong* candidates but **cannot** catch
an *impl-restating* one — a candidate that copies the implementation as its own "expected" kills
mutants by construction yet tests nothing. The only defense is that the author never sees the
implementation: feed it signature + spec + the catalog, never the body. sprag's **impl-restatement
guard** is the deterministic backstop; impl-blind authoring is the primary one. (Same independence
principle as [Discipline 1](DISCIPLINES.md#1-independent-cold-eye-review-load-bearing), on the spec
side: a spec written while staring at the code just launders the code into the contract.)

## The question set

The validated 7. Derivation (13 → 7, field-tested on three real functions) is in
[`design/prd-interview-field-test.md`](design/prd-interview-field-test.md). *(answer → property
shape it yields)*

1. **Contract.** *One sentence: the single promise this makes to its caller.* → core postcondition.
2. **Must-never.** *What must never happen, no matter the input?* → **safety invariant** (surfaced
   the single best property for every function tested — ask it first).
3. **Domain & refusal.** *What are the valid inputs and their ranges? What inputs are invalid, and
   exactly what should happen for each?* → input generators + **totality** (no crash on the valid
   domain) + error contract.
4. **Output is always…** *What is true of every correct output, regardless of input? (sorted?
   non-null? within a range? same length?)* → **output invariant**.
5. **Relations** *(answer any that apply).* *Run it twice — does anything change? Does input order
   matter? If the input grows, what does the output do? Is there an operation that undoes it? Is
   anything preserved — count, sum, the set of elements?* → idempotence / commutativity /
   monotonicity / round-trip / conservation.
6. **Reference.** *Is there a slow-but-obviously-correct way to get the same answer? An older
   version? A formula?* → **differential / reference oracle** (the strongest property when it exists
   — prompt for it with an example; operators rarely volunteer it).
7. **Examples & worry.** *Give 1–3 input→output pairs you're certain of. Which case worries you
   most?* → golden seeds + a targeted property.

A blank or "n/a" answer is fine and informative — it means that shape doesn't apply. Most functions
light up 4–6 of the seven. (**Must-never** and **concrete examples** are the universal two — they
fired on every function in the field test, and they're the ones a non-expert answers best.)

## Fit for purpose — the questionnaire is the rubric

Each question carries a **pass-bar**. That is what makes this a guardrail and not just a prompt: an
answer below its bar is a gap, and a gap triggers a **bounded** follow-up — not "tell me more" but
"Q7 needs 2 concrete input→output examples; you gave 1 — one more?". The answers are fit-for-purpose
iff every question is answered to its bar (or explicitly marked n/a) and the drafted properties trace
back to those answers.

A pass-bar splits the way everything else does: the **countable** half (≥2 input→output pairs, ≥1
explicit prohibition) is mechanizable, so it's sprag's existence-check; only the **quality**
judgment — is this example concrete enough to become a test? is this a real prohibition? — is the
behavioral residue this interview owns.

What the deterministic filter does and does **not** guarantee, from the adversarial test:

| Junk class | Caught by `arch property`? | Why |
|---|---|---|
| **Too weak / tautological** ("returns a boolean") | **YES — reject** | survives every mutant (0% kill) |
| **Wrong** (asserts something false) | **YES — reject** | fails on the current code (doesn't hold) |
| **Impl-restating** (copies the implementation as its "expected") | **NO** | kills mutants by construction, yet catches no real bug |

So the gate is robust to weak and wrong candidates *regardless of operator quality* — the "trust the
verifier, not the author" claim holds. It is **not** robust to restatement; that is what impl-blind
authoring and the restatement guard exist to cover.

## Keep it honest

Per Anchor's [half-life rule](DISCIPLINES.md#keep-this-list-honest): the durable artifact here is
*the validated question set* (and that must-never leads), not "interview the operator" — a strong
model conducts a requirements interview unprompted, but it does **not** reliably produce strong,
non-restating invariants on its own; the 7 elicit the shapes it misses. Re-test on each model
upgrade; keep the questions that still surface what a bare default would not.
