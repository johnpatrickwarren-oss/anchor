#!/bin/bash
# Smoke test for scripts/check-lint-baseline.sh
# Fails before the script exists (TDD ordering).
# Uses LINT_BASELINE_FILE env var to inject a generous baseline (999 warnings)
# so the test doesn't depend on actual lint output.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/check-lint-baseline.sh"

if [[ ! -x "$SCRIPT" ]]; then
  echo "FAIL: $SCRIPT not found or not executable"
  exit 1
fi

# Create a generous baseline (999 warnings) so current lint always passes
TMPBASELINE=$(mktemp)
echo '{"errors": 0, "warnings": 999}' > "$TMPBASELINE"

# With a generous baseline, script should exit 0
if ! LINT_BASELINE_FILE="$TMPBASELINE" "$SCRIPT"; then
  echo "FAIL: Expected exit 0 with a generous baseline (999 warnings)"
  rm -f "$TMPBASELINE"
  exit 1
fi
rm -f "$TMPBASELINE"

# Create a strict baseline (0 warnings) — should exit 1 if there are any warnings
TMPBASELINE2=$(mktemp)
echo '{"errors": 0, "warnings": 0}' > "$TMPBASELINE2"
LINT_RESULT=0
LINT_BASELINE_FILE="$TMPBASELINE2" "$SCRIPT" || LINT_RESULT=$?
rm -f "$TMPBASELINE2"
# We expect non-zero exit because real lint has warnings
# (If lint is ever fixed to 0 warnings this check will need updating)
[[ $LINT_RESULT -ne 0 ]] || { echo "FAIL: Expected non-zero exit with strict baseline"; exit 1; }
echo "PASS: check-lint-baseline.sh exists, is executable, and gates correctly"
