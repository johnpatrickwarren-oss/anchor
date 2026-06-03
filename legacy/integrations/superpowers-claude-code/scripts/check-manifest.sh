#!/bin/bash
# check-manifest.sh — compare spec §2.x file inventory against git diff.
#
# Detects the recurring §2.x manifest miss pattern: a file changed in the round
# but not declared in the spec's file inventory section.
#
# Usage:
#   ./scripts/check-manifest.sh --round RNN [--baseline <sha>]
#
# Exit codes:
#   0 = spec §2.x matches git diff (clean)
#   1 = drift detected (files in diff but not spec, or spec but not diff)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COORD="$PROJECT_ROOT/coordination"

ROUND=""
BASELINE=""

usage() {
  echo "Usage: $0 --round RNN [--baseline <sha>]"
  echo "  --round RNN       Round identifier (required, e.g., R16)"
  echo "  --baseline <sha>  Baseline commit SHA (default: auto-detect from prior round)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --round)    ROUND="$2";    shift 2 ;;
    --baseline) BASELINE="$2"; shift 2 ;;
    --help|-h)  usage ;;
    *) echo "ERROR: Unknown argument: $1"; usage ;;
  esac
done

[[ -z "$ROUND" ]] && { echo "ERROR: --round is required."; usage; }

SPEC_FILE="$COORD/specs/Q-${ROUND}-SPEC.md"
if [[ ! -f "$SPEC_FILE" ]]; then
  echo "ERROR: Spec file not found: $SPEC_FILE"
  exit 1
fi

# ── Auto-detect baseline ──────────────────────────────────────────────────────
if [[ -z "$BASELINE" ]]; then
  ROUND_NUM="${ROUND#R}"
  PREV_NUM=$(printf '%02d' $((10#$ROUND_NUM - 1)))
  PREV_ROUND="R${PREV_NUM}"

  # Look for the prior round's final chore commit
  BASELINE=$(cd "$PROJECT_ROOT" && git log --oneline --format="%H" \
    --grep="chore(${PREV_ROUND}):" -1 2>/dev/null || true)

  if [[ -z "$BASELINE" ]]; then
    # Fall back to 50 commits back
    BASELINE=$(cd "$PROJECT_ROOT" && git rev-parse HEAD~50 2>/dev/null \
      || git rev-list --max-parents=0 HEAD)
    echo "Warning: Could not find $PREV_ROUND chore commit. Using ~50 commits back: $BASELINE"
  else
    echo "Auto-detected baseline: $BASELINE (last $PREV_ROUND chore commit)"
  fi
fi

echo "=== Checking manifest for $ROUND ==="
echo "Spec:     $SPEC_FILE"
echo "Baseline: $BASELINE"
echo ""

# ── Extract file list from spec §2.x section ─────────────────────────────────
# Accepts headings: "## File inventory (§2)", "## §2 File inventory",
# "## 2. File inventory", "## File inventory", "## §2"
# (Per PRD AC-R16-02 step b — heuristic parsing)
SPEC_SECTION=$(awk '
  /^##[[:space:]]+(File inventory \(§2\)|§2 File inventory|§2[[:space:]]*$|[0-9]+\.[[:space:]]*File inventory|File inventory)/ {
    in_section = 1
    next
  }
  /^##[[:space:]]/ && in_section {
    in_section = 0
  }
  in_section && /^[[:space:]]*[-*]/ {
    print $0
  }
' "$SPEC_FILE")

# Two-pass extraction to avoid double-matching (e.g., .lint-baseline.json → both
# ".lint-baseline.json" from backticks AND "lint-baseline.json" from bare regex).
# Pass 1: lines with backticks → extract from backticks only.
# Pass 2: lines without backticks → strip bullet marker, take first word.
SPEC_FILES=$(
  {
    # Pass 1: backtick-delimited paths (handles dotfiles like .lint-baseline.json)
    echo "$SPEC_SECTION" | grep '`' | grep -oE '`[^`]+`' | tr -d '`' | grep '\.' || true
    # Pass 2: bullet lines without backticks — strip "- " prefix, take first token
    echo "$SPEC_SECTION" | grep -v '`' | grep -E '^[[:space:]]*[-*]' \
      | sed 's/^[[:space:]]*[-*][[:space:]]*//' | awk '{print $1}' | grep '\.' || true
  } | sort -u
)

# ── Get git diff file list, filtered ─────────────────────────────────────────
DIFF_FILES=$(cd "$PROJECT_ROOT" && git diff --name-only "${BASELINE}..HEAD" \
  | grep -v "^coordination/" \
  | grep -v "^CLAUDE\.md$" \
  | grep -v "^\.gitignore$" \
  | sort -u \
  || true)

echo "Spec §2.x file inventory:"
if [[ -z "$SPEC_FILES" ]]; then
  echo "  (none found — check that spec has a '## §2 File inventory' or similar heading)"
else
  echo "$SPEC_FILES" | sed 's/^/  /'
fi
echo ""

echo "Git diff (vs baseline, excluding coordination/ + CLAUDE.md + .gitignore):"
if [[ -z "$DIFF_FILES" ]]; then
  echo "  (none)"
else
  echo "$DIFF_FILES" | sed 's/^/  /'
fi
echo ""

# ── Compare the two sets ──────────────────────────────────────────────────────
IN_SPEC_NOT_DIFF=""
IN_DIFF_NOT_SPEC=""

if [[ -n "$SPEC_FILES" ]] && [[ -n "$DIFF_FILES" ]]; then
  IN_SPEC_NOT_DIFF=$(comm -23 <(echo "$SPEC_FILES") <(echo "$DIFF_FILES") || true)
  IN_DIFF_NOT_SPEC=$(comm -23 <(echo "$DIFF_FILES") <(echo "$SPEC_FILES") || true)
elif [[ -z "$SPEC_FILES" ]] && [[ -n "$DIFF_FILES" ]]; then
  IN_DIFF_NOT_SPEC="$DIFF_FILES"
elif [[ -n "$SPEC_FILES" ]] && [[ -z "$DIFF_FILES" ]]; then
  IN_SPEC_NOT_DIFF="$SPEC_FILES"
fi

CLEAN=true

if [[ -n "$IN_SPEC_NOT_DIFF" ]]; then
  echo "WARNING — In spec §2.x, not in diff (listed but not changed):"
  echo "$IN_SPEC_NOT_DIFF" | sed 's/^/  /'
  echo "  (possible spec error or scope-narrowing — verify these files were not expected to change)"
  echo ""
  CLEAN=false
fi

if [[ -n "$IN_DIFF_NOT_SPEC" ]]; then
  echo "WARNING — In diff, not in spec §2.x (changed but not declared):"
  echo "$IN_DIFF_NOT_SPEC" | sed 's/^/  /'
  echo "  (the recurring manifest miss pattern — add to spec §2.x inventory)"
  echo ""
  CLEAN=false
fi

if $CLEAN; then
  echo "✓ Manifest clean: spec §2.x matches git diff."
  exit 0
else
  echo "✗ Manifest drift detected. Review warnings above."
  exit 1
fi
