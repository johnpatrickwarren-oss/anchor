#!/bin/bash
# =============================================================================
# anchor-update-project — sync a project's run-pipeline.sh from canonical
#
# Each scaffolded Anchor project carries its own copy of run-pipeline.sh.
# When the canonical pipeline script gains improvements (new tier, bug fix,
# discipline update), the project's copy goes stale silently — projects can
# end up on different generations of the script.
#
# This tool syncs run-pipeline.sh from canonical to a project, with a diff
# preview, a confirmation prompt, and a timestamped backup. CLAUDE.md is
# intentionally out of scope in Phase 1 — its smart merge (preserving
# accumulated REINFORCED lines while updating role discipline blocks)
# warrants more careful design.
#
# Usage:
#   anchor-update-project PROJECT_PATH [options]
#
# Options:
#   --apply        Apply without prompting (use in scripts)
#   --force        Apply even if 'claude -p' processes appear active
#   --help, -h     Show this help and exit
#
# Environment:
#   ANCHOR_CANONICAL  Path to the integration directory containing
#                     run-pipeline.sh. Defaults to
#                     $HOME/anchor/integrations/superpowers-claude-code.
#
# Exit codes:
#   0 = updated, already in sync, or user declined
#   1 = invalid arguments or canonical/project files missing
#   2 = refused due to active pipeline (pass --force to override)
# =============================================================================

set -euo pipefail

ANCHOR_CANONICAL="${ANCHOR_CANONICAL:-$HOME/anchor/integrations/superpowers-claude-code}"

# ── Arg parsing ──────────────────────────────────────────────────────────────
APPLY=false
FORCE=false
PROJECT=""

show_help() {
  awk '/^# ====/ {n++; if (n==2) exit; next} n==1 {sub(/^# ?/, ""); print}' "$0"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --apply)   APPLY=true;  shift ;;
    --force)   FORCE=true;  shift ;;
    --help|-h) show_help; exit 0 ;;
    -*) echo "Unknown flag: $1" >&2; exit 1 ;;
    *)
      if [[ -z "$PROJECT" ]]; then
        PROJECT="$1"
      else
        echo "Unexpected argument: $1 (only one project path allowed)" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  echo "Usage: anchor-update-project PROJECT_PATH [--apply] [--force]" >&2
  echo "Run with --help for details." >&2
  exit 1
fi

# Normalize to absolute path
if [[ ! -d "$PROJECT" ]]; then
  echo "Project directory not found: $PROJECT" >&2
  exit 1
fi
PROJECT="$(cd "$PROJECT" && pwd)"

CANONICAL_SCRIPT="$ANCHOR_CANONICAL/run-pipeline.sh"
PROJECT_SCRIPT="$PROJECT/run-pipeline.sh"

if [[ ! -f "$CANONICAL_SCRIPT" ]]; then
  echo "Canonical run-pipeline.sh not found at: $CANONICAL_SCRIPT" >&2
  echo "Set the ANCHOR_CANONICAL env var to the integration directory." >&2
  exit 1
fi

if [[ ! -f "$PROJECT_SCRIPT" ]]; then
  echo "Project has no run-pipeline.sh at: $PROJECT_SCRIPT" >&2
  echo "Is this an Anchor project? Use new-project.sh to scaffold one." >&2
  exit 1
fi

# ── Already in sync? ─────────────────────────────────────────────────────────
if cmp -s "$CANONICAL_SCRIPT" "$PROJECT_SCRIPT"; then
  echo "Already in sync: $PROJECT_SCRIPT matches canonical."
  exit 0
fi

# ── Safety: refuse if a pipeline appears to be running ───────────────────────
if ! $FORCE; then
  if pgrep -f "claude -p" >/dev/null 2>&1; then
    echo "WARN: 'claude -p' processes appear to be active on this machine." >&2
    echo "Updating run-pipeline.sh during an in-flight round may produce" >&2
    echo "inconsistent behavior (the running session reads the file path" >&2
    echo "but role prompts and CLAUDE.md are stamped per-role)." >&2
    echo "" >&2
    echo "Wait for the round to finish, or pass --force to override." >&2
    exit 2
  fi
fi

# ── Show diff ────────────────────────────────────────────────────────────────
echo "Update available:"
echo "  canonical: $CANONICAL_SCRIPT"
echo "  project:   $PROJECT_SCRIPT"
echo ""
echo "──────── diff (project → canonical) ────────"
if command -v git >/dev/null 2>&1; then
  git --no-pager diff --no-index --color=auto "$PROJECT_SCRIPT" "$CANONICAL_SCRIPT" || true
else
  diff -u "$PROJECT_SCRIPT" "$CANONICAL_SCRIPT" || true
fi
echo "──────── end diff ────────"
echo ""

# ── Confirm and apply ────────────────────────────────────────────────────────
if ! $APPLY; then
  read -r -p "Apply this update? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Skipped — no changes made."; exit 0 ;;
  esac
fi

BACKUP="$PROJECT_SCRIPT.bak-$(date +%Y%m%d-%H%M%S)"
cp "$PROJECT_SCRIPT" "$BACKUP"
cp "$CANONICAL_SCRIPT" "$PROJECT_SCRIPT"
chmod +x "$PROJECT_SCRIPT"

echo ""
echo "✓ Updated: $PROJECT_SCRIPT"
echo "  Backup:  $BACKUP"
echo ""
echo "CLAUDE-*.md not touched (Phase 2 — needs REINFORCED-preserving merge)."
echo "  Six discipline files exist post-split: CLAUDE.md (slim loader),"
echo "  CLAUDE-COMMON.md, and CLAUDE-{ARCHITECT,IMPLEMENTER,REVIEWER,MEMORIAL}.md."
echo "  Per-role REINFORCED lines must be preserved when forward-syncing."
echo "Test the new script with --dry-run before the next live round:"
echo "  cd $PROJECT && ./run-pipeline.sh --round R01 --dry-run"
