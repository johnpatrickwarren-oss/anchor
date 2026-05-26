# Q-[N]-SPEC AUDIT SIDECAR

_Companion to `coordination/specs/Q-[N]-SPEC.md`. Holds Architect ceremony content (brainstorm rationale, per-decision why-picked/why-rejected paragraphs, pre-route discipline output, architect pre-predictions, amendment history) that is load-bearing for the Reviewer's audit but NOT load-bearing for the Implementer's cold-read execution._

_From: Architect (emitted alongside the spec proper). Routed via: NEXT-ROLE.md state machine._
_Audience: Reviewer (reads both this sidecar AND the spec proper for full audit context); Memorial Updater (reads for discipline-trail entries). Implementer reads ONLY the spec proper — cold-start discipline._
_Date: [YYYY-MM-DD]._

---

## Why this sidecar exists

The audit-sidecar split separates **discipline ceremony** from **implementation contract**. The spec proper carries the binding contract (mechanism, integration points, acceptance criteria, anti-scope, tests, implementation surface). This sidecar carries the discipline output (brainstorm, decision rationale, pre-route checklist application, architect pre-predictions, amendment table).

Two benefits:

1. **Implementer cold-read weight drops ~30%.** The Implementer doesn't carry the Architect's reasoning ballast in context, which preserves cold-start discipline (Implementer encounters the contract fresh, not pre-influenced by Architect's reasoning).
2. **Reviewer audit gains structured discipline trail.** All discipline ceremony lives in one predictable file location, making cross-spec discipline-audit grep'able.

The pattern is REQUIRED for Tessera Phase 1+ specs and RECOMMENDED for any project where spec ceremony exceeds ~30% of total spec content. Projects with thin specs (e.g., audit-tier rounds with self-spec at ≤2 pages) may inline ceremony in the spec proper without harm.

---

## Brainstorm (Superpowers Brainstorm phase output)

Per [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md) and Superpowers Brainstorm discipline (≥3 distinct approaches enumerated with rejection rationale).

### Approach A — [Short label]

[Description; what does this approach do? what's its scope?]

**Strengths:** [...]
**Weaknesses:** [...]
**Hidden assumptions:** [...]
**Why rejected (or PICKED):** [...]

### Approach B — [Short label]

[Same structure.]

### Approach C — [Short label]

[Same structure.]

### Selection — Approach [X]

**PICKED:** [Approach name]. **Why this over the alternatives:** [explicit rationale referencing rejected approaches by short label, not just "best fit"].

**Compensating control for accepted weakness:** [if the picked approach has a known weakness from the brainstorm, document the compensating control or accepted-coverage-gap here].

---

## Decision rationale (per resolved decision)

[For each open question / resolved decision in the spec proper, document the why-picked / why-rejected paragraphs here rather than inline in the spec. Keeps the spec proper focused on the binding pick; keeps the rationale accessible to Reviewer + Memorial Updater audit.]

### D1 — [Decision name]

**Picked:** [option].

**Why picked:** [≥2 specific reasons; cite affected surface or downstream consequence].

**Why rejected (alternative A):** [≥2 specific reasons; cite the specific weakness that makes the alternative worse for this case].

**Why rejected (alternative B):** [same structure].

**Compensating control for accepted weakness:** [if applicable].

### D2, D3, ... — [follow same structure for each resolved decision]

---

## Pre-route discipline application

Per [`skills/08-architect-six-practices.md`](../skills/08-architect-six-practices.md) (P3 ten-axis spot-check) and [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md) (architect self-grilling).

### P3 ten-axis verification

- **P3.1 concrete-values:** [Inline derivations for all numerical thresholds cited per Practice 1.]
- **P3.2 coord-trail:** [Coordination artifacts grepped for contradicting claims.]
- **P3.3 file-opened:** [Files architect opened at brief-drafting time enumerated. **Cross-reference the spec's § Existing architectural surface citation table — that's the structural enforcement; this axis confirms application.**]
- **P3.4 function-bodies:** [For refactor-class work, function bodies opened + module-local mutation grep'd.]
- **P3.5 compiled-artifacts:** [Compiled config state verified at brief-drafting; not just source code.]
- **P3.6 input-pipeline-alignment:** [Input harness verified vs compiled substrate.]
- **P3.7 compile-time-precision:** [FP-precision corner cases verified at compile time.]
- **P3.8 regime-coverage:** [Regime sweep covers analytical-pass + empirical-sweep regimes.]
- **P3.9 wrapper-vs-algorithm-layer:** [Algorithm-layer formal property separated from wrapper-layer code paths.]
- **P3.10 firing-attribution-discipline:** [Firing-ID source verified BEFORE hypothesis tree.]

### Project-specific pre-route gates (if any)

[Some projects apply additional pre-route gates beyond the canonical P3. Document each gate's application here. Examples from precedent projects:]

- **Skill 14 PRD-conjunction-cross-check** — every PRD-conjunct binds to ≥1 AC or is explicitly anti-scope.
- **Skill 15 prescription-to-AC coverage** — every prescription in § Mechanism / § Implementation surface binds to ≥1 AC.

### Architect grilling pass output

Per [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md) three-bucket classification:

#### CRITICAL: [N]

[Items where architect should re-draft section before emit. CRITICAL findings BLOCK spec emit.]

#### LIKELY-SURFACES: [N]

[Items Implementer will likely surface at implementation time. Pre-flagged in the spec's § Open questions OR § Anti-scope OR § Acceptance criteria CAVEAT clause.]

#### PRE-EMPTABLE: [N]

[Items folded into the spec proper proactively; minor annotations / clarifications / cross-references.]

### Additional grilling steps (apply when relevant)

Per [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md) recent additions:

- **OBSERVED-binding scope check:** for every OBSERVED-binding disposition in the spec, ask "would a future FIX matching the architect prediction FAIL this test?" — if yes, the binding is self-confirming. Redesign.
- **Inherited-testimony empirical verification:** for every factual claim about prior-round behavior (cited from prior Reviewer / Architect / Memorial), run the relevant command/fixture and record the OBSERVED output inline. "Inherited from prior testimony" is not equivalent to "verified by own observation."
- **Correction-propagation pass:** when correcting a wrong factual claim in any multi-section document, enumerate ALL semantic-paraphrase sites + downstream citing sections. A literal-exact grep returning 0 is not full-document consistency verification.

### Memorial application (if project uses Memorial-accretion discipline)

Per [`skills/02-memorial-accretion.md`](../skills/02-memorial-accretion.md). For each project-specific Memorial that triggers on this spec's content, document application:

- **[Memorial-name 1] (trigger condition):** [applied / not triggered].
- **[Memorial-name 2] (trigger condition):** [applied / not triggered].

---

## Architect pre-predictions on outcomes

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

## Amendments from prior version (if applicable)

[When the audit sidecar accompanies a versioned spec (v0.2 amending v0.1, etc.), document the amendment table here.]

| Finding | Class | Disposition | Sections amended |
|---|---|---|---|
| **[F-N / G-N / etc.]** | [FAIL / GAP / etc.] | [AMENDED — option (...) PICKED. Architect did [X] at [time]; rewrote [section] with [specific change]. Memorial state delta if applicable.] | [§ Sections in the spec proper that were amended; § Sections in THIS sidecar that were amended] |

---

_Audit sidecar template based on [`templates/Q-NN-SPEC-TEMPLATE.md`](Q-NN-SPEC-TEMPLATE.md) + [`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md). Pattern derived from Tessera Phase 1 R01-R10 audit-sidecar usage; integrated into anchor templates 2026-05-17._
