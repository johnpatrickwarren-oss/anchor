# @anchor/runtime-agent-sdk

The first **real** `RuntimeAdapter` for [`@anchor/core`](../core) — runs each Anchor role as a [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript) `query()` (an agentic loop with file/bash tools) and maps the result back to a `RoleResult`, including honest per-category token usage.

```ts
import { runRound } from '@anchor/core';
import { AgentSdkAdapter } from '@anchor/runtime-agent-sdk';

const result = await runRound(
  { roundId: 'R01', tier: 'audit', task: 'Implement compareSemver', runDate: '2026-05-29' },
  { adapter: new AgentSdkAdapter({ cwd: process.cwd(), permissionMode: 'acceptEdits' }) },
);
```

## How it maps

| Anchor concept | Agent SDK |
|---|---|
| Role model (from the manifest) | `options.model` |
| Role tools | `options.allowedTools` |
| Role prompt + context refs | `prompt` (+ system prompt per role) |
| Artifacts | file paths from `Write`/`Edit` tool-use blocks |
| Per-role usage | `result.usage` → `{input, cache_creation, cache_read, output}` |
| Cost | `result.total_cost_usd` (in `handoff`) |
| Status | role's final text: `ESCALATE …` → ESCALATE; `HALT`/`DIAGNOSTIC` → BLOCKED; else READY (Anchor's NEXT-ROLE convention) |

## Model listing (for drift detection)

`listAvailableModels()` calls `GET /v1/models` and returns the available model ids — the cheap (~tokenless) half of model-drift detection that `@anchor/core`'s `checkModelDrift` + the CLI's startup gate use. `fetchFn` is injectable (unit-tested with no network); it follows pagination and throws on a non-OK response so callers treat any failure as "skip the check" (drift detection is best-effort and never blocks a run). Also exported: `parseUnits` (parses the Architect's `ANCHOR-UNIT` lines for within-feature parallelism).

## ⚠️ Verification status

**The mapping logic is fully unit-tested** (27 tests) by injecting a fake `query` stream — `mapUsage`, `extractArtifacts`, `detectStatus`, `parseStatusContract`, `parseMemorialSignals`, `parseUnits`, `buildQueryOptions`, `resolveMaxTurns`, `listAvailableModels`, and `spawnRole` end-to-end (incl. the maxTurns/transient-error preserve-on-error paths) with mocked SDK messages.

**✅ The live path is VERIFIED (2026-05-29).** `pnpm run smoke` was run against a real model (Claude Code / Max subscription auth, no API key): the Implementer role ran on `claude-sonnet-4-6`, wrote a correct `add(a,b)` module + a passing `node:test`, and reported real usage (357,886 cache-read + 2,760 output tokens). All five checks passed. The adapter works end-to-end against a real model.

### Operator smoke test

A runnable harness lives at [`smoke/smoke.ts`](smoke/smoke.ts). It runs one real role (solo tier by default) on a throwaway task in a temp dir and prints the gap-closing checks: artifacts on disk, non-zero usage, cost present.

```bash
pnpm install                               # at the REPO ROOT — brings the SDK (a dependency of this package)
# Auth: either be logged into Claude Code (Pro/Max subscription) with NO key set,
#       or `export ANTHROPIC_API_KEY=sk-ant-...` (a real key). A placeholder key
#       OVERRIDES the subscription login — unset it if you hit "Invalid API key".
pnpm run smoke                             # real run (spends a little); --tier audit adds the Reviewer
ANCHOR_SMOKE_MAX_TURNS=40 pnpm run smoke   # bump the per-role turn cap for heavier tasks (default 30)
pnpm run smoke:mock                        # offline self-test (no auth) — verifies the harness itself
```

`pnpm run smoke:mock` is verified green offline. `pnpm run smoke` was run live (2026-05-29, Max subscription) and passed all five checks.

The SDK is a normal **dependency** of this package, so `pnpm install` at the workspace root brings it. It is still `import()`-ed lazily (and tests inject `queryFn`), so the adapter loads without touching the SDK until a real run.
