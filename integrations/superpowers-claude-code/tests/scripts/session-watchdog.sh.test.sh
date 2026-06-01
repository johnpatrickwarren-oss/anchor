#!/bin/bash
# Tests for scripts/session-watchdog.sh — the hung-`claude -p`-session watchdog.
# Covers: existence, arg validation, exit/-output passthrough, no leaked children,
# and the CPU-liveness decision — FROZEN (flat CPU) is killed fast, WORKING (CPU
# climbing) survives the stall window, frozen-after-working is caught, and the hard
# cap backstops a runaway that never stalls.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/session-watchdog.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sw-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

# A CPU burner that runs for ~$1 seconds, accruing CPU IN-PROCESS (spins on the
# SECONDS builtin + ':' — no forks, so the tracked pid's own `ps TIME` climbs, the
# way the real long-lived `claude` process does).
burn() { echo 'while (( SECONDS < '"$1"' )); do :; done'; }

[[ -x "$SCRIPT" ]] || fail "$SCRIPT not found or not executable"

# 1. Arg validation → non-zero.
"$SCRIPT" --bogus 2>/dev/null            && fail "expected non-zero on unknown flag"
"$SCRIPT" -- echo hi 2>/dev/null         && fail "expected non-zero when --log omitted"
"$SCRIPT" --log "$TMP/x.log" 2>/dev/null && fail "expected non-zero when no command given"

# 2. Healthy fast command: exit code + combined output pass through.
log="$TMP/ok.log"
out="$("$SCRIPT" --log "$log" --stall 30 --hard-cap 60 -- bash -c 'echo to-stdout; echo to-stderr >&2; exit 7')"
rc=$?
[[ $rc -eq 7 ]]               || fail "expected passthrough exit 7, got $rc"
grep -q 'to-stdout' "$log"    || fail "stdout not captured in log"
grep -q 'to-stderr' "$log"    || fail "stderr (2>&1) not captured in log"
grep -q 'to-stdout' <<<"$out" || fail "stdout not echoed to terminal"

# 3. FROZEN: a no-CPU sleeper is killed by the stall timeout quickly, reported 124.
log2="$TMP/frozen.log"; marker="$TMP/frozen-marker"
start=$(date +%s)
"$SCRIPT" --log "$log2" --stall 3 --poll 1 --hard-cap 120 -- bash -c 'sleep 60; touch '"$marker" >/dev/null 2>&1
rc=$?; elapsed=$(( $(date +%s) - start ))
[[ $rc -eq 124 ]]            || fail "frozen: expected 124, got $rc"
[[ $elapsed -lt 20 ]]        || fail "frozen: stall fired too slowly (${elapsed}s)"
grep -q 'FROZEN' "$log2"     || fail "frozen: kill reason not logged as FROZEN"
sleep 2
[[ ! -e "$marker" ]]         || fail "frozen: child survived the kill"
pgrep -f "sleep 60; touch $marker" >/dev/null 2>&1 && fail "frozen: leaked child process"

# 4. WORKING: a CPU-burning command that runs LONGER than the stall window must NOT
#    be killed by the stall timeout — CPU progress keeps resetting the clock.
log3="$TMP/working.log"
start=$(date +%s)
out3="$("$SCRIPT" --log "$log3" --stall 3 --poll 1 --hard-cap 120 -- bash -c "$(burn 8); echo finished")"
rc=$?; elapsed=$(( $(date +%s) - start ))
[[ $rc -eq 0 ]]               || fail "working: a busy session was killed (rc=$rc) — stall misfired on live CPU"
grep -q 'finished' <<<"$out3" || fail "working: command output missing"
[[ $elapsed -ge 7 ]]          || fail "working: returned too early (${elapsed}s) — did it really run?"

# 5. FROZEN-AFTER-WORKING (the real wedge shape): burns CPU, then hangs → caught by stall.
log4="$TMP/burn-then-hang.log"
start=$(date +%s)
"$SCRIPT" --log "$log4" --stall 3 --poll 1 --hard-cap 120 -- bash -c "$(burn 3); sleep 60" >/dev/null 2>&1
rc=$?; elapsed=$(( $(date +%s) - start ))
[[ $rc -eq 124 ]]     || fail "burn-then-hang: expected 124, got $rc"
[[ $elapsed -lt 25 ]] || fail "burn-then-hang: stall fired too slowly (${elapsed}s)"
grep -q 'FROZEN' "$log4" || fail "burn-then-hang: not reported FROZEN"

# 6. HARD CAP: a never-stalling CPU burner (CPU always climbing) is still backstopped.
log5="$TMP/hardcap.log"
start=$(date +%s)
"$SCRIPT" --log "$log5" --stall 30 --poll 1 --hard-cap 4 -- bash -c 'while :; do :; done' >/dev/null 2>&1
rc=$?; elapsed=$(( $(date +%s) - start ))
[[ $rc -eq 124 ]]          || fail "hardcap: expected 124, got $rc"
[[ $elapsed -lt 15 ]]      || fail "hardcap: backstop fired too slowly (${elapsed}s)"
grep -q 'HARD CAP' "$log5" || fail "hardcap: kill reason not logged as HARD CAP"
pgrep -f 'while :; do :; done' >/dev/null 2>&1 && fail "hardcap: leaked busy-loop child"

echo "PASS: session-watchdog.sh — args, passthrough, FROZEN-killed-fast, WORKING-survives, burn-then-hang, hard-cap, no leaks"
