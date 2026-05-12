#!/bin/bash
# finalize-round.sh — one-command round-close for the Anchor pipeline.
#
# Implements the two-commit SHA-attestation sequence (CLAUDE.md R15 reinforcement):
#   SHA-A = coordination artifacts commit
#   SHA-B = record attestation SHA commit (HEAD after finalization)
# Reviewer verifies: git diff SHA-A HEAD -- src/ tests/ prisma/ exits 0.
#
# Usage:
#   ./scripts/finalize-round.sh --round RNN
#   ./scripts/finalize-round.sh          # auto-detects from coordination/NEXT-ROLE.md
#
# Exit codes:
#   0 = round finalized cleanly
#   1 = failure (binding command failed, dirty tree, git error, or integrity check failed)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COORD="$PROJECT_ROOT/coordination"
ROUND=""

usage() {
  echo "Usage: $0 [--round RNN]"
  echo "  --round RNN   Round identifier (e.g., R16). Auto-detects if omitted."
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --round) ROUND="$2"; shift 2 ;;
    --help|-h) usage ;;
    *) echo "ERROR: Unknown argument: $1"; usage ;;
  esac
done

# Auto-detect round from coordination/NEXT-ROLE.md
if [[ -z "$ROUND" ]]; then
  ROUND=$(grep "^CURRENT-ROUND:" "$COORD/NEXT-ROLE.md" 2>/dev/null | awk '{print $2}' || true)
  if [[ -z "$ROUND" ]]; then
    echo "ERROR: Could not auto-detect round from coordination/NEXT-ROLE.md."
    echo "       Set CURRENT-ROUND: RNN in that file, or pass --round RNN."
    exit 1
  fi
  echo "Auto-detected round: $ROUND"
fi

echo "=== Finalizing round $ROUND ==="
echo ""

# ── Step a: Run all 5 binding commands ───────────────────────────────────────
echo "--- Step 1/6: Running binding commands ---"
BINDING_COMMANDS=(
  "npm run typecheck"
  "npm run lint"
  "npm test"
  "npm run test:integration"
  "npm run test:e2e"
)

for cmd in "${BINDING_COMMANDS[@]}"; do
  echo ""
  echo "  Running: $cmd"
  if ! (cd "$PROJECT_ROOT" && eval "$cmd"); then
    echo ""
    echo "ERROR: Binding command failed: $cmd"
    echo "       Fix the failure before finalizing round $ROUND."
    exit 1
  fi
done

echo ""
echo "--- All 5 binding commands passed ---"
echo ""

# ── Step b: Verify clean working tree for src/tests/prisma ───────────────────
echo "--- Step 2/6: Checking working tree ---"
cd "$PROJECT_ROOT"

if ! git diff --quiet src/ tests/ prisma/ 2>/dev/null; then
  echo "ERROR: Uncommitted changes in src/, tests/, or prisma/."
  echo "       Commit or stash all source changes before finalizing."
  git diff --name-only src/ tests/ prisma/
  exit 1
fi

if ! git diff --cached --quiet src/ tests/ prisma/ 2>/dev/null; then
  echo "ERROR: Staged but uncommitted changes in src/, tests/, or prisma/."
  echo "       Commit all source changes before finalizing."
  git diff --cached --name-only src/ tests/ prisma/
  exit 1
fi

echo "Working tree clean for src/, tests/, prisma/."
echo ""

# ── Step c/d: Commit coordination artifacts → SHA-A ──────────────────────────
echo "--- Step 3/6: Committing coordination artifacts ---"

# Check if there's anything to stage/commit in coordination/ or CLAUDE.md
STAGED_CHANGES=$(git diff HEAD -- coordination/ CLAUDE.md 2>/dev/null || true)
UNSTAGED_CHANGES=$(git status --porcelain coordination/ CLAUDE.md 2>/dev/null | grep -v "^??" || true)

if [[ -z "$STAGED_CHANGES" && -z "$UNSTAGED_CHANGES" ]] && \
   git diff --cached --quiet coordination/ CLAUDE.md 2>/dev/null; then
  echo "Nothing to commit in coordination/ or CLAUDE.md."
  echo "SHA-A will be current HEAD."
  SHA_A=$(git rev-parse HEAD)
else
  git add coordination/ CLAUDE.md
  # Check again after staging
  if git diff --cached --quiet; then
    echo "Nothing staged after git add. SHA-A = current HEAD."
    SHA_A=$(git rev-parse HEAD)
  else
    git commit -m "chore($ROUND): coordination artifacts — STATUS: READY"
    SHA_A=$(git rev-parse HEAD)
    echo "Coordination artifacts committed: $SHA_A"
  fi
fi

echo "SHA-A: $SHA_A"
echo ""

# ── Step e: Write SHA-A into coordination/NEXT-ROLE.md ───────────────────────
echo "--- Step 4/6: Recording SHA-A in NEXT-ROLE.md ---"
NEXT_ROLE_FILE="$COORD/NEXT-ROLE.md"

if grep -q "^SHA-A:" "$NEXT_ROLE_FILE" 2>/dev/null; then
  # Replace existing SHA-A line
  sed -i.bak "s/^SHA-A:.*/SHA-A: $SHA_A/" "$NEXT_ROLE_FILE"
  rm -f "${NEXT_ROLE_FILE}.bak"
else
  # Append SHA-A line
  printf '\nSHA-A: %s\n' "$SHA_A" >> "$NEXT_ROLE_FILE"
fi

echo "SHA-A: $SHA_A recorded in NEXT-ROLE.md."
echo ""

# ── Step f: Commit the SHA-A recording ───────────────────────────────────────
echo "--- Step 5/6: Committing SHA-A recording ---"
git add "$NEXT_ROLE_FILE"
git commit -m "chore($ROUND): record attestation SHA"
echo "Attestation commit: $(git rev-parse HEAD)"
echo ""

# ── Step g: Integrity check — no src/tests/prisma changes since SHA-A ────────
echo "--- Step 6/6: Integrity check ---"
if ! git diff --quiet "$SHA_A" HEAD -- src/ tests/ prisma/ 2>/dev/null; then
  echo "ERROR: Source/test/prisma files changed between SHA-A and HEAD."
  echo "       SHA-A: $SHA_A"
  echo "       HEAD:  $(git rev-parse HEAD)"
  echo "       Changed files:"
  git diff --name-only "$SHA_A" HEAD -- src/ tests/ prisma/
  exit 1
fi
echo "Integrity verified: no src/test/prisma changes between SHA-A and HEAD."
echo ""

# ── Step h: Success ───────────────────────────────────────────────────────────
HEAD_SHA=$(git rev-parse HEAD)
echo "=== Round $ROUND finalized. ==="
echo ""
echo "    Recorded SHA-A : $SHA_A"
echo "    Current HEAD   : $HEAD_SHA"
echo "    STATUS         : READY"
echo ""
echo "Reviewer: verify with:"
echo "    git diff $SHA_A HEAD -- src/ tests/ prisma/"
