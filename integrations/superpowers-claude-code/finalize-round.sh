#!/bin/bash
# =============================================================================
# finalize-round.sh — one-command round-close for the Anchor pipeline
#
# Implements the two-commit SHA-attestation sequence from CLAUDE-IMPLEMENTER.md.template's
# IMPLEMENTER "On clean completion" steps (the R15 reinforcement, mechanically
# realized):
#
#   1. Run all binding commands; abort on failure.
#   2. Verify source/test/schema directories have no uncommitted changes.
#   3. Commit coordination artifacts (coordination/ + CLAUDE-*.md) → SHA-A.
#   4. Record SHA-A in NEXT-ROLE.md.
#   5. Commit the SHA-A recording → HEAD.
#   6. Integrity-check: no source/test/schema changes between SHA-A and HEAD.
#
# Reviewer verifies the attestation with:
#   git diff <SHA-A> HEAD -- <source-dirs>
# which must exit 0 (nothing source-side changed between the attested SHA
# and HEAD — only NEXT-ROLE.md differs).
#
# Usage:
#   ./scripts/finalize-round.sh                 # auto-detects round from NEXT-ROLE.md
#   ./scripts/finalize-round.sh --round R17     # explicit round
#   ./scripts/finalize-round.sh --help
#
# Configuration (override via env vars before invoking):
#   ANCHOR_BINDING_COMMANDS  Semicolon-separated commands to run as binding
#                            verification. Defaults to a Node.js test stack.
#                            Example:
#                              ANCHOR_BINDING_COMMANDS="npm run typecheck;npm test"
#
#   ANCHOR_SOURCE_DIRS       Space-separated directories whose contents must
#                            not change between SHA-A and HEAD (the "source
#                            domain" for the attestation). Defaults to:
#                              "src/ tests/ prisma/"
#                            Example for a Python project:
#                              ANCHOR_SOURCE_DIRS="src/ tests/ migrations/"
#
# Exit codes:
#   0 = round finalized cleanly
#   1 = binding command failed, dirty source tree, git error, or integrity
#       check failed
# =============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COORD="$PROJECT_ROOT/coordination"
ROUND=""

show_help() {
  awk '/^# ====/ {n++; if (n==2) exit; next} n==1 {sub(/^# ?/, ""); print}' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --round)   ROUND="$2"; shift 2 ;;
    --help|-h) show_help; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; show_help; exit 1 ;;
  esac
done

# ── Configuration with sensible defaults ─────────────────────────────────────
DEFAULT_BINDING_COMMANDS="npm run typecheck;npm run lint;npm test;npm run test:integration;npm run test:e2e"
DEFAULT_SOURCE_DIRS="src/ tests/ prisma/"

BINDING_COMMANDS_RAW="${ANCHOR_BINDING_COMMANDS:-$DEFAULT_BINDING_COMMANDS}"
SOURCE_DIRS_RAW="${ANCHOR_SOURCE_DIRS:-$DEFAULT_SOURCE_DIRS}"

IFS=';' read -ra BINDING_COMMANDS <<<"$BINDING_COMMANDS_RAW"
read -ra SOURCE_DIRS <<<"$SOURCE_DIRS_RAW"

# Auto-detect round from coordination/NEXT-ROLE.md
if [[ -z "$ROUND" ]]; then
  ROUND=$(grep "^CURRENT-ROUND:" "$COORD/NEXT-ROLE.md" 2>/dev/null | awk '{print $2}' || true)
  if [[ -z "$ROUND" ]]; then
    echo "ERROR: Could not auto-detect round from coordination/NEXT-ROLE.md." >&2
    echo "       Set CURRENT-ROUND: RNN in that file, or pass --round RNN." >&2
    exit 1
  fi
  echo "Auto-detected round: $ROUND"
fi

echo "=== Finalizing round $ROUND ==="
echo "  Source dirs: ${SOURCE_DIRS[*]}"
echo "  Binding commands: ${#BINDING_COMMANDS[@]}"
echo ""

# ── Step 1: Run binding commands ─────────────────────────────────────────────
echo "--- Step 1/6: Running binding commands ---"
for cmd in "${BINDING_COMMANDS[@]}"; do
  echo ""
  echo "  Running: $cmd"
  if ! (cd "$PROJECT_ROOT" && eval "$cmd"); then
    echo "" >&2
    echo "ERROR: Binding command failed: $cmd" >&2
    echo "       Fix the failure before finalizing round $ROUND." >&2
    exit 1
  fi
done
echo ""
echo "--- All ${#BINDING_COMMANDS[@]} binding commands passed ---"
echo ""

# ── Step 2: Verify clean working tree for source dirs ────────────────────────
echo "--- Step 2/6: Checking working tree ---"
cd "$PROJECT_ROOT"

if ! git diff --quiet "${SOURCE_DIRS[@]}" 2>/dev/null; then
  echo "ERROR: Uncommitted changes in source dirs (${SOURCE_DIRS[*]})." >&2
  echo "       Commit or stash all source changes before finalizing." >&2
  git diff --name-only "${SOURCE_DIRS[@]}" >&2
  exit 1
fi

if ! git diff --cached --quiet "${SOURCE_DIRS[@]}" 2>/dev/null; then
  echo "ERROR: Staged but uncommitted changes in source dirs (${SOURCE_DIRS[*]})." >&2
  echo "       Commit all source changes before finalizing." >&2
  git diff --cached --name-only "${SOURCE_DIRS[@]}" >&2
  exit 1
fi

echo "Working tree clean for source dirs."
echo ""

# ── Step 3: Commit coordination artifacts → SHA-A ────────────────────────────
echo "--- Step 3/6: Committing coordination artifacts ---"

# Stage coordination/ plus every CLAUDE-*.md file (each role's REINFORCEMENTS
# section is a possible target of this round's Memorial Updater).
CLAUDE_PATHS=(CLAUDE.md CLAUDE-COMMON.md CLAUDE-ARCHITECT.md CLAUDE-IMPLEMENTER.md \
              CLAUDE-REVIEWER.md CLAUDE-MEMORIAL.md)
STAGED_CHANGES=$(git diff HEAD -- coordination/ "${CLAUDE_PATHS[@]}" 2>/dev/null || true)
UNSTAGED_CHANGES=$(git status --porcelain coordination/ "${CLAUDE_PATHS[@]}" 2>/dev/null | grep -v "^??" || true)

if [[ -z "$STAGED_CHANGES" && -z "$UNSTAGED_CHANGES" ]] && \
   git diff --cached --quiet coordination/ "${CLAUDE_PATHS[@]}" 2>/dev/null; then
  echo "Nothing to commit in coordination/ or CLAUDE-*.md."
  echo "SHA-A will be current HEAD."
  SHA_A=$(git rev-parse HEAD)
else
  git add coordination/ "${CLAUDE_PATHS[@]}" 2>/dev/null || true
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

# ── Step 4: Record SHA-A in NEXT-ROLE.md ─────────────────────────────────────
echo "--- Step 4/6: Recording SHA-A in NEXT-ROLE.md ---"
NEXT_ROLE_FILE="$COORD/NEXT-ROLE.md"

if grep -q "^SHA-A:" "$NEXT_ROLE_FILE" 2>/dev/null; then
  sed -i.bak "s/^SHA-A:.*/SHA-A: $SHA_A/" "$NEXT_ROLE_FILE"
  rm -f "${NEXT_ROLE_FILE}.bak"
else
  printf '\nSHA-A: %s\n' "$SHA_A" >>"$NEXT_ROLE_FILE"
fi

echo "SHA-A: $SHA_A recorded in NEXT-ROLE.md."
echo ""

# ── Step 5: Commit the SHA-A recording → HEAD ────────────────────────────────
echo "--- Step 5/6: Committing SHA-A recording ---"
git add "$NEXT_ROLE_FILE"
git commit -m "chore($ROUND): record attestation SHA"
echo "Attestation commit: $(git rev-parse HEAD)"
echo ""

# ── Step 6: Integrity check ──────────────────────────────────────────────────
echo "--- Step 6/6: Integrity check ---"
if ! git diff --quiet "$SHA_A" HEAD -- "${SOURCE_DIRS[@]}" 2>/dev/null; then
  echo "ERROR: Source-dir files changed between SHA-A and HEAD." >&2
  echo "       SHA-A: $SHA_A" >&2
  echo "       HEAD:  $(git rev-parse HEAD)" >&2
  echo "       Changed files:" >&2
  git diff --name-only "$SHA_A" HEAD -- "${SOURCE_DIRS[@]}" >&2
  exit 1
fi
echo "Integrity verified: no source-dir changes between SHA-A and HEAD."
echo ""

# ── Success ──────────────────────────────────────────────────────────────────
HEAD_SHA=$(git rev-parse HEAD)
echo "=== Round $ROUND finalized. ==="
echo ""
echo "    Recorded SHA-A : $SHA_A"
echo "    Current HEAD   : $HEAD_SHA"
echo "    STATUS         : READY"
echo ""
echo "Reviewer: verify with:"
echo "    git diff $SHA_A HEAD -- ${SOURCE_DIRS[*]}"
