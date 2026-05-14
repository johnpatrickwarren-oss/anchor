# Multi-track parallelism — design notes

**Status: CONSOLIDATED.** The recommendations from these notes have
been merged into the canonical Coordinator skill at
[`../../skills/12-coordinator-role.md`](../../skills/12-coordinator-role.md)
under the new **"Shared-resource arbitration in multi-track mode"**
section plus the **D5 dependency test** addition to Step 2. These
notes are preserved as the design-decision audit trail; consult them
to understand *why* the canonical skill is shaped as it is.

Date consolidated: 2026-05-14.

---

## Notes

| Note | Topic | Recommendation in note | Where it lives in canonical |
|---|---|---|---|
| [01](./01-memorial-concurrency.md) | Memorial concurrency | Option D (Memorial-Updater serialization) + Option B (per-project shards for cross-project) | skills/12 §Shared-resource arbitration → Memorial state |
| [02](./02-schema-migration-ordering.md) | Schema migration ordering | Option C (Coordinator D5 dependency test) + Option B (migration lock fallback) | skills/12 Step 2 D5 + §Shared-resource arbitration → Schema migrations |

---

## Open-question resolutions

The 8 open questions from notes 01 and 02 were resolved against
best-practice design and implementation guidelines on 2026-05-14 and
baked into the canonical skill. Resolutions:

| OQ | Question | Resolution | Rationale |
|---|---|---|---|
| OQ-1 | Queue implementation: lock file + poll loop, or daemon? | **Lock file + `flock(2)` + 5-sec poll loop.** No daemon. | Smallest operational surface for single-machine single-operator use; well-understood POSIX primitive; no start/stop scripts or crash-recovery infrastructure needed. |
| OQ-2 | Cross-project memorial freshness: weekly merge or live? | **Weekly batched merge** via operator-invoked script. | Cross-project memorial is advisory context for Architect/Reviewer reads, not load-bearing per-round state. Stale-by-days is acceptable; live would require shared daemon. |
| OQ-3 | Memorial-Updater queue depth warning threshold | **Wait-time threshold, not depth threshold.** Warn at 2× median hold time (memorial ~10 min, migration ~3 min); halt new dispatches at 2× the per-resource timeout. | Queue depth is a lagging indicator; wait time is the leading indicator. Aligned with standard SRE practice (alert on latency, not queue length). |
| OQ-4 | CLAUDE.md re-stamping: per-track files or serialized stamp? | **Per-track stamped copies** at `coordination/clusters/<cluster-id>/CLAUDE.md`. Canonical CLAUDE.md never stamped. Reinforcement appends to canonical serialized via memorial lock. | Per-session role/round is per-session state. Serializing the stamp creates contention on every session start; per-track copies eliminate it. The canonical file holds only durable content (methodology + reinforcements). |
| OQ-5 | Coordinator D5: deterministic or judgment-call? | **Deterministic.** D5 fires when WU's file-tree-scope intersects a project-configured migration directory. | Consistent with D1/D2 (deterministic) over D3 (judgment). Migration ownership is grep-able from PRD; no need for Claude judgment in the common case. |
| OQ-6 | Migration lock granularity: per-project or per-database? | **Per-project default, per-database opt-in** via `coordination/multi-track-config.json`. | Single-DB is the common case (ArchFolio, DeploySignal). Multi-DB projects opt in. Methodology defaults to the simpler case. |
| OQ-7 | Stuck migration lock timeout | **10 min default, configurable per project.** On timeout, abort the lock-holding cluster with diagnostic; operator signaled. | 10 min tolerates the laptop-sleep failure mode while still catching genuinely stuck processes. Configurable for projects with legitimately slow migrations (large data backfills). |
| OQ-8 | ORM portability | **Generalize.** D5 and migration lock reference a project-configured migration-directory path with convention fallback (`prisma/migrations/`, `db/migrate/`, `migrations/`, `supabase/migrations/`). | Anchor is methodology-layer, not Prisma-specific. Convention-with-override matches every modern ORM's migration directory placement. |

---

## Convergent design observation (now reflected in canonical)

Both notes independently converged on **narrow serialization points
within an otherwise parallel cycle, owned by the Coordinator**. The
canonical skill formalizes this as the structural principle for
`Shared-resource arbitration`:

> Tracks execute independently; the Coordinator coordinates only the
> moments where they cannot.

The principle generalizes beyond memorial and migrations: any future
shared-resource discovery (e.g., per-environment secrets, shared test
DB state, build cache locks) extends this section rather than
scattering arbitration across multiple skills.

---

## Implementation followups (not methodology — integration layer)

The canonical skill specifies *what* arbitration must do. The
following implementation pieces are integration-layer work, tracked
separately from the methodology change:

- `~/anchor/integrations/superpowers-claude-code/run-pipeline.sh` —
  add stale-lock pre-flight; per-track CLAUDE.md stamping; multi-track
  dispatch flag (off by default).
- `~/anchor/integrations/superpowers-claude-code/merge-cross-project-memorial.sh` —
  new script for weekly cross-project shard merge.
- `coordination/multi-track-config.json` schema definition — declares
  migration directory, per-database lock opt-in, timeout overrides.
- Per-project `.gitignore` updates — exclude `coordination/clusters/`
  and `coordination/multi-track-status.json` from version control.

These are concrete next steps when the operator decides to enable
multi-track on the first project. None block the canonical methodology
change from landing in `~/anchor/`.

---

## Originally-planned-but-not-written notes

The README previously listed three more design notes as planned. The
canonical skill now absorbs their content directly, so these notes
are not needed:

- ~~`03-claude-md-stamping-under-parallelism.md`~~ — covered in skills/12 §Shared-resource arbitration → CLAUDE.md role/round stamping.
- ~~`04-coordinator-wave-gate-vs-track-gate.md`~~ — covered in skills/12 §Wave gate discipline + §Shared-resource arbitration.
- ~~`05-when-not-to-parallelize.md`~~ — covered in skills/12 §Shared-resource arbitration → When NOT to apply.
