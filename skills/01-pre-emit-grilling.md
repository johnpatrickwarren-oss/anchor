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

## Memorial-accretion connection

Patterns of issues caught by pre-emit grilling become candidates for memorialization (see [`02-memorial-accretion.md`](./02-memorial-accretion.md)). When a CRITICAL pattern repeats across multiple artifacts, the discipline that would have prevented it becomes a new pre-route checklist item.

When memorialization alone proves insufficient — as with MD-F6 (two same-session violations after memorial creation) — escalate to **template-section enforcement + script verification** rather than another memorial entry. The discipline-archive significance is that declarative memorialization caps at the architect's attention budget; structural artifact requirements + mechanical script checks have no attention dependency.
