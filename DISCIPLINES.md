# Anchor — behavioral disciplines

The behavioral half of quality. [sprag](https://github.com/johnpatrickwarren-oss/sprag)
enforces the *deterministic* floor — structure, test-efficacy, scope — as a mechanical gate
with no model in the loop. Anchor is the short, deliberately small set of *behavioral*
disciplines that still beat a strong base model's defaults: the judgment calls you can't
compile into a gate.

Pair them. **sprag is the gate; Anchor is the prompt.** Together they are the whole quality
stack — a mechanical floor plus a handful of disciplines — with no orchestration harness.

## Why the list is short

A discipline earns a place here only if it passes **both** sieves:

1. **It can't be made deterministic.** If a check can be mechanized, it belongs in sprag as an
   invariant (anti-scope → `scope_diff`; "no self-confirming tests" → `arch mutate`; "no
   untested code" → `require_tests`), not here as prose. Prose reminders that *could* be gates
   are how a methodology bloats.
2. **It still beats the base model's default.** A strong model already writes tests, brainstorms
   approaches, and debugs systematically when asked. Telling it to do what it already does is
   ceremony. A discipline stays only if it fights a *structural incentive* the model has —
   sycophancy, eagerness-to-finish, hypothesis tunnel-vision, favorable framing — that scaling
   the model up does not obviously remove.

Most of what Anchor once was fails one of these sieves and has been removed — see
[What used to be here](#what-used-to-be-here). What survives is five disciplines, two of them
load-bearing.

---

## 1. Independent cold-eye review *(load-bearing)*

**Trigger:** Before any non-trivial change is considered done.

**Discipline:** A *separate, fresh-context* reviewer that never saw the build reasoning audits
the change against the spec and the code, prompted to **find what's wrong**, not to bless it.
It judges the artifact, not the author's intent.

**Why it beats the default:** A model reviewing its own work in the same context is the single
most sycophantic thing it does — it has already decided the work is good and will rationalize
toward "looks correct." The default self-review is worth little because it shares every blind
spot of the build. Clean context plus an adversarial frame is what breaks that. In my experience — across the
projects this was distilled from, not a measured result — it is the highest-yield discipline here.

**How to apply:** Spawn a subagent (or open a clean session) that receives only the spec and the
diff — not your reasoning, not your summary of why it's right. Prompt it adversarially: *"You are
auditing this change. Find the ways it fails the spec or breaks existing behavior. Cite
file:line. A clean review is a few lines; do not narrate."* Then address every finding by
severity — don't dismiss. When the change includes a *correction* to a prior claim, have the
reviewer confirm it propagated to every semantic-paraphrase site and downstream citation — a
literal grep returning zero is not consistency; the wrong claim survives re-worded.

**Watch for:** A reviewer that always passes isn't reviewing — recalibrate the prompt. A reviewer
that saw your reasoning isn't independent — it will agree with you. This is the behavioral cousin
of an independent oracle: cheaper, and it does not pretend the verifier's blind spots are gone,
only that they're *different* from the builder's. For that reason, when stakes are high, make the
reviewer genuinely decorrelated — a different model, or back it with property/differential tests.

## 2. Spec-first contract *(load-bearing)*

**Trigger:** Before writing code for anything beyond a mechanical one-liner.

**Discipline:** Write the contract before the code: explicit **acceptance criteria**, an explicit
**anti-scope** (what this change will *not* do), and traceability from each criterion back to the
need it serves. Two completeness checks on that contract:

- **Conjunction cross-check.** Every compound requirement — "X *and* Y", "A *but not* B", "for
  all Z" — gets each conjunct made its own criterion. Models satisfy the first clause and quietly
  drop the rest.
- **Prescription → criterion coverage.** Every behavior the spec prescribes maps to a criterion
  that would fail if the behavior were absent. A prescribed behavior with no check is a behavior
  that won't ship.

**Why it beats the default:** A model handed a vague prompt starts coding immediately and drifts —
it builds a plausible thing, not the asked-for thing, and the gap only surfaces at review (or
production). The spec is also the one input sprag can't gate for you: its Tenet 1 is that the
invariants are *yours to author*. Garbage-in still produces confidently-verified garbage-out;
this is the discipline that keeps the input honest.

**How to apply:** For real features, draft the contract first and (per discipline 1) let a clean
reviewer grill *the spec* before any code exists — a spec gap caught here is far cheaper than the
same gap caught after implementation (rule of thumb ~10×, not a measured constant). Keep the acceptance criteria; they become the test list and
the reviewer's checklist. If the operator can't write the contract — or isn't a developer — don't
make them: run the authoring interview in [`PRD-INTERVIEW.md`](PRD-INTERVIEW.md), where
plain-language answers become the PRD (and, per unit, candidate properties), drafted impl-blind and
accepted by the deterministic gate.

**Watch for:** The spec is the ceiling. The whole stack verifies *conformance to the spec*, never
that the spec is what you actually wanted — keep a human on that.

## 3. Halt-on-contradiction

**Trigger:** Any time you're about to build on — or forward downstream — a premise about the
codebase or the world (implementation time; or before handing an artifact to the next step).

**Discipline:** Verify the spec's factual premises against reality before building on them or
forwarding them, and when a premise is false, **stop and surface a bounded question** — don't
silently code around the contradiction. The test on every inherited premise: *"have I verified
this by my own observation, or am I inheriting it from prior testimony?"* Inherited-from-testimony
is not verification; run the command, open the file, check the state. Don't forward a premise you
haven't verified.

**Why it beats the default:** The model's default on a spec/reality mismatch is to plow ahead and
rationalize — absorb the conflict, produce something that compiles, and bury the contradiction.
That ships wrong work with a clean status. "Halt and ask a *bounded* question" — option A does X
(consequence Y), option B does Z (consequence W), which? — is the override.

**How to apply:** Grep and open before trusting any claim about existing code. When you hit a
genuine contradiction, write the two-option question and escalate it rather than picking silently.
A halt is a success, not a failure — it's the cheapest possible point to catch a wrong premise.

## 4. V/Q debugging

**Trigger:** Investigating any unexpected outcome — a failure, an incident, a discrepancy —
before drafting a specific hypothesis.

**Discipline:** Two stages, in order.

- **V (Variants):** enumerate hypothesis variants at the *architectural-layer* level first — which
  layer could be wrong (input data? wrapper? algorithm? calibration source? the layer above /
  below?). Write the list down before going deep on any one.
- **Q (Questions):** for the highest-prior variant, draft the **specific, empirical, time-bounded**
  question that would *falsify* it — answerable by running code or reading data in under an hour,
  not "is this correct?". The question, not the hypothesis, is the unit of work.

Track which variants a question ruled out; don't re-investigate a falsified variant from a new
angle. After ~3 falsified variants with no good remaining one, the bug is **outside your
enumerated layer set** — that's the trigger to re-enumerate, not to dig deeper on a weak variant.

**Why it beats the default:** The model's failure mode is hypothesis tunnel-vision — it falls in
love with the first plausible cause and deep-dives for a long time before considering an
alternative. This is sharper than the generic "debug systematically" a base model already does:
V-before-Q forces breadth before depth, and the re-enumeration trigger catches the case where the
real cause was never on the list.

**How to apply:** At investigation kickoff, write the V list before the first Q. One empirical
question can rule out several variants at once (bisection is the canonical case) — prefer those.

## 5. Honest measurement

**Trigger:** Emitting any measurement — a benchmark, a coverage figure, an acceptance-criterion
value — where the number materially diverges from what its name implies.

**Discipline:** A footnote does not fix a misleading headline. When a column or claim names a full
cost class but the value captures a fraction of it, **instrument the gap, don't document it** —
pick one:

- **A. Emit both** — rename the partial to be explicit (`handler_latency_ms`) and add the full
  measurement beside it, in the same row (`end_to_end_latency_ms`). *(Preferred.)*
- **B. Drop the partial** — emit only the complete measurement under its real name.
- **C. Rename to the truth** — when the full number is intractable, move the caveat into the
  identifier itself (`handler_latency_excl_queue_ms`), so the name can't be quoted misleadingly.

**Why it beats the default:** Headlines anchor; footnotes don't. The model (like any author)
defaults to the favorable framing and trusts the reader to find the caveat ten lines down — but
the column header is what gets quoted into the PR, the deck, the postmortem, and the caveat is
what gets dropped. A partial-with-caveat measurement is a violation *by construction*, however
well the caveat is written. The fix is structural, not literary.

**How to apply:** When you catch yourself writing "(note: this is actually only…)", stop and apply
A, B, or C instead. *(Illustrative: a column labeled `latency_ms` that times only in-handler work —
excluding queue wait — can under-report user-visible latency by an order of magnitude; the fix is a
parallel end-to-end column, resolution A.)*

---

## What used to be here

Anchor began as a five/six-role build-orchestration methodology distilled from one project
(DeploySignal). With a 1M-context model the orchestration largely inverted into overhead — see
[`design/adr/0001-pivot-to-verification-harness.md`](design/adr/0001-pivot-to-verification-harness.md).
Re-founding it as the behavioral half of a sprag-paired stack means most of the original pack is
gone, by the two sieves above:

- **→ sprag (now deterministic):** anti-scope ledger, anti-self-confirming tests, require-tests,
  no-rotting-tests, layering / dependency-direction, complexity / god-objects. Don't re-encode
  these as prose; they are gates now.
- **→ already a base-model default:** test-driven development, brainstorm-before-building, generic
  systematic debugging, "tests green before done." A strong model does these unprompted, so they
  ship **nowhere as a discipline** — that is the filter working. The handful that are *gate-coupled*
  (writing tests ↔ sprag's `require_tests`; authoring your invariants; running the gate before
  done) appear in sprag only as **gate-usage notes**, not as a competing behavioral pack.
- **→ retired (orchestration scaffolding):** the role framework, tier dial, wave / DAG / multi-
  cluster parallelism, the TPM/Coordinator roles, role-anchoring and session-ID mapping (only
  meaningful in manual multi-chat mode), round-numbering. A single dynamic session with subagents
  obviates them.
- **→ archived (project-specific scar tissue):** the P3 ten axes, Memorial D's four-factor prior,
  and the σ²/regime/firing-attribution vocabulary. Real disciplines, but born of one statistical-
  detector codebase; they won't fire elsewhere, and carrying them is what made the methodology
  unreadable to anyone outside it.

## Keep this list honest

Every discipline here is a bet that the model *won't* do this on its own — the same bet the
orchestrator lost. Disciplines 1 and 2 are safe bets: they fight incentives (sycophancy,
eagerness), not capability gaps, and incentives don't obviously improve with scale. Disciplines
3–5 are capability bets a stronger model may absorb.

So this list has a half-life, and the discipline that keeps it from rotting is a ritual: **on every
model upgrade, re-test each entry against the bare default.** If the model now does it unprompted,
retire the entry. A behavioral pack that never shrinks is on its way to becoming the overhead it
replaced.
