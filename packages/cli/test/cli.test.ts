import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockRuntimeAdapter, MemoryPersistence, MemorialStore, JsonFilePersistence, ROUTING_PROVENANCE } from '@anchor/core';
import type { MemorialEntry } from '@anchor/core';
import { parseArgs } from '../src/args.ts';
import { cmdRoute, cmdRun, cmdMemorial, cmdWave, cmdCalibrate } from '../src/commands.ts';

// Run a body with a stub ANTHROPIC_API_KEY (the drift gate skips entirely without one).
async function withApiKey(fn: () => Promise<void>) {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  try { await fn(); } finally { if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved; }
}
const DRIFTED = [...ROUTING_PROVENANCE.models, 'claude-opus-5-0'];
import type { CliContext } from '../src/commands.ts';

// Guard: the real CLI entrypoint must actually load + run. The other tests import command
// functions directly, so a syntax error in cli.ts's HELP template (e.g. a stray backtick)
// goes uncaught — this spawns `node cli.ts --help` and asserts it parses and exits cleanly.
test('cli.ts entrypoint loads and runs (regression: HELP template must parse at module load)', () => {
  const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  // `route` is offline (no model/tokens) and exits 0; loading cli.ts forces the top-level HELP
  // template to parse, so a stray backtick (which broke the binary while unit tests stayed green)
  // surfaces here as a non-zero exit + thrown error.
  const out = execFileSync('node', [cliPath, 'route', '--task', 'add a --json flag'], { encoding: 'utf8' });
  assert.match(out, /tier/i); // route rendered its classification
});

function testCtx(seed: MemorialEntry[] = [], models?: string[]) {
  const out: string[] = [];
  const persistence = new MemoryPersistence(seed);
  const ctx: CliContext = {
    cwd: '/tmp',
    now: () => '2026-05-29',
    stdout: (s) => out.push(s),
    makeAdapter: () => new MockRuntimeAdapter(),
    makePersistence: () => persistence,
    // Default: exactly the grounded models → no drift. Pass `models` to simulate a new release.
    listModels: async () => models ?? [...ROUTING_PROVENANCE.models],
  };
  return { ctx, out };
}

test('run: model drift → conservative (safe) routing — full tier + opus everywhere', async () => {
  await withApiKey(async () => {
    const { ctx, out } = testCtx([], DRIFTED); // a new ungrounded model is offered
    const r = await cmdRun({ task: 'new module merge.ts; additive, pure + deterministic', 'no-test-gate': true }, ctx);
    assert.equal(r.result!.tier, 'full'); // would be audit without drift → over-provisioned
    assert.ok(r.result!.phases.every((p) => p.model === 'claude-opus-4-8'));
    assert.match(out.join('\n'), /model drift/i);
  });
});

test('run: no model drift → normal routing (additive → audit)', async () => {
  await withApiKey(async () => {
    const { ctx, out } = testCtx(); // default model list == grounded → no drift
    const r = await cmdRun({ task: 'new module merge.ts; additive, pure + deterministic', 'no-test-gate': true }, ctx);
    assert.equal(r.result!.tier, 'audit');
    assert.doesNotMatch(out.join('\n'), /model drift/i);
  });
});

test('run: --no-model-check skips the drift gate even when a new model exists', async () => {
  await withApiKey(async () => {
    const { ctx } = testCtx([], DRIFTED);
    const r = await cmdRun({ task: 'new module merge.ts; additive', 'no-test-gate': true, 'no-model-check': true }, ctx);
    assert.equal(r.result!.tier, 'audit'); // not over-provisioned
  });
});

test('calibrate: reports drift + the grounded set; exits 0', async () => {
  await withApiKey(async () => {
    const { ctx, out } = testCtx([], DRIFTED);
    const r = await cmdCalibrate({}, ctx);
    assert.equal(r.code, 0);
    assert.match(out.join('\n'), /drift/i);
    assert.match(out.join('\n'), /claude-opus-5-0/);
  });
});

test('calibrate: no drift → reports current', async () => {
  await withApiKey(async () => {
    const { ctx, out } = testCtx();
    await cmdCalibrate({}, ctx);
    assert.match(out.join('\n'), /no drift/i);
  });
});

test('parseArgs handles --flag value, --flag=value, boolean, positionals', () => {
  const { _, flags } = parseArgs(['run', '--tier', 'audit', '--task=do x', '--mock']);
  assert.deepEqual(_, ['run']);
  assert.equal(flags.tier, 'audit');
  assert.equal(flags.task, 'do x');
  assert.equal(flags.mock, true);
});

test('route classifies a directive (offline)', async () => {
  const { ctx, out } = testCtx();
  const r = await cmdRoute({ task: 'Modify engine/detectors/fcp.ts — architectural-decision' }, ctx);
  assert.equal(r.code, 0);
  assert.equal(r.route!.tier, 'full');
  assert.match(out.join('\n'), /tier: full/);
});

test('route with no input errors (code 2)', async () => {
  const { ctx } = testCtx();
  assert.equal((await cmdRoute({}, ctx)).code, 2);
});

test('run --json emits the RunResult (with per-role usage) as parseable JSON', async () => {
  const { ctx, out } = testCtx();
  await cmdRun({ mock: true, tier: 'audit', task: 'demo', json: true }, ctx);
  const parsed = JSON.parse(out.join('\n').trim());
  assert.equal(parsed.status, 'COMPLETE');
  assert.ok(parsed.phases[0].usage && typeof parsed.phases[0].usage.output === 'number');
});

test('run --mock --tier audit runs the 3-role cycle', async () => {
  const { ctx } = testCtx();
  const r = await cmdRun({ mock: true, tier: 'audit', task: 'demo' }, ctx);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result!.phases.map((p) => p.role), ['implementer', 'reviewer', 'memorial']);
});

test('run --mock self-routes from --task when no --tier given', async () => {
  const { ctx } = testCtx();
  const r = await cmdRun({ mock: true, task: 'mechanical typo fix in the README' }, ctx);
  assert.equal(r.result!.tier, 'implementer-only');
  assert.deepEqual(r.result!.phases.map((p) => p.role), ['implementer']);
});

test('run without --mock and no API key does NOT hard-block (SDK uses Claude Code auth); prints a note', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { ctx, out } = testCtx(); // injects a mock adapter, so the run completes
    const r = await cmdRun({ tier: 'audit', task: 'demo', 'no-test-gate': true }, ctx); // mock adapter; skip the real npm-test gate
    assert.equal(r.code, 0);
    assert.match(out.join('\n'), /no ANTHROPIC_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

const seedEntry: MemorialEntry = { id: 'firing-attribution', trigger: 'hypothesis tree', rule: 'verify attribution first', origin: 'DeploySignal T52', vCount: 0, cCount: 25, status: 'active' };

test('memorial list / ratios / prune', async () => {
  const { ctx, out } = testCtx([{ ...seedEntry }]);
  assert.equal((await cmdMemorial('list', {}, ctx)).code, 0);

  const ratios = await cmdMemorial('ratios', {}, ctx);
  assert.equal((ratios.data as { id: string }[])[0].id, 'firing-attribution');

  const pruned = await cmdMemorial('prune', {}, ctx);
  assert.deepEqual((pruned.data as { retired: string[] }).retired, ['firing-attribution']); // 25 C / 0 V -> retired
  assert.match(out.join('\n'), /retired: firing-attribution/);
});

test('run: structural gates default-ON as advisory; --strict promotes them to blocking', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-cli-'));
  const specPath = join(dir, 'q-spec.md');
  writeFileSync(specPath, '# Spec for demo\nBody with no self-review buckets and no excluded-items list.\n'); // omits both disciplines (and avoids trigger words)
  const out: string[] = [];
  const ctx: CliContext = {
    cwd: dir,
    now: () => '2026-05-29',
    stdout: (s) => out.push(s),
    makeAdapter: () => new MockRuntimeAdapter({ handler: (spec) => (spec.role === 'architect' ? { artifacts: [specPath] } : {}) }),
    makePersistence: () => new MemoryPersistence(),
  };

  // default: advisory — run completes but the omissions surface as warnings.
  // (--no-test-gate: this test uses a mock adapter, so skip the real npm-test gate.)
  const adv = await cmdRun({ tier: 'full', task: 'demo', 'no-test-gate': true }, ctx);
  assert.equal(adv.result!.status, 'COMPLETE');
  assert.ok(adv.result!.warnings.some((w) => /grilling/i.test(w)));
  assert.ok(adv.result!.warnings.some((w) => /anti-?scope/i.test(w)));

  // --strict: the same omissions now block the run
  const strict = await cmdRun({ tier: 'full', task: 'demo', strict: true, 'no-test-gate': true }, ctx);
  assert.equal(strict.code, 1);
  assert.equal(strict.result!.status, 'BLOCKED');

  // --no-gates: omissions neither warn nor block
  const off = await cmdRun({ tier: 'full', task: 'demo', 'no-gates': true, 'no-test-gate': true }, ctx);
  assert.equal(off.result!.status, 'COMPLETE');
  assert.equal(off.result!.warnings.length, 0);
});

test('run --memorial seeds disciplines and accrues V/C (violation on missing, confirmation on present)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-mem-run-'));
  const memPath = join(dir, 'memorial.json');
  const badSpec = join(dir, 'q-spec-bad.md'); writeFileSync(badSpec, '# Spec\nno self-review buckets, no excluded-items list');
  const goodSpec = join(dir, 'q-spec-good.md'); writeFileSync(goodSpec, '## Anti-scope\nNO ranges.\n## Pre-emit grilling\nCRITICAL: 0\nLIKELY-SURFACES: 0\nPRE-EMPTABLE: 0');
  const out: string[] = [];
  const ctx: CliContext = {
    cwd: dir, now: () => '2026-05-29', stdout: (s) => out.push(s),
    makeAdapter: () => new MockRuntimeAdapter(),
    makePersistence: (p) => new JsonFilePersistence(p!), // real file so the run persists + we can re-read
  };
  await cmdRun({ tier: 'full', task: 'demo', memorial: memPath, spec: badSpec, 'no-test-gate': true }, ctx);   // missing grilling+anti-scope
  await cmdRun({ tier: 'full', task: 'demo', memorial: memPath, spec: goodSpec, 'no-test-gate': true }, ctx);  // both present

  const store = new MemorialStore(new JsonFilePersistence(memPath));
  const grill = store.list().find((e) => e.id === 'pre-emit-grilling')!;
  const ascope = store.list().find((e) => e.id === 'anti-scope')!;
  assert.equal(grill.vCount, 1, 'grilling violation on the bad spec');
  assert.equal(grill.cCount, 1, 'grilling confirmation on the good spec');
  assert.equal(ascope.vCount, 1);
  assert.equal(ascope.cCount, 1);
});

test('memorial add authors a new entry', async () => {
  const { ctx } = testCtx();
  const r = await cmdMemorial('add', { id: 'my-rule', rule: 'always grep the field name', trigger: 'schema change' }, ctx);
  assert.equal(r.code, 0);
  assert.ok((r.data as { id: string }[]).some((e) => e.id === 'my-rule'));
  // missing --rule errors
  assert.equal((await cmdMemorial('add', { id: 'x' }, ctx)).code, 2);
});

test('memorial unknown subcommand errors', async () => {
  const { ctx } = testCtx();
  assert.equal((await cmdMemorial('frobnicate', {}, ctx)).code, 2);
});

test('run pauses on escalation, persists state, and --resume completes the round', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-resume-'));
  const statePath = join(dir, 'state.json');
  let escalatedOnce = false;
  const ctx: CliContext = {
    cwd: dir,
    now: () => '2026-05-29',
    stdout: () => {},
    makeAdapter: () => new MockRuntimeAdapter({
      handler: (spec) => {
        // First time the implementer runs, escalate (→ PAUSED, no onEscalate); on resume, complete.
        if (spec.role === 'implementer' && !escalatedOnce) {
          escalatedOnce = true;
          return { status: 'ESCALATE', escalation: { question: 'turn budget?', raisedBy: 'implementer' } };
        }
        return {};
      },
    }),
    makePersistence: () => new MemoryPersistence(),
  };
  const r1 = await cmdRun({ mock: true, tier: 'audit', task: 'x', state: statePath }, ctx);
  assert.equal(r1.result!.status, 'PAUSED');
  assert.equal(r1.result!.pausedAt, 'implementer');

  const r2 = await cmdRun({ mock: true, tier: 'audit', task: 'x', state: statePath, resume: true }, ctx);
  assert.equal(r2.result!.status, 'COMPLETE');
  assert.deepEqual(r2.result!.phases.map((p) => p.role), ['implementer', 'reviewer', 'memorial']);
});

test('--resume with no saved state errors (code 2)', async () => {
  const { ctx } = testCtx();
  const r = await cmdRun({ mock: true, resume: true, state: join(tmpdir(), 'anchor-no-such-state-xyz.json') }, ctx);
  assert.equal(r.code, 2);
});

function planFile(plan: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), 'anchor-wave-')), 'plan.json');
  writeFileSync(p, JSON.stringify(plan));
  return p;
}

test('wave fans out independent items and reports COMPLETE in input order (mock)', async () => {
  const { ctx } = testCtx();
  const plan = planFile({ items: [
    { id: 'feat-a', task: 'do a', tier: 'solo' },
    { id: 'feat-b', task: 'do b', tier: 'solo' },
    { id: 'feat-c', task: 'do c', tier: 'solo' },
  ] });
  const r = await cmdWave({ mock: true, plan, concurrency: '2' }, ctx);
  assert.equal(r.code, 0);
  assert.equal(r.wave!.status, 'COMPLETE');
  assert.deepEqual(r.wave!.rounds.map((x) => x.itemId), ['feat-a', 'feat-b', 'feat-c']);
});

test('wave requires --plan, and rejects an empty plan', async () => {
  const { ctx } = testCtx();
  assert.equal((await cmdWave({ mock: true }, ctx)).code, 2);            // no --plan
  assert.equal((await cmdWave({ mock: true, plan: planFile({ items: [] }) }, ctx)).code, 2); // empty
});

test('wave (live) refuses items that share a working dir — isolation guard, before any SDK call', async () => {
  const { ctx } = testCtx();
  // Two items, neither with its own cwd → would collide under acceptEdits. mock omitted so
  // the guard applies; it returns at the guard, so no adapter/SDK is ever invoked.
  const plan = planFile({ items: [{ id: 'a', task: 'x' }, { id: 'b', task: 'y' }] });
  const r = await cmdWave({ plan }, ctx);
  assert.equal(r.code, 2);
});

test('wave shares ONE memorial across items — both items accrue to the same instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-wave-mem-'));
  const memPath = join(dir, 'memorial.json');
  writeFileSync(memPath, JSON.stringify([{ id: 'shared-rule', trigger: 't', rule: 'r', origin: 'o', vCount: 0, cCount: 0, status: 'active' }]));
  const ctx: CliContext = {
    cwd: dir, now: () => '2026-05-29', stdout: () => {},
    makeAdapter: () => new MockRuntimeAdapter({
      handler: (s) => s.role === 'reviewer' ? { memorialSignals: { confirm: ['shared-rule'], violate: [] } } : {},
    }),
    makePersistence: (p) => new JsonFilePersistence(p!),
  };
  const plan = planFile({ items: [{ id: 'i1', task: 'a', tier: 'full' }, { id: 'i2', task: 'b', tier: 'full' }] });
  const r = await cmdWave({ mock: true, plan, memorial: memPath }, ctx);
  assert.equal(r.code, 0);
  const c = new MemorialStore(new JsonFilePersistence(memPath)).list().find((e) => e.id === 'shared-rule')!.cCount;
  assert.equal(c, 2, 'both items confirmed the rule on the shared instance (not last-writer-wins)');
});

test('wave resolves a relative item specPath against the item cwd so gates find the spec + accrue', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-wave-spec-'));
  const memPath = join(dir, 'memorial.json');
  const itemCwd = join(dir, 'item');
  mkdirSync(join(itemCwd, 'coordination'), { recursive: true });
  // A "good" spec (has the grilling + anti-scope sections) pre-written INSIDE the item cwd.
  writeFileSync(join(itemCwd, 'coordination', 'spec.md'), '## Anti-scope\nNO ranges.\n## Pre-emit grilling\nCRITICAL: 0\nLIKELY-SURFACES: 0\nPRE-EMPTABLE: 0');
  const ctx: CliContext = {
    cwd: dir, now: () => '2026-05-29', stdout: () => {},
    makeAdapter: () => new MockRuntimeAdapter(), // architect doesn't write; the spec pre-exists
    makePersistence: (p) => new JsonFilePersistence(p!),
  };
  // Relative specPath + per-item cwd: only resolves correctly if cmdWave absolutizes it.
  const plan = planFile({ items: [{ id: 'i1', task: 'demo', tier: 'full', cwd: itemCwd, specPath: 'coordination/spec.md' }] });
  await cmdWave({ mock: true, plan, memorial: memPath }, ctx);
  const grill = new MemorialStore(new JsonFilePersistence(memPath)).list().find((e) => e.id === 'pre-emit-grilling')!;
  assert.equal(grill.cCount, 1, 'gate read the spec via the item-cwd-resolved path and accrued a confirmation');
});

test('run auto-prunes the memorial (retires a fully-internalized rule); --no-prune skips it', async () => {
  const mk = () => {
    const dir = mkdtempSync(join(tmpdir(), 'anchor-prune-'));
    const memPath = join(dir, 'memorial.json');
    // A rule with 20 confirmations and 0 violations is fully internalized → retireAt.
    writeFileSync(memPath, JSON.stringify([{ id: 'ripe', trigger: 't', rule: 'r', origin: 'o', vCount: 0, cCount: 20, status: 'active' }]));
    const ctx: CliContext = { cwd: dir, now: () => '2026-05-29', stdout: () => {}, makeAdapter: () => new MockRuntimeAdapter(), makePersistence: (p) => new JsonFilePersistence(p!) };
    return { memPath, ctx };
  };
  const a = mk();
  await cmdRun({ mock: true, tier: 'audit', task: 'x', memorial: a.memPath }, a.ctx);
  assert.equal(new MemorialStore(new JsonFilePersistence(a.memPath)).list().find((e) => e.id === 'ripe')!.status, 'retired');

  const b = mk();
  await cmdRun({ mock: true, tier: 'audit', task: 'x', memorial: b.memPath, 'no-prune': true }, b.ctx);
  assert.equal(new MemorialStore(new JsonFilePersistence(b.memPath)).list().find((e) => e.id === 'ripe')!.status, 'active');
});
