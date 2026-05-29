// @anchor/runtime-agent-sdk — live smoke test.
//
// Closes the verification gap: runs ONE real Anchor role (solo tier by default) through
// the AgentSdkAdapter against a real model, in an isolated temp dir, and prints the signals
// that prove the live path works — artifacts on disk, non-zero token usage, and a cost.
//
// Usage:
//   npm i @anthropic-ai/claude-agent-sdk      # peer dep
//   export ANTHROPIC_API_KEY=sk-...
//   node packages/runtime-agent-sdk/smoke/smoke.ts            # real run (spends a little)
//   node packages/runtime-agent-sdk/smoke/smoke.ts --tier audit
//   node packages/runtime-agent-sdk/smoke/smoke.ts --mock     # offline self-test (no key/SDK)
//
// --mock injects a canned query stream (which also writes the expected file) so the harness
// orchestration + reporting + on-disk checks can be verified with no SDK or API key.

import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRound } from '@anchor/core';
import type { Tier } from '@anchor/core';
import { AgentSdkAdapter } from '../src/index.ts';
import type { QueryFn, SdkMessage } from '../src/index.ts';

const args = process.argv.slice(2);
const mock = args.includes('--mock') || process.env.ANCHOR_SMOKE_MOCK === '1';
const tierArg = (args[args.indexOf('--tier') + 1] as Tier) || undefined;
const tier: Tier = args.includes('--tier') && tierArg ? tierArg : 'solo';

const TASK =
  'Create add.mjs in the current working directory exporting `export function add(a, b) { return a + b; }`, ' +
  'and test/add.test.mjs using node:test that asserts add(2,3)===5. Run `node --test test/add.test.mjs` and confirm it passes.';

function fail(msg: string): never { console.error(`\n✗ SMOKE FAILED: ${msg}`); process.exit(1); }

// Canned query for --mock: writes the expected file into cwd, then yields a realistic stream.
function mockQueryFor(cwd: string): QueryFn {
  return () => (async function* (): AsyncIterable<SdkMessage> {
    writeFileSync(join(cwd, 'add.mjs'), 'export function add(a, b) { return a + b; }\n');
    yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: join(cwd, 'add.mjs') } }] } };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Done. 1/1 test passes.' }] } };
    yield { type: 'result', subtype: 'success', total_cost_usd: 0.0123, usage: { input_tokens: 40, output_tokens: 120, cache_creation_input_tokens: 800, cache_read_input_tokens: 1500 } };
  })();
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-smoke-'));
  console.log(`mode: ${mock ? 'MOCK (offline)' : 'LIVE (real model — spends tokens)'}`);
  console.log(`tier: ${tier}\nsandbox: ${dir}\n`);

  if (!mock) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.warn('ℹ no ANTHROPIC_API_KEY set — the SDK will use Claude Code\'s existing auth (e.g. a logged-in Claude subscription). Export sk-ant-… to use an API key instead.');
    } else if (!/^sk-ant-/.test(key)) {
      console.warn(`⚠ ANTHROPIC_API_KEY="${key.slice(0, 7)}…" doesn't look like an Anthropic key (expected sk-ant-…). A bad/placeholder key OVERRIDES your Claude Code login — \`unset ANTHROPIC_API_KEY\` to use your subscription, or set a real key. Continuing anyway.`);
    }
    try { await import('@anthropic-ai/claude-agent-sdk' as string); }
    catch { fail('@anthropic-ai/claude-agent-sdk not resolvable. Run `npm install` at the repo root (it is a dependency of this package), or use --mock.'); }
  }

  const maxTurns = Number(args[args.indexOf('--max-turns') + 1]) || Number(process.env.ANCHOR_SMOKE_MAX_TURNS) || 30;
  const adapter = new AgentSdkAdapter({
    cwd: dir,
    permissionMode: 'acceptEdits',
    maxTurns,
    queryFn: mock ? mockQueryFor(dir) : undefined,
  });

  const runDate = new Date().toISOString().slice(0, 10); // harness MAY generate dates (not a workflow script)
  const result = await runRound({ roundId: 'SMOKE', tier, task: TASK, runDate }, { adapter });

  // ── Report ──
  console.log('phase                model                         status    in   cache_cr  cache_rd   out');
  for (const p of result.phases) {
    const u = p.usage;
    console.log(`${p.role.padEnd(20)} ${p.model.padEnd(28)} ${p.status.padEnd(9)} ${String(u.input).padStart(4)} ${String(u.cache_creation).padStart(9)} ${String(u.cache_read).padStart(9)} ${String(u.output).padStart(5)}`);
  }
  console.log(`\nrun status: ${result.status}`);

  // ── Verification checks (the gap-closers) ──
  const checks: [string, boolean][] = [];
  checks.push(['run reached COMPLETE', result.status === 'COMPLETE']);
  const allArtifacts = result.phases.flatMap((p) => p.artifacts);
  checks.push(['role returned ≥1 artifact', allArtifacts.length > 0]);
  checks.push(['artifact exists on disk', allArtifacts.some((a) => existsSync(a))]);
  const tot = result.phases.reduce((s, p) => ({ inp: s.inp + p.usage.input + p.usage.cache_read, out: s.out + p.usage.output }), { inp: 0, out: 0 });
  checks.push(['prompt tokens > 0', tot.inp > 0]);
  checks.push(['output tokens > 0', tot.out > 0]);

  console.log('');
  let ok = true;
  for (const [name, pass] of checks) { console.log(`${pass ? '✓' : '✗'} ${name}`); if (!pass) ok = false; }
  console.log(`\n${ok ? '✓ SMOKE PASSED' : '✗ SMOKE FAILED'} — sandbox left at ${dir} for inspection.`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => fail(e?.message ?? String(e)));
