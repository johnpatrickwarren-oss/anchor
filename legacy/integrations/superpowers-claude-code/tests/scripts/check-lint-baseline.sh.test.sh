#!/bin/bash
# Smoke test for scripts/check-lint-baseline.sh
# Self-contained: the script is copied into a temp project whose "lint"
# script emits a controlled fake ESLint summary, so the test does not
# depend on the host project's lint state (it used to fail on a fresh
# clone because it asserted "real lint has warnings").
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/check-lint-baseline.sh"

if [[ ! -x "$SCRIPT" ]]; then
  echo "FAIL: $SCRIPT not found or not executable"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Fixture: a fake project whose lint emits "3 problems (0 errors, 3 warnings)"
PROJ="$TMP/proj"
mkdir -p "$PROJ/scripts"
cp "$SCRIPT" "$PROJ/scripts/check-lint-baseline.sh"
chmod +x "$PROJ/scripts/check-lint-baseline.sh"
cat > "$PROJ/package.json" << 'EOF'
{
  "name": "lint-baseline-fixture",
  "private": true,
  "scripts": {
    "lint": "printf '\\n3 problems (0 errors, 3 warnings)\\n'"
  }
}
EOF

# ── Test 1: generous baseline (999 warnings) → exit 0 ────────────────────────
BASELINE="$TMP/baseline.json"
echo '{"errors": 0, "warnings": 999}' > "$BASELINE"
if ! LINT_BASELINE_FILE="$BASELINE" "$PROJ/scripts/check-lint-baseline.sh" > /dev/null; then
  echo "FAIL (1/4): Expected exit 0 with a generous baseline (999 warnings)"
  exit 1
fi
echo "PASS (1/4): generous baseline exits 0"

# ── Test 2: strict baseline (0 warnings) vs 3 fake warnings → exit 1 ─────────
echo '{"errors": 0, "warnings": 0}' > "$BASELINE"
RESULT=0
LINT_BASELINE_FILE="$BASELINE" "$PROJ/scripts/check-lint-baseline.sh" > /dev/null || RESULT=$?
[[ $RESULT -ne 0 ]] || { echo "FAIL (2/4): Expected non-zero exit with strict baseline"; exit 1; }
echo "PASS (2/4): strict baseline exits non-zero on warning regression"

# ── Test 3: lint errors always fail, regardless of baseline ──────────────────
PROJ_ERR="$TMP/proj-err"
mkdir -p "$PROJ_ERR/scripts"
cp "$SCRIPT" "$PROJ_ERR/scripts/check-lint-baseline.sh"
chmod +x "$PROJ_ERR/scripts/check-lint-baseline.sh"
cat > "$PROJ_ERR/package.json" << 'EOF'
{
  "name": "lint-baseline-fixture-err",
  "private": true,
  "scripts": {
    "lint": "printf '\\n5 problems (2 errors, 3 warnings)\\n' && exit 1"
  }
}
EOF
echo '{"errors": 0, "warnings": 999}' > "$BASELINE"
RESULT=0
LINT_BASELINE_FILE="$BASELINE" "$PROJ_ERR/scripts/check-lint-baseline.sh" > /dev/null || RESULT=$?
[[ $RESULT -ne 0 ]] || { echo "FAIL (3/4): Expected non-zero exit when lint reports errors"; exit 1; }
echo "PASS (3/4): lint errors fail regardless of baseline"

# ── Test 4: lint cannot run at all → fail CLOSED (historical fail-open bug) ──
PROJ_BROKEN="$TMP/proj-broken"
mkdir -p "$PROJ_BROKEN/scripts"
cp "$SCRIPT" "$PROJ_BROKEN/scripts/check-lint-baseline.sh"
chmod +x "$PROJ_BROKEN/scripts/check-lint-baseline.sh"
# No package.json at all: `npm run lint` errors without a lint summary.
echo '{"errors": 0, "warnings": 999}' > "$BASELINE"
RESULT=0
OUTPUT=$(LINT_BASELINE_FILE="$BASELINE" "$PROJ_BROKEN/scripts/check-lint-baseline.sh" 2>&1) || RESULT=$?
if [[ $RESULT -eq 0 ]]; then
  echo "FAIL (4/4): Expected non-zero exit when the linter cannot run (gate failed open)"
  echo "$OUTPUT"
  exit 1
fi
echo "$OUTPUT" | grep -q "did not run" || {
  echo "FAIL (4/4): Expected 'did not run' diagnostic; got: $OUTPUT"
  exit 1
}
echo "PASS (4/4): gate fails closed when the linter cannot run"

echo "PASS: check-lint-baseline.sh exists, is executable, and gates correctly"
