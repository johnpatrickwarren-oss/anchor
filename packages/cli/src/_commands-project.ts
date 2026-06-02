// @anchor/cli — `anchor project`: decompose a project directive into features, then run them in
// dependency-aware stages (independent features concurrent; dependents sequenced after). One
// directive in → Coordinator decomposes → staged waves out, each feature self-routing its tier.

import { join } from 'node:path';
import {
  runWave, MemorialStore, seedBuiltinDisciplines,
  decompose, runProject, planStages, renderStages,
} from '@anchor/core';
import type { WaveResult, Stage, ProjectResult } from '@anchor/core';
import { str, bool } from './args.ts';
import { createWorktrees, slug, setupIntegration, commitWorktree, mergeIntoIntegration, removeWorktree, discardPaths } from './worktree.ts';
import type { WorktreeSpec } from './worktree.ts';
import type { CliContext, Flags } from './_commands-shared.ts';
import {
  injectCapFrom, modelDriftGate, readDirective, maybePrune, cycleDeps,
} from './_commands-shared.ts';
import { renderProject } from './_commands-render.ts';

// Orchestrator-owned files: features must not change project config, or their independent
// edits collide at merge (the v1 failure: each feature rewrote package.json's test script).
// Reverted in each feature worktree before commit, so they never enter the merge.
const PROTECTED_FILES = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'pnpm-lock.yaml', 'package-lock.json'];

// Prepended to each feature's directive so the implementer stays in its lane. (Not the barrel:
// src/index.ts may legitimately be a feature's own deliverable.)
const FEATURE_CONSTRAINT =
  'Scope rule: implement ONLY this feature\'s own source + test files under src/. Do NOT modify ' +
  'package.json, tsconfig, or lockfiles — the project orchestrator owns configuration and the ' +
  'scaffolded `npm test` already runs the suite. Do NOT edit files owned by other features.\n\n';

export async function cmdProject(flags: Flags, ctx: CliContext): Promise<{ code: number; project?: ProjectResult }> {
  const directive = readDirective(flags);
  if (!directive) { ctx.stdout('error: provide --directive <file> or --task "<text>" (the project brief)'); return { code: 2 }; }
  const mock = bool(flags, 'mock');
  if (!mock && !process.env.ANTHROPIC_API_KEY) {
    ctx.stdout('note: no ANTHROPIC_API_KEY — using Claude Code\'s existing auth if present (export sk-ant-… to use an API key).');
  }
  const projectId = str(flags, 'project-id') ?? 'PRJ';
  const safe = await modelDriftGate(flags, ctx);
  // The project repo — also the Coordinator's cwd, so it decomposes pointed at the TARGET repo
  // (small/greenfield), not anchor's own process dir (where it would wander a large codebase).
  const repo = str(flags, 'repo') ?? str(flags, 'cwd') ?? ctx.cwd;

  // 1) Decompose: run the Coordinator to turn the directive into features.
  let features;
  try { features = await decompose(ctx.makeAdapter({ ...flags, cwd: repo }), directive); }
  catch (e) { ctx.stdout(`error: decomposition failed — ${(e as Error).message}`); return { code: 1 }; }

  // 2) Stage: topologically group into dependency levels (fails loud on cycles/bad refs).
  let stages: Stage[];
  try { stages = planStages(features); }
  catch (e) { ctx.stdout(`error: invalid plan — ${(e as Error).message}`); return { code: 1 }; }
  const json = bool(flags, 'json');
  if (!json) ctx.stdout(`decomposed "${projectId}" → ${features.length} feature(s) in ${stages.length} stage(s):\n${renderStages(stages)}`);

  if (bool(flags, 'dry-run')) {
    if (json) ctx.stdout(JSON.stringify({ projectId, features, stages }, null, 2)); // pure JSON for piping
    return { code: 0 };
  }

  // Shared memorial across the whole project (one learning loop for all features/stages).
  const memorialPath = str(flags, 'memorial');
  const memorial = memorialPath ? new MemorialStore(ctx.makePersistence(memorialPath), { injectCap: injectCapFrom(flags) }) : undefined;
  if (memorial) seedBuiltinDisciplines(memorial);
  const strict = bool(flags, 'strict');
  const noGates = bool(flags, 'no-gates');
  const testGateOn = !bool(flags, 'no-test-gate') && !mock;
  const concurrency = Number(str(flags, 'concurrency')) || undefined;

  // 3) Per-stage runner. Live: one worktree per feature off the integration branch, then
  //    commit + merge each completed feature back so the NEXT stage sees its code. Mock:
  //    in-process (no git), since mock writes no files and only the sequencing is exercised.
  let integration: { dir: string; branch: string } | undefined;
  let runStage: (stage: Stage, i: number) => Promise<WaveResult>;

  if (mock) {
    runStage = (stage, i) => runWave(
      stage.map((f) => ({ id: f.id, directive: FEATURE_CONSTRAINT + f.directive })),
      () => cycleDeps(ctx, flags, str(flags, 'cwd'), memorial, strict, noGates, false),
      { waveId: `${projectId}-s${i + 1}`, runDate: ctx.now(), concurrency, safe },
    );
  } else {
    const base = str(flags, 'base') ?? 'HEAD';
    const root = join(repo, '.anchor', 'projects', slug(projectId));
    try { integration = setupIntegration({ repo, base, projectId, rootDir: root }); }
    catch (e) { ctx.stdout(`error: could not set up integration worktree in ${repo}: ${(e as Error).message}`); return { code: 2 }; }
    runStage = async (stage, i) => {
      const ids = stage.map((f) => f.id);
      let worktrees: WorktreeSpec[];
      try { worktrees = createWorktrees({ repo, base: integration!.branch, waveId: `${projectId}-s${i + 1}`, ids, rootDir: join(root, `stage-${i + 1}`) }); }
      catch (e) { ctx.stdout(`stage ${i + 1}: could not create worktrees — ${(e as Error).message}`); return { waveId: `${projectId}-s${i + 1}`, rounds: [], status: 'PARTIAL' }; }
      const byId = Object.fromEntries(worktrees.map((w) => [w.itemId, w]));
      const wave = await runWave(
        stage.map((f) => ({ id: f.id, directive: FEATURE_CONSTRAINT + f.directive, cwd: byId[f.id].dir })),
        (item) => cycleDeps(ctx, flags, item.cwd, memorial, strict, noGates, testGateOn),
        { waveId: `${projectId}-s${i + 1}`, runDate: ctx.now(), concurrency, safe },
      );
      // Only fold a stage into integration if every feature completed — a partial stage stops
      // the project (runProject), and we don't want half-built code on the integration branch.
      if (wave.status === 'COMPLETE') {
        for (const f of stage) {
          const w = byId[f.id];
          discardPaths(w.dir, PROTECTED_FILES); // revert any edits to orchestrator-owned config so merges can't conflict on them
          commitWorktree(w.dir, `feat(${f.id}): ${f.directive}`.slice(0, 72));
          if (!mergeIntoIntegration(integration!.dir, w.branch, `anchor: merge ${f.id}`)) {
            ctx.stdout(`stage ${i + 1}: merge of ${f.id} hit an unresolved conflict — stopping (integration left clean).`);
            return { ...wave, status: 'PARTIAL' };
          }
        }
      }
      for (const w of worktrees) removeWorktree(repo, w.dir);
      return wave;
    };
  }

  const project = await runProject(features, runStage, { projectId });
  ctx.stdout(json ? JSON.stringify(project, null, 2) : renderProject(project));
  // Human-only trailer — kept OUT of --json so the JSON output stays pure/pipeable.
  if (integration && !json) ctx.stdout(`integration: branch ${integration.branch} (worktree ${integration.dir}) — review / PR this; per-feature branches retained.`);
  maybePrune(memorial, flags, ctx);
  return { code: project.status === 'COMPLETE' ? 0 : 1, project };
}
