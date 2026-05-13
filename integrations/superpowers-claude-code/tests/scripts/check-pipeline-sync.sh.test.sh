#!/bin/bash
# Smoke test for scripts/check-pipeline-sync.sh
# Fails before the script exists (TDD ordering).
# Uses CANONICAL_DIR env var to inject a controlled canonical directory
# so the test runs independently of ~/anchor checkout state.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/check-pipeline-sync.sh"

if [[ ! -x "$SCRIPT" ]]; then
  echo "FAIL: $SCRIPT not found or not executable"
  exit 1
fi

# ── Helper: copy project files into a temp canonical dir ─────────────────────
make_sync_canonical() {
  local dest="$1"
  mkdir -p "$dest/scripts"
  cp "$PROJECT_ROOT/run-pipeline.sh"                    "$dest/run-pipeline.sh"
  cp "$PROJECT_ROOT/scripts/finalize-round.sh"          "$dest/scripts/finalize-round.sh"
  cp "$PROJECT_ROOT/scripts/check-manifest.sh"          "$dest/scripts/check-manifest.sh"
  cp "$PROJECT_ROOT/scripts/check-lint-baseline.sh"     "$dest/scripts/check-lint-baseline.sh"
  cp "$PROJECT_ROOT/scripts/check-pipeline-sync.sh"     "$dest/scripts/check-pipeline-sync.sh"
  # new-project.sh: only copy if it exists locally
  if [[ -f "$PROJECT_ROOT/new-project.sh" ]]; then
    cp "$PROJECT_ROOT/new-project.sh" "$dest/new-project.sh"
  fi
}

# ── Test 1: in-sync — exit 0, no DRIFT lines ─────────────────────────────────
TMPCANON=$(mktemp -d)
make_sync_canonical "$TMPCANON"

RESULT=0
SYNC_OUTPUT=$(CANONICAL_DIR="$TMPCANON" "$SCRIPT" 2>&1) || RESULT=$?
rm -rf "$TMPCANON"

[[ $RESULT -eq 0 ]] || {
  echo "FAIL: Expected exit 0 for in-sync; got $RESULT"
  echo "Output: $SYNC_OUTPUT"
  exit 1
}
echo "$SYNC_OUTPUT" | grep -q "DRIFT:" && {
  echo "FAIL: Expected no DRIFT lines for in-sync; got: $SYNC_OUTPUT"
  exit 1
} || true
echo "PASS (1/3): in-sync exits 0 with no DRIFT lines"

# ── Test 2: canonical absent — exit 0 with warning ───────────────────────────
ABSENT_DIR="/tmp/canonical-absent-nonexistent-r19-$$"
# Ensure it truly does not exist
rm -rf "$ABSENT_DIR"

RESULT=0
OUTPUT_ABSENT=$(CANONICAL_DIR="$ABSENT_DIR" "$SCRIPT" 2>&1) || RESULT=$?

[[ $RESULT -eq 0 ]] || {
  echo "FAIL: Expected exit 0 when canonical absent; got $RESULT"
  echo "Output: $OUTPUT_ABSENT"
  exit 1
}
echo "$OUTPUT_ABSENT" | grep -q "Canonical not present at" || {
  echo "FAIL: Expected 'Canonical not present at' in output; got: $OUTPUT_ABSENT"
  exit 1
}
echo "PASS (2/3): canonical-absent exits 0 with 'Canonical not present at' warning"

# ── Test 3: drift detected — exit 1 with DRIFT report ────────────────────────
TMPCANON2=$(mktemp -d)
make_sync_canonical "$TMPCANON2"

# Introduce drift: append a line to the canonical's run-pipeline.sh
echo "# drift-marker-r19-test" >> "$TMPCANON2/run-pipeline.sh"

RESULT=0
OUTPUT_DRIFT=$(CANONICAL_DIR="$TMPCANON2" "$SCRIPT" 2>&1) || RESULT=$?
rm -rf "$TMPCANON2"

[[ $RESULT -ne 0 ]] || {
  echo "FAIL: Expected non-zero exit for drift-detected; got $RESULT"
  echo "Output: $OUTPUT_DRIFT"
  exit 1
}
echo "$OUTPUT_DRIFT" | grep -q "DRIFT:" || {
  echo "FAIL: Expected 'DRIFT:' line in output; got: $OUTPUT_DRIFT"
  exit 1
}
echo "PASS (3/3): drift-detected exits non-zero with 'DRIFT:' line"

echo ""
echo "All 3 smoke tests passed: check-pipeline-sync.sh"
