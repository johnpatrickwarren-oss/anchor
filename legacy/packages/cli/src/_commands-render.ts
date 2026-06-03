// @anchor/cli — pure render helpers (result → human-readable string) and the read-only
// `anchor route` command. No side effects beyond ctx.stdout in cmdRoute.

import { routeRound } from '@anchor/core';
import type { RunResult, Tier, RouteResult, WaveResult, ProjectResult } from '@anchor/core';
import { str } from './args.ts';
import type { CliContext, Flags } from './_commands-shared.ts';
import { readDirective } from './_commands-shared.ts';

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

// ── anchor wave ── fan out independent cycles concurrently.
export function renderWave(w: WaveResult): string {
  const rows = w.rounds.map((r) => {
    const roles = r.result.phases.map((p) => `${p.role}:${p.status}`).join(' ') || '(no phases)';
    return `  ${r.itemId.padEnd(18)} [${r.result.tier}] ${r.result.status.padEnd(9)} ${roles}`;
  }).join('\n');
  return `wave ${w.waveId} -> ${w.status}  (${w.rounds.length} item(s))\n${rows}`;
}

// ── anchor project ── decompose a project directive into features, then run them in
// dependency-aware stages (independent features concurrent; dependents sequenced after).
// This is the auto-parallelization layer: one directive in → Coordinator decomposes → staged
// waves out. Each feature self-routes its OWN tier/models (scope decides), so roles scale per
// feature and workflows fan out per stage — both automatic, no hand-authored plan.
export function renderProject(p: ProjectResult): string {
  const rows = p.stages.map((s) => {
    const items = s.wave.rounds.map((x) => `${x.itemId}:${x.result.status}`).join(' ') || '(none)';
    return `  stage ${s.stage + 1} [${s.wave.status}] ${items}`;
  }).join('\n');
  const skip = p.skipped.length ? `\n  skipped (an upstream stage did not complete): ${p.skipped.join(', ')}` : '';
  return `project ${p.projectId} -> ${p.status}  (${p.stages.length} stage(s) run)\n${rows}${skip}`;
}

// ── anchor route ──
export async function cmdRoute(flags: Flags, ctx: CliContext): Promise<{ code: number; route?: RouteResult }> {
  const directive = readDirective(flags);
  if (!directive) { ctx.stdout('error: provide --directive <file> or --task "<text>"'); return { code: 2 }; }
  const route = routeRound(directive, { tierOverride: str(flags, 'tier') as Tier | undefined });
  ctx.stdout(renderRoute(route));
  return { code: 0, route };
}
