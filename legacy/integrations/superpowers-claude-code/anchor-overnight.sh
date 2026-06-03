#!/bin/bash
# =============================================================================
# anchor-overnight — toggle a permission allow-list for unattended runs
#
# When the operator wants the pipeline (or an interactive Claude Code session
# that invokes the pipeline) to run autonomously overnight, each per-action
# permission prompt is friction. This script merges a curated allow-list
# into ~/.claude/settings.local.json so common build commands (sed, awk,
# grep, npm, git, etc.) run without prompting.
#
# The allow-list is intentionally NOT blanket-bypass. It excludes:
#   - rm        (destructive — see it before approving)
#   - sudo      (privilege escalation)
#   - curl/wget (network reach)
#   - brew/apt  (system package installation)
#   - eval      (arbitrary code execution)
#
# Anchor's HALT/ESCALATE discipline remains active under both states; this
# toggle only changes the per-action UX, not the role-coordination safety
# net. Bypass these prompts overnight; keep the methodology's halt discipline
# always.
#
# Usage:
#   anchor-overnight on        # enable overnight allow-list
#   anchor-overnight off       # revert to backup
#   anchor-overnight status    # show current state
#   anchor-overnight --help
#
# Environment:
#   ANCHOR_SETTINGS   Path to the settings file to modify. Defaults to
#                     ~/.claude/settings.local.json. Set to a project-
#                     scoped path (e.g., $PROJECT/.claude/settings.local.json)
#                     for overnight rules limited to that project.
#
# Requires: jq (Homebrew: `brew install jq`).
#
# Exit codes:
#   0 = state changed (or was already in requested state)
#   1 = misuse / missing dependency / no backup to restore
# =============================================================================

set -euo pipefail

SETTINGS="${ANCHOR_SETTINGS:-$HOME/.claude/settings.local.json}"
BACKUP="$SETTINGS.anchor-overnight.bak"

# Curated allow-list. Add to this if your project needs more.
# The set is intentionally moderate, not blanket — see header comments for
# what's excluded and why.
ANCHOR_RULES='[
  "Bash(sed *)",
  "Bash(awk *)",
  "Bash(grep *)",
  "Bash(find *)",
  "Bash(ls *)",
  "Bash(cat *)",
  "Bash(head *)",
  "Bash(tail *)",
  "Bash(wc *)",
  "Bash(stat *)",
  "Bash(diff *)",
  "Bash(cmp *)",
  "Bash(mkdir *)",
  "Bash(cp *)",
  "Bash(mv *)",
  "Bash(chmod *)",
  "Bash(echo *)",
  "Bash(printf *)",
  "Bash(date *)",
  "Bash(ps *)",
  "Bash(pwd)",
  "Bash(git *)",
  "Bash(gh *)",
  "Bash(npm *)",
  "Bash(npx *)",
  "Bash(node *)",
  "Bash(yarn *)",
  "Bash(pnpm *)",
  "Bash(psql *)",
  "Bash(./scripts/*)",
  "Bash(./tools/*)",
  "Bash(./run-pipeline.sh *)",
  "Bash(./finalize-round.sh *)"
]'

show_help() {
  awk '/^# ====/ {n++; if (n==2) exit; next} n==1 {sub(/^# ?/, ""); print}' "$0"
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: 'jq' is required but not installed." >&2
    echo "       Install: brew install jq" >&2
    exit 1
  fi
}

cmd_on() {
  require_jq
  if [[ -f "$BACKUP" ]]; then
    echo "Overnight allow-list already enabled (backup exists at $BACKUP)."
    echo "Run 'anchor-overnight off' to revert."
    exit 0
  fi
  # Snapshot current state (or mark "no original file" with a sentinel).
  mkdir -p "$(dirname "$SETTINGS")"
  if [[ -f "$SETTINGS" ]]; then
    cp "$SETTINGS" "$BACKUP"
  else
    # Sentinel: empty object means "there was no settings file originally"
    echo '{}' > "$BACKUP"
    echo '{}' > "$SETTINGS"
  fi
  # Merge allow-list into existing settings, preserving any other rules.
  jq --argjson rules "$ANCHOR_RULES" '
    .permissions.allow = ((.permissions.allow // []) + $rules | unique)
  ' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
  echo "✓ Overnight allow-list enabled in $SETTINGS"
  echo ""
  echo "Restart your Claude Code session(s) to pick up changes."
  echo "When done, revert with:  anchor-overnight off"
}

cmd_off() {
  if [[ ! -f "$BACKUP" ]]; then
    echo "Overnight allow-list is not currently enabled (no backup at $BACKUP)."
    exit 0
  fi
  if [[ "$(cat "$BACKUP")" == "{}" ]]; then
    # There was no original settings file — remove what we created.
    rm -f "$SETTINGS"
  else
    mv "$BACKUP" "$SETTINGS"
  fi
  rm -f "$BACKUP" 2>/dev/null || true
  echo "✓ Overnight allow-list reverted. Restart Claude Code to apply."
}

cmd_status() {
  if [[ -f "$BACKUP" ]]; then
    echo "Overnight: ON"
    echo "  Settings: $SETTINGS"
    echo "  Backup:   $BACKUP"
  else
    echo "Overnight: OFF"
    echo "  Settings: $SETTINGS"
  fi
}

case "${1:-}" in
  on)       cmd_on ;;
  off)      cmd_off ;;
  status)   cmd_status ;;
  --help|-h) show_help ;;
  '')       echo "Usage: anchor-overnight {on|off|status}" >&2; exit 1 ;;
  *)        echo "Unknown subcommand: $1" >&2; show_help; exit 1 ;;
esac
