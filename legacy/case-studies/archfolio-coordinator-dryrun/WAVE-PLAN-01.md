# WAVE-PLAN-01 — Wave Plan v1: ArchFolio (Coordinator dry-run)

_Dry-run application of `skills/12-coordinator-role.md` against ArchFolio's
remaining sequencing plan. **Not a real Coordinator artifact** — produced
as case-study evidence to validate the skill against a real project plan
before any multi-track activation. Companion file:
[`DRYRUN-OBSERVATIONS.md`](./DRYRUN-OBSERVATIONS.md) records gaps surfaced._

**From:** Coordinator dry-run (Opus 4.7)
**Date:** 2026-05-14
**Source PRD:** `~/projects/archfolio/coordination/PRD.md` @ SHA `9529df4`
**Source sequencing:** `~/projects/archfolio/coordination/SEQUENCING-PLAN.md` (authored 2026-05-13)
**Version:** v1 (initial dry-run)

---

## Plan summary

22 work units extracted (matches the 22 pending rounds in
SEQUENCING-PLAN, minus R39 = P1.4 currently in flight on the project's
serial pipeline). 6 waves with 1 foundation (P2.1, the new Contract
entity feeding 8 downstream WUs).

| Wave | Cluster count | Foundation? | Notes |
|---|---|---|---|
| 1 | 4 | Yes — P2.1 | P2.1 + 3 Phase-1 rounds (P1.1, P1.2, P1.5). All four touch migrations — see D5 finding in observations. |
| 2 | 1 | No | P2.2 (clause editing) — depends on P2.1 |
| 3 | 1 | No | P2.3 (secure link + e-sig) — depends on P2.1 |
| 4 | 1 | No | P2.4 (signed PDF + status tracking) — depends on P2.3 |
| 5 | 4 | No | P2.5, P2.6, P2.7, P2.8 (Phase-2 fan-out after P2.4) |
| 6 | 11 | No (integration / extension) | Phases 3 + 4 (P3.1–P3.7, P4.1–P4.4) — mostly independent extensions |

---

## Step 1 — Work unit extraction (deterministic)

22 work units, 1:1 with SEQUENCING-PLAN rounds. Each round in
SEQUENCING-PLAN already represents one or more bundled FRs from the PRD;
the dry-run inherits the PM's bundling rather than re-deriving from
scratch. Bundling choices verified against PRD §3 Module Requirements
— all bundles cohere (same module + same feature flow).

Table elided for brevity — see SEQUENCING-PLAN.md for the canonical
list. Sample:

| WU ID | Source rounds | PRD FRs | File tree scope |
|---|---|---|---|
| WU-P1.1 | P1.1 | FR-POR-02, FR-POR-04 | src/app/admin/projects/, prisma/schema.prisma (Project completion + visibility fields) |
| WU-P2.1 | P2.1 | FR-CON-01, FR-CON-02 | src/app/admin/contracts/, src/lib/contract-actions.ts, prisma/schema.prisma (new Contract model + base template content) |
| WU-P2.6 | P2.6 | FR-POR-01 | src/lib/contract-actions.ts (sign handler emits project create), src/app/admin/projects/ |

(Full WU table omitted — adds bulk without surfacing methodology
information. The exercise's value is in Step 2 + observations.)

---

## Step 2 — Dependency edge identification (deterministic)

Edges discovered via D1–D5 applied to the 22 WUs. Cross-domain
WU-WU pairs (e.g., P1.1 vs P3.4) skipped where neither test could
plausibly fire — focused enumeration on within-module and
contract-chain pairs.

### D1 (shared output ownership) — HIGH confidence

| Source | Target | Reasoning |
|---|---|---|
| WU-P2.1 | WU-P2.2 | P2.2 edits clauses defined in P2.1's contract template |
| WU-P2.1 | WU-P2.3 | P2.3 delivers contract link; needs Contract entity from P2.1 |
| WU-P2.1 | WU-P2.7 | P2.7 notifications reference contract send events from P2.1 |
| WU-P2.1 | WU-P4.3 | P4.3 milestone reminders read payment schedule defined in P2.1 base template |
| WU-P2.3 | WU-P2.4 | P2.4 signed PDF + status tracking depend on e-sig capture from P2.3 |
| WU-P2.4 | WU-P2.5 | P2.5 mobile contract view extends signed-contract status surface |
| WU-P2.4 | WU-P2.6 | P2.6 auto project record on contract sign needs Signed status from P2.4 |
| WU-P2.4 | WU-P3.2 | P3.2 signed contract PDF export extends P2.4's signed PDF infra |
| WU-P2.4 | WU-P3.6 | P3.6 change orders extend contract status chain |
| WU-P2.4 | WU-P4.2 | P4.2 client milestone status view reads signed contract |
| WU-P1.5 | WU-P3.3 | P3.3 CSV import targets manual price list defined in P1.5 |
| WU-P3.4 | WU-P3.5 | P3.5 live-vs-cached display + snapshot need supplier catalog API |
| WU-P3.4 | WU-P4.1 | P4.1 price-change alerts read catalog API |

### D2 (AC reference) — HIGH confidence

No unique edges surfaced. Every D2-firing edge was also caught by D1
upstream — D1 dominates for this PRD's structure. _Observation: D2
may be a backup test for PRDs where AC text references behaviors
without explicit output sharing._

### D3 (anti-scope boundary adjacency)

Zero edges flagged. ArchFolio's PRD has clean module boundaries
(Module 1–8) with explicit anti-scope at the PRD level. _Observation:
D3 may be more useful for PRDs that don't enforce strict module
separation._

### D4 (file tree overlap) — contention risks (not strict deps)

| WUs | Shared files | Resolution |
|---|---|---|
| All Phase-2 WUs | `src/lib/contract-actions.ts`, `prisma/schema.prisma` | Phase-2 sequenced by D1; worktree isolation not needed |
| P1.1, P1.2 | `src/app/admin/projects/`, `prisma/schema.prisma` | Worktree isolation safe — different fields on Project |
| P3.1, P3.2, P3.3 | `src/lib/export-utils.ts` (anticipated) | Worktree isolation safe — independent export formats |

### D5 (migration ownership) — HIGH confidence

D5 fires for WUs touching `prisma/migrations/`:

| WU | Migration evidence |
|---|---|
| WU-P1.1 | Adds Project.completedAt, Project.visibility fields |
| WU-P1.2 | Adds Photo table (or extends existing Image table) |
| WU-P1.5 | Adds PriceListItem table |
| WU-P2.1 | Adds Contract table + ContractTemplate scaffolding |
| WU-P2.4 | Adds ContractStatus enum / status field on Contract |
| WU-P2.6 | Adds Project.contractId FK |
| WU-P3.6 | Adds ChangeOrder table |
| WU-P4.4 | Adds ApiKey table for read-only API auth |

**Strict D5 application says:** these 8 WUs must each land in a
separate wave, because the skill says "migration-touching work units
in different waves." That produces 8 sequential waves just for
migration work, eliminating much of the parallelism benefit. See
DRYRUN-OBSERVATIONS.md §1 for the methodology refinement this
suggests.

---

## Step 3 — Claude judgment at ambiguity boundaries

One judgment call surfaced:

**Ambiguity:** WU-P3.7 (client revision request → builder email)
references "the quote view." Does it extend WU-P2.8 (client polish on
quote view) or operate independently of it?

- **Parallel:** P3.7 adds a new affordance (revision request button)
  to the existing quote view; doesn't require P2.8's polish.
- **Sequential:** P2.8 → P3.7 if P2.8 restructures the quote view in
  ways that would conflict with P3.7's UI placement.

**Claude's judgment:** Parallel. P2.8 ACs are described as "polish"
not "restructure" — additive cross-surface improvements. P3.7 adds an
independent UI element that doesn't depend on P2.8's choices.

**Resulting edge:** confirmed independent.

---

## Step 4 — DAG validation

- [x] **Cycle check.** No cycles.
- [x] **Island check.** Three islands: WU-P1.4 (in flight), WU-P3.7
      (revision request), WU-P4.4 (REST API). All have no edges in or
      out among the remaining WUs — they extend prior infrastructure
      directly.
- [x] **Foundation identification.** WU-P2.1 feeds 8 other WUs →
      foundation, must land in Wave 1. No other WU feeds ≥3 others.

---

## Step 5 — Wave sequencing

| Wave | Work units | Rationale |
|---|---|---|
| 1 | WU-P2.1, WU-P1.1, WU-P1.2, WU-P1.5 | P2.1 is foundation; P1.* are Phase-1 islands with no upstream deps within remaining scope |
| 2 | WU-P2.2 | All edges resolved by Wave 1 (P2.1 only upstream) |
| 3 | WU-P2.3 | P2.2 not on path; P2.3 depends on P2.1 |
| 4 | WU-P2.4 | P2.3 upstream |
| 5 | WU-P2.5, WU-P2.6, WU-P2.7, WU-P2.8 | All P2.* fan-out after P2.4 / P2.1 ready |
| 6 | WU-P3.1, WU-P3.2, WU-P3.3, WU-P3.4, WU-P3.5, WU-P3.6, WU-P3.7, WU-P4.1, WU-P4.2, WU-P4.3, WU-P4.4 | Phase 3 + 4 extensions; intra-wave parallelism via D4 worktree isolation |

**Wave 1 contention:** all 4 clusters touch migrations (D5 fires
4-way). Under strict D5, this isn't a single wave — it's 4 sequential
waves. See observations.

**Wave 6 size:** 11 clusters in a single wave is operationally
unwieldy. A real Coordinator session would likely split this into 2–3
sub-waves for execution sanity, even though strict DAG analysis
allows full parallelism.

---

## Step 6 — Tier classifications (Coordinator priors)

Tier priors match SEQUENCING-PLAN exactly. 3 `full` (P2.1, P3.4, P4.4),
19 `audit`, 0 `solo`. A-factor / S-factor reasoning in SEQUENCING-PLAN
holds up against `skills/11-round-scaling.md` rubric.

No discrepancies recorded — but no cluster has self-assessed yet
either (this is a dry-run, no cluster sessions ran).

---

## Pre-emit grilling

- [x] **Every dependency edge is verifiable.** D1 edges cite specific
      AC + interface evidence; D5 edges cite specific schema changes.
- [x] **No unstated assumptions.** Two assumptions surfaced and
      flagged: (a) WU-P3.7 independence from WU-P2.8 (handled in Step
      3); (b) D5 strict-form parallelism cost (handled in observations).
- [x] **No scope added beyond PRD/sequencing.** All WUs map to
      SEQUENCING-PLAN rounds.
- [x] **DAG is acyclic.** Verified.
- [x] **Tier priors defensible.** Match SEQUENCING-PLAN.
- [ ] **Foundation correctness.** WU-P2.1 IS a foundation, but the
      "feeds ≥3 others" heuristic is satisfied by some non-foundations
      too in larger projects. Threshold may need refinement — see
      observations.

---

## Wave 1 dispatch authorization

**Plan verdict:** HOLD pending resolution of D5 strict-form question
(see DRYRUN-OBSERVATIONS.md §1). The current skill's prescription
forces 4-way wave splitting for ArchFolio's Wave 1, eliminating most
of the parallelism benefit Phase 1 was designed to enable.

If the operator chooses to dispatch Wave 1 under the current strict
D5, the wave sequencing collapses to:

| Wave | WUs (under strict D5) |
|---|---|
| 1a | WU-P2.1 |
| 1b | WU-P1.1 |
| 1c | WU-P1.2 |
| 1d | WU-P1.5 |
| 2 | WU-P2.2 |
| ... | ... |

Total wave count goes from 6 → 9 with no parallel migration work.
Phase 2 (already serial) is unaffected.

---

## Version history

| Version | Date | Trigger | What changed |
|---|---|---|---|
| v1 | 2026-05-14 | Initial dry-run | Initial extraction + DAG + wave sequencing |
