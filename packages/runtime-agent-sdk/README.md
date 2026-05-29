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

A runnable harness lives at [`smoke/smoke.ts`](smoke/smoke.ts). It runs one real role (solo tier by default) on a throwaway task in a temp dir and prints the gap-closing checks: artifacts on disk, non-zero usage, cost present.

```bash
npm install                                # at the REPO ROOT — brings the SDK (a dependency of this package)
export ANTHROPIC_API_KEY=sk-ant-...         # a REAL key, not the literal placeholder
npm run smoke                               # real run (spends a little); --tier audit to add the Reviewer
npm run smoke:mock                          # offline self-test (no key) — verifies the harness itself
```

`npm run smoke:mock` is verified green (orchestration + reporting + on-disk check) with no key. `npm run smoke` is the **operator-run step that closes the live-path verification gap** — confirm all five checks pass before relying on the adapter against a real model.

The SDK is a normal **dependency** of this package, so `npm install` at the workspace root brings it. It is still `import()`-ed lazily (and tests inject `queryFn`), so the adapter loads without touching the SDK until a real run.
