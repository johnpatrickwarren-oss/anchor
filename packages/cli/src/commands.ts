// @anchor/cli — command handlers. Dependency-injected (adapter, persistence, clock, stdout)
// so every command is unit-testable offline; cli.ts wires the real defaults.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import {
  runRound, runRoundFromDirective, resumeRound, runWave, MockRuntimeAdapter, MemorialStore, MemoryPersistence, JsonFilePersistence, routeRound,
  composeGates, grillingGate, antiScopeGate, testGate, npmTestRunner, seedBuiltinDisciplines,
} from '@anchor/core';
import type { RuntimeAdapter, RunResult, Tier, MemorialPersistence, RouteResult, WaveItem, WaveResult } from '@anchor/core';
import { AgentSdkAdapter } from '@anchor/runtime-agent-sdk';
import { str, bool } from './args.ts';
import { createWorktrees, slug } from './worktree.ts';
import type { WorktreeSpec } from './worktree.ts';

export interface CliContext {
  cwd: string;
  now: () => string; // date provider (injectable for deterministic tests)
  stdout: (s: string) => void;
  makeAdapter: (flags: Flags) => RuntimeAdapter;
  makePersistence: (path?: string) => MemorialPersistence;
}
type Flags = Record<string, string | boolean>;

// Default per-round injected-rule cap — the memorial stays self-limiting out of the box.
// `--max-rules N` overrides; `--max-rules 0` (or any non-positive) injects all eligible.
const DEFAULT_INJECT_CAP = 12;
function injectCapFrom(flags: Flags): number | undefined {
  const v = str(flags, 'max-rules');
  if (v === undefined) return DEFAULT_INJECT_CAP;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// --max-fix <n>: extra remediation attempts for a code-producing role whose gates fail
// (re-run with the findings, re-check). Undefined → engine default (2); 0 disables.
function maxFixFrom(flags: Flags): number | undefined {
  const v = str(flags, 'max-fix');
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
  };
}

function readDirective(flags: Flags): string | undefined {
  const file = str(flags, 'directive');
  if (file) return readFileSync(file, 'utf8');
  return str(flags, 'task');
}

export function renderRoute(r: RouteResult): string {
  const ov = Object.entries(r.modelOverrides).map(([role, m]) => `  ${role} -> ${m}`).join('\n') || '  (role defaults)';
  return `tier: ${r.tier}  (${r.classification.confidence} — ${r.classification.matched})\nmodel overrides:\n${ov}`;
}

export function renderRun(r: RunResult): string {
  const rows = r.phases.map((p) => `  ${p.role.padEnd(12)} ${p.model.padEnd(28)} ${p.status.padEnd(9)} out=${p.usage.output} cache_rd=${p.usage.cache_read}`).join('\n');
  const warn = r.warnings.length ? `\nwarnings (advisory; --strict to block):\n${r.warnings.map((w) => `  ⚠ ${w}`).join('\n')}` : '';
  // PAUSED is recoverable operator state (e.g. an escalation or a turn-budget exhaustion):
  // surface why + how to resume, rather than letting it read like a silent stop.
  const paused = r.status === 'PAUSED'
    ? `\npaused at: ${r.pausedAt ?? '?'}${r.escalation ? `\n  ↳ ${r.escalation.question}` : ''}\n  resume with a higher --maxTurns (or resolve the escalation) to continue.`
    : '';
  return `round ${r.roundId} [${r.tier}] -> ${r.status}\n${rows}${warn}${paused}\n${r.CAVEAT}`;
}

// ── anchor route ──
export async function cmdRoute(flags: Flags, ctx: CliContext): Promise<{ code: number; route?: RouteResult }> {
  const directive = readDirective(flags);
  if (!directive) { ctx.stdout('error: provide --directive <file> or --task "<text>"'); return { code: 2 }; }
  const route = routeRound(directive, { tierOverride: str(flags, 'tier') as Tier | undefined });
  ctx.stdout(renderRoute(route));
  return { code: 0, route };
}

// ── anchor run ──
export async function cmdRun(flags: Flags, ctx: CliContext): Promise<{ code: number; result?: RunResult }> {
  if (!bool(flags, 'mock') && !process.env.ANTHROPIC_API_KEY) {
    // Not a hard block: the Agent SDK can use Claude Code's existing auth (a logged-in
    // subscription). Only a bad/placeholder key actually breaks auth.
    ctx.stdout('note: no ANTHROPIC_API_KEY — using Claude Code\'s existing auth if present (export sk-ant-… to use an API key).');
  }
  const adapter = ctx.makeAdapter(flags);
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
    gateList.push(testGate({ run: npmTestRunner(str(flags, 'cwd') ?? ctx.cwd), accrual: memorial ? { sink: memorial, memorialId: 'tests-pass' } : undefined }));
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
    result = await runRoundFromDirective(directive, deps, { roundId, runDate: ctx.now(), task: str(flags, 'task'), tierOverride: str(flags, 'tier') as Tier | undefined, specPath, riskAdapt: !bool(flags, 'no-risk-adapt') });
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

// Persist a PAUSED run's full result so `anchor run --resume` can pick it up later.
function persistIfPaused(result: RunResult, statePath: string, ctx: CliContext): void {
  if (result.status !== 'PAUSED') return;
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(result, null, 2));
    ctx.stdout(`paused state saved → ${statePath}\n  resume with: anchor run --resume --state ${statePath} [--maxTurns <higher>]`);
  } catch (e) {
    ctx.stdout(`warning: could not save paused state to ${statePath}: ${(e as Error).message}`);
  }
}

// ── anchor wave ── fan out independent cycles concurrently.
export function renderWave(w: WaveResult): string {
  const rows = w.rounds.map((r) => {
    const roles = r.result.phases.map((p) => `${p.role}:${p.status}`).join(' ') || '(no phases)';
    return `  ${r.itemId.padEnd(18)} [${r.result.tier}] ${r.result.status.padEnd(9)} ${roles}`;
  }).join('\n');
  return `wave ${w.waveId} -> ${w.status}  (${w.rounds.length} item(s))\n${rows}`;
}

export async function cmdWave(flags: Flags, ctx: CliContext): Promise<{ code: number; wave?: WaveResult }> {
  const planPath = str(flags, 'plan');
  if (!planPath) {
    ctx.stdout('error: anchor wave requires --plan <file> (JSON: { items: [{ id, task|directive|directiveFile, tier?, cwd? }] })');
    return { code: 2 };
  }
  let plan: { waveId?: string; concurrency?: number; items?: Array<Record<string, unknown>> };
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); }
  catch (e) { ctx.stdout(`error: cannot read plan ${planPath}: ${(e as Error).message}`); return { code: 2 }; }

  const raw = plan.items ?? [];
  if (raw.length === 0) { ctx.stdout('error: plan has no items'); return { code: 2 }; }
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

  // Auto-worktree: with --repo, create one git worktree + branch per item off --base
  // (default HEAD) and route each item there — no hand-assigned cwds, and each item's work
  // lands on its own branch for review/PR.
  let worktrees: WorktreeSpec[] = [];
  const repo = str(flags, 'repo');
  if (repo) {
    const base = str(flags, 'base') ?? 'HEAD';
    const rootDir = str(flags, 'worktree-dir') ?? join(repo, '.anchor', 'worktrees', slug(waveId));
    try {
      worktrees = createWorktrees({ repo, base, waveId, ids: items.map((i) => i.id), rootDir });
    } catch (e) {
      ctx.stdout(`error: could not create worktrees in ${repo}: ${(e as Error).message}`);
      return { code: 2 };
    }
    const byId = Object.fromEntries(worktrees.map((w) => [w.itemId, w]));
    for (const it of items) it.cwd = byId[it.id].dir;
  }

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
      return { code: 2 };
    }
  }

  const memorialPath = str(flags, 'memorial');
  const memorial = memorialPath ? new MemorialStore(ctx.makePersistence(memorialPath), { injectCap: injectCapFrom(flags) }) : undefined;
  if (memorial) seedBuiltinDisciplines(memorial);
  const strict = bool(flags, 'strict');
  const noGates = bool(flags, 'no-gates');
  // ONE shared memorial instance across items: Node is single-threaded and each accrual is
  // a synchronous body, so concurrent record() calls on a single instance are safe (counts
  // are commutative, no interleaved corruption). Separate instances on one file would
  // last-writer-win and lose accruals.
  const testGateOn = !bool(flags, 'no-test-gate') && !bool(flags, 'mock');
  const depsFor = (item: WaveItem) => {
    const cwd = item.cwd ?? str(flags, 'cwd');
    const gateList = [
      grillingGate(undefined, strict, memorial ? { sink: memorial, memorialId: 'pre-emit-grilling' } : undefined),
      antiScopeGate({ blocking: strict, accrual: memorial ? { sink: memorial, memorialId: 'anti-scope' } : undefined }),
    ];
    // Green-test gate per item: a red suite blocks that item (→ wave PARTIAL), so a buggy
    // feature can't come back COMPLETE. Runs in the item's own cwd/worktree.
    if (testGateOn && cwd) gateList.push(testGate({ run: npmTestRunner(cwd), accrual: memorial ? { sink: memorial, memorialId: 'tests-pass' } : undefined }));
    return {
      adapter: ctx.makeAdapter({ ...flags, cwd }),
      gates: noGates ? undefined : composeGates(...gateList),
      memorial,
      gateOwnedMemorialIds: memorial && !noGates ? ['pre-emit-grilling', 'anti-scope', 'tests-pass'] : undefined,
      maxFixAttempts: maxFixFrom(flags),
    };
  };

  const wave = await runWave(items, depsFor, {
    waveId,
    runDate: ctx.now(),
    concurrency: Number(str(flags, 'concurrency')) || plan.concurrency || undefined,
  });
  ctx.stdout(bool(flags, 'json') ? JSON.stringify(wave, null, 2) : renderWave(wave));
  if (worktrees.length && !bool(flags, 'json')) {
    ctx.stdout('worktrees (review / commit / PR each):\n' + worktrees.map((w) => `  ${w.itemId.padEnd(18)} ${w.branch}  ${w.dir}`).join('\n'));
  }
  maybePrune(memorial, flags, ctx);
  return { code: wave.status === 'COMPLETE' ? 0 : 1, wave };
}

// Auto-prune after a run/wave so the memorial stays bounded: a fully-internalized rule
// (≥ retireAt confirmations, 0 violations) retires and stops injecting; well-confirmed
// rules stabilize. Skipped with --no-prune. Surfaces what changed.
function maybePrune(memorial: MemorialStore | undefined, flags: Flags, ctx: CliContext): void {
  if (!memorial || bool(flags, 'no-prune')) return;
  const { stabilized, retired } = memorial.prune(ctx.now());
  if (stabilized.length || retired.length) {
    ctx.stdout(`memorial pruned — stabilized: ${stabilized.join(', ') || '—'}; retired: ${retired.join(', ') || '—'}`);
  }
}

// ── anchor memorial <list|ratios|prune> ──
export async function cmdMemorial(sub: string, flags: Flags, ctx: CliContext): Promise<{ code: number; data?: unknown }> {
  const store = new MemorialStore(ctx.makePersistence(str(flags, 'memorial')));
  if (sub === 'list') { const data = store.list(); ctx.stdout(JSON.stringify(data, null, 2)); return { code: 0, data }; }
  if (sub === 'ratios') {
    const data = store.ratios();
    ctx.stdout(data.map((r) => `${r.healthy ? '✓' : '✗'} ${r.id}  V=${r.v} C=${r.c}  ${r.status}`).join('\n') || '(no entries)');
    return { code: 0, data };
  }
  if (sub === 'prune') { const data = store.prune(ctx.now()); ctx.stdout(`stabilized: ${data.stabilized.join(', ') || '—'}\nretired: ${data.retired.join(', ') || '—'}`); return { code: 0, data }; }
  if (sub === 'add') {
    const id = str(flags, 'id'); const rule = str(flags, 'rule');
    if (!id || !rule) { ctx.stdout('error: memorial add requires --id and --rule (optional --trigger, --origin)'); return { code: 2 }; }
    try { store.add({ id, rule, trigger: str(flags, 'trigger') ?? '', origin: str(flags, 'origin') ?? 'operator' }); }
    catch (e) { ctx.stdout(`error: ${(e as Error).message}`); return { code: 2 }; }
    ctx.stdout(`added memorial "${id}"`);
    return { code: 0, data: store.list() };
  }
  ctx.stdout(`error: unknown memorial subcommand "${sub}" (use list|ratios|prune|add)`);
  return { code: 2 };
}
