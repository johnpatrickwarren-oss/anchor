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
  Escalation, ImplUnit, Resolution, Role, RoleResult, RoleSpec, RoundConfig, PhaseRecord, RunResult, Usage,
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
  // Disciplines a structural gate already accrues (e.g. the built-in grilling/anti-scope
  // gates). Reviewer-signal accrual SKIPS these to avoid gate+signal double-counting.
  gateOwnedMemorialIds?: string[];
  // Remediation loop: when a code-producing role's gates fail, re-run it with the findings as
  // feedback and re-check, up to this many extra attempts, before BLOCKING. 0 disables (block
  // on the first red — the original behavior). Default 2. This is the fix-and-reverify loop
  // that lets the cycle CONVERGE to green instead of stopping at the first failure.
  maxFixAttempts?: number;
  // Explicit role sequence, overriding the tier's default set. The seam for adaptive structure
  // (e.g. a risk-augmented cycle with a second reviewer pass). Roles may repeat.
  rolesOverride?: Role[];
  // Injectable wall-clock for per-phase timing (PhaseRecord.durationMs). Default Date.now;
  // injected in tests for determinism. Timing is a measurement, not control flow — the
  // engine's logical run date stays config.runDate (never self-generated).
  now?: () => number;
}

const CAVEAT =
  'phases[].usage is the per-role raw token breakdown (input/cache_creation/cache_read/output). ' +
  'No bare total cost is published; reconstruct cost from these + a pricing table (POC AC-7).';

// Roles whose gate failures are auto-remediable: the engine re-runs them with the gate
// findings as feedback and re-checks, instead of blocking on the first red. The implementer
// is the code-fixing role; the architect/reviewer/memorial don't mutate code, so a gate
// failure there is structural (block, don't retry).
const REMEDIABLE = new Set<Role>(['implementer']);

// Applies to EVERY role (appended in defaultPrompt). The engine owns verification and each
// discipline is enforced by its gate + the role that produces it — so no role runs tests, asks
// the operator to, or escalates to ask whether a discipline (tests, anti-scope, grilling, …)
// must be satisfied first. Global + discipline-GENERAL so the class can't leak role-by-role:
// first the memorial tripped on `tests-pass`, then on `anti-scope` in a tier with no architect.
const ENGINE_VERIFICATION_NOTE =
  '\n\nVERIFICATION & DISCIPLINES (all roles): the engine runs the test suite and gates the round on it, and each ' +
  'discipline is enforced by its gate and the role that owns its output. Do your role and signal your status — do NOT ' +
  'run tests, ask the operator to run them, or escalate to ask whether a discipline (tests, anti-scope, grilling, …) ' +
  "must be satisfied first. A red suite is sent back to the implementer; an unmet discipline is the gate's to flag, not yours to block on.";

// Role obligations — the disciplines baked into each role's instruction so the agent
// applies them (grilling gate / anti-scope gate / anti-self-confirming gate then verify).
const ROLE_OBLIGATIONS: Record<Role, string> = {
  architect:
    'Draft the spec as an ARTIFACT (no narration, no restating the brief). Required and COMPLETE: a "## Anti-scope" section (what is NOT in scope); ' +
    'an "Existing architectural surface" citation table for every inherited primitive (file + pinned SHA + line range + verbatim snippet); acceptance criteria; ' +
    'and an inlined pre-emit grilling pass (CRITICAL / LIKELY-SURFACES / PRE-EMPTABLE). Trim prose padding, never spec content. ' +
    'If the feature splits into independent FILE-DISJOINT parts, declare each via `ANCHOR-UNIT [id]: <scope + files it owns>` (one per line) for concurrent implementation.',
  implementer:
    "Implement exactly to the spec (cold-read; don't seek the Architect's reasoning). Every acceptance criterion gets a test, " +
    'and no test may be self-confirming (it must FAIL if the production line it checks is broken). ' +
    'Write the code and the tests, then signal READY. HALT with a DIAGNOSTIC only if the spec contradicts reality.',
  reviewer:
    'Cold-eye spec-vs-implementation audit. Verify each acceptance criterion against the actual code (judge against the code and the gate result). Apply the anti-self-confirming-test check. ' +
    'BE TERSE — output ONLY: one line per acceptance criterion (`AC-n: pass|fail @ file:line`), then the material findings tiered by severity (CRITICAL / MAJOR / MINOR / NIT), then the status + memorial lines. Do NOT restate code, paste test output, or narrate your steps; cite file:line instead of reproducing. A clean review is a few lines, not paragraphs. ' +
    'For each REINFORCEMENT discipline you were given (tagged [id]), judge whether the implementation upheld or broke it and report it back by id via the ANCHOR-MEMORIAL-CONFIRM / ANCHOR-MEMORIAL-VIOLATE contract — this is how the memorial learns from review.',
  memorial: 'Append one discipline-accretion entry recording what this round confirms or violates.',
  coordinator: 'Produce or close the wave plan / wave-gate; do not implement.',
};

function defaultPrompt(role: Role, config: RoundConfig, handoff: Record<string, unknown>): string {
  const priorRoles = Object.keys(handoff).join(', ') || 'none';
  const specPathNote = role === 'architect' && config.specPath ? `\nWrite the spec to: ${config.specPath}` : '';
  return `ROLE: ${role}\nROUND: ${config.roundId} (tier ${config.tier})\nTASK: ${config.task}\nPRIOR HANDOFFS FROM: ${priorRoles}\n\nYour obligations:\n${ROLE_OBLIGATIONS[role]}${specPathNote}${ENGINE_VERIFICATION_NOTE}`;
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
  const clock = deps.now ?? Date.now;
  // Within-feature parallelism: implementation units, pre-set or declared by the Architect.
  let units = config.units;

  for (let i = startIndex; i < roles.length; i++) {
    const role = roles[i];
    const model = resolveModel(role, { manifest, overrides });
    let prompt = buildPrompt(role, config, handoff);

    // Reinforcements remind the PRODUCING roles to uphold disciplines. The memorial is a
    // recorder (it accretes V/C from the reviewer's signals + the gate outcomes), not a
    // producer — injecting "every spec needs anti-scope" into it just made it escalate over a
    // discipline it can't act on. So skip the memorial.
    if (deps.memorial && role !== 'memorial') {
      const reinforcements = await deps.memorial.applicable(config);
      if (reinforcements.length) prompt += `\n\nREINFORCEMENTS:\n- ${reinforcements.join('\n- ')}`;
    }

    const spec: RoleSpec = { role, model, contextRefs: contextRefsFor(role, config, phases), prompt };
    // Fan out the implementer across independent units (≥2) — one sub-implementer per unit,
    // run concurrently, then merged. A single/no unit runs the normal serial implementer.
    const t0 = clock();
    let result = (role === 'implementer' && units && units.length > 1)
      ? await fanOutImplementers(units, spec, prompt, deps.adapter)
      : await deps.adapter.spawnRole(spec);

    // Escalation: pause for the operator, then resume the SAME role once with the answer.
    if (result.status === 'ESCALATE' && result.escalation) {
      if (!deps.onEscalate) {
        phases.push(toPhase(result, model, clock() - t0));
        return { roundId: config.roundId, tier: config.tier, status: 'PAUSED', phases, pausedAt: role, escalation: result.escalation, warnings, CAVEAT };
      }
      const resolution = await deps.onEscalate(result.escalation);
      const resumedPrompt = `${prompt}\n\nOPERATOR RESOLUTION: ${resolution.answer}`;
      result = await deps.adapter.spawnRole({ ...spec, prompt: resumedPrompt });
      if (result.status === 'ESCALATE') {
        // Escalated again after resolution — do not loop; surface as paused.
        phases.push(toPhase(result, model, clock() - t0));
        return { roundId: config.roundId, tier: config.tier, status: 'PAUSED', phases, pausedAt: role, escalation: result.escalation, warnings, CAVEAT };
      }
    }

    phases.push(toPhase(result, model, clock() - t0));

    if (result.status === 'BLOCKED') {
      return { roundId: config.roundId, tier: config.tier, status: 'BLOCKED', phases, pausedAt: role, warnings, CAVEAT };
    }

    // Discipline gates. Findings always surface (as warnings); a non-pass halts the run —
    // UNLESS the role is auto-remediable, in which case it re-runs with the findings as
    // feedback and re-checks, up to maxFixAttempts, converging to green instead of stopping
    // at the first red. This is the fix-and-reverify loop the dynamic-workflow comparison
    // exposed: the workflow iterated to green; Anchor used to stop at the first failure.
    if (deps.gates) {
      let outcome = await deps.gates(result, config);
      const maxFix = deps.maxFixAttempts ?? 2;
      let fixAttempt = 0;
      while (!outcome.pass && REMEDIABLE.has(role) && result.status === 'READY' && fixAttempt < maxFix) {
        fixAttempt++;
        const findings = outcome.findings ?? [];
        const fixPrompt = `${prompt}\n\nREMEDIATION (attempt ${fixAttempt}/${maxFix}) — these gate checks FAILED and MUST be fixed before the round can complete:\n- ${findings.join('\n- ')}\nFix them without regressing passing work, then re-verify.`;
        const fixT0 = clock();
        result = await deps.adapter.spawnRole({ ...spec, prompt: fixPrompt });
        phases.push(toPhase(result, model, clock() - fixT0));
        if (result.status !== 'READY') break; // a fix that escalates/blocks falls through to the block below
        outcome = await deps.gates(result, config);
      }
      if (outcome.findings) warnings.push(...outcome.findings.map((f) => `${role}: ${f}`));
      if (!outcome.pass) {
        if (deps.memorial) await deps.memorial.record('violation', { role, findings: outcome.findings });
        return { roundId: config.roundId, tier: config.tier, status: 'BLOCKED', phases, pausedAt: role, warnings, CAVEAT };
      }
      if (deps.memorial) await deps.memorial.record('confirmation', { role });
    }

    // Reviewer-driven accrual (the learning loop for ANY discipline, not just the built-in
    // gates). Only the REVIEWER's signals accrue — it is the cold-eye judge, so an
    // architect/implementer self-report is advisory, not authoritative (prevents one round
    // double/triple-counting a discipline). Disciplines a gate already owns this round are
    // skipped (no gate+signal double), and a violation wins over a confirmation. record()
    // tolerates unknown ids, so a hallucinated id is ignored rather than crashing the run.
    if (role === 'reviewer' && deps.memorial && result.memorialSignals) {
      const gateOwned = new Set(deps.gateOwnedMemorialIds ?? []);
      const violated = result.memorialSignals.violate.filter((id) => !gateOwned.has(id));
      const violatedSet = new Set(violated);
      for (const id of violated) await deps.memorial.record('violation', { memorialId: id, date: config.runDate });
      for (const id of result.memorialSignals.confirm) {
        if (gateOwned.has(id) || violatedSet.has(id)) continue;
        await deps.memorial.record('confirmation', { memorialId: id, date: config.runDate });
      }
    }

    // The Architect is the decomposition role: capture any independent units it declared so
    // the upcoming implementer can fan out across them. Validated (id + scope strings).
    if (role === 'architect') {
      const declared = (result.handoff as Record<string, unknown>)?.units;
      if (Array.isArray(declared)) {
        const valid = declared.filter(
          (u): u is ImplUnit => !!u && typeof (u as ImplUnit).id === 'string' && typeof (u as ImplUnit).scope === 'string',
        );
        if (valid.length) units = valid;
      }
    }

    handoff[role] = result.handoff;
  }

  return { roundId: config.roundId, tier: config.tier, status: 'COMPLETE', phases, warnings, CAVEAT };
}

// Within-feature parallelism: run one sub-implementer per declared unit CONCURRENTLY, each
// scoped to only its unit, then merge into a single implementer result. The orchestration is
// a plain JS Promise pool — $0 model tokens, the same determinism principle as the wave.
async function fanOutImplementers(
  units: ImplUnit[], baseSpec: RoleSpec, basePrompt: string, adapter: RuntimeAdapter,
): Promise<RoleResult> {
  const parts = await Promise.all(units.map((u) => adapter.spawnRole({
    ...baseSpec,
    prompt: `${basePrompt}\n\nPARALLEL UNIT [${u.id}] — implement ONLY this unit; do NOT touch other units' files:\n${u.scope}`,
  })));
  return mergeImplResults(parts, units);
}

const ZERO_USAGE: Usage = { input: 0, cache_creation: 0, cache_read: 0, output: 0 };

// Merge parallel sub-implementer results into one implementer phase: summed usage, all
// artifacts, worst status wins (any BLOCKED → BLOCKED; any ESCALATE → ESCALATE; else READY),
// deduped memorial signals. The merged handoff records each unit's status for auditability.
function mergeImplResults(parts: RoleResult[], units: ImplUnit[]): RoleResult {
  const usage = parts.reduce<Usage>((a, p) => ({
    input: a.input + p.usage.input,
    cache_creation: a.cache_creation + p.usage.cache_creation,
    cache_read: a.cache_read + p.usage.cache_read,
    output: a.output + p.usage.output,
  }), { ...ZERO_USAGE });
  const status = parts.some((p) => p.status === 'BLOCKED') ? 'BLOCKED'
    : parts.some((p) => p.status === 'ESCALATE') ? 'ESCALATE'
    : parts.every((p) => p.status === 'READY') ? 'READY' : 'BLOCKED';
  const confirm = [...new Set(parts.flatMap((p) => p.memorialSignals?.confirm ?? []))];
  const violate = [...new Set(parts.flatMap((p) => p.memorialSignals?.violate ?? []))];
  return {
    role: 'implementer',
    status,
    artifacts: parts.flatMap((p) => p.artifacts),
    handoff: { merged: true, units: units.map((u, i) => ({ id: u.id, status: parts[i].status })) },
    usage,
    escalation: parts.find((p) => p.escalation)?.escalation,
    memorialSignals: (confirm.length || violate.length) ? { confirm, violate } : undefined,
  };
}

function toPhase(result: RoleResult, model: string, durationMs?: number): PhaseRecord {
  return { role: result.role, model, status: result.status, usage: result.usage, artifacts: result.artifacts, durationMs };
}

// Run a round from the start. deps.rolesOverride wins over the tier's default role set
// (the seam for adaptive structure — e.g. a risk-augmented cycle).
export function runRound(config: RoundConfig, deps: EngineDeps): Promise<RunResult> {
  return runFrom(deps.rolesOverride ?? rolesForTier(config.tier), 0, [], {}, [], config, deps);
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
