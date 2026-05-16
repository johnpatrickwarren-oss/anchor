# Anchor + Superpowers + Claude Code Integration

A complete, tested implementation of Anchor's automated pipeline mode using
[Superpowers](https://github.com/obra/superpowers) as the development methodology
layer and [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) as
the agent runtime.

**Origin:** Developed and validated while building a production quoting and contract
management application. This integration represents the evolution of the manual
coordination pattern (see `case-studies/deploysignal/`) into a fully autonomous
pipeline where the human operator writes requirements and handles escalations,
while agents execute all four roles.

---

## What this adds to Anchor

Anchor defines the disciplines (what to do and when). Superpowers defines the
development phases (how to approach building). This integration provides the
runtime that connects them: a shell script that orchestrates headless Claude Code
sessions in sequence, passing role identity and context via files rather than
human copy-paste.

The result is a pipeline that runs for hours unattended, stops only when a
genuine decision is required, and improves itself across rounds and projects via
the cross-project memorial.

---

## Design decisions

### Why headless Claude Code sessions, not a persistent agent loop

Each role in Anchor benefits from a clean context window. The Reviewer catching
what the Implementer missed works because the Reviewer encounters the implementation
cold — it hasn't seen the Implementer's reasoning, workarounds, or defensive
justifications. A persistent agent loop accumulates context across roles, which
degrades the adversarial independence that makes multi-role review valuable.

Separate Claude Code sessions, each opened with role-appropriate inputs only,
preserve the context isolation that Anchor's role separation was designed to provide.

### Why NEXT-ROLE.md replaces the human TPM for routing

In the original pattern, the human TPM read every artifact, applied the pre-route
checklist, and wrote routing pasteables to pass downstream. This provides maximum
visibility but limits throughput to the human's availability.

`NEXT-ROLE.md` encodes the same routing state as a file. Each role writes its
completion status and the inputs for the next role. The pipeline script reads this
file and opens the next session accordingly. The human TPM is replaced for
mechanical routing decisions; they remain present for escalations, which require
judgment rather than verification.

### Why Superpowers disciplines are inlined in CLAUDE.md

Superpowers' MCP plugin provides `/brainstorm`, `/execute-plan`, and related
slash commands in interactive Claude Code sessions. In headless sessions (the `-p`
flag used by the pipeline), MCP tools may not load.

Rather than depending on MCP availability in headless mode, the four Superpowers
discipline phases (brainstorm → design → execute → review) are inlined directly
into `CLAUDE.md` as explicit prose instructions. In interactive sessions,
Superpowers' MCP augments these with structured skill invocation. In headless
sessions, the inlined disciplines fire from the system prompt directly. The two
compose without conflict.

### Why Opus 4.7 for Architect and Reviewer, Sonnet for Implementer and Memorial

The Architect's value is in design reasoning — making the right architectural
choices and producing a spec precise enough that the Implementer makes zero design
decisions. The Reviewer's value is in adversarial audit — finding what the
Implementer got wrong. Both tasks benefit from Opus 4.7's extended reasoning depth
and file-system memory across long sessions.

The Implementer executes against a precise spec — a task where Sonnet 4.6 performs
comparably at roughly 40% lower cost. The Memorial Updater synthesizes coordination
files into structured records — file I/O and pattern matching, not frontier reasoning.

This routing captures most of Opus 4.7's quality gains where they matter most
while reducing total pipeline cost significantly.

---

## Repository structure

```
integrations/superpowers-claude-code/
├── README.md                    # This file
├── MULTI-TRACK-RUNBOOK.md       # Operator runbook for multi-cluster parallel waves
├── run-pipeline.sh              # Pipeline orchestrator (single-track / per-cluster)
├── new-project.sh               # Project scaffolding script
├── CLAUDE.md.template           # Role definitions and inlined Superpowers disciplines
├── finalize-round.sh            # One-command round-close (SHA-A attestation)
├── anchor-update-project.sh     # Sync project's run-pipeline.sh from canonical
└── scripts/
    ├── anchor-round-close.sh               # Commit a round's Memorial-Updater outputs (single-track + multi-track manual fallback)
    ├── anchor-wave-init.sh                 # Bring an existing project to multi-track readiness (idempotent)
    ├── multi-track-cluster-setup.sh        # Create a worktree for one cluster in a wave
    └── multi-track-verify-wave-merge.sh    # Post-merge correctness check after wave aggregation
```

**Multi-track mode (parallel clusters):** see [`MULTI-TRACK-RUNBOOK.md`](./MULTI-TRACK-RUNBOOK.md)
for the operator step-by-step. Multi-track is an MVP — the underlying
methodology disciplines live in [`skills/12-coordinator-role.md`](../../skills/12-coordinator-role.md),
but execution is operator-orchestrated rather than fully automated.
Stay single-track unless a wave plan has ≥3 truly-parallel clusters.

`finalize-round.sh` mechanically realizes the IMPLEMENTER's "On clean
completion" sequence from `CLAUDE.md.template`: runs the binding commands,
commits coordination artifacts as SHA-A, records that SHA in `NEXT-ROLE.md`,
commits the recording as HEAD, and verifies the source domain hasn't changed
between SHA-A and HEAD. Defaults to a Node.js test stack (npm typecheck /
lint / test / test:integration / test:e2e against `src/ tests/ prisma/`);
override via `ANCHOR_BINDING_COMMANDS` and `ANCHOR_SOURCE_DIRS` env vars for
other stacks. Copy into your project's `scripts/` directory and invoke from
the Implementer session (any tier) or from a fix-cycle commit chain.

When a project is scaffolded with `new-project.sh`, it produces:

```
my-project/
├── CLAUDE.md                    # Stamped with role + round by pipeline
├── run-pipeline.sh              # Copied from integration
├── coordination/
│   ├── PRD.md                   # Human-authored requirements (your input)
│   ├── NEXT-ROLE.md             # Routing state machine
│   ├── MEMORIAL.md              # Per-project discipline record
│   ├── specs/                   # Q-RNN-SPEC.md per round
│   ├── reviews/                 # REVIEWER-REPORT-RNN.md per round
│   ├── diagnostics/             # DIAGNOSTIC-RNN-[topic].md on halts
│   └── logs/                    # Session logs and round summaries
├── src/
└── tests/
```

The cross-project memorial lives outside any project at `~/.claude/CROSS-PROJECT-MEMORIAL.md`.
Every Memorial Updater session appends to it. Every new project inherits its reinforcement rules.

---

## Prerequisites

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code
claude login

# Superpowers (run inside Claude Code as a slash command, NOT a shell command):
#   /plugin install superpowers@claude-plugins-official

# Anchor skills (from this repo)
cp skills/*.md ~/.claude/skills/

# GitHub CLI (optional — for automatic private repo creation)
brew install gh && gh auth login
```

---

## Quickstart

```bash
# One-time: put the integration scripts somewhere permanent
mkdir -p ~/anchor-pipeline
cp integrations/superpowers-claude-code/* ~/anchor-pipeline/
chmod +x ~/anchor-pipeline/*.sh
echo 'export PATH="$HOME/anchor-pipeline:$PATH"' >> ~/.zshrc && source ~/.zshrc

# Per project
new-project.sh my-project-name   # scaffolds structure + creates private GitHub repo
cd my-project-name
open coordination/PRD.md          # write your requirements

# Run
./run-pipeline.sh --round R01                     # default: full (4 roles)
./run-pipeline.sh --round R01 --tier audit        # Implementer writes own spec, Reviewer audits
./run-pipeline.sh --round R01 --tier solo         # Implementer only — mechanical rounds
./run-pipeline.sh --round R01 --dry-run           # preview without executing
./run-pipeline.sh --round R01 --auto-push         # push to GitHub on completion
./run-pipeline.sh --round R01 --no-model-routing  # use one model for all roles
```

### Tier selection

The pipeline scales the role count to match the round's complexity. See
[`skills/11-round-scaling.md`](../../skills/11-round-scaling.md) in canonical
anchor for the full rubric (A1–A7 / S1–S5 / Z1–Z5 criteria, decision tree,
worked examples).

| Tier  | Roles                                                    | Use when |
|-------|----------------------------------------------------------|----------|
| **`full`** (default) | Architect → Implementer → Reviewer → Memorial | Novel territory, high-risk work, anything where the audit trail matters or the Architect's spec discipline is load-bearing. |
| **`audit`**          | Implementer (writes thin spec inline) → Reviewer → Memorial | Small features, well-understood territory, refactors. The Implementer applies brainstorm + design phases inline, writes a 1-2 page spec, then executes. Trades the cold-eye Architect for ~half the wall-clock and token cost. |
| **`solo`**           | Implementer only (spec, execute, memorial inline)            | Mechanical / doc-only / test-only / cosmetic rounds where visual diff inspection substitutes for cold-eye review. Cheapest tier; no Reviewer safety net. |

In `audit` mode the Implementer is the spec author. The cold-eye Reviewer
still runs adversarially — the safety net is preserved. The MEMORIAL.md
reinforcement loop operates in all three tiers, so cross-round learning
compounds regardless of tier.

Pick `full` by default for unfamiliar territory; drop to `audit` when a
round is clearly mechanical wiring or routine extension; drop to `solo`
for pure-mechanical rounds matching the Z criteria. The choice is per-round
— nothing stops you from running R05 as `audit` and R06 as `full` if scope
shifts.

**Backward compatibility:** `--tier T0` / `--tier T1` / `--tier T3` still
work as aliases for `solo` / `audit` / `full` respectively, but emit a
deprecation warning. The verbal names avoid a naming collision with
Anchor's four-anchor pre-merge defense (which uses T0/T1/T2/T3 for the
temporally-ordered discipline checkpoints).

---

## Pipeline flow

```
PRD.md  (you write this)
  ↓
ARCHITECT session  [Opus 4.7]
  Reads: PRD + cross-project memorial reinforcements
  Produces: coordination/specs/Q-RNN-SPEC.md
  Writes: NEXT-ROLE.md → IMPLEMENTER / READY
  ↓
IMPLEMENTER session  [Sonnet 4.6]
  Reads: spec only (cold start — no Architect reasoning)
  Produces: src/ + tests/
  On halt: writes DIAGNOSTIC + sets NEXT-ROLE.md → ESCALATE
  ↓
REVIEWER session  [Opus 4.7]
  Reads: PRD + spec + code (cold — no Implementer reasoning)
  Produces: coordination/reviews/REVIEWER-REPORT-RNN.md
  CRITICAL findings → ESCALATE
  No CRITICAL → MERGE-READY
  ↓
MEMORIAL UPDATER session  [Sonnet 4.6]
  Reads: all round artifacts
  Updates: MEMORIAL.md + ~/.claude/CROSS-PROJECT-MEMORIAL.md
  Reinforces: CLAUDE.md with lessons from violations
  Produces: coordination/logs/ROUND-RNN-SUMMARY.md
```

The pipeline stops and exits with code 2 when any role sets `STATUS: ESCALATE`.
It prints the escalation items directly to the terminal and waits. After you resolve:

```bash
# Edit coordination/NEXT-ROLE.md — set STATUS: READY
./run-pipeline.sh --round R01 --start-at IMPLEMENTER
```

---

## Anchor disciplines in this integration

| Anchor discipline | How it's implemented |
|---|---|
| Pre-emit grilling (T0, T3) | Explicit grilling checklist in Architect and Reviewer role prompts; output written inline in artifact before routing |
| TPM routing-emit (T1) | NEXT-ROLE.md state machine; Architect grilling includes canonical-version verification |
| Halt discipline (T2) | Implementer CLAUDE.md block with explicit halt conditions; DIAGNOSTIC file written + ESCALATE set |
| Audit-state currency (T3) | Reviewer prompt requires confirmation it is reviewing the artifact that would actually merge |
| Memorial accretion | Memorial Updater writes per-round entries; cross-project memorial accumulates across portfolio |
| Role anchoring | CLAUDE.md stamped with role by pipeline script before each session; anti-drift rule in all role blocks |
| Context isolation | Each role prompt specifies what to read AND what not to read; Reviewer explicitly excluded from Implementer reasoning |
| Anti-scope | Architect spec template requires explicit anti-scope section; Reviewer cross-cutting check verifies nothing shipped outside scope |
| Round numbering | RNN prefix on all coordination files; letter suffixes available for sub-rounds |

---

## Relationship to manual coordination (Mode 1)

This integration is Mode 2 (automated) as described in the main README. The
coordination file structure is identical to Mode 1 — switching between modes
mid-project requires no migration. A common pattern is to run R01 in Mode 1 to
validate the spec and understand the problem space, then switch to Mode 2 for
subsequent execution rounds.

The key difference is not what gets produced but who routes between production.
In Mode 1, a human reads every artifact. In Mode 2, NEXT-ROLE.md carries the
routing state and the human reads escalations only.

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Round complete (MERGE-READY or ROUND-COMPLETE) |
| 1 | Error — check `coordination/logs/` |
| 2 | Escalation — human decision needed, see `coordination/NEXT-ROLE.md` |
