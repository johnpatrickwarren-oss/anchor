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
  composeGates, citationGate, antiSelfConfirmingGate, grillingGate, antiScopeGate,
  gitCitationResolver, makeFileMutationRunner,
  verifyCitations, parseCitationTable, checkAntiSelfConfirming, checkGrillingEmitted,
  checkAntiScope, checkAntiScopeViolation, gateResult, toGateOutcome,
} from './gates/index.ts';
export type { Finding, Severity, GateResult, CitationResolver, Mutation, MutationRunner, MemorialAccrual } from './gates/index.ts';
// Phase 4 — memorial service (the cross-project learning loop).
export { MemorialStore, MemoryPersistence, JsonFilePersistence, BUILTIN_DISCIPLINES, seedBuiltinDisciplines } from './memorial/index.ts';
export type { MemorialEntry, MemorialStatus, MemorialPersistence, RatioRow, MemorialStoreOptions, PruneThresholds } from './memorial/index.ts';
// Routing — derive tier + per-role models from a directive (self-routing).
export { classifyTier, routeRound, runRoundFromDirective, selectImplementerClass, selectMemorialClass, selectRoleModelClasses } from './routing/index.ts';
export type { TierClassification, RouteResult, RouteOptions, DirectiveRunMeta } from './routing/index.ts';
