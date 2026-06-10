#!/bin/bash
# Smoke test for scripts/finalize-round.sh
# Fails before the script exists (TDD ordering).
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/finalize-round.sh"

if [[ ! -x "$SCRIPT" ]]; then
  echo "FAIL: $SCRIPT not found or not executable"
  exit 1
fi

# Running with an unknown flag must exit non-zero
if "$SCRIPT" --invalid-flag >/dev/null 2>&1; then
  echo "FAIL: Expected non-zero exit on unknown flag"
  exit 1
fi

# ── Functional test: default scaffold round-close ─────────────────────────────
# Covers two historical bugs:
#   H1: `git diff --quiet src/ tests/ prisma/` without `--` exits 128 when a
#       configured source dir (prisma/) is absent — the default scaffold —
#       and the script misreported "Uncommitted changes in source dirs".
#   H2: change detection filtered untracked files (`grep -v "^??"`), so a
#       round whose only coordination output is NEW files printed "Nothing
#       to commit" and SHA-A silently excluded the round's artifacts.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PROJ="$TMP/proj"
mkdir -p "$PROJ/scripts" "$PROJ/coordination" "$PROJ/src" "$PROJ/tests"
cp "$SCRIPT" "$PROJ/scripts/finalize-round.sh"
chmod +x "$PROJ/scripts/finalize-round.sh"

cd "$PROJ"
git init -q
git config user.email "test@example.com"
git config user.name "Test"

echo "console.log('x')" > src/a.js
cat > coordination/NEXT-ROLE.md << 'EOF'
CURRENT-ROUND: R01
NEXT-ROLE: REVIEWER
STATUS: READY
EOF
git add -A
git commit -q -m "init"

# The round's only coordination output: a brand-new (untracked) file.
mkdir -p coordination/specs
echo "spec" > coordination/specs/Q-R01-SPEC.md

# No prisma/ exists (H1); binding commands stubbed so the test is hermetic.
if ! ANCHOR_BINDING_COMMANDS="true" ./scripts/finalize-round.sh --round R01 \
     > "$TMP/finalize.log" 2>&1; then
  echo "FAIL: finalize-round.sh aborted on a default scaffold (H1 regression?)"
  cat "$TMP/finalize.log"
  exit 1
fi

# H2: the new coordination file must be tracked at HEAD…
if ! git ls-tree -r HEAD --name-only | grep -q "^coordination/specs/Q-R01-SPEC.md$"; then
  echo "FAIL: untracked coordination file missing from attestation commits (H2 regression?)"
  cat "$TMP/finalize.log"
  exit 1
fi

# …and SHA-A must point at a commit that contains it (not pre-round HEAD).
SHA_A="$(grep '^SHA-A:' coordination/NEXT-ROLE.md | awk '{print $2}')"
if [[ -z "$SHA_A" ]] || ! git ls-tree -r "$SHA_A" --name-only | grep -q "^coordination/specs/Q-R01-SPEC.md$"; then
  echo "FAIL: SHA-A ($SHA_A) does not contain the round's coordination artifacts (H2 regression?)"
  cat "$TMP/finalize.log"
  exit 1
fi

echo "PASS: finalize-round.sh rejects unknown flags, survives absent source dirs, and commits new coordination artifacts into SHA-A"
