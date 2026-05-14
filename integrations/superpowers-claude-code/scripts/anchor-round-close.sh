#!/bin/bash
# anchor-round-close.sh — Commit a round's Memorial-Updater outputs.
#
# Usage:
#   ./scripts/anchor-round-close.sh [--round RNN] [--dry-run]
#
# Operator-driven helper that commits the standard set of files written by
# the Memorial-Updater role at clean completion. Mirrors the auto-commit
# logic in run-pipeline.sh's MEMORIAL-UPDATER success path (A7) — used
# when the pipeline didn't auto-commit (e.g., pipeline crashed, single-
# track operator ran roles manually, multi-track cluster's Memorial-
# Updater pre-dates A7).
#
# What it commits:
#   M  CLAUDE.md                              (REINFORCED appends)
#   M  coordination/MEMORIAL.md               (CONFIRMATION/VIOLATION)
#   M  coordination/NEXT-ROLE.md              (final state, ROUND-COMPLETE)
#   ?? coordination/logs/ROUND-RNN-SUMMARY.md (new)
#   ?? coordination/reviews/REVIEWER-REPORT-RNN.md (if uncommitted)
#
# Round detection:
#   --round RNN     explicit (overrides auto-detection)
#   (otherwise)     read CURRENT-ROUND from coordination/NEXT-ROLE.md
#
# Options:
#   --dry-run       show what would be committed without committing
#
# Exit codes:
#   0 = committed successfully OR nothing to commit (clean state)
#   1 = error (project not detected, round not detected, commit failed)

set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────────
ROUND=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --round)   ROUND="$2";    shift 2 ;;
    --dry-run) DRY_RUN=true;  shift   ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "ERROR: unknown arg '$1'"; exit 1 ;;
  esac
done

# ── Project root + sanity ────────────────────────────────────────────────────
PROJECT_ROOT="$(pwd)"
if [[ ! -d "$PROJECT_ROOT/coordination" ]]; then
  echo "ERROR: must be run from a project root containing coordination/."
  echo "       Current dir: $PROJECT_ROOT"
  exit 1
fi

# ── Round detection ──────────────────────────────────────────────────────────
if [[ -z "$ROUND" ]]; then
  if [[ -f "$PROJECT_ROOT/coordination/NEXT-ROLE.md" ]]; then
    ROUND=$(grep -m1 -E "^CURRENT-ROUND:" "$PROJECT_ROOT/coordination/NEXT-ROLE.md" | awk '{print $2}')
  fi
  if [[ -z "$ROUND" ]]; then
    echo "ERROR: could not auto-detect round from coordination/NEXT-ROLE.md."
    echo "       Pass --round RNN explicitly."
    exit 1
  fi
fi

# Sanity-check format
if ! [[ "$ROUND" =~ ^R[0-9]+$ ]]; then
  echo "ERROR: round '$ROUND' does not match RNN format (e.g., R40)."
  exit 1
fi

echo "Round: $ROUND"

# ── Stage Memorial-Updater outputs ───────────────────────────────────────────
cd "$PROJECT_ROOT"

# Stage everything in coordination/ (handles untracked new files + modifications
# + deletions like .pipeline-RNN.lock) plus CLAUDE.md if modified.
git add -A coordination/ CLAUDE.md 2>/dev/null || true

# Check if there's anything to commit
if git diff --cached --quiet 2>/dev/null; then
  echo "Nothing to commit — Memorial-Updater outputs already clean."
  echo "(If you expected uncommitted work, check 'git status' for files outside coordination/ + CLAUDE.md.)"
  exit 0
fi

echo ""
echo "Staged for commit:"
git diff --cached --name-status | sed 's/^/  /'
echo ""

if $DRY_RUN; then
  echo "[--dry-run] Not committing. Reset staged changes with: git reset"
  exit 0
fi

# ── Commit ───────────────────────────────────────────────────────────────────
COMMIT_MSG="chore($ROUND): Memorial-Updater outputs"
if git commit -m "$COMMIT_MSG"; then
  SHA=$(git rev-parse --short HEAD)
  echo ""
  echo "✅ Committed: $SHA — $COMMIT_MSG"
else
  echo ""
  echo "ERROR: commit failed. Check git status."
  exit 1
fi
