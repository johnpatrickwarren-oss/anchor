#!/bin/bash
# =============================================================================
# Anchor + Superpowers Autonomous Pipeline — v2
#
# Fixes from v1:
#   - Superpowers disciplines inlined; no MCP dependency in headless mode
#   - Per-role model routing (Opus 4.7 for Architect/Reviewer, Sonnet for rest)
#   - Retry logic with exponential backoff on transient failures
#   - Rate limit detection and wait/resume
#   - Permission mode detection with --dangerously-skip-permissions fallback
#   - Exit code captured correctly through tee pipe via PIPESTATUS
#   - BLOCKED state written on unrecoverable failure; no ambiguous partial state
#   - Task budget / max-turns flag injected per role (prevents runaway burns)
#   - --model flag availability checked before use
#   - Pre-flight warns on prior BLOCKED state instead of silently overwriting
#
# Usage:
#   ./run-pipeline.sh [options]
#
# Options:
#   --round R01          Round identifier (default: R01)
#   --start-at ROLE      Resume from a specific role (after resolving escalation)
#   --prd PATH           Path to PRD (default: coordination/PRD.md)
#   --tier solo|audit|full   Pipeline tier (default: full)
#                              full  = full Anchor (Architect + Implementer +
#                                      Reviewer + Memorial)
#                              audit = Implementer + Reviewer + Memorial
#                                      (Implementer writes its own thin spec;
#                                      no separate Architect)
#                              solo  = Implementer only (spec, execute, memorial
#                                      all inline in one session; no separate
#                                      Reviewer or Memorial-Updater). Cheapest
#                                      but loses the cold-eye Reviewer safety
#                                      net — use only for mechanical / doc-only
#                                      / test-only / cosmetic rounds.
#                            Backward-compat: T0 / T1 / T3 are accepted as
#                            aliases for solo / audit / full with a deprecation
#                            warning. The older names collided with Anchor's
#                            four-anchor checkpoint naming (T0/T1/T2/T3); the
#                            verbal names avoid that collision.
#                            See skills/11-round-scaling.md in canonical anchor
#                            for the full rubric (A1–A7 / S1–S5 / Z1–Z5).
#                            When in doubt, pick full.
#   --dry-run            Print what would run without executing
#   --no-model-routing   Use CLAUDE_DEFAULT_MODEL for all roles
#
# Exit codes:
#   0 = success (MERGE-READY or ROUND-COMPLETE)
#   1 = error (check logs)
#   2 = escalation (human decision needed — see coordination/NEXT-ROLE.md)
# =============================================================================

set -uo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
COORD="$PROJECT_ROOT/coordination"
CROSS_MEMORIAL="$HOME/.claude/CROSS-PROJECT-MEMORIAL.md"
LOG_DIR="$COORD/logs"

ROUND="R01"
START_AT=""
PRD_PATH="$COORD/PRD.md"
DRY_RUN=false
MODEL_ROUTING=true
TIER="full"
RESET_NEXT_ROLE=false

# Model routing
# Opus 4.7: Architect (design reasoning) and Reviewer (adversarial audit)
# Sonnet 4.6: Implementer (execution against spec) and Memorial (synthesis)
# Rationale: Opus 4.7's gains are concentrated in hard reasoning and agentic
# file-system memory — exactly what design and adversarial audit need.
# Sonnet 4.6 handles implementation execution and bookkeeping at 40% lower cost.
MODEL_ARCHITECT="claude-opus-4-7"
MODEL_IMPLEMENTER="claude-sonnet-4-6"
MODEL_REVIEWER="claude-opus-4-7"
# Two model candidates for MU; selector chooses between them per directive content.
MODEL_MEMORIAL_DEFAULT="claude-haiku-4-5-20251001"   # ~3× cost reduction vs Sonnet (R74)
MODEL_MEMORIAL_SONNET="claude-sonnet-4-6"             # fallback for substantive cross-round work
MODEL_MEMORIAL=""                                     # resolved at TIER-decision time
MU_FALLBACK_RATIONALE=""
MODEL_COORDINATOR="claude-opus-4-7"
MODEL_DEFAULT="claude-sonnet-4-6"

# Hybrid Reviewer: when HYBRID_REVIEWER=true AND tier=audit, the Reviewer stage
# dispatches Opus + Sonnet in parallel, then runs a merger to deduplicate.
# Evidence base: coordination/EVAL-SONNET-REVIEWER-2026-05-15.md (Sonnet catches
# procedural violations Opus missed; Opus catches AC-literal narrowings Sonnet
# missed — complementary biases). Cost +20% vs Opus-only; coverage union of both.
HYBRID_REVIEWER=${HYBRID_REVIEWER:-false}
MODEL_REVIEWER_SECONDARY="claude-sonnet-4-6"
MODEL_REVIEWER_MERGER="claude-sonnet-4-6"

# Retry / rate limit
MAX_RETRIES=3
RETRY_BASE_SLEEP=30     # seconds; doubles each retry
RATE_LIMIT_SLEEP=120    # seconds to wait on 429 / quota errors

# Task budgets as max-turns proxy
# Higher = more autonomous depth; lower = tighter cost control
# Adjust based on project complexity and observed token burn
BUDGET_ARCHITECT=60
BUDGET_IMPLEMENTER=120
BUDGET_REVIEWER=60
BUDGET_REVIEWER_MERGER=30
BUDGET_MEMORIAL=30
BUDGET_COORDINATOR=80

# Populated by detect_claude_flags()
PERMISSION_FLAG=()
MODEL_FLAG_SUPPORTED=false
BUDGET_FLAG_SUPPORTED=false

# ── Argument parsing ──────────────────────────────────────────────────────────
COORDINATOR_MODE=false
WAVE_GATE_MODE=false
WAVE_GATE_ID=""
CONSOLIDATION_REVIEWER=false
AUTO_TIER=false
TIER_EXPLICIT=false
MU_SONNET=false
REVIEWER_SCOPE_EXPLICIT=""   # set by --reviewer-scope flag
REVIEWER_SCOPE=""            # resolved after TIER is finalized
ROUTER_OUT=""                # populated by --auto-tier block; empty otherwise
while [[ $# -gt 0 ]]; do
  case $1 in
    --round)            ROUND="$2";        shift 2 ;;
    --start-at)         START_AT="$2";     shift 2 ;;
    --prd)              PRD_PATH="$2";     shift 2 ;;
    --tier)             TIER="$2"; TIER_EXPLICIT=true; shift 2 ;;
    --dry-run)          DRY_RUN=true;      shift   ;;
    --hybrid-reviewer)  HYBRID_REVIEWER=true; shift ;;
    --no-model-routing) MODEL_ROUTING=false; shift  ;;
    --reset-next-role)  RESET_NEXT_ROLE=true; shift ;;
    --coordinator)      COORDINATOR_MODE=true; shift ;;
    --wave-gate)        WAVE_GATE_MODE=true; WAVE_GATE_ID="$2"; shift 2 ;;
    --auto-tier)        AUTO_TIER=true;    shift   ;;
    --mu-sonnet)        MU_SONNET=true;    shift   ;;
    --reviewer-scope)   REVIEWER_SCOPE_EXPLICIT="$2"; shift 2 ;;
    --consolidation-reviewer) CONSOLIDATION_REVIEWER=true; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: ./run-pipeline.sh [options]

Options:
  --round R01          Round identifier (default: R01)
  --start-at ROLE      Resume from a specific role (after resolving escalation)
  --prd PATH           Path to PRD (default: coordination/PRD.md)
  --tier solo|audit|full
                       Pipeline tier (default: full)
                         full  = Architect + Implementer + Reviewer + Memorial
                         audit = Implementer + Reviewer + Memorial (no Architect)
                         solo  = Implementer only (mechanical / doc-only rounds)
                       Backward-compat: T0/T1/T3 still accepted (deprecation
                       warning emitted). See skills/11-round-scaling.md.
  --dry-run            Print what would run without executing
  --hybrid-reviewer    Force hybrid Reviewer (Opus + Sonnet merged). Mandatory for
                       close-walk class rounds; see CLAUDE-COORDINATOR.md. Also
                       auto-triggered by scripts/finalize-round.sh when
                       CLOSE-WALK-CLASS: true is set in coordination/NEXT-ROLE.md.
  --no-model-routing   Use CLAUDE_DEFAULT_MODEL for all roles
  --reset-next-role    Overwrite coordination/NEXT-ROLE.md with the auto-init
                       template even when it shows a different CURRENT-ROUND.
                       Default behavior refuses to overwrite (preserves
                       operator-prepared inputs); use this only when the
                       existing file has no content worth keeping.
  --coordinator        Coordinator-only mode (multi-cluster prep). Overrides
                       --tier; runs ONLY the Coordinator role to produce
                       a wave plan (coordination/WAVE-PLAN-NN.md per
                       templates/WAVE-PLAN-TEMPLATE.md). Does not dispatch
                       clusters — emits the plan; operator reviews + invokes
                       scripts/multi-track-cluster-setup.sh per cluster.
                       See CLAUDE-COORDINATOR.md for role discipline.
  --wave-gate WAVE-NN  Coordinator wave-gate close (use with --coordinator).
                       Runs scripts/verify-wave-aggregate.sh WAVE-NN, detects
                       solo-tier clusters, and fires a mandatory tier-aware
                       consolidation Reviewer if any cluster ran --tier solo.
                       See CLAUDE-COORDINATOR.md § Wave gate discipline.
  --consolidation-reviewer
                       Force consolidation Reviewer at wave-gate close, even
                       when all clusters ran audit/full tiers (which provide
                       per-cluster cold-eye). Requires --coordinator --wave-gate.
                       Without --wave-gate, this flag is silently ignored.

Exit codes:
  0 = success (MERGE-READY or ROUND-COMPLETE)
  1 = error (check logs)
  2 = escalation (human decision needed — see coordination/NEXT-ROLE.md)
EOF
      exit 0 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Auto-tier integration (R73) ───────────────────────────────────────────────
# When --auto-tier is passed without an explicit --tier, invoke the heuristic router
# against coordination/NEXT-ROLE.md and set TIER from the router output.
# Explicit --tier always wins; auto-tier is advisory when no explicit tier is given.
if [[ "$AUTO_TIER" == "true" && "$TIER_EXPLICIT" != "true" ]]; then
  ROUTER_OUT="$(node scripts/tier-router.js --mode hybrid 2>/dev/null)" || true
  if [[ -n "$ROUTER_OUT" ]]; then
    ROUTER_TIER="$(echo "$ROUTER_OUT" | node -e \
      "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try{console.log(JSON.parse(d).tier)}catch{} })" 2>/dev/null)" || true
    case "$ROUTER_TIER" in
      full)             TIER="full" ;;
      audit)            TIER="audit" ;;
      implementer-only) TIER="solo" ;;
      coordinator-only) COORDINATOR_MODE=true ;;
    esac
    echo "INFO:  --auto-tier: router recommended '$ROUTER_TIER'; TIER set to '$TIER'" >&2
  else
    echo "WARN:  --auto-tier: router failed or unavailable; defaulting to TIER='full'" >&2
  fi
fi

# ── MU model selection (R74) ──────────────────────────────────────────────────
# Default: Haiku 4.5 (~3× cost vs Sonnet for routine pattern-matching MU work).
# Sonnet fallback when (a) --mu-sonnet flag set OR (b) tier=full AND directive
# contains cross-round-pattern marker. Selector mechanism at scripts/mu-model-select.ts.
MU_SELECT_OUT=""
if [[ "$TIER" == "solo" ]] || $COORDINATOR_MODE; then
  MODEL_MEMORIAL="$MODEL_MEMORIAL_DEFAULT"   # MU not dispatched; value irrelevant but set for log
  MU_FALLBACK_RATIONALE="MU not dispatched on this tier"
else
  if [ "$MU_SONNET" = "true" ]; then
    MU_SELECT_OUT="$(node scripts/mu-model-select.js --directive "$COORD/NEXT-ROLE.md" --tier "$TIER" --mu-sonnet 2>/dev/null)" || true
  else
    MU_SELECT_OUT="$(node scripts/mu-model-select.js --directive "$COORD/NEXT-ROLE.md" --tier "$TIER" 2>/dev/null)" || true
  fi
  if [[ -n "$MU_SELECT_OUT" ]]; then
    MU_MODEL_RAW="$(echo "$MU_SELECT_OUT" | node -e \
      "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try{const j=JSON.parse(d); console.log(j.model+'|'+(j.rationale||''))}catch{} })" 2>/dev/null)" || true
    MU_MODEL_FIELD="${MU_MODEL_RAW%%|*}"
    MU_FALLBACK_RATIONALE="${MU_MODEL_RAW#*|}"
    case "$MU_MODEL_FIELD" in
      claude-haiku-*)  MODEL_MEMORIAL="$MODEL_MEMORIAL_DEFAULT" ;;
      claude-sonnet-*) MODEL_MEMORIAL="$MODEL_MEMORIAL_SONNET"  ;;
      *)               MODEL_MEMORIAL="$MODEL_MEMORIAL_DEFAULT"
                       MU_FALLBACK_RATIONALE="selector returned unexpected model; fallback haiku"
                       ;;
    esac
  else
    MODEL_MEMORIAL="$MODEL_MEMORIAL_DEFAULT"
    MU_FALLBACK_RATIONALE="selector unavailable; fallback haiku"
  fi
fi

# ── Reviewer scope selection (R74) ────────────────────────────────────────────
if [[ -n "$REVIEWER_SCOPE_EXPLICIT" ]]; then
  case "$REVIEWER_SCOPE_EXPLICIT" in
    full|structural) REVIEWER_SCOPE="$REVIEWER_SCOPE_EXPLICIT" ;;
    *) echo "ERROR: --reviewer-scope must be 'full' or 'structural'; got '$REVIEWER_SCOPE_EXPLICIT'" >&2; exit 1 ;;
  esac
else
  case "$TIER" in
    full)  REVIEWER_SCOPE="full" ;;
    audit) REVIEWER_SCOPE="structural" ;;
    *)     REVIEWER_SCOPE="" ;;   # solo / coordinator-only: Reviewer not invoked; empty
  esac
fi

# ── Routing log (R74; extends R73 auto-tier log) ──────────────────────────────
mkdir -p coordination/logs
ROUTING_LOG="coordination/logs/ROUND-${ROUND}-ROUTING.md"
{
  echo "# Round ${ROUND} routing"
  echo ""
  echo "## Tier"
  if $AUTO_TIER && [[ "$TIER_EXPLICIT" != "true" ]]; then
    echo "Source: --auto-tier"
  elif [[ "$TIER_EXPLICIT" == "true" ]]; then
    echo "Source: explicit --tier ${TIER}"
  else
    echo "Source: pipeline default"
  fi
  echo "Final TIER: ${TIER}"
  if [[ -n "${ROUTER_OUT:-}" ]]; then
    echo "Router output: ${ROUTER_OUT}"
  fi
  echo ""
  echo "## MU model"
  echo "Model: ${MODEL_MEMORIAL}"
  echo "Rationale: ${MU_FALLBACK_RATIONALE}"
  if [[ -n "${MU_SELECT_OUT:-}" ]]; then
    echo "Selector output: ${MU_SELECT_OUT}"
  fi
  echo ""
  echo "## Reviewer scope"
  if [[ -z "$REVIEWER_SCOPE" ]]; then
    echo "Scope: (not invoked on this tier)"
  else
    echo "Scope: ${REVIEWER_SCOPE}"
    if [[ -n "$REVIEWER_SCOPE_EXPLICIT" ]]; then
      echo "Source: explicit --reviewer-scope ${REVIEWER_SCOPE_EXPLICIT}"
    else
      echo "Source: default for tier=${TIER}"
    fi
  fi
} > "$ROUTING_LOG"

# R75: cache-prefix telemetry. Measures the byte-identical PREFIX (load-bearing
# for Anthropic prompt-cache hits across role sessions). Emitted once at
# pipeline startup; per-role tail bytes recorded by run_role() on dispatch.
{
  echo ""
  echo "## Cache-prefix telemetry"
  if [[ -f "$PROJECT_ROOT/scripts/measure-cache-effect.js" ]]; then
    measure_out=""
    if measure_out=$(node "$PROJECT_ROOT/scripts/measure-cache-effect.js" \
        --round "$ROUND" \
        --project-root "$PROJECT_ROOT" 2>/dev/null); then
      echo "Measurer: scripts/measure-cache-effect.js"
      echo "Output: ${measure_out}"
    else
      echo "Measurer: scripts/measure-cache-effect.js (invocation failed; no telemetry)"
    fi
  else
    echo "Measurer: not-yet-compiled (R75-pre-chore-A or fresh clone before pretest)"
  fi
} >> "$ROUTING_LOG"

# ── Tier configuration ────────────────────────────────────────────────────────
# full (default): full Anchor — Architect writes spec, Implementer executes,
#                 Reviewer audits cold, Memorial records.
# audit:          no separate Architect. Implementer applies brainstorm+design
#                 inline, writes a thin spec, then executes. Reviewer + Memorial
#                 still run. Use for small features where the per-round cost of
#                 a separate Architect role outweighs its quality contribution.
# solo:           Implementer only. Spec, execute, memorial inline.
#                 Use only for mechanical / doc-only / test-only / cosmetic
#                 rounds where visual diff inspection replaces cold-eye review.
#
# Backward-compat: T0 / T1 / T3 aliases for solo / audit / full. The older
# names collided with Anchor's four-anchor checkpoint naming (T0/T1/T2/T3);
# the verbal names are now canonical.
case "$TIER" in
  T0)
    echo "WARN:  --tier T0 is deprecated; use --tier solo (same behavior)" >&2
    TIER="solo"
    ;;
  T1)
    echo "WARN:  --tier T1 is deprecated; use --tier audit (same behavior)" >&2
    TIER="audit"
    ;;
  T3)
    echo "WARN:  --tier T3 is deprecated; use --tier full (same behavior)" >&2
    TIER="full"
    ;;
esac

case "$TIER" in
  solo)
    ROLES=("IMPLEMENTER")
    TIER_DESC="solo (Implementer handles spec, execute, memorial inline — no Reviewer)"
    ;;
  audit)
    ROLES=("IMPLEMENTER" "REVIEWER" "MEMORIAL-UPDATER")
    TIER_DESC="audit (Implementer writes thin spec + executes; Reviewer audits cold)"
    ;;
  full)
    ROLES=("ARCHITECT" "IMPLEMENTER" "REVIEWER" "MEMORIAL-UPDATER")
    TIER_DESC="full (Architect + Implementer + Reviewer + Memorial)"
    ;;
  *)
    echo "Unsupported --tier value: '$TIER'. Valid: solo, audit, full (or legacy T0/T1/T3)."
    exit 1
    ;;
esac

# --coordinator overrides tier-derived ROLES entirely. Coordinator mode runs
# ONLY the Coordinator role to produce a wave plan; cluster dispatch is a
# separate operator step (scripts/multi-track-cluster-setup.sh per cluster).
#
# --coordinator --wave-gate WAVE-NN: Coordinator wave-gate close flow.
# Runs verify-wave-aggregate.sh, detects solo-tier clusters, and fires a
# mandatory tier-aware consolidation Reviewer if any cluster ran --tier solo.
# See CLAUDE-COORDINATOR.md § "Tier-aware consolidation Reviewer at wave-gate close".
if $COORDINATOR_MODE; then
  if $WAVE_GATE_MODE; then
    ROLES=("COORDINATOR-WAVE-GATE")
    TIER_DESC="coordinator-wave-gate (aggregate verifier + tier-aware consolidation Reviewer)"
  else
    ROLES=("COORDINATOR")
    TIER_DESC="coordinator (PRD → DAG → wave plan; cluster dispatch is separate)"
  fi
fi

FIRST_ROLE="${ROLES[0]}"

mkdir -p "$LOG_DIR"
PIPELINE_LOG="$LOG_DIR/pipeline-${ROUND}.log"

# ── Logging ───────────────────────────────────────────────────────────────────
log()         { echo "[$(date '+%H:%M:%S')] $*"        | tee -a "$PIPELINE_LOG"; }
log_section() {
  echo ""                                               | tee -a "$PIPELINE_LOG"
  log "══════════════════════════════════════════════"
  log "  $*"
  log "══════════════════════════════════════════════"
}
log_warn()    { log "WARN:  $*"; }
log_error()   { log "ERROR: $*"; }

# ── Round lockfile ────────────────────────────────────────────────────────────
# Prevents two pipeline instances from running concurrently on the same round.
# Two parallel pipelines writing to the same coordination/ files race each other
# (observed in R10: two REVIEWERs both wrote NEXT-ROLE.md; the second won).
# Lockfile is per-round, so different rounds can still run in parallel.
LOCKFILE=""
LOCK_HELD=false

cleanup_lock() {
  # Only remove the lockfile if we acquired it (don't delete someone else's).
  if $LOCK_HELD && [[ -n "$LOCKFILE" && -f "$LOCKFILE" ]]; then
    rm -f "$LOCKFILE"
  fi
}
trap cleanup_lock EXIT

acquire_round_lock() {
  LOCKFILE="$COORD/.pipeline-${ROUND}.lock"
  if [[ -f "$LOCKFILE" ]]; then
    local lock_pid
    lock_pid=$(awk -F': ' '/^PID:/ {print $2; exit}' "$LOCKFILE" 2>/dev/null)
    if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
      log_error "Another pipeline is already running for round $ROUND."
      log_error "  Lockfile: $LOCKFILE"
      log_error "  Live PID: $lock_pid"
      log_error ""
      log_error "Wait for that pipeline to finish, or kill the process before retrying."
      log_error "If you are certain the lockfile is stale (process died without cleanup),"
      log_error "remove it manually: rm \"$LOCKFILE\""
      exit 2
    else
      log_warn "Stale lockfile at $LOCKFILE (PID $lock_pid not alive); removing."
      rm -f "$LOCKFILE"
    fi
  fi

  # Compute effective roles — the roles that will actually run, given START_AT filtering.
  # Mirrors the should_run() logic inline so it is available before that function is defined.
  local -a effective_roles=()
  if [[ -z "$START_AT" ]]; then
    effective_roles=("${ROLES[@]}")
  else
    local _past=0 _r
    for _r in "${ROLES[@]}"; do
      [[ "$_r" == "$START_AT" ]] && _past=1
      [[ $_past -eq 1 ]] && effective_roles+=("$_r")
    done
  fi
  local _effective_tier="" _er
  for _er in "${effective_roles[@]}"; do
    [[ -n "$_effective_tier" ]] && _effective_tier+=" → "
    _effective_tier+="$_er"
  done

  cat > "$LOCKFILE" <<EOF
PID: $$
STARTED: $(date -u +%Y-%m-%dT%H:%M:%SZ)
HOSTNAME: $(hostname -s 2>/dev/null || hostname)
ROUND: $ROUND
START_AT: ${START_AT:-$FIRST_ROLE}
TIER: $TIER
EFFECTIVE_TIER: $_effective_tier
EOF
  LOCK_HELD=true
}

# ── Flag detection ────────────────────────────────────────────────────────────
detect_claude_flags() {
  log "Detecting Claude Code flag support..."

  local help_text
  help_text=$(claude --help 2>&1 || true)

  # Permission mode
  # Headless `claude -p` cannot answer interactive permission prompts.
  # `auto` still gates writes to non-trusted dirs and causes Implementer to
  # silently abort with "I need permission". `bypassPermissions` matches the
  # original `--dangerously-skip-permissions` fallback intent.
  if echo "$help_text" | grep -q "permission-mode"; then
    PERMISSION_FLAG=(--permission-mode bypassPermissions)
    log "  permission-mode: --permission-mode bypassPermissions ✓"
    log_warn "  bypassPermissions disables ALL permission checks for this session."
    log_warn "  Run only in a dedicated project directory."
  else
    PERMISSION_FLAG=(--dangerously-skip-permissions)
    log_warn "  --permission-mode not available."
    log_warn "  Falling back to --dangerously-skip-permissions."
    log_warn "  This disables ALL permission prompts. Run only in a dedicated project directory."
  fi

  # Model flag
  if echo "$help_text" | grep -q -- "--model"; then
    MODEL_FLAG_SUPPORTED=true
    log "  --model: supported ✓"
  else
    MODEL_FLAG_SUPPORTED=false
    log_warn "  --model flag not available. All roles will use Claude Code's default model."
    MODEL_ROUTING=false
  fi

  # Max-turns / budget flag
  if echo "$help_text" | grep -qE "max-turns|task-budget"; then
    BUDGET_FLAG_SUPPORTED=true
    log "  task budget (--max-turns): supported ✓"
  else
    BUDGET_FLAG_SUPPORTED=false
    log_warn "  --max-turns not available. Task budget protection disabled."
    log_warn "  Monitor token usage manually on first runs."
  fi

  log ""
}

# ── NEXT-ROLE.md helpers ──────────────────────────────────────────────────────
# Both helpers operate on the FIRST `^STATUS:` line only. Memorial-Updater
# sometimes preserves prior routing in audit sections that re-quote a STATUS
# line; the canonical status is always the header at the top of the file.
check_status() {
  awk '/^STATUS:/ {print $2; exit}' "$COORD/NEXT-ROLE.md" 2>/dev/null \
    || echo "UNKNOWN"
}

set_status() {
  if [[ -f "$COORD/NEXT-ROLE.md" ]]; then
    awk -v new="STATUS: $1" '!done && /^STATUS:/ {print new; done=1; next} {print}' \
      "$COORD/NEXT-ROLE.md" > "$COORD/NEXT-ROLE.md.tmp" \
      && mv "$COORD/NEXT-ROLE.md.tmp" "$COORD/NEXT-ROLE.md"
  fi
}

check_escalation() {
  local status
  status=$(check_status)
  if [[ "$status" == "ESCALATE" ]]; then
    log ""
    log "⚠️  ════════════════════════════════════════════════"
    log "⚠️  ESCALATION REQUIRED — pipeline paused"
    log "⚠️  ════════════════════════════════════════════════"
    echo ""
    echo "════ ESCALATION ITEMS ═══════════════════════════"
    awk '/^## Escalation items/{f=1;next} f && /^## [A-Z]/{exit} f{print}' \
      "$COORD/NEXT-ROLE.md" | grep -v "^(none)$"
    echo "════════════════════════════════════════════════="
    echo ""
    log "To resolve:"
    log "  1. Read:  $COORD/NEXT-ROLE.md"
    log "  2. Read:  any DIAGNOSTIC files listed above"
    log "  3. Make your decision; update the spec if needed"
    log "  4. Set STATUS: READY in NEXT-ROLE.md"
    log "  5. Resume: ./run-pipeline.sh --round $ROUND --start-at <next-role>"
    exit 2
  fi
}

# ── Rate limit detection ──────────────────────────────────────────────────────
is_rate_limit() {
  local logfile="$1"
  grep -qiE "rate.limit|429|too many requests|retry.after|quota" \
    "$logfile" 2>/dev/null
}

# ── Superpowers disciplines — inlined for headless reliability ────────────────
#
# Superpowers' MCP provides /brainstorm and /execute-plan as slash commands
# when running interactively. In headless mode (-p flag), MCP tools may not
# load. These inline blocks reproduce the discipline logic directly so it
# fires regardless of whether the MCP is active.
#
# When running interactively, Superpowers' MCP augments these with its own
# structured skill invocation on top. They compose — they don't conflict.

SP_BRAINSTORM='
## Superpowers: Brainstorm phase (inlined — fires in headless and interactive mode)
Before committing to any approach, complete these steps and document each one:
  1. Generate at least 3 distinct approaches to the problem
  2. For each: strengths, weaknesses, hidden assumptions, risks
  3. Identify which PRD/spec constraints eliminate options
  4. Select the approach with the best tradeoff profile — not the first one
  5. Write selection rationale: what you chose AND what you rejected and why
Do not proceed to the next phase until this documentation exists in your artifact.
'

SP_DESIGN='
## Superpowers: Design phase (inlined)
After brainstorm, before writing detailed spec or pseudocode:
  1. Sketch component boundaries: what exists, what gets created, what changes
  2. Identify all integration points and data flows
  3. Verify each integration point against the PRD requirements explicitly
  4. Identify failure modes: what breaks at each integration point?
  5. Document this sketch inline — it precedes the detailed pseudocode
'

SP_EXECUTE='
## Superpowers: Execute phase (inlined — fires in headless and interactive mode)
For each implementation unit (file, function, module):
  1. Write the test first. It MUST fail before you write any implementation.
     A test that passes before implementation is not a test — it is noise.
  2. Write the minimal implementation that makes the test pass.
  3. Refactor only after green.
  4. Before moving to the next unit: does this unit do exactly what the spec says?
     Not more. Not your interpretation. Exactly what it says.
  5. At each checkpoint: does anything not match the spec?
     If yes: HALT. Write a DIAGNOSTIC. Do not continue past a mismatch.
Each checkpoint is a real stop. Not a progress update.
'

SP_REVIEW='
## Superpowers: Review phase (inlined — fires in headless and interactive mode)
Before emitting any artifact to the next role:
  1. Re-read the artifact as if you are the next role receiving it cold
  2. Mark every place where you assumed something the next role cannot verify
  3. Mark every place where a decision was deferred rather than made
  4. Confirm no scope beyond the request was added
  5. Ask: could the next role act on this artifact with zero clarifying questions?
     If no: it is not ready. Revise first.
'

# ── Role prompt builders ──────────────────────────────────────────────────────

build_architect_prompt() {
  cat > "$COORD/.prompt-architect.md" << PROMPT
You are the ARCHITECT for round $ROUND.

Read these before doing anything:
  - $PRD_PATH  (requirements — read in full)
  - $CROSS_MEMORIAL  (focus on "Reinforcement rules derived" sections — apply all)
  - coordination/MEMORIAL.md  (this project's violation history — apply lessons)

$SP_BRAINSTORM

$SP_DESIGN

Deliverable: coordination/specs/Q-${ROUND}-SPEC.md

Required spec sections:
  1. Mechanism
     How it works. Every design decision made here. Nothing deferred to Implementer.
  2. Component inventory
     What exists | what gets created | what changes | what gets deleted
  3. Per-file pseudocode
     Detailed enough that the Implementer makes zero design decisions.
     If a function could be implemented two valid ways, choose one here.
  4. Acceptance criteria
     Every AC in "Given X, when Y, then Z" form.
     No ambiguous language ("correctly", "appropriately", "as needed" are banned).
  5. Anti-scope
     Explicit list of what is NOT included this round.
  6. Open questions
     Any unresolved item that could produce two valid specs must be surfaced here,
     not resolved by assumption. If there are none, write "None — all resolved."
  7. P3 ten-axis verification
     For each axis, write one sentence of verification:
     correctness | completeness | consistency | clarity | coverage
     constraints | concurrency | corner cases | cost | coupling
  8. Grilling output
     Your adversarial self-review, written inline:
       - Every claim verifiable? [yes/no + fix if no]
       - Unstated assumptions? [list or "none"]
       - Scope added beyond request? [yes/no + remove if yes]
       - Implementer can act without guessing? [yes/no + fix if no]

$SP_REVIEW

When spec passes grilling:
  Update coordination/NEXT-ROLE.md:
    NEXT-ROLE: IMPLEMENTER
    STATUS: READY   (or ESCALATE if PRD ambiguity cannot be resolved)
    Inputs: coordination/specs/Q-${ROUND}-SPEC.md

  Append to coordination/MEMORIAL.md:
    CONFIRMATION or VIOLATION for each discipline applied this round.

ROLE BOUNDARY:
Do not write implementation code. Do not open test files.
All unresolved decisions → open questions in the spec. Not silent choices.
PROMPT
}

# Coordinator-only mode: runs when --coordinator is passed. Produces a wave
# plan from the PRD; does not dispatch clusters. See CLAUDE-COORDINATOR.md.
build_coordinator_prompt() {
  # Find the next wave-plan version number. WAVE-PLAN-01.md is first; subsequent
  # plans are emitted at resequencing events from wave-gate failures.
  local next_wave_plan_n
  local existing_count
  existing_count=$(find "$COORD" -maxdepth 1 -name 'WAVE-PLAN-*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
  next_wave_plan_n=$(printf '%02d' $((existing_count + 1)))

  cat > "$COORD/.prompt-coordinator.md" << PROMPT
You are the COORDINATOR for round $ROUND.

You operate at the program level above all clusters. Your job is PRD
decomposition → DAG construction → wave sequencing. You do NOT write specs,
implement code, or reach inside clusters. See CLAUDE-COORDINATOR.md for
the full role discipline (loaded as your system prompt).

Read these before doing anything (in order):
  - $PRD_PATH  (requirements — read in full)
  - coordination/SCOPING-MEMO-v0.3.md  (canonical scope; § 2 per-extension scope; § 3 Q-cycle estimates)
  - coordination/NEXT-ROLE.md  (round-scope directive — operator-prepared inputs for this Coordinator invocation)
  - coordination/PHASE-2-SLICE-1-CLOSE-WALK.md  (vendored-with-deltas + anti-scope SHA-anchor patterns)
  - coordination/PHASE-2-SLICE-2-CLOSE-WALK.md  (most recent close-walk; SLICE 3 entry framing in § 3)
  - templates/WAVE-PLAN-TEMPLATE.md  (scaffold for your primary deliverable)
  - templates/README.md  (Tessera-local path-reference adaptation table)
  - $CROSS_MEMORIAL  ("Reinforcement rules derived" sections — apply all)

DAG construction discipline (per CLAUDE-COORDINATOR.md §DAG construction):
  Step 1 — Deterministic work unit extraction from PRD structure
  Step 2 — Dependency edge identification via D1-D5 tests (apply in order)
  Step 3 — Claude judgment only at ambiguity boundaries (log each call)
  Step 4 — DAG validation (cycle check; island check; foundation identification)
  Step 5 — Wave sequencing (Wave 1 = foundations; cap ≤5 clusters per wave)
  Step 6 — Work unit tier classification (solo / audit / full per CLAUDE-COMMON.md rubric)

Deliverable: coordination/WAVE-PLAN-${next_wave_plan_n}.md
  - Use templates/WAVE-PLAN-TEMPLATE.md as the scaffold
  - Fill every section; do not leave placeholder text
  - Pre-emit grilling per template's §Pre-emit grilling checklist
  - Surface OQs to operator at end of plan (do not invent answers)

Secondary deliverables (only if needed):
  - templates/CLUSTER-HANDOFF-TEMPLATE.md → coordination/CLUSTER-HANDOFF-NN-WUA-WUB.md
    (one file per directed dependency edge; created when target cluster dispatches, not pre-created at plan time)
  - coordination/COORDINATOR-MEMORIAL.md (initialize from templates/COORDINATOR-MEMORIAL-TEMPLATE.md if first Coordinator invocation; append-only thereafter)

Single-cluster vs multi-cluster outcome (operator preference: PREFER fan-out
when independence is clean; DO NOT force fan-out when scope is genuinely
sequential):

  Active bias. When the D1-D5 dependency tests show two or more work units
  in a wave are genuinely independent (no D1 shared-output edge, no D2
  AC-reference edge, no D5-strict write-conflict, D4 file-tree overlap
  resolvable via worktree isolation), PREFER to dispatch them as parallel
  clusters in the same wave. Do not collapse them into a single cluster
  for convenience or out of conservatism — if independence is clean, fan
  out.

  When fan-out is legitimately NOT available (D1/D2/D5 edges between every
  pair of WUs in a candidate wave; or candidate-wave WUs collapse to one
  WU under deterministic extraction; or scope is small enough that a
  single solo/audit cluster is more economical than coordinator overhead
  + N parallel clusters), recommend single-cluster waves with explicit
  reasoning. The operator does not want fan-out for its own sake — they
  want fan-out wherever it's a clean option.

  Trade-off framing in the plan summary: when you recommend a single-
  cluster wave, briefly note WHY fan-out was unavailable (which D-test
  fired across all candidate pairs, or which constraint collapsed the
  candidates). This makes the operator's review explicit and surfaces
  cases where a tighter PRD decomposition might unlock fan-out later.

  For waves with ≥2 clusters:
    - Recommend the operator invoke scripts/multi-track-cluster-setup.sh per cluster
    - Document each cluster's worktree branch + scope in the wave plan
  For single-cluster waves:
    - Recommend the operator run scripts/run-pipeline.sh in standard mode (no --coordinator)
    - Note the specific constraint that prevented fan-out

When wave plan passes grilling:
  Update coordination/NEXT-ROLE.md:
    NEXT-ROLE: OPERATOR (wave-plan review)
    STATUS: WAVE-PLAN-READY
    Inputs: coordination/WAVE-PLAN-${next_wave_plan_n}.md

  Initialize or append to coordination/COORDINATOR-MEMORIAL.md:
    CONFIRMATION or VIOLATION entries for any discipline patterns surfaced during this invocation.

ROLE BOUNDARY:
Do not draft cluster-level specs. Do not modify any cluster's NEXT-ROLE.md.
Do not write implementation code. Do not pre-resolve OQs by assumption.
Once the wave plan is emitted, your job for this invocation is done.
PROMPT
}

# Coordinator wave-gate close flow:
# (1) Run scripts/verify-wave-aggregate.sh <WAVE-NN>
# (2) Detect if any cluster ran --tier solo (heuristic: no REVIEWER CONFIRMATION
#     in MEMORIAL-fragment.md implies solo-tier — the Reviewer stage appends at
#     minimum one CONFIRMATION entry in audit/full tiers)
# (3) If solo-tier detected OR --consolidation-reviewer flag: dispatch consolidation
#     Reviewer subprocess
# See CLAUDE-COORDINATOR.md § "Tier-aware consolidation Reviewer at wave-gate close"
run_wave_gate_close() {
  log_section "COORDINATOR WAVE-GATE CLOSE | Wave: $WAVE_GATE_ID"

  # Step 1: aggregate verifier
  if [[ -x "scripts/verify-wave-aggregate.sh" ]]; then
    log "Running scripts/verify-wave-aggregate.sh $WAVE_GATE_ID ..."
    local aggregate_exit=0
    scripts/verify-wave-aggregate.sh "$WAVE_GATE_ID" | tee -a "$PIPELINE_LOG" || aggregate_exit=$?
    if [[ $aggregate_exit -ne 0 ]]; then
      log_warn "verify-wave-aggregate.sh exited $aggregate_exit — aggregate finding(s) detected."
      log_warn "Review findings above before setting STATUS: WAVE-COMPLETE."
    else
      log "verify-wave-aggregate.sh: clean sweep (exit 0)."
    fi
  else
    log_warn "scripts/verify-wave-aggregate.sh not found or not executable; skipping aggregate sweep."
    log_warn "Install with: chmod +x scripts/verify-wave-aggregate.sh"
  fi

  # Step 2: detect solo-tier clusters
  local solo_tier_detected=false
  local fragment_dir="coordination/clusters"
  if [[ -d "$fragment_dir" ]]; then
    for fragment in "$fragment_dir"/*/MEMORIAL-fragment.md; do
      [[ -f "$fragment" ]] || continue
      # Heuristic: a solo-tier cluster's fragment has no REVIEWER CONFIRMATION entry.
      # audit/full clusters have at least one REVIEWER-authored CONFIRMATION.
      if ! grep -qE "\| REVIEWER$" "$fragment" 2>/dev/null; then
        cluster_id=$(basename "$(dirname "$fragment")")
        log_warn "Cluster '$cluster_id' appears to have run solo-tier (no REVIEWER entries in fragment)."
        solo_tier_detected=true
      fi
    done
  fi

  # Step 3: tier-aware consolidation Reviewer
  local consolidation_needed=false
  if $solo_tier_detected; then
    log "Solo-tier cluster(s) detected — MANDATORY consolidation Reviewer required."
    consolidation_needed=true
  elif $CONSOLIDATION_REVIEWER; then
    log "--consolidation-reviewer flag set — dispatching consolidation Reviewer."
    consolidation_needed=true
  else
    log "All clusters ran audit/full tiers. Consolidation Reviewer not required."
    log "Use --consolidation-reviewer to force if cross-cluster integration review is wanted."
  fi

  if $consolidation_needed; then
    log_section "CONSOLIDATION REVIEWER — spawning cold-eye cross-cluster review"
    build_consolidation_reviewer_prompt
    run_role "REVIEWER" "$COORD/.prompt-consolidation-reviewer.md" \
      "$(get_model REVIEWER)" "$(get_budget REVIEWER)"
    log "Consolidation Reviewer complete."
  fi

  log_section "COORDINATOR WAVE-GATE — complete"
  log "Next step: set STATUS: WAVE-COMPLETE in coordination/NEXT-ROLE.md"
  log "Then dispatch Wave N+1 clusters per coordination/WAVE-PLAN-*.md."
}

build_consolidation_reviewer_prompt() {
  local wave_num="${WAVE_GATE_ID#WAVE-}"
  local wave_plan_path="coordination/WAVE-PLAN-${wave_num}.md"
  cat > "$COORD/.prompt-consolidation-reviewer.md" << PROMPT
You are the CONSOLIDATION REVIEWER for wave-gate close of $WAVE_GATE_ID.

Your scope is cross-cluster integration audit. You are NOT re-doing per-cluster
review (cluster-level Reviewers already covered cluster-local work). You are
auditing cross-cluster concerns that are only visible at the consolidated layer.

Read before auditing:
  - $wave_plan_path  (wave plan; cluster list + scope)
  - coordination/clusters/*/MEMORIAL-fragment.md  (all cluster memorial fragments)
  - Any CLUSTER-HANDOFF-*.md files in coordination/ (cross-cluster contracts)
  - coordination/MEMORIAL.md  (active memorial for methodology context)

Cross-cluster concerns to audit:
  1. **Aggregate scope creep.** Do any cluster diffs collectively reach outside the
     wave-level scope defined in the wave plan?
  2. **Contract drift.** If cluster A and cluster B both touch a shared schema,
     interface, or type definition — do they agree on shape? Run:
     \`git show <cluster-A-branch>:<shared-file>\` vs \`git show <cluster-B-branch>:<shared-file>\`
  3. **MEMORIAL semantic-conflict.** If a discipline keyword appears as CONFIRMATION
     in one cluster and VIOLATION in another — flag for operator decision.
  4. **Integration gaps.** Are there behaviors that each cluster individually
     tested but that their integration surfaces cannot exercise together?

Emit a REVIEWER REPORT at coordination/reviews/REVIEWER-REPORT-${ROUND}-consolidation.md.
Use standard CRITICAL / MAJOR / MINOR / OBS severity levels.

ROLE BOUNDARY:
Do NOT re-audit cluster-local ACs (per-cluster Reviewers own those).
Focus only on cross-cluster integration surfaces.
PROMPT
}

build_implementer_prompt() {
  case "$TIER" in
    solo)  build_implementer_prompt_solo ;;
    audit) build_implementer_prompt_audit ;;
    *)     build_implementer_prompt_full ;;
  esac
}

build_implementer_prompt_full() {
  local spec_path
  spec_path=$(awk '/^  - coordination\/specs\//{print $2; exit}' \
    "$COORD/NEXT-ROLE.md" 2>/dev/null \
    || echo "coordination/specs/Q-${ROUND}-SPEC.md")

  cat > "$COORD/.prompt-implementer.md" << PROMPT
You are the IMPLEMENTER for round $ROUND.

Read ONLY these before writing any code:
  - $spec_path   (your spec — read every word)
  - Existing source files in src/ and tests/

Do NOT read:
  - coordination/logs/  (session logs)
  - coordination/diagnostics/  (prior diagnostic reasoning)
  - Any .prompt-*.md file
  - Architect reasoning artifacts or design notes
You are starting cold from the spec. This is intentional. It preserves your independence.

$SP_EXECUTE

TACTICAL AUTONOMY:
The spec prescribes WHAT and WHY. Tactical detail — import paths, locator syntax,
type-cast placement, utility class names, layout shims, version-drift fixes,
syntactic adjustments — is YOUR call. If a competent senior engineer would just
fix it, fix it and explain in the commit message. Routine spec/reality mismatches
are NOT halt conditions. Examples of fixes you make inline:
  - Spec import path doesn't resolve → use the path matching project convention.
  - Spec locator has a substring collision → use the disambiguating variant
    (e.g., \`getByLabel("X", { exact: true })\`).
  - Spec type triggers a typecheck error at the consumer → cast at consumer or
    widen at producer, whichever is smaller.
  - Spec layout overflows at 375px → apply standard fix (e.g., \`min-w-0\` +
    \`truncate\` on the variable-length child).
  - Spec API signature is outdated for the installed version → use the current one.
  - Spec parameter is unused or wrong-shape → drop or rename.

HALT CONDITIONS — stop only when an architectural decision belongs to the operator:
  a. Two valid implementations differ in observable behavior, scope, or system
     boundaries (e.g., "switch middleware runtime", "add a new API surface").
  b. Spec/reality conflict cannot be resolved without changing the round's
     component inventory or anti-scope.
  c. A requirement cannot be expressed as a test at all.
  d. PRD or spec ambiguity produces different valid implementations with
     materially different consequences.

On halt:
  1. STOP. Do not work around the gap. Not even a temporary workaround.
  2. Write coordination/diagnostics/DIAGNOSTIC-${ROUND}-[short-topic].md:
       Spec claim (exact quote from spec):
       Reality (what the codebase/system actually shows):
       Resolution options:
         Option A: [what it does, consequence]
         Option B: [what it does, consequence]
         Option C: [if applicable — include an "empirically verify with [command]"
                    branch where ground truth is determinable]
       Do NOT resolve unilaterally.
  3. Set coordination/NEXT-ROLE.md STATUS: ESCALATE
  4. Add the diagnostic file to the Escalation items section
  5. Append VIOLATION: halt-discipline | [description] | $ROUND | IMPLEMENTER
     to coordination/MEMORIAL.md
  6. Session ends here.

On clean completion (all tests pass, no halts):
  Update coordination/NEXT-ROLE.md:
    NEXT-ROLE: REVIEWER
    STATUS: READY
    Inputs: [branch name], [test result summary — X passed, 0 failed]

  Append to coordination/MEMORIAL.md:
    CONFIRMATION entries for disciplines applied.

ROLE BOUNDARY:
Do not review your own code. Do not change scope.
Architectural ambiguity → DIAGNOSTIC files. Tactical detail → fix inline with
a clear commit message.
PROMPT
}

build_implementer_prompt_audit() {
  cat > "$COORD/.prompt-implementer.md" << PROMPT
You are the IMPLEMENTER for round $ROUND (audit mode — no Architect; you author
the spec yourself, then execute it).

Read these before writing any code:
  - $PRD_PATH  (requirements — read in full)
  - $CROSS_MEMORIAL  (apply all "Reinforcement rules derived" entries)
  - coordination/MEMORIAL.md  (this project's violation history)
  - Existing source files in src/ and tests/

In audit mode you wear two hats in one session: spec author and implementer.
Both halves operate under the same disciplines — pre-emit grilling, no scope
creep, audit trail in coordination/. The Reviewer reads your spec PLUS the
code; write the spec for cold-eye consumption, not as scratch.

STEP 1 — Write coordination/specs/Q-${ROUND}-SPEC.md (thin: 1-2 pages)

Required sections:
  1. Goal (1 paragraph — what this round delivers from the PRD)
  2. Mechanism (key architectural decisions, made inline; no deferral)
  3. Acceptance criteria
     Every AC in "Given X, when Y, then Z" form.
     No ambiguous language ("correctly", "appropriately", "as needed" banned).
     ACs name the verifiable outcome, not the literal code that produces it.
  4. Anti-scope (explicit list of what is NOT in this round)
  5. Open questions ("None — all resolved" or escalate via DIAGNOSTIC)

Per-file pseudocode is NOT required in audit — you write the code yourself, so
prescribing it to yourself is bookkeeping without value. Tactical implementation
detail (import paths, locator syntax, utility class names) belongs in the code,
not the spec.

$SP_BRAINSTORM

$SP_DESIGN

STEP 2 — Execute against your own spec

$SP_EXECUTE

TACTICAL AUTONOMY:
The spec prescribes WHAT and WHY. Tactical detail — import paths, locator syntax,
type-cast placement, utility class names, layout shims, version-drift fixes —
is your call. Fix routine spec/reality mismatches inline with a commit-message
note. Architectural decisions (different observable behavior, scope, or system
boundaries) still warrant a HALT.

HALT CONDITIONS — stop only when an architectural decision belongs to the operator:
  a. Two valid implementations differ in observable behavior, scope, or system
     boundaries (e.g., "switch middleware runtime", "add a new API surface").
  b. PRD/spec conflict with reality cannot be resolved without changing scope or
     anti-scope.
  c. A requirement cannot be expressed as a test at all.
  d. PRD ambiguity produces different valid implementations with materially
     different consequences.

On halt:
  1. STOP. No silent workarounds.
  2. Write coordination/diagnostics/DIAGNOSTIC-${ROUND}-[short-topic].md:
       PRD/spec claim (exact quote):
       Reality (what the codebase/system actually shows):
       Resolution options:
         Option A: [what it does, consequence]
         Option B: [what it does, consequence]
         Option C: [if applicable — include an "empirically verify with [command]"
                    branch where ground truth is determinable]
       Do NOT resolve unilaterally.
  3. Set coordination/NEXT-ROLE.md STATUS: ESCALATE
  4. Add the diagnostic file to the Escalation items section
  5. Append VIOLATION: halt-discipline | [description] | $ROUND | IMPLEMENTER
     to coordination/MEMORIAL.md
  6. Session ends here.

STEP 3 — Pre-emit review of your own work

$SP_REVIEW

On clean completion (all tests pass, no halts):
  Update coordination/NEXT-ROLE.md:
    NEXT-ROLE: REVIEWER
    STATUS: READY
    Inputs: coordination/specs/Q-${ROUND}-SPEC.md, [test result summary]

  Append to coordination/MEMORIAL.md:
    CONFIRMATION entries for disciplines applied (spec authorship counts as
    Architect-equivalent work this round).

ROLE BOUNDARY:
You author the spec AND implement it in audit — but the Reviewer remains
adversarial and independent. Write a spec the Reviewer can verify cold:
verifiable ACs, explicit anti-scope, no hidden assumptions. Tactical choices
made during implementation get documented in commit messages, not the spec.
PROMPT
}

build_implementer_prompt_solo() {
  cat > "$COORD/.prompt-implementer.md" << PROMPT
You are the IMPLEMENTER for round $ROUND (solo mode — SOLO: no separate
Reviewer, no separate Memorial-Updater. You handle spec, execute, memorial
inline in this one session. The operator selected solo because this round
matches the Z1–Z5 eligibility rubric: mechanical / doc-only / test-only /
cosmetic / configuration-tweak work that does not warrant cold-eye review.

solo IS NOT FOR: new behavior, schema changes, middleware/auth/shared-
infrastructure changes, anything where correctness needs more than
visual inspection. If you discover the round is NOT actually solo-eligible
(e.g., scope grew, you found you must touch shared infrastructure),
HALT with a DIAGNOSTIC and recommend operator promote to audit or full.

Read these before writing any code:
  - $PRD_PATH  (requirements — the scope block for this round)
  - $CROSS_MEMORIAL  (apply all "Reinforcement rules derived" entries)
  - coordination/MEMORIAL.md  (this project's violation history)
  - Existing source files in src/ and tests/

In solo mode you wear three hats in one session: spec author, implementer,
and memorial updater. All three operate under the same disciplines —
pre-emit grilling, no scope creep, audit trail in coordination/.

STEP 1 — Write coordination/specs/Q-${ROUND}-SPEC.md (very thin: ≤1 page)

Required sections (be brief — solo work is small):
  1. Goal (1-2 sentences — what this round delivers; cite Z criterion)
  2. Mechanism (the specific change; usually 1-3 sentences)
  3. Acceptance criteria (Given/When/Then; usually 1-3 ACs)
  4. Anti-scope (what is NOT in this round — guard against scope drift)

$SP_BRAINSTORM

$SP_DESIGN

STEP 2 — Execute the spec

$SP_EXECUTE

TACTICAL AUTONOMY:
The spec prescribes WHAT and WHY. Tactical detail — import paths, locator
syntax, type-cast placement, utility class names, layout shims, version-
drift fixes — is your call. Fix routine spec/reality mismatches inline
with a commit-message note. Architectural decisions warrant a HALT.

HALT CONDITIONS — stop and ESCALATE if:
  a. The round turns out to require behavior change, schema edits, or
     touching middleware/auth/shared infrastructure (solo is wrong tier;
     recommend operator promote to audit or full).
  b. Spec/reality conflict requiring component-inventory change.
  c. PRD ambiguity producing materially different implementations.
  d. Any operator directive from a prior escalation that this round
     contradicts.

On halt:
  1. STOP. No silent workarounds.
  2. Write coordination/diagnostics/DIAGNOSTIC-${ROUND}-[short-topic].md
     with the bounded question (including a recommendation to promote
     the tier if applicable).
  3. Set coordination/NEXT-ROLE.md STATUS: ESCALATE
  4. Append VIOLATION: halt-discipline to MEMORIAL.md
  5. Session ends here.

STEP 3 — Pre-emit review of your own work

$SP_REVIEW

Because there is no separate Reviewer in solo, your self-review is the
last line of defense before merge. Be honest. If the round started as
solo but the diff exceeded mechanical bounds, the right call is to STOP,
write a DIAGNOSTIC explaining what grew, and recommend the operator
re-run as audit (so a cold-eye Reviewer audits the result).

STEP 4 — Memorial-accretion (inline, before exit)

For each discipline you applied this round, append to
coordination/MEMORIAL.md:
  CONFIRMATION: [discipline] | [what worked, specifically] | $ROUND | IMPLEMENTER
  VIOLATION:    [discipline] | [what happened, specifically] | $ROUND | IMPLEMENTER

Append the same entries to $CROSS_MEMORIAL with prefix [\$(basename "$PROJECT_ROOT")].

For each VIOLATION this round, append a reinforcement line to
$PROJECT_ROOT/CLAUDE-IMPLEMENTER.md in its REINFORCEMENTS section
(cross-role / methodology lessons go in CLAUDE-COMMON.md):
  # REINFORCED [date] — [specific rule from the violation]

Be specific. "Pre-emit grilling confirmed" is not useful.
"Pre-emit grilling caught missing tests for the renamed constant before
routing" is useful.

STEP 5 — Write coordination/logs/ROUND-${ROUND}-SUMMARY.md

Brief (≤1 page) — sections:
  ## What worked
  ## What violated discipline (if any)
  ## Tier note: chose solo because [Zn]; final diff stayed within mechanical bounds [yes/no]
  ## Reinforcements added (CLAUDE-IMPLEMENTER.md / CLAUDE-COMMON.md, line summary)

STEP 6 — Routing

Update coordination/NEXT-ROLE.md:
  NEXT-ROLE: (operator decision)
  STATUS: ROUND-COMPLETE
  Inputs: coordination/specs/Q-${ROUND}-SPEC.md, [test result summary],
          [final commit SHA]

On clean completion, the pipeline will exit cleanly when this session
ends. There is no Reviewer or Memorial-Updater session after you.

ROLE BOUNDARY:
You wear all three hats in solo, but the disciplines do not relax — they
shift onto you. The fact that no Reviewer runs is the cost of solo; do not
use it as license to skip self-review or memorial-accretion. If you find
mid-session that the round is bigger than expected, HALT and recommend
promotion to audit — that is the right move, not a faster pass.
PROMPT
}

build_reviewer_prompt() {
  # In hybrid mode, this is called twice with tag="opus" and tag="sonnet" — each
  # writes to its own prompt file + targets its own output report path. The
  # merger consolidates afterward and is the sole writer of NEXT-ROLE.md +
  # MEMORIAL.md. In single-reviewer mode (default), tag is "" and behavior is
  # backward-compatible: one prompt file, canonical output path, full routing.
  local tag="${1:-}"
  local prompt_file
  local report_path
  local routing_block
  local scope_note=""
  if [[ "$REVIEWER_SCOPE" == "structural" ]]; then
    scope_note="
**MODE: STRUCTURAL-ONLY REVIEWER (R74).**
Per CLAUDE-REVIEWER.md \"## Mode: Structural-only Reviewer\" section, this
audit is scoped to: (1) binding-command re-runs verbatim, (2) AC-binding
structural integrity walk, (3) ALLOWED_SET diff verification. DO NOT perform
adversarial counterfactual reasoning. DO NOT perform a right-reasons audit.
The \"find what the Implementer got wrong\" mandate is SUSPENDED in this
mode — you are verifying structural compliance, not assuming a mistake.

Routing unchanged: CRITICAL → ESCALATE; MAJOR or below → MERGE-READY.
"
  fi
  if [[ -n "$tag" ]]; then
    prompt_file="$COORD/.prompt-reviewer-${tag}.md"
    report_path="coordination/reviews/REVIEWER-REPORT-${ROUND}-${tag}.md"
    routing_block="Routing in HYBRID MODE — IMPORTANT:
A parallel Reviewer (different model) is running concurrently. You are ONE OF
TWO independent reviewers. Do NOT update coordination/NEXT-ROLE.md and do NOT
append to coordination/MEMORIAL.md. The merger step that follows reads both
per-model reports and produces the canonical REVIEWER-REPORT-${ROUND}.md plus
the NEXT-ROLE.md + MEMORIAL.md updates.

Stay in your lane: write ONLY your report at the path above. Do not commit.
Do not modify any file other than your report.

ROLE BOUNDARY: Document findings. Do not fix. Do not re-implement."
  else
    prompt_file="$COORD/.prompt-reviewer.md"
    report_path="coordination/reviews/REVIEWER-REPORT-${ROUND}.md"
    routing_block="Routing:
  CRITICAL exists → STATUS: ESCALATE
  MAJOR or below  → STATUS: MERGE-READY
Update coordination/NEXT-ROLE.md accordingly.
List your report path in the Inputs section.
Append CONFIRMATION/VIOLATION entries to coordination/MEMORIAL.md.

ROLE BOUNDARY: Document findings. Do not fix. Do not re-implement."
  fi

  cat > "$prompt_file" << PROMPT
You are the REVIEWER for round $ROUND.
${scope_note}
Read ALL of these before writing a single word of your report:
  - $PRD_PATH
  - coordination/specs/Q-${ROUND}-SPEC.md
  - All source files in src/
  - All test files in tests/
  - $CROSS_MEMORIAL  (Reviewer section — check for previously missed issue classes)

Do NOT read (cold review is the point — these would contaminate your independence):
  - coordination/diagnostics/
  - coordination/logs/
  - Any .prompt-*.md file

YOUR MANDATE:
Your job is NOT to confirm the implementation works.
Your job is to find what the Implementer got wrong.
Assume the Implementer made at least one mistake. Find it.
A report with zero findings means you did not look hard enough.
Adversarial is not hostile — it is thorough and independent.

$SP_REVIEW

Deliverable: $report_path

Required sections:

1. Per-AC verification table
   Every acceptance criterion from the spec. Every one.
   | AC-ID | Criterion (short) | Status | Evidence (file:line or test name) |
   Status: PASS / FAIL / PARTIAL
   Evidence must be a specific reference — not "appears correct."

2. Findings
   Every non-PASS item, plus anything else you found.
   CRITICAL  — blocks merge: correctness bug, security issue, data integrity problem
   MAJOR     — must fix before ship: functional gap, missing error path, broken edge case
   MINOR     — should fix: test gap, unclear code, misleading name
   OBS       — observation, no required action

3. Right-reasons audit (run this even if all ACs pass)
   Pick 3 tests. For each:
     - What requirement in the spec does this test cover?
     - Does the test pass because the code is correct, or because the Implementer
       wrote a test that confirms its own implementation choice?
   If a test has no spec requirement traceability: that is a finding.

4. Cross-cutting checks
   - TDD discipline: is there evidence tests were written before implementation?
     (git history, test structure, or absence of obvious retrofit)
   - No-skip: did the Implementer apply halt discipline when spec gaps appeared?
   - Anti-scope: did anything ship that isn't in the spec? List it if so.

5. Grilling output (on your own report, before routing):
   - Every finding has a file:line reference? [yes/no]
   - Any AC marked PASS without actual verification? [yes/no]
   - Right-reasons audit completed for 3+ tests? [yes/no]
   Fix any "no" before routing.

${routing_block}
PROMPT
}

# Merger for hybrid Reviewer mode. Reads the two per-model reports, dedupes,
# verifies suspect findings against actual code, produces the canonical
# REVIEWER-REPORT-RNN.md + updates NEXT-ROLE.md + appends MEMORIAL.md.
# Sonnet model is sufficient — this is aggregation work, not novel reasoning.
build_reviewer_merger_prompt() {
  cat > "$COORD/.prompt-reviewer-merge.md" << PROMPT
You are the REVIEWER-MERGER for round $ROUND.

Two parallel Reviewers (Opus + Sonnet) produced independent reports against
the same code state. Merge them into one canonical report.

READ:
  - coordination/reviews/REVIEWER-REPORT-${ROUND}-opus.md
  - coordination/reviews/REVIEWER-REPORT-${ROUND}-sonnet.md
  - coordination/specs/Q-${ROUND}-SPEC.md
  - Any file:line referenced by either report that you need to verify
    (re-read the actual code/test to confirm the finding is real)

MERGE RULES (apply in order):

1. UNION: if either reviewer caught a finding, keep it.

2. DEDUPLICATE: if both reviewers caught the same issue (same file:line
   OR same semantic concern), keep ONE merged finding tagged "[both]"
   with combined evidence from each.

3. TAG provenance: every finding ends with a marker:
     [opus]   — caught only by Opus
     [sonnet] — caught only by Sonnet
     [both]   — caught by both

4. VERIFY low-confidence singletons. For any finding flagged by ONLY one
   reviewer where the claim seems doubtful (e.g., disagrees with what
   the other reviewer found, or makes a strong structural claim about a
   file), open the named file:line and confirm. If the finding is wrong,
   move it to a "FALSE POSITIVES (from per-model reports, verified incorrect)"
   section at the bottom — DO NOT silently drop it. Explain why it was
   incorrect. Both reviewers' reputations need this audit trail.

5. RE-NUMBER MAJOR/MINOR/OBS sequentially in the merged report
   (MAJOR-1, MAJOR-2, ...). Preserve original numbering only inside
   each finding body for traceability.

6. PRESERVE per-AC verification table: union of both reviewers' tables.
   If they disagree on a status (PASS vs FAIL vs PARTIAL), the MORE
   SEVERE verdict wins; mention the disagreement briefly.

DELIVERABLE: coordination/reviews/REVIEWER-REPORT-${ROUND}.md

Structure of the merged report:
  # REVIEWER REPORT — ${ROUND} (hybrid merger of Opus + Sonnet)
  ## 1. Per-AC verification (union; severity-max on disagreement)
  ## 2. Findings (re-numbered; each tagged [opus]/[sonnet]/[both])
       ### CRITICAL
       ### MAJOR
       ### MINOR
       ### OBS
  ## 3. Right-reasons audit (union of both reviewers' picks; dedupe overlap)
  ## 4. Cross-cutting checks (synthesize both)
  ## 5. False positives (verified incorrect from one model; with reason)
  ## 6. Routing decision
  ## 7. Merger notes (cost/coverage observations; cite which model caught
       which class of issue — feeds future calibration)

Routing rule (UNCHANGED):
  Any CRITICAL exists → STATUS: ESCALATE
  Otherwise           → STATUS: MERGE-READY
Update coordination/NEXT-ROLE.md accordingly.
Append CONFIRMATION/VIOLATION entries to coordination/MEMORIAL.md
(synthesize from both reviewers' findings; do NOT double-count [both]
items as separate violations).

ROLE BOUNDARY: Merge and verify. Do not introduce findings neither reviewer
flagged unless your verification turned up a clear bug while reading code
for §4 — and tag any such finding [merger-verified] with reasoning.
PROMPT
}

build_memorial_prompt() {
  cat > "$COORD/.prompt-memorial-updater.md" << PROMPT
You are the MEMORIAL UPDATER for round $ROUND.

Read ALL of these before writing anything:
  - coordination/specs/Q-${ROUND}-SPEC.md
  - coordination/reviews/REVIEWER-REPORT-${ROUND}.md
  - coordination/diagnostics/DIAGNOSTIC-${ROUND}-*.md  (all matching files if any)
  - coordination/MEMORIAL.md  (current state)
  - $CROSS_MEMORIAL  (current state)

Disciplines to evaluate (for all roles, this round):
  pre-emit-grilling | halt-discipline | right-reasons-audit
  role-boundary | anti-scope | tdd-discipline | context-isolation

Complete all five deliverables:

1. Append to coordination/MEMORIAL.md
   For each discipline, for each role:
     CONFIRMATION: [discipline] | [what worked, specifically] | $ROUND | [ROLE]
     VIOLATION:    [discipline] | [what happened, specifically] | $ROUND | [ROLE]
   Be specific. "Pre-emit grilling confirmed" is not useful.
   "Architect grilling caught missing error handling for null input in AC-03" is useful.

2. Append to $CROSS_MEMORIAL
   Same entries, prefixed: [$(basename "$PROJECT_ROOT")]
   Then: scan ALL violation entries across ALL rounds in the cross-project memorial.
   If any discipline has 3+ violations (any project, recent rounds):
     Add under that discipline:
     ### Reinforcement rules derived
     - [Specific rule: not "be careful" but "Architect must explicitly specify
       the error return type for every function that calls an external service"]

3. Update the role-specific CLAUDE-<ROLE>.md file
   The discipline content is split per role. For every VIOLATION this round,
   open the file matching the violating role and append to its REINFORCEMENTS
   section:
     Architect violation         → $PROJECT_ROOT/CLAUDE-ARCHITECT.md
     Implementer violation       → $PROJECT_ROOT/CLAUDE-IMPLEMENTER.md
     Reviewer violation          → $PROJECT_ROOT/CLAUDE-REVIEWER.md
     Memorial-Updater violation  → $PROJECT_ROOT/CLAUDE-MEMORIAL.md
     Cross-role / methodology    → $PROJECT_ROOT/CLAUDE-COMMON.md
   Append at the end of that file's REINFORCEMENTS section:
     # REINFORCED $(date '+%Y-%m-%d') — [specific rule from the violation]
   Do not delete prior reinforcements. The cumulative history is the value.

4. Consolidation check (cheap; run after appending in step 3)
   For each CLAUDE-COMMON.md and CLAUDE-<ROLE>.md file, count REINFORCED
   lines:
     grep -c '^# REINFORCED ' \$f
   If ANY file has > 30 REINFORCED lines, add a recommendation to the round
   summary (step 5):
     ## Recommend reinforcement consolidation
     - CLAUDE-IMPLEMENTER.md is at <N> REINFORCED lines; run
       \`./scripts/consolidate-reinforcements.sh\` to archive lines older
       than 180 days. (Operator-triggered; the script does not auto-run.)
   This is a nudge, not an action — the script stays operator-gated.

5. Write coordination/logs/ROUND-${ROUND}-SUMMARY.md
   Sections:
     ## What worked
     ## What violated discipline (role, discipline, what happened)
     ## Root cause analysis (why did each violation occur — not just what)
     ## Reinforcements added (file path + line summary for each)
     ## Watch list for next round (patterns to look for)
     ## Emerging cross-project patterns (if any)
     ## Recommend reinforcement consolidation (only if step 4 triggered)

6. Update coordination/NEXT-ROLE.md
   STATUS: ROUND-COMPLETE
   NEXT-ROLE: (operator decision)

ROLE BOUNDARY: Observe and record. Do not re-litigate. Do not re-implement.
PROMPT
}

# ── Model and budget lookup ───────────────────────────────────────────────────
get_model() {
  $MODEL_ROUTING || { echo "$MODEL_DEFAULT"; return; }
  case "$1" in
    ARCHITECT)        echo "$MODEL_ARCHITECT" ;;
    IMPLEMENTER)      echo "$MODEL_IMPLEMENTER" ;;
    REVIEWER|REVIEWER-OPUS) echo "$MODEL_REVIEWER" ;;
    REVIEWER-SONNET)  echo "$MODEL_REVIEWER_SECONDARY" ;;
    REVIEWER-MERGE)   echo "$MODEL_REVIEWER_MERGER" ;;
    MEMORIAL-UPDATER) echo "$MODEL_MEMORIAL" ;;
    COORDINATOR)      echo "$MODEL_COORDINATOR" ;;
    *)                echo "$MODEL_DEFAULT" ;;
  esac
}

get_budget() {
  case "$1" in
    ARCHITECT)        echo "$BUDGET_ARCHITECT" ;;
    IMPLEMENTER)      echo "$BUDGET_IMPLEMENTER" ;;
    REVIEWER|REVIEWER-OPUS|REVIEWER-SONNET) echo "$BUDGET_REVIEWER" ;;
    REVIEWER-MERGE)   echo "$BUDGET_REVIEWER_MERGER" ;;
    MEMORIAL-UPDATER) echo "$BUDGET_MEMORIAL" ;;
    COORDINATOR)      echo "$BUDGET_COORDINATOR" ;;
    *)                echo "40" ;;
  esac
}

# Hybrid Reviewer dispatch: parallel Opus + Sonnet → merger.
# See coordination/HYBRID-REVIEWER-DESIGN.md and EVAL-SONNET-REVIEWER-2026-05-15.md.
dispatch_hybrid_reviewer() {
  log_section "HYBRID REVIEWER — dispatching Opus + Sonnet in parallel"

  build_reviewer_prompt opus
  build_reviewer_prompt sonnet

  # Background-dispatch both per-model Reviewers
  ( run_role REVIEWER-OPUS   "$COORD/.prompt-reviewer-opus.md"   "$(get_model REVIEWER-OPUS)"   "$(get_budget REVIEWER-OPUS)" ) &
  local pid_opus=$!
  ( run_role REVIEWER-SONNET "$COORD/.prompt-reviewer-sonnet.md" "$(get_model REVIEWER-SONNET)" "$(get_budget REVIEWER-SONNET)" ) &
  local pid_sonnet=$!

  log "Waiting for parallel Reviewers (opus pid=$pid_opus, sonnet pid=$pid_sonnet)..."

  local exit_opus exit_sonnet
  wait "$pid_opus"; exit_opus=$?
  wait "$pid_sonnet"; exit_sonnet=$?

  log "Opus exit=$exit_opus, Sonnet exit=$exit_sonnet"

  if [[ $exit_opus -ne 0 ]]; then
    log_error "Opus Reviewer failed (exit $exit_opus). Aborting hybrid; check $LOG_DIR/REVIEWER-OPUS-${ROUND}.log"
    return 1
  fi
  if [[ $exit_sonnet -ne 0 ]]; then
    log_warn "Sonnet Reviewer failed (exit $exit_sonnet). Continuing with Opus-only fallback; merger will skip sonnet input."
    # Fallback: copy Opus report to canonical position; skip merger
    cp "coordination/reviews/REVIEWER-REPORT-${ROUND}-opus.md" "coordination/reviews/REVIEWER-REPORT-${ROUND}.md"
    log_warn "Hybrid degraded to single-Reviewer (Opus) for $ROUND. Sonnet log: $LOG_DIR/REVIEWER-SONNET-${ROUND}.log"
    return 0
  fi

  log_section "REVIEWER-MERGER — consolidating Opus + Sonnet reports"
  build_reviewer_merger_prompt
  run_role REVIEWER-MERGE "$COORD/.prompt-reviewer-merge.md" \
    "$(get_model REVIEWER-MERGE)" "$(get_budget REVIEWER-MERGE)"
}

# ── Memorial-Updater output commit (A7) ──────────────────────────────────────
#
# The Memorial-Updater role writes several files at clean completion but does
# not commit them. In single-track Mode 2 the operator is present and commits
# at round-close. In multi-track each cluster's pipeline is unattended; the
# uncommitted outputs strand on each cluster branch and are missed at wave-
# gate merge time. Auto-committing here closes that gap.
#
# What this typically commits:
#   M  CLAUDE-<ROLE>.md (REINFORCED appendings in the matching role file)
#   M  CLAUDE-COMMON.md (cross-role / methodology reinforcements, if any)
#   M  coordination/MEMORIAL.md (CONFIRMATION/VIOLATION entries)
#   M  coordination/NEXT-ROLE.md (final state, ROUND-COMPLETE status)
#   ?? coordination/logs/ROUND-RNN-SUMMARY.md (new)
#   ?? coordination/reviews/REVIEWER-REPORT-RNN.md (if Reviewer left it
#      uncommitted, which is the current behavior)
#
# Does not commit:
#   - Stray modifications outside coordination/ + CLAUDE*.md (unintentional).
#   - .pipeline-RNN.lock changes (gitignored per A9; if a project doesn't
#     yet have the gitignore line, the lockfile change still lands in
#     `git add -A coordination/` but is ignorable in audit).
commit_memorial_outputs() {
  cd "$PROJECT_ROOT" || return 1

  # Stage all coordination/ changes + any CLAUDE*.md modification (each role's
  # reinforcement file is a possible target of this round's Memorial Updater).
  git add -A coordination/ CLAUDE.md CLAUDE-COMMON.md CLAUDE-ARCHITECT.md \
    CLAUDE-IMPLEMENTER.md CLAUDE-REVIEWER.md CLAUDE-MEMORIAL.md \
    CLAUDE-COORDINATOR.md 2>/dev/null || true

  if git diff --cached --quiet 2>/dev/null; then
    log "Memorial-Updater outputs: nothing to commit (already clean)."
    return 0
  fi

  if git commit -q -m "chore($ROUND): Memorial-Updater outputs"; then
    local sha
    sha=$(git rev-parse --short HEAD)
    log "Memorial-Updater outputs committed: $sha"
  else
    log_warn "Memorial-Updater commit failed; operator must commit manually."
    log_warn "Outstanding files:"
    git status --short 2>&1 | head -10 | tee -a "$PIPELINE_LOG"
  fi
}

# Coordinator output commit. The Coordinator role writes WAVE-PLAN-NN.md and
# may initialize / append to COORDINATOR-MEMORIAL.md and update NEXT-ROLE.md;
# none of those get committed by the role itself. In --coordinator mode the
# Coordinator is the only role in the pipeline (no Memorial-Updater follows),
# so we commit its outputs here on clean completion.
commit_coordinator_outputs() {
  cd "$PROJECT_ROOT" || return 1

  git add -A coordination/ 2>/dev/null || true

  if git diff --cached --quiet 2>/dev/null; then
    log "Coordinator outputs: nothing to commit (already clean)."
    return 0
  fi

  if git commit -q -m "chore($ROUND): Coordinator wave-plan outputs"; then
    local sha
    sha=$(git rev-parse --short HEAD)
    log "Coordinator outputs committed: $sha"
  else
    log_warn "Coordinator commit failed; operator must commit manually."
    log_warn "Outstanding files:"
    git status --short 2>&1 | head -10 | tee -a "$PIPELINE_LOG"
  fi
}

# ── Core runner with retry and rate limit handling ────────────────────────────
run_role() {
  local role="$1"
  local prompt_file="$2"
  local model="$3"
  local budget="$4"
  local role_log="$LOG_DIR/${role}-${ROUND}.log"

  log_section "ROLE: $role | MODEL: $model | ROUND: $ROUND"

  # Write role and round into a per-invocation stamp file (mktemp, ephemeral).
  # Keeping the system-prompt prefix byte-identical across worktrees lets
  # Anthropic's prompt cache hit cross-cluster, cutting per-role-session input
  # cost dramatically. The stamp is appended after the discipline files so
  # role identity is still visible to the session.
  # mktemp is critical for hybrid-Reviewer mode where two run_role calls
  # execute in parallel — a static path would race.
  local stamp_file
  stamp_file=$(mktemp -t "claude-role-stamp-${role}.XXXXXX")
  cat > "$stamp_file" <<EOF
# ── ROLE-STAMP ────────────────────────────────────────────────────────────────
# THIS SESSION ROLE: $role
# Round: $ROUND
EOF
  # Ensure cleanup even on early returns/errors
  # shellcheck disable=SC2064
  trap "rm -f '$stamp_file'" RETURN

  # Resolve which CLAUDE-<ROLE>.md file pairs with this session.
  # Hybrid-Reviewer roles + the merger all read the Reviewer block.
  local role_claude_file
  case "$role" in
    ARCHITECT)        role_claude_file="$PROJECT_ROOT/CLAUDE-ARCHITECT.md" ;;
    IMPLEMENTER)      role_claude_file="$PROJECT_ROOT/CLAUDE-IMPLEMENTER.md" ;;
    REVIEWER|REVIEWER-OPUS|REVIEWER-SONNET|REVIEWER-MERGE)
                      role_claude_file="$PROJECT_ROOT/CLAUDE-REVIEWER.md" ;;
    MEMORIAL-UPDATER) role_claude_file="$PROJECT_ROOT/CLAUDE-MEMORIAL.md" ;;
    COORDINATOR)      role_claude_file="$PROJECT_ROOT/CLAUDE-COORDINATOR.md" ;;
    *)
      log_error "run_role: no CLAUDE-<ROLE>.md mapping for role '$role'"
      return 1 ;;
  esac

  if $DRY_RUN; then
    log "[DRY-RUN] claude -p <$(wc -l < "$prompt_file") line prompt>"
    log "[DRY-RUN] flags: ${PERMISSION_FLAG[*]} --model $model --max-turns $budget"
    log "[DRY-RUN] --append-system-prompt: CLAUDE-COMMON.md ($(wc -l < "$PROJECT_ROOT/CLAUDE-COMMON.md") lines) + $(basename "$role_claude_file") ($(wc -l < "$role_claude_file") lines) + .role-stamp"
    log "[DRY-RUN] --exclude-dynamic-system-prompt-sections: on"
    return 0
  fi

  local attempt=1
  local sleep_secs=$RETRY_BASE_SLEEP

  while [[ $attempt -le $MAX_RETRIES ]]; do
    log "Starting session (attempt $attempt/$MAX_RETRIES)..."

    # Build flag array dynamically based on what's available
    local -a flags=("-p" "$(cat "$prompt_file")" "${PERMISSION_FLAG[@]}")

    $MODEL_ROUTING && $MODEL_FLAG_SUPPORTED && \
      flags+=("--model" "$model")

    $BUDGET_FLAG_SUPPORTED && \
      flags+=("--max-turns" "$budget")

    # R75: gated context-bundle dispatch. When scripts/build-role-context.js
    # exists, use the deterministic prefix+tail construction so Anthropic's
    # prompt-cache hits the prefix across role sessions within a 5-min TTL.
    # Falls back to the legacy cat-bundle when .js missing (e.g., during the
    # R75 round itself before the script is compiled at chore-A pretest).
    local context_bundle=""
    if [[ -f "$PROJECT_ROOT/scripts/build-role-context.js" ]]; then
      if context_bundle=$(node "$PROJECT_ROOT/scripts/build-role-context.js" \
          --emit full \
          --role "$role" \
          --round "$ROUND" \
          --project-root "$PROJECT_ROOT" \
          --role-claude-file "$role_claude_file" 2>/dev/null); then
        :
      else
        context_bundle=""
      fi
    fi
    if [[ -z "$context_bundle" ]]; then
      context_bundle=$(cat "$PROJECT_ROOT/CLAUDE-COMMON.md" "$role_claude_file" "$stamp_file")
    fi
    flags+=("--append-system-prompt" "$context_bundle")

    # --exclude-dynamic-system-prompt-sections moves per-machine drift
    # (cwd, env, git status) out of the cached system-prompt prefix so it
    # doesn't bust the cache across workspaces. Anthropic-recommended.
    flags+=("--exclude-dynamic-system-prompt-sections")

    # Run and capture exit code through tee correctly.
    # Plain $? after a pipe captures the pipe's (tee's) exit code.
    # PIPESTATUS[0] captures the first command's (claude's) exit code.
    set -o pipefail
    claude "${flags[@]}" 2>&1 | tee -a "$role_log"
    local exit_code=${PIPESTATUS[0]}
    set +o pipefail

    if [[ $exit_code -eq 0 ]]; then
      log "$role completed."
      if [[ "$role" == "MEMORIAL-UPDATER" ]]; then
        commit_memorial_outputs
      fi
      if [[ "$role" == "COORDINATOR" ]]; then
        commit_coordinator_outputs
      fi
      check_escalation
      return 0
    fi

    # Rate limit — wait longer than standard retry
    if is_rate_limit "$role_log"; then
      if [[ $attempt -lt $MAX_RETRIES ]]; then
        log_warn "Rate limit detected. Waiting ${RATE_LIMIT_SLEEP}s before retry $((attempt+1))..."
        sleep "$RATE_LIMIT_SLEEP"
        attempt=$((attempt + 1))
        continue
      fi
    fi

    # Transient error — exponential backoff
    if [[ $attempt -lt $MAX_RETRIES ]]; then
      log_warn "Session failed (exit $exit_code). Retrying in ${sleep_secs}s..."
      sleep "$sleep_secs"
      sleep_secs=$((sleep_secs * 2))
      attempt=$((attempt + 1))
      continue
    fi

    # All retries exhausted — mark BLOCKED and exit cleanly
    log_error "$role failed after $MAX_RETRIES attempts."
    log_error "Last exit code: $exit_code"
    log_error "Full log: $role_log"
    set_status "BLOCKED"
    log_error "STATUS set to BLOCKED in NEXT-ROLE.md."
    log_error "To resume after fixing the issue:"
    log_error "  1. Resolve what caused the failure (check the log above)"
    log_error "  2. Set STATUS: READY in coordination/NEXT-ROLE.md"
    log_error "  3. Run: ./run-pipeline.sh --round $ROUND --start-at $role"
    exit 1
  done
}

# ── Role sequence control ─────────────────────────────────────────────────────
# ROLES is set at script-top tier configuration (solo, audit, or full).

should_run() {
  local role="$1"
  [[ -z "$START_AT" ]] && return 0
  local past_start=0
  for r in "${ROLES[@]}"; do
    [[ "$r" == "$START_AT" ]] && past_start=1
    [[ "$r" == "$role" && $past_start -eq 1 ]] && return 0
  done
  return 1
}

# ── Pre-flight ────────────────────────────────────────────────────────────────
run_preflight() {
  log_section "PRE-FLIGHT | Round: $ROUND"

  # Claude Code installed?
  if ! command -v claude &>/dev/null; then
    log_error "claude not found. Install: npm install -g @anthropic-ai/claude-code"
    exit 1
  fi
  log "Claude Code: $(claude --version 2>/dev/null || echo 'version unknown')"

  # Required files
  [[ ! -f "$PRD_PATH" ]] && {
    log_error "PRD not found: $PRD_PATH"
    log_error "Write your requirements first, then run the pipeline."
    exit 1
  }
  # CLAUDE.md is the interactive-session loader; the pipeline reads the split
  # files for headless runs. Check that every required piece is present.
  local missing_claude_files=()
  for f in CLAUDE.md CLAUDE-COMMON.md CLAUDE-ARCHITECT.md CLAUDE-IMPLEMENTER.md \
           CLAUDE-REVIEWER.md CLAUDE-MEMORIAL.md; do
    [[ -f "$PROJECT_ROOT/$f" ]] || missing_claude_files+=("$f")
  done
  if [[ ${#missing_claude_files[@]} -gt 0 ]]; then
    log_error "Missing discipline file(s): ${missing_claude_files[*]}"
    log_error "Copy the matching CLAUDE-*.md template(s) from the anchor repo,"
    log_error "or restore from a working project. The pipeline assembles each"
    log_error "session's system prompt from CLAUDE-COMMON.md + CLAUDE-<ROLE>.md."
    exit 1
  fi

  # Refuse to start if another pipeline is running this round.
  acquire_round_lock

  detect_claude_flags

  # Cross-project memorial bootstrap
  mkdir -p "$(dirname "$CROSS_MEMORIAL")"
  [[ ! -f "$CROSS_MEMORIAL" ]] && cat > "$CROSS_MEMORIAL" << 'EOF'
# Cross-Project Memorial
# Carried forward across all projects. Append, never delete.
# Memorial Updater writes to this after every round.

## Discipline: pre-emit-grilling
### Violations
### Confirmations
### Reinforcement rules derived

## Discipline: halt-discipline
### Violations
### Confirmations
### Reinforcement rules derived

## Discipline: right-reasons-audit
### Violations
### Confirmations
### Reinforcement rules derived

## Discipline: role-boundary
### Violations
### Confirmations
### Reinforcement rules derived

## Discipline: anti-scope
### Violations
### Confirmations
### Reinforcement rules derived

## Discipline: tdd-discipline
### Violations
### Confirmations
### Reinforcement rules derived

## Discipline: context-isolation
### Violations
### Confirmations
### Reinforcement rules derived

## Emerging patterns
EOF

  # NEXT-ROLE.md state machine for the requested round.
  # Three cases:
  #   (1) File doesn't exist → auto-init (fresh project / first round).
  #   (2) File exists with `CURRENT-ROUND: $ROUND` → use as-is (operator-prepared
  #       OR pipeline-prepared on a prior run of this round).
  #   (3) File exists with a DIFFERENT `CURRENT-ROUND:` → refuse to silently
  #       overwrite, because the file likely carries operator-prepared inputs
  #       (round-scope directives, custom input lists, escalation notes) that
  #       auto-init would destroy.
  # Case (3) was the silent-overwrite-then-architect-misses-operator-inputs bug.
  # Operator may opt back into the old behavior with `--reset-next-role`.
  if [[ ! -f "$COORD/NEXT-ROLE.md" ]]; then
    cat > "$COORD/NEXT-ROLE.md" << EOF
CURRENT-ROUND: $ROUND
NEXT-ROLE: $FIRST_ROLE
STATUS: READY

## Inputs for next role
- $PRD_PATH

## Escalation items
(none)

## Routing notes
(none)
EOF
    log "Initialized NEXT-ROLE.md for round $ROUND ($TIER) — fresh project."
  elif grep -q "CURRENT-ROUND: $ROUND" "$COORD/NEXT-ROLE.md" 2>/dev/null; then
    log "NEXT-ROLE.md already at CURRENT-ROUND: $ROUND — using as-is (operator-prepared or prior-run state)."
  elif $RESET_NEXT_ROLE; then
    cat > "$COORD/NEXT-ROLE.md" << EOF
CURRENT-ROUND: $ROUND
NEXT-ROLE: $FIRST_ROLE
STATUS: READY

## Inputs for next role
- $PRD_PATH

## Escalation items
(none)

## Routing notes
(none)
EOF
    log_warn "--reset-next-role: overwrote NEXT-ROLE.md with auto-init template for round $ROUND."
  else
    local existing_round
    existing_round=$(grep -m1 -E '^CURRENT-ROUND:' "$COORD/NEXT-ROLE.md" | awk '{print $2}')
    log_error "NEXT-ROLE.md shows CURRENT-ROUND: ${existing_round:-<missing>} but you requested round $ROUND."
    log_error "The pipeline refuses to silently overwrite NEXT-ROLE.md, because the existing"
    log_error "file may carry operator-prepared inputs (round-scope directives, custom input"
    log_error "lists, escalation notes) that auto-init would destroy. Pick one:"
    log_error ""
    log_error "  (a) Manually update NEXT-ROLE.md to 'CURRENT-ROUND: $ROUND' with the inputs"
    log_error "      the next role should read. Then re-run the pipeline."
    log_error "  (b) Re-run with --round ${existing_round:-<existing>} if you meant to continue"
    log_error "      the round NEXT-ROLE.md is already prepared for."
    log_error "  (c) Re-run with --reset-next-role to overwrite NEXT-ROLE.md with the default"
    log_error "      auto-init template. Use only when you're sure the existing file has no"
    log_error "      operator-prepared content worth preserving."
    exit 1
  fi

  # Warn on prior BLOCKED state — don't silently overwrite
  local cur_status
  cur_status=$(check_status)
  if [[ "$cur_status" == "BLOCKED" ]]; then
    log_warn "NEXT-ROLE.md shows STATUS: BLOCKED from a prior failed run."
    log_warn "Continuing with --start-at ${START_AT:-ARCHITECT}."
    log_warn "If the underlying issue isn't resolved, the session will fail again."
  fi

  # Pipeline sync check (non-blocking — warns if canonical drift detected)
  local sync_script="$PROJECT_ROOT/scripts/check-pipeline-sync.sh"
  if [[ -x "$sync_script" ]]; then
    local sync_exit=0
    local sync_output
    sync_output=$("$sync_script" 2>&1) || sync_exit=$?
    if [[ -n "$sync_output" ]] || [[ $sync_exit -ne 0 ]]; then
      while IFS= read -r sync_line; do
        log_warn "sync: $sync_line"
      done <<< "$sync_output"
    fi
  fi

  log ""
  log "Project:    $PROJECT_ROOT"
  log "Round:      $ROUND"
  log "Tier:       $TIER_DESC"
  log "PRD:        $PRD_PATH"
  log "Start at:   ${START_AT:-$FIRST_ROLE (full round)}"
  if $MODEL_ROUTING && $MODEL_FLAG_SUPPORTED; then
    log "Routing:    Architect=$MODEL_ARCHITECT  Reviewer=$MODEL_REVIEWER"
    log "            Implementer=$MODEL_IMPLEMENTER  Memorial=$MODEL_MEMORIAL"
  else
    log "Routing:    disabled — all roles use $MODEL_DEFAULT"
  fi
  log ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
run_preflight

for role in "${ROLES[@]}"; do
  should_run "$role" || continue

  # Hybrid Reviewer special case: dispatch Opus + Sonnet in parallel + merger.
  # Only applies to audit-tier (full-tier already has Architect as the second
  # set of eyes; hybridizing Reviewer there is over-engineering).
  if [[ "$role" == "REVIEWER" ]] && $HYBRID_REVIEWER && [[ "$TIER" == "audit" ]]; then
    if ! dispatch_hybrid_reviewer; then
      log_error "Hybrid Reviewer dispatch failed for $ROUND. Pipeline aborting before Memorial-Updater."
      exit 1
    fi
    continue
  fi

  # Coordinator wave-gate close: run aggregate verifier + tier-aware consolidation
  # Reviewer directly (not via run_role — wave-gate is orchestration, not a single
  # Claude session).
  if [[ "$role" == "COORDINATOR-WAVE-GATE" ]]; then
    run_wave_gate_close
    continue
  fi

  case "$role" in
    ARCHITECT)        build_architect_prompt ;;
    IMPLEMENTER)      build_implementer_prompt ;;
    REVIEWER)         build_reviewer_prompt ;;
    MEMORIAL-UPDATER) build_memorial_prompt ;;
    COORDINATOR)      build_coordinator_prompt ;;
  esac

  run_role "$role" \
    "$COORD/.prompt-$(echo "$role" | tr '[:upper:]' '[:lower:]').md" \
    "$(get_model "$role")" \
    "$(get_budget "$role")"
done

# ── Completion ────────────────────────────────────────────────────────────────
log_section "ROUND $ROUND — FINAL STATUS"

FINAL_STATUS=$(check_status)
NEXT_NUM=$(printf '%02d' $((10#${ROUND#R} + 1)))

case "$FINAL_STATUS" in
  MERGE-READY)
    log "✅ Pipeline complete. Reviewer found no CRITICAL issues."
    log ""
    log "  Reviewer report:  coordination/reviews/REVIEWER-REPORT-${ROUND}.md"
    log "  Round summary:    coordination/logs/ROUND-${ROUND}-SUMMARY.md"
    log "  CLAUDE-*.md:      check per-role REINFORCEMENTS sections for new lines"
    log ""
    log "  Merge when ready, then:"
    log "  ./run-pipeline.sh --round R${NEXT_NUM}"
    exit 0
    ;;
  ROUND-COMPLETE)
    log "✅ Round complete."
    log "  Summary: coordination/logs/ROUND-${ROUND}-SUMMARY.md"
    exit 0
    ;;
  ESCALATE)
    check_escalation  # prints escalation items and exits 2
    ;;
  BLOCKED)
    log_error "Round ended in BLOCKED state. Check logs and resolve before resuming."
    exit 1
    ;;
  *)
    log_warn "Unexpected status: $FINAL_STATUS. Check coordination/NEXT-ROLE.md."
    exit 1
    ;;
esac
