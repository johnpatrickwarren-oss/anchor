import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAvailableModels } from '../src/index.ts';

const fake = (pages: object[]): typeof fetch => {
  let i = 0;
  return (async () => ({ ok: true, status: 200, json: async () => pages[Math.min(i++, pages.length - 1)] })) as unknown as typeof fetch;
};

test('listAvailableModels maps /v1/models data → ids', async () => {
  const fetchFn = fake([{ data: [{ id: 'claude-opus-4-8' }, { id: 'claude-sonnet-4-6' }], has_more: false }]);
  assert.deepEqual(await listAvailableModels({ apiKey: 'k', fetchFn }), ['claude-opus-4-8', 'claude-sonnet-4-6']);
});

test('listAvailableModels follows pagination (has_more + last_id)', async () => {
  const fetchFn = fake([
    { data: [{ id: 'a' }], has_more: true, last_id: 'a' },
    { data: [{ id: 'b' }], has_more: false },
  ]);
  assert.deepEqual(await listAvailableModels({ apiKey: 'k', fetchFn }), ['a', 'b']);
});

test('listAvailableModels throws on non-OK (caller treats failure as skip-the-check)', async () => {
  const fetchFn = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
  await assert.rejects(listAvailableModels({ apiKey: 'k', fetchFn }));
});

test('listAvailableModels throws without an API key', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try { await assert.rejects(listAvailableModels({ fetchFn: fake([{ data: [], has_more: false }]) })); }
  finally { if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; }
});
