#!/bin/bash
# anchor-wave-init.sh — Bring an existing project to multi-track readiness.
#
# Usage:
#   ./scripts/anchor-wave-init.sh [--apply]
#
# Run from the project root. Performs idempotent setup for multi-track Anchor:
#
#   1. Verifies project layout (.git/, coordination/, run-pipeline.sh)
#   2. Adds multi-track .gitignore patterns if missing
#       (coordination/.pipeline-*.lock, coordination/clusters/,
#        coordination/multi-track-status.json)
#   3. Creates coordination/cluster-scopes/ scaffold if missing
#   4. Checks if run-pipeline.sh is current vs canonical; warns + suggests
#      anchor-update-project.sh if drift detected
#   5. Checks if a WAVE-PLAN-NN.md exists in coordination/; if not, points
#      operator at the template at templates/WAVE-PLAN-TEMPLATE.md
#
# Idempotent — safe to re-run. By default does a dry-run preview; pass
# --apply to make changes.
#
# Exit codes:
#   0 = ready (or all changes applied successfully)
#   1 = error or operator declined
#   2 = drift detected; operator should sync via anchor-update-project.sh

set -euo pipefail

APPLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --apply) APPLY=true; shift ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "ERROR: unknown arg '$1'"; exit 1 ;;
  esac
done

# ── Resolve project root + canonical ─────────────────────────────────────────
PROJECT_ROOT="$(pwd)"
ANCHOR_CANONICAL="${ANCHOR_CANONICAL:-$HOME/anchor/integrations/superpowers-claude-code}"

# ── Sanity checks ────────────────────────────────────────────────────────────
if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
  echo "ERROR: $PROJECT_ROOT is not a git repository."
  exit 1
fi
if [[ ! -d "$PROJECT_ROOT/coordination" ]]; then
  echo "ERROR: $PROJECT_ROOT has no coordination/ directory."
  echo "       This script bootstraps multi-track for projects already scaffolded"
  echo "       via new-project.sh. For brand-new projects use new-project.sh."
  exit 1
fi

echo "Project: $PROJECT_ROOT"
echo "Canonical reference: $ANCHOR_CANONICAL"
if $APPLY; then
  echo "Mode: APPLY (will write changes)"
else
  echo "Mode: DRY-RUN (no changes; pass --apply to commit them)"
fi
echo ""

CHANGES_NEEDED=0
DRIFT=0

# ── 1. .gitignore patterns ───────────────────────────────────────────────────
GITIGNORE="$PROJECT_ROOT/.gitignore"
NEEDED_PATTERNS=(
  "coordination/.pipeline-*.lock"
  "coordination/clusters/"
  "coordination/multi-track-status.json"
)

if [[ ! -f "$GITIGNORE" ]]; then
  echo "❌ .gitignore missing — would create with multi-track patterns."
  CHANGES_NEEDED=$((CHANGES_NEEDED + 1))
  if $APPLY; then
    printf '%s\n' "${NEEDED_PATTERNS[@]}" > "$GITIGNORE"
    echo "  ✅ created .gitignore with multi-track patterns"
  fi
else
  MISSING=()
  for pattern in "${NEEDED_PATTERNS[@]}"; do
    if ! grep -qxF "$pattern" "$GITIGNORE" 2>/dev/null; then
      MISSING+=("$pattern")
    fi
  done
  if [[ ${#MISSING[@]} -eq 0 ]]; then
    echo "✅ .gitignore has all multi-track patterns."
  else
    echo "❌ .gitignore missing ${#MISSING[@]} pattern(s):"
    printf '     %s\n' "${MISSING[@]}"
    CHANGES_NEEDED=$((CHANGES_NEEDED + 1))
    if $APPLY; then
      printf '\n# multi-track Anchor (added by anchor-wave-init)\n' >> "$GITIGNORE"
      printf '%s\n' "${MISSING[@]}" >> "$GITIGNORE"
      echo "  ✅ appended missing patterns to .gitignore"
    fi
  fi
fi
echo ""

# ── 2. coordination/cluster-scopes/ scaffold ─────────────────────────────────
CLUSTER_SCOPES_DIR="$PROJECT_ROOT/coordination/cluster-scopes"
if [[ -d "$CLUSTER_SCOPES_DIR" ]]; then
  echo "✅ coordination/cluster-scopes/ exists."
else
  echo "❌ coordination/cluster-scopes/ missing — would create."
  CHANGES_NEEDED=$((CHANGES_NEEDED + 1))
  if $APPLY; then
    mkdir -p "$CLUSTER_SCOPES_DIR"
    cat > "$CLUSTER_SCOPES_DIR/README.md" <<'README'
# Cluster scope blocks

This directory holds per-cluster PRD scope blocks authored by the
Coordinator. The `multi-track-cluster-setup.sh --scope <PATH>` flag
plants these into each cluster worktree's `coordination/PRD.md` at
dispatch time.

Layout convention:

    cluster-scopes/
    └── wave-1/
        ├── wu-p2-1.md
        ├── wu-p1-1.md
        └── ...

One file per work unit per wave. Each file contains a PRD scope block
matching the format the cluster's pipeline expects at the top of
coordination/PRD.md (Tier verdict + Scope + ACs + Anti-scope +
Reinforcements in scope + Cluster context).

See `MULTI-TRACK-RUNBOOK.md` for the full dispatch flow.
README
    echo "  ✅ created coordination/cluster-scopes/ with README"
  fi
fi
echo ""

# ── 3. run-pipeline.sh drift check ───────────────────────────────────────────
PROJECT_PIPELINE="$PROJECT_ROOT/run-pipeline.sh"
CANONICAL_PIPELINE="$ANCHOR_CANONICAL/run-pipeline.sh"
if [[ ! -f "$PROJECT_PIPELINE" ]]; then
  echo "❌ run-pipeline.sh missing in project root."
  echo "   Run anchor-update-project.sh to install."
  DRIFT=1
elif [[ ! -f "$CANONICAL_PIPELINE" ]]; then
  echo "⚠️  Canonical run-pipeline.sh not found at $CANONICAL_PIPELINE — skipping drift check."
elif diff -q "$PROJECT_PIPELINE" "$CANONICAL_PIPELINE" >/dev/null 2>&1; then
  echo "✅ run-pipeline.sh in sync with canonical."
else
  echo "⚠️  run-pipeline.sh differs from canonical."
  echo "   Compare:  diff $PROJECT_PIPELINE $CANONICAL_PIPELINE"
  echo "   Sync:     anchor-update-project.sh $PROJECT_ROOT"
  DRIFT=1
fi
echo ""

# ── 4. WAVE-PLAN-NN.md presence ──────────────────────────────────────────────
WAVE_PLANS=$(ls "$PROJECT_ROOT/coordination/WAVE-PLAN-"*.md 2>/dev/null | head -3)
if [[ -n "$WAVE_PLANS" ]]; then
  echo "✅ Wave plan(s) present in coordination/:"
  echo "$WAVE_PLANS" | sed 's|.*coordination/|    |'
else
  echo "ℹ️  No WAVE-PLAN-NN.md in coordination/."
  echo "   Author one using templates/WAVE-PLAN-TEMPLATE.md as scaffold."
  echo "   The Coordinator role produces this at planning time."
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
if $APPLY; then
  echo "════════════════════════════════════════════════════════════════"
  if [[ $CHANGES_NEEDED -eq 0 ]]; then
    echo "✅ No changes required. Project is multi-track-ready."
  else
    echo "✅ $CHANGES_NEEDED change(s) applied. Project is multi-track-ready."
  fi
  if [[ $DRIFT -ne 0 ]]; then
    echo "⚠️  run-pipeline.sh drift detected — sync recommended before dispatching a wave."
    exit 2
  fi
  exit 0
else
  echo "════════════════════════════════════════════════════════════════"
  if [[ $CHANGES_NEEDED -eq 0 && $DRIFT -eq 0 ]]; then
    echo "✅ Project is already multi-track-ready."
  else
    echo "Detected $CHANGES_NEEDED change(s) needed; $DRIFT drift item(s) flagged."
    echo ""
    echo "Re-run with --apply to make the changes:"
    echo "  $0 --apply"
  fi
  exit 0
fi
