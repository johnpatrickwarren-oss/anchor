#!/bin/bash
# finalize-round.sh — exec shim.
#
# The canonical implementation lives at scripts/finalize-round.sh (the copy
# that new-project.sh ships into projects and check-pipeline-sync.sh syncs).
# This shim exists only so historical invocations of ./finalize-round.sh
# from the toolkit root keep working. Do not edit logic here.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/finalize-round.sh" "$@"
