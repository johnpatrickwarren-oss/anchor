#!/bin/bash
# consolidate-reinforcements.sh — Archive aged REINFORCED lines from CLAUDE-*.md.
#
# Usage:
#   ./scripts/consolidate-reinforcements.sh [--age-days N] [--dry-run]
#
# Walks CLAUDE-COMMON.md and every CLAUDE-<ROLE>.md, finds REINFORCED lines
# with a YYYY-MM-DD stamp older than --age-days (default 180) and moves them
# to coordination/reinforcements-archive/<today>-archive.md. The live files
# keep only recent reinforcements, capping per-session prompt weight.
#
# The archive is grep-able audit history. To distill archived lines into
# generalized rules, run an LLM consolidation pass afterward (operator's call;
# kept manual so cost discipline stays in your hands, not the script's).
#
# Recognized REINFORCED line format (written by the Memorial Updater):
#   # REINFORCED YYYY-MM-DD — <rule text>
# Lines without a parseable date are skipped.
#
# Options:
#   --age-days N    Archive lines older than N days (default 180).
#   --dry-run       Report what would be archived without modifying files.
#
# Exit codes:
#   0 = success (archived OR nothing eligible)
#   1 = error

set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────────
AGE_DAYS=180
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --age-days) AGE_DAYS="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true;  shift   ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "ERROR: unknown arg '$1'"; exit 1 ;;
  esac
done

if ! [[ "$AGE_DAYS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --age-days must be a positive integer (got '$AGE_DAYS')."
  exit 1
fi

# ── Project root + sanity ────────────────────────────────────────────────────
PROJECT_ROOT="$(pwd)"
if [[ ! -d "$PROJECT_ROOT/coordination" ]]; then
  echo "ERROR: must be run from a project root containing coordination/."
  echo "       Current dir: $PROJECT_ROOT"
  exit 1
fi

# ── Date arithmetic (cross-platform BSD/GNU) ─────────────────────────────────
TODAY=$(date +%Y-%m-%d)
if date -v -1d +%Y-%m-%d > /dev/null 2>&1; then
  # BSD date (macOS)
  CUTOFF=$(date -v -"${AGE_DAYS}"d +%Y-%m-%d)
else
  # GNU date (Linux)
  CUTOFF=$(date -d "${AGE_DAYS} days ago" +%Y-%m-%d)
fi

echo "Today:        $TODAY"
echo "Age cutoff:   $AGE_DAYS days"
echo "Archive when: line date < $CUTOFF"
echo ""

# ── File list ────────────────────────────────────────────────────────────────
CLAUDE_FILES=(
  CLAUDE-COMMON.md
  CLAUDE-ARCHITECT.md
  CLAUDE-IMPLEMENTER.md
  CLAUDE-REVIEWER.md
  CLAUDE-MEMORIAL.md
)

# ── Archive path ─────────────────────────────────────────────────────────────
ARCHIVE_DIR="$PROJECT_ROOT/coordination/reinforcements-archive"
ARCHIVE="$ARCHIVE_DIR/${TODAY}-archive.md"

# ── Per-file scan ────────────────────────────────────────────────────────────
total_archived=0
declare -a touched_files=()

for f in "${CLAUDE_FILES[@]}"; do
  path="$PROJECT_ROOT/$f"
  if [[ ! -f "$path" ]]; then
    echo "  skip: $f (not present)"
    continue
  fi

  # ISO YYYY-MM-DD compares lexically — exploit that. Field 3 is the date.
  aged=$(awk -v cutoff="$CUTOFF" '
    /^# REINFORCED [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] / && $3 < cutoff { print }
  ' "$path")

  if [[ -z "$aged" ]]; then
    echo "  $f: no aged reinforcements."
    continue
  fi

  count=$(printf '%s\n' "$aged" | wc -l | tr -d ' ')
  echo "  $f: $count aged reinforcement(s) eligible for archival."
  total_archived=$((total_archived + count))
  touched_files+=("$f")
done

if [[ $total_archived -eq 0 ]]; then
  echo ""
  echo "Nothing to archive. Live reinforcement files are within the $AGE_DAYS-day window."
  exit 0
fi

echo ""
echo "Total to archive: $total_archived line(s) across ${#touched_files[@]} file(s)."

if $DRY_RUN; then
  echo ""
  echo "[--dry-run] No files modified. Re-run without --dry-run to commit the move."
  exit 0
fi

# ── Apply: write archive, rewrite live files ─────────────────────────────────
mkdir -p "$ARCHIVE_DIR"

# Initialize archive header if file is new.
if [[ ! -f "$ARCHIVE" ]]; then
  cat > "$ARCHIVE" <<HEADER
# Reinforcements archive — $TODAY

_Lines moved out of live CLAUDE-*.md REINFORCEMENTS sections by
\`scripts/consolidate-reinforcements.sh\` to cap per-session prompt weight.
Kept verbatim with their original dates as the historical audit trail._

_Cutoff for this run: lines dated before $CUTOFF (older than $AGE_DAYS days)._

HEADER
else
  printf '\n---\n\n_Additional batch archived %s (same-day re-run; cutoff %s)._\n\n' "$TODAY" "$CUTOFF" >> "$ARCHIVE"
fi

for f in "${touched_files[@]}"; do
  path="$PROJECT_ROOT/$f"

  # Re-extract aged lines (the read+remove must be atomic per-file).
  aged=$(awk -v cutoff="$CUTOFF" '
    /^# REINFORCED [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] / && $3 < cutoff { print }
  ' "$path")

  # Section header in archive.
  {
    echo "## From \`$f\` (archived $TODAY)"
    echo ""
    printf '%s\n' "$aged"
    echo ""
  } >> "$ARCHIVE"

  # Rewrite live file without aged lines.
  awk -v cutoff="$CUTOFF" '
    /^# REINFORCED [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] / && $3 < cutoff { next }
    { print }
  ' "$path" > "$path.tmp" && mv "$path.tmp" "$path"

  echo "  rewrote: $f"
done

echo ""
echo "✅ Archived $total_archived reinforcement line(s) → $ARCHIVE"
echo ""
echo "Live files trimmed:"
printf '  %s\n' "${touched_files[@]}"
echo ""
echo "Next steps:"
echo "  - Review the archive: $ARCHIVE"
echo "  - (Optional) Run an LLM distill pass to derive generalized rules from"
echo "    the archive and write them into the relevant live CLAUDE-<role>.md"
echo "    REINFORCEMENTS section, citing the archive for evidence."
echo "  - Commit: git add -A coordination/reinforcements-archive/ CLAUDE-*.md"
