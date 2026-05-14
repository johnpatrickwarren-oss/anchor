# Multi-Track Anchor — Operator Runbook (MVP)

Operator-facing step-by-step for running an Anchor wave with multiple
parallel cluster sessions. Covers Wave 1 dispatch, in-flight monitoring,
wave-gate aggregation, and advancing to the next wave.

**Status:** MVP. The methodology disciplines from
[`skills/12-coordinator-role.md`](../../skills/12-coordinator-role.md) are
honored, but execution is operator-orchestrated rather than fully
automated. The runtime pieces — fully automated WAVE-PLAN parsing,
in-script lock primitives, automated wave-gate aggregation — are
deferred to a follow-up PR. This runbook + the two helper scripts
unlock multi-track today without rewriting `run-pipeline.sh`.

**Honest tradeoffs of the MVP:**
- The operator opens N Claude Code sessions manually (one per cluster
  in the wave). Future automation will spawn these headlessly.
- Wave-gate aggregation uses standard `git merge` rather than a
  bespoke aggregator. The verification script catches mistakes.
- The migration lock from skills/12 is not implemented. For ArchFolio's
  Wave 1 (4 disjoint-schema migrations), this is empirically fine —
  each worktree generates its own migration file with a distinct
  wall-clock timestamp prefix, and they merge cleanly. Projects with
  many concurrent migration-touching clusters may want to defer this
  runbook until the full lock primitives ship.

---

## Prerequisites

- Project's working tree is on a **local filesystem** (not iCloud
  Drive, Dropbox, or NFS — see skills/12 §Arbitration primitives).
- Project's `main` branch is **clean** (no uncommitted or untracked
  changes that should land before the wave). The setup script will
  warn on untracked files and refuse on uncommitted ones.
- A **WAVE-PLAN-NN.md** for the current wave plan exists in
  `coordination/`, with each cluster's work unit identified.
- Operator can open **N concurrent Claude Code sessions** where N is
  the number of clusters in the wave (default cap: 5; configurable via
  the `max-parallelism-per-wave` setting).
- Each cluster's PRD scope block content has been drafted (operator
  authors these from the WAVE-PLAN's work-unit table — same content
  format as a normal single-pipeline round's scope block).

---

## Wave dispatch (the active phase)

### Step 1 — Setup each cluster's worktree

From the **main project root** (where `run-pipeline.sh` lives), run
the setup script once per cluster in the wave:

```bash
./scripts/multi-track-cluster-setup.sh <cluster-id> <round> <tier>
```

The `<cluster-id>` is operator's choice — typically derived from the
work-unit ID (e.g., `wu-p2-1`, `wu-p1-1`). The `<round>` is the
round identifier this cluster will use (e.g., `R40`, `R41`); each
cluster in the wave gets a distinct round number so their artifacts
don't collide on merge. The `<tier>` matches the work unit's tier
classification from the WAVE-PLAN (`solo`, `audit`, or `full`).

Example for ArchFolio Wave 1 (4 clusters):

```bash
./scripts/multi-track-cluster-setup.sh wu-p2-1 R40 full
./scripts/multi-track-cluster-setup.sh wu-p1-1 R41 audit
./scripts/multi-track-cluster-setup.sh wu-p1-2 R42 audit
./scripts/multi-track-cluster-setup.sh wu-p1-5 R43 audit
```

Each invocation creates a worktree at
`~/projects/<project>-clusters/<cluster-id>/` on a new branch
`cluster/<cluster-id>-<round>`. The script prints next steps and exits
without launching anything — the operator drives launch in Step 2.

### Step 2 — Author PRD scope + launch each cluster's pipeline

For each cluster worktree:

1. Open a **new Claude Code session** at the worktree path:
   ```bash
   cd ~/projects/<project>-clusters/<cluster-id>/
   claude
   ```
2. In that session, **author the PRD scope block** for this cluster's
   work unit at the top of `coordination/PRD.md`. The scope content
   matches the work unit's acceptance criteria from the WAVE-PLAN.
   Commit it:
   ```bash
   git add coordination/PRD.md
   git commit -m "<round> routing: cluster <cluster-id> — <WU description>"
   ```
3. **Launch the pipeline:**
   ```bash
   ./run-pipeline.sh --round <round> --tier <tier>
   ```
4. **Monitor** until ROUND-COMPLETE. The pipeline's auto-monitor flow
   works exactly as in single-track mode — the cluster session is just
   a normal pipeline run, isolated to its own worktree.

All N cluster sessions run in parallel. They never write to each
other's files (worktree isolation). They never block each other
(separate processes, separate working trees).

### Step 3 — Wait for all clusters to reach ROUND-COMPLETE

The wave gate cannot advance until every cluster in the wave has
reached `STATUS: ROUND-COMPLETE` (or has been explicitly disposed via
SCOPE-REDUCE-V1 / RETRY / ROUTE-TO-ARCHITECT per skills/12
§Wave gate failure handling).

If any cluster ESCALATEs:
- Decide its disposition before proceeding to wave merge.
- A failed cluster does NOT block other clusters from completing —
  they continue. The merge step handles each cluster's final state.

---

## Wave-gate aggregation (the merge phase)

Run from the **main project root**, on the `main` branch.

### Step 4 — Pre-merge sanity check

```bash
# Confirm main is still clean (no in-flight edits during dispatch)
git status

# Confirm all cluster branches exist and have their round-complete commits
for cluster in <cluster-id-1> <cluster-id-2> ...; do
  echo "$cluster: $(git log --oneline cluster/${cluster}-* | head -1)"
done
```

### Step 5 — Merge cluster branches one at a time

For each cluster in the wave, in any order:

```bash
git merge cluster/<cluster-id>-<round> --no-ff -m "Wave <N>: merge cluster <cluster-id>"
```

**Expected conflicts** (because every cluster appended to the same
coordination files):
- `coordination/MEMORIAL.md` — every cluster added CONFIRMATION/VIOLATION
  lines at the bottom
- `coordination/NEXT-ROLE.md` — every cluster wrote `STATUS: ROUND-COMPLETE`
- `CLAUDE.md` — every cluster appended REINFORCED lines (if violations
  triggered them)

**Conflict resolution strategy:**

For `coordination/MEMORIAL.md` and `CLAUDE.md`, the correct resolution
is **union** — keep both sides. Manually edit to concatenate the new
lines from both branches, preserving append-only semantics:

```bash
# Resolve via merge tool, or edit the file by hand to keep both sides
$EDITOR coordination/MEMORIAL.md
$EDITOR CLAUDE.md
git add coordination/MEMORIAL.md CLAUDE.md
git merge --continue
```

For `coordination/NEXT-ROLE.md`, keep the most recent cluster's
content (it'll be overwritten by the wave-gate authoring in Step 7
anyway):

```bash
git checkout --theirs coordination/NEXT-ROLE.md
git add coordination/NEXT-ROLE.md
git merge --continue
```

Round-specific artifacts (`coordination/specs/Q-RNN-SPEC.md`,
`coordination/reviews/REVIEWER-REPORT-RNN.md`,
`coordination/logs/ROUND-RNN-SUMMARY.md`) are uniquely named per round
so they don't conflict — they just need to be added to main.

Repeat for each cluster.

### Step 6 — Verify the merge

```bash
./scripts/multi-track-verify-wave-merge.sh --wave <N> --clusters <id-1>,<id-2>,...
```

The script checks that:
- Every cluster's CONFIRMATION/VIOLATION memorial line is present on main
- Every cluster's REVIEWER-REPORT-RNN.md is in `coordination/reviews/`
- Every cluster's ROUND-RNN-SUMMARY.md is in `coordination/logs/`
- Every cluster's CLAUDE.md REINFORCED appends are on main

If any check fails, the script prints remediation steps. Re-run after
remediation until clean (exit 0).

### Step 7 — Author the wave-gate artifact

Per skills/12 §Coordinator artifacts, produce a `WAVE-GATE-NN.md`
recording the wave's results, any failures + dispositions, pre-flags
to the next wave, and the dispatch authorization for Wave N+1.
Template at
[`templates/WAVE-GATE-TEMPLATE.md`](../../templates/WAVE-GATE-TEMPLATE.md).

Commit it:

```bash
git add coordination/WAVE-GATE-<N>.md
git commit -m "Wave <N> gate: <verdict> (<cluster-count> clusters)"
```

### Step 8 — Clean up worktrees and branches

```bash
for cluster in <id-1> <id-2> ...; do
  git worktree remove ~/projects/<project>-clusters/$cluster
  git branch -d cluster/${cluster}-<round>
done

# Remove the parent dir if empty
rmdir ~/projects/<project>-clusters 2>/dev/null || true
```

---

## Advancing to the next wave

Repeat Steps 1–8 with the next wave's clusters from the WAVE-PLAN.
The WAVE-GATE-NN.md authored in Step 7 is the dispatch authority for
Wave N+1 — read its "Wave N+1 dispatch authorization" section to know
which clusters to set up.

---

## What this MVP does NOT cover

These are documented in skills/12 but require integration-layer code
that hasn't shipped yet. Track in a follow-up PR:

- **Automated dispatch.** Today, the operator opens N Claude sessions
  manually and runs `run-pipeline.sh` in each. Future: a single
  `coordinator-dispatch.sh --wave N` invocation spawns all N headless
  cluster sessions.
- **Cross-cluster handoff artifacts** (`CLUSTER-HANDOFF-NN-WUA-WUB.md`).
  Only required when a Wave N+1 cluster has a dependency edge into a
  Wave N output. For ArchFolio's WAVE-PLAN-01.md Wave 1, no
  cross-cluster handoffs are needed.
- **Migration lock primitive** for D5-contention work units. ArchFolio
  Wave 1's four migrations are disjoint (Contract, Project, Photo,
  PriceListItem) and merge cleanly with distinct wall-clock
  timestamps. Future projects with many concurrent migrations may need
  the lock before this MVP is safe to use.
- **Cross-project memorial merge** (`merge-cross-project-memorial.sh`).
  Operator-driven, weekly cadence — not a per-wave concern. Will land
  in its own PR.
- **`coordination/multi-track-config.json`** for per-project overrides
  (migration directory, timeouts, max-parallelism). MVP uses skill
  defaults; the config file becomes relevant when projects diverge.

---

## When to use multi-track vs. stay serial

From skills/12 §Shared-resource arbitration → When NOT to apply:

> If the project's wave plan has at most one cluster per wave, the
> Coordinator dispatches sequentially and the arbitration mechanisms
> are inert. The methodology degrades gracefully to single-pipeline
> behavior.

Adding to that, an operational floor specific to this MVP runbook:
**multi-track is overhead unless the wave has ≥3 truly-parallel
clusters**. Two clusters can run as two sequential serial rounds
without losing much wall-clock time and without paying the manual
coordination cost of opening 2 Claude sessions + merging.

ArchFolio's WAVE-PLAN-01.md Wave 1 has 4 clusters — clear case for
multi-track. Wave 2/3/4 each have 1 cluster — stay serial. Wave 5 has
4 — multi-track again. Wave 6 has 11, capped to ≤5 per skills/12
§Step 5 — multi-track in 3 sub-waves.
