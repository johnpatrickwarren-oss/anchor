# Skill: Anti-Self-Confirming Tests

**Trigger:** Any test being authored, reviewed, or routed. Applies at three checkpoints: spec-author grilling, Implementer pre-emit, Reviewer cold-read.
**Application moment:** Every test assertion, every time. Not a one-time pass — repeated per assertion per round.
**Owner:** Whoever authored the test (Implementer); whoever read it cold (Reviewer); whoever specified what it should assert (Architect / T1-self-spec author).

## What it is

A meta-discipline that catches the entire class of "self-confirming tests" — tests whose assertions pass while the production code they claim to verify is broken, absent, or doing the wrong thing. This is mutation testing operationalized as a pre-route check: for every assertion, ask whether deleting the production line would still leave the test green.

## Why this is its own skill

The reinforcement library accumulated 12 specific occurrences of self-confirming-test patterns across rounds R09–R45 before this skill landed (R09 domain-inline; R10 transaction-entry-point; R12-fix3 planned-assertion-never-written; R14 sort-normalization; R15 read-path-inline; R16 shell-PASS-regardless; R21 count-only; R22 null-fixture; R24 toMatchObject narrowing; R35 audit-event lenient cardinality; R40 audit-after-payload-unasserted; R45 same as R40 again).

Each existing reinforcement names a specific variant pattern. The catalog grew with every new variant. The methodology was playing whack-a-mole on syntax (`.sort()`, `toMatchObject`, `>=1`, `null` fixture, `db.$transaction` mocked at entry, etc.) rather than catching the underlying class.

This skill names the class and provides one question that subsumes all variants — past and future:

> **"For each assertion in this test, identify the production line(s) whose behavior the assertion is meant to verify. If those line(s) were deleted or replaced with a no-op, would this test still pass?"**

If YES → the test is self-confirming. The assertion is decoupled from the production behavior it claims to verify. Fix before route.

## Why it works

A passing test is supposed to be evidence that production code does the right thing. A self-confirming test is GREEN whether or not production is correct, so it's not evidence of anything. The mutation-question makes this falsifiability test mechanical:

- If deleting production code keeps the test green → the test wasn't testing the production code; it was testing something else (its own setup, its own fixture, its own normalization step).
- If deleting production code turns the test red → the test is genuinely coupled to the behavior it claims to verify.

This is the inverse of the Test-Driven Development "RED first" discipline: TDD requires the test to be RED before production exists. The self-confirming check requires the test to be RED if production is removed. Both ground the test in production behavior.

## How to apply

For each test under review (spec pseudocode, written test, or test cited in an AC), walk through every `expect(...)` / assertion line and answer:

1. **What production line(s) are this assertion's subject?** Be specific. Cite file:line.
2. **What three mutations would I make to test those line(s)?** Typical mutations:
   - Delete the production function/block entirely (`return` early or comment out)
   - Make it return null/undefined/empty
   - Make it return the wrong value (input instead of output; -1 instead of count; etc.)
3. **For each mutation, does the test still pass?** Walk through what the test would observe. If the test would observe the same input/output relationship for any of the mutations, the assertion isn't anchored to that production line.

A test that passes all three mutation checks is genuinely coupled. A test that fails any of them is self-confirming on that dimension.

### Five high-signal red flags

These are syntactic patterns that strongly correlate with self-confirming. They don't replace the mutation question but catch most cases mechanically:

1. **The test re-runs the production logic inline** before asserting. (R09 domain-inline; R15 read-path-inline.) If the test imports the SAME helper / domain function the production code uses, then asserts on the helper's output, deleting the production-code call doesn't change the test's result.
2. **The test sorts, filters, or normalizes the production output** before asserting on it. (R14 sort-normalization.) Any production-code change to the ordering / shape is invisible after the normalization.
3. **Cardinality assertion is weaker than the AC.** AC says "emits exactly one event" → test uses `>=1`. AC says "11 fields" → test uses `toMatchObject({2 keys})`. (R35 lenient-cardinality; R24 assertion-method narrowing.)
4. **Fixture data doesn't exercise the asserted field.** Test asserts `result.note === source.note` while every fixture row has `note: null`. (R22 null-fixture.)
5. **The test is structurally decoupled from the production trigger.** Mocking `db.$transaction` to throw before any write means no production code inside the transaction ran. (R10 transaction-entry-point.)

For each red flag, the operational fix follows from the mutation question.

## Worked example

[From archfolio R45 REVIEWER-REPORT-R45.md MAJOR-1, 2026-05-14]

R45 spec AC-R45-02 prescribed an audit event emission for `updateContractClauseAction`. The test at `tests/integration/admin.contracts.clause.test.ts:151-160` asserts:

```typescript
expect(events).toHaveLength(1)
expect(events[0].entityId).toBe(contract.id)
expect(events[0].firmId).toBe(firm.id)
expect(events[0].meta.clauseKey).toBe("parties")
```

Mutation check: the production at `src/app/admin/_actions/contracts.ts:108-109` writes:

```typescript
appendAuditEvent({
  ..., entityId, firmId, meta: { clauseKey },
  before: null, after: { clauseKey, customText: result.customization.customText },
  entityType, rootEntityType, rootEntityId
})
```

The test reads `entityId`, `firmId`, `meta.clauseKey` — verified. But the test never reads `events[0].after`, `entityType`, `rootEntityType`, `rootEntityId`, or `before`.

What if the production code wrote `after: { wrong: "data" }`? Test still green. What if production omitted `entityType`? Test still green. What if `before` were silently set to `{leaked: "info"}`? Test still green.

The Reviewer's diagnosis matches the mutation finding: production's `after` payload is unasserted; future regression invisible. Fix: add `expect(events[0].after).toEqual({ clauseKey: "parties", customText: "..." })` and assertions for the omitted fields.

This is the 12th project occurrence of this class. The previous 11 had been memorialized as individual reinforcements. The mutation question is the unification.

## Where this check fires in the pipeline

Three checkpoints, escalating in cost-to-fix:

1. **Architect / T1-self-spec author** writing spec pseudocode. For each `expect(...)` in pseudocode, the author runs the mutation check mentally and inlines the answer as an §8 grilling row: "AC-RNN-Y assertion: production line X writes Z; if X returned wrong-Z, test would fail (NOT self-confirming)." Catching here costs ~30 seconds per assertion.
2. **Implementer pre-emit grilling** before STATUS: READY. The Implementer walks every test they wrote against the mutation question, separately from the spec author's claim. Catching here costs ~1 minute per test.
3. **Reviewer cold-read** as part of the existing audit. The Reviewer applies the mutation check as a primary tool, alongside the per-AC verification table. Catching here is at MAJOR cost — the test ships needing rework; round is MERGE-READY but a fix-cycle is queued.

The methodology's existing checkpoints (spec grilling, pre-emit, Reviewer) all already exist; this skill adds a specific question they each ask. No new artifact, no new role, no new commit hook — just a sharper question at each existing gate.

## Common pitfalls

- **Treating the mutation check as a "would this still compile" check.** Compilation isn't the question. The question is whether the test's `expect(...)` evaluations would change with the mutation. A test can compile fine and still be self-confirming.
- **Skipping when "the assertion is obvious."** The most common self-confirming variants — sort-normalization, count-only, null-fixture — all look obvious. The mutation question forces you to slow down and trace the data flow.
- **Concluding "well technically the assertion does verify SOMETHING."** Trivially true. The question isn't "does this assertion test something," it's "does it test the production line the AC claims it does." Self-confirming tests verify something — they verify their own setup, fixture, or normalization step.
- **Applying only to write paths.** The R15 reinforcement (read-path-inline) was added specifically because the discipline had only been internalized for writes. Reads, transitions, no-emission claims, exit-code claims — all have self-confirming variants. Apply universally.

## Cost

Per test:
- Spec author: ~30 seconds to write the mutation-check answer inline in §8 grilling.
- Implementer: ~1 minute per test during pre-emit grilling.
- Reviewer: integrated into existing per-AC walk; no marginal time.

Recovers within the first prevented MAJOR finding. ArchFolio's history shows 12 of these MAJORs landed before this skill. At ~30-45 min per fix-cycle round to address a MAJOR, the skill recovers its own cost on the first prevention.

## Compatibility

- **Replaces the need for** individual reinforcements naming each new variant. Existing variant-specific reinforcements stay in CLAUDE.md as worked examples; new variants no longer need their own reinforcement line because they're all instances of this class.
- **Augments [`01-pre-emit-grilling.md`](./01-pre-emit-grilling.md)** "Implementation diffs" bucket — adds the mutation question as a specific item.
- **Augments [`08-architect-six-practices.md`](./08-architect-six-practices.md)** P3 ten-axis verification — adds mutation-resilience to the "correctness" axis.
- **Compatible with mutation-testing tools** (Stryker, mutmut, pitest). The skill is the discipline; a tool is the future automation. Tool integration is out of scope for this skill but a natural follow-up.

## Origin

Twelve consecutive occurrences across R09–R45 (May 2026), accumulated as variant-specific reinforcements in the project-local CLAUDE.md files. The R45 reviewer report explicitly flagged "12th project occurrence of self-confirming pattern" — the meta-finding promoted from project-local discipline to canonical methodology in this skill.

The methodology lesson: when a class of failure produces N variant-specific reinforcements without N declining over time, the class needs its own skill, not its (N+1)th reinforcement. Reinforcement library growth is a signal; here it crossed the threshold.
