import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktrees, slug, setupIntegration, commitWorktree, mergeIntoIntegration, ensureInitialCommit, discardPaths } from '../src/worktree.ts';

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

test('ensureInitialCommit gives a freshly git-init\'d repo (no commits, no user config) a HEAD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-fresh-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { stdio: 'ignore' }); // no user config, no commit
  writeFileSync(join(dir, 'package.json'), '{}');
  assert.throws(() => execFileSync('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' }));
  ensureInitialCommit(dir); // must not need global git identity
  const head = execFileSync('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
  assert.match(head, /^[0-9a-f]{40}/);
});

// The cross-stage dependency-visibility mechanism: a stage-2 worktree branched off the
// integration branch must see what a stage-1 feature committed + merged. This is the heart of
// `anchor project`'s git orchestration, tested deterministically with no model.
test('integration branch carries an earlier stage\'s merged work into a later stage\'s worktree', () => {
  const repo = tmpRepo();
  const root = join(repo, '.anchor', 'projects', 'P');
  const integ = setupIntegration({ repo, base: 'HEAD', projectId: 'P', rootDir: root });

  // Stage 1: feature "core" writes a file, commits, merges into integration.
  const s1 = createWorktrees({ repo, base: integ.branch, waveId: 'P-s1', ids: ['core'], rootDir: join(root, 'stage-1') });
  writeFileSync(join(s1[0].dir, 'core.js'), 'export const core = 1;\n');
  assert.equal(commitWorktree(s1[0].dir, 'feat(core)'), true);
  mergeIntoIntegration(integ.dir, s1[0].branch, 'merge core');

  // Stage 2: feature "api" branches off the NOW-ADVANCED integration branch → sees core.js.
  const s2 = createWorktrees({ repo, base: integ.branch, waveId: 'P-s2', ids: ['api'], rootDir: join(root, 'stage-2') });
  assert.ok(existsSync(join(s2[0].dir, 'core.js')), 'stage-2 worktree sees stage-1\'s merged code (dependency visibility)');

  // commitWorktree skips an empty (no-change) feature rather than making an empty commit.
  assert.equal(commitWorktree(s2[0].dir, 'feat(api) — nothing written'), false);
});

// Regression for the v1 merge crash: two parallel features that BOTH edit a shared root file
// (package.json) must not conflict at merge. discardPaths reverts the protected file before
// commit, so each feature commits only its own src; the merges then apply cleanly.
test('two features that both edited package.json merge cleanly after discardPaths', () => {
  const repo = tmpRepo();
  // Seed a package.json on the base so both features "change" it.
  writeFileSync(join(repo, 'package.json'), '{ "scripts": { "test": "node --test" } }\n');
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'add pkg'], { stdio: 'ignore' });

  const root = join(repo, '.anchor', 'projects', 'P');
  const integ = setupIntegration({ repo, base: 'HEAD', projectId: 'P', rootDir: root });
  const wts = createWorktrees({ repo, base: integ.branch, waveId: 'P-s1', ids: ['a', 'b'], rootDir: join(root, 'stage-1') });

  for (const w of wts) {
    writeFileSync(join(w.dir, `${w.itemId}.ts`), `export const ${w.itemId} = 1;\n`);
    writeFileSync(join(w.dir, 'package.json'), `{ "scripts": { "test": "node --test ${w.itemId}-only" } }\n`); // each rewrites it differently
    discardPaths(w.dir, ['package.json']);   // orchestrator reverts the protected file before commit
    assert.equal(commitWorktree(w.dir, `feat(${w.itemId})`), true);
    assert.equal(mergeIntoIntegration(integ.dir, w.branch, `merge ${w.itemId}`), true, `merge of ${w.itemId} is clean`);
  }
  // Both features' src landed; package.json is the untouched base version (no conflict markers).
  assert.ok(existsSync(join(integ.dir, 'a.ts')) && existsSync(join(integ.dir, 'b.ts')));
  const pkg = readFileSync(join(integ.dir, 'package.json'), 'utf8');
  assert.match(pkg, /"test": "node --test"/);
  assert.doesNotMatch(pkg, /<<<<<<<|a-only|b-only/); // no conflict markers, no feature pollution
});
