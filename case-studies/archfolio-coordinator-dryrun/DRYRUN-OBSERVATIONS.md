# Coordinator dry-run — observations against ArchFolio

Companion to [`WAVE-PLAN-01.md`](./WAVE-PLAN-01.md). Records the
methodology gaps surfaced by applying `skills/12-coordinator-role.md` to
ArchFolio's 22 pending rounds. The dry-run was the cheapest way to test
the skill against a real project plan before any multi-track activation.

**Date:** 2026-05-14.
**Skill version tested:** `~/anchor/skills/12-coordinator-role.md` @ canonical main `a17a28c` (post-PR #25).

---

## Headline finding

**D5 strict-form over-serializes when many work units in a domain all
touch migrations.**

skills/12 §Step 2 D5:

> "If both [work units] do [add migrations], they have a serial
> dependency regardless of file overlap — the migration history is
> linear by construction."

Applied to ArchFolio Wave 1, this forces P2.1, P1.1, P1.2, P1.5 into
4 sequential sub-waves (because all four add migrations). The
SEQUENCING-PLAN explicitly intended these as parallel-safe ("Phase 1
— Run in any order"). The conflict: **D5 conflates "linear history"
with "serial dispatch."**

Migration history is linear in the sense that filenames have a
monotonic prefix and the apply order is deterministic. It is NOT
linear in the sense that "two migrations adding entirely independent
tables must dispatch in order." Prisma (and every other modern ORM)
applies migrations in name order at deploy time; it has no problem
with two independent migrations being generated against the same base
schema and merged in either order.

The risk D5 protects against is **conflicting schema changes** —
e.g., A renames a column B then references. Two independent table
additions don't have this risk.

### Refinement proposal

D5 should fire as a serial dependency only when work units have
**actual schema-write conflict**. Test:

> **Test D5 (refined).** Does WU-A's intended migration write to a
> table, column, or constraint that WU-B's intended migration also
> writes? If yes: WU-A → WU-B (serial). If both add migrations but
> against disjoint schema surfaces, they are *contention candidates*
> (D4-like, resolved via worktree + the migration lock primitive)
> rather than strict dependencies.

This recovers Phase-1 parallelism for ArchFolio (4 clusters in Wave
1, with migration-lock arbitration handling the timestamp prefix
contention). The fallback migration lock from skills/12 §Schema
migrations is the right home for this — D5's job is then "flag the
serial cases"; the lock handles "serialize the parallel-safe cases at
file-creation time."

Severity: **methodology change required before any multi-track
activation that includes Phase-1 parallelism.** Defer until the
operator is ready to actually run multi-track; the current strict D5
is correct for sequential operation.

---

## Secondary observations

### 1. D2 surfaced zero unique edges on this PRD

D2 (AC reference) was supposed to catch dependencies where WU-B's AC
mentions WU-A's defined behavior even when no file/output is shared.
For ArchFolio, every D2-firing edge was caught earlier by D1.

This is **not a defect**. ArchFolio's PRD has explicit data-flow
language ("contract is signed" → "project record created"), so D1
catches everything. PRDs without explicit data-flow language (e.g.,
heavy interface-contract PRDs where shared behavior is the
dependency, not shared state) may surface D2-unique edges. Worth
noting in the skill that D2 is a backup test whose value varies with
PRD style.

### 2. D3 surfaced zero edges on this PRD

ArchFolio's PRD has clean module boundaries (Modules 1–8) and
explicit anti-scope. D3 found nothing to fire on. Same caveat as D2 —
D3 may be more useful on PRDs without clean module separation.

### 3. Foundation heuristic correct but threshold-sensitive

"Foundation if feeds ≥3 other WUs" catches WU-P2.1 (8 downstream)
cleanly. For larger projects, secondary nodes with 3–4 downstream
edges might over-qualify as foundations. A more discriminating
heuristic: "foundation if feeds ≥3 downstream WUs AND those
downstream WUs are in 2+ different domains/modules." WU-P2.1 passes
both (8 downstream across 3 modules: CON chain, POR chain, NOT
chain). Not urgent — flag for future refinement.

### 4. Wave 6 has 11 clusters; operationally unwieldy

The DAG correctly identifies 11 WUs as fully parallel-safe after
Phase 2 closes. But 11 concurrent Coordinator-dispatched clusters is
a real-world overload — operator review burden, log volume,
multi-track-status.json contention. A real Coordinator should
**heuristically sub-wave** large wave-N parallel sets into smaller
chunks (suggested: ≤4–5 per wave) for operational sanity.

The skill currently treats wave boundaries as deterministic from the
DAG. A "max-parallelism-per-wave" heuristic should be added — either
as a hard cap in `skills/12-coordinator-role.md` §Step 5 or as a
configurable parameter in `coordination/multi-track-config.json`
(referenced in the arbitration section as a future extension).

### 5. The "in flight" round is hard to represent

WU-P1.4 (FR-ACC-05, R39 currently running on the project's serial
pipeline) sits awkwardly in a dry-run wave plan. It's neither
"completed" nor "to be dispatched" — it's already mid-execution
outside the wave plan's authority. The skill doesn't address how a
Coordinator picks up a project mid-stride (i.e., starts coordinating
when some rounds have already shipped serially).

This isn't relevant for new-project Coordinator dispatch but matters
for "convert a serial project to multi-track partway through." A note
in skills/12 §Coordinator scope clarifying "Coordinator assumes a
clean start; mid-project conversion requires a separate transition
protocol (TBD)" would close this ambiguity.

---

## What worked well

- **Step 1 (work unit extraction) collapses naturally to existing
  SEQUENCING-PLAN rounds.** No re-decomposition needed; the PM's
  round groupings ARE the work units. Confirms the skill's "deterministic
  extraction from PRD structure" promise.
- **D1 alone catches the vast majority of edges.** 13 of 13 unique
  edges in ArchFolio came from D1. D5 found 8 migration WUs; D4 found
  3 contention groups. Step 2 produces high-signal output on the first
  pass.
- **Foundation identification correctly named P2.1.** The "feeds ≥3
  others" rule cleanly distinguishes P2.1 from non-foundations even
  before pruning by domain count.
- **Tier classification priors from SEQUENCING-PLAN held up under the
  skill's A/S/Z rubric in every case.** No re-classification needed.
- **Pre-emit grilling caught the D5 over-serialization issue.** The
  grilling checkbox "no unstated assumptions" forced the question —
  proving the discipline is doing its job at the dry-run layer too.

---

## Recommended methodology actions

In priority order (urgency):

1. **Refine D5** (headline finding) — distinguish "migration history
   is linear" from "migration dispatch must be serial." Update
   skills/12 §Step 2 + §Schema migrations to align. Defer until
   multi-track activation is imminent.
2. **Add max-parallelism-per-wave heuristic** to §Step 5. Cap default
   at 5; configurable per project. Closes the Wave 6 problem cheaply.
3. **Clarify mid-project conversion** in §Coordinator scope. One
   sentence. "Coordinator assumes a clean start" is the right
   default; explicit out-of-scope close.
4. **Note D2/D3 are backup tests** whose value varies with PRD style.
   One sentence in §Step 2 preamble. Avoids future Coordinators
   wondering why D2/D3 fire so rarely.
5. **Refine foundation heuristic** with the "feeds ≥3 across 2+
   domains" tightening. Not urgent — current rule works for
   ArchFolio. Promote when a project surfaces a false-positive
   foundation.

(1) is methodology-blocking. (2)–(5) are quality refinements;
batchable into one follow-up canonical PR.

---

## Process notes

- Dry-run wall time: ~30 minutes (read PRD + sequencing plan, apply
  Step 1–5, draft both files).
- Output deliverable: `WAVE-PLAN-01.md` (a real Coordinator artifact
  shape, populated as a real session would) +
  `DRYRUN-OBSERVATIONS.md` (this file).
- Zero modifications to ArchFolio. Read-only access throughout.
- Canonical methodology unchanged by the dry-run itself; the
  recommended actions above land via separate canonical PRs when the
  operator chooses to act on them.
