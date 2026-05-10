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
    --dry-run)          DRY_RUN=true;      shift   ;;
    --no-model-routing) MODEL_ROUTING=false; shift  ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

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
check_status() {
  grep "^STATUS:" "$COORD/NEXT-ROLE.md" 2>/dev/null \
    | awk '{print $2}' \
    || echo "UNKNOWN"
}

set_status() {
  if [[ -f "$COORD/NEXT-ROLE.md" ]]; then
    sed -i.bak "s/^STATUS:.*/STATUS: $1/" "$COORD/NEXT-ROLE.md"
    rm -f "$COORD/NEXT-ROLE.md.bak"
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

HALT CONDITIONS — stop immediately if any of these occur:
  a. Spec claims something that contradicts the actual codebase
  b. Spec leaves a decision the Architect should have made
  c. Two valid interpretations of a spec item produce different implementations
  d. A requirement cannot be expressed as a test

On halt:
  1. STOP. Do not work around the gap. Not even a temporary workaround.
  2. Write coordination/diagnostics/DIAGNOSTIC-${ROUND}-[short-topic].md:
       Spec claim (exact quote from spec):
       Reality (what the codebase/system actually shows):
       Resolution options:
         Option A: [what it does, consequence]
         Option B: [what it does, consequence]
         Option C: [if applicable]
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
Do not make architectural decisions. All spec gaps → DIAGNOSTIC files.
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
ROLES=("ARCHITECT" "IMPLEMENTER" "REVIEWER" "MEMORIAL-UPDATER")

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
NEXT-ROLE: ARCHITECT
STATUS: READY

## Inputs for next role
- $PRD_PATH

## Escalation items
(none)

## Routing notes
(none)
EOF
    log "Initialized NEXT-ROLE.md for round $ROUND"
  fi

  # Warn on prior BLOCKED state — don't silently overwrite
  local cur_status
  cur_status=$(check_status)
  if [[ "$cur_status" == "BLOCKED" ]]; then
    log_warn "NEXT-ROLE.md shows STATUS: BLOCKED from a prior failed run."
    log_warn "Continuing with --start-at ${START_AT:-ARCHITECT}."
    log_warn "If the underlying issue isn't resolved, the session will fail again."
  fi

  log ""
  log "Project:    $PROJECT_ROOT"
  log "Round:      $ROUND"
  log "PRD:        $PRD_PATH"
  log "Start at:   ${START_AT:-ARCHITECT (full round)}"
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
