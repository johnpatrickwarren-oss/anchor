# WAVE-PLAN-[NN] — Wave Plan v[V]: [Project Name]

_Fillable scaffold for the wave plan artifact described in
[`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md).
The wave plan is the Coordinator's primary output — the program-level
analog of the Architect's spec. It decomposes the PRD into work units,
identifies dependency edges, sequences them into waves, and records
tier classifications. Versioned per revision (`WAVE-PLAN-01.md`,
`WAVE-PLAN-02.md`, etc.); each wave-gate resequencing increments the
version. Do not edit in place._

**From:** Coordinator TPM
**Date:** [YYYY-MM-DD]
**Version:** v[N] (incremented on each wave-gate resequencing)
**Foundation:** `PRD-[NN].md` v[PRD version]
**Type:** wave plan — PRD decomposition + DAG + wave sequencing

---

## Plan summary

[1–3 sentences. How many work units extracted? How many waves? Which
work units are foundations? Any structural concerns surfaced during DAG
construction?]

| Wave | Cluster count | Foundation? | Notes |
|---|---|---|---|
| 1 | [N] | [Yes — list foundation WUs] | [Brief description] |
| 2 | [N] | No | [Brief description] |
| [final] | [N] | No (integration / hardening) | [Brief description] |

---

## PRD provenance

- **PRD source:** `coordination/PRD-[NN].md`
- **PRD version at plan time:** v[N] ([commit SHA if available])
- **Anti-scope clauses referenced:** [list any PRD anti-scope clauses
  that bound the work-unit extraction]
- **Open PRD questions deferred to operator:** [list, or "None — all
  resolved"]

---

## Step 1 — Work unit extraction (deterministic)

Per [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
§DAG construction discipline Step 1. Work units extracted directly from
PRD structure; one candidate work unit per PRD feature. No merging
without explicit reasoning logged below.

| WU ID | Source PRD feature | Acceptance criteria | Bounding anti-scope | File tree scope |
|---|---|---|---|---|
| WU-01 | [PRD §X.Y feature ref] | [Verbatim ACs from PRD] | [Anti-scope clauses that bound this unit] | [Directories/files this unit touches] |
| WU-02 | [PRD §X.Y feature ref] | [Verbatim ACs from PRD] | [Anti-scope clauses] | [File tree scope] |

### Merge reasoning (if any)

[Only fill if two PRD features were combined into one work unit. State
the explicit reasoning. Default: each PRD feature = one work unit.]

- **Merged [PRD §X.Y + PRD §A.B] into WU-[NN]:** [Reason]

---

## Step 2 — Dependency edge identification (deterministic)

Per [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
§DAG construction discipline Step 2. Each edge records the dependency
test that fired (D1–D4) and the confidence level.

| Source | Target | Test | Confidence | Reasoning |
|---|---|---|---|---|
| WU-[NN] | WU-[NN] | D1 (shared output ownership) | HIGH | [Specific output A writes, B reads] |
| WU-[NN] | WU-[NN] | D2 (AC reference) | HIGH | [B's AC references A's defined behavior] |
| WU-[NN] | WU-[NN] | D3 (anti-scope adjacency) | MEDIUM | [Implicit assumption flagged for Step 3] |
| WU-[NN] | WU-[NN] | D4 (file tree overlap) | MEDIUM | [Shared foundation file; serialized] |

### Contention risks (not dependencies)

[D4 file-tree overlaps that resolved via worktree isolation rather than
serialization. Listed for awareness, not enforcement.]

| Work units | Shared files | Resolution |
|---|---|---|
| WU-[NN], WU-[NN] | [files] | Worktree isolation (parallel safe) |

---

## Step 3 — Claude judgment at ambiguity boundaries

[Only fill if any MEDIUM-confidence edges or anti-scope adjacencies
required Claude judgment beyond D1/D2. Each judgment call is logged as
an audit artifact, distinguishable from deterministic D1/D2 edges.]

### Judgment call 1

- **Ambiguity:** [Specific quote from PRD or interface contract]
- **Candidate resolutions:**
  - Parallel: [Description; consequence]
  - Sequential: [Description; consequence]
- **Claude's judgment:** [Choice]
- **Reasoning:** [1–2 sentences]
- **Resulting edge:** WU-[NN] → WU-[NN] (or "confirmed independent")

_If none: "No Claude judgment calls required for this plan. All
dependencies resolved via D1/D2 deterministic tests."_

---

## Step 4 — DAG validation

Per [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
§DAG construction discipline Step 4.

- [ ] **Cycle check.** No circular dependencies. [If a cycle exists,
      surface to operator — indicates PRD structural problem.]
- [ ] **Island check.** Work units with no edges (no deps in or out)
      explicitly placed. Islands: [list, or "None"]
- [ ] **Foundation identification.** Work units whose outputs feed
      ≥3 other work units. Foundations: [list — these MUST land in
      Wave 1 regardless of their own dep-in count]

---

## Step 5 — Wave sequencing

| Wave | Work units | Rationale |
|---|---|---|
| 1 | WU-[NN], WU-[NN], WU-[NN] | Foundations + units with no dep-in edges |
| 2 | WU-[NN], WU-[NN] | All dep-in edges resolved by Wave 1 |
| 3 | WU-[NN] | All dep-in edges resolved by Wave 2 |
| [final] | WU-[NN] | Integration + cross-cutting concerns |

### Wave dispatch order (within each wave, parallel)

Work units within the same wave dispatch in parallel as separate
clusters. Each cluster receives a CLUSTER-HANDOFF artifact for any
inbound dependencies from prior waves (see "Cluster handoff inventory"
below).

---

## Step 6 — Tier classifications

Per [`skills/11-round-scaling.md`](../skills/11-round-scaling.md) tier
rubric and
[`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)
§Work unit classification. **Each cluster self-governs its own tier on
read; this column records the Coordinator's prior, not an instruction.**

| WU ID | Coordinator tier | Matched criteria | Rationale |
|---|---|---|---|
| WU-01 | full | A4 (novel data model), A1 (new dependency) | [1 sentence] |
| WU-02 | audit | S1 (extends existing pattern), S3 (single bounded item) | [1 sentence] |
| WU-03 | solo | Z3 (test-only addition) | [1 sentence] |

### Tier prior discrepancies

[Filled in over time as wave gates surface tier mismatches between
Coordinator prior and cluster self-assessment. Used to sharpen the
rubric via `COORDINATOR-MEMORIAL.md`.]

| WU ID | Coordinator prior | Cluster self-assessed | Wave gate where surfaced |
|---|---|---|---|

---

## Cluster handoff inventory

Each directed dependency edge from Step 2 requires a `CLUSTER-HANDOFF`
artifact at the wave boundary where it fires. Created at dispatch of
the target cluster (not pre-created). Lists here are forward-looking.

| Handoff artifact | From WU | To WU | Wave boundary |
|---|---|---|---|
| `CLUSTER-HANDOFF-[NN]-WU[A]-WU[B].md` | WU-[A] (Wave N) | WU-[B] (Wave N+1) | Wave N → N+1 gate |

Template: [`templates/CLUSTER-HANDOFF-TEMPLATE.md`](./CLUSTER-HANDOFF-TEMPLATE.md).

---

## Pre-emit grilling

Per Anchor's pre-emit grilling discipline (see
[`skills/01-pre-emit-grilling.md`](../skills/01-pre-emit-grilling.md)),
the Coordinator self-reviews this plan adversarially before
authorizing Wave 1 dispatch.

- [ ] **Every dependency edge is verifiable.** Each row in Step 2 cites
      a specific test (D1/D2/D3/D4) with concrete reasoning. No edges
      added by intuition without a deterministic anchor.
- [ ] **No unstated assumptions.** Anti-scope adjacencies (D3) are
      flagged in Step 3 with explicit judgment, not silently
      treated as independent or dependent.
- [ ] **No scope added beyond PRD.** Work-unit extraction (Step 1)
      cites PRD feature refs; no invented work units.
- [ ] **Implementer / cluster can act without guessing.** Each work
      unit has verbatim ACs + bounding anti-scope + file tree scope.
- [ ] **DAG is acyclic.** Cycle check (Step 4) passed.
- [ ] **Tier priors are defensible.** Each tier classification cites
      A/S/Z criteria from the rubric.

If any check fails: revise this plan before routing.

---

## Open questions for operator

[Filled when the PRD has ambiguity the Coordinator cannot resolve via
deterministic Step 1 + Step 2 tests. The Coordinator does NOT decide
operator-level questions; it surfaces them for resolution before
Wave 1 dispatches.]

- **OQ-1:** [Specific question with bounded options — see Anchor's
  escalation protocol pattern. Format: "Option A does X (consequence
  Y). Option B does Z (consequence W). Which?"]

_If none: "None — all resolved during PRD authoring."_

---

## Wave 1 dispatch authorization

**Plan verdict:** [READY-TO-DISPATCH | HOLD]

_If HOLD:_ [Blocking item — typically operator decision on OQ-N, or
PRD revision required]

_If READY:_

Wave 1 clusters authorized for dispatch:

| Cluster | Work unit | Tier (Coordinator prior) | Dispatch routing |
|---|---|---|---|
| CL-[NN]-A | WU-[NN] | [solo \| audit \| full] | `TPM-REPLY-[NN].md` (or direct from Coordinator if no TPM) |

---

## Version history

| Version | Date | Trigger | What changed |
|---|---|---|---|
| v1 | [YYYY-MM-DD] | Initial PRD decomposition | Initial plan |
| v2 | [YYYY-MM-DD] | Wave [N] gate resequencing | [WUs deferred / merged / split; new dependency edges] |
