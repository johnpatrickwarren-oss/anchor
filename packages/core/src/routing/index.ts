// @anchor/core — routing: turn a round directive into {tier, per-role model overrides} and
// run the round self-routed. This closes the loop so the engine derives tier + models from
// the directive instead of taking them as inputs.

import type { Role, RoundConfig, Tier } from '../types.ts';
import type { EngineDeps } from '../role-engine.ts';
import type { ModelManifest } from '../models.ts';
import { DEFAULT_MANIFEST } from '../models.ts';
import { runRound } from '../role-engine.ts';
import { rolesForTier } from '../tiers.ts';
import { classifyTier } from './tier-router.ts';
import type { TierClassification } from './tier-router.ts';
import { selectRoleModelClasses, selectRiskLevel } from './model-router.ts';
import type { RiskLevel } from './model-router.ts';

export { classifyTier } from './tier-router.ts';
export type { TierClassification } from './tier-router.ts';
export { selectImplementerClass, selectMemorialClass, selectReviewerClass, selectArchitectClass, selectRoleModelClasses, selectRiskLevel } from './model-router.ts';
export type { RiskLevel } from './model-router.ts';

// Adaptive structure: a high-risk directive earns a SECOND independent reviewer pass (a
// cold-eye re-audit before the memorial accretes) — defense in depth for load-bearing
// changes, the inverse of down-scaling trivial work to the solo tier. Only augments a cycle
// that actually has a reviewer; a 'normal' directive is returned untouched. The second pass
// is inserted right after the existing reviewer (before the memorial).
export function adaptRolesForRisk(roles: Role[], level: RiskLevel): Role[] {
  if (level !== 'high') return [...roles];
  const lastReviewer = roles.lastIndexOf('reviewer');
  if (lastReviewer === -1) return [...roles]; // nothing to double-check
  const out = [...roles];
  out.splice(lastReviewer + 1, 0, 'reviewer');
  return out;
}

export interface RouteResult {
  tier: Tier;
  classification: TierClassification;
  modelOverrides: Partial<Record<Role, string>>; // concrete model ids, resolved from the manifest
}

export interface RouteOptions {
  manifest?: ModelManifest;
  tierOverride?: Tier; // operator pin (e.g. --tier); wins over classification
}

export function routeRound(directive: string, opts: RouteOptions = {}): RouteResult {
  const classification = classifyTier(directive);
  const tier = opts.tierOverride ?? classification.tier;
  const manifest = opts.manifest ?? DEFAULT_MANIFEST;
  const classes = selectRoleModelClasses(directive, tier);
  const modelOverrides: Partial<Record<Role, string>> = {};
  for (const [role, cls] of Object.entries(classes)) {
    if (cls) modelOverrides[role as Role] = manifest.classes[cls];
  }
  return { tier, classification, modelOverrides };
}

export interface DirectiveRunMeta {
  roundId: string;
  runDate: string;
  task?: string; // defaults to the directive text
  tierOverride?: Tier;
  specPath?: string; // canonical spec path (threaded to the Architect + gates)
  riskAdapt?: boolean; // adaptive structure (2nd reviewer for high-risk); default ON
}

// Self-routed run: classify the directive, derive per-role models + risk-adapted role set,
// then run. Explicit deps.modelOverrides / deps.rolesOverride still win over routing-derived
// values.
export function runRoundFromDirective(directive: string, deps: EngineDeps, meta: DirectiveRunMeta) {
  const route = routeRound(directive, { manifest: deps.manifest, tierOverride: meta.tierOverride });
  const config: RoundConfig = { roundId: meta.roundId, tier: route.tier, task: meta.task ?? directive, runDate: meta.runDate, specPath: meta.specPath };
  const modelOverrides = { ...route.modelOverrides, ...(deps.modelOverrides ?? {}) };
  const rolesOverride = deps.rolesOverride
    ?? (meta.riskAdapt === false ? undefined : adaptRolesForRisk(rolesForTier(route.tier), selectRiskLevel(directive)));
  return runRound(config, { ...deps, modelOverrides, rolesOverride });
}
