import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemorialStore, MemoryPersistence, JsonFilePersistence, runRound, MockRuntimeAdapter, keywordRelevance,
} from '../src/index.ts';
import type { RoundConfig, MemorialEntry, RoleSpec } from '../src/index.ts';

const cfg: RoundConfig = { roundId: 'R01', tier: 'audit', task: 'demo', runDate: '2026-05-29' };
const seedEntry = (over: Partial<MemorialEntry> = {}): Partial<MemorialEntry> & { id: string; trigger: string; rule: string; origin: string } =>
  ({ id: 'firing-attribution', trigger: 'hypothesis tree', rule: 'verify firing-ID attribution at source before building a hypothesis tree', origin: 'DeploySignal Topic 52', ...over });

test('add + accrete confirmations/violations', () => {
  const s = new MemorialStore(new MemoryPersistence());
  s.add(seedEntry());
  s.recordConfirmation('firing-attribution', '2026-05-29');
  s.recordConfirmation('firing-attribution');
  s.recordViolation('firing-attribution');
  const e = s.list()[0];
  assert.equal(e.cCount, 2);
  assert.equal(e.vCount, 1);
  assert.equal(e.lastApplied, '2026-05-29');
});

test('applicable returns non-retired rules; retired entries stop injecting', async () => {
  const s = new MemorialStore(new MemoryPersistence());
  s.add(seedEntry());
  s.add(seedEntry({ id: 'retired-one', rule: 'old rule' }));
  s.retire('retired-one', 'failure mode eliminated by a lint rule', '2026-05-29');
  const rules = await s.applicable(cfg);
  assert.deepEqual(rules, ['[firing-attribution] verify firing-ID attribution at source before building a hypothesis tree']);
});

test('record() tolerates an unknown/hallucinated id (no throw, no accrual)', async () => {
  const s = new MemorialStore(new MemoryPersistence());
  s.add(seedEntry());
  await s.record('confirmation', { memorialId: 'not-a-real-discipline', date: '2026-05-29' });
  await s.record('violation', { memorialId: 'also-fake' });
  assert.equal(s.list()[0].cCount, 0); // the real entry is untouched
  assert.equal(s.list().length, 1);    // no phantom entry created
});

test('engine integration: reviewer memorialSignals accrue V/C by id (the learning loop)', async () => {
  const store = new MemorialStore(new MemoryPersistence());
  store.add(seedEntry({ id: 'additive-replay-clean', rule: 'changes must be additive' }));
  store.add(seedEntry({ id: 'no-rng', rule: 'no RNG in scoring' }));
  const adapter = new MockRuntimeAdapter({
    handler: (spec: RoleSpec) =>
      spec.role === 'reviewer'
        ? { memorialSignals: { confirm: ['additive-replay-clean'], violate: ['no-rng'] } }
        : {},
  });
  const r = await runRound({ ...cfg, tier: 'full' }, { adapter, memorial: store });
  assert.equal(r.status, 'COMPLETE');
  const byId = Object.fromEntries(store.ratios().map((x) => [x.id, x]));
  assert.equal(byId['additive-replay-clean'].c, 1); // upheld → confirmation
  assert.equal(byId['additive-replay-clean'].v, 0);
  assert.equal(byId['no-rng'].v, 1);                // broken → violation
});

test('engine integration: a hallucinated signalled id does not crash the run', async () => {
  const store = new MemorialStore(new MemoryPersistence());
  store.add(seedEntry());
  const adapter = new MockRuntimeAdapter({
    handler: (spec: RoleSpec) =>
      spec.role === 'reviewer' ? { memorialSignals: { confirm: ['ghost-discipline'], violate: [] } } : {},
  });
  const r = await runRound({ ...cfg, tier: 'full' }, { adapter, memorial: store });
  assert.equal(r.status, 'COMPLETE'); // tolerated, not crashed
  assert.equal(store.list()[0].cCount, 0);
});

test('only the Reviewer drives accrual — a non-reviewer self-report does NOT accrue', async () => {
  const store = new MemorialStore(new MemoryPersistence());
  store.add(seedEntry({ id: 'd1', rule: 'r' }));
  const adapter = new MockRuntimeAdapter({
    handler: (spec: RoleSpec) =>
      spec.role === 'architect' ? { memorialSignals: { confirm: ['d1'], violate: [] } } : {},
  });
  await runRound({ ...cfg, tier: 'full' }, { adapter, memorial: store });
  assert.equal(store.ratios()[0].c, 0); // the architect's self-confirm is advisory, not accrued
});

test('reviewer accrual skips gate-owned disciplines and lets a violation win over a confirm', async () => {
  const store = new MemorialStore(new MemoryPersistence());
  store.add(seedEntry({ id: 'pre-emit-grilling', rule: 'gate-owned' }));
  store.add(seedEntry({ id: 'custom', rule: 'c' }));
  const adapter = new MockRuntimeAdapter({
    handler: (spec: RoleSpec) =>
      spec.role === 'reviewer'
        ? { memorialSignals: { confirm: ['pre-emit-grilling', 'custom'], violate: ['custom'] } }
        : {},
  });
  await runRound({ ...cfg, tier: 'full' }, { adapter, memorial: store, gateOwnedMemorialIds: ['pre-emit-grilling'] });
  const byId = Object.fromEntries(store.ratios().map((x) => [x.id, x]));
  assert.equal(byId['pre-emit-grilling'].c, 0); // gate-owned → not double-counted by the signal
  assert.equal(byId['pre-emit-grilling'].v, 0);
  assert.equal(byId['custom'].v, 1);            // violation wins
  assert.equal(byId['custom'].c, 0);            // the conflicting confirm is dropped
});

test('injectCap caps injection to the most relevant rules (self-limiting)', async () => {
  const s = new MemorialStore(new MemoryPersistence(), { injectCap: 2 });
  const c = { ...cfg, task: 'change the scoring kernel sigma' };
  s.add(seedEntry({ id: 'r-scoring', trigger: 'scoring change', rule: 'keep scoring kernel deterministic' }));
  s.add(seedEntry({ id: 'r-kernel', trigger: 'kernel', rule: 'document kernel sigma' }));
  s.add(seedEntry({ id: 'r-docs', trigger: 'docs', rule: 'update the readme' }));        // irrelevant
  s.add(seedEntry({ id: 'r-cli', trigger: 'cli flag', rule: 'opt-in flags only' }));      // irrelevant
  const rules = await s.applicable(c);
  assert.equal(rules.length, 2);
  assert.ok(rules.some((r) => r.includes('r-scoring')) && rules.some((r) => r.includes('r-kernel')));
  assert.ok(!rules.some((r) => r.includes('r-docs') || r.includes('r-cli')));
});

test('a live rule (violations > confirmations) injects even beyond the cap', async () => {
  const s = new MemorialStore(new MemoryPersistence(), { injectCap: 1 });
  const c = { ...cfg, task: 'unrelated task xyz' };
  s.add(seedEntry({ id: 'live-1', trigger: 't', rule: 'r' })); s.recordViolation('live-1'); // V1/C0 → live
  s.add(seedEntry({ id: 'rel-1', trigger: 'xyz', rule: 'matches xyz' }));                    // top-1 relevant
  s.add(seedEntry({ id: 'cold', trigger: 'nope', rule: 'irrelevant' }));
  const rules = await s.applicable(c);
  assert.ok(rules.some((r) => r.includes('live-1')), 'live rule always injected');
  assert.ok(rules.some((r) => r.includes('rel-1')), 'plus the top-1 relevant');
  assert.ok(!rules.some((r) => r.includes('cold')), 'cold irrelevant rule dropped by the cap');
});

test('no injectCap → all eligible inject (legacy behavior preserved)', async () => {
  const s = new MemorialStore(new MemoryPersistence());
  for (const id of ['a', 'b', 'c']) s.add(seedEntry({ id, rule: `rule ${id}` }));
  assert.equal((await s.applicable(cfg)).length, 3);
});

test('keywordRelevance scores task-token overlap with the rule', () => {
  const e = (over: Partial<MemorialEntry>) => ({ id: 'x', trigger: '', rule: '', origin: 'o', vCount: 0, cCount: 0, status: 'active' as const, ...over });
  assert.ok(keywordRelevance(e({ trigger: 'scoring kernel', rule: 'sigma' }), { ...cfg, task: 'change the scoring kernel' }) >= 2);
  assert.equal(keywordRelevance(e({ trigger: 'docs', rule: 'readme' }), { ...cfg, task: 'change the scoring kernel' }), 0);
});

test('triggerMatcher narrows applicability to the round', async () => {
  const s = new MemorialStore(new MemoryPersistence(), { triggerMatcher: (e, c) => c.task.includes(e.trigger) });
  s.add(seedEntry({ trigger: 'schema' }));
  assert.deepEqual(await s.applicable({ ...cfg, task: 'add a field' }), []); // no 'schema' in task
  assert.equal((await s.applicable({ ...cfg, task: 'schema migration' })).length, 1);
});

test('record(kind, {memorialId}) routes; without memorialId it is a no-op', async () => {
  const s = new MemorialStore(new MemoryPersistence());
  s.add(seedEntry());
  await s.record('confirmation', { memorialId: 'firing-attribution', date: '2026-05-29' });
  await s.record('violation', {}); // no id -> ignored
  const e = s.list()[0];
  assert.equal(e.cCount, 1);
  assert.equal(e.vCount, 0);
});

test('prune: stabilizes at threshold, retires at the higher threshold; a violation re-opens', () => {
  const s = new MemorialStore(new MemoryPersistence(), { thresholds: { stabilizeAt: 3, retireAt: 5 } });
  s.add(seedEntry());
  for (let i = 0; i < 3; i++) s.recordConfirmation('firing-attribution');
  assert.deepEqual(s.prune('2026-05-29').stabilized, ['firing-attribution']);
  assert.equal(s.list()[0].status, 'stabilized');

  s.recordViolation('firing-attribution'); // a fresh violation re-opens
  assert.equal(s.list()[0].status, 'active');

  // accumulate confirmations past retireAt with no further violations -> retired
  // (vCount is now 1, so it can't auto-retire; demonstrate the 0-violation path on a clean entry)
  s.add(seedEntry({ id: 'clean', rule: 'clean rule' }));
  for (let i = 0; i < 5; i++) s.recordConfirmation('clean');
  assert.deepEqual(s.prune('2026-05-29').retired, ['clean']);
  assert.equal(s.list().find((e) => e.id === 'clean')!.status, 'retired');
});

test('ratios flags an unhealthy entry (violations outpace confirmations)', () => {
  const s = new MemorialStore(new MemoryPersistence());
  s.add(seedEntry());
  s.recordViolation('firing-attribution');
  s.recordViolation('firing-attribution');
  s.recordConfirmation('firing-attribution');
  assert.equal(s.ratios()[0].healthy, false); // 2 V vs 1 C
});

test('MemoryPersistence round-trips entries across store instances', () => {
  const p = new MemoryPersistence();
  const a = new MemorialStore(p); a.add(seedEntry()); a.recordConfirmation('firing-attribution');
  const b = new MemorialStore(p); // reload from the same persistence
  assert.equal(b.list()[0].cCount, 1);
});

test('JsonFilePersistence round-trips through a real file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'anchor-mem-')), 'memorial.json');
  const a = new MemorialStore(new JsonFilePersistence(file)); a.add(seedEntry()); a.recordConfirmation('firing-attribution', '2026-05-29');
  const b = new MemorialStore(new JsonFilePersistence(file));
  assert.equal(b.list()[0].cCount, 1);
  assert.equal(b.list()[0].origin, 'DeploySignal Topic 52');
});

test('engine integration: applicable() reinforcements are injected into the role prompt', async () => {
  const store = new MemorialStore(new MemoryPersistence());
  store.add(seedEntry());
  let implPrompt = '';
  const adapter = new MockRuntimeAdapter({ handler: (spec: RoleSpec) => { if (spec.role === 'implementer') implPrompt = spec.prompt; return {}; } });
  const r = await runRound(cfg, { adapter, memorial: store });
  assert.equal(r.status, 'COMPLETE');
  assert.match(implPrompt, /REINFORCEMENTS:/);
  assert.match(implPrompt, /verify firing-ID attribution/);
});
