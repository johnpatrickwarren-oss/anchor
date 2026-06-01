#!/bin/bash
# Fetch the third-party deps the full prototype needs (NOT committed: ~4.3M suite + node_modules).
# The self-contained gate regression test (test-gate.mjs) needs NONE of this.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor
if [ ! -d vendor/JSON-Schema-Test-Suite ]; then
  echo "cloning official JSON-Schema-Test-Suite -> vendor/ ..."
  git clone --depth 1 https://github.com/json-schema-org/JSON-Schema-Test-Suite.git vendor/JSON-Schema-Test-Suite
fi
echo "installing ajv (reference validator, used only to re-validate grade.mjs) ..."
npm i ajv@8 >/dev/null 2>&1 || npm i ajv@8
echo "done. The official suite lives at vendor/JSON-Schema-Test-Suite (grade.mjs finds it there by default;"
echo "override with JSS_SUITE=<path>)."
