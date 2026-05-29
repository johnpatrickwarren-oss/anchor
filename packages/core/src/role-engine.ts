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

// Role obligations — the disciplines baked into each role's instruction so the agent
// applies them (grilling gate / anti-scope gate / anti-self-confirming gate then verify).
const ROLE_OBLIGATIONS: Record<Role, string> = {
  architect:
    'Draft the spec. Include an explicit "## Anti-scope" section naming what is NOT in scope. ' +
    'Cite every inherited primitive in an "Existing architectural surface" table (file + pinned SHA + line range + verbatim snippet). ' +
    'Before emitting, run a pre-emit grilling pass and inline its CRITICAL / LIKELY-SURFACES / PRE-EMPTABLE buckets.',
  implementer:
    "Implement exactly to the spec (cold-read; don't seek the Architect's reasoning). Every acceptance criterion gets a test, " +
    'and no test may be self-confirming (it must FAIL if the production line it checks is broken). HALT with a DIAGNOSTIC if the spec contradicts reality.',
  reviewer:
    'Cold-eye spec-vs-implementation audit. Verify each acceptance criterion against the actual code. Apply the anti-self-confirming-test check. ' +
    'Tier findings by severity (CRITICAL / MAJOR / MINOR / NIT).',
  memorial: 'Append one discipline-accretion entry recording what this round confirms or violates.',
  coordinator: 'Produce or close the wave plan / wave-gate; do not implement.',
};

function defaultPrompt(role: Role, config: RoundConfig, handoff: Record<string, unknown>): string {
  const priorRoles = Object.keys(handoff).join(', ') || 'none';
  return `ROLE: ${role}\nROUND: ${config.roundId} (tier ${config.tier})\nTASK: ${config.task}\nPRIOR HANDOFFS FROM: ${priorRoles}\n\nYour obligations:\n${ROLE_OBLIGATIONS[role]}`;
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
  warnings: string[],
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
        return { roundId: config.roundId, tier: config.tier, status: 'PAUSED', phases, pausedAt: role, escalation: result.escalation, warnings, CAVEAT };
      }
      const resolution = await deps.onEscalate(result.escalation);
      const resumedPrompt = `${prompt}\n\nOPERATOR RESOLUTION: ${resolution.answer}`;
      result = await deps.adapter.spawnRole({ ...spec, prompt: resumedPrompt });
      if (result.status === 'ESCALATE') {
        // Escalated again after resolution — do not loop; surface as paused.
        phases.push(toPhase(result, model));
        return { roundId: config.roundId, tier: config.tier, status: 'PAUSED', phases, pausedAt: role, escalation: result.escalation, warnings, CAVEAT };
      }
    }

    phases.push(toPhase(result, model));

    if (result.status === 'BLOCKED') {
      return { roundId: config.roundId, tier: config.tier, status: 'BLOCKED', phases, pausedAt: role, warnings, CAVEAT };
    }

    // Discipline gates. Findings always surface (as warnings); a non-pass halts the run.
    if (deps.gates) {
      const outcome = await deps.gates(result, config);
      if (outcome.findings) warnings.push(...outcome.findings.map((f) => `${role}: ${f}`));
      if (!outcome.pass) {
        if (deps.memorial) await deps.memorial.record('violation', { role, findings: outcome.findings });
        return { roundId: config.roundId, tier: config.tier, status: 'BLOCKED', phases, pausedAt: role, warnings, CAVEAT };
      }
      if (deps.memorial) await deps.memorial.record('confirmation', { role });
    }

    handoff[role] = result.handoff;
  }

  return { roundId: config.roundId, tier: config.tier, status: 'COMPLETE', phases, warnings, CAVEAT };
}

function toPhase(result: RoleResult, model: string): PhaseRecord {
  return { role: result.role, model, status: result.status, usage: result.usage, artifacts: result.artifacts };
}

// Run a round from the start.
export function runRound(config: RoundConfig, deps: EngineDeps): Promise<RunResult> {
  return runFrom(rolesForTier(config.tier), 0, [], {}, [], config, deps);
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
  return runFrom(roles, resumeIndex, priorPhases, handoff, paused.warnings ?? [], config, onceResolved);
}
