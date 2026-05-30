// @anchor/core — per-role model routing. Ports the dynamic selectors from
// scripts/impl-model-select.ts (R75) and scripts/mu-model-select.ts (R74) into pure
// functions that produce model-override entries for the engine. Static roles keep their
// class defaults (see models.ts); only the Implementer and Memorial-Updater vary by content.

import type { ModelClass, Role, Tier } from '../types.ts';

const HIGH_STAKES = [/\bengine\//, /architectural-decision/i, /architectural-reality/i, /validation-corpus failure/i, /A1 \(new dependency\)/, /A2 \(new architectural pattern\)/, /A4 \(novel data model\)/];
const MECHANICAL = [/\bmechanical\b/i, /\bcosmetic\b/i, /documentation-only/i, /\bdoc-only\b/i, /\btypo\b/i];
const MU_MARKERS = [/cross-project promotion/i, /promote to cross-project/i, /Rule 5 threshold/i, /3-instance threshold/i, /\bMU batch\b/i, /REINFORCEMENT consolidation/i, /\bMR-\d+\s+Pass\b/i, /re-accretion guard/i, /Reviewer-2/, /operator[ -]resolution/i];

const hit = (s: string, res: RegExp[]) => res.some((re) => re.test(s));

// Risk level of a directive — reuses the same HIGH_STAKES signal that drives model routing,
// so "spend opus on it" and "verify it twice" stay in lockstep. Drives adaptive structure
// (a second reviewer pass for load-bearing changes); 'normal' leaves the cycle untouched.
export type RiskLevel = 'high' | 'normal';
export function selectRiskLevel(directive: string): RiskLevel {
  return hit(directive, HIGH_STAKES) ? 'high' : 'normal';
}

// Implementer (R75): engine/architectural -> reasoning; mechanical on implementer-only -> cheap; else balanced.
export function selectImplementerClass(directive: string, tier: Tier): ModelClass {
  if (hit(directive, HIGH_STAKES)) return 'reasoning';
  if (tier === 'implementer-only' && hit(directive, MECHANICAL)) return 'cheap';
  return 'balanced';
}

// Memorial-Updater (R74): full-tier + cross-round marker -> balanced (Sonnet); else cheap (Haiku).
export function selectMemorialClass(directive: string, tier: Tier): ModelClass {
  if (tier === 'full' && hit(directive, MU_MARKERS)) return 'balanced';
  return 'cheap';
}

// Architect (cost-aware): the architect only runs on FULL tier, so the meaningful risk
// signal is whether the change is genuinely architectural. Mirror the implementer: opus
// reasoning for load-bearing work (engine/architectural/novel-pattern/novel-data-model),
// Sonnet for routine full-tier features. The downstream gates (citation/anti-scope) + the
// risk-routed reviewer backstop a Sonnet spec on routine work.
export function selectArchitectClass(directive: string, _tier: Tier): ModelClass {
  if (hit(directive, HIGH_STAKES)) return 'reasoning';   // load-bearing -> opus
  if (hit(directive, MECHANICAL)) return 'cheap';        // typo/doc-only/cosmetic spec -> haiku (faster)
  return 'balanced';                                     // routine -> sonnet
}

// Reviewer (cost-aware): the reviewer is the most expensive role, so route its model by
// change-risk. A load-bearing review (engine/architectural) needs opus reasoning; a clearly
// mechanical/cosmetic change (typo, doc-only, rename) gets a cheaper Sonnet reviewer. The
// default is opus — we only downgrade when the change is unambiguously low-risk, so review
// quality is preserved on anything substantive.
export function selectReviewerClass(directive: string, tier: Tier): ModelClass {
  if (hit(directive, HIGH_STAKES)) return 'reasoning';                    // load-bearing -> opus
  if (tier === 'solo' || tier === 'implementer-only') return 'balanced';  // trivial tiers -> sonnet
  if (hit(directive, MECHANICAL)) return 'balanced';                      // mechanical/cosmetic/doc -> sonnet
  return 'reasoning';                                                     // default: opus (preserve judgment)
}

// Class -> the engine's per-role override map. Returns the roles whose model is
// content-derived (implementer, reviewer, memorial); static roles fall through to the
// models.ts class defaults.
export function selectRoleModelClasses(directive: string, tier: Tier): Partial<Record<Role, ModelClass>> {
  const out: Partial<Record<Role, ModelClass>> = {
    implementer: selectImplementerClass(directive, tier),
    reviewer: selectReviewerClass(directive, tier),
  };
  if (tier === 'full') out.architect = selectArchitectClass(directive, tier); // architect runs on full only
  if (tier === 'full' || tier === 'audit') out.memorial = selectMemorialClass(directive, tier);
  return out;
}
