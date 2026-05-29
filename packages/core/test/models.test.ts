import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel, DEFAULT_MANIFEST } from '../src/index.ts';
import type { ModelManifest } from '../src/index.ts';

test('default role->class->model mapping matches the pipeline map', () => {
  assert.equal(resolveModel('architect'), 'claude-opus-4-8');
  assert.equal(resolveModel('reviewer'), 'claude-opus-4-8');
  assert.equal(resolveModel('coordinator'), 'claude-opus-4-8');
  assert.equal(resolveModel('implementer'), 'claude-sonnet-4-6');
  assert.equal(resolveModel('memorial'), 'claude-haiku-4-5-20251001');
});

test('a per-role override wins over the class default', () => {
  assert.equal(resolveModel('implementer', { overrides: { implementer: 'claude-opus-4-8' } }), 'claude-opus-4-8');
});

test('a custom manifest is honored (one-line model bump)', () => {
  const manifest: ModelManifest = { classes: { reasoning: 'claude-opus-9', balanced: 'claude-sonnet-9', cheap: 'claude-haiku-9' } };
  assert.equal(resolveModel('architect', { manifest }), 'claude-opus-9');
  assert.equal(resolveModel('memorial', { manifest }), 'claude-haiku-9');
});

test('DEFAULT_MANIFEST pins dated snapshots, not -latest aliases', () => {
  for (const id of Object.values(DEFAULT_MANIFEST.classes)) {
    assert.doesNotMatch(id, /latest/, `${id} must be a dated snapshot, not a -latest alias`);
  }
});
