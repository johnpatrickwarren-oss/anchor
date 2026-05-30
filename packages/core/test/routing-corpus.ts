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
  goldTier: Tier;
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
  { id: 'add-merge', directive: 'New module merge.ts; additive, no score.ts change; pure + deterministic.', goldTier: 'audit',
    goldModels: { reviewer: 'balanced', implementer: 'balanced' }, tags: ['oracle-derived'], rationale: 'Cairn c1: ran green at audit + sonnet reviewer' },
  { id: 'add-topk', directive: 'Add topKWithTies; pure + deterministic; additive.', goldTier: 'audit',
    goldModels: { reviewer: 'balanced' }, tags: ['oracle-derived'], rationale: 'Cairn c2: green at audit + sonnet' },
  { id: 'add-rebalance', directive: 'rebalancePriors: read-only over rankCandidates; additive.', goldTier: 'audit',
    goldModels: { reviewer: 'balanced' }, tags: ['oracle-derived'], rationale: 'Cairn c3: green at audit + sonnet' },
  { id: 'add-helper', directive: 'Add a self-contained formatDuration helper; pure + deterministic.', goldTier: 'audit',
    rationale: 'self-contained additive helper' },
  { id: 'add-validation', directive: 'New additive validation module; no changes to existing code.', goldTier: 'audit',
    rationale: 'new module, additive' },

  // ── substantive but routine (modifies/extends existing) → full (default, safe) ────────────
  { id: 'sub-column', directive: 'Add a sortable column to the users table.', goldTier: 'full',
    rationale: 'touches existing UI + data path; no down-scale signal' },
  { id: 'sub-sso', directive: 'Refactor the auth flow to support SSO.', goldTier: 'full',
    rationale: 'refactors existing load-bearing flow' },
  { id: 'sub-cache', directive: 'Add a caching layer to the API client.', goldTier: 'full',
    rationale: 'cross-cutting change to existing client' },

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

  // ── ambiguous: too terse to tell → safe default ───────────────────────────────────────────
  { id: 'amb-terse', directive: 'add merge', goldTier: 'full',
    tags: ['adversarial'], rationale: 'no scope signal → default to full (safe over-scale on ambiguity)' },

  // ── probe: ideal gold the heuristic may MISS (Layer-2 oracle resolves; reported, not asserted)
  { id: 'probe-existing-logic', directive: 'Change the merge tiebreak in merge.ts to favor recency.', goldTier: 'audit',
    tags: ['probe'], rationale: 'small, isolated change to existing logic — arguably audit, but heuristic defaults to full (over-scale). Oracle TBD' },
  { id: 'probe-additive-contract', directive: 'Additive endpoint that also changes the shared request schema.', goldTier: 'full',
    tags: ['probe'], rationale: 'IDEAL=full (shared contract risk), but "additive" with no engine/ may down-scale to audit — a possible UNDER-scale to watch' },
];
