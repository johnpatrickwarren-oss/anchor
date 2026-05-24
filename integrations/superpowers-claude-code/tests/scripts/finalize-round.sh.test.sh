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
if "$SCRIPT" --invalid-flag 2>/dev/null; then
  echo "FAIL: Expected non-zero exit on unknown flag"
  exit 1
fi

echo "PASS: finalize-round.sh exists, is executable, and rejects unknown flags"
