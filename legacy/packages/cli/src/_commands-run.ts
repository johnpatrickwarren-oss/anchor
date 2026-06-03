// @anchor/cli — `anchor run`: drive ONE cycle (or resume a paused one) through the engine with
// the structural + green-test gates and an optional memorial.

import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import {
  runRound, runRoundFromDirective, resumeRound, MemorialStore,
  composeGates, grillingGate, antiScopeGate, testGate, npmTestRunner, seedBuiltinDisciplines,
} from '@anchor/core';
import type { RunResult, Tier } from '@anchor/core';
import { str, bool } from './args.ts';
import type { CliContext, Flags } from './_commands-shared.ts';
import {
  injectCapFrom, maxFixFrom, testCmdFrom, modelDriftGate,
  readDirective, persistIfPaused, maybePrune,
} from './_commands-shared.ts';
import { renderRun } from './_commands-render.ts';

// ── anchor run ──
export async function cmdRun(flags: Flags, ctx: CliContext): Promise<{ code: number; result?: RunResult }> {
  if (!bool(flags, 'mock') && !process.env.ANTHROPIC_API_KEY) {
    // Not a hard block: the Agent SDK can use Claude Code's existing auth (a logged-in
    // subscription). Only a bad/placeholder key actually breaks auth.
    ctx.stdout('note: no ANTHROPIC_API_KEY — using Claude Code\'s existing auth if present (export sk-ant-… to use an API key).');
  }
  const adapter = ctx.makeAdapter(flags);
  const safe = await modelDriftGate(flags, ctx);
  const memorialPath = str(flags, 'memorial');
  const memorial = memorialPath !== undefined ? new MemorialStore(ctx.makePersistence(memorialPath), { injectCap: injectCapFrom(flags) }) : undefined;
  if (memorial) seedBuiltinDisciplines(memorial); // ensure the discipline entries exist to accrue against
  // Structural gates (grilling + anti-scope) are ON by default as ADVISORY warnings;
  // --strict promotes them to blocking; --no-gates disables them. With a memorial, the gates
  // accrue V/C against the built-in disciplines (closing the learning loop), and the memorial's
  // applicable() rules are injected into role prompts by the engine.
  const strict = bool(flags, 'strict');
  const gateList = [
    grillingGate(undefined, strict, memorial ? { sink: memorial, memorialId: 'pre-emit-grilling' } : undefined),
    antiScopeGate({ blocking: strict, accrual: memorial ? { sink: memorial, memorialId: 'anti-scope' } : undefined }),
  ];
  // Green-test gate: BLOCKS the round on a red suite (deterministic; not advisory). The one
  // check we don't leave to a model's self-reported status. --no-test-gate / --mock skip it.
  if (!bool(flags, 'no-test-gate') && !bool(flags, 'mock')) {
    gateList.push(testGate({ run: npmTestRunner(str(flags, 'cwd') ?? ctx.cwd, testCmdFrom(flags)), accrual: memorial ? { sink: memorial, memorialId: 'tests-pass' } : undefined }));
  }
  const gates = bool(flags, 'no-gates') ? undefined : composeGates(...gateList);
  const roundId = str(flags, 'round') ?? 'R01';
  const deps = {
    adapter, memorial, gates,
    // The built-in gates accrue these; reviewer-signal accrual skips them (no double-count).
    gateOwnedMemorialIds: memorial && !bool(flags, 'no-gates') ? ['pre-emit-grilling', 'anti-scope', 'tests-pass'] : undefined,
    maxFixAttempts: maxFixFrom(flags),
  };
  const statePath = str(flags, 'state') ?? join(ctx.cwd, '.anchor', `round-${roundId}.json`);

  // ── resume a paused round (e.g. after a maxTurns pause: bump --maxTurns and resume) ──
  if (bool(flags, 'resume')) {
    let paused: RunResult;
    try { paused = JSON.parse(readFileSync(statePath, 'utf8')) as RunResult; }
    catch { ctx.stdout(`error: no paused round at ${statePath} — pass --state <path> or the matching --round`); return { code: 2 }; }
    const result = await resumeRound(paused, { answer: str(flags, 'answer') ?? 'operator resumed (turn budget raised)' }, deps);
    ctx.stdout(bool(flags, 'json') ? JSON.stringify(result, null, 2) : renderRun(result));
    persistIfPaused(result, statePath, ctx);
    maybePrune(memorial, flags, ctx);
    return { code: result.status === 'COMPLETE' ? 0 : 1, result };
  }

  const directiveFile = str(flags, 'directive');
  // Optional canonical spec path (threaded to Architect + gates). Resolve a relative path
  // against --cwd so the gates (which read from the engine's process cwd) hit the same file
  // the Architect wrote in the target repo.
  const runCwd = str(flags, 'cwd');
  let specPath = str(flags, 'spec');
  if (specPath && runCwd && !isAbsolute(specPath)) specPath = join(runCwd, specPath);
  let result: RunResult;
  if (directiveFile || (str(flags, 'task') && !str(flags, 'tier'))) {
    const directive = readDirective(flags)!;
    result = await runRoundFromDirective(directive, deps, { roundId, runDate: ctx.now(), task: str(flags, 'task'), tierOverride: str(flags, 'tier') as Tier | undefined, specPath, riskAdapt: !bool(flags, 'no-risk-adapt'), safe });
  } else {
    const tier = (str(flags, 'tier') as Tier) || 'audit';
    const task = str(flags, 'task');
    if (!task) { ctx.stdout('error: provide --task "<text>" (and optionally --tier), or --directive <file>'); return { code: 2 }; }
    result = await runRound({ roundId, tier, task, runDate: ctx.now(), specPath }, deps);
  }
  ctx.stdout(bool(flags, 'json') ? JSON.stringify(result, null, 2) : renderRun(result));
  persistIfPaused(result, statePath, ctx);
  maybePrune(memorial, flags, ctx);
  return { code: result.status === 'COMPLETE' ? 0 : 1, result };
}
