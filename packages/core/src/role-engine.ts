// @anchor/core — the role engine.
//
// A deterministic state machine over the Anchor cycle (Architect -> Implementer ->
// Reviewer -> Memorial, filtered by tier). This is `run-pipeline.sh`'s sequencing reborn
// in TypeScript, calling a RuntimeAdapter instead of opening Claude Code sessions.
//
// Determinism: role order, tier filtering, model resolution, handoff threading, and
// escalation handling are all plain code (no model decides control flow) — the same
// "deterministic workflow / non-deterministic model" stance Anchor, Atomic, and Claude
// Code dynamic workflows all converge on.
//
// SEAMS for later phases (kept explicit, not implemented here):
//   - `gates`    -> discipline gates (pre-emit grilling, citation verify, anti-self-
//                   confirming mutation, anti-scope). Phase 3. A failing gate halts the run.
//   - `memorial` -> the memorial service (record V/C, inject reinforcements). Phase 4.

import type {
  Escalation, Resolution, Role, RoleResult, RoleSpec, RoundConfig, PhaseRecord, RunResult,
} from './types.ts';
import type { RuntimeAdapter } from './runtime-adapter.ts';
import type { ModelManifest } from './models.ts';
import { resolveModel } from './models.ts';
import { rolesForTier } from './tiers.ts';

export interface GateOutcome { pass: boolean; findings?: string[]; }

// Phase-4 seam — a memorial service implements this; default is none.
export interface MemorialPort {
  applicable(config: RoundConfig): Promise<string[]>; // reinforcement fragments for role prompts
  record(kind: 'violation' | 'confirmation', context: Record<string, unknown>): Promise<void>;
}

export interface EngineDeps {
  adapter: RuntimeAdapter;
  manifest?: ModelManifest;
  modelOverrides?: Partial<Record<Role, string>>;
  // Prompt/context builders — overridable. Defaults keep the engine runnable out of the box.
  buildPrompt?: (role: Role, config: RoundConfig, handoff: Record<string, unknown>) => string;
  contextRefsFor?: (role: Role, config: RoundConfig, prior: PhaseRecord[]) => string[];
  // Operator resolves a bounded escalation; if omitted, the run PAUSES and is resumable.
  onEscalate?: (e: Escalation) => Promise<Resolution>;
  // Phase-3 seam — discipline gates run after a role emits, before forwarding. None by default.
  gates?: (result: RoleResult, config: RoundConfig) => Promise<GateOutcome> | GateOutcome;
  // Phase-4 seam.
  memorial?: MemorialPort;
}

const CAVEAT =
  'phases[].usage is the per-role raw token breakdown (input/cache_creation/cache_read/output). ' +
  'No bare total cost is published; reconstruct cost from these + a pricing table (POC AC-7).';

function defaultPrompt(role: Role, config: RoundConfig, handoff: Record<string, unknown>): string {
  const priorRoles = Object.keys(handoff).join(', ') || 'none';
  return `ROLE: ${role}\nROUND: ${config.roundId} (tier ${config.tier})\nTASK: ${config.task}\nPRIOR HANDOFFS FROM: ${priorRoles}`;
}

// Lean context-by-reference: a role gets the prior roles' artifact PATHS, not their text
// (the explicit fix for the context re-payment measured in the POC).
function defaultContextRefs(_role: Role, _config: RoundConfig, prior: PhaseRecord[]): string[] {
  return prior.flatMap((p) => p.artifacts);
}

async function runFrom(
  roles: Role[],
  startIndex: number,
  phases: PhaseRecord[],
  handoff: Record<string, unknown>,
  config: RoundConfig,
  deps: EngineDeps,
): Promise<RunResult> {
  const buildPrompt = deps.buildPrompt ?? defaultPrompt;
  const contextRefsFor = deps.contextRefsFor ?? defaultContextRefs;
  const manifest = deps.manifest;
  const overrides = deps.modelOverrides;

  for (let i = startIndex; i < roles.length; i++) {
    const role = roles[i];
    const model = resolveModel(role, { manifest, overrides });
    let prompt = buildPrompt(role, config, handoff);

    if (deps.memorial) {
      const reinforcements = await deps.memorial.applicable(config);
      if (reinforcements.length) prompt += `\n\nREINFORCEMENTS:\n- ${reinforcements.join('\n- ')}`;
    }

    const spec: RoleSpec = { role, model, contextRefs: contextRefsFor(role, config, phases), prompt };
    let result = await deps.adapter.spawnRole(spec);

    // Escalation: pause for the operator, then resume the SAME role once with the answer.
    if (result.status === 'ESCALATE' && result.escalation) {
      if (!deps.onEscalate) {
        phases.push(toPhase(result, model));
        return { roundId: config.roundId, tier: config.tier, status: 'PAUSED', phases, pausedAt: role, escalation: result.escalation, CAVEAT };
      }
      const resolution = await deps.onEscalate(result.escalation);
      const resumedPrompt = `${prompt}\n\nOPERATOR RESOLUTION: ${resolution.answer}`;
      result = await deps.adapter.spawnRole({ ...spec, prompt: resumedPrompt });
      if (result.status === 'ESCALATE') {
        // Escalated again after resolution — do not loop; surface as paused.
        phases.push(toPhase(result, model));
        return { roundId: config.roundId, tier: config.tier, status: 'PAUSED', phases, pausedAt: role, escalation: result.escalation, CAVEAT };
      }
    }

    phases.push(toPhase(result, model));

    if (result.status === 'BLOCKED') {
      return { roundId: config.roundId, tier: config.tier, status: 'BLOCKED', phases, pausedAt: role, CAVEAT };
    }

    // Phase-3 discipline gates: a failing gate halts before forwarding.
    if (deps.gates) {
      const outcome = await deps.gates(result, config);
      if (!outcome.pass) {
        if (deps.memorial) await deps.memorial.record('violation', { role, findings: outcome.findings });
        return { roundId: config.roundId, tier: config.tier, status: 'BLOCKED', phases, pausedAt: role, CAVEAT };
      }
      if (deps.memorial) await deps.memorial.record('confirmation', { role });
    }

    handoff[role] = result.handoff;
  }

  return { roundId: config.roundId, tier: config.tier, status: 'COMPLETE', phases, CAVEAT };
}

function toPhase(result: RoleResult, model: string): PhaseRecord {
  return { role: result.role, model, status: result.status, usage: result.usage, artifacts: result.artifacts };
}

// Run a round from the start.
export function runRound(config: RoundConfig, deps: EngineDeps): Promise<RunResult> {
  return runFrom(rolesForTier(config.tier), 0, [], {}, config, deps);
}

// Resume a PAUSED run after an operator resolves the escalation (mirrors `--start-at`).
export function resumeRound(paused: RunResult, resolution: Resolution, deps: EngineDeps): Promise<RunResult> {
  if (paused.status !== 'PAUSED' || !paused.pausedAt) throw new Error('resumeRound: run is not paused');
  const roles = rolesForTier(paused.tier);
  const resumeIndex = roles.indexOf(paused.pausedAt);
  // Rebuild handoff from completed phases (all phases before the paused role completed READY).
  const handoff: Record<string, unknown> = {};
  const priorPhases: PhaseRecord[] = [];
  for (const p of paused.phases) {
    if (p.role === paused.pausedAt) break;
    handoff[p.role] = { resumed: true };
    priorPhases.push(p);
  }
  const config: RoundConfig = { roundId: paused.roundId, tier: paused.tier, task: '(resumed)', runDate: '(resumed)' };
  // Inject the resolution by wrapping onEscalate to answer immediately on the first ask.
  const onceResolved: EngineDeps = { ...deps, onEscalate: async () => resolution };
  return runFrom(roles, resumeIndex, priorPhases, handoff, config, onceResolved);
}
