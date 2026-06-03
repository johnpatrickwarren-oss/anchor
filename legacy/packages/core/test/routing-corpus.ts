// Routing accuracy corpus (Layer 1). Each case carries an INDEPENDENT expert/oracle gold tier
// (and, where it matters, gold per-role model classes) so routing-accuracy.test.ts can measure
// how well classifyTier / selectRoleModelClasses match intent — not just match themselves.
//
// Gold is the MINIMUM-SUFFICIENT config: the cheapest tier/model that still yields COMPLETE +
// green + correct. `oracle-derived` cases were confirmed by live runs (the Cairn features ran
// green at audit with a sonnet reviewer — see ANCHOR-VS-DYNAMICWORKFLOW-COMPLEX-R2.md).
//
// Tags:
//   adversarial         — surface phrasing that could fool a keyword heuristic
//   intentional-overscale — gold deliberately over-provisions (e.g. anything in engine/)
//   oracle-derived      — gold confirmed by a live oracle run, not just judgment
//   probe               — gold is the IDEAL; the heuristic may diverge. Reported, NOT hard-asserted
//                         (the Layer-2 oracle resolves these; they are the watch-list).

import type { Tier, Role, ModelClass } from '../src/index.ts';

export interface CorpusCase {
  id: string;
  directive: string;
  goldTier: Tier;            // the POLICY pick — what the classifier SHOULD choose. May deliberately
                             // over-scale the oracle for safety/learning (a justified premium).
  oracleTier?: Tier;         // the empirically cheapest-sufficient tier (LIVE-confirmed), where known.
                             // gold ≥ oracle; the gap is the policy's safety/learning premium.
  goldModels?: Partial<Record<Role, ModelClass>>;
  tags?: string[];
  rationale: string;
}

export const ROUTING_CORPUS: CorpusCase[] = [
  // ── trivial / mechanical → just the implementer ──────────────────────────────────────────
  { id: 'mech-typo', directive: 'Fix a typo in the README (doc-only).', goldTier: 'implementer-only',
    goldModels: { implementer: 'cheap' }, rationale: 'doc-only typo; no review needed' },
  { id: 'mech-rename', directive: 'Mechanical rename of foo to bar across the utils module.', goldTier: 'implementer-only',
    goldModels: { implementer: 'cheap' }, rationale: 'pure mechanical rename' },
  { id: 'mech-cosmetic', directive: 'Cosmetic: reformat the CLI help text.', goldTier: 'implementer-only',
    rationale: 'cosmetic formatting' },
  { id: 'mech-docs', directive: 'Documentation-only update to CONTRIBUTING.md.', goldTier: 'implementer-only',
    rationale: 'doc-only' },

  // ── self-contained additive → audit (no separate architect; gate + reviewer backstop) ─────
  // oracleTier=implementer-only: the Layer-2 grid confirmed the implementer + green-test gate alone
  // ships these green ($0.65/feat) — but audit ($0.70) is only ~$0.05 more and adds cold-eye review
  // + memorial learning, so the policy (gold=audit) over-scales the oracle by a negligible premium.
  { id: 'add-merge', directive: 'New module merge.ts; additive, no score.ts change; pure + deterministic.', goldTier: 'audit', oracleTier: 'implementer-only',
    goldModels: { reviewer: 'balanced', implementer: 'balanced' }, tags: ['oracle-derived'], rationale: 'Cairn c1: green at audit+sonnet AND at implementer-only; audit premium ~$0.05 buys review+learning' },
  { id: 'add-topk', directive: 'Add topKWithTies; pure + deterministic; additive.', goldTier: 'audit', oracleTier: 'implementer-only',
    goldModels: { reviewer: 'balanced' }, tags: ['oracle-derived'], rationale: 'Cairn c2: green at audit and implementer-only' },
  { id: 'add-rebalance', directive: 'rebalancePriors: read-only over rankCandidates; additive.', goldTier: 'audit', oracleTier: 'implementer-only',
    goldModels: { reviewer: 'balanced' }, tags: ['oracle-derived'], rationale: 'Cairn c3: green at audit and implementer-only' },
  { id: 'add-helper', directive: 'Add a self-contained formatDuration helper; pure + deterministic.', goldTier: 'audit',
    rationale: 'self-contained additive helper' },
  { id: 'add-validation', directive: 'New additive validation module; no changes to existing code.', goldTier: 'audit',
    rationale: 'new module, additive' },

  // ── substantive but routine → LEAN by default; full only for genuine high-risk ────────────
  // Policy (R-lean): the green-test gate backstops correctness, so an un-marked task defaults to
  // the verified loop (audit), NOT full. Full is reserved for risk domains (auth/schema/data-loss)
  // and broad changes to existing code. (Was: everything here defaulted to full.)
  { id: 'sub-column', directive: 'Add a sortable column to the users table.', goldTier: 'audit',
    rationale: 'contained change; cold-eye reviewer + green-test gate suffice — no architect, no full' },
  { id: 'sub-sso', directive: 'Refactor the auth flow to support SSO.', goldTier: 'full',
    rationale: 'risk domain (auth/SSO) + refactor of a load-bearing flow → full + 2nd reviewer' },
  { id: 'sub-cache', directive: 'Add a caching layer to the API client.', goldTier: 'full',
    rationale: 'cross-cutting (caching layer) over an existing client → full; blast radius the gate won\'t bound' },

  // ── high-stakes / architectural → full + reasoning models ─────────────────────────────────
  { id: 'hs-engine', directive: 'Modify engine/detectors/fcp.ts.', goldTier: 'full',
    goldModels: { architect: 'reasoning', implementer: 'reasoning', reviewer: 'reasoning' }, tags: ['high-stakes'], rationale: 'engine/ load-bearing' },
  { id: 'hs-pattern', directive: 'A2 (new architectural pattern): switch to middleware.', goldTier: 'full',
    goldModels: { reviewer: 'reasoning' }, tags: ['high-stakes'], rationale: 'new architectural pattern' },
  { id: 'hs-decision', directive: 'architectural-decision: adopt event sourcing.', goldTier: 'full',
    goldModels: { reviewer: 'reasoning' }, tags: ['high-stakes'], rationale: 'architectural decision' },
  { id: 'hs-dep', directive: 'A1 (new dependency): add a redis client.', goldTier: 'full',
    goldModels: { reviewer: 'reasoning' }, tags: ['high-stakes'], rationale: 'new dependency' },
  { id: 'hs-corpus', directive: 'validation-corpus failure: rerun and fix the detector.', goldTier: 'full',
    tags: ['high-stakes'], rationale: 'validation-corpus failure marker' },

  // ── coordinator-only (wave orchestration, not implementation) ─────────────────────────────
  { id: 'coord-plan', directive: 'Coordinator wave plan for wave 5.', goldTier: 'coordinator-only',
    rationale: 'wave planning' },
  { id: 'coord-gate', directive: 'WAVE-GATE-7 close.', goldTier: 'coordinator-only',
    rationale: 'wave-gate close' },

  // ── audit markers (methodology / consolidation) ───────────────────────────────────────────
  { id: 'aud-method', directive: 'methodology REINFORCEMENT consolidation.', goldTier: 'audit',
    rationale: 'methodology pass' },
  { id: 'aud-mr', directive: 'MR-12 Pass: re-accretion guard.', goldTier: 'audit',
    rationale: 'memorial-review pass' },

  // ── adversarial: surface phrasing must NOT fool the classifier ─────────────────────────────
  { id: 'adv-additive-engine', directive: 'Additive change to engine/score.ts.', goldTier: 'full',
    tags: ['adversarial'], rationale: 'additive wording must NOT downgrade an engine/ change — high-stakes wins' },
  { id: 'adv-scary-typo', directive: 'Architectural cleanup of a typo in the logger.', goldTier: 'implementer-only',
    tags: ['adversarial'], rationale: '"architectural" is just vocabulary; the work is a typo — must not over-scale to full' },
  { id: 'adv-engine-typo', directive: 'Trivial typo fix in engine/util.ts.', goldTier: 'full',
    tags: ['adversarial', 'intentional-overscale'], rationale: 'a typo, but in load-bearing engine/ — the guard deliberately over-scales (safe)' },
  { id: 'adv-additive-shared', directive: 'Small additive helper, but it touches engine/ scoring internals.', goldTier: 'full',
    tags: ['adversarial'], rationale: 'additive + engine/ → full (engine guard beats the additive down-scale)' },
  { id: 'adv-escalate', directive: 'ESCALATE: operator decision needed on the data model.', goldTier: 'full',
    rationale: 'explicit escalation → full' },

  // ── ambiguous: too terse to tell → LEAN default (gate backstops) ──────────────────────────
  { id: 'amb-terse', directive: 'add merge', goldTier: 'audit',
    tags: ['adversarial'], rationale: 'no scope signal → lean verified loop (audit), NOT full; the green-test gate backstops, so under-scaling is cheap to recover' },

  { id: 'sub-existing-logic', directive: 'Change the merge tiebreak in merge.ts to favor recency.', goldTier: 'audit',
    rationale: 'small, contained change to existing logic → the assessor lands audit (was an over-scale to full)' },
  { id: 'add-contract-schema', directive: 'Additive endpoint that also changes the shared request schema.', goldTier: 'full',
    rationale: 'risk domain (schema) blocks the additive down-scale → full; the assessor resolves what was an under-scale watch' },
];
