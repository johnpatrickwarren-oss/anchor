#!/bin/bash
# =============================================================================
# session-watchdog.sh — cap the wall-clock time of a single `claude -p` role
# session so a transient wedged session can't stall an unattended pipeline run
# forever.
#
# WHY A TOTAL-TIME CAP, NOT AN IDLE-OUTPUT TIMER (verified empirically 2026-05-31):
# `claude -p` in the pipeline's default text output mode emits NOTHING to stdout
# until the session ends — it buffers the whole result and prints it in one burst
# at completion. So "the role log stopped growing" is NOT a hang signal: a healthy
# opus Architect session runs 7–11 min with a 0-byte log the ENTIRE time, then
# writes ~2 KB at the very end. The only signal that separates healthy from wedged
# is total elapsed time. In the SQL-engine benchmark, healthy role sessions finished
# in ≤673 s (opus Architect, the heaviest role), while a transient wedged Architect
# ran >22 min with a 0-byte log and never returned (ARCHITECT-R04.log == 0 bytes).
# So we cap each session at a wall-clock limit and, past it, kill the whole process
# subtree and report exit 124 (the conventional timeout(1) code), which the
# pipeline's run_role already treats as a retryable transient failure — and above
# that, anchor-auto re-runs the round. The default (1200 s = 20 min) is ~1.8× the
# heaviest healthy session observed and well below the wedge it's meant to catch.
#
# macOS-compatible: macOS ships no timeout(1), no `kill -- -pgid` without job
# control, and no GNU stat — so we poll the clock and walk the process tree with
# pgrep. bash 3.2 compatible.
#
# Two ways to use it:
#   • Executable:  session-watchdog.sh --log F [--timeout S] [--poll S] -- cmd args...
#                  Runs cmd, teeing combined output to F; exits with cmd's real exit
#                  code, or 124 if the session was killed for exceeding the cap.
#   • Sourced:     source session-watchdog.sh
#                  run_with_session_timeout F -- cmd args...
#                  Sets the global WATCHED_EXIT_CODE (124 if killed) so the caller
#                  can log/branch. Reads ANCHOR_SESSION_TIMEOUT / ANCHOR_WATCHDOG_POLL.
# =============================================================================

# Echo a pid and all its descendants (children recursed first, so callers can
# TERM/KILL the whole subtree). Uses pgrep -P, present on macOS and Linux.
_sw_pids_in_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    _sw_pids_in_tree "$child"
  done
  echo "$pid"
}

# TERM a process subtree, allow a short grace period, then KILL any survivors.
_sw_kill_tree() {
  local root="$1" pids p waited=0 alive
  pids="$(_sw_pids_in_tree "$root")"
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
  while [[ $waited -lt 5 ]]; do
    alive=0
    for p in $pids; do kill -0 "$p" 2>/dev/null && { alive=1; break; }; done
    [[ $alive -eq 0 ]] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  for p in $pids; do kill -KILL "$p" 2>/dev/null || true; done
}

# Kill every DESCENDANT subtree of a pid, but not the pid itself. We use this on
# the backgrounded subshell so its `cmd | tee` pipeline (the descendants) dies
# while the subshell is left to exit on its own — that way the parent shell sees a
# normal child exit and does NOT print a "Terminated: 15" job notification to the
# log. The caller's killed=1 flag, not the subshell's status, decides the 124.
_sw_kill_descendants() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    _sw_kill_tree "$child"
  done
}

# run_with_session_timeout LOGFILE [--] cmd args...
# Runs cmd with combined output tee'd (appended) to LOGFILE under a wall-clock cap.
# Sets WATCHED_EXIT_CODE to cmd's exit code, or 124 if the cap fired. Returns it too.
# Env: ANCHOR_SESSION_TIMEOUT (seconds, default 1200; <=0 disables the cap),
#      ANCHOR_WATCHDOG_POLL (seconds between checks, default 10).
run_with_session_timeout() {
  local role_log="$1"; shift
  [[ "${1:-}" == "--" ]] && shift
  local limit="${ANCHOR_SESSION_TIMEOUT:-1200}"
  local poll="${ANCHOR_WATCHDOG_POLL:-10}"

  : >> "$role_log"  # ensure the log exists even if cmd dies instantly

  # Run `cmd | tee` inside a backgrounded subshell so we can (a) kill the whole
  # subtree (subshell + cmd + tee) on timeout and (b) capture cmd's REAL exit code
  # through the pipe via PIPESTATUS, written to a status file only after tee has
  # drained — preserving the "log fully flushed before we read it" guarantee that
  # the caller (run_role) relies on for rate-limit / escalation grepping.
  local status_file
  status_file="$(mktemp "${TMPDIR:-/tmp}/anchor-sw-status.XXXXXX")"
  # The subshell's OWN stderr is redirected to the log so that, when we kill the
  # inner pipeline on timeout, bash's "Terminated: 15" job notification lands in the
  # log (harmless — it matches no rate-limit/escalation pattern) instead of spamming
  # the operator's terminal. claude's real stderr is captured separately via 2>&1.
  (
    set -o pipefail
    "$@" 2>&1 | tee -a "$role_log"
    echo "${PIPESTATUS[0]}" > "$status_file"
  ) 2>>"$role_log" &
  local job_pid=$!

  local killed=0
  if [[ "$limit" -gt 0 ]] 2>/dev/null; then
    local start now
    start="$(date +%s)"
    while kill -0 "$job_pid" 2>/dev/null; do
      sleep "$poll"
      kill -0 "$job_pid" 2>/dev/null || break
      now="$(date +%s)"
      if [[ $((now - start)) -ge $limit ]]; then
        killed=1
        printf '\n[session-watchdog] session exceeded %ss wall-clock — killing as hung (exit 124).\n' \
          "$limit" >> "$role_log"
        _sw_kill_descendants "$job_pid"
        break
      fi
    done
  fi

  wait "$job_pid" 2>/dev/null || true
  local code
  code="$(cat "$status_file" 2>/dev/null || echo '')"
  rm -f "$status_file"
  if [[ $killed -eq 1 || -z "$code" ]]; then code=124; fi
  WATCHED_EXIT_CODE=$code
  return "$code"
}

# ── CLI mode (only when executed directly, not when sourced) ──────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -uo pipefail
  : "${ANCHOR_SESSION_TIMEOUT:=1200}"
  : "${ANCHOR_WATCHDOG_POLL:=10}"
  _log=""
  _cmd=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --log)     _log="$2"; shift 2 ;;
      --timeout) ANCHOR_SESSION_TIMEOUT="$2"; shift 2 ;;
      --poll)    ANCHOR_WATCHDOG_POLL="$2"; shift 2 ;;
      --)        shift; _cmd=("$@"); break ;;
      -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
      *) echo "session-watchdog: unknown arg '$1'" >&2; exit 64 ;;
    esac
  done
  [[ -n "$_log" ]]        || { echo "session-watchdog: --log FILE is required" >&2; exit 64; }
  [[ ${#_cmd[@]} -gt 0 ]] || { echo "session-watchdog: no command given after --" >&2; exit 64; }
  run_with_session_timeout "$_log" -- "${_cmd[@]}"
  exit "$WATCHED_EXIT_CODE"
fi
