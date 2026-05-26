# Skill: Pre-Emit Grilling

**Trigger:** Any role about to forward an artifact to the next role in the pipeline.
**Application moment:** Before forwarding. After artifact draft is complete.
**Owner:** Each role applies to its own outputs.

## What it is

Adversarial review of an artifact BEFORE it is forwarded to the next role, separate from post-merge review. Run by the role that drafted the artifact, against the artifact they just drafted, immediately before they would otherwise hit "send."

This is methodologically distinct from post-merge code review. Code review catches issues after the implementer has built against potentially flawed inputs. Pre-emit grilling catches issues at the source, before any downstream effort is wasted.

## Why it works

Most coordination errors propagate. A spec gap forwarded to the implementer turns into wasted implementation effort. A routing error forwarded to the agent turns into wrong work shipped. Catching at the source is roughly 10× cheaper than catching downstream.

The key insight: **the role that drafted the artifact is in the worst position to objectively review it** (confirmation bias), AND **simultaneously in the best position to catch surface-level errors quickly** (full context). Pre-emit grilling exploits the second by structuring against the first.

## How to apply

Three buckets. Walk through the artifact and classify every concern:

**CRITICAL** — must be fixed before forwarding. Examples:
- Spec contains an undefined term that the implementer would need to guess
- Routing references a stale version, file path, or test count
- Architecture decision is contradicted by another committed decision the artifact didn't notice

**LIKELY-SURFACES** — pre-flag in the artifact as anticipated questions, so downstream isn't surprised. Examples:
- A spec assumption that depends on an unverified upstream state
- A routing decision that may need to change if a parallel investigation lands first
- An architecture choice with two reasonable interpretations; flag which one is intended

**PRE-EMPTABLE** — fold into the artifact as anti-scope, open-question, or correction. Examples:
- A scope drift you noticed while drafting; explicitly call it out as anti-scope
- A clarification you can write into the artifact rather than waiting to be asked
- A correction to a prior artifact you noticed mid-draft; fix at the same time

## What to grill against

For each artifact type, the grilling checklist differs slightly:

**Architect spec drafts:**
- Does every numerical threshold have a derivation?
- Are option-space alternatives enumerated?
- Has every cited file been opened (not summarized from memory)? **Now enforced structurally** — see § Existing-architectural-surface enforcement below.
- Has the compiled artifact been opened, not just source?
- Are anti-scope clauses explicit?
- For every OBSERVED-binding disposition: would a future FIX matching the architect prediction FAIL this test? If yes, the binding is self-confirming — redesign. **See § OBSERVED-binding scope check below.**
- For every factual claim about prior-round behavior inherited from a prior Reviewer / Architect / Memorial: has the relevant command/fixture been run, and is the OBSERVED output recorded inline? "Inherited from prior testimony" is not equivalent to "verified by own observation." **See § Inherited-testimony empirical verification below.**
- For any correction of a wrong factual claim in a multi-section document: have ALL semantic-paraphrase sites AND downstream citing sections been enumerated and updated? A literal-exact grep on the primary correction site returning 0 is NOT full-document consistency verification. **See § Correction-propagation pass below.**

**TPM routing pasteables:**
- All filenames LIVE-verified?
- All version labels CURRENT?
- All line numbers verified by opening the file?
- All test counts current?
- Is the routing structure (CRITICAL / LIKELY / PRE-EMPTABLE) populated?
- Have I cited the architect's decisions correctly (grep-verified)?

**Implementation diffs:**
- Does every spec claim get tested?
- Are skip-flags present on tests that should be required?
- Do the defensive patterns (null-checks, edge case handling) cover the new surface?
- **For each `expect(...)` assertion: would the test still pass if the production line(s) it claims to verify were deleted or no-op'd?** If yes, the test is self-confirming — fix before route. See [`13-anti-self-confirming-tests.md`](./13-anti-self-confirming-tests.md) for the unified mutation-check question that subsumes all 12+ known variants (sort-normalization, lenient-cardinality, null-fixture, domain-inline, etc.).

**Reviewer reports:**
- Is the audit findings format consistent (severity tier per finding)?
- Are recommendations bounded (specific files / line numbers)?
- Are deferred items explicitly tracked?

## Worked example

[From DeploySignal coordination/TPM-GRILL-Q58-STEP-4-ROUTING.md, 2026-04-30]

TPM had drafted a routing artifact (`TPM-REPLY-Q58-STEP-4-RESUME.md`) ready to forward to the implementer. Before forwarding, applied pre-emit grilling discipline (newly memorialized; first application).

Result: 1 CRITICAL + 4 LIKELY-SURFACES + 4 PRE-EMPTABLE issues identified.

The CRITICAL was a gap in the architect spec around `parametricAr1Window` semantics that would have caused the implementer to guess at the intended interpretation, with downstream cost of 1-2 days of rework. Pre-emit grilling caught it; routing was held back; architect amendment requested; rework prevented.

## Common pitfalls

- **Skipping when "the artifact is obviously fine."** The whole point is to catch what looks fine but isn't. If you find yourself wanting to skip, that's a signal to grill harder.
- **Treating the grilling as performative.** If your grilling never produces CRITICALs or LIKELY-SURFACES, you're not actually grilling. Recalibrate.
- **Grilling someone else's artifact instead of your own.** This skill is specifically about self-grilling. Cross-role grilling is a different discipline (Reviewer at T3).

## Cost

Approximately 10-20% additional time per artifact emit. Heavily front-loaded — first few applications take longer as you build the grilling-checklist intuition. Recovers cost within the first few catches.

## Existing-architectural-surface enforcement (added 2026-05-16 post-MD-F6 second-occurrence)

The file-opened checklist item ("Has every cited file been opened?") is **declaratively easy to violate**: an architect can mentally tick it without actually opening the file. The discipline-application-gap pattern was observed twice within hours in May 2026 (the originating MD-F6 case in `case-studies/` — both violations citing inherited types/enums from memory; both caught by Reviewer cold-context audit; neither caught by architect's own pre-emit grilling).

**Structural fix:** [`templates/Q-NN-SPEC-TEMPLATE.md`](../templates/Q-NN-SPEC-TEMPLATE.md) now includes a mandatory `## Existing architectural surface (REVIEWER-ANCHOR)` section with a citation table requiring file path + pinned SHA + line range + verbatim snippet + date+time opened. Empty rows / placeholders / paraphrased snippets = automatic FAIL on Reviewer audit.

**Mechanical verification:** [`integrations/superpowers-claude-code/scripts/verify-citations.sh`](../integrations/superpowers-claude-code/scripts/verify-citations.sh) parses the citation table, resolves each row against the cited SHA, and prints the actual file content at the cited lines for side-by-side comparison against the snippet column. Architect runs at pre-emit; Reviewer runs at audit.

The combined template-section + script is the executable form of the file-opened discipline. The skill's checklist item still asks the question; the structural-and-mechanical enforcement makes "yes" verifiable rather than self-attested.

## OBSERVED-binding scope check (added 2026-05-17 from Tessera R07 MAJOR-2)

OBSERVED-binding is a spec disposition where a test asserts the OBSERVED output count from a current implementation run, rather than a theory-derived bound. The pattern was designed for narrow PRNG-drift cases (e.g., "test fires at window 21; architect predicted 20; ±1 PRNG drift; bind OBSERVED=21").

**Failure mode:** OBSERVED-binding silently extends from PRNG-drift-class to structural-algorithmic-gap-class. If the architect predicted 20-30 fires and OBSERVED is 0, applying OBSERVED-binding produces a test that asserts `firedCount === 0` — which makes a future FIX restoring power FAIL the test, and a regression preserving 0 PASS it. The test is structurally self-confirming.

**Trigger question:** For every OBSERVED-binding disposition the spec authorizes, ask: **"would a future implementation FIX matching the architect's prediction FAIL this test?"** If yes, the binding is self-confirming. Redesign:
- Use theory-derived bounds where possible (e.g., `firedCount >= 25` from Ville-bound power calculation).
- If the deviation IS PRNG-drift-class (small ±N), OBSERVED-binding is correct and the trigger question answers "no, future FIX would still satisfy because the prediction matches OBSERVED within ±N."
- If the deviation is order-of-magnitude (predicted 20-30, OBSERVED 0): NOT PRNG-drift; structural-algorithmic-gap; OBSERVED-binding is wrong; redesign the test against theory-derived bounds OR scope-narrow the spec's behavioral claim to match what the algorithm actually does.

**Origin:** Tessera R07 MAJOR-2 (sequential e-process FCP-1 detector; AC-12/13 bound OBSERVED=0 firings when architect predicted 20-30). Reviewer's right-reasons audit caught it. R08 redesigned the ACs as FPR-under-perturbation tests (Type-I error checks) + added new sustained-injection ACs with theory-derived bounds. Memorial reinforcement landed in `CLAUDE-ARCHITECT.md`.

## Inherited-testimony empirical verification (added 2026-05-17 from Tessera R08 MAJOR-2)

Multi-round projects accumulate factual claims about prior-round behavior across spec / Reviewer report / Memorial / NEXT-ROLE artifacts. The temptation: an architect drafting round N+M cites a factual claim from round N's Reviewer or Architect ("MCD on the clean fixture produces zero contamination flags") as if it were independently verified.

**Failure mode:** the inherited claim was wrong. The architect's spec then prescribes downstream consequences (e.g., "tighten the test to `=== exactLength`") that fail empirically at implementation time. The Implementer's hands are tied — a spec premise is empirically false — and either silently absorbs the conflict or HALTs with a DIAGNOSTIC, depending on discipline. Either way, the round's quality is compromised at spec emit.

**Trigger question:** For every factual claim about prior-round behavior that the spec cites or builds upon, ask: **"has this been verified by my own observation, or inherited from prior testimony?"** Inherited-from-prior-testimony is NOT verification. Run the relevant command/fixture against current production code and record the OBSERVED output inline in the spec (or in the audit sidecar's § P3.3 file-opened acknowledgment). Document the specific command run + the observed output + the date.

**Worked rule:** "MCD flags zero contamination ticks on the clean fixture" — was this verified by running the AC-15 fixture against current `tools/curate-baseline-pre-pass.ts` at HEAD `<sha>`, output `n_ticks_contaminated=6`? If not, the claim is testimony, not verification. Verify first.

**Origin:** Tessera R08 MAJOR-2 (Architect inherited the zero-flags claim from R07 Reviewer's MINOR-3 testimony without running the fixture; R08 spec premise wrong; downstream test prescription failed empirically). R09 cleanup round closed the surface gap; the reinforcement landed in `CLAUDE-ARCHITECT.md`. Discipline subsequently caught a different error in production use (operator's mistaken claim about merged PRs verified against `gh api`, surfacing the discrepancy before downstream actions corrupted).

## Correction-propagation pass (added 2026-05-17 from Tessera R09 MAJOR-1)

When a spec or doc contains a wrong factual claim that has propagated to multiple sites (semantic paraphrases, downstream citations, cross-reference tables), correcting only the primary site leaves the wrong claim visible at every other site. A literal-exact grep on the original wrong phrase returning 0 matches is NOT full-document consistency verification — the wrong claim may persist via semantic paraphrase.

**Failure mode:** the architect (or implementer in self-spec) corrects the primary site, runs a literal-exact grep to confirm the wrong phrase is gone, and routes. Downstream Reviewer or future-round Architect encounters the wrong claim at a sibling section, treats it as authoritative, and propagates the error further.

**Trigger question:** After correcting a wrong factual claim in any multi-section document, ask: **"have I enumerated ALL semantic-paraphrase sites and downstream citing sections, not just the literal-grep matches?"** Specifically:
- **Semantic paraphrases:** the same claim restated in different words (e.g., "produces zero flags" vs "drops anything" vs "neither Stage X nor Stage Y modifies the output").
- **Downstream citations:** cross-section tables, summary statements, AC text, in-section JSDoc, integration-point prose — anywhere the corrected primary claim is restated or its consequence is asserted.
- **Aggregate counts:** "all N checks PASS" statements that were true pre-correction may be wrong post-correction.

**Verification beyond literal grep:** read each candidate section's prose; ask "does this sentence rely on the wrong claim being true?" If yes, update.

**Origin:** Tessera R09 MAJOR-1 (Implementer corrected primary site at `Q-R08-SPEC.md` § Mechanism primitive 11 but missed 4 sibling surfaces — preamble bullet, cross-section table row, "All 18 checks PASS" annotation, Delta 11 final sentence, AC text). Reviewer's right-reasons audit caught it. R09 followup direct-fix closed all 5 sites. Memorial reinforcement landed in `CLAUDE-IMPLEMENTER.md`.

## Memorial-accretion connection

Patterns of issues caught by pre-emit grilling become candidates for memorialization (see [`02-memorial-accretion.md`](./02-memorial-accretion.md)). When a CRITICAL pattern repeats across multiple artifacts, the discipline that would have prevented it becomes a new pre-route checklist item.

When memorialization alone proves insufficient — as with MD-F6 (two same-session violations after memorial creation) — escalate to **template-section enforcement + script verification** rather than another memorial entry. The discipline-archive significance is that declarative memorialization caps at the architect's attention budget; structural artifact requirements + mechanical script checks have no attention dependency.
