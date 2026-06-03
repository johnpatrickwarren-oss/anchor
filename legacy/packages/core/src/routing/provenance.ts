// @anchor/core — routing provenance + model-drift detection.
//
// The routing labels (tier corpus + per-role model classes) and the live oracle were grounded
// under a specific set of models at a specific date. If Anthropic ships a NEW model, those labels
// may be stale — the cheapest-sufficient config could shift. We can't know that without re-running
// the oracle (a paid grid), but we CAN detect drift cheaply (list models, diff) and fail SAFE:
// when an ungrounded model is in play, bias routing toward over-provisioning (full tier / reasoning
// models) until the oracle re-confirms cheaper configs. Under-scaling is the only dangerous error,
// so "unmeasured model → over-provision" is never a quality risk, only a temporary cost.

import { DEFAULT_MANIFEST } from '../models.ts';

export interface RoutingProvenance {
  groundedDate: string;      // when the labels/oracle were last re-grounded
  models: string[];          // the concrete model ids the grounding was measured under
}

// The baseline. Bump this (via `anchor calibrate --accept`, or by hand after an oracle re-run)
// whenever the routing labels are re-grounded against a new model set.
export const ROUTING_PROVENANCE: RoutingProvenance = {
  groundedDate: '2026-05-30',
  models: Object.values(DEFAULT_MANIFEST.classes), // opus-4-8 / sonnet-4-6 / haiku-4-5
};

export interface DriftResult {
  drifted: boolean;
  newModels: string[];       // available but not grounded — the ungrounded ones
  groundedDate: string;
}

// Compare the models the API currently offers against the grounded set. `available` is the live
// model-id list (from the /v1/models endpoint). Extra grounded ids the operator has since
// validated can be passed in `grounded` (e.g. merged from a calibrate override file).
export function checkModelDrift(available: string[], grounded: string[] = ROUTING_PROVENANCE.models): DriftResult {
  const known = new Set(grounded);
  // Only count models the routing would actually consider — a new model id we never route to is
  // irrelevant until adopted. Here "relevant" = any model the API offers that we haven't grounded;
  // callers may pre-filter `available` to the family they care about.
  const newModels = available.filter((m) => !known.has(m));
  return { drifted: newModels.length > 0, newModels, groundedDate: ROUTING_PROVENANCE.groundedDate };
}
