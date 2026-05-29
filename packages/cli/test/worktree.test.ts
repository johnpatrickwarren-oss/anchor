import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktrees, slug } from '../src/worktree.ts';

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-wt-repo-'));
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
  return dir;
}

test('slug makes a filesystem/branch-safe id', () => {
  assert.equal(slug('feat/Q35 summary!'), 'feat-Q35-summary');
  assert.equal(slug('ok.name-1'), 'ok.name-1');
  assert.equal(slug('!!!'), 'item'); // never empty
});

test('createWorktrees makes one worktree + branch per item off the base', () => {
  const repo = tmpRepo();
  const specs = createWorktrees({ repo, base: 'HEAD', waveId: 'W1', ids: ['a', 'b'], rootDir: join(repo, '.anchor', 'wt') });
  assert.equal(specs.length, 2);
  for (const s of specs) {
    assert.ok(existsSync(s.dir), `worktree dir ${s.dir} exists`);
    assert.ok(existsSync(join(s.dir, 'README.md')), 'worktree carries base content');
  }
  const branches = execFileSync('git', ['-C', repo, 'branch', '--list'], { encoding: 'utf8' });
  assert.match(branches, /anchor\/W1\/a/);
  assert.match(branches, /anchor\/W1\/b/);
});

test('createWorktrees throws on a non-git directory (caller surfaces a clean error)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-nogit-'));
  assert.throws(() => createWorktrees({ repo: dir, base: 'HEAD', waveId: 'W', ids: ['x'], rootDir: join(dir, 'wt') }));
});
