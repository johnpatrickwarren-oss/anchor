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

# Model routing
# Opus 4.7: Architect (design reasoning) and Reviewer (adversarial audit)
# Sonnet 4.6: Implementer (execution against spec) and Memorial (synthesis)
# Rationale: Opus 4.7's gains are concentrated in hard reasoning and agentic
# file-system memory — exactly what design and adversarial audit need.
# Sonnet 4.6 handles implementation execution and bookkeeping at 40% lower cost.
MODEL_ARCHITECT="claude-opus-4-7"
MODEL_IMPLEMENTER="claude-sonnet-4-6"
MODEL_REVIEWER="claude-opus-4-7"
MODEL_MEMORIAL="claude-sonnet-4-6"
MODEL_DEFAULT="claude-sonnet-4-6"

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
BUDGET_MEMORIAL=30

# Populated by detect_claude_flags()
PERMISSION_FLAG=()
MODEL_FLAG_SUPPORTED=false
BUDGET_FLAG_SUPPORTED=false

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --round)            ROUND="$2";        shift 2 ;;
    --start-at)         START_AT="$2";     shift 2 ;;
    --prd)              PRD_PATH="$2";     shift 2 ;;
    --tier)             TIER="$2";         shift 2 ;;
    --dry-run)          DRY_RUN=true;      shift   ;;
    --no-model-routing) MODEL_ROUTING=false; shift  ;;
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
  --no-model-routing   Use CLAUDE_DEFAULT_MODEL for all roles

Exit codes:
  0 = success (MERGE-READY or ROUND-COMPLETE)
  1 = error (check logs)
  2 = escalation (human decision needed — see coordination/NEXT-ROLE.md)
EOF
      exit 0 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

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
$PROJECT_ROOT/CLAUDE.md at the end of the IMPLEMENTER role block:
  # REINFORCED [date] — [specific rule from the violation]

Be specific. "Pre-emit grilling confirmed" is not useful.
"Pre-emit grilling caught missing tests for the renamed constant before
routing" is useful.

STEP 5 — Write coordination/logs/ROUND-${ROUND}-SUMMARY.md

Brief (≤1 page) — sections:
  ## What worked
  ## What violated discipline (if any)
  ## Tier note: chose solo because [Zn]; final diff stayed within mechanical bounds [yes/no]
  ## Reinforcements added to CLAUDE.md this round (if any)

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
  cat > "$COORD/.prompt-reviewer.md" << PROMPT
You are the REVIEWER for round $ROUND.

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

Deliverable: coordination/reviews/REVIEWER-REPORT-${ROUND}.md

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

Routing:
  CRITICAL exists → STATUS: ESCALATE
  MAJOR or below  → STATUS: MERGE-READY
Update coordination/NEXT-ROLE.md accordingly.
List your report path in the Inputs section.
Append CONFIRMATION/VIOLATION entries to coordination/MEMORIAL.md.

ROLE BOUNDARY: Document findings. Do not fix. Do not re-implement.
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

3. Update $PROJECT_ROOT/CLAUDE.md
   For every VIOLATION this round, find the relevant role block in CLAUDE.md.
   Append at the end of that block:
     # REINFORCED $(date '+%Y-%m-%d') — [specific rule from the violation]
   Do not delete prior reinforcements. The cumulative history is the value.
   If CLAUDE.md does not have a clear insertion point, add after the role's
   last existing instruction line.

4. Write coordination/logs/ROUND-${ROUND}-SUMMARY.md
   Sections:
     ## What worked
     ## What violated discipline (role, discipline, what happened)
     ## Root cause analysis (why did each violation occur — not just what)
     ## Reinforcements added to CLAUDE.md this round
     ## Watch list for next round (patterns to look for)
     ## Emerging cross-project patterns (if any)

5. Update coordination/NEXT-ROLE.md
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
    REVIEWER)         echo "$MODEL_REVIEWER" ;;
    MEMORIAL-UPDATER) echo "$MODEL_MEMORIAL" ;;
    *)                echo "$MODEL_DEFAULT" ;;
  esac
}

get_budget() {
  case "$1" in
    ARCHITECT)        echo "$BUDGET_ARCHITECT" ;;
    IMPLEMENTER)      echo "$BUDGET_IMPLEMENTER" ;;
    REVIEWER)         echo "$BUDGET_REVIEWER" ;;
    MEMORIAL-UPDATER) echo "$BUDGET_MEMORIAL" ;;
    *)                echo "40" ;;
  esac
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
#   M  CLAUDE.md (REINFORCED appendings under role blocks)
#   M  coordination/MEMORIAL.md (CONFIRMATION/VIOLATION entries)
#   M  coordination/NEXT-ROLE.md (final state, ROUND-COMPLETE status)
#   ?? coordination/logs/ROUND-RNN-SUMMARY.md (new)
#   ?? coordination/reviews/REVIEWER-REPORT-RNN.md (if Reviewer left it
#      uncommitted, which is the current behavior)
#
# Does not commit:
#   - Stray modifications outside coordination/ + CLAUDE.md (unintentional).
#   - .pipeline-RNN.lock changes (gitignored per A9; if a project doesn't
#     yet have the gitignore line, the lockfile change still lands in
#     `git add -A coordination/` but is ignorable in audit).
commit_memorial_outputs() {
  cd "$PROJECT_ROOT" || return 1

  # Stage all coordination/ changes + any CLAUDE.md modification.
  git add -A coordination/ CLAUDE.md 2>/dev/null || true

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

# ── Core runner with retry and rate limit handling ────────────────────────────
run_role() {
  local role="$1"
  local prompt_file="$2"
  local model="$3"
  local budget="$4"
  local role_log="$LOG_DIR/${role}-${ROUND}.log"

  log_section "ROLE: $role | MODEL: $model | ROUND: $ROUND"

  # Stamp role and round into CLAUDE.md before the session opens.
  # Each session reads a fresh CLAUDE.md — this is what achieves role identity
  # without relying on conversation history.
  sed -i.bak \
    -e "s/^# THIS SESSION ROLE:.*/# THIS SESSION ROLE: $role/" \
    -e "s/^# Round:.*/# Round: $ROUND/" \
    "$PROJECT_ROOT/CLAUDE.md"
  rm -f "$PROJECT_ROOT/CLAUDE.md.bak"

  if $DRY_RUN; then
    log "[DRY-RUN] claude -p <$(wc -l < "$prompt_file") line prompt>"
    log "[DRY-RUN] flags: ${PERMISSION_FLAG[*]} --model $model --max-turns $budget"
    log "[DRY-RUN] --append-system-prompt: CLAUDE.md ($(wc -l < "$PROJECT_ROOT/CLAUDE.md") lines)"
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

    # Append CLAUDE.md as system prompt addition.
    # --append-system-prompt preserves Claude Code's built-in capabilities
    # and adds our role + discipline definitions on top.
    flags+=("--append-system-prompt" "$(cat "$PROJECT_ROOT/CLAUDE.md")")

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
  [[ ! -f "$PROJECT_ROOT/CLAUDE.md" ]] && {
    log_error "CLAUDE.md not found."
    log_error "Run: cp \$(dirname \$0)/CLAUDE.md.template CLAUDE.md and fill in project name."
    exit 1
  }

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

  # Initialize NEXT-ROLE.md for new round
  if ! grep -q "CURRENT-ROUND: $ROUND" "$COORD/NEXT-ROLE.md" 2>/dev/null; then
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
    log "Initialized NEXT-ROLE.md for round $ROUND ($TIER)"
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

  case "$role" in
    ARCHITECT)        build_architect_prompt ;;
    IMPLEMENTER)      build_implementer_prompt ;;
    REVIEWER)         build_reviewer_prompt ;;
    MEMORIAL-UPDATER) build_memorial_prompt ;;
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
    log "  CLAUDE.md:        check bottom section for new reinforcements"
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
