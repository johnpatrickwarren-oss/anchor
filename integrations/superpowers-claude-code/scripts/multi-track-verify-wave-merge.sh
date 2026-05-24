#!/bin/bash
# multi-track-verify-wave-merge.sh — Wave merge correctness check.
#
# Usage:
#   # Pre-merge mode (cluster branches still exist):
#   ./scripts/multi-track-verify-wave-merge.sh --wave N --clusters id1,id2,...
#
#   # Post-merge mode (branches deleted after merge; recommended):
#   ./scripts/multi-track-verify-wave-merge.sh --wave N --clusters id1,id2,... \
#       --baseline pre-wave-N-merge
#
# The --baseline flag (added per Wave 1 finding F2) makes the diff comparison
# work post-merge. Without it, the script uses `git diff main...<branch>`
# which is empty after merging the branches (they're ancestors of main).
# With --baseline, the script finds each cluster's merge commit on main and
# compares the baseline tag against that merge commit.
#
# Verifies:
#   1. Every cluster's CONFIRMATION/VIOLATION memorial lines from the wave
#      are present in main's coordination/MEMORIAL.md
#   2. Every cluster's REVIEWER-REPORT-RNN.md is in coordination/reviews/
#   3. Every cluster's ROUND-RNN-SUMMARY.md is in coordination/logs/
#   4. CLAUDE.md REINFORCED appends from each cluster are preserved on main
#
# Exit codes:
#   0 = all checks pass
#   1 = at least one check failed; remediation steps printed
#   2 = invocation error (bad args, baseline missing, etc.)

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────
WAVE=""
CLUSTERS=""
BASELINE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --wave)     WAVE="$2";     shift 2 ;;
    --clusters) CLUSTERS="$2"; shift 2 ;;
    --baseline) BASELINE="$2"; shift 2 ;;
    -h|--help)
      head -27 "$0" | sed 's/^# \?//'
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

if [[ -n "$BASELINE" ]]; then
  # Validate baseline exists as a ref
  if ! git -C "$PROJECT_ROOT" rev-parse --verify "$BASELINE" >/dev/null 2>&1; then
    echo "ERROR: --baseline '$BASELINE' is not a valid git ref."
    echo "       Did the cluster-setup script create the pre-wave-${WAVE}-merge tag?"
    exit 2
  fi
  echo "Verifying wave $WAVE merge (post-merge mode, baseline=$BASELINE) against ${#CLUSTER_ARR[@]} clusters: $CLUSTERS"
else
  echo "Verifying wave $WAVE merge (pre-merge mode, branches expected) against ${#CLUSTER_ARR[@]} clusters: $CLUSTERS"
fi
echo ""

FAILURES=0
fail() { echo "  ❌ $*"; FAILURES=$((FAILURES + 1)); }
pass() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

# ── Resolve each cluster's round + diff range ─────────────────────────────────
for cluster in "${CLUSTER_ARR[@]}"; do
  if [[ -n "$BASELINE" ]]; then
    # Post-merge mode: find the wave-merge commit that mentions this cluster id
    MERGE_COMMIT=$(git -C "$PROJECT_ROOT" log --oneline "$BASELINE..HEAD" 2>/dev/null \
      | grep -F "cluster $cluster" | head -1 | awk '{print $1}' || true)
    if [[ -z "$MERGE_COMMIT" ]]; then
      fail "cluster $cluster: no merge commit found on main mentioning 'cluster $cluster' since baseline"
      continue
    fi
    # Round number is in the merge commit subject (e.g., 'R40 — Contract foundation')
    ROUND=$(git -C "$PROJECT_ROOT" log -1 --format=%s "$MERGE_COMMIT" \
      | grep -oE "R[0-9]+" | head -1)
    DIFF_RANGE="$BASELINE..$MERGE_COMMIT"
    echo "Cluster '$cluster' → merge $MERGE_COMMIT (round $ROUND)"
  else
    BRANCH=$(git -C "$PROJECT_ROOT" for-each-ref --format='%(refname:short)' "refs/heads/cluster/${cluster}-*" | head -1)
    if [[ -z "$BRANCH" ]]; then
      fail "cluster $cluster: no branch matching 'cluster/${cluster}-*' found"
      continue
    fi
    ROUND=$(echo "$BRANCH" | sed -n "s|cluster/${cluster}-||p")
    DIFF_RANGE="main...$BRANCH"
    echo "Cluster '$cluster' → branch '$BRANCH' (round $ROUND)"
  fi

  if [[ -z "$ROUND" ]]; then
    fail "  could not derive round identifier for cluster $cluster"
    continue
  fi

  # ── Check 1: MEMORIAL.md lines ─────────────────────────────────────────────
  CLUSTER_MEMORIAL_LINES=$(git -C "$PROJECT_ROOT" diff "$DIFF_RANGE" -- coordination/MEMORIAL.md 2>/dev/null \
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
  CLUSTER_REINFORCED=$(git -C "$PROJECT_ROOT" diff "$DIFF_RANGE" -- CLAUDE.md 2>/dev/null \
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
