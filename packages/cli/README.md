# @anchor/cli

The operator surface — runs Anchor's disciplined role cycle on a commodity runtime, ties together `@anchor/core` (engine + routing + gates + memorial) and `@anchor/runtime-agent-sdk` (the real adapter).

```bash
# dry-run the routing: what tier + per-role models would this round get?
anchor route --task "Modify engine/detectors/fcp.ts (architectural-decision)"
#   tier: full  (0.85 — architectural-decision/reality)
#   model overrides: implementer -> claude-opus-4-8 ; memorial -> claude-haiku-4-5-20251001

# run a round offline (no model/tokens) — self-routes tier+models from the task
anchor run --mock --task "mechanical typo fix in README"     # -> implementer-only, Haiku

# run a round for real (needs a real key; `npm install` at the repo root brings the SDK)
npm install && export ANTHROPIC_API_KEY=sk-ant-...
anchor run --tier audit --task "Implement compareSemver" --cwd ./work --memorial ~/.anchor/memorial.json

# memorial management
anchor memorial list
anchor memorial ratios            # ✓/✗ per entry (V/C health)
anchor memorial prune             # stabilize/retire well-internalized entries
```

## Commands

| Command | What it does |
|---|---|
| `anchor run` | Run a round. `--directive <file>` or `--task "<text>"` (self-routes tier+models if no `--tier`); `--tier`, `--cwd`, `--round`, `--memorial <path>`, `--mock`, `--strict`, `--no-gates`. |
| `anchor route` | Dry-run: print the classified tier (+ confidence/matched rule) and per-role model overrides. Offline. |
| `anchor memorial <list\|ratios\|prune>` | Inspect/maintain the memorial store (`--memorial <path>`, default in-memory). |

**Discipline gates:** the structural gates (pre-emit grilling + anti-scope) are **ON by default as advisory warnings** — a non-compliant Architect spec is surfaced in the run report but does not halt the run (they're heuristic checks). `--strict` promotes them to blocking (`BLOCKED`); `--no-gates` disables them. The fully-mechanical gates (citation, anti-self-confirming) need config and are wired in programmatically, not via the CLI.

`--mock` runs the full pipeline offline with a deterministic adapter (no model, no tokens) — useful to see routing + the role cycle without spending. Real runs require a real `ANTHROPIC_API_KEY` (the `@anthropic-ai/claude-agent-sdk` ships via `npm install`); `anchor run` preflights the key and fails with guidance if missing.

The command handlers are dependency-injected (adapter, persistence, clock, stdout) and unit-tested offline (8 tests); the wired stack is validated end-to-end via `--mock`.
