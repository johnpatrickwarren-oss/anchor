# Multi-track parallelism — design note 02

## Schema migration ordering under parallel tracks

**Status:** Draft. Operator review required before any canonical change.
**Date:** 2026-05-14.
**Foundation:** Builds on `01-memorial-concurrency.md`.

---

## Problem statement

Most modern ORMs (Prisma, Rails, Django, Knex, Drizzle, Diesel) maintain
a **linear migration history**. Each migration file is named with a
monotonic timestamp prefix; applying them in name order produces the
canonical schema. The migration history is a single source of truth
that all branches eventually reconcile against.

Multi-track parallelism breaks the "all branches reconcile" assumption
during the parallel window. Two tracks each producing a migration in
the same wall-clock minute generates two migration files with the same
or near-equal timestamp prefix:

```
prisma/migrations/
  20260514_103000_track_A_add_contract_table/
  20260514_103015_track_B_add_supplier_table/
```

If track A merges first, the canonical history contains its migration.
Track B's migration was generated against the pre-A schema state, so:

1. Its timestamp prefix may now be *behind* the canonical head (if A's
   was later). Most ORMs accept this — they apply by filename order
   regardless of when the file was created.
2. **Its `migration.sql` was authored against the pre-A schema.** If A
   modified any table B also touches (e.g., A renames a column B's
   migration references), B's migration won't apply cleanly.
3. Even if the SQL is independent, the **Prisma `_prisma_migrations`
   row order** may diverge from filename order, producing checksum
   mismatches at deploy time.

This is not a parallelism-specific problem — it's a long-known
distributed-VCS schema problem. Teams handle it via merge-time
re-baselining. The question for Anchor methodology is: **at what role
boundary does the re-baseline happen, and how does it interact with
the four-role cycle?**

---

## Resource at risk

Per-project, only one resource is at risk: the `prisma/migrations/`
directory (or equivalent for other ORMs). Each parallel track adds
zero or more migrations during its Implementer phase. The reconciliation
happens when tracks merge back to the canonical main branch.

---

## Design alternatives

### Option A — Re-baseline at merge

Each track works on its own branch. When a track is ready to merge, its
Reviewer (or a new role) re-runs migration generation against the
current main-branch schema state, regenerating the migration files with
fresh timestamps and conflict-free SQL. The original migration files
are discarded.

**Pros:**
- Standard team-development pattern. Well-understood by humans.
- No methodology-layer infrastructure beyond "Reviewer must re-baseline."

**Cons:**
- Implementer wrote tests against the original migration's schema. If
  re-baselined SQL produces a different state, tests may break in ways
  the Implementer didn't anticipate.
- Re-baselining is a manual judgment call. Hard to automate;
  hard to encode as a discipline.
- The original migration's commit SHA (which Memorial-Updater records)
  no longer exists. SHA-A attestation invariant breaks.

### Option B — Serialize the migration step within parallel rounds

Tracks run Architect, Implementer (test-only), and Reviewer in parallel.
But the moment a track's Implementer needs to generate a migration, it
takes a project-wide lock. The migration generation step is serialized
across all tracks; everything else (code edits, test writing, review)
proceeds in parallel.

**Pros:**
- Migration history stays linear by construction. No re-baseline.
- Lock contention is low — migration generation is typically a single
  command (`prisma migrate dev --create-only --name <X>`) that takes
  seconds, not minutes.
- Compatible with the Memorial-Updater serialization from note 01 —
  both are "narrow serialization point in an otherwise parallel cycle."

**Cons:**
- A track holding the migration lock blocks others' migration
  generation. If two tracks both need migrations and they have a
  dependency (B's SQL references A's new table), B must wait for A's
  migration commit to land on main before generating its own. This is
  the same problem as Option A in disguise — re-baselining is still
  needed when migrations are not commutative.
- Operator workflow: "I started two tracks at 10am; track B's
  Implementer paused waiting for track A's migration to land" is
  surprising.

### Option C — Coordinator pre-classifies migration-touching rounds

The Coordinator role (already in `skills/12-coordinator-role.md`)
performs DAG construction at wave planning time. Add a D5 dependency
test:

> **D5 (migration ownership):** If two work units both add or modify
> Prisma migrations, they are sequentially dependent regardless of file
> overlap. The one with the earlier intended schema lands first.

Work units touching migrations are then placed in different waves.
Within a wave, no two clusters can generate migrations. Cross-wave
parallelism is preserved; intra-wave parallelism on migrations is
forbidden.

**Pros:**
- Solves the problem at the planning layer (Coordinator) rather than the
  execution layer. Cleaner separation of concerns.
- Reuses existing wave-gate discipline — wave N+1 only dispatches after
  wave N's migrations have landed.
- No re-baselining; no migration lock.

**Cons:**
- Heavily reduces achievable parallelism. Most rounds in archfolio's
  Phase 2 touch the schema (contract chain). Under D5, Phase 2 would
  serialize back to fully linear. The expected speedup over current
  sequential execution may be small.
- Requires Coordinator to know which rounds touch migrations at plan
  time. The PRD usually does name migrations explicitly, so this is
  inferable, but the Coordinator needs the discipline.

### Option D — Single-migration-per-round invariant + ordering tag

Each round produces at most one migration. The Coordinator stamps each
parallel track with an `intended-migration-order: <N>` tag at dispatch
time. When a track's Implementer creates a migration, the timestamp
prefix uses the tag, not wall-clock time:

```
prisma/migrations/
  20260514_track_T01_add_contract_table/      (intended-order 1)
  20260514_track_T02_add_supplier_table/      (intended-order 2)
```

When tracks merge, the timestamp prefix already encodes the canonical
order. Migrations land in tag order regardless of merge time. If track
T02's SQL was authored against pre-T01 state, the conflict is detected
at apply time (Prisma fails to apply T02 because T01's columns are
expected to exist) and the operator re-baselines just T02.

**Pros:**
- Combines benefits of A and C. Cheap parallelism for independent
  migrations (the common case); operator-detected re-baseline only when
  migrations are actually conflicting (the rare case).
- Coordinator's existing D1–D4 dependency tests catch most conflict
  cases at plan time. D5 narrows the unflagged cases further.

**Cons:**
- Custom timestamp scheme deviates from Prisma's default. Affects
  tooling expectations (CI scripts, dev environments).
- Still requires operator-detection of conflicts at merge time. Some
  ergonomic loss vs. fully automatic.

---

## Recommendation

**C, with B as fallback for unflagged migration conflicts.**

Option C uses the Coordinator role as the policy layer — which is its
designed purpose. The achievable parallelism reduction is real but
acceptable: most archfolio Phase 2 rounds are sequential by domain
dependency anyway (estimate→contract→signed→project is a chain), so
the D5 constraint costs little there. Phase 1 and Phase 3 rounds, where
parallelism actually pays off, mostly touch independent feature areas
with little migration overlap.

Option B fills the gap when the Coordinator's D5 classification was
wrong — a wave dispatches with two migration-touching clusters that
the Coordinator missed. The migration lock catches the second one
before it can corrupt the history.

Options A and D are operator-judgment-heavy; the methodology's
principle has been to encode load-bearing rules as deterministic
checkpoints rather than judgment calls. C+B fit that principle better.

---

## Open questions for operator

- **OQ-5: Coordinator D5 discipline.** Should D5 be added to
  `skills/12-coordinator-role.md` as a deterministic test, or left as
  a Claude-judgment-at-Step-3 concern? D1–D4 are deterministic;
  consistency argues for deterministic D5.
- **OQ-6: Migration lock granularity.** Per-project, or per-database
  within a project (some projects have multiple Prisma schemas /
  databases)? Default: per-project, since archfolio is single-DB.
- **OQ-7: Migration lock failure handling.** If a track has held the
  lock for >N minutes (suggested: 10), should the dispatcher abort
  and signal the operator? Stuck-Implementer detection within the
  migration step is a known failure mode (the laptop-sleep pattern
  from R03/R06/R08/R10/R12/R15/R31/R37).
- **OQ-8: ORM portability.** Anchor is methodology-layer, not
  Prisma-specific. Are there projects in the operator's pipeline that
  use Rails / Django / Drizzle migrations where the design needs to
  generalize? If so, the "Coordinator D5" formulation should be
  "migration history file" not "Prisma migration directory."

---

## Cross-reference

This design intersects `01-memorial-concurrency.md` on a structural
note: **both rely on narrow serialization points within an otherwise
parallel cycle** (Memorial-Updater dispatch from 01; migration
generation from this note). The Coordinator role becomes the natural
home for both serialization disciplines, since it already owns
DAG construction and wave gating.

If the operator accepts the recommendation from both notes, the
methodology change is:

- `skills/12-coordinator-role.md` gains:
  - **D5 (migration-ownership) dependency test.**
  - **Memorial-Updater dispatch serialization step** at wave gate.
- `skills/02-memorial-accretion.md` gains:
  - **Note on multi-track-safe append discipline** (referencing the
    Coordinator serialization point).
- Templates `WAVE-PLAN-TEMPLATE.md` and `WAVE-GATE-TEMPLATE.md` add
  rows for D5 classifications and migration-lock status.
