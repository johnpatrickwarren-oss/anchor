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
[What used to be here](#what-used-to-be-here). What survives is six disciplines, two of them
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
What's load-bearing is the *independence*, not the reviewer's skill: a better model reviews better
but also rationalizes its own work more confidently in-context, so the same-context sycophancy this
fights doesn't fade with scale — the discipline survives no matter how good reviewers get.

**How to apply:** The mechanics are the harness's — spawn a subagent (or open a clean session) that
receives only the spec and the diff, not your reasoning or your summary of why it's right. The
*discipline* is what the harness can't supply: **deciding to do it at all** (a single session won't
— it self-assesses and calls the work good) plus the adversarial judgment. Prompt the reviewer
adversarially: *"You are auditing this change. Find the ways it fails the spec or breaks existing
behavior. Cite file:line. A clean review is a few lines; do not narrate."* Then address every finding
by severity — don't dismiss. When the change includes a *correction* to a prior claim, have the
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
the reviewer's checklist.

When the operator isn't a developer, don't make them write the contract — elicit it with questions
and use their answers as the spec. Two things earn their place over a generic PRD template: **lead
with must-never** (the field test found "what must this never do?" is both the highest-value answer
and the one a non-expert gives best — ask it first, not last), and give each answer a **quality bar**
(a success example concrete enough to become a test; a must-never that's a real prohibition). The
*countable* half of a bar (≥2 examples, ≥1 prohibition) is sprag's existence-check; the quality
judgment is yours. For eliciting behavioral *properties* of a single function — invariants that feed
sprag's `arch property` — use the unit-property interview in
[`PRD-INTERVIEW.md`](PRD-INTERVIEW.md), drafted impl-blind.

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

**Why it beats the default:** *Re-scoped 2026-08-04 after the first recorded half-life run (ADR
0003; `knowledge/methodology/half-life-ritual-2026-08-04`).* The bare default now **verifies the
premise, notices the mismatch, and discloses it precisely — but only after acting on its own
reconciliation**. An earlier revision of this entry said the default "buries the contradiction";
that clause is measured false and is retired. What the default still does not do is **halt before
building on the false premise**: it edits first and flags after, which ships a judgment call —
whose spec-vs-reality resolution to implement — as a fait accompli. "Halt and ask a *bounded*
question" — option A does X (consequence Y), option B does Z (consequence W), which? — is the
surviving override, and it is an incentive bet (who decides), not a capability bet (can it
notice), so a stronger model does not absorb it.

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
well the caveat is written. The fix is structural, not literary. (And it stays a *discipline*, not a
sprag gate: the A/B/C rename is mechanical, but judging whether a name materially *misleads* — the
name versus what the code actually computes — is a semantic call a deterministic check can't make.)

**How to apply:** When you catch yourself writing "(note: this is actually only…)", stop and apply
A, B, or C instead. *(Illustrative: a column labeled `latency_ms` that times only in-handler work —
excluding queue wait — can under-report user-visible latency by an order of magnitude; the fix is a
parallel end-to-end column, resolution A.)*

## 6. Durable project trail

**Trigger:** Any project meant to outlive a single working session — i.e. almost any real one. (A
one-session throwaway can skip it.)

**Discipline:** Leave a record a cold reader can resume from, split by *tense*:

- **Overwrite the "now."** One short `STATE.md` — what's done, what's in flight, what's next, open
  questions. Replace it at each session's close; it's a snapshot, never a history.
- **Append the "forever."** One small ADR per real decision — the choice *and why, including why
  not the alternatives* — in `design/adr/`. Superseded by a new ADR, never edited in place. It grows
  at the rate of *decisions*, not time, so it never bloats from routine work.
- Write both for someone who wasn't there, and keep a ruled-out / gotchas line in the relevant ADR
  so the next operator doesn't re-walk a dead end (the durable half of [V/Q](#4-vq-debugging)).

**Why it beats the default:** a single session is **amnesiac across sessions** — it builds, and the
reasoning evaporates when the context closes. A model has no persistence motive; it will not leave a
resumable trail unless told to. "The trail is the source of truth, not the chat" is the override —
and it's an incentive bet, not a capability one, so a stronger model doesn't absorb it.

**How to apply:** two files, committed, read on demand — see
[`templates/project-trail/`](templates/project-trail/). Update `STATE.md` at session close; write an
ADR the moment you make an architectural choice. Deterministic backstop: more is mechanical than it
looks — sprag can gate that a `STATE.md` was *touched this session*, that an ADR *accompanies* an
architectural change, and that an accepted ADR *wasn't edited in place* (append-only), the way
`require_tests` gates test presence. What no gate can check is what this discipline owns: whether the
trail is **accurate and legible to a cold reader** — touched ≠ current, existing ≠ resumable.

**Watch for:** one failure mode on each side. **Don't inject the trail into every prompt** — read it
on demand; per-prompt injection is the old memorial's bloat sin. And **don't overwrite the
"forever"** — git technically keeps an overwritten decision, but git archaeology is forensics, not
handoff; a decision a new operator can't *find* is a decision lost. A stale `STATE.md` is worse than
none — so update-on-close.

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
  obviates them. (The old **audit-trail** file discipline's *durable-record* value is **not**
  retired — it returns, git-native, as [Discipline 6](#6-durable-project-trail); only its 250-file
  coordination-tree mechanism is gone.)
- **→ archived (project-specific scar tissue):** the P3 ten axes, Memorial D's four-factor prior,
  and the σ²/regime/firing-attribution vocabulary. Real disciplines, but born of one statistical-
  detector codebase; they won't fire elsewhere, and carrying them is what made the methodology
  unreadable to anyone outside it.

## Keep this list honest

Every discipline here is a bet that the model *won't* do this on its own — the same bet the
orchestrator lost. Disciplines 1, 2, and 5 are safe bets — as is the decision-log half of 6: they fight incentives
(sycophancy, eagerness, favorable framing, a session's amnesia), not capability gaps, and incentives
don't obviously improve with scale. Disciplines 3 and 4 are capability bets a stronger model may
absorb — as is the `STATE.md`-snapshot half of 6, which an agent harness with persistent memory
might one day maintain on its own.

So this list has a half-life, and the discipline that keeps it from rotting is a ritual: **on every
model upgrade, re-test each entry against the bare default.** If the model now does it unprompted,
retire the entry. A behavioral pack that never shrinks is on its way to becoming the overhead it
replaced.
