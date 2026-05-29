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

## ⚠️ Verification status

**The mapping logic is fully unit-tested** (7/7) by injecting a fake `query` stream — `mapUsage`, `extractArtifacts`, `detectStatus`, `buildQueryOptions`, and `spawnRole` end-to-end with mocked SDK messages. **The live path — calling the real `@anthropic-ai/claude-agent-sdk` — has NOT been run here** (no SDK install / API key in the build env). The SDK API was verified against the official TypeScript reference (2026-05-29), but treat the live run as unconfirmed until you smoke-test it.

### Operator smoke test

```bash
npm i @anthropic-ai/claude-agent-sdk        # peer dep (optional; dynamically imported)
export ANTHROPIC_API_KEY=sk-...
# then run a small `audit`-tier round on a throwaway task and confirm:
#   - the role writes files (artifacts populated)
#   - result.usage has non-zero cache_read/output
#   - total_cost_usd is present
```

The SDK is a **peer dependency** (`peerDependenciesMeta.optional`) and is `import()`-ed only when no `queryFn` is supplied — so tests and installs don't require it; inject `queryFn` to run without it.
