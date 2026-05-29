// @anchor/cli — git worktree isolation for `anchor wave`.
//
// Fan-out needs each concurrent item to edit files in its OWN working tree (concurrent
// acceptEdits agents in one tree would stomp). Rather than make the operator hand-create
// worktrees, the CLI can spin up one git worktree + branch per item off a base ref. The
// work lands (uncommitted) in each worktree on its own branch, ready for the operator to
// review / commit / open a PR — the same per-branch review flow used everywhere else.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface WorktreeSpec { itemId: string; dir: string; branch: string; }

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A filesystem/branch-safe slug for an item id. */
export function slug(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Create one git worktree + branch per item, off `base`, under `rootDir`.
 *  Branch + dir are namespaced by waveId so repeated waves don't collide. Throws (with
 *  git's message) if `repo` isn't a git repo, the base ref is unknown, or a branch/dir
 *  already exists — the caller surfaces that as a clean error. */
export function createWorktrees(opts: {
  repo: string; base: string; waveId: string; ids: string[]; rootDir: string;
}): WorktreeSpec[] {
  // Fail fast if this isn't a git repo.
  git(opts.repo, ['rev-parse', '--is-inside-work-tree']);
  mkdirSync(opts.rootDir, { recursive: true });

  const specs: WorktreeSpec[] = [];
  for (const id of opts.ids) {
    const s = slug(id);
    const dir = join(opts.rootDir, s);
    const branch = `anchor/${slug(opts.waveId)}/${s}`;
    git(opts.repo, ['worktree', 'add', '-b', branch, dir, opts.base]);
    specs.push({ itemId: id, dir, branch });
  }
  return specs;
}
