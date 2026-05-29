import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWave, MockRuntimeAdapter } from '../src/index.ts';
import type { WaveItem, RuntimeAdapter, RoleSpec, RoleResult } from '../src/index.ts';

const cfg = { waveId: 'W01', runDate: '2026-05-29' };
const items = (ids: string[]): WaveItem[] => ids.map((id) => ({ id, task: `do ${id}`, tier: 'solo' as const }));

test('runWave fans out independent items and aggregates in INPUT order, COMPLETE when all complete', async () => {
  const seen: string[] = [];
  const wave = await runWave(
    items(['a', 'b', 'c']),
    () => ({ adapter: new MockRuntimeAdapter({ handler: (s: RoleSpec) => { seen.push(s.role); return {}; } }) }),
    cfg,
  );
  assert.equal(wave.status, 'COMPLETE');
  assert.deepEqual(wave.rounds.map((r) => r.itemId), ['a', 'b', 'c']); // input order, not completion order
  assert.ok(wave.rounds.every((r) => r.result.status === 'COMPLETE'));
});

test('runWave reports PARTIAL when any item does not complete', async () => {
  const wave = await runWave(
    items(['ok', 'bad']),
    (item) => ({ adapter: new MockRuntimeAdapter({
      handler: () => item.id === 'bad' ? { status: 'BLOCKED' } : {},
    }) }),
    cfg,
  );
  assert.equal(wave.status, 'PARTIAL');
  assert.equal(wave.rounds.find((r) => r.itemId === 'bad')!.result.status, 'BLOCKED');
  assert.equal(wave.rounds.find((r) => r.itemId === 'ok')!.result.status, 'COMPLETE');
});

test('runWave calls depsFor once per item (each gets its own deps/adapter)', async () => {
  const built: string[] = [];
  await runWave(items(['x', 'y', 'z']), (item) => { built.push(item.id); return { adapter: new MockRuntimeAdapter() }; }, cfg);
  assert.deepEqual(built.sort(), ['x', 'y', 'z']);
});

test('runWave respects the concurrency bound', async () => {
  const state = { active: 0, max: 0 };
  class TrackingAdapter implements RuntimeAdapter {
    async spawnRole(spec: RoleSpec): Promise<RoleResult> {
      state.active++; state.max = Math.max(state.max, state.active);
      await new Promise((r) => setTimeout(r, 5));
      state.active--;
      return { role: spec.role, status: 'READY', artifacts: [], handoff: {}, usage: { input: 0, cache_creation: 0, cache_read: 0, output: 0 } };
    }
  }
  const wave = await runWave(items(['1', '2', '3', '4', '5']), () => ({ adapter: new TrackingAdapter() }), { ...cfg, concurrency: 2 });
  assert.equal(wave.status, 'COMPLETE');
  assert.ok(state.max <= 2, `max concurrent ${state.max} should be ≤ 2`);
  assert.ok(state.max >= 2, 'should actually have run 2 at once');
});

test('runWave on an empty plan is vacuously COMPLETE with no rounds', async () => {
  const wave = await runWave([], () => ({ adapter: new MockRuntimeAdapter() }), cfg);
  assert.equal(wave.status, 'COMPLETE');
  assert.equal(wave.rounds.length, 0);
});
