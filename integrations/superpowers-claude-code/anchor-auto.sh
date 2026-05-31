#!/bin/bash
# =============================================================================
# anchor-auto — autonomous multi-round orchestrator on top of run-pipeline.sh
#
# Goal: answer the PRD, walk away, come back to a finished project. It decomposes
# the PRD into a SEQUENTIAL round plan, then runs each round through the proven
# per-round pipeline ON ONE WORKING TREE (no worktrees, no merges — the robust
# default), auto-advancing on ROUND-COMPLETE and stopping ONLY on a real issue
# (the pipeline's exit 2 = escalation). Resumable: fix the escalation, re-run with
# --resume, and it continues from the round that stopped.
#
# Why sequential-on-one-tree: every flake in the `anchor project` tool came from
# parallel worktrees + git merge + stop-on-stage-discard. Running rounds serially on
# one tree eliminates that entire failure class — each round simply builds on the
# committed result of the last, exactly like a human operator advancing rounds.
#
# Robustness is inherited, not reinvented: each round is the full run-pipeline.sh
# (claude -p per role, cold-eye review, green-test gate, retry/rate-limit handling).
# This script only adds the loop + auto-advance + escalation gate + resume.
#
# Usage:
#   anchor-auto.sh [--prd coordination/PRD.md] [--resume] [--max-rounds N]
#                  [--decompose-only] [--plan <file>] [--dry-run]
#
# Exit codes:
#   0 = all planned rounds complete (project built)
#   2 = stopped for operator (a round escalated) — resolve, then --resume
#   1 = error (bad plan, missing pipeline, non-convergence after retries)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_PATH="coordination/PRD.md"
PLAN_PATH="coordination/ROUND-PLAN.md"
PROGRESS="coordination/.auto-progress"
RESUME=false
DECOMPOSE_ONLY=false
DRY_RUN=false
MAX_ROUNDS=50
# The PROJECT's own run-pipeline.sh (new-project.sh installs it) — it sets PROJECT_ROOT from its
# OWN location, so it must be the in-project copy, not the toolkit's. Run anchor-auto from the
# project root. (ANCHOR_PIPELINE overrides for tests.)
PIPELINE="${ANCHOR_PIPELINE:-./run-pipeline.sh}"
CLAUDE_BIN="${ANCHOR_CLAUDE:-claude}"                        # overridable for tests
MAX_ROUND_RETRIES="${ANCHOR_ROUND_RETRIES:-1}"               # transient (exit 1) retries per round
COMPLETED=()                                                 # round ids finished so far (for per-round context)
ROUND_PRD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prd)            PRD_PATH="$2"; shift 2 ;;
    --plan)           PLAN_PATH="$2"; shift 2 ;;
    --resume)         RESUME=true; shift ;;
    --decompose-only) DECOMPOSE_ONLY=true; shift ;;
    --max-rounds)     MAX_ROUNDS="$2"; shift 2 ;;
    --dry-run)        DRY_RUN=true; shift ;;
    -h|--help)        sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "anchor-auto: unknown arg $1" >&2; exit 1 ;;
  esac
done

log() { echo "[anchor-auto $(date '+%H:%M:%S')] $*"; }

[[ -f "$PIPELINE" ]] || { echo "anchor-auto: pipeline not found at $PIPELINE" >&2; exit 1; }
[[ -f "$PRD_PATH" ]] || { echo "anchor-auto: PRD not found at $PRD_PATH" >&2; exit 1; }

# ── 1. Decompose the PRD into a sequential round plan (unless resuming / plan given) ──
# The plan is parseable lines: `ANCHOR-ROUND R01: <scope>` in dependency order. Decomposition
# runs the Coordinator role via the pipeline (claude -p) so it inherits the same model/retry
# handling; here we shell to a decompose helper the pipeline exposes. In --dry-run, a plan must
# already exist (so the loop logic can be exercised without a model).
decompose() {
  if $DRY_RUN; then
    [[ -f "$PLAN_PATH" ]] || { echo "anchor-auto: --dry-run needs an existing $PLAN_PATH" >&2; exit 1; }
    log "dry-run: using existing plan $PLAN_PATH"
    return 0
  fi
  log "decomposing $PRD_PATH into a sequential round plan (claude) -> $PLAN_PATH"
  local prompt; prompt="$(cat <<EOF
You are a planning Coordinator. Decompose the project PRD below into the SMALLEST sequence of
build ROUNDS, ordered so each round depends ONLY on earlier ones — they run SEQUENTIALLY on one
codebase, so a later round can build on what earlier rounds produced. Each round must be coherent
and independently buildable + testable. Output ONLY lines in EXACTLY this form, nothing else:
ANCHOR-ROUND R01: <one-line scope>
ANCHOR-ROUND R02: <one-line scope>
Typically 4-12 rounds. Do NOT write code or files — output only the plan lines.

--- PROJECT PRD ---
$(cat "$PRD_PATH")
EOF
)"
  local tries=0 out
  while [[ $tries -lt 3 ]]; do
    out="$("$CLAUDE_BIN" -p "$prompt" 2>&1 || true)"
    if grep -oE 'ANCHOR-ROUND[[:space:]]+R[0-9]+:.*' <<<"$out" > "$PLAN_PATH.tmp" 2>/dev/null && [[ -s "$PLAN_PATH.tmp" ]]; then
      { echo "# Round plan (auto-generated from $PRD_PATH)"; cat "$PLAN_PATH.tmp"; } > "$PLAN_PATH"
      rm -f "$PLAN_PATH.tmp"; log "decomposed into $(grep -c '^ANCHOR-ROUND' "$PLAN_PATH") round(s)."; return 0
    fi
    tries=$((tries + 1)); log "decompose: no ANCHOR-ROUND lines (attempt $tries/3); retrying"
  done
  echo "anchor-auto: decomposition produced no parseable plan after 3 attempts" >&2; exit 1
}

# Parse ordered round ids + scopes from the plan.
parse_rounds() { grep -oE '^ANCHOR-ROUND[[:space:]]+[A-Za-z0-9_-]+' "$PLAN_PATH" | awk '{print $2}'; }
scope_for() { grep -E "^ANCHOR-ROUND[[:space:]]+$1:" "$PLAN_PATH" | head -1 | sed -E "s/^ANCHOR-ROUND[[:space:]]+$1:[[:space:]]*//"; }

# Give the round its OWN PRD (the slice to build + what's already built) and pass it to the
# pipeline via --prd — reusing the existing contract (the Architect reads --prd as the round's
# requirements), so no prompt surgery is needed. Sets ROUND_PRD to the written path.
prime_round() {
  local rid="$1" scope="$2"
  local rprd="coordination/.round-prd-$rid.md"
  {
    echo "# Round $rid"
    echo ""
    echo "You are building ONE round of a larger project, autonomously. Build EXACTLY this round's"
    echo "scope, EXTENDING the existing codebase. Prior rounds are already built and committed —"
    echo "read src/ and REUSE them; do NOT rebuild or duplicate prior work."
    echo ""
    echo "## This round's scope (build this)"
    echo "$scope"
    if [[ ${#COMPLETED[@]} -gt 0 ]]; then
      echo ""; echo "## Already built in prior rounds (present in src/ — extend, don't duplicate)"
      for d in "${COMPLETED[@]}"; do echo "- $d: $(scope_for "$d")"; done
    fi
    echo ""; echo "## Overall project (context only — build only this round's scope)"; echo ""
    cat "$PRD_PATH"
  } > "$rprd"
  # Canonical NEXT-ROLE.md the pipeline expects. It uses the file as-is when CURRENT-ROUND matches
  # --round (treating it as operator-prepared), so this is how we hand it the round's scoped inputs.
  cat > coordination/NEXT-ROLE.md <<EOF
CURRENT-ROUND: $rid
NEXT-ROLE: ARCHITECT
STATUS: READY

## Inputs for next role
- $rprd

## Escalation items
(none)

## Routing notes
Round $rid of an autonomous multi-round build. Build ONLY this round's scope (see the round PRD);
prior rounds are already built and committed in src/.
EOF
  ROUND_PRD="$rprd"
}

if ! $RESUME && ! [[ -f "$PLAN_PATH" ]]; then decompose; fi
[[ -f "$PLAN_PATH" ]] || { echo "anchor-auto: no plan at $PLAN_PATH (run without --resume to decompose)" >&2; exit 1; }

ROUNDS=(); while IFS= read -r __r; do ROUNDS+=("$__r"); done < <(parse_rounds)
[[ ${#ROUNDS[@]} -gt 0 ]] || { echo "anchor-auto: plan has no ANCHOR-ROUND lines" >&2; exit 1; }
log "plan: ${#ROUNDS[@]} round(s) — ${ROUNDS[*]}"
$DECOMPOSE_ONLY && { log "decompose-only: plan written, not executing."; exit 0; }

# ── 2. Resume point ──
START_IDX=0
if $RESUME && [[ -f "$PROGRESS" ]]; then
  last_done="$(cat "$PROGRESS" 2>/dev/null || echo '')"
  for i in "${!ROUNDS[@]}"; do [[ "${ROUNDS[$i]}" == "$last_done" ]] && { START_IDX=$((i + 1)); break; }; done
  for (( j=0; j<START_IDX; j++ )); do COMPLETED+=("${ROUNDS[$j]}"); done   # prior rounds → per-round context
  log "resuming after last completed round '$last_done' -> starting at index $START_IDX"
fi

# ── 3. The loop: run each round on ONE tree, auto-advance, escalate-stop, bounded retry ──
count=0
for (( i=START_IDX; i<${#ROUNDS[@]}; i++ )); do
  rid="${ROUNDS[$i]}"; scope="$(scope_for "$rid")"
  count=$((count + 1)); [[ $count -gt $MAX_ROUNDS ]] && { log "hit --max-rounds $MAX_ROUNDS; stopping."; exit 0; }
  log "── round $rid ($((i + 1))/${#ROUNDS[@]}): $scope"
  prime_round "$rid" "$scope"

  attempt=1; rc=0
  while :; do
    if $DRY_RUN; then "$PIPELINE" --round "$rid" --dry-run; rc=$?; else "$PIPELINE" --round "$rid" --prd "$ROUND_PRD" --auto-tier; rc=$?; fi
    case $rc in
      0) log "round $rid COMPLETE."; echo "$rid" > "$PROGRESS"; COMPLETED+=("$rid"); break ;;
      2) log "round $rid ESCALATED — stopping for operator. Resolve, then: anchor-auto.sh --resume"; exit 2 ;;
      *) if [[ $attempt -lt $((MAX_ROUND_RETRIES + 1)) ]]; then
           log "round $rid failed (exit $rc); retry $attempt/$MAX_ROUND_RETRIES"; attempt=$((attempt + 1)); continue
         fi
         log "round $rid failed (exit $rc) after retries — non-convergence; escalating to operator."; exit 1 ;;
    esac
  done
done

log "ALL ${#ROUNDS[@]} ROUNDS COMPLETE — project built. 🎉"
exit 0
