#!/bin/bash
# multi-track-cluster-setup.sh — Create a git worktree for one Anchor cluster.
#
# Usage: ./scripts/multi-track-cluster-setup.sh <cluster-id> <round> <tier>
#
# Example:
#   ./scripts/multi-track-cluster-setup.sh wu-p2-1 R40 full
#
# What it does:
#   1. Validates main branch is clean and committed
#   2. Creates a git worktree at $HOME/projects/<project>-clusters/<cluster-id>/
#      on a new branch cluster/<cluster-id>-<round>
#   3. Prints next steps for the operator
#
# What it does NOT do:
#   - Author the PRD scope block for the cluster's work unit (operator does this
#     in the worktree's coordination/PRD.md before running the pipeline)
#   - Launch the pipeline (operator runs run-pipeline.sh manually in the worktree
#     to give them control over which Claude Code session executes it)
#   - Aggregate memorials at wave gate (see MULTI-TRACK-RUNBOOK.md for the
#     wave-merge procedure)
#
# Exit codes:
#   0 = worktree created; next-steps printed
#   1 = validation failure or worktree creation error
#   2 = worktree already exists for this cluster-id (re-run not safe)

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────
if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <cluster-id> <round> <tier>"
  echo "  cluster-id  short identifier for this cluster (e.g., wu-p2-1)"
  echo "  round       round identifier (e.g., R40)"
  echo "  tier        solo | audit | full"
  exit 1
fi

CLUSTER_ID="$1"
ROUND="$2"
TIER="$3"

# Validate tier early
case "$TIER" in
  solo|audit|full) ;;
  T0|T1|T3)
    echo "WARN: legacy tier name '$TIER'; the runbook examples use solo/audit/full"
    ;;
  *)
    echo "ERROR: invalid tier '$TIER'. Valid: solo, audit, full"
    exit 1
    ;;
esac

# ── Project root resolution ───────────────────────────────────────────────────
# Operator runs this from the main project root, not from anchor canonical.
PROJECT_ROOT="$(pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"

if [[ ! -d "$PROJECT_ROOT/coordination" ]]; then
  echo "ERROR: must be run from a project root containing coordination/."
  echo "       Current dir: $PROJECT_ROOT"
  exit 1
fi

if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
  echo "ERROR: $PROJECT_ROOT is not a git repository (no .git/ found)."
  exit 1
fi

# ── Clean-main validation ─────────────────────────────────────────────────────
CURRENT_BRANCH=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: not on main branch (currently on '$CURRENT_BRANCH')."
  echo "       Wave dispatches must start from a clean main."
  exit 1
fi

if ! git -C "$PROJECT_ROOT" diff --quiet || ! git -C "$PROJECT_ROOT" diff --cached --quiet; then
  echo "ERROR: main has uncommitted changes."
  echo "       Commit or stash them before starting a wave dispatch."
  git -C "$PROJECT_ROOT" status --short
  exit 1
fi

# Detect untracked files in coordination/ — these are likely round-close
# artifacts that should be committed first.
UNTRACKED_COORD=$(git -C "$PROJECT_ROOT" ls-files --others --exclude-standard coordination/ | head -3)
if [[ -n "$UNTRACKED_COORD" ]]; then
  echo "WARN: main has untracked files in coordination/:"
  echo "$UNTRACKED_COORD" | sed 's/^/      /'
  echo "      Worktree will branch from current main HEAD; the untracked files"
  echo "      will NOT be visible inside the cluster worktree."
  echo "      Press ENTER to continue, or Ctrl+C to abort and commit first."
  read -r
fi

# ── Worktree path resolution ──────────────────────────────────────────────────
CLUSTERS_PARENT="$HOME/projects/${PROJECT_NAME}-clusters"
WORKTREE_PATH="$CLUSTERS_PARENT/$CLUSTER_ID"
BRANCH_NAME="cluster/${CLUSTER_ID}-${ROUND}"

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "ERROR: worktree path already exists: $WORKTREE_PATH"
  echo "       If a prior wave dispatch left this behind, clean it up:"
  echo "       git -C $PROJECT_ROOT worktree remove $WORKTREE_PATH"
  echo "       Or manually: rm -rf $WORKTREE_PATH && git worktree prune"
  exit 2
fi

# Check if the branch already exists (orphan branch from prior dispatch)
if git -C "$PROJECT_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "ERROR: branch '$BRANCH_NAME' already exists."
  echo "       Either delete it (git branch -D $BRANCH_NAME) or pick a different round."
  exit 2
fi

mkdir -p "$CLUSTERS_PARENT"

# ── Create the worktree ───────────────────────────────────────────────────────
echo "Creating worktree:"
echo "  path:   $WORKTREE_PATH"
echo "  branch: $BRANCH_NAME (new, off main)"
echo ""

git -C "$PROJECT_ROOT" worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" main

# ── Verify the worktree has run-pipeline.sh available ─────────────────────────
if [[ ! -x "$WORKTREE_PATH/run-pipeline.sh" ]]; then
  echo "WARN: $WORKTREE_PATH/run-pipeline.sh is missing or not executable."
  echo "      The cluster pipeline cannot be launched without it. Check that"
  echo "      run-pipeline.sh is tracked in git on main."
fi

# ── Print operator next steps ─────────────────────────────────────────────────
cat <<EOF

✅ Cluster worktree created.

NEXT STEPS (operator):

1. Open a new Claude Code session in the worktree:
       cd $WORKTREE_PATH

2. Author the PRD scope block for this cluster's work unit at the top of
   coordination/PRD.md. The scope block should match the work unit's
   acceptance criteria from the WAVE-PLAN. Commit the PRD update:
       git add coordination/PRD.md
       git commit -m "$ROUND routing: cluster $CLUSTER_ID — <WU description>"

3. Launch the pipeline:
       ./run-pipeline.sh --round $ROUND --tier $TIER

4. Wait for ROUND-COMPLETE. Then return to the main project root and proceed
   with the rest of the wave's clusters (each gets its own setup invocation
   from main, in parallel with this one).

5. After ALL clusters in the wave reach ROUND-COMPLETE, follow the wave-merge
   procedure in MULTI-TRACK-RUNBOOK.md to aggregate cluster results back
   into main.

EOF
