# Multi-track parallelism — design note 01

## Memorial concurrency: protecting append-only state under parallel tracks

**Status:** Draft. Operator review required before any canonical change.
**Date:** 2026-05-14.
**Foundation:** `~/.claude/projects/-Users-johnwarren/memory/project_anchor_parallelism_evolution.md`.

---

## Problem statement

Anchor's current pipeline is single-tenant per project. A round runs the
four-role cycle (Architect → Implementer → Reviewer → Memorial-Updater)
sequentially. Memorial-Updater is the only role that writes to shared
memorial state. Because rounds are serial, write contention is
impossible by construction.

Multi-track parallelism breaks that invariant. Two concurrent tracks
running on the same project produce two concurrent Memorial-Updater
sessions, both appending to shared memorial state at round close. The
shared resources are:

1. **`coordination/MEMORIAL.md`** — project-local, append-only log of
   CONFIRMATION / VIOLATION entries with role + round attribution.
   Every Memorial-Updater session appends here.
2. **`~/.claude/CROSS-PROJECT-MEMORIAL.md`** — operator-global,
   append-only with project prefix. Every Memorial-Updater session in
   every project appends here. Already at 211k chars and growing.
3. **`coordination/COORDINATOR-MEMORIAL.md`** (when present, per
   `skills/12-coordinator-role.md`) — wave-gate-level memorial,
   appended at every wave gate by the Coordinator.
4. **`CLAUDE.md`** reinforcement section — Memorial-Updater appends
   `# REINFORCED <date> — <rule>` lines under role blocks for each
   violation of the round. Concurrent appends here also race.

A naive two-track launch produces silent data loss the first time two
Memorial-Updaters finish close enough in time that one's read happens
before the other's write. The risk is not theoretical — pipeline run
times overlap routinely (R37 = 13 min, R38 = 25 min, with operator
sometimes queuing the next round during the prior round's review).

---

## Design alternatives

### Option A — Single-file locking (advisory lock per file)

Each writer takes an OS-level advisory lock (`flock(2)`) on the target
file before reading-then-appending. Releases on commit. Readers without
locks see the file at the last fsynced state.

**Pros:**
- Smallest change surface: each shared file gets a lock-wrapped append
  helper; no schema change to memorial format.
- Operates correctly on local APFS; flock semantics are POSIX-stable.
- Compatible with existing append-only invariant.

**Cons:**
- Cross-project memorial spans projects; the lock contention is global
  across every concurrent Memorial-Updater in every Anchor project.
  Lock waits can be long (a 30-second Memorial-Updater session is not
  unusual). Tail latency goes up.
- Lock leaks on crash require recovery discipline (stale-lock cleanup).
- macOS `flock` over network-mounted file systems (iCloud Drive,
  Dropbox) is unreliable. Cross-machine setups would corrupt silently.

### Option B — Per-track shards + merge protocol

Each track gets its own memorial files:
- `coordination/MEMORIAL.<track-id>.md` — track-local writes.
- A merge step at round-complete (or post-wave-gate at Coordinator
  level) folds shards back into the canonical `coordination/MEMORIAL.md`
  via deterministic ordering (timestamp + role + round).

**Pros:**
- No write contention by construction. Each shard is single-writer.
- Survives network-mounted file systems.
- Failures isolated to one track; other tracks unaffected.

**Cons:**
- Merge protocol is a new methodology surface. Needs a discipline of
  its own (Memorial-Merge role? sub-step of Memorial-Updater? Coordinator
  responsibility?).
- Cross-project memorial still needs solving — sharding it per-project
  defeats its cross-project purpose. Probably still needs Option A
  for the global file.
- Reviewer reading shards must understand the merge contract; cold-read
  invariant gets harder.

### Option C — Line-level append via single-shot atomic write

Use `O_APPEND` writes (atomic up to PIPE_BUF = 512 bytes on POSIX) so
each appended line is delivered atomically without locks. Format each
memorial entry as a single line; reject multi-line entries.

**Pros:**
- Zero coordination overhead. Truly lock-free.
- Trivially scales across projects.

**Cons:**
- 512-byte line limit is too small. A typical reinforcement is 600–1200
  chars (the existing CLAUDE.md reinforcements average ~800 chars). Doesn't fit.
- Breaks down on tmpfs / network FS / Linux ≥4k blocksize variations.
- Doesn't solve the read-modify-write case (e.g., updating
  `## Reinforcement rules derived` sections at the bottom of memorial
  files, which the methodology requires for 3+ violation thresholds).

### Option D — Memorial-Updater as cross-track serialization point

Keep parallel rounds but funnel all Memorial-Updater work through a
single serialized queue. Each track's Implementer + Reviewer run in
parallel; when a track's Reviewer emits MERGE-READY, the round's
Memorial-Updater session enqueues against a global lock and runs
serially. The Memorial-Updater session is short (typically 3–5 min);
queue depth stays bounded.

**Pros:**
- Preserves single-writer invariant for ALL memorial state with one
  serialization point.
- No schema change. No merge protocol. No per-file locks.
- Compatible with the existing four-role cycle — only the dispatch
  changes.
- Failure of one Memorial-Updater doesn't block other tracks' Reviewer
  output (only their own memorial flush).

**Cons:**
- Memorial-Updater becomes the parallelism bottleneck. Per-round
  latency bound = Memorial-Updater throughput. Tracks pile up if
  Memorial-Updater is slow.
- Doesn't help if Memorial-Updater itself is the hot path (it usually
  isn't, but the bound is real).
- Operator UX: tracks appear "done" at Reviewer time but then sit in
  the Memorial queue. Need clear queue status reporting.

---

## Recommendation

**D, with a fallback to B for cross-project memorial.**

Memorial-Updater serialization (D) solves project-local and CLAUDE.md
appends cleanly with no schema change. It preserves the methodology's
existing semantics (Memorial-Updater is the single authority over
memorial state) and adds one piece of infrastructure (the serialization
queue) rather than a new write protocol.

For the cross-project memorial specifically, queueing across projects
adds operator complexity (need a daemon or shared queue). Option B —
per-project shards merged into the cross-project file at a later
operator-driven step (perhaps weekly) — keeps each project's write path
single-writer without requiring a shared daemon. The freshness of the
cross-project memorial degrades from "real-time" to "weekly batched."
Acceptable trade: the cross-project memorial is read by Architects and
Reviewers as advisory context, not as load-bearing per-round state.

---

## Open questions for operator

- **OQ-1: Queue implementation.** A lock file in `~/.claude/` + a
  poll-and-acquire helper? Or a small persistent daemon? The simplest
  thing that works: lock file with `flock` and a 5-second poll loop.
  Operator preference?
- **OQ-2: Cross-project freshness target.** Is "weekly merge of
  per-project memorial shards into the cross-project file" acceptable,
  or does the cross-project memorial need to be live?
- **OQ-3: Memorial-Updater latency bound.** What's the maximum
  acceptable queue depth before the operator wants a warning? Suggest:
  3 tracks waiting → warn, 5 → halt new dispatches.
- **OQ-4: CLAUDE.md re-stamping.** `run-pipeline.sh` stamps role/round
  at session start. Under parallel tracks, two pipelines stamping
  concurrently produces an undefined state. Does the stamp need to move
  to a per-track CLAUDE-T<N>.md, or does the parallelism dispatcher
  need to serialize the stamp specifically?

---

## Next design notes (planned)

- `02-schema-migration-ordering.md` — Prisma's linear migration history
  vs. parallel tracks producing new migrations.
- `03-claude-md-stamping-under-parallelism.md` — OQ-4 expanded.
- `04-coordinator-wave-gate-vs-track-gate.md` — relationship between
  single-track multi-cluster waves (already designed in
  `skills/12-coordinator-role.md`) and the multi-track layer above it.
