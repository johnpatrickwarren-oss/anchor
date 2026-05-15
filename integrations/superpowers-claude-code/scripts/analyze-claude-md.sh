#!/bin/bash
# analyze-claude-md.sh — report growth, duplicates, dormancy, and umbrella
# candidates in CLAUDE.md.
#
# Detect-and-report only. Makes no changes. Operator decides what to act on.
#
# Usage:
#   ./scripts/analyze-claude-md.sh [--output FILE] [--dormancy-window N]
#
# Exit codes:
#   0 = report generated
#   1 = bad arguments or CLAUDE.md missing

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_MD="$PROJECT_ROOT/CLAUDE.md"
MEMORIAL="$PROJECT_ROOT/coordination/MEMORIAL.md"
OUTPUT=""
DORMANCY_WINDOW=10  # rounds: a theme with 0 VIOLATIONs in this many recent rounds is "dormant"

usage() {
  echo "Usage: $0 [--output FILE] [--dormancy-window N]"
  echo "  --output FILE          Write report to FILE (default: stdout)"
  echo "  --dormancy-window N    Treat as dormant if 0 violations in last N rounds (default: 10)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)           OUTPUT="$2";           shift 2 ;;
    --dormancy-window)  DORMANCY_WINDOW="$2";  shift 2 ;;
    --help|-h)          usage ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage ;;
  esac
done

[[ -f "$CLAUDE_MD" ]] || { echo "ERROR: CLAUDE.md not found at $CLAUDE_MD" >&2; exit 1; }

# Redirect stdout if --output given
if [[ -n "$OUTPUT" ]]; then
  exec >"$OUTPUT"
fi

# ── helpers ───────────────────────────────────────────────────────────────────

# Extract theme keyword from a REINFORCED line.
# Most reinforcements have one of three theme patterns:
#   (a) Hyphenated canonical name: "anti-self-confirming-test", "AC-literal-pass",
#       "PRD-conjunction-cross-check", "HALT-discipline", "TDD-ordering"
#   (b) "X discipline" / "X umbrella" / "X check" / "X pattern"
#   (c) Implicit (starts with sentence-starter like "When", "If", "Every")
# We try each in order. Fallback: first noun-like word that isn't a stopword.
extract_theme() {
  local line="$1"
  local rest
  rest="$(echo "$line" | sed -E 's/^# REINFORCED [0-9-]+ — //')"

  # (a) Hyphenated canonical name (3+ tokens joined by hyphens — distinctive).
  # Skip AC-R##-## specific-AC-ID patterns and DIAGNOSTIC-RNN placeholder noise —
  # those are references in the rule body, not the theme.
  local candidate
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    [[ "$candidate" =~ ^AC-R[0-9]+- ]] && continue
    [[ "$candidate" =~ ^DIAGNOSTIC-RNN ]] && continue
    [[ "$candidate" =~ ^Q-R[0-9]+- ]] && continue
    [[ "$candidate" =~ ^R[0-9]+-fix ]] && continue
    echo "$candidate"
    return
  done < <(echo "$rest" | grep -oE '[A-Za-z][A-Za-z0-9]+(-[A-Za-z0-9]+){2,}' || true)

  # (b) "X discipline / umbrella / class / check / pattern" (X is 1-3 words)
  local discipline_term
  discipline_term=$(echo "$rest" | grep -oiE '[A-Za-z][A-Za-z0-9-]+([[:space:]]+[A-Za-z][A-Za-z0-9-]+){0,2}[[:space:]]+(discipline|umbrella|class|check|pattern|cross-check)' | head -1 || true)
  if [[ -n "$discipline_term" ]]; then
    echo "$discipline_term" | sed -E 's/[[:space:]]+(discipline|umbrella|class|check|pattern|cross-check)$//I'
    return
  fi

  # (c) Skip common sentence-starters; pick first noun-like keyword (3+ chars,
  # not a stopword). Treat hyphenated bigrams (e.g., "self-flag") as one token.
  local stopwords='^(When|If|In|The|Every|For|A|An|After|Before|Once|While|During|This|That|These|Those|Each|Any|All|Use|Apply|Add|Run|Set|Make|Check|Verify|Ensure|Do|Avoid|Stop|Start|To|At|Of|On|Is|Are|Was|Were|Has|Have|Had|Be|Been|Being|Must|Should|Will|May|Can)$'
  local fallback
  fallback=$(echo "$rest" | tr -c '[:alnum:]-' '\n' | grep -E '^[A-Za-z][A-Za-z0-9-]{2,}$' | grep -vE "$stopwords" | head -1 || true)
  echo "${fallback:-uncategorized}"
}

# Normalize extracted themes to known canonical names. Many reinforcements are
# variants of the same underlying discipline (e.g., "prescription-to-AC" and
# "prescription-to-AC-coverage" describe the same theme). The class-umbrella
# convention in CLAUDE.md already establishes canonical names; this function
# maps known variants to those canonicals so the theme counter doesn't
# double-count semantically-identical reinforcements.
#
# Add new canonical mappings here as umbrellas are established in CLAUDE.md.
normalize_theme() {
  local theme="$1"
  local lower
  lower=$(echo "$theme" | tr '[:upper:]' '[:lower:]')

  case "$lower" in
    anti-self-confirming*|self-confirming-test*|self-confirming) echo "anti-self-confirming-test" ;;
    ac-literal*|literal-pass*) echo "AC-literal-pass" ;;
    prescription-to-ac*|prescription-coverage*|prescription-binding*) echo "prescription-to-AC-coverage" ;;
    halt|halt-discipline*|halt-trigger*|halt-class*|class-*-halt*|diagnostic-escalate*) echo "HALT-discipline" ;;
    manifest-and-inventory*|manifest-inventory*|§2.x*|file-system-locations*) echo "§2.x-manifest-and-inventory" ;;
    empirical-verification*|empirical-verify*) echo "empirical-verification" ;;
    tdd-ordering*|tdd|tdd-discipline*|tdd-attestation*) echo "TDD-ordering" ;;
    prd-narrowing*|prd-conjunction*|prd-wording*|prd-literal*) echo "PRD-conjunction-cross-check" ;;
    attestation-accuracy*|attesting) echo "attestation-accuracy" ;;
    role-stamp*|stamping) echo "role-stamping" ;;
    *) echo "$theme" ;;
  esac
}

# ── 1. SIZE ──────────────────────────────────────────────────────────────────

print_size_section() {
  echo "## 1. Size"
  echo ""

  local cur_bytes cur_lines cur_words
  cur_bytes=$(wc -c <"$CLAUDE_MD")
  cur_lines=$(wc -l <"$CLAUDE_MD")
  cur_words=$(wc -w <"$CLAUDE_MD")
  # Rough token estimate: 1 token ≈ 4 characters
  local cur_tokens=$((cur_bytes / 4))

  echo "- **Current:** ${cur_bytes} bytes, ${cur_lines} lines, ~${cur_tokens} tokens"
  echo ""

  echo "### Growth history (git log, last 20 commits touching CLAUDE.md):"
  echo ""
  echo "| Commit | Date | Bytes | Δ |"
  echo "|---|---|---|---|"

  local prev_size=0
  git -C "$PROJECT_ROOT" log --reverse --pretty=format:"%h|%ai" -- CLAUDE.md | tail -20 | while IFS='|' read -r sha date; do
    local size
    size=$(git -C "$PROJECT_ROOT" show "$sha:CLAUDE.md" 2>/dev/null | wc -c | tr -d ' ' || echo 0)
    local delta=""
    if [[ $prev_size -gt 0 ]]; then
      local d=$((size - prev_size))
      [[ $d -gt 0 ]] && delta="+$d" || delta="$d"
    fi
    echo "| $sha | $(echo "$date" | cut -c1-10) | $size | $delta |"
    prev_size=$size
  done

  echo ""
}

# ── 2. EXACT DUPLICATE LINES ─────────────────────────────────────────────────

print_duplicates_section() {
  echo "## 2. Exact duplicate lines"
  echo ""
  echo "Lines appearing 2+ times verbatim. Stamping duplicates (# THIS SESSION ROLE, # Round)"
  echo "are excluded since the stamping refactor moved them to .role-stamp."
  echo ""

  local dups
  dups=$(grep -v -E "^# (THIS SESSION ROLE|Round):" "$CLAUDE_MD" \
    | grep -v "^[[:space:]]*$" \
    | sort | uniq -c | awk '$1 >= 2 { print }' \
    | sort -rn | head -20 || true)

  if [[ -z "$dups" ]]; then
    echo "_None detected._"
  else
    echo '```'
    echo "$dups"
    echo '```'
  fi
  echo ""
}

# ── 3. REINFORCED THEMES (umbrella candidates) ───────────────────────────────

print_themes_section() {
  echo "## 3. REINFORCED themes (class-umbrella candidates)"
  echo ""
  echo "Themes with **5+ reinforcement lines** are strong candidates for a class umbrella"
  echo "consolidation (see existing umbrellas: HALT-discipline, AC-literal-pass,"
  echo "anti-self-confirming-test, §2.x manifest-and-inventory, empirical-verification)."
  echo ""

  local themes_file
  themes_file=$(mktemp)
  trap 'rm -f "$themes_file"' RETURN

  grep -nE "^# REINFORCED [0-9]" "$CLAUDE_MD" | while IFS=: read -r lineno line; do
    local theme
    theme=$(extract_theme "$line")
    theme=$(normalize_theme "$theme")
    echo "${theme}|${lineno}"
  done >"$themes_file"

  echo "| Count | Theme | Line numbers |"
  echo "|---|---|---|"

  cut -d'|' -f1 "$themes_file" | sort | uniq -c | sort -rn \
    | awk '$1 >= 3 { count=$1; $1=""; sub(/^ +/, ""); print count "|" $0 }' \
    | while IFS='|' read -r count theme; do
        local lines
        lines=$(grep "^${theme}|" "$themes_file" | cut -d'|' -f2 | tr '\n' ',' | sed 's/,$//')
        local marker=""
        [[ $count -ge 5 ]] && marker=" 🔥"
        echo "| ${count}${marker} | $theme | $lines |"
      done

  echo ""
  echo "🔥 = 5+ occurrences, prime umbrella-consolidation candidate"
  echo ""
}

# ── 4. DORMANT REINFORCEMENTS ────────────────────────────────────────────────

print_dormancy_section() {
  echo "## 4. Dormancy analysis"
  echo ""
  echo "A reinforcement is **dormant** if its theme keyword has 0 VIOLATION entries in"
  echo "the last ${DORMANCY_WINDOW} rounds of MEMORIAL.md. Dormant reinforcements are"
  echo "candidates for archive — but verify before removing (could be \"successfully"
  echo "internalized\" rather than truly stale)."
  echo ""

  if [[ ! -f "$MEMORIAL" ]]; then
    echo "_MEMORIAL.md not found; skipping dormancy analysis._"
    echo ""
    return
  fi

  # Extract round numbers seen in MEMORIAL VIOLATION entries
  local recent_rounds
  recent_rounds=$(grep -oE "VIOLATION:.*\| R[0-9]+ \|" "$MEMORIAL" 2>/dev/null \
    | grep -oE "R[0-9]+" | sort -u | sort -t R -k 2 -n | tail -"$DORMANCY_WINDOW" || true)

  if [[ -z "$recent_rounds" ]]; then
    echo "_No VIOLATION entries with round identifiers found in MEMORIAL.md._"
    echo ""
    return
  fi

  echo "Recent ${DORMANCY_WINDOW} rounds analyzed: $(echo "$recent_rounds" | tr '\n' ' ')"
  echo ""

  # Build a regex of recent rounds for grep
  local rounds_regex
  rounds_regex=$(echo "$recent_rounds" | tr '\n' '|' | sed 's/|$//')

  # Get VIOLATION entries from those recent rounds
  local recent_violations
  recent_violations=$(grep -E "VIOLATION:.*\| (${rounds_regex}) \|" "$MEMORIAL" 2>/dev/null || true)

  echo "| Status | Theme | Sample reinforcement line |"
  echo "|---|---|---|"

  grep -nE "^# REINFORCED [0-9]" "$CLAUDE_MD" | while IFS=: read -r lineno line; do
    local theme theme_lower
    theme=$(extract_theme "$line")
    theme=$(normalize_theme "$theme")
    theme_lower=$(echo "$theme" | tr '[:upper:]' '[:lower:]')

    # Search recent VIOLATIONs for this theme (case-insensitive substring).
    # grep -c always emits a count; with || true we suppress non-match exit code
    # without spawning an extra echo (the old `|| echo 0` produced "0\n0" on
    # no-match, triggering an arithmetic error downstream).
    local hits=0
    if [[ -n "$recent_violations" && -n "$theme_lower" && "$theme_lower" != "uncategorized" ]]; then
      hits=$(echo "$recent_violations" | grep -ic "$theme_lower" || true)
    fi

    local status
    if [[ ${hits:-0} -ge 1 ]]; then
      status="✅ ACTIVE ($hits)"
    else
      status="⚠️  DORMANT"
    fi

    # Snippet of the line (first 80 chars after date)
    local snippet
    snippet=$(echo "$line" | sed -E 's/^# REINFORCED [0-9-]+ — //' | cut -c1-80)
    echo "| $status | $theme | L${lineno}: ${snippet}… |"
  done | sort | awk '!seen[substr($0, 1, 40)]++' | head -40
  # uniq -w is GNU-only; awk-by-prefix is portable across BSD/macOS + Linux

  echo ""
}

# ── 5. RECOMMENDATIONS ───────────────────────────────────────────────────────

print_recommendations() {
  echo "## 5. Recommendations"
  echo ""

  local cur_bytes total_reinforced
  cur_bytes=$(wc -c <"$CLAUDE_MD")
  total_reinforced=$(grep -cE "^# REINFORCED [0-9]" "$CLAUDE_MD" || echo 0)

  echo "- CLAUDE.md is **${cur_bytes} bytes** with **${total_reinforced} REINFORCED lines**."

  if [[ $cur_bytes -gt 80000 ]]; then
    echo "- ⚠️  Size exceeds 80 KB. Each role-session pays the cache-creation cost for this"
    echo "  on every fresh invocation (~\$0.05 per 10k bytes of context with Opus)."
  fi

  echo ""
  echo "Suggested operator actions (in priority order):"
  echo ""
  echo "1. **Review 🔥 themes in §3** — any with 5+ entries should be consolidated into"
  echo "   a single class umbrella with variant detail moved to coordination/REINFORCEMENT-ARCHIVE.md."
  echo ""
  echo "2. **Review DORMANT themes in §4** — verify each is truly stale (no recent violations"
  echo "   AND the underlying issue is gone) before archiving. Some dormant themes are"
  echo "   \"successfully internalized\" and removing them risks regression."
  echo ""
  echo "3. **Action exact duplicates in §2** — these are pure waste; remove the duplicates."
  echo ""
  echo "Run this analyzer after each Memorial-Updater to track trends. Consider"
  echo "scheduling a CLAUDE.md prune review at wave-gate boundaries (every 4-5 rounds)."
  echo ""
}

# ── main ─────────────────────────────────────────────────────────────────────

echo "# CLAUDE.md Analysis Report"
echo ""
echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')"
echo "**Project root:** $PROJECT_ROOT"
echo ""
echo "---"
echo ""

print_size_section
print_duplicates_section
print_themes_section
print_dormancy_section
print_recommendations
