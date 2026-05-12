#!/bin/bash
# =============================================================================
# new-project.sh — scaffold a new Anchor + Superpowers project
# Usage: ./new-project.sh <project-name>
# =============================================================================

set -euo pipefail

PROJECT_NAME="${1:-}"
if [[ -z "$PROJECT_NAME" ]]; then
  echo "Usage: $0 <project-name>"
  exit 1
fi

TOOLKIT_DIR="$(cd "$(dirname "$0")" && pwd)"
CROSS_MEMORIAL="$HOME/.claude/CROSS-PROJECT-MEMORIAL.md"

echo ""
echo "Scaffolding: $PROJECT_NAME"

mkdir -p "$PROJECT_NAME"
cd "$PROJECT_NAME"

git init -q

mkdir -p coordination/specs
mkdir -p coordination/reviews
mkdir -p coordination/diagnostics
mkdir -p coordination/logs
mkdir -p src
mkdir -p tests

# ── CLAUDE.md ─────────────────────────────────────────────────────────────────
cp "$TOOLKIT_DIR/CLAUDE.md.template" CLAUDE.md
sed -i.bak "s/\[PROJECT NAME — replace this line\]/$PROJECT_NAME/" CLAUDE.md
rm -f CLAUDE.md.bak

# Inject cross-project reinforcement rules if the memorial exists
if [[ -f "$CROSS_MEMORIAL" ]]; then
  REINFORCEMENTS=$(awk \
    '/^### Reinforcement rules derived/{f=1;next} f && /^###/{f=0} f && /^- /{print}' \
    "$CROSS_MEMORIAL" || true)
  if [[ -n "$REINFORCEMENTS" ]]; then
    {
      echo ""
      echo "# ── Inherited from cross-project memorial ($(date '+%Y-%m-%d')) ────────────────"
      echo "$REINFORCEMENTS"
    } >> CLAUDE.md
    COUNT=$(echo "$REINFORCEMENTS" | wc -l | tr -d ' ')
    echo "  Injected $COUNT reinforcement rule(s) from cross-project memorial."
  fi
fi

# ── NEXT-ROLE.md ──────────────────────────────────────────────────────────────
cat > coordination/NEXT-ROLE.md << EOF
CURRENT-ROUND: R01
NEXT-ROLE: ARCHITECT
STATUS: READY

## Inputs for next role
- coordination/PRD.md

## Escalation items
(none)

## Routing notes
(none)
EOF

# ── MEMORIAL.md ───────────────────────────────────────────────────────────────
cat > coordination/MEMORIAL.md << EOF
# Memorial — $PROJECT_NAME
# Cross-project record: ~/.claude/CROSS-PROJECT-MEMORIAL.md
# Written by Memorial Updater after each round.

## Round R01
(populated after round completes)
EOF

# ── PRD.md ────────────────────────────────────────────────────────────────────
cat > coordination/PRD.md << 'EOF'
# Product Requirements Document
# This is your primary input. The pipeline does not run until this is complete.
# Quality here determines quality everywhere downstream.

## Project goal
[One paragraph: what is this, why does it exist, what does success look like]

## Users / personas
[Who uses this and in what context. Be specific — "developers" is not a persona.]

## User stories
<!-- Format: As a [specific persona], I want to [action] so that [outcome] -->
- US-01: As a ..., I want to ... so that ...

## Functional requirements
<!-- Each FR must trace to a user story. -->
| ID    | Requirement                  | Traces to |
|-------|------------------------------|-----------|
| FR-01 |                              | US-01     |

## Acceptance criteria
<!-- Each AC must be testable: "Given X, when Y, then Z"
     Words like "correctly", "appropriately", "as needed" are banned — they
     defer the decision to the Architect, which produces ambiguous specs.
     Each AC traces to an FR. -->
| ID    | Given / When / Then                      | Traces to |
|-------|------------------------------------------|-----------|
| AC-01 | Given [state], when [action], then [result] | FR-01  |

## Non-functional requirements
| Area        | Requirement (specific and testable)  |
|-------------|--------------------------------------|
| Performance |                                      |
| Security    |                                      |
| Reliability |                                      |

## Anti-scope
<!-- What is explicitly NOT included in this build.
     Being explicit here prevents scope creep in the Architect's spec. -->
- ...

## Success metrics
- ...

## Open questions
<!-- Unresolved items that may require a decision before the Architect can spec.
     These will surface as ESCALATE conditions if not resolved first. -->
- ...

## Update history
| Date | Change |
|------|--------|
|      |        |
EOF

# ── Pipeline script ───────────────────────────────────────────────────────────
cp "$TOOLKIT_DIR/run-pipeline.sh" run-pipeline.sh
chmod +x run-pipeline.sh

# ── Round-close helpers ───────────────────────────────────────────────────────
if [[ -d "$TOOLKIT_DIR/scripts" ]]; then
  cp -r "$TOOLKIT_DIR/scripts" .
  chmod +x scripts/*.sh
fi

# ── .gitignore ────────────────────────────────────────────────────────────────
cat > .gitignore << 'EOF'
coordination/.prompt-*.md
node_modules/
.env
*.bak
EOF

# ── Initial commit ────────────────────────────────────────────────────────────
git add -A
git commit -q -m "chore: scaffold $PROJECT_NAME (Anchor + Superpowers pipeline v2)"

echo ""
echo "✅ $PROJECT_NAME/ created."
echo ""
echo "Steps:"
echo ""
echo "  1. Write your requirements:"
echo "     $PROJECT_NAME/coordination/PRD.md"
echo ""
echo "     PRD quality checklist before running:"
echo "     □ Every user story has at least one AC"
echo "     □ Every AC uses Given/When/Then — no ambiguous language"
echo "     □ Anti-scope section is explicit"
echo "     □ No open questions that force the Architect to guess"
echo ""
echo "  2. Run the pipeline:"
echo "     cd $PROJECT_NAME && ./run-pipeline.sh --round R01"
echo ""
echo "  3. Watch it (optional, separate terminal):"
echo "     tail -f $PROJECT_NAME/coordination/logs/pipeline-R01.log"
echo ""
echo "  4. If it stops on escalation (exit code 2):"
echo "     Read: $PROJECT_NAME/coordination/NEXT-ROLE.md"
echo "     Resolve, set STATUS: READY, then resume with --start-at"
echo ""
