// @anchor/core — public surface.
export type {
  Role, Tier, ModelClass, Usage, Escalation, RoleStatus, RoleSpec, RoleResult,
  Resolution, RoundConfig, PhaseRecord, RunStatus, RunResult, ImplUnit,
} from './types.ts';
export { rolesForTier } from './tiers.ts';
export { resolveModel, DEFAULT_MANIFEST } from './models.ts';
export type { ModelManifest, ResolveModelOptions } from './models.ts';
export { MockRuntimeAdapter } from './runtime-adapter.ts';
export type { RuntimeAdapter, MockScenario } from './runtime-adapter.ts';
export { runRound, resumeRound } from './role-engine.ts';
export type { EngineDeps, GateOutcome, MemorialPort } from './role-engine.ts';
// Fan-out: run independent cycles concurrently (throughput).
export { runWave } from './wave.ts';
export type { WaveItem, WaveRoundResult, WaveResult, WaveConfig } from './wave.ts';
// Project decomposition — Coordinator splits a project into features; dependency-aware staging.
export { parseFeatures, planStages, renderStages } from './project/index.ts';
export type { Feature, Stage } from './project/index.ts';
export { decompose, runProject } from './project/run-project.ts';
export type { DecomposeOptions, ProjectConfig, ProjectStageResult, ProjectResult } from './project/run-project.ts';
// Phase 3 — discipline gates.
export {
  composeGates, citationGate, antiSelfConfirmingGate, grillingGate, antiScopeGate, testGate,
  gitCitationResolver, makeFileMutationRunner, npmTestRunner,
  verifyCitations, parseCitationTable, checkAntiSelfConfirming, checkGrillingEmitted,
  checkAntiScope, checkAntiScopeViolation, gateResult, toGateOutcome,
} from './gates/index.ts';
export type { Finding, Severity, GateResult, CitationResolver, Mutation, MutationRunner, MemorialAccrual } from './gates/index.ts';
// Phase 4 — memorial service (the cross-project learning loop).
export { MemorialStore, MemoryPersistence, JsonFilePersistence, BUILTIN_DISCIPLINES, seedBuiltinDisciplines, keywordRelevance } from './memorial/index.ts';
export type { MemorialEntry, MemorialStatus, MemorialPersistence, RatioRow, MemorialStoreOptions, PruneThresholds } from './memorial/index.ts';
// Routing — derive tier + per-role models from a directive (self-routing).
export { classifyTier, routeRound, runRoundFromDirective, selectImplementerClass, selectMemorialClass, selectReviewerClass, selectArchitectClass, selectRoleModelClasses, selectRiskLevel, adaptRolesForRisk, assessTask, hasRiskDomain, RISK_DOMAINS } from './routing/index.ts';
export type { TierClassification, RouteResult, RouteOptions, DirectiveRunMeta, RiskLevel, Assessment } from './routing/index.ts';
export { ROUTING_PROVENANCE, checkModelDrift } from './routing/provenance.ts';
export type { RoutingProvenance, DriftResult } from './routing/provenance.ts';
