# Topic [N] — [Spec Title]

_From: Architect. To: Implementer (TBD which session if multiple parallel). Routed via: TPM._
_Date: [YYYY-MM-DD]._
_Foundation: [Upstream PRD-NN] + [TPM-REPLY-NN routing] + [prior dispositions / spec cycles] + [memorial cross-references]._
_Type: full implementation brief._
_Sequencing: [Phase / sub-track ordering relative to in-flight work]._

---

## Spec

[Architectural objective in 1-3 paragraphs. What are we building, why, and what acceptance does it close. Trace each design decision to a specific PRD acceptance criterion (AC-N from `coordination/PRD-NN.md`).]

## Architectural mechanism

[High-level approach: algorithm + data structures + integration points. Avoid implementation detail; that goes in § Implementation surface below.]

---

## Existing architectural surface (REVIEWER-ANCHOR — mandatory)

_Required at every spec-emit. Closes the file-opened-discipline gap (P3.3) by structural enforcement rather than declarative reminder. See [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md) § Existing-architectural-surface enforcement for the discipline rationale._

For every inherited type, enum value, function, constant, line number, or
behavior this spec references in § Architectural mechanism or § Implementation
surface, enumerate explicitly:

| Inherited file | Pinned SHA | Lines opened | Verbatim snippet | Date+time opened |
|---|---|---|---|---|
| `<repo>/<path>` | `<7-char SHA>` | `<line range, e.g. 95 or 403-421>` | `<exact text from the file at those lines>` | `YYYY-MM-DD HH:MM` |

Every citation in this spec MUST appear in this table. Empty rows, placeholders
("TBD", `<...>`), or paraphrased snippets = automatic FAIL on Reviewer audit.

**Architect self-attest checklist (tick at emit time):**

- [ ] I opened every file in this table at brief-drafting time
      (NOT recalled from memory).
- [ ] Each snippet is verbatim from the file at the pinned SHA
      (not paraphrased; not stripped of formatting).
- [ ] Each line number was verified against the actual file content
      at the pinned SHA, not against a remembered prior version.
- [ ] I ran `integrations/superpowers-claude-code/scripts/verify-citations.sh`
      against this spec; output shows no FAIL rows.

**Why this section is mandatory:** the inherited-architecture file-opened
discipline (P3.3) accumulated TWO same-session violations in May 2026
([`case-studies/deploysignal-coordination-trail.md`](../case-studies/deploysignal-coordination-trail.md)
references MD-F6 sub-variant). Memorializing the discipline did not prevent
recurrence; the declarative checklist item ("Has every cited file been
opened?") was mentally tick-able without actually opening. This section
converts the discipline from declarative → structural: either the table
is present with concrete grep-evidenced citations, or the spec is
incomplete. The script `verify-citations.sh` provides mechanical
verification that cited line ranges resolve at the pinned SHA.

If this spec doesn't cite ANY inherited primitives (rare; usually for
greenfield projects with no shared-engine vendoring), the table may be
empty with an explicit "N/A — greenfield project; no inherited surface"
row inserted in place of placeholders.

---

## Open questions resolved at spec-emit (Q[N].1 → Q[N].M)

### Q[N].1 — [First open question architect picks]

**Architect-pick: [option] PICKED.**

**Why [option] picked:** [Reasoning + cross-references.]

**Why [alternative] rejected:** [Counter-reasoning. Explicit option-space enumeration per [`skills/08-architect-six-practices.md`](../skills/08-architect-six-practices.md) Practice 2.]

[Repeat Q[N].1 → Q[N].M for each open question architect resolves at spec-emit time.]

---

## Implementation surface

### File: `[path/to/file.ext]`

```
// Pseudo-code with verbatim text the Implementer will land.
// Architect drafts; Implementer implements without amendment unless
// halt-discipline triggers (per § Open questions or empirical surface).
```

[Repeat per file modified or created. Pseudo-code must round-trip with at least one § Tests case per [`skills/08-architect-six-practices.md`](../skills/08-architect-six-practices.md) Practice 5.]

---

## Tests

### `test/q[N]-[topic].test.ext` (new)

```
describe('Q[N] [topic]', () => {
  it('[acceptance criterion 1 round-trip]', async () => {
    // Pseudo-code per Practice 5 (round-trip vs P1 anchor).
  });

  // Repeat per acceptance criterion.
});
```

---

## Acceptance criteria

1. **AC-1:** [Empirical or structural assertion; binary met / not met.]
2. **AC-2:** [...]
3. **AC-3:** [...]

Each criterion maps to one test case in § Tests above. Each criterion traces to a PRD acceptance criterion (PRD-NN AC-M) where applicable. Numbering preserves architectural-decision provenance for downstream Reviewer audit.

---

## Anti-scope

Per [`skills/06-anti-scope-ledger.md`](../skills/06-anti-scope-ledger.md). Specific named items NOT in scope, with reasoning.

- **NO [out-of-scope item 1].** Reason: [why excluded — often "different work cycle" or "depends on upstream commitment N"].
- **NO [out-of-scope item 2].** Reason: [...]
- **NO [out-of-scope item 3].** Reason: [...]

**Cross-references to ANTI-SCOPE-LEDGER (if project maintains one):**

- **[ADR-NAME-1]:** [clauses verified preserved].
- **[ADR-NAME-2]:** [clauses verified preserved].

If project maintains an `ANTI-SCOPE-LEDGER.md`, architect at spec-emit verifies new spec doesn't violate any prior ADR's anti-scope clauses (Memorial F sub-rule 3 in [`skills/02-memorial-accretion.md`](../skills/02-memorial-accretion.md) discipline pattern).

---

## Open questions (deferred to implementation-time empirical surface)

1. **OQ-1:** [Question text.] Architect-pre-prediction: [estimated outcome]. Implementer verifies during implementation OR halts to TPM if mechanism diverges.
2. **OQ-2:** [...]

Open Qs are spec-emit-time honest accounting on uncertainty. Implementer empirical evidence either resolves OR escalates back via TPM.

---

## Pre-route discipline application

Per [`skills/08-architect-six-practices.md`](../skills/08-architect-six-practices.md) (P3 ten-axis spot-check) and [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md) (architect self-grilling).

### P3 ten-axis verification

- **P3.1 concrete-values:** [Inline derivations for all numerical thresholds cited per Practice 1.]
- **P3.2 coord-trail:** [Coordination artifacts grepped for contradicting claims.]
- **P3.3 file-opened:** [Files architect opened at brief-drafting time enumerated.]
- **P3.4 function-bodies:** [For refactor-class work, function bodies opened + module-local mutation grep'd.]
- **P3.5 compiled-artifacts:** [Compiled config state verified at brief-drafting; not just source code.]
- **P3.6 input-pipeline-alignment:** [Input harness verified vs compiled substrate.]
- **P3.7 compile-time-precision:** [FP-precision corner cases verified at compile time.]
- **P3.8 regime-coverage:** [Regime sweep covers analytical-pass + empirical-sweep regimes.]
- **P3.9 wrapper-vs-algorithm-layer:** [Algorithm-layer formal property separated from wrapper-layer code paths.]
- **P3.10 firing-attribution-discipline:** [Firing-ID source verified BEFORE hypothesis tree.]

### Architect grilling pass output

Per [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md) three-bucket classification:

#### CRITICAL: [N]

[Items where architect should re-draft section before emit. CRITICAL findings BLOCK spec emit.]

#### LIKELY-SURFACES: [N]

[Items Implementer will likely surface at implementation time. Pre-flagged in § Open questions OR § Anti-scope OR § Acceptance criteria CAVEAT clause.]

#### PRE-EMPTABLE: [N]

[Items folded into spec proactively; minor annotations / clarifications / cross-references.]

### Memorial application (if project uses Memorial-accretion discipline)

Per [`skills/02-memorial-accretion.md`](../skills/02-memorial-accretion.md). For each project-specific Memorial that triggers on this spec's content, document application:

- **[Memorial-name 1] (trigger condition):** [applied / not triggered].
- **[Memorial-name 2] (trigger condition):** [applied / not triggered].

---

## Implementation timeline

**Implementer (TBD which session if parallel): ~[X]h-[Y]d total.**

- ~[time]: [Step 1 description].
- ~[time]: [Step 2 description].
- ~[time]: [Step 3 description].

---

## Architect-pre-prediction on outcomes

Explicit option-space enumeration per Practice 2; probability bands sum to ~100%.

- **(a) Clean close:** ~[X]% prior. [Reasoning.]
- **(b) [Escalation path 1]:** ~[Y]% prior. [Reasoning.]
- **(c) [Escalation path 2]:** ~[Z]% prior. [Reasoning.]
- **(d) [Close-with-CAVEAT — if applicable]:** ~[W]% prior. [Reasoning.]

---

## Topic close framing

How Q[N] resolves drives next-cycle pick:

- **(a) Clean close:** [acceptance criteria all hit; sub-track CLOSED].
- **(b) [Escalation path 1]:** [partial acceptance; refinement committed to next cycle].
- **(c) [ADR / architectural deeper-commitment]:** [architectural insufficiency; deeper commitment].
- **(d) [Close-with-CAVEAT]:** [primary gate passes; CAVEAT inheritance for known property].

---

## Discipline-archive significance

[Per architect-side honest accounting. What does this Q[N] cycle teach about the project's discipline state? Memorial-accretion candidates? New P3 axis candidates? Pattern repetitions worth memorializing?]

1. [Discipline-archive observation 1.]
2. [Discipline-archive observation 2.]
3. [...]

---

_Spec template based on [`skills/08-architect-six-practices.md`](../skills/08-architect-six-practices.md) + [`skills/03-four-anchor-defense.md`](../skills/03-four-anchor-defense.md) (T0 anchor) + [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md). For canonical spec drafting; replace placeholders with cycle-specific content. Cross-reference project's ANTI-SCOPE-LEDGER (if maintained) for prior ADR clauses._
