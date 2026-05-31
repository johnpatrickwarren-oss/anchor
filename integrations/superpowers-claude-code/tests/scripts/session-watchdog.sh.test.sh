#!/bin/bash
# Tests for scripts/session-watchdog.sh — the hung-`claude -p`-session watchdog.
# Covers: existence, arg validation, exit-code/-output passthrough on a healthy
# command, kill+124 on a session that exceeds the cap, no leaked child processes
# after a kill, and the disable switch (timeout 0).
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/session-watchdog.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sw-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

[[ -x "$SCRIPT" ]] || fail "$SCRIPT not found or not executable"

# 1. Unknown flag → non-zero, and missing --log / missing command → non-zero.
"$SCRIPT" --bogus 2>/dev/null            && fail "expected non-zero on unknown flag"
"$SCRIPT" -- echo hi 2>/dev/null         && fail "expected non-zero when --log omitted"
"$SCRIPT" --log "$TMP/x.log" 2>/dev/null && fail "expected non-zero when no command given"

# 2. Healthy command: exit code AND combined output pass through to the log.
log="$TMP/ok.log"
out="$("$SCRIPT" --log "$log" --timeout 30 -- bash -c 'echo to-stdout; echo to-stderr >&2; exit 7')"
rc=$?
[[ $rc -eq 7 ]]                 || fail "expected passthrough exit 7, got $rc"
grep -q 'to-stdout' "$log"      || fail "stdout not captured in log"
grep -q 'to-stderr' "$log"      || fail "stderr (2>&1) not captured in log"
grep -q 'to-stdout' <<<"$out"   || fail "stdout not echoed to terminal"

# 3. Hung session: a command past the cap is killed and reported as 124, quickly.
log2="$TMP/hang.log"
marker="$TMP/should-not-exist"
start=$(date +%s)
# Child writes the marker only AFTER its (long) sleep; if the watchdog truly kills
# it, the marker must never appear.
"$SCRIPT" --log "$log2" --timeout 2 --poll 1 -- \
  bash -c 'sleep 60; touch '"$marker" >/dev/null 2>&1
rc=$?
elapsed=$(( $(date +%s) - start ))
[[ $rc -eq 124 ]]            || fail "expected 124 on cap breach, got $rc"
[[ $elapsed -lt 20 ]]        || fail "watchdog took too long to fire (${elapsed}s)"
grep -q 'session-watchdog' "$log2" || fail "watchdog message not written to log"

# 4. The killed child must actually be dead — no leaked sleep process.
sleep 2
if pgrep -f "sleep 60; touch $marker" >/dev/null 2>&1; then
  fail "child process leaked after watchdog kill"
fi
[[ ! -e "$marker" ]] || fail "child kept running past the kill (marker created)"

# 5. Disable switch: timeout 0 means no cap — a slow-but-finishing command survives.
log3="$TMP/disabled.log"
out3="$("$SCRIPT" --log "$log3" --timeout 0 --poll 1 -- bash -c 'sleep 3; echo done')"
rc=$?
[[ $rc -eq 0 ]]               || fail "expected 0 with cap disabled, got $rc"
grep -q 'done' <<<"$out3"     || fail "disabled-cap command output missing"

echo "PASS: session-watchdog.sh — args, passthrough, kill+124, no leak, disable"
