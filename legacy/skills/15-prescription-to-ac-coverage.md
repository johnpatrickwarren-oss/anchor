# Skill: Prescription-to-AC Coverage

**Trigger:** Any spec being authored, reviewed, or routed where the spec contains §3.x (mechanism) or §4.x (component inventory) prescriptions and §5 acceptance criteria. Applies at three checkpoints: spec-author grilling (G4 / G7), Implementer pre-emit if T0/T1 self-spec, Reviewer right-reasons audit.
**Application moment:** After §3/§4 is written and before any AC is finalized. Re-run after every spec revision that adds prescriptions.
**Owner:** Whoever authored the spec §3/§4 and §5; whoever reviewed it cold.

## What it is

A meta-discipline that catches the entire class of "prescription-without-AC-binding" defects — cases where the spec's mechanism description (§3) or component inventory (§4) prescribes a behavior, mechanism, field, file, or emission that no AC's "Then" clause requires a test to verify. The unbound prescription is invisible to the test suite: production code can omit it, change it, or break it without any test failing.

The class also covers partial-coverage mappings, where an AC binds *some* of a prescription's behaviors but not others. Coverage illusions form when G4-style "prescription → AC" mappings are filled in without verifying that every named behavior of the mapped item is actually bound.

## Why this is its own skill

Reinforcement accumulation in real projects (archfolio R43–R57) produced six distinct variant patterns of the same underlying defect class before consolidation:

1. **Original — emission prescribed but no AC test verifies it** (R43). Spec §3.3 says "action emits `PRICE_LIST_ITEM_UPDATED` with before/after snapshots"; AC-R43-03 exercises the action for `lastUpdatedAt` only. The audit emission has zero test coverage. Mutating the production emission to `() => undefined` passes all tests.
2. **§4.x field + orderBy enumeration** (R47, T0 self-spec). §4.x prescribes "list with clientName + daysSinceSent badge" + "orderBy createdAt asc". AC binds the heading but not the data fields; no multi-row sort test verifies orderBy. Removing daysSinceSent rendering OR reversing the sort both pass.
3. **Mechanism prescription** (R49). Spec §3 prescribes "Google Fonts `<link>` tags" as the font-loading mechanism. G7 binds 6 functional outcomes (text renders, font weight, etc.) but no AC binds the mechanism itself. Tactical deviation replacing `<link>` with `next/font/google` is undetectable.
4. **Audit-event payload field enumeration** (R50). Spec prescribes audit-event payload `{actor:{type,id,label}, entityType, entityId, rootEntityType, rootEntityId, before, after}`. AC asserts only `events.length === 1`. Mutating any payload field in production passes the cardinality assertion.
5. **Universal-quantifier enumeration** (R51). Spec §1 Goal: "Both send paths gated on email-send success". AC-R51-06 binds only the quote side; contract-side failure gating unbound. The quantifier word "Both" was a direct signal — 2 required ACs, not 1.
6. **G4 mapping binds only one named behavior of an action** (R57). G4 says `sendChangeOrder → AC-R57-03 (running-total)`. The action also emits `CHANGE_ORDER_SENT`. AC binds only the running-total arithmetic; audit emission unbound. Partial-coverage G4 mapping = coverage illusion.
7. **G4 enumerates only domain functions, not 'Created' files** (R57). §2 component inventory lists `/change-order/[token]` (page.tsx + SignatureBlock.tsx + actions.ts). G4 lists 10 domain items but zero client-facing route entries. 412 LOC ship with no AC binding.

Each variant was its own reinforcement entry in CLAUDE.md. The methodology was playing whack-a-mole on prescription dimensions (emissions, fields, mechanisms, payloads, quantifiers, action behaviors, files) rather than catching the underlying class.

This skill names the class and provides one question that subsumes all variants:

> **"For each prescription in §3.x and §4.x — every emission, constraint, behavioral rule, technical mechanism, payload field, universal-quantifier element, data field, orderBy clause, action behavior, AND every 'Created' file in §2 inventory — identify the AC 'Then' clause that binds it. If no AC binds the prescription, OR the AC fails to fail when the prescription is mutated, the prescription is uncovered."**

If any prescription is uncovered → either add an AC binding, or move the prescription to §6 Anti-scope with rationale.

## Why it works

A spec is the contract between three roles: it tells the Implementer what to build, the Reviewer what to verify, and the Memorial Updater what was decided. When the spec's §3/§4 prescribes behavior X but §5 has no AC for X, the contract is broken in two directions:

- The Implementer may build X — but a future refactor that removes X passes all tests, so the spec's commitment to X is unverifiable.
- The Implementer may NOT build X — production ships incomplete and no test fails.

Either way, the spec is unfalsifiable on dimension X. The mechanical enumeration check makes coverage gaps visible at spec time, before the Implementer reads the spec cold.

## How to apply

For each spec, complete this enumeration table before routing to Implementer (or before declaring §8 grilling complete in T0 mode):

| Source | Prescription | AC binding (cite AC-ID) | Mutation check passes? (Y/N) |
|---|---|---|---|

### What sources to enumerate

Every prescription in any of these spec sections is a candidate for binding:

- **§3.x Mechanism** — every named behavior, emission, constraint, technical mechanism, library choice, API structure, CSS architecture, payload shape.
- **§4.x Component inventory: Created / Changed / Deleted** — every entry. For 'Created', the binding must cover the component's behavior; for 'Changed', the diff's net new behavior; for 'Deleted', that removal is verified.
- **§1 Goal universal quantifiers** — "Both X and Y", "All three of A, B, C", "Each of N". Quantifier words are direct enumeration signals.
- **PRD AC field lists** — see Skill 14 (PRD-conjunction-cross-check).

### Five high-signal red flags

These are syntactic patterns that strongly correlate with prescription-without-binding. They don't replace the enumeration table but catch most cases mechanically:

1. **G4 / coverage table cell maps an action to a single AC, and the action has multiple named behaviors in §3.** Look at the action's §3 description: emissions, return shape, side effects, audit events. Each named behavior needs its own AC binding. Partial mapping = uncovered behaviors.
2. **AC asserts only `.length` / cardinality** on an emission or write. Field-level mutations pass cardinality assertions. Require field-level binding for each payload field named in the prescription.
3. **§4 'Created' list contains a page, route, or client-facing component, and G4 lists no entry for it.** Pages and routes need AC binding for display content + user actions, not just for the domain functions they call.
4. **§1 Goal contains "Both", "All", "Each", "every"** — count the elements of the named set; verify each element has its own AC. "Both send paths" = 2 required ACs, not 1.
5. **Spec prescribes a technical mechanism (font-loading approach, library method, API call structure, schema migration sequence) and the AC asserts only the user-visible outcome.** The mechanism prescription is a separate testable claim from the outcome. Either bind the mechanism with its own AC, or document that the mechanism is implementation choice (in which case the prescription is misplaced — should be in §6 anti-scope-for-implementer or removed entirely).

## Mutation check — companion to enumeration

After identifying that AC-Y binds prescription P, validate the binding by asking: **"If P were deleted or replaced with a no-op in production, would the test for AC-Y fail?"**

If NO → the AC's name claims to bind P but the assertion doesn't actually depend on P's behavior. This is the cross-section with Skill 13 (Anti-Self-Confirming Tests): a prescription has a nominal AC binding but the test is self-confirming relative to that prescription.

If YES → the binding is real. Move on.

## Anti-pattern to avoid

A spec's grilling section that reads "all prescriptions cross-checked against ACs — full coverage confirmed" without a per-prescription enumeration table is structurally incapable of catching this class. The table is mandatory because prose-level "all prescriptions" is undefined: prescriptions in §3.1 paragraph 4 sentence 3 are easy to miss when re-reading at prose speed.

## When this skill fires

- **Architect, writing §3/§4 then §5:** every prescription in §3/§4 must appear in the enumeration table before §5 is considered complete.
- **T0/T1 self-spec author (Implementer):** same, with the same extra rigor noted in Skill 14 — the author is also the implementer and may unconsciously prescribe what they plan to build without binding it to a verifiable AC.
- **Reviewer, cold-read:** the right-reasons audit (CLAUDE.md REVIEWER §3) tests assertion-to-spec-requirement traceability; the inverse — spec-prescription-to-AC traceability — is this skill. Both should fire on every Reviewer pass.
- **Memorial Updater:** when a Reviewer finds an unbound prescription, append `VIOLATION: prescription-to-AC-coverage | [what was unbound] | RNN | [role-that-failed-to-bind]`. Project-local CLAUDE.md gets a variant-specific reinforcement only if the variant has appeared 3+ times and warrants its own pattern note; the canonical skill stays the umbrella.

## Companion skills

- **Skill 01 — Pre-emit Grilling.** Prescription-to-AC coverage is one row (or several) of the pre-emit grilling table; full pre-emit also covers other dimensions.
- **Skill 13 — Anti-Self-Confirming Tests.** Two-step validation: (1) this skill asks "is there an AC binding?"; (2) skill 13 asks "does the AC's test actually depend on the prescribed production behavior?". Both must pass.
- **Skill 14 — PRD-Conjunction Cross-Check.** Skill 14 covers PRD → AC fidelity (no narrowing without disclosure). This skill covers spec § → AC fidelity (no prescription without binding). Together: PRD → spec § → AC traceability with no silent gaps at either hop.
- **Skill 06 — Anti-Scope Ledger.** Prescriptions intentionally left unbound must land in §6 anti-scope with rationale, same as PRD narrowings in Skill 14.
