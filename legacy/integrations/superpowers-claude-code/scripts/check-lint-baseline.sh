#!/bin/bash
# check-lint-baseline.sh — lint warning regression gate.
#
# Compares current `npm run lint` warning count against a checked-in baseline.
# Any new warnings fail the check; improvements produce a hint to tighten the baseline.
#
# Usage:
#   ./scripts/check-lint-baseline.sh
#
# Environment:
#   LINT_BASELINE_FILE  Override path to baseline JSON (default: .lint-baseline.json)
#
# Exit codes:
#   0 = no regression (warnings ≤ baseline; errors = 0)
#   1 = regression (new errors, or warnings increased above baseline), or
#       the linter could not run at all (this gate fails CLOSED)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_FILE="${LINT_BASELINE_FILE:-$PROJECT_ROOT/.lint-baseline.json}"

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "ERROR: Lint baseline file not found: $BASELINE_FILE"
  echo "       Create it with: echo '{\"errors\": 0, \"warnings\": N}' > .lint-baseline.json"
  exit 1
fi

# ── Run lint, capture output and exit code ───────────────────────────────────
echo "--- Running lint ---"
LINT_EXIT=0
LINT_OUTPUT=$(cd "$PROJECT_ROOT" && npm run lint 2>&1) || LINT_EXIT=$?

# ── Parse error and warning counts ───────────────────────────────────────────
# ESLint summary line format: "✖ N problems (E errors, W warnings)"
# When no problems: no summary line (exit 0 with empty output)
ERRORS=0
WARNINGS=0

SUMMARY_LINE=$(echo "$LINT_OUTPUT" | grep -E '[0-9]+ problem' || true)

# ── Fail CLOSED when lint did not actually run ────────────────────────────────
# A non-zero npm exit with no ESLint summary line means npm/eslint itself
# failed (no package.json, no "lint" script, missing deps, npm absent) —
# that is NOT "0 errors, 0 warnings". A regression gate that passes when
# the linter never ran is no gate at all.
if [[ "$LINT_EXIT" -ne 0 && -z "$SUMMARY_LINE" ]]; then
  echo "ERROR: 'npm run lint' failed (exit $LINT_EXIT) without producing a lint summary." >&2
  echo "       The linter did not run; this gate fails closed. Last output lines:" >&2
  echo "$LINT_OUTPUT" | tail -10 >&2
  exit 1
fi

if [[ -n "$SUMMARY_LINE" ]]; then
  ERRORS=$(echo "$SUMMARY_LINE" | grep -oE '[0-9]+ error' | head -1 | grep -oE '[0-9]+' || echo "0")
  WARNINGS=$(echo "$SUMMARY_LINE" | grep -oE '[0-9]+ warning' | head -1 | grep -oE '[0-9]+' || echo "0")
fi

echo "Lint result : $ERRORS errors, $WARNINGS warnings"

# ── Read baseline (JSON.parse via fs.readFileSync — works without .json extension) ──
BASELINE_ERRORS=$(node -e "const b=JSON.parse(require('fs').readFileSync('$BASELINE_FILE')); process.stdout.write(String(b.errors))" 2>/dev/null || echo "0")
BASELINE_WARNINGS=$(node -e "const b=JSON.parse(require('fs').readFileSync('$BASELINE_FILE')); process.stdout.write(String(b.warnings))" 2>/dev/null || echo "0")

echo "Baseline    : $BASELINE_ERRORS errors, $BASELINE_WARNINGS warnings"
echo ""

# ── Gate on errors (always fail; baseline is for warnings only) ───────────────
if [[ "$ERRORS" -gt 0 ]]; then
  echo "FAIL: $ERRORS lint error(s) found. Errors always fail — fix before merging."
  exit 1
fi

# ── Gate on warnings ──────────────────────────────────────────────────────────
if [[ "$WARNINGS" -gt "$BASELINE_WARNINGS" ]]; then
  DELTA=$(( WARNINGS - BASELINE_WARNINGS ))
  echo "FAIL: New lint warnings introduced (+$DELTA: $WARNINGS > baseline $BASELINE_WARNINGS)."
  echo "      Fix the new warnings before finalizing."
  exit 1
elif [[ "$WARNINGS" -lt "$BASELINE_WARNINGS" ]]; then
  DELTA=$(( BASELINE_WARNINGS - WARNINGS ))
  echo "PASS: Lint warnings dropped by $DELTA ($BASELINE_WARNINGS → $WARNINGS)."
  echo "Hint: Update $BASELINE_FILE to lock in the gain:"
  echo "      Set \"warnings\": $WARNINGS"
  exit 0
else
  # Equal — silent pass
  exit 0
fi
