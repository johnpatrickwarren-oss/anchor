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
#
# WHY A PURE TIME CAP IS NOT ENOUGH — CPU-LIVENESS (verified empirically 2026-05-31):
# A blunt wall-clock cap conflates two DIFFERENT failures, and we caught it killing
# healthy work: on the SQL benchmark a 20-min cap repeatedly guillotined an R04
# Architect session that was STILL MAKING PROGRESS — it just ran long (heavy round +
# high-latency link). Process inspection separates the two cleanly:
#   • FROZEN / stuck  = the `claude` process's CPU time stays FLAT for minutes while a
#     TCP socket to the API sits ESTABLISHED with 0/0 queues — a dead stream that never
#     returns. (Observed: CPU pinned at 24.90 s, unchanged across many minutes.)
#   • WORKING / slow  = CPU keeps ADVANCING (observed ~2 s/min: 17.7→27.4→31.5 s) even
#     though no stdout appears yet (text mode buffers to the end). This session is fine;
#     it just needs more wall-clock.
# So the kill decision is CPU progress, not raw elapsed time:
#   • STALL timeout (primary): kill when CPU gains < ANCHOR_MIN_CPU_DELTA over the last
#     ANCHOR_STALL_TIMEOUT seconds → genuinely stuck → fast recovery (~5 min, not 20).
#   • HARD cap (backstop): kill at ANCHOR_SESSION_TIMEOUT even if CPU is still advancing
#     → catches a runaway/loop. Generous (45 min) so it never guillotines slow-but-live
#     work; the stall timeout, not the hard cap, should be what fires in practice.
# Either kill reports exit 124 (the conventional timeout(1) code), which run_role treats
# as a retryable transient failure and, above it, anchor-auto re-runs the round.
#
# macOS-compatible: macOS ships no timeout(1), no `kill -- -pgid` without job control,
# and no GNU stat — so we poll the clock, read CPU via `ps -o time=`, and walk the
# process tree with pgrep. bash 3.2 compatible.
#
# Two ways to use it:
#   • Executable:  session-watchdog.sh --log F [--stall S] [--hard-cap S] [--poll S] -- cmd...
#                  Runs cmd, teeing combined output to F; exits with cmd's real exit
#                  code, or 124 if killed (frozen stall or hard cap). --timeout is a
#                  back-compat alias for --hard-cap.
#   • Sourced:     source session-watchdog.sh
#                  run_with_session_timeout F -- cmd args...
#                  Sets the global WATCHED_EXIT_CODE (124 if killed). Reads
#                  ANCHOR_STALL_TIMEOUT / ANCHOR_SESSION_TIMEOUT / ANCHOR_WATCHDOG_POLL /
#                  ANCHOR_MIN_CPU_DELTA.
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

# CPU seconds (integer; fractional truncated) consumed by ONE pid. macOS/Linux `ps`
# TIME format is [[DD-]HH:]MM:SS[.ss]; parse defensively, forcing base-10 so leading
# zeros (e.g. "08") don't get read as octal.
_sw_cpu_secs() {
  local t; t="$(ps -o time= -p "$1" 2>/dev/null | tr -d ' ')"
  [[ -z "$t" ]] && { echo 0; return; }
  t="${t%.*}"                                   # drop ".ss"
  local days=0 rest="$t"
  case "$t" in *-*) days="${t%%-*}"; rest="${t#*-}";; esac
  local a b c IFS=:
  read -r a b c <<<"$rest"
  local h=0 m=0 s=0
  if   [[ -n "${c:-}" ]]; then h="$a"; m="$b"; s="$c"
  elif [[ -n "${b:-}" ]]; then m="$a"; s="$b"
  else                          s="$a"; fi
  echo $(( 10#${days:-0}*86400 + 10#${h:-0}*3600 + 10#${m:-0}*60 + 10#${s:-0} ))
}

# Sum CPU seconds across a pid's whole subtree. The real consumer is `claude`; the
# subshell + `tee` are ~0, so the sum tracks the session's actual compute.
_sw_subtree_cpu() {
  local total=0 p
  for p in $(_sw_pids_in_tree "$1"); do
    total=$(( total + $(_sw_cpu_secs "$p") ))
  done
  echo "$total"
}

# run_with_session_timeout LOGFILE [--] cmd args...
# Runs cmd with combined output tee'd (appended) to LOGFILE, killing it when the
# session is FROZEN (no CPU progress for ANCHOR_STALL_TIMEOUT) or exceeds the HARD
# backstop (ANCHOR_SESSION_TIMEOUT) even while making progress. Sets WATCHED_EXIT_CODE
# to cmd's exit code, or 124 if killed. Returns it too.
# Env: ANCHOR_STALL_TIMEOUT  (s, default 300; <=0 disables stall detection)  — primary
#      ANCHOR_SESSION_TIMEOUT (s, default 2700; <=0 disables the hard cap)    — backstop
#      ANCHOR_WATCHDOG_POLL   (s between checks, default 15)
#      ANCHOR_MIN_CPU_DELTA   (CPU-seconds gained per stall window that counts as alive, default 1)
run_with_session_timeout() {
  local role_log="$1"; shift
  [[ "${1:-}" == "--" ]] && shift
  local stall="${ANCHOR_STALL_TIMEOUT:-300}"
  local hard_cap="${ANCHOR_SESSION_TIMEOUT:-2700}"
  local poll="${ANCHOR_WATCHDOG_POLL:-15}"
  local min_delta="${ANCHOR_MIN_CPU_DELTA:-1}"

  : >> "$role_log"  # ensure the log exists even if cmd dies instantly

  # Run `cmd | tee` inside a backgrounded subshell so we can (a) kill the whole
  # subtree (subshell + cmd + tee) on a kill decision and (b) capture cmd's REAL exit
  # code through the pipe via PIPESTATUS, written to a status file only after tee has
  # drained — preserving the "log fully flushed before we read it" guarantee that
  # the caller (run_role) relies on for rate-limit / escalation grepping.
  local status_file
  status_file="$(mktemp "${TMPDIR:-/tmp}/anchor-sw-status.XXXXXX")"
  # The subshell's OWN stderr is redirected to the log so that, when we kill the
  # inner pipeline, bash's "Terminated: 15" job notification lands in the log
  # (harmless — it matches no rate-limit/escalation pattern) instead of spamming the
  # operator's terminal. claude's real stderr is captured separately via 2>&1.
  (
    set -o pipefail
    "$@" 2>&1 | tee -a "$role_log"
    echo "${PIPESTATUS[0]}" > "$status_file"
  ) 2>>"$role_log" &
  local job_pid=$!

  # Poll CPU progress. Reset the stall clock whenever the subtree's CPU advances by
  # >= min_delta since the last reset; this separates a stuck session (flat CPU) from
  # a slow-but-working one (CPU climbing while stdout stays buffered until the end).
  local reason="" start now cpu last_cpu last_progress
  start="$(date +%s)"; last_progress="$start"; last_cpu=0
  while kill -0 "$job_pid" 2>/dev/null; do
    sleep "$poll"
    kill -0 "$job_pid" 2>/dev/null || break
    now="$(date +%s)"
    cpu="$(_sw_subtree_cpu "$job_pid")"
    if [[ $((cpu - last_cpu)) -ge $min_delta ]]; then last_cpu="$cpu"; last_progress="$now"; fi
    if [[ "$stall" -gt 0 ]] 2>/dev/null && [[ $((now - last_progress)) -ge $stall ]]; then
      reason="FROZEN — no CPU progress for ${stall}s (stuck/hung session)"; break
    fi
    if [[ "$hard_cap" -gt 0 ]] 2>/dev/null && [[ $((now - start)) -ge $hard_cap ]]; then
      reason="HARD CAP — ran ${hard_cap}s wall-clock (backstop; CPU was still advancing)"; break
    fi
  done

  if [[ -n "$reason" ]]; then
    printf '\n[session-watchdog] killing session — %s (exit 124).\n' "$reason" >> "$role_log"
    _sw_kill_descendants "$job_pid"
  fi
  wait "$job_pid" 2>/dev/null || true
  local code
  code="$(cat "$status_file" 2>/dev/null || echo '')"
  rm -f "$status_file"
  if [[ -n "$reason" || -z "$code" ]]; then code=124; fi
  WATCHED_EXIT_CODE=$code
  return "$code"
}

# ── CLI mode (only when executed directly, not when sourced) ──────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -uo pipefail
  : "${ANCHOR_STALL_TIMEOUT:=300}"
  : "${ANCHOR_SESSION_TIMEOUT:=2700}"
  : "${ANCHOR_WATCHDOG_POLL:=15}"
  : "${ANCHOR_MIN_CPU_DELTA:=1}"
  _log=""
  _cmd=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --log)       _log="$2"; shift 2 ;;
      --stall)     ANCHOR_STALL_TIMEOUT="$2"; shift 2 ;;
      --hard-cap)  ANCHOR_SESSION_TIMEOUT="$2"; shift 2 ;;
      --timeout)   ANCHOR_SESSION_TIMEOUT="$2"; shift 2 ;;  # back-compat alias for --hard-cap
      --min-cpu)   ANCHOR_MIN_CPU_DELTA="$2"; shift 2 ;;
      --poll)      ANCHOR_WATCHDOG_POLL="$2"; shift 2 ;;
      --)          shift; _cmd=("$@"); break ;;
      -h|--help)   sed -n '2,46p' "$0"; exit 0 ;;
      *) echo "session-watchdog: unknown arg '$1'" >&2; exit 64 ;;
    esac
  done
  [[ -n "$_log" ]]        || { echo "session-watchdog: --log FILE is required" >&2; exit 64; }
  [[ ${#_cmd[@]} -gt 0 ]] || { echo "session-watchdog: no command given after --" >&2; exit 64; }
  run_with_session_timeout "$_log" -- "${_cmd[@]}"
  exit "$WATCHED_EXIT_CODE"
fi
