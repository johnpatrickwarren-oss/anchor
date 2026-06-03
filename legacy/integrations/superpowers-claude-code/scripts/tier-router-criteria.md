# Tier-routing criteria (R73)
<!-- CANONICAL: the rules below are implemented in @anchor/core/routing (classifyTier); scripts/tier-router.ts now delegates to it. Keep this doc in sync. -->

Quick-reference for the tier-router heuristic classifier. Same rules as the heuristic engine in `scripts/tier-router.ts`.

## Four tiers

| Tier | When | Cost multiplier |
|---|---|---|
| `full` | Architect + Implementer + Reviewer + Memorial-Updater | ~4× baseline |
| `audit` | Implementer + Reviewer + Memorial-Updater (no separate Architect) | ~3× baseline |
| `implementer-only` | Implementer only (solo; mechanical / doc-only / cosmetic) | ~1–2× baseline |
| `coordinator-only` | Coordinator wave planning, wave-gate close, CLUSTER-HANDOFF | ~1× baseline |

## Heuristic rule set (evaluated in priority order — first match wins)

### Rule 1 — coordinator-only (confidence 0.90)
Fires when directive content contains ANY of:
- `Coordinator wave plan` (verbatim)
- `WAVE-GATE-NN close` pattern
- `CLUSTER-HANDOFF`
- `operator-decision backlog`
- Directive heading starts with `(Coordinator —`
- `--coordinator` flag in pipeline-invocation block

### Rule 2 — full (confidence 0.85)
Fires when directive content contains ANY of:
- `ESCALATE` (all-caps word; matches STATUS: ESCALATE, ESCALATE #1, etc.)
- `HALT + DIAGNOSTIC` (halt-condition invocation pattern)
- `architectural-decision` or `architectural-reality`
- `R61-class` (architectural-reality discovery archetype)
- `validation-corpus failure`
- `engine/` path token (modifying engine internals = full)
- `--tier full` in pipeline-invocation block
- A-factor explicit names: `A1 (new dependency)`, `A2 (new architectural pattern)`, `A4 (novel data model)`

### Rule 3 — implementer-only (confidence 0.80)
Fires when directive content contains ALL of:
- ALLOWED_SET ≤ 3 paths
- None of those paths under `engine/`, `tools/`, `scripts/`, `test/`, `package.json`, `tsconfig*.json`, `run-pipeline.sh`
- Keyword: `mechanical`, `cosmetic`, `documentation-only`, `doc-only`, or `typo`
- No `ESCALATE`, `DIAGNOSTIC`, `engine/`, or `architectural-decision`

### Rule 4 — audit (confidence 0.75)
Fires when directive content contains ANY of:
- `methodology` keyword
- `REINFORCEMENT consolidation`, `MR-2 Pass`, or `re-accretion guard`
- `--tier audit` in pipeline-invocation block
- `audit-tier` in directive heading

### Rule 5 — default (confidence 0.50)
No rule 1–4 matched. In `--mode heuristic`: output `full` (uncertainty escape hatch). In `--mode hybrid`: invoke Haiku tiebreaker; fallback to `full` if Haiku unavailable or low-confidence.

## Usage

```bash
# Classify the current round's directive (hybrid mode — uses Haiku if ambiguous)
pnpm tier-router

# Classify a specific directive file in deterministic heuristic mode
node scripts/tier-router.js --directive coordination/NEXT-ROLE.md --mode heuristic

# Validate the full corpus (load-bearing safety check)
pnpm tier-router:validate

# Auto-tier integration in pipeline (reads NEXT-ROLE.md; sets tier; logs result)
./run-pipeline.sh --round R73 --auto-tier
```

## Safety corpus

Load-bearing safety rounds (MUST route `full`): R45, R61, R62, R66, R72

Coordinator exclusion rounds (MUST NOT route `implementer-only`): R49, R50, R51, R55, R60, R63, R64, R68

Source: `scripts/tier-router-fixtures/corpus.json`
