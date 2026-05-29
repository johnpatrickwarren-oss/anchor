// @anchor/cli — command handlers. Dependency-injected (adapter, persistence, clock, stdout)
// so every command is unit-testable offline; cli.ts wires the real defaults.

import { readFileSync } from 'node:fs';
import {
  runRound, runRoundFromDirective, MockRuntimeAdapter, MemorialStore, MemoryPersistence, JsonFilePersistence, routeRound,
  composeGates, grillingGate, antiScopeGate, seedBuiltinDisciplines,
} from '@anchor/core';
import type { RuntimeAdapter, RunResult, Tier, MemorialPersistence, RouteResult } from '@anchor/core';
import { AgentSdkAdapter } from '@anchor/runtime-agent-sdk';
import { str, bool } from './args.ts';

export interface CliContext {
  cwd: string;
  now: () => string; // date provider (injectable for deterministic tests)
  stdout: (s: string) => void;
  makeAdapter: (flags: Flags) => RuntimeAdapter;
  makePersistence: (path?: string) => MemorialPersistence;
}
type Flags = Record<string, string | boolean>;

export function defaultContext(): CliContext {
  return {
    cwd: process.cwd(),
    now: () => new Date().toISOString().slice(0, 10),
    stdout: (s) => console.log(s),
    makeAdapter: (flags) => bool(flags, 'mock')
      ? new MockRuntimeAdapter()
      : new AgentSdkAdapter({ cwd: str(flags, 'cwd') ?? process.cwd(), maxTurns: Number(str(flags, 'maxTurns')) || 40, permissionMode: 'acceptEdits' }),
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
  const memorial = memorialPath !== undefined ? new MemorialStore(ctx.makePersistence(memorialPath)) : undefined;
  if (memorial) seedBuiltinDisciplines(memorial); // ensure the discipline entries exist to accrue against
  // Structural gates (grilling + anti-scope) are ON by default as ADVISORY warnings;
  // --strict promotes them to blocking; --no-gates disables them. With a memorial, the gates
  // accrue V/C against the built-in disciplines (closing the learning loop), and the memorial's
  // applicable() rules are injected into role prompts by the engine.
  const strict = bool(flags, 'strict');
  const gates = bool(flags, 'no-gates') ? undefined : composeGates(
    grillingGate(undefined, strict, memorial ? { sink: memorial, memorialId: 'pre-emit-grilling' } : undefined),
    antiScopeGate({ blocking: strict, accrual: memorial ? { sink: memorial, memorialId: 'anti-scope' } : undefined }),
  );
  const deps = { adapter, memorial, gates };
  const roundId = str(flags, 'round') ?? 'R01';
  const directiveFile = str(flags, 'directive');

  const specPath = str(flags, 'spec'); // optional canonical spec path (threaded to Architect + gates)
  let result: RunResult;
  if (directiveFile || (str(flags, 'task') && !str(flags, 'tier'))) {
    const directive = readDirective(flags)!;
    result = await runRoundFromDirective(directive, deps, { roundId, runDate: ctx.now(), task: str(flags, 'task'), tierOverride: str(flags, 'tier') as Tier | undefined, specPath });
  } else {
    const tier = (str(flags, 'tier') as Tier) || 'audit';
    const task = str(flags, 'task');
    if (!task) { ctx.stdout('error: provide --task "<text>" (and optionally --tier), or --directive <file>'); return { code: 2 }; }
    result = await runRound({ roundId, tier, task, runDate: ctx.now(), specPath }, deps);
  }
  ctx.stdout(renderRun(result));
  return { code: result.status === 'COMPLETE' ? 0 : 1, result };
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
