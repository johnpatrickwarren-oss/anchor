# Anchor — the authoring interview (PRD + properties)

The how-to-apply for [Discipline 2 (Spec-first contract)](DISCIPLINES.md#2-spec-first-contract-load-bearing).

An operator — developer or not — often can't write a spec, and almost never can write a formal
invariant like `∀x. f(f(x)) === f(x)`. That's *why* AI authoring exists. So don't ask the operator
to write the spec. **Ask them good questions; their answers are the spec.** Someone who can't write
the invariant can answer "if you run it twice, should anything change?" — the questions do the
translation.

One interview, three jobs:

1. **The spec precedes the code, so anything derived from it can't encode an implementation bug.**
   A property drawn from the answers is spec-derived *by construction* — this is "spec-before-code"
   as an artifact, not inferred from git timing.
2. **It is the coding spec.** The same answers are the brief the build works from.
3. **Authoring collapses to answering.** No code, no assertions — just plain-language answers.

## The loop

```
operator answers the questions ─▶ PRD / behavioral spec ─▶ model drafts (IMPL-BLIND):
                                                            • the PRD sections
                                                            • candidate properties
                                                            • (optionally) the implementation
                                          │
              each candidate ─▶ deterministic gate (sprag):
                                  project anti-scope → scope_diff / forbid_path
                                  unit properties    → arch property (holds? kills mutants?)
                                          │   ACCEPT → shortlist     REJECT → drop / flag real bug
                                          ▼
                          human reviews the small shortlist ─▶ commit ─▶ enforced MODEL-FREE forever
```

The model enters at exactly one place — **drafting, behind the deterministic filter.** It never
sits on the gate. This is the whole stack's principle restated for authoring: the model proposes; a
model-free check disposes.

**Impl-blind is load-bearing, not a nicety.** An adversarial test (bad answers → junk properties →
the gate) found the deterministic filter catches *weak* and *wrong* candidates but **cannot** catch
an *impl-restating* one — a candidate that copies the implementation as its own "expected" kills
mutants by construction yet tests nothing. The only defense is that the author never sees the
implementation: feed signature + spec + catalog only. sprag's **impl-restatement guard** is the
deterministic backstop; impl-blind authoring is the primary one. (This is the spec-side of the same
independence principle behind [Discipline 1](DISCIPLINES.md#1-independent-cold-eye-review-load-bearing):
a spec written while staring at the code just launders the code into the contract.)

---

## Tier 1 — Project PRD (*what* to build)

For scoping a whole project or feature. Plain-language, operator-answerable. Produces the PRD that
gives the build tight guidance, the success criteria, and the boundary. *(answer-bar → what it
produces)*

> **Where the value actually is** (two-sieve audit). A strong model already knows PRD *structure*,
> so the section list below is close to a base-model default — ceremony if that were all it is. What
> earns Tier 1's place is the part the model **can't** supply: pulling intent out of an operator who
> may not be a developer (their must-nevers, their real examples, their hard constraints), the
> **must-never-first** ordering, and the **bars**. Treat this as the capability-leaning tier and
> half-life-watch it hardest; Tier 2 and impl-blind carry the non-ceremony weight.

1. **Purpose.** *In a sentence or two: what is this, and what job does it do for someone?*
   Bar: names a user and an outcome, not a technology. → purpose; the baseline the restatement guard
   measures "added scope" against.
2. **Must-never / not-its-job.** *What must it never do, and what are you explicitly NOT building?
   (cost, privacy, data it must not touch, scope you're ruling out.)*
   Bar: ≥1 explicit prohibition or out-of-scope item, or a recorded "none." → **anti-scope** → sprag
   `scope_diff` / `forbid_path`. *(Asked second on purpose — see the field test: must-never is the
   highest-value and easiest-to-answer question there is.)*
3. **Smallest useful version.** *What's the least you'd actually use? What can wait for later?*
   Bar: a "v1" line and a "later" line. → **MVP / phasing**.
4. **Success examples.** *Give 2–3 concrete examples: "when I ___, I should get ___." Use real-ish
   inputs and outputs.*
   Bar: ≥2 input→output pairs concrete enough to become a test. → **acceptance criteria** (the
   load-bearing one — non-developers can't write requirements but can give examples).
5. **Constraints.** *Any fixed requirements — where it must run, what it must or must not use, data
   it reads/writes, speed/size limits, things it must integrate with?*
   Bar: enumerated, or explicit "none." → constraints / NFRs.
6. **How you'd try to break it.** *Beyond your examples, what edge case or nasty input would you
   test it with?*
   Bar: ≥1 edge/adversarial case. → edge-case criteria; seeds the cold-eye reviewer and an
   independent oracle if you use one.

## Tier 2 — Unit properties (*is it correct*)

For a single function or module, this elicits behavioral **invariants** — things true over *all*
inputs — that feed sprag's `arch property` (a candidate is accepted only if it holds on the code
*and* kills mutants; the model authors, the gate decides). This is the validated 7-question set;
its derivation (13 → 7, field-tested on three real functions) is in
[`design/prd-interview-field-test.md`](design/prd-interview-field-test.md). *(answer → property
shape it yields)*

1. **Contract.** *One sentence: the single promise this makes to its caller.* → core postcondition.
2. **Must-never.** *What must never happen, no matter the input?* → **safety invariant** (surfaced
   the single best property for every function tested).
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
   version? A formula?* → **differential / reference oracle** (the strongest property when it
   exists — prompt for it with an example, operators rarely volunteer it).
7. **Examples & worry.** *Give 1–3 input→output pairs you're certain of. Which case worries you
   most?* → golden seeds + a targeted property.

A blank or "n/a" answer is fine and informative — it means that shape doesn't apply. Most functions
light up 4–6 of the seven.

## The two tiers share a spine

**Must-never** and **concrete examples** are central to both tiers — independently, the project-level
and unit-level question sets both converged on these two as the highest-value, most-answerable
prompts. The difference is only where the answer lands: a *project* must-never becomes anti-scope the
scope gates enforce; a *unit* must-never becomes a safety invariant `arch property` enforces. Lead
with must-never at both altitudes.

## Fit for purpose — the questionnaire is the rubric

Each question carries a **pass-bar**. That is what makes this a guardrail and not just a prompt: an
answer below its bar is a gap, and a gap triggers a **bounded** follow-up — not "tell me more" but
"Q4 needs 2 concrete input→output examples; you gave 1 — one more?". A produced artifact is
fit-for-purpose iff:

- every question is answered to its bar (or explicitly marked n/a),
- every section of the produced PRD traces back to an answer, and
- it **adds scope beyond the one-liner** — if the PRD is just Q1 reworded, it failed (this last is
  sprag's deterministic restatement guard).

A pass-bar splits the way everything else does: the **countable** half (≥2 input→output pairs, ≥1
explicit prohibition) is mechanizable, so it's sprag's existence-check; only the **quality**
judgment — is this example concrete enough to become a test? is this a real prohibition? — is the
behavioral residue this interview owns.

What the deterministic filter does and does **not** guarantee, from the adversarial test:

| Junk class | Caught by the gate? | Why |
|---|---|---|
| **Too weak / tautological** ("returns a boolean") | **YES — reject** | survives every mutant (0% kill) |
| **Wrong** (asserts something false) | **YES — reject** | fails on the current code (doesn't hold) |
| **Impl-restating** (copies the implementation as its "expected") | **NO** | kills mutants by construction, yet catches no real bug |

So the gate is robust to weak and wrong candidates *regardless of operator quality* — the
"trust the verifier, not the author" claim holds. It is **not** robust to restatement; that is what
impl-blind authoring (above) and the restatement guard exist to cover.

## Keep it honest

Per Anchor's [half-life rule](DISCIPLINES.md#keep-this-list-honest): the durable artifacts here are
*the question sets* and the finding that *must-never leads*. The *act* of conducting a requirements
interview is increasingly something a strong model does unprompted — so what earns its keep is the
specific validated set and the bars, not "ask the operator good questions." Re-test on each model
upgrade; keep the questions that still surface what a bare default would miss.
