# WAVE-GATE-[NN] — Wave [N] Gate: [Project Name]

_Fillable scaffold for the wave-gate checkpoint artifact described in
[`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md).
Version this file per wave (`WAVE-GATE-01.md`, `WAVE-GATE-02.md`, etc).
Do not edit in place — create a new version per wave._

**From:** Coordinator TPM
**To:** Program record + next wave clusters
**Date:** [YYYY-MM-DD]
**Wave:** [N] of [total waves per current `WAVE-PLAN-NN.md`]
**Foundation:** `WAVE-PLAN-[NN].md` + Reviewer reports from all Wave [N] clusters
**Type:** wave gate checkpoint

---

## Wave summary

[1–3 sentences. What did Wave [N] accomplish? What clusters ran, and what
did they produce?]

| Cluster ID | Work Unit | Tier | Status | Reviewer report |
|---|---|---|---|---|
| CL-[NN]-A | WU-[NN] | [solo \| audit \| full] | [PASS / FAIL / PARTIAL] | `REVIEWER-REPORT-[NN].md` |
| CL-[NN]-B | WU-[NN] | [solo \| audit \| full] | [PASS / FAIL / PARTIAL] | `REVIEWER-REPORT-[NN].md` |

---

## Pre-advance checklist

Per [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
wave gate discipline. **All items must be checked** before Wave [N+1]
dispatches. If any item is not checked, do not advance. Record the
blocking item and disposition below.

### Completeness

- [ ] All Wave [N] clusters have emitted a Reviewer report OR an
      explicit scope-reduction disposition (cluster ships a reduced-
      scope v1 and defers the remainder; documented per cluster below)
- [ ] No cluster is still executing (all have reached a terminal state:
      PASS, FAIL, or PARTIAL with disposition)

### Quality

- [ ] No CRITICAL findings in any Wave [N] Reviewer report are unresolved
- [ ] All LIKELY-SURFACES findings from Wave [N] Reviewer reports are
      catalogued below for pre-flagging to Wave [N+1] clusters
- [ ] All `full`-tier cluster Architect amendments (if any) are reflected
      in the relevant cluster handoff artifacts

### Scope integrity

- [ ] Anti-scope clauses from PRD are preserved across all Wave [N]
      outputs (verify against `ANTI-SCOPE-LEDGER.md` if the project
      maintains one; otherwise against the PRD's Out-of-scope section
      and each cluster's spec anti-scope)
- [ ] No Wave [N] output has silently expanded scope into Wave [N+1]
      territory
- [ ] Cross-cluster dependency artifacts for all Wave [N] → Wave [N+1]
      handoffs are current and accurate

### Memorial

- [ ] Coordinator memorial state has been updated with any new patterns
      surfaced in this wave gate (see `COORDINATOR-MEMORIAL.md`)
- [ ] Tier classification discrepancies (cluster self-assessed
      differently from wave plan) are logged

---

## Findings by cluster

### CL-[NN]-A — WU-[NN]: [Work unit name]

- **Gate verdict:** [PASS | FAIL | PARTIAL]
- **CRITICAL findings (unresolved):** [None | list]
- **LIKELY-SURFACES findings (pre-flag to Wave N+1):**
  - [LS-1]: [Description; which Wave N+1 cluster to pre-flag]
- **Scope expansion detected:** [None | description + corrective action]
- **Tier classification discrepancy:** [None | Coordinator classified
  [solo/audit/full]; cluster self-assessed [solo/audit/full]; logged]
- **Disposition:** [ADVANCE | RETRY | SCOPE-REDUCE-V1 | ROUTE-TO-ARCHITECT]

### CL-[NN]-B — WU-[NN]: [Work unit name]

- **Gate verdict:** [PASS | FAIL | PARTIAL]
- **CRITICAL findings (unresolved):** [None | list]
- **LIKELY-SURFACES findings (pre-flag to Wave N+1):**
  - [LS-1]: [Description; which Wave N+1 cluster to pre-flag]
- **Scope expansion detected:** [None | description + corrective action]
- **Tier classification discrepancy:** [None | Coordinator classified
  [solo/audit/full]; cluster self-assessed [solo/audit/full]; logged]
- **Disposition:** [ADVANCE | RETRY | SCOPE-REDUCE-V1 | ROUTE-TO-ARCHITECT]

---

## Failure handling log

[Complete only if any cluster disposition is FAIL, SCOPE-REDUCE-V1, or
ROUTE-TO-ARCHITECT.]

| Cluster | Failure type | Coordinator action | Downstream impact |
|---|---|---|---|
| CL-[NN]-A | [Self-contained rejection / Downstream implications / Spec ambiguity / Scope expansion] | [Retry internal / Resequence / Route to Architect / Anti-scope correction] | [None / WU-NN deferred / Wave N+1 resequenced] |

### Resequencing decisions (if any)

[If any Wave N+1 cluster depends on a Wave N cluster that failed, record
the resequencing here. Update `WAVE-PLAN-NN.md` accordingly and increment
its version.]

- WU-[NN] deferred to Wave [N+1 or N+2]: [reason]
- `WAVE-PLAN` revised to version [NN+1]: [what changed]

---

## Pre-flags to Wave [N+1] clusters

[LIKELY-SURFACES findings from Wave [N] that Wave [N+1] clusters should
be aware of before execution. The Coordinator includes these in the
dispatch routing for the relevant clusters.]

| Finding | Source cluster | Target Wave N+1 cluster | Pre-flag note |
|---|---|---|---|
| [LS description] | CL-[NN]-A | CL-[NN+1]-X | [Note to include in cluster dispatch] |

---

## Cross-cluster handoff status

[Verify all `CLUSTER-HANDOFF` artifacts between Wave [N] outputs and
Wave [N+1] inputs are current. See
[`templates/CLUSTER-HANDOFF-TEMPLATE.md`](./CLUSTER-HANDOFF-TEMPLATE.md)
for the artifact format.]

| Handoff artifact | From cluster | To cluster | Status |
|---|---|---|---|
| `CLUSTER-HANDOFF-[NN]-WU[A]-WU[B].md` | CL-[NN]-A | CL-[NN+1]-X | [CURRENT / NEEDS UPDATE] |

---

## Coordinator memorial update

[Record any new patterns surfaced in this wave gate that warrant memorial
accretion. Per
[`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
memorial discipline. Coordinator memorials capture DAG-construction and
wave-planning level patterns — not implementation-level failures.]

### New memorials (if any)

- [MEM-C-NN]: [Pattern description; what fired; violation or
  confirmation; adjustment to which coordinator discipline]

### Existing memorial confirmations (if any)

- [MEM-C-NN]: confirmed [N]th time. [Ratio: violations/confirmations.]

---

## Wave [N+1] dispatch authorization

**Gate verdict:** [ADVANCE | HOLD]

_If HOLD:_ [Blocking item; expected resolution path; estimated
resolution time before re-gate]

_If ADVANCE:_

Wave [N+1] clusters authorized for dispatch:

| Cluster | Work unit | Tier | Pre-flags from this gate | Handoff artifact |
|---|---|---|---|---|
| CL-[NN+1]-X | WU-[NN] | [solo \| audit \| full] | [None / LS items from above] | `CLUSTER-HANDOFF-[NN]-WU[A]-WU[B].md` |

Dispatch routing for each cluster: see `TPM-REPLY-[NN].md` (one per
cluster, per existing TPM routing discipline; or direct routing from
the Coordinator if the cluster operates without a dedicated TPM).
