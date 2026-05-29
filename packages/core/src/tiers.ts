// @anchor/core — tier -> dispatched role set.
//
// Encodes which roles run for each tier (skills/11-round-scaling.md + the tier-router's
// implementer-only/coordinator-only tiers). This is the role-SET mapping only; the
// tier CLASSIFICATION (which tier a round is) is a separate concern handled by the
// existing tier-router and plugs in upstream of the engine.

import type { Role, Tier } from './types.ts';

const ROLES_BY_TIER: Record<Tier, Role[]> = {
  // Architect cold-eye spec + the full cycle.
  full: ['architect', 'implementer', 'reviewer', 'memorial'],
  // Implementer self-specs; cold-eye Reviewer audits; Memorial accretes. No separate Architect.
  audit: ['implementer', 'reviewer', 'memorial'],
  // Mechanical/doc/cosmetic: Implementer only, memorial inline (not a separate dispatch).
  solo: ['implementer'],
  'implementer-only': ['implementer'],
  // Wave planning / wave-gate close — Coordinator only, no implementation cycle.
  'coordinator-only': ['coordinator'],
};

export function rolesForTier(tier: Tier): Role[] {
  const roles = ROLES_BY_TIER[tier];
  if (!roles) throw new Error(`unknown tier: ${tier}`);
  return [...roles];
}
