// @anchor/core — tier classifier (routing). Ports the deterministic heuristic rules from
// integrations/superpowers-claude-code/scripts/tier-router-criteria.md (R73) so the engine
// can self-route a round's tier from its directive instead of taking the tier as an input.
//
// SCOPE: this is the deterministic heuristic (rules 1–5, first match wins). The production
// tier-router also has a hybrid Haiku-tiebreaker for the ambiguous default case; that needs
// a model call and is out of scope for a pure function — here the default falls back to
// 'full' (the documented heuristic-mode escape hatch).
//
// NOTE (dedup): this establishes @anchor/core as the canonical routing home. The legacy
// scripts/tier-router.ts should become a thin wrapper over this to avoid two rule copies.

import type { Tier } from '../types.ts';

export interface TierClassification {
  tier: Tier;
  confidence: number;
  matched: string; // the rule/marker that fired
}

const has = (s: string, re: RegExp) => re.test(s);

export function classifyTier(directive: string): TierClassification {
  const d = directive;

  // Rule 1 — coordinator-only (0.90)
  if (has(d, /Coordinator wave plan/) || has(d, /WAVE-GATE-\w+ close/) || has(d, /CLUSTER-HANDOFF/) ||
      has(d, /operator-decision backlog/) || has(d, /^\s*\(Coordinator —/m) || has(d, /--coordinator\b/)) {
    return { tier: 'coordinator-only', confidence: 0.90, matched: 'coordinator-only marker' };
  }

  // Rule 2 — full (0.85)
  const fullMarker =
    (has(d, /\bESCALATE\b/) && 'ESCALATE') ||
    (has(d, /HALT \+ DIAGNOSTIC/) && 'HALT + DIAGNOSTIC') ||
    (has(d, /architectural-decision|architectural-reality/) && 'architectural-decision/reality') ||
    (has(d, /R61-class/) && 'R61-class') ||
    (has(d, /validation-corpus failure/) && 'validation-corpus failure') ||
    (has(d, /\bengine\//) && 'engine/ path') ||
    (has(d, /--tier full\b/) && '--tier full') ||
    (has(d, /A1 \(new dependency\)|A2 \(new architectural pattern\)|A4 \(novel data model\)/) && 'A-factor');
  if (fullMarker) return { tier: 'full', confidence: 0.85, matched: fullMarker };

  // Rule 3 — implementer-only (0.80): mechanical/doc/cosmetic AND no escalation/engine/arch markers.
  // (Simplification: the production rule also requires ALLOWED_SET ≤ 3 paths; omitted here.)
  if (has(d, /\bmechanical\b|\bcosmetic\b|documentation-only|\bdoc-only\b|\btypo\b/) &&
      !has(d, /\bESCALATE\b|\bDIAGNOSTIC\b|\bengine\/|architectural-decision/)) {
    return { tier: 'implementer-only', confidence: 0.80, matched: 'mechanical/doc/cosmetic' };
  }

  // Rule 4 — audit (0.75): methodology/consolidation passes.
  if (has(d, /\bmethodology\b/) || has(d, /REINFORCEMENT consolidation/) || has(d, /\bMR-\d+ Pass\b/) ||
      has(d, /re-accretion guard/) || has(d, /--tier audit\b/) || has(d, /audit-tier/)) {
    return { tier: 'audit', confidence: 0.75, matched: 'audit marker' };
  }

  // Rule 5 — audit (0.70): a SELF-CONTAINED ADDITIVE change (new module / additive / pure+
  // deterministic / read-only) with no high-stakes markers needs review but NOT a separate
  // cold-eye architect — the Implementer self-specs from the directive, the Reviewer + green-
  // test gate backstop it. This is "the scope decides it doesn't need the architect": it drops
  // the biggest wall-driver (the architect ~37%) for work that doesn't warrant a separate spec.
  const additive =
    (has(d, /\badditive\b/) && 'additive') ||
    (has(d, /\bnew module\b/) && 'new module') ||
    (has(d, /\bself-contained\b/) && 'self-contained') ||
    (has(d, /\bread-only\b/) && 'read-only') ||
    (has(d, /\bpure\b/) && has(d, /\bdeterministic\b/) && 'pure+deterministic');
  if (additive && !has(d, /\bESCALATE\b/) && !has(d, /\bengine\//) && !has(d, /architectural/)) {
    return { tier: 'audit', confidence: 0.70, matched: `${additive} -> audit (no separate architect)` };
  }

  // Rule 6 — default (0.50): heuristic-mode escape hatch -> full.
  return { tier: 'full', confidence: 0.50, matched: 'default (no rule matched)' };
}
