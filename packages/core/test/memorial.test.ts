import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemorialStore, MemoryPersistence, JsonFilePersistence, runRound, MockRuntimeAdapter,
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
  assert.deepEqual(rules, ['verify firing-ID attribution at source before building a hypothesis tree']);
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
