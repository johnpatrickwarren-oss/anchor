# Skill: Coordinator — PRD Decomposition and Wave Planning

**Trigger:** Project has a structured PRD and is ready to begin multi-cluster
parallel execution.
**Application moment:** After PRD is finalized and before any implementation
begins. Re-applied at scope revisions that affect work unit boundaries or
dependency edges.
**Owner:** Coordinator TPM — a dedicated session whose scope is cross-wave
orchestration only. Distinct from any cluster-level TPM work.

## What it is

The Coordinator role owns how a structured PRD becomes a dependency graph,
and how that graph becomes a sequenced wave plan that parallel clusters
can execute against.

This skill is upstream of all cluster dispatch. No cluster receives work
until the Coordinator has produced a validated wave plan with explicit
dependency edges, work unit classifications, and wave gate criteria. The
wave plan is the Coordinator's primary artifact — the analog of the
Architect's spec or the PM's PRD, but at the program level rather than the
feature level.

## Why a separate role

The existing TPM role (see [`templates/TPM-REPLY-TEMPLATE.md`](../templates/TPM-REPLY-TEMPLATE.md))
handles routing within a project — forwarding specs to implementers,
grilling artifacts before emit, tracking memorial state. That role
operates inside a single coordination cycle.

The Coordinator operates across cycles and across clusters. Its job is
not to route work but to determine what work exists, what order it must
happen in, and how many streams can run simultaneously. Conflating this
with intra-cycle TPM routing produces a role that is doing two
qualitatively different things and doing neither with full discipline.

The Coordinator has no reach inside any cluster. Once a cluster receives
its work unit, the Coordinator's job for that cluster is done until the
wave gate. What happens inside the cluster — whether it scales to
include an Architect, whether the Reviewer rejects and the cluster
retries — is not the Coordinator's concern until the cluster's output
surfaces at the wave gate.

## Coordinator scope and out-of-scope

**In scope:**
- PRD decomposition into candidate work units
- Dependency edge identification and DAG construction
- Wave sequencing from the DAG
- Work unit classification (novelty/complexity tier)
- Wave gate execution across all cluster outputs
- Cross-cluster dependency artifact management
- Resequencing dependent clusters when a wave gate surfaces a rejection
- Memorial accretion at the coordinator level

**Out of scope:**
- Spec drafting (Architect's role within clusters)
- Implementation (Implementer's role within clusters)
- Spec-vs-implementation audit (Reviewer's role within clusters)
- Intra-cluster routing decisions
- Retry decisions within a cluster (cluster handles internally up to halt threshold)

## DAG construction discipline

### Step 1 — Deterministic work unit extraction

Extract candidate work units directly from PRD structure. A well-formed
PRD (per [`skills/10-product-manager-role.md`](./10-product-manager-role.md))
has explicit features, acceptance criteria, and anti-scope. Each feature
is a candidate work unit. Do not invent work units; do not merge features
without explicit reasoning captured in the wave plan artifact.

For each candidate work unit, record:
- Work unit ID (e.g., WU-01, WU-02)
- Source PRD feature reference
- Acceptance criteria (verbatim from PRD)
- Anti-scope clauses that bound this unit
- File tree scope (which directories/files this unit touches)

This extraction is deterministic. Same PRD → same candidate work units.
No Claude judgment required at this step.

### Step 2 — Dependency edge identification

For each pair of work units, apply the following deterministic dependency
tests in order. If any test fires, record a dependency edge with the test
that fired as the reason.

**Test D1 — Shared output ownership.** Does WU-A write to a file, schema,
or interface that WU-B reads from? If yes: WU-A → WU-B (A must complete
before B dispatches).

**Test D2 — Acceptance criterion reference.** Does WU-B's acceptance
criteria mention a behavior, data structure, or interface that WU-A's
acceptance criteria define? If yes: WU-A → WU-B.

**Test D3 — Anti-scope boundary adjacency.** Is WU-B's scope adjacent to
WU-A's anti-scope in a way that creates an implicit assumption? Flag for
Claude judgment (Step 3).

**Test D4 — File tree overlap.** Do WU-A and WU-B touch the same files?
If yes: record as a contention risk, not necessarily a dependency.
Resolve via worktree isolation unless the overlap is in a shared
foundation file, in which case: WU-A → WU-B or serialize.

**Test D5 — Migration ownership.** Does WU-A or WU-B add a file to the
project's migration directory (default conventions: `prisma/migrations/`,
`db/migrate/`, `migrations/`, `supabase/migrations/`; configurable per
project)? If both do, they have a serial dependency regardless of file
overlap — the migration history is linear by construction in every
modern ORM. The work unit whose intended schema state is earlier lands
first. If intended order is ambiguous from the PRD, escalate to Step 3.
The migration lock described under Shared-resource arbitration is a
fallback for D5 misses, not a primary discipline.

Record every edge with: source work unit, target work unit, dependency
test that fired, confidence (HIGH if D1/D2/D5, MEDIUM if D3/D4).

### Step 3 — Claude judgment at ambiguity boundaries

Escalate to Claude only when:
- A dependency edge has MEDIUM confidence and the consequence of getting
  it wrong is a merge conflict or spec contradiction
- Two work units have no deterministic dependency edge but share a
  conceptual assumption that isn't captured in file tree or acceptance
  criteria
- Anti-scope boundary adjacency (D3) fired and the implicit assumption
  isn't resolvable by reading the PRD more carefully

For each Claude judgment call, record:
- The specific ambiguity (quote the relevant PRD text)
- The two candidate resolutions (parallel vs. sequential)
- Claude's judgment and the reasoning
- Resulting edge (or confirmed independence)

Claude judgment calls are logged as judgment artifacts, not deterministic
rules. The audit trail distinguishes them from D1/D2 edges.

### Step 4 — DAG validation

Before proceeding to wave planning, validate the DAG:

- **Cycle check.** No circular dependencies. If a cycle exists, surface
  to human operator — it indicates a PRD structural problem, not a DAG
  construction problem.
- **Island check.** Any work unit with no edges (no dependencies in or
  out) is a candidate for Wave 1 or any wave. Flag for explicit placement.
- **Foundation identification.** Work units whose outputs are inputs to
  3+ other work units are foundations. They must land in Wave 1 regardless
  of their own dependency-in count. Data models, shared interfaces, and
  core API contracts are the typical foundation candidates.

### Step 5 — Wave sequencing

From the validated DAG, assign work units to waves:

- **Wave 1:** Foundations + any work unit with no dependency-in edges
- **Wave N+1:** Work units whose all dependency-in edges point to work
  units completing in Wave N or earlier
- **Final wave:** Integration, cross-cutting concerns, hardening — work
  units that touch outputs from multiple prior waves

Record the wave plan as a durable artifact (`WAVE-PLAN-NN.md` in the
coordination folder). The wave plan is the Coordinator's primary output
and the input to cluster dispatch.

## Work unit classification

Each work unit receives a tier classification that determines the cluster
role configuration. This classification is self-governing — each cluster
reads its work unit and applies the rubric independently. The Coordinator
records the expected tier in the wave plan, but the cluster's own
assessment governs.

The tier names align with [`skills/11-round-scaling.md`](./11-round-scaling.md)
(the round-scaling rubric):

**`solo` — Implementer only:**
- Work unit is well-understood (similar to prior work in this project or codebase)
- Acceptance criteria are unambiguous and fully testable
- No novel algorithms, data structures, or integration patterns
- File tree scope is narrow and well-bounded

**`audit` — Implementer + Reviewer:**
- Work unit involves moderate complexity or cross-cutting concerns
- Acceptance criteria require interpretation at the boundary
- Implementation approach is known but verification is non-trivial
- File tree scope touches shared infrastructure

**`full` — Architect + Implementer + Reviewer:**
- Work unit is novel relative to the existing codebase
- Acceptance criteria involve emergent behavior or integration contracts
  not yet defined
- Implementation approach requires design decisions with downstream
  consequences
- File tree scope touches foundations or public interfaces

When in doubt, classify up. A `full` cluster that didn't need the
Architect costs one extra role's overhead. A `solo` cluster that needed
an Architect and didn't have one costs a Reviewer rejection and a retry
cycle.

### Cluster tier configurations vs. single-pipeline tiers

The cluster tier configurations above differ from the single-pipeline
tiers in [`skills/11-round-scaling.md`](./11-round-scaling.md) in one
specific way: **clusters in multi-cluster execution omit the per-cluster
Memorial-Updater role.** A separate Memorial-Updater per cluster would
produce concurrent appends to `MEMORIAL.md` and `CROSS-PROJECT-MEMORIAL.md`
across N parallel clusters — a race condition.

In multi-cluster mode, memorial duties redistribute:
- **Per-cluster CONFIRMATION/VIOLATION entries** are written inline by
  the cluster's Implementer (in `solo`) or by the Reviewer at the end of
  the Reviewer report (in `audit`/`full`). They land in
  `coordination/clusters/<cluster-id>/MEMORIAL-fragment.md`.
- **Wave-gate aggregation** is the Coordinator's job. At each wave gate,
  the Coordinator collects cluster memorial fragments and appends them
  to the project's `MEMORIAL.md` and `CROSS-PROJECT-MEMORIAL.md` under a
  single lock.
- **Coordinator-level memorial** (DAG construction and wave planning
  patterns) lives in `COORDINATOR-MEMORIAL.md` as described below.

In single-pipeline (Mode 2) mode, the Memorial-Updater role remains as
a separate fourth role per round — no parallelism, no race, no need to
collapse.

For the operational mechanism — locking primitives, fragment merge
order, timeout discipline, cross-project memorial freshness, schema
migration arbitration, and CLAUDE.md stamping under parallelism — see
Shared-resource arbitration in multi-track mode below.

## Wave gate discipline

The wave gate is the Coordinator's primary quality control mechanism
between waves. It is not a rubber stamp — it is the program-level
equivalent of the four-anchor pre-merge defense, applied across all
cluster outputs simultaneously.

Wave gate checklist (run before dispatching Wave N+1):

- [ ] All Wave N clusters have emitted a Reviewer report (or explicit
      scope-reduction disposition per two-slice pattern)
- [ ] No CRITICAL findings in any Reviewer report are unresolved
- [ ] All cross-cluster dependency artifacts for Wave N outputs are
      current and accurate
- [ ] Anti-scope clauses from the PRD are preserved across all Wave N
      outputs
- [ ] No Wave N output has silently expanded scope into Wave N+1 territory
- [ ] Memorial state at wave gate is captured in `WAVE-GATE-NN.md`

**Wave gate failure handling:**

| Failure type | Coordinator action |
|---|---|
| Reviewer rejection, self-contained | Cluster retries internally; wave gate holds until resolved |
| Reviewer rejection with downstream implications | Coordinator resequences dependent clusters; records resequencing in `WAVE-GATE-NN.md` |
| Spec ambiguity surfaced by Reviewer | Coordinator routes back to Architect (if cluster had one) or spawns Architect for a targeted spec amendment before retry |
| Scope expansion detected | Coordinator issues anti-scope correction; cluster revises before wave gate clears |

The wave gate never advances under CRITICAL unresolved findings.
LIKELY-SURFACES findings from any cluster are pre-flagged to the next
wave's relevant clusters before dispatch.

## Shared-resource arbitration in multi-track mode

Multi-track parallelism introduces several project-shared and
operator-global resources that cannot be written concurrently without
data loss or correctness violations. The Coordinator owns serialization
at every such boundary. The structural principle:

> Tracks execute independently; the Coordinator coordinates only the
> moments where they cannot.

Single-pipeline (Mode 2) execution does not require these mechanisms —
one writer, one cycle, serialization is trivial. The disciplines below
apply only when two or more tracks may be active concurrently against
the same project working tree.

### Resources requiring arbitration

| Resource | Writer | Arbitration mechanism |
|---|---|---|
| `coordination/MEMORIAL.md` | Coordinator at wave gate | Cluster fragments aggregated under a single project lock |
| `~/.claude/CROSS-PROJECT-MEMORIAL.md` | Operator-driven merge script | Per-project shards merged in batch on operator cadence (default weekly) |
| `coordination/CLAUDE.md` (canonical) | Coordinator at wave gate | Reinforcement appends under the same project lock as memorial |
| Per-session role/round stamp | Pipeline dispatcher | Per-track stamped copies; canonical is never stamped |
| Migration directory (e.g., `prisma/migrations/`) | Cluster Implementer | DAG D5 enforces serial dependency; migration lock catches D5 misses |

### Memorial state

**Project memorial (`coordination/MEMORIAL.md`).** Clusters never write
directly. Each cluster emits a fragment at
`coordination/clusters/<cluster-id>/MEMORIAL-fragment.md` (single-writer
inside the cluster — no concurrency). At the wave gate, the Coordinator
takes a `flock(2)` advisory lock on `coordination/.MEMORIAL.lock`,
appends all fragments from the just-completed wave to `MEMORIAL.md` in
deterministic order (cluster-id ASC, then fragment line order), and
releases the lock. Fragments are appended verbatim — no rewriting.

**Cross-project memorial (`~/.claude/CROSS-PROJECT-MEMORIAL.md`).** Not
written per round. Each project accumulates its own per-project shard
at `~/.claude/projects/<project-id>/MEMORIAL-shard.md`. A separate
operator-invoked script
(`~/anchor/integrations/superpowers-claude-code/merge-cross-project-memorial.sh`,
to be added as the integration ships) folds all per-project shards into
the canonical cross-project file in batch. Default cadence: weekly. The
cross-project memorial is advisory context for Architect/Reviewer reads,
not load-bearing per-round state — a few days of staleness is
acceptable.

**Per-cluster fragment format.** CONFIRMATION/VIOLATION lines in the
same format as `MEMORIAL.md`. Each line tagged with cluster ID and
work unit ID so the Coordinator's merge is deterministic even if
fragment file timestamps drift.

### CLAUDE.md role/round stamping

In Mode 2, `run-pipeline.sh` stamps the project's `CLAUDE.md` with the
current role and round at session start. Under multi-track parallelism,
concurrent stamping by parallel sessions produces undefined state.

Arbitration:

- The pipeline dispatcher writes per-track stamped copies to
  `coordination/clusters/<cluster-id>/CLAUDE.md`. Each cluster session
  reads its own per-track copy as the role-anchored file. Per-track
  copies are ephemeral (`coordination/clusters/` should be
  `.gitignore`d) and regenerated at each session start.
- The canonical `coordination/CLAUDE.md` (version-controlled) holds
  only the methodology body and accumulated reinforcements. The
  canonical file is never stamped.
- The Coordinator appends new reinforcements to the canonical file at
  wave gate under the same `flock(2)` lock that serializes memorial
  merges (`coordination/.MEMORIAL.lock` — one lock, both files).

This preserves the role-identity discipline
([`skills/09-role-anchoring.md`](./09-role-anchoring.md)) without
collision and without forcing tracks to wait on a stamp.

### Schema migrations

The DAG D5 test catches migration ownership at planning time and places
migration-touching work units in different waves. This handles the
common case deterministically and at zero runtime cost.

When D5 misses — work unit's file-tree-scope did not declare a
migration directory touch, but the Implementer generates a migration
anyway — a migration lock catches it at execution time:

- Each cluster Implementer takes `flock(2)` on
  `<migration-dir>/.migration.lock` before invoking the migration
  generator. The lock is project-wide by default. Projects with
  multiple databases may configure per-database locks via
  `coordination/multi-track-config.json` (a future extension).
- Lock hold time should be <30 seconds for routine migrations. Default
  timeout: 10 minutes. On timeout, the dispatcher aborts the
  lock-holding cluster, writes
  `coordination/diagnostics/DIAGNOSTIC-track-<id>-migration-timeout.md`,
  and signals the operator (the same channel as cluster-level
  ESCALATE).
- The 10-minute default tolerates the laptop-sleep failure mode
  observed across many sequential rounds. Projects with legitimately
  slow migrations (large data backfills) override per-project.

**ORM portability.** D5 and the migration lock reference a
project-configured migration-directory path with a convention fallback:
`prisma/migrations/`, `db/migrate/`, `migrations/`, `supabase/migrations/`.
Each project declares its migration directory at coordinator setup
(default: first matching convention path that exists in the project
tree). Methodology is ORM-agnostic by design.

### Arbitration primitives

**Locking.** All arbitration uses `flock(2)` advisory locks on lock
files inside the project working tree. Reliable on macOS and Linux
local filesystems. Not reliable on network-mounted file systems (NFS,
SMB, iCloud Drive, Dropbox synced folders). Multi-track Anchor requires
the project working tree on a local filesystem. Lock files are tagged
with the holding PID so stale locks (process dead, lock held) can be
cleared deterministically.

**Poll loop.** Lock acquisition uses a 5-second poll loop with a
per-resource timeout. Defaults: memorial / CLAUDE.md merge at wave gate
= 30 minutes (long, to tolerate a slow Memorial-Updater wave); migration
= 10 minutes (short, because hold time should be seconds and timeout
indicates a stuck process).

**No daemon.** All arbitration is file-based. No background daemon
required. Crash recovery: stale-lock detection runs at pipeline
start (`run-pipeline.sh` pre-flight) — for each lock file with a
PID-tagged holder, if the tagged PID is not running, the lock is
cleared with a logged warning to the operator.

**Observability.** The Coordinator writes
`coordination/multi-track-status.json` at each lock acquire/release —
a one-shot snapshot (no append). Operator-facing warnings:
acquired-lock-age >2× the resource's median observed hold time fires a
warning (default thresholds before observation data: memorial ~10 min
warn, migration ~3 min warn). Halt new dispatches when
acquired-lock-age >2× the per-resource timeout.

### When NOT to apply

These mechanisms exist for genuine multi-track execution. They are
overhead in Mode 2. Apply only when:

- Two or more cluster sessions may be active on the same project at the
  same wall-clock time
- The Coordinator has emitted a wave plan with ≥2 clusters in at least
  one wave
- The operator has explicitly enabled multi-track dispatch (a future
  pipeline flag — TBD)

If the project's wave plan has at most one cluster per wave, the
Coordinator dispatches sequentially and the arbitration mechanisms are
inert. The methodology degrades gracefully to single-pipeline behavior.

## Memorial accretion at the coordinator level

The Coordinator maintains its own memorial layer, separate from any
cluster's memorial state. Coordinator memorials capture patterns at the
DAG construction and wave planning level — not implementation-level
failures.

Memorialize when:
- A dependency edge that was classified HIGH confidence turned out to be
  wrong at wave gate (adjust D1/D2 test application)
- A Claude judgment call at Step 3 resolved differently than the wave
  gate evidence suggested (adjust escalation threshold)
- A work unit classified `solo` required a `full` cluster (adjust
  classification rubric)
- A wave gate failure pattern repeats across two or more projects
  (promote to coordinator-level discipline)

Track violations and confirmations per memorial. Ratio drives
prioritization — same discipline as
[`skills/02-memorial-accretion.md`](./02-memorial-accretion.md) but
applied to coordinator-level failure patterns rather than
implementation-level ones.

## Coordinator artifacts

| Artifact | Location | Purpose |
|---|---|---|
| `WAVE-PLAN-NN.md` | `coordination/` | DAG + wave assignments + tier classifications; primary coordinator output. Fillable scaffold: [`templates/WAVE-PLAN-TEMPLATE.md`](../templates/WAVE-PLAN-TEMPLATE.md). Version per revision (do not edit in place). |
| `WAVE-GATE-NN.md` | `coordination/` | Wave gate checklist results + failure dispositions per wave. Fillable scaffold: [`templates/WAVE-GATE-TEMPLATE.md`](../templates/WAVE-GATE-TEMPLATE.md). Version per wave (do not edit in place). |
| `CLUSTER-HANDOFF-NN-WU[A]-WU[B].md` | `coordination/` | Cross-cluster dependency contract for a directed edge (source WU → target WU). Fillable scaffold: [`templates/CLUSTER-HANDOFF-TEMPLATE.md`](../templates/CLUSTER-HANDOFF-TEMPLATE.md). One file per edge — do not merge multiple edges. |
| `COORDINATOR-MEMORIAL.md` | `coordination/` | Coordinator-level failure-driven discipline accumulation (DAG-construction and wave-planning patterns, distinct from cluster-level `MEMORIAL.md`). Fillable scaffold: [`templates/COORDINATOR-MEMORIAL-TEMPLATE.md`](../templates/COORDINATOR-MEMORIAL-TEMPLATE.md). Append-only. |
| `clusters/<cluster-id>/MEMORIAL-fragment.md` | `coordination/` | Per-cluster memorial fragments, aggregated by Coordinator at wave gate |

## Relationship to existing TPM role

The existing TPM role (template:
[`templates/TPM-REPLY-TEMPLATE.md`](../templates/TPM-REPLY-TEMPLATE.md))
handles intra-cluster routing — forwarding specs from Architect to
Implementer, grilling artifacts at T1, tracking memorial state within a
coordination cycle. That role continues to operate within each cluster
unchanged.

The Coordinator is the program-level layer above all clusters. It does
not replace the TPM; it operates at a different scope. A project using
the Coordinator has:

- One Coordinator session (cross-wave, cross-cluster)
- Zero or more cluster TPM sessions (intra-cluster, per the existing
  TPM role) — the integration's automated pipeline (Mode 2)
  demonstrates that the role-and-handoff disciplines TPM handles in
  Mode 1 can be encoded into `NEXT-ROLE.md` state for autonomous
  cluster-internal operation, so a dedicated TPM session is optional
  per cluster.

## Common pitfalls

- **Coordinator reaching inside clusters.** Once a cluster is
  dispatched, the Coordinator waits for the wave gate. Intervening in
  cluster-internal decisions (retry logic, Architect amendments within
  the cluster) breaks the accountability boundary and creates
  coordination confusion.
- **Skipping the deterministic steps and going straight to Claude.**
  D1 and D2 catch the majority of real dependencies. Claude judgment
  at ambiguous boundaries is valuable; Claude judgment at obvious
  boundaries is expensive and untraceable.
- **Wave plan as a living document during execution.** The wave plan
  is fixed at dispatch time. Changes discovered during execution
  surface at the wave gate and produce a new wave plan revision, not
  an in-flight edit. Versioning: `WAVE-PLAN-01.md`, `WAVE-PLAN-02.md`, etc.
- **Treating tier classification as the Coordinator's final word.**
  The cluster self-governs its own tier. The Coordinator's
  classification is a prior, not an instruction. If the cluster's
  reading of its work unit differs from the Coordinator's
  classification, the cluster's reading governs and the discrepancy
  is logged.
- **Wave gate as a formality.** The wave gate is the program's only
  cross-cluster quality check. A rubber-stamp wave gate is worse than
  no wave gate — it creates false confidence that cross-cluster
  integration has been verified.
- **Treating the migration lock as a substitute for D5.** D5 catches
  migration ownership at planning time for zero runtime cost; the lock
  is a fallback when D5 misclassified the work unit. A Coordinator that
  routinely relies on the migration lock rather than D5 has a
  classification discipline problem and will hit lock timeouts at scale.
- **Adding arbitration mechanisms to Mode 2 work.** Lock files,
  per-track CLAUDE.md copies, and fragment merging are pure overhead in
  single-pipeline mode. The skill prescribes these mechanisms only when
  ≥2 cluster sessions run concurrently. Applying them to a
  single-cluster wave wastes operator setup time and adds failure modes
  for no benefit.

## Cost

DAG construction: 30-60 minutes for a 10-20 work unit PRD, longer for
larger scope or higher ambiguity.

Wave gate execution: 15-30 minutes per wave, scaling with number of
clusters.

Coordinator memorial maintenance: 5-10 minutes per wave gate, triggered
by failure patterns.

Recovers cost at the first prevented merge conflict from incorrect
parallelization, or the first wave gate that catches a cross-cluster
spec contradiction before it propagates.

## Origin

This skill anticipates multi-cluster execution patterns derived from
sequential build experience in the DeploySignal case study and the
subsequent remodeling/quoting tool build (the validation project where
the round-scaling rubric and tier dial were developed). The dependency
test battery (D1–D4) and tier classification rubric were derived from
observed failure patterns in those sequential builds. As with all
Anchor disciplines, each component has a birth event from a specific
failure — none is theoretical.

Multi-cluster execution is the first application of these patterns in
parallel rather than sequential form. Real-world wave-gate failure
patterns are expected to refine the rubric across early
multi-cluster projects.

## Compatibility

This skill works alongside Superpowers' `dispatching-parallel-agents`
and `using-git-worktrees` skills. The Coordinator's wave plan is the
upstream input that Superpowers' dispatch mechanism executes against.
Superpowers handles the execution primitives (worktree isolation,
subagent dispatch, two-stage review); the Coordinator handles the
program-level intelligence about what to dispatch and in what order.

Compatible with CrewAI, LangGraph, and Claude Code multi-session
workflows. The Coordinator session is platform-agnostic; the wave plan
artifact is the coordination substrate regardless of which runtime
executes the clusters.
