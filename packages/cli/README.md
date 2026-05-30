# @anchor/cli

The operator surface — runs Anchor's disciplined role cycle on a commodity runtime, ties together `@anchor/core` (engine + routing + gates + memorial) and `@anchor/runtime-agent-sdk` (the real adapter).

```bash
# start from an empty directory — scaffold a greenfield project the gate can run from round 1
anchor init my-project && cd my-project
#   writes package.json (test -> `node --test`), a PASSING smoke test (so `npm test` is green
#   before any code exists), coordination/PRD.md, .gitignore, src/, README; runs `git init`.
$EDITOR coordination/PRD.md                                   # the one artifact you write by hand
anchor run --directive coordination/PRD.md                    # first round reads the PRD as its directive

# dry-run the routing: what tier + per-role models would this round get?
anchor route --task "Modify engine/detectors/fcp.ts (architectural-decision)"
#   tier: full  (0.85 — architectural-decision/reality)
#   model overrides: implementer -> claude-opus-4-8 ; memorial -> claude-haiku-4-5-20251001

# run a round offline (no model/tokens) — self-routes tier+models from the task
anchor run --mock --task "mechanical typo fix in README"     # -> implementer-only, Haiku

# run a round for real (needs a real key; `pnpm install` at the repo root brings the SDK).
# No --tier needed: scope decides the role set; the green-test gate + remediation loop
# enforce a passing suite (implementer re-runs on red until green).
pnpm install && export ANTHROPIC_API_KEY=sk-ant-...
anchor run --task "add a pure formatDuration helper; additive" --cwd ./work --memorial ~/.anchor/memorial.json

# fan out independent features in parallel (one worktree per item; each routed on its own)
anchor wave --plan plan.json --repo ./work --memorial ~/.anchor/memorial.json

# model drift: is a new model out that the routing labels haven't been grounded against?
anchor calibrate

# memorial management
anchor memorial list
anchor memorial ratios            # ✓/✗ per entry (V/C health)
anchor memorial prune             # stabilize/retire well-internalized entries
```

## Commands

| Command | What it does |
|---|---|
| `anchor init` | Scaffold an empty/partial dir into a greenfield project the green-test gate can run from round 1 — `package.json` (`test` → `node --test`), a **passing smoke test** (so `npm test` is green before any code exists), `coordination/PRD.md`, `.gitignore`, `src/`, `README`. Optional `[<dir>]` positional; `--no-git`, `--force`. Idempotent — never clobbers an existing file without `--force`. |
| `anchor run` | Run a round. `--directive <file>` or `--task "<text>"` (self-routes tier+models if no `--tier`); `--tier`, `--cwd`, `--round`, `--spec <path>`, `--memorial <path>`, `--mock`, `--strict`, `--no-gates`. Gate/loop flags: `--max-fix <n>` (remediation attempts, default 2), `--no-test-gate`, `--test-cmd "<cmd>"`, `--no-risk-adapt`, `--no-model-check`. `--resume` continues a paused round. |
| `anchor wave` | Fan out independent items in parallel — `--plan <file>` (JSON: `{ items: [{ id, task\|directive\|directiveFile, tier?, cwd? }] }`), `--repo <dir>` (auto-creates a worktree+branch per item), `--concurrency <n>`, `--memorial <path>`. Each item self-routes; the green-test gate runs per item's worktree. |
| `anchor route` | Dry-run: print the classified tier (+ confidence/matched rule) and per-role model overrides. Offline. |
| `anchor calibrate` | Report **model drift** — the API's current models vs the set the routing labels were grounded under — and how to re-ground. Read-only (no tokens, no oracle grid). |
| `anchor memorial <list\|ratios\|prune\|add>` | Inspect/maintain the memorial store (`--memorial <path>`). `add --id <id> --rule "<rule>" [--trigger] [--origin]` authors an entry. |

**Scope decides the cycle:** with `--directive`/`--task` and no `--tier`, the tier-router picks the role set (mechanical → `implementer-only`; self-contained additive → `audit`; complex/risky → `full`) and per-role model routing picks opus/sonnet/haiku by change-risk.

**Green-test gate + remediation:** the engine runs the test suite after the implementer and **blocks the round on red** (no COMPLETE over failing tests); on red it re-runs the implementer with the failures as feedback until green, up to `--max-fix` times. `--no-test-gate` skips it; `--test-cmd` points it at a faster/incremental command. Verification lives in the engine, not the agent — no role runs tests or escalates to ask the operator to.

**The learning loop:** pass `--memorial <path>` and the gates accrue **V/C** against the built-in disciplines (`pre-emit-grilling`, `anti-scope`, `tests-pass`, auto-seeded). The memorial's active rules are injected into role prompts on the next run. Inspect with `anchor memorial ratios`.

**Structural gates** (pre-emit grilling + anti-scope) are **advisory by default** (`--strict` to block, `--no-gates` to disable). **Adaptive structure:** a high-risk directive earns a second cold-eye reviewer (`--no-risk-adapt` to disable). **Model drift:** `run`/`wave` check the API's models on startup and route conservatively (full tier + opus) on an ungrounded model until you re-ground (`--no-model-check` to skip).

`--mock` runs the full pipeline offline (no model, no tokens). Real runs use a real `ANTHROPIC_API_KEY` *or* Claude Code's existing subscription auth.

The command handlers are dependency-injected (adapter, persistence, clock, stdout, model-list) and unit-tested offline (32 tests, incl. a greenfield smoke that asserts `npm test` is green in a freshly `init`-ed dir); the wired stack is validated end-to-end via `--mock`.
