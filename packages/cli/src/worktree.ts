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

// A self-contained committer identity so anchor's commits/merges work even in a repo with no
// configured user (fresh `anchor init`, CI) — passed inline, never mutating the user's config.
const IDENT = ['-c', 'user.email=anchor@local', '-c', 'user.name=Anchor'];

/** Ensure the repo has at least one commit so worktrees can branch off HEAD. A fresh
 *  `anchor init` runs `git init` but never commits — without this, `setupIntegration` (base
 *  HEAD) fails. Commits the current scaffold as the initial commit; no-op if HEAD exists. */
export function ensureInitialCommit(repo: string): void {
  try { git(repo, ['rev-parse', '--verify', 'HEAD']); return; } catch { /* no commits yet */ }
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, ...IDENT, 'commit', '-m', 'anchor: initial scaffold', '--no-verify', '--allow-empty'], { stdio: 'ignore' });
}

/** A filesystem/branch-safe slug for an item id. */
export function slug(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Set up the project INTEGRATION worktree+branch off `base`. `anchor project` runs each
 *  stage's features on worktrees branched off this integration branch and merges their work
 *  back in after the stage — so a later stage sees the code earlier stages produced (the
 *  dependency-visibility mechanism). Returns the integration worktree dir + branch name. */
export function setupIntegration(opts: { repo: string; base: string; projectId: string; rootDir: string }): { dir: string; branch: string } {
  git(opts.repo, ['rev-parse', '--is-inside-work-tree']);
  if (opts.base === 'HEAD') ensureInitialCommit(opts.repo); // fresh-init repos have no commit to branch off
  mkdirSync(opts.rootDir, { recursive: true });
  const branch = `anchor/${slug(opts.projectId)}/integration`;
  const dir = join(opts.rootDir, '_integration');
  git(opts.repo, ['worktree', 'add', '-b', branch, dir, opts.base]);
  return { dir, branch };
}

/** Stage `git add -A` + commit in a feature worktree. Returns false (skips the commit) when the
 *  feature wrote nothing, so an empty feature doesn't create an empty commit. */
export function commitWorktree(dir: string, message: string): boolean {
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
  try {
    execFileSync('git', ['-C', dir, 'diff', '--cached', '--quiet']); // exit 0 → nothing staged
    return false;
  } catch {
    execFileSync('git', ['-C', dir, ...IDENT, 'commit', '-m', message, '--no-verify'], { stdio: 'ignore' });
    return true;
  }
}

/** Merge a feature branch into the integration branch (run in the integration worktree).
 *  Stage features are file-disjoint, so this should not conflict; a conflict throws (surfaced). */
export function mergeIntoIntegration(integDir: string, branch: string, message: string): void {
  execFileSync('git', ['-C', integDir, ...IDENT, 'merge', '--no-ff', '--no-edit', '-m', message, branch], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Remove a worktree (best-effort cleanup; never throws). */
export function removeWorktree(repo: string, dir: string): void {
  try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' }); } catch { /* best effort */ }
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
