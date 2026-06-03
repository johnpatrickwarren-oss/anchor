# COORDINATOR-MEMORIAL.md — [Project Name] Coordinator-Level Memorial

_Fillable scaffold for the Coordinator-level memorial artifact described in
[`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md) §Memorial
accretion at the coordinator level. Captures patterns at the DAG-construction
and wave-planning level — separate from cluster-level `MEMORIAL.md` (which
captures implementation-level patterns)._

_Appended at every wave gate where a coordinator-level pattern surfaces, per
[`skills/02-memorial-accretion.md`](../skills/02-memorial-accretion.md)
discipline applied to coordinator concerns._

_Last updated: [YYYY-MM-DD]._

---

## How to use this file

**Append-only.** Never delete or rewrite past entries. The accumulated
history IS the value — ratios of violations to confirmations drive which
disciplines need sharpening.

**Entry format** (same as project `MEMORIAL.md`, but role is always
Coordinator TPM and the "round" identifier is a wave + gate reference):

```
CONFIRMATION: [discipline] | [what worked, specifically] | Wave [N] gate | Coordinator
VIOLATION:    [discipline] | [what happened, specifically] | Wave [N] gate | Coordinator
```

**Be specific.** "Dependency edge wrong" is not useful. "WU-04 → WU-09
classified HIGH confidence via D1; wave gate discovered WU-09 actually
reads from a third file written by WU-12, not WU-04. D1 application
missed the third-party-write case." is useful.

**Disciplines tracked** (extend as new patterns surface):

- `dependency-edge-classification` — D1–D4 test application accuracy
- `claude-judgment-threshold` — Step 3 escalation calibration
- `tier-classification` — Coordinator prior vs cluster self-assessment
- `wave-gate-failure-handling` — disposition appropriateness
- `cross-cluster-handoff-completeness` — handoff artifact accuracy
- `dag-construction-discipline` — overall DAG quality
- `pre-emit-grilling` — Coordinator self-review effectiveness

---

## Confirmations + violations (chronological)

### Wave [N] gate ([YYYY-MM-DD])

CONFIRMATION: [discipline] | [what worked, specifically] | Wave [N] gate | Coordinator

VIOLATION: [discipline] | [what happened, specifically] | Wave [N] gate | Coordinator

[Continue chronologically. Each wave gate that produces a memorial-
worthy observation gets its own subsection. Wave gates with zero
memorial observations need no entry — silence is acceptable.]

---

## Reinforcement rules derived

When a discipline accumulates **3+ violations** across waves (or
across projects, when tracked at the cross-project layer), the
Coordinator derives a sharpening rule. Derived rules become part of the
Coordinator's standing discipline and are referenced from
[`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
when the pattern crosses the cross-project threshold.

### dependency-edge-classification

_Trigger: when 3+ violations accumulate._

- [Rule statement; what to do differently. Example: "When D1 fires on a
  schema file, verify that the target work unit actually reads the
  schema rather than just importing the type — TypeScript imports
  don't always indicate runtime dependency."]

### claude-judgment-threshold

_Trigger: when 3+ violations accumulate._

- [Rule statement]

### tier-classification

_Trigger: when 3+ violations accumulate._

- [Rule statement]

### wave-gate-failure-handling

_Trigger: when 3+ violations accumulate._

- [Rule statement]

---

## Cross-project emerging patterns

When a pattern recurs across **two or more projects**, escalate from
project-local memorial to cross-project methodology evolution. Promotion
path:

1. Pattern observed in this project; logged above with appropriate
   discipline category.
2. Same pattern surfaces in a second project's Coordinator memorial.
3. Operator (or Coordinator) reads both memorials at the next
   coordinator-level retrospective.
4. If pattern is durable: propose update to
   [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
   itself (e.g., add a new D5 test; tighten Z3 caveat; etc.) via a
   canonical anchor PR.
5. New rule lives at the methodology level going forward; future
   Coordinators inherit it without re-deriving.

### Patterns watched for cross-project recurrence

[Maintain a short watch-list of patterns observed once in this project
that might cross the cross-project threshold if they recur. Helps the
operator scan for matches when starting a new project's Coordinator
work.]

- [Pattern: brief description; first observed at Wave [N] gate of [project name]]

---

## Update history

- **[YYYY-MM-DD]:** Memorial initialized at start of [project name]'s
  multi-cluster phase.
