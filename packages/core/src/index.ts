// @anchor/core — public surface.
export type {
  Role, Tier, ModelClass, Usage, Escalation, RoleStatus, RoleSpec, RoleResult,
  Resolution, RoundConfig, PhaseRecord, RunStatus, RunResult,
} from './types.ts';
export { rolesForTier } from './tiers.ts';
export { resolveModel, DEFAULT_MANIFEST } from './models.ts';
export type { ModelManifest, ResolveModelOptions } from './models.ts';
export { MockRuntimeAdapter } from './runtime-adapter.ts';
export type { RuntimeAdapter, MockScenario } from './runtime-adapter.ts';
export { runRound, resumeRound } from './role-engine.ts';
export type { EngineDeps, GateOutcome, MemorialPort } from './role-engine.ts';
// Phase 3 — discipline gates.
export {
  composeGates, citationGate, antiSelfConfirmingGate, gitCitationResolver, makeFileMutationRunner,
  verifyCitations, parseCitationTable, checkAntiSelfConfirming, gateResult, toGateOutcome,
} from './gates/index.ts';
export type { Finding, Severity, GateResult, CitationResolver, Mutation, MutationRunner } from './gates/index.ts';
