#!/bin/bash
# multi-track-verify-wave-merge.sh — Post-merge correctness check for a wave.
#
# Usage:
#   ./scripts/multi-track-verify-wave-merge.sh --wave N --clusters cluster-id-1,cluster-id-2,...
#
# Example:
#   ./scripts/multi-track-verify-wave-merge.sh --wave 1 --clusters wu-p2-1,wu-p1-1,wu-p1-2,wu-p1-5
#
# Runs AFTER the operator has merged all cluster branches into main per the
# MULTI-TRACK-RUNBOOK.md wave-merge procedure. Verifies:
#
#   1. Every cluster's CONFIRMATION/VIOLATION memorial lines from the wave are
#      present in main's coordination/MEMORIAL.md (catches lines lost to
#      conflict resolution "ours" strategy)
#   2. Every cluster's REVIEWER-REPORT-RNN.md file is present in
#      coordination/reviews/ on main
#   3. Every cluster's ROUND-RNN-SUMMARY.md is present in coordination/logs/
#   4. The CLAUDE.md reinforcement appends from each cluster are preserved on
#      main (any 'REINFORCED YYYY-MM-DD' lines added on cluster branches
#      should be on main)
#
# Exit codes:
#   0 = all checks pass; wave merge is correct
#   1 = at least one check failed; remediation steps printed
#   2 = invocation error (bad args, cluster branch missing, etc.)

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────
WAVE=""
CLUSTERS=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --wave)     WAVE="$2";     shift 2 ;;
    --clusters) CLUSTERS="$2"; shift 2 ;;
    -h|--help)
      head -25 "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

if [[ -z "$WAVE" || -z "$CLUSTERS" ]]; then
  echo "ERROR: --wave and --clusters are required."
  echo "Usage: $0 --wave N --clusters id1,id2,..."
  exit 2
fi

PROJECT_ROOT="$(pwd)"
if [[ ! -d "$PROJECT_ROOT/coordination" ]]; then
  echo "ERROR: must be run from a project root containing coordination/."
  exit 2
fi

CURRENT_BRANCH=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: verify must run on main (currently '$CURRENT_BRANCH')."
  exit 2
fi

IFS=',' read -ra CLUSTER_ARR <<< "$CLUSTERS"

echo "Verifying wave $WAVE merge against ${#CLUSTER_ARR[@]} clusters: $CLUSTERS"
echo ""

FAILURES=0
fail() { echo "  ❌ $*"; FAILURES=$((FAILURES + 1)); }
pass() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

# ── Resolve each cluster's branch ─────────────────────────────────────────────
for cluster in "${CLUSTER_ARR[@]}"; do
  # Find the branch matching this cluster (regardless of round suffix)
  BRANCH=$(git -C "$PROJECT_ROOT" for-each-ref --format='%(refname:short)' "refs/heads/cluster/${cluster}-*" | head -1)
  if [[ -z "$BRANCH" ]]; then
    fail "cluster $cluster: no branch matching 'cluster/${cluster}-*' found"
    continue
  fi
  echo "Cluster '$cluster' → branch '$BRANCH'"

  # Extract the cluster's round identifier from the branch name (e.g., R40)
  ROUND=$(echo "$BRANCH" | sed -n "s|cluster/${cluster}-||p")

  # ── Check 1: MEMORIAL.md lines ─────────────────────────────────────────────
  # Find lines added on the cluster branch that match CONFIRMATION:/VIOLATION:
  CLUSTER_MEMORIAL_LINES=$(git -C "$PROJECT_ROOT" diff "main...$BRANCH" -- coordination/MEMORIAL.md 2>/dev/null \
    | grep -E "^\+(CONFIRMATION|VIOLATION):" | sed 's/^\+//' || true)

  if [[ -z "$CLUSTER_MEMORIAL_LINES" ]]; then
    warn "  no CONFIRMATION/VIOLATION lines added on $BRANCH"
  else
    MISSING=0
    while IFS= read -r line; do
      # Use fgrep for literal-string matching (lines may contain regex metachars)
      if ! grep -Fq "$line" "$PROJECT_ROOT/coordination/MEMORIAL.md"; then
        fail "  memorial line missing on main: $(echo "$line" | head -c 80)..."
        MISSING=$((MISSING + 1))
      fi
    done <<< "$CLUSTER_MEMORIAL_LINES"
    if [[ $MISSING -eq 0 ]]; then
      pass "  all $(echo "$CLUSTER_MEMORIAL_LINES" | wc -l | tr -d ' ') memorial lines present on main"
    fi
  fi

  # ── Check 2: Reviewer report present ───────────────────────────────────────
  REPORT_PATH="coordination/reviews/REVIEWER-REPORT-${ROUND}.md"
  if [[ -f "$PROJECT_ROOT/$REPORT_PATH" ]]; then
    pass "  $REPORT_PATH present on main"
  else
    # Was it present on the cluster branch?
    if git -C "$PROJECT_ROOT" cat-file -e "$BRANCH:$REPORT_PATH" 2>/dev/null; then
      fail "  $REPORT_PATH exists on $BRANCH but is MISSING on main"
    else
      warn "  $REPORT_PATH not on $BRANCH either (cluster may have skipped reviewer)"
    fi
  fi

  # ── Check 3: Round summary present ─────────────────────────────────────────
  SUMMARY_PATH="coordination/logs/ROUND-${ROUND}-SUMMARY.md"
  if [[ -f "$PROJECT_ROOT/$SUMMARY_PATH" ]]; then
    pass "  $SUMMARY_PATH present on main"
  else
    if git -C "$PROJECT_ROOT" cat-file -e "$BRANCH:$SUMMARY_PATH" 2>/dev/null; then
      fail "  $SUMMARY_PATH exists on $BRANCH but is MISSING on main"
    else
      warn "  $SUMMARY_PATH not on $BRANCH (Memorial-Updater may not have run)"
    fi
  fi

  # ── Check 4: CLAUDE.md REINFORCED lines ────────────────────────────────────
  CLUSTER_REINFORCED=$(git -C "$PROJECT_ROOT" diff "main...$BRANCH" -- CLAUDE.md 2>/dev/null \
    | grep -E "^\+# REINFORCED " | sed 's/^\+//' || true)

  if [[ -n "$CLUSTER_REINFORCED" ]]; then
    REIN_MISSING=0
    while IFS= read -r line; do
      if ! grep -Fq "$line" "$PROJECT_ROOT/CLAUDE.md"; then
        fail "  CLAUDE.md reinforcement missing on main: $(echo "$line" | head -c 80)..."
        REIN_MISSING=$((REIN_MISSING + 1))
      fi
    done <<< "$CLUSTER_REINFORCED"
    if [[ $REIN_MISSING -eq 0 ]]; then
      pass "  all $(echo "$CLUSTER_REINFORCED" | wc -l | tr -d ' ') REINFORCED lines present on main"
    fi
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "✅ All wave $WAVE merge checks passed."
  exit 0
else
  echo "❌ $FAILURES check(s) failed. Wave merge is incomplete."
  echo ""
  echo "Remediation:"
  echo "  - For missing memorial lines: append them manually to coordination/MEMORIAL.md"
  echo "    and commit. The verifier will re-pass."
  echo "  - For missing reviewer reports / summaries: check out the cluster branch,"
  echo "    copy the missing file, and add to main."
  echo "  - For missing REINFORCED lines: append to the relevant role block in CLAUDE.md."
  echo ""
  echo "After remediation, re-run this script to confirm."
  exit 1
fi
