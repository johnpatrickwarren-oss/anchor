// @anchor/core — routing: turn a round directive into {tier, per-role model overrides} and
// run the round self-routed. This closes the loop so the engine derives tier + models from
// the directive instead of taking them as inputs.

import type { Role, RoundConfig, Tier } from '../types.ts';
import type { EngineDeps } from '../role-engine.ts';
import type { ModelManifest } from '../models.ts';
import { DEFAULT_MANIFEST } from '../models.ts';
import { runRound } from '../role-engine.ts';
import { classifyTier } from './tier-router.ts';
import type { TierClassification } from './tier-router.ts';
import { selectRoleModelClasses } from './model-router.ts';

export { classifyTier } from './tier-router.ts';
export type { TierClassification } from './tier-router.ts';
export { selectImplementerClass, selectMemorialClass, selectRoleModelClasses } from './model-router.ts';

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
}

// Self-routed run: classify the directive, derive per-role models, then run.
// Explicit deps.modelOverrides still win over routing-derived ones.
export function runRoundFromDirective(directive: string, deps: EngineDeps, meta: DirectiveRunMeta) {
  const route = routeRound(directive, { manifest: deps.manifest, tierOverride: meta.tierOverride });
  const config: RoundConfig = { roundId: meta.roundId, tier: route.tier, task: meta.task ?? directive, runDate: meta.runDate };
  const modelOverrides = { ...route.modelOverrides, ...(deps.modelOverrides ?? {}) };
  return runRound(config, { ...deps, modelOverrides });
}
