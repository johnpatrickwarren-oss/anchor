// @anchor/cli — shared command infrastructure: the injected CliContext, flag→option helpers,
// the model-drift safety gate, per-cycle EngineDeps builders, and the persist/prune side-helpers.
// Every command module imports from here; cli.ts/commands.ts re-export the public surface.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  MockRuntimeAdapter, MemorialStore, MemoryPersistence, JsonFilePersistence,
  composeGates, grillingGate, antiScopeGate, testGate, npmTestRunner,
  checkModelDrift,
} from '@anchor/core';
import type { RuntimeAdapter, RunResult, MemorialPersistence, EngineDeps, WaveItem } from '@anchor/core';
import { AgentSdkAdapter, listAvailableModels } from '@anchor/runtime-agent-sdk';
import { str, bool } from './args.ts';

export interface CliContext {
  cwd: string;
  now: () => string; // date provider (injectable for deterministic tests)
  stdout: (s: string) => void;
  makeAdapter: (flags: Flags) => RuntimeAdapter;
  makePersistence: (path?: string) => MemorialPersistence;
  // Lists the models the API currently offers (for drift detection). Injectable for tests.
  listModels: () => Promise<string[]>;
}
export type Flags = Record<string, string | boolean>;

// Default per-round injected-rule cap — the memorial stays self-limiting out of the box.
// `--max-rules N` overrides; `--max-rules 0` (or any non-positive) injects all eligible.
const DEFAULT_INJECT_CAP = 12;
export function injectCapFrom(flags: Flags): number | undefined {
  const v = str(flags, 'max-rules');
  if (v === undefined) return DEFAULT_INJECT_CAP;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// --max-fix <n>: extra remediation attempts for a code-producing role whose gates fail
// (re-run with the findings, re-check). Undefined → engine default (2); 0 disables.
export function maxFixFrom(flags: Flags): number | undefined {
  const v = str(flags, 'max-fix');
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// --test-cmd "<command>": the command the green-test gate runs (whitespace-split argv).
// Lets the operator point the gate at a FAST/incremental command (e.g. "npm run test:fast")
// instead of the default `npm test` clean rebuild — the biggest gate-latency lever.
export function testCmdFrom(flags: Flags): string[] | undefined {
  const v = str(flags, 'test-cmd');
  if (!v) return undefined;
  const parts = v.trim().split(/\s+/);
  return parts.length ? parts : undefined;
}

// Best-effort model-drift check on startup: if the API offers a model the routing labels were
// never grounded against, WARN and over-provision (safe routing — full tier + opus) until the
// oracle re-grounds. Never blocks real work: skipped on --mock / --no-model-check / no key, and
// any failure (offline, API error) degrades to a note + normal routing. Returns the safe flag.
export async function modelDriftGate(flags: Flags, ctx: CliContext): Promise<boolean> {
  if (bool(flags, 'mock') || bool(flags, 'no-model-check') || !process.env.ANTHROPIC_API_KEY) return false;
  try {
    const drift = checkModelDrift(await ctx.listModels());
    if (!drift.drifted) return false;
    ctx.stdout(`⚠ model drift: ${drift.newModels.join(', ')} not in the routing labels (grounded ${drift.groundedDate}). ` +
      'Routing CONSERVATIVELY (full tier + opus) until re-grounded — run `anchor calibrate`, then the oracle grid. (--no-model-check to skip.)');
    return true;
  } catch (e) {
    ctx.stdout(`note: model-drift check skipped (${(e as Error).message}); routing normally.`);
    return false;
  }
}

export function defaultContext(): CliContext {
  return {
    cwd: process.cwd(),
    now: () => new Date().toISOString().slice(0, 10),
    stdout: (s) => console.log(s),
    makeAdapter: (flags) => bool(flags, 'mock')
      ? new MockRuntimeAdapter()
      // --maxTurns sets a FLAT cap across roles (handy for resume); without it, the
      // adapter's per-role budgets apply (implementer gets the most; memorial the least).
      : new AgentSdkAdapter({ cwd: str(flags, 'cwd') ?? process.cwd(), maxTurns: str(flags, 'maxTurns') ? Number(str(flags, 'maxTurns')) : undefined, permissionMode: 'acceptEdits' }),
    makePersistence: (path) => path ? new JsonFilePersistence(path) : new MemoryPersistence(),
    listModels: () => listAvailableModels(),
  };
}

export function readDirective(flags: Flags): string | undefined {
  const file = str(flags, 'directive');
  if (file) return readFileSync(file, 'utf8');
  return str(flags, 'task');
}

// Persist a PAUSED run's full result so `anchor run --resume` can pick it up later.
export function persistIfPaused(result: RunResult, statePath: string, ctx: CliContext): void {
  if (result.status !== 'PAUSED') return;
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(result, null, 2));
    ctx.stdout(`paused state saved → ${statePath}\n  resume with: anchor run --resume --state ${statePath} [--maxTurns <higher>]`);
  } catch (e) {
    ctx.stdout(`warning: could not save paused state to ${statePath}: ${(e as Error).message}`);
  }
}

// Auto-prune after a run/wave so the memorial stays bounded: a fully-internalized rule
// (≥ retireAt confirmations, 0 violations) retires and stops injecting; well-confirmed
// rules stabilize. Skipped with --no-prune. Surfaces what changed.
export function maybePrune(memorial: MemorialStore | undefined, flags: Flags, ctx: CliContext): void {
  if (!memorial || bool(flags, 'no-prune')) return;
  const { stabilized, retired } = memorial.prune(ctx.now());
  if (stabilized.length || retired.length) {
    ctx.stdout(`memorial pruned — stabilized: ${stabilized.join(', ') || '—'}; retired: ${retired.join(', ') || '—'}`);
  }
}

// Build per-feature/per-item EngineDeps (advisory structural gates, a green-test gate scoped to
// the given cwd, the shared memorial). Used by cmdWave's depsFor and cmdProject's featureCycleDeps.
export function cycleDeps(
  ctx: CliContext, flags: Flags, cwd: string | undefined,
  memorial: MemorialStore | undefined, strict: boolean, noGates: boolean, testGateOn: boolean,
): EngineDeps {
  const gateList = [
    grillingGate(undefined, strict, memorial ? { sink: memorial, memorialId: 'pre-emit-grilling' } : undefined),
    antiScopeGate({ blocking: strict, accrual: memorial ? { sink: memorial, memorialId: 'anti-scope' } : undefined }),
  ];
  if (testGateOn && cwd) gateList.push(testGate({ run: npmTestRunner(cwd, testCmdFrom(flags)), accrual: memorial ? { sink: memorial, memorialId: 'tests-pass' } : undefined }));
  return {
    adapter: ctx.makeAdapter(cwd ? { ...flags, cwd } : flags),
    gates: noGates ? undefined : composeGates(...gateList),
    memorial,
    gateOwnedMemorialIds: memorial && !noGates ? ['pre-emit-grilling', 'anti-scope', 'tests-pass'] : undefined,
    maxFixAttempts: maxFixFrom(flags),
  };
}

export type { WaveItem };
