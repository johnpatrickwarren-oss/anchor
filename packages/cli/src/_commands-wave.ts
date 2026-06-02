// @anchor/cli — `anchor wave`: fan out independent cycles concurrently. The orchestrator
// (cmdWave) is decomposed into contiguous, behavior-preserving steps: parse the plan, optionally
// auto-create one worktree per item (--repo), resolve/guard each item's cwd, then build the
// shared-memorial deps and run the wave.

import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { runWave, MemorialStore, seedBuiltinDisciplines } from '@anchor/core';
import type { Tier, WaveItem, WaveResult } from '@anchor/core';
import { str, bool } from './args.ts';
import { createWorktrees, slug } from './worktree.ts';
import type { WorktreeSpec } from './worktree.ts';
import type { CliContext, Flags } from './_commands-shared.ts';
import {
  injectCapFrom, modelDriftGate, maybePrune, cycleDeps,
} from './_commands-shared.ts';
import { renderWave } from './_commands-render.ts';

// Parse + validate the --plan file into wave items and a wave id. Returns the operator-facing
// error code on a bad/empty/unreadable plan (caller surfaces it), else the parsed wave.
type ParsedPlan =
  | { ok: false; code: number }
  | { ok: true; items: WaveItem[]; waveId: string; plan: { waveId?: string; concurrency?: number; items?: Array<Record<string, unknown>> } };

function parseWavePlan(flags: Flags, ctx: CliContext): ParsedPlan {
  const planPath = str(flags, 'plan');
  if (!planPath) {
    ctx.stdout('error: anchor wave requires --plan <file> (JSON: { items: [{ id, task|directive|directiveFile, tier?, cwd? }] })');
    return { ok: false, code: 2 };
  }
  let plan: { waveId?: string; concurrency?: number; items?: Array<Record<string, unknown>> };
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); }
  catch (e) { ctx.stdout(`error: cannot read plan ${planPath}: ${(e as Error).message}`); return { ok: false, code: 2 }; }

  const raw = plan.items ?? [];
  if (raw.length === 0) { ctx.stdout('error: plan has no items'); return { ok: false, code: 2 }; }
  const waveId = plan.waveId ?? str(flags, 'wave-id') ?? 'W01';

  const items: WaveItem[] = raw.map((it) => ({
    id: String(it.id),
    directive: typeof it.directiveFile === 'string' ? readFileSync(it.directiveFile, 'utf8')
      : typeof it.directive === 'string' ? it.directive : undefined,
    task: typeof it.task === 'string' ? it.task : undefined,
    tier: it.tier as Tier | undefined,
    specPath: typeof it.specPath === 'string' ? it.specPath : undefined,
    cwd: typeof it.cwd === 'string' ? it.cwd : undefined,
  }));
  return { ok: true, items, waveId, plan };
}

// Auto-worktree: with --repo, create one git worktree + branch per item off --base (default HEAD)
// and route each item there — no hand-assigned cwds, and each item's work lands on its own branch
// for review/PR. Mutates items' cwd in place. Returns the created worktrees, or an error code.
function setupWaveWorktrees(items: WaveItem[], waveId: string, flags: Flags, ctx: CliContext):
  { ok: true; worktrees: WorktreeSpec[] } | { ok: false; code: number } {
  const repo = str(flags, 'repo');
  if (!repo) return { ok: true, worktrees: [] };
  const base = str(flags, 'base') ?? 'HEAD';
  const rootDir = str(flags, 'worktree-dir') ?? join(repo, '.anchor', 'worktrees', slug(waveId));
  let worktrees: WorktreeSpec[];
  try {
    worktrees = createWorktrees({ repo, base, waveId, ids: items.map((i) => i.id), rootDir });
  } catch (e) {
    ctx.stdout(`error: could not create worktrees in ${repo}: ${(e as Error).message}`);
    return { ok: false, code: 2 };
  }
  const byId = Object.fromEntries(worktrees.map((w) => [w.itemId, w]));
  for (const it of items) it.cwd = byId[it.id].dir;
  return { ok: true, worktrees };
}

// Resolve each item's specPath against ITS OWN cwd, then enforce the live-run isolation guard.
// Returns an error code if concurrent live items would share a working dir; else null (proceed).
function prepareWaveItems(items: WaveItem[], flags: Flags, ctx: CliContext): number | null {
  // Resolve each item's specPath against ITS OWN cwd so the Architect (writes) and the
  // gates (read, from the engine's process cwd) hit the same file. A relative specPath
  // would otherwise be read from the anchor process dir, not the item's worktree — which
  // silently no-ops gate-based accrual for worktree items.
  for (const it of items) {
    if (it.specPath && it.cwd && !isAbsolute(it.specPath)) it.specPath = join(it.cwd, it.specPath);
  }

  // Isolation guard (live runs only): concurrent acceptEdits items sharing a working dir
  // would stomp each other. Refuse unless every item has its own cwd (auto-satisfied by
  // --repo worktrees). --mock can't edit files, so it's exempt.
  if (!bool(flags, 'mock')) {
    const cwds = items.map((i) => i.cwd ?? '(unset)');
    const dupes = [...new Set(cwds.filter((c, i) => cwds.indexOf(c) !== i))];
    if (dupes.length) {
      ctx.stdout(`error: wave items share a working dir (${dupes.join(', ')}); pass --repo to auto-create a worktree per item, or give each its own "cwd"`);
      return 2;
    }
  }
  return null;
}

// Build the shared memorial and a per-item EngineDeps factory (one shared memorial instance
// across items: Node is single-threaded and each accrual is synchronous, so concurrent record()
// calls on one instance are safe — counts are commutative. Separate instances on one file would
// last-writer-win and lose accruals).
function buildWaveDeps(flags: Flags, ctx: CliContext): {
  memorial: MemorialStore | undefined; depsFor: (item: WaveItem) => ReturnType<typeof cycleDeps>;
} {
  const memorialPath = str(flags, 'memorial');
  const memorial = memorialPath ? new MemorialStore(ctx.makePersistence(memorialPath), { injectCap: injectCapFrom(flags) }) : undefined;
  if (memorial) seedBuiltinDisciplines(memorial);
  const strict = bool(flags, 'strict');
  const noGates = bool(flags, 'no-gates');
  const testGateOn = !bool(flags, 'no-test-gate') && !bool(flags, 'mock');
  const depsFor = (item: WaveItem) =>
    cycleDeps(ctx, flags, item.cwd ?? str(flags, 'cwd'), memorial, strict, noGates, testGateOn);
  return { memorial, depsFor };
}

export async function cmdWave(flags: Flags, ctx: CliContext): Promise<{ code: number; wave?: WaveResult }> {
  const parsed = parseWavePlan(flags, ctx);
  if (!parsed.ok) return { code: parsed.code };
  const { items, waveId, plan } = parsed;

  const wt = setupWaveWorktrees(items, waveId, flags, ctx);
  if (!wt.ok) return { code: wt.code };
  const worktrees = wt.worktrees;

  const guardCode = prepareWaveItems(items, flags, ctx);
  if (guardCode !== null) return { code: guardCode };

  const { memorial, depsFor } = buildWaveDeps(flags, ctx);

  const wave = await runWave(items, depsFor, {
    waveId,
    runDate: ctx.now(),
    concurrency: Number(str(flags, 'concurrency')) || plan.concurrency || undefined,
    safe: await modelDriftGate(flags, ctx),
  });
  ctx.stdout(bool(flags, 'json') ? JSON.stringify(wave, null, 2) : renderWave(wave));
  if (worktrees.length && !bool(flags, 'json')) {
    ctx.stdout('worktrees (review / commit / PR each):\n' + worktrees.map((w) => `  ${w.itemId.padEnd(18)} ${w.branch}  ${w.dir}`).join('\n'));
  }
  maybePrune(memorial, flags, ctx);
  return { code: wave.status === 'COMPLETE' ? 0 : 1, wave };
}
