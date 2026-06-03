#!/bin/bash
# check-pipeline-sync.sh — canonical-sync drift detector.
#
# Compares this project's pipeline files against the canonical at
# ~/anchor/integrations/superpowers-claude-code/ and reports any
# byte-level differences. Reports drift direction via mtime heuristic.
#
# Usage:
#   ./scripts/check-pipeline-sync.sh
#
# Environment:
#   CANONICAL_DIR  Override canonical path (default: ~/anchor/integrations/superpowers-claude-code)
#                  Used by the smoke test to inject a controlled temp directory.
#
# Exit codes:
#   0 = all present files are byte-identical to canonical (or canonical absent)
#   1 = drift detected — see report

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL="${CANONICAL_DIR:-$HOME/anchor/integrations/superpowers-claude-code}"

# ── Graceful absent-canonical handling ────────────────────────────────────────
if [[ ! -d "$CANONICAL" ]]; then
  echo "WARN: Canonical not present at $CANONICAL; sync check skipped."
  exit 0
fi

# ── Files to compare (relative paths, same on both sides) ─────────────────────
FILES=(
  "run-pipeline.sh"
  "scripts/finalize-round.sh"
  "scripts/check-manifest.sh"
  "scripts/check-lint-baseline.sh"
  "scripts/check-pipeline-sync.sh"
)

# new-project.sh: optional — only compare if present locally
if [[ -f "$PROJECT_ROOT/new-project.sh" ]]; then
  FILES+=("new-project.sh")
fi

# ── Compare each file ─────────────────────────────────────────────────────────
DRIFT_FOUND=false

for REL in "${FILES[@]}"; do
  LOCAL="$PROJECT_ROOT/$REL"
  CANON="$CANONICAL/$REL"

  # Skip files not present locally (only new-project.sh falls through here
  # for other projects; the guard above already handles the optional case)
  [[ -f "$LOCAL" ]] || continue

  # Canonical counterpart missing
  if [[ ! -f "$CANON" ]]; then
    echo "DRIFT: $REL — no canonical counterpart at $CANON"
    DRIFT_FOUND=true
    continue
  fi

  # Byte-for-byte comparison (silent)
  if ! cmp -s "$LOCAL" "$CANON"; then
    DRIFT_FOUND=true
    # Direction via mtime
    if [[ "$LOCAL" -nt "$CANON" ]]; then
      DIRECTION="project newer than canonical"
    elif [[ "$LOCAL" -ot "$CANON" ]]; then
      DIRECTION="canonical newer than project"
    else
      DIRECTION="content differs (mtime equal)"
    fi
    echo "DRIFT: $REL — $DIRECTION"
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
if $DRIFT_FOUND; then
  echo ""
  echo "To inspect: diff \$PROJECT_FILE \$CANONICAL_FILE"
  echo "Canonical: $CANONICAL"
  exit 1
fi

exit 0
