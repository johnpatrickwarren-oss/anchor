#!/bin/bash
# Smoke test for scripts/check-manifest.sh
# Fails before the script exists (TDD ordering).
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/check-manifest.sh"

if [[ ! -x "$SCRIPT" ]]; then
  echo "FAIL: $SCRIPT not found or not executable"
  exit 1
fi

# Running without --round must exit non-zero
if "$SCRIPT" 2>/dev/null; then
  echo "FAIL: Expected non-zero exit when --round is missing"
  exit 1
fi

echo "PASS: check-manifest.sh exists, is executable, and requires --round"
