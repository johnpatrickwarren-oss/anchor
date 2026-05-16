#!/bin/bash
# =============================================================================
# verify-citations — verify "Existing architectural surface" citations in a spec
#
# Walks the citation table from a spec's `## Existing architectural surface
# (REVIEWER-ANCHOR)` section. For each row, resolves the cited file at the
# cited SHA, extracts the cited line range, and prints actual content side-
# by-side with the spec's snippet column so the architect (at pre-emit time)
# or the Reviewer (at audit time) can verify the snippet is verbatim from
# the file — not paraphrased or recalled from memory.
#
# This is the mechanical-enforcement complement to the mandatory template
# section. Memorializing the file-opened discipline ("open every cited file
# at brief-drafting time") didn't prevent recurrence in the originating case
# (two MD-F6 violations within hours of memorialization). A discipline
# statement is declarative — an architect can mentally tick it. A script
# that fails on mismatch is executable.
#
# Usage:
#   verify-citations.sh <spec.md> [--repo-root <path>] [--strict]
#
# Options:
#   --repo-root <path>    Repo to resolve cited files against. Defaults to
#                         $ANCHOR_INHERITED_REPO_ROOT, or `../deploysignal`
#                         (matches typical sibling-clone layout).
#   --strict              Exit non-zero on any mismatch / unresolved citation.
#                         Default is informational (exits 0 even on mismatch;
#                         emits warnings on stderr).
#
# Citation table format expected in the spec:
#   ## Existing architectural surface (REVIEWER-ANCHOR — mandatory)
#   ...
#   | Inherited file | Pinned SHA | Lines opened | Verbatim snippet | Date+time opened |
#   |---|---|---|---|---|
#   | path/to/file.ts | abc1234 | 403, 421 | <quoted from file> | 2026-05-16 14:23 |
#   ...
#
# Verifications per row:
#   1. File exists in <repo-root> at the pinned SHA.
#   2. Line ranges/numbers parse and resolve (single lines, "N-M" ranges,
#      or comma-separated lists like "403, 421").
#   3. Prints actual content at the cited lines so the architect/Reviewer
#      can compare against the snippet column.
#
# Snippet column is NOT parsed and exact-matched (markdown table cells
# with multi-line snippets are fragile to parse). Architect runs the
# script, eyeballs the output against the spec, and either re-emits with
# corrections or proceeds.
#
# Requires: git, awk, sed.
#
# Exit codes:
#   0  All citations resolved (or non-strict mode with warnings emitted).
#   1  Strict mode with at least one unresolved citation OR usage error.
# =============================================================================

set -euo pipefail

spec_file=""
repo_root="${ANCHOR_INHERITED_REPO_ROOT:-../deploysignal}"
strict=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      repo_root="$2"
      shift 2
      ;;
    --strict)
      strict=1
      shift
      ;;
    -h|--help)
      sed -n '/^# ====/,/^# ====/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$spec_file" ]]; then
        spec_file="$1"
      else
        echo "ERROR: unexpected argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$spec_file" ]]; then
  echo "Usage: verify-citations.sh <spec.md> [--repo-root <path>] [--strict]" >&2
  exit 1
fi

if [[ ! -f "$spec_file" ]]; then
  echo "ERROR: spec file not found: $spec_file" >&2
  exit 1
fi

if [[ ! -d "$repo_root/.git" ]] && [[ ! -f "$repo_root/.git" ]]; then
  echo "ERROR: repo-root is not a git repo: $repo_root" >&2
  echo "       (override via --repo-root or ANCHOR_INHERITED_REPO_ROOT env var)" >&2
  exit 1
fi

# Extract the citation table rows. We look for the section header, then
# capture each pipe-delimited row that has the expected 5 columns and
# doesn't look like the header/separator.
#
# Tolerates extra whitespace; rejects rows where any of the first three
# columns (file, SHA, lines) is empty or "TBD"/"<...>".

section_pattern="## Existing architectural surface"

if ! grep -q "$section_pattern" "$spec_file"; then
  echo "ERROR: spec does not contain the mandatory section:" >&2
  echo "       '$section_pattern (REVIEWER-ANCHOR)'" >&2
  echo "" >&2
  echo "       Add the section per anchor templates/Q-NN-SPEC-TEMPLATE.md." >&2
  exit 1
fi

# Extract lines after the section header until the next ## header.
section_body="$(awk -v pat="$section_pattern" '
  $0 ~ pat { in_section = 1; next }
  in_section && /^## / { exit }
  in_section { print }
' "$spec_file")"

# Parse pipe-delimited rows. Skip header rows, separator rows, and
# placeholder-only rows.
rows="$(echo "$section_body" | awk -F'|' '
  /^\|/ && NF >= 6 {
    file = $2; sha = $3; lines = $4; snippet = $5; ts = $6;
    # Strip leading/trailing whitespace.
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", file);
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", sha);
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", lines);
    # Strip markdown emphasis (backticks, asterisks, underscores at the
    # boundary). Tables commonly wrap inline values like `path/to/file`
    # or `abc1234` in backticks for rendering; we want the bare values.
    gsub(/`/, "", file);
    gsub(/`/, "", sha);
    gsub(/`/, "", lines);
    gsub(/\*\*/, "", file);
    gsub(/\*\*/, "", sha);
    gsub(/\*\*/, "", lines);
    # Re-trim after stripping (markdown could leave inner whitespace).
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", file);
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", sha);
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", lines);
    # Skip header row.
    if (file == "Inherited file") next;
    # Skip separator row.
    if (file ~ /^-+$/) next;
    # Skip placeholder rows.
    if (file == "" || file == "TBD" || file ~ /^</) next;
    if (sha == "" || sha == "TBD" || sha ~ /^</) next;
    if (lines == "" || lines == "TBD" || lines ~ /^</) next;
    print file "\t" sha "\t" lines;
  }
')"

# Detect repo-root basename for prefix-stripping. Common pattern:
# specs from project X cite project Y's files as "Y/path/to/file" for
# reader clarity, but git cat-file inside Y needs bare "path/to/file".
repo_basename="$(basename "$repo_root")"

if [[ -z "$rows" ]]; then
  echo "WARNING: section present but contains no resolvable citation rows." >&2
  echo "         Expected format:" >&2
  echo "         | Inherited file | Pinned SHA | Lines opened | Verbatim snippet | Date+time opened |" >&2
  if [[ "$strict" -eq 1 ]]; then exit 1; else exit 0; fi
fi

# For each row, resolve the file at the SHA and extract the cited line range.
row_count=0
fail_count=0

while IFS=$'\t' read -r file sha lines; do
  row_count=$((row_count + 1))

  # Strip repo-name prefix if present. Spec authors often write
  # "deploysignal/engine/foo.ts" for cross-repo clarity; git cat-file
  # inside the deploysignal repo needs "engine/foo.ts".
  in_repo_path="$file"
  if [[ "$in_repo_path" == "$repo_basename/"* ]]; then
    in_repo_path="${in_repo_path#$repo_basename/}"
  fi

  echo "═══════════════════════════════════════════════════════════════════"
  echo "Row $row_count: $file @ $sha (lines: $lines)"
  if [[ "$in_repo_path" != "$file" ]]; then
    echo "  (resolved to in-repo path: $in_repo_path)"
  fi
  echo "───────────────────────────────────────────────────────────────────"

  # Verify file exists at SHA.
  if ! git -C "$repo_root" cat-file -e "$sha:$in_repo_path" 2>/dev/null; then
    echo "  ❌ FAIL: $in_repo_path does not exist at SHA $sha in $repo_root" >&2
    fail_count=$((fail_count + 1))
    continue
  fi

  # Extract file content at SHA.
  file_content="$(git -C "$repo_root" show "$sha:$in_repo_path" 2>/dev/null || true)"
  if [[ -z "$file_content" ]]; then
    echo "  ❌ FAIL: could not read $in_repo_path at $sha" >&2
    fail_count=$((fail_count + 1))
    continue
  fi

  # Parse the lines spec — supports "N", "N-M", "N, M", "N-M, P-Q".
  # For each line/range, extract content.
  IFS=',' read -ra line_specs <<< "$lines"
  for spec in "${line_specs[@]}"; do
    spec="$(echo "$spec" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [[ "$spec" =~ ^([0-9]+)-([0-9]+)$ ]]; then
      start="${BASH_REMATCH[1]}"
      end="${BASH_REMATCH[2]}"
      echo "  Lines $start-$end:"
      echo "$file_content" | sed -n "${start},${end}p" | sed 's/^/    /'
    elif [[ "$spec" =~ ^([0-9]+)$ ]]; then
      n="${BASH_REMATCH[1]}"
      echo "  Line $n:"
      echo "$file_content" | sed -n "${n}p" | sed 's/^/    /'
    else
      echo "  ⚠ WARN: unparseable line spec: $spec (expected N or N-M)" >&2
    fi
  done
  echo ""
done <<< "$rows"

echo "═══════════════════════════════════════════════════════════════════"
echo "Verified $row_count citation row(s); $fail_count failure(s)."
echo ""
echo "ARCHITECT/REVIEWER: compare the printed content above against the"
echo "                    snippet column in your spec. Mismatches indicate"
echo "                    either (a) spec was drafted from memory rather"
echo "                    than from the file (MD-F6 violation), OR (b) the"
echo "                    cited SHA has moved and citations need re-pinning."

if [[ "$fail_count" -gt 0 ]] && [[ "$strict" -eq 1 ]]; then
  exit 1
fi
exit 0
