// @anchor/core — the memorial store (Phase 4): implements MemorialPort (so it drops into
// the engine's `memorial` seam) plus the richer authoring/diagnostic API.
//
// Disciplines from skills/02-memorial-accretion.md realized in code:
//   - accretion: each violation/confirmation updates the entry's V/C counts
//   - reinforcement injection: applicable() returns the rules the engine folds into prompts
//   - pruning: prune() promotes well-internalized entries to 'stabilized' and retires the
//     fully-stabilized ones — guarding against "memorial bankruptcy" (a catalog of noise)
//   - retired entries are NEVER deleted ("the audit trail doesn't lie about its own past")
//
// Determinism: the store never calls Date.now(); callers pass dates (the engine has runDate).

import type { MemorialEntry, MemorialPersistence, RatioRow } from './types.ts';
import type { RoundConfig } from '../types.ts';
import type { MemorialPort } from '../role-engine.ts';

export interface PruneThresholds {
  stabilizeAt: number; // confirmations (with 0 violations) to mark 'stabilized'
  retireAt: number; // confirmations (with 0 violations) to auto-retire
}

const DEFAULT_THRESHOLDS: PruneThresholds = { stabilizeAt: 10, retireAt: 20 };

export interface MemorialStoreOptions {
  thresholds?: PruneThresholds;
  // Optional hard filter: decide which entries are even eligible for a round (default: any
  // non-retired entry).
  triggerMatcher?: (entry: MemorialEntry, config: RoundConfig) => boolean;
  // Optional soft cap on how many rules inject per round — the self-limiting lever. When
  // set, applicable() always injects "live" rules (violations > confirmations) and then the
  // top-`injectCap` most RELEVANT of the rest. Unset = inject all eligible (legacy).
  injectCap?: number;
  // Relevance scorer used when injectCap is set (default: keyword overlap with the task).
  relevance?: (entry: MemorialEntry, config: RoundConfig) => number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with', 'add', 'new',
  'any', 'that', 'this', 'use', 'via', 'change', 'changes', 'into', 'from', 'its',
  'must', 'should', 'only', 'when', 'each', 'not', 'are', 'make', 'made', 'also',
  'per', 'such', 'than', 'then', 'over', 'how', 'why', 'all', 'one', 'two',
]);

// Word tokens (≥3 chars, not stopwords), lowercased + deduped.
function tokenize(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t)))];
}

// Two tokens are "related" if identical, or they share a ≥4-char prefix. The prefix rule
// folds morphological variants (scoring↔score, test↔tests↔testing, config↔configuration)
// while rejecting short coincidences (cli↔client, api↔application) — and it avoids a
// stemmer's over-stemming. Exact-match keeps short domain tokens (ssl, p99) matchable.
function related(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= 4;
}

/** Default relevance of a rule to the round. Each task token that matches the rule's
 *  TRIGGER (the author's explicit "when this applies") scores 2; matching only the rule
 *  body scores 1. Matching is morphology-aware + word-boundary (see `related`), so it
 *  catches variant word forms without the false positives of bare substring search.
 *  Pure + deterministic. */
export function keywordRelevance(entry: MemorialEntry, config: RoundConfig): number {
  const trigger = tokenize(entry.trigger);
  const body = tokenize(entry.rule);
  const task = tokenize(config.task ?? '');
  let score = 0;
  for (const t of task) {
    if (trigger.some((r) => related(t, r))) score += 2;
    else if (body.some((r) => related(t, r))) score += 1;
  }
  return score;
}

export class MemoryPersistence implements MemorialPersistence {
  private entries: MemorialEntry[];
  constructor(seed: MemorialEntry[] = []) { this.entries = seed; }
  load(): MemorialEntry[] { return this.entries.map((e) => ({ ...e })); }
  save(entries: MemorialEntry[]): void { this.entries = entries.map((e) => ({ ...e })); }
}

export class MemorialStore implements MemorialPort {
  private entries: MemorialEntry[];
  private persistence: MemorialPersistence;
  private thresholds: PruneThresholds;
  private triggerMatcher: (entry: MemorialEntry, config: RoundConfig) => boolean;
  private injectCap?: number;
  private relevance: (entry: MemorialEntry, config: RoundConfig) => number;

  constructor(persistence: MemorialPersistence, opts: MemorialStoreOptions = {}) {
    this.persistence = persistence;
    this.entries = persistence.load();
    this.thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
    this.triggerMatcher = opts.triggerMatcher ?? (() => true);
    this.injectCap = opts.injectCap;
    this.relevance = opts.relevance ?? keywordRelevance;
  }

  private flush(): void { this.persistence.save(this.entries); }
  private find(id: string): MemorialEntry {
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw new Error(`memorial: no entry "${id}"`);
    return e;
  }

  // ── Authoring ──
  add(entry: Omit<MemorialEntry, 'vCount' | 'cCount' | 'status'> & Partial<Pick<MemorialEntry, 'vCount' | 'cCount' | 'status'>>): void {
    if (this.entries.some((e) => e.id === entry.id)) throw new Error(`memorial: duplicate id "${entry.id}"`);
    this.entries.push({ vCount: 0, cCount: 0, status: 'active', ...entry });
    this.flush();
  }

  list(): MemorialEntry[] { return this.entries.map((e) => ({ ...e })); }

  // ── Accretion ──
  recordConfirmation(id: string, date?: string): void { const e = this.find(id); e.cCount++; if (date) e.lastApplied = date; this.flush(); }
  recordViolation(id: string, date?: string): void {
    const e = this.find(id);
    e.vCount++;
    if (date) e.lastApplied = date;
    if (e.status === 'stabilized') e.status = 'active'; // a fresh violation re-opens it
    this.flush();
  }

  // Explicit retirement (e.g., the failure mode was structurally eliminated by a tool).
  retire(id: string, reason: string, date?: string): void {
    const e = this.find(id);
    e.status = 'retired';
    e.retiredReason = reason;
    if (date) e.retiredOn = date;
    this.flush();
  }

  // ── MemorialPort (engine seam) ──
  async applicable(config: RoundConfig): Promise<string[]> {
    // Eligible = non-retired and passing the hard trigger filter.
    const eligible = this.entries.filter((e) => e.status !== 'retired' && this.triggerMatcher(e, config));
    const selected = this.injectCap === undefined ? eligible : this.selectRelevant(eligible, config, this.injectCap);
    // Inject each rule PREFIXED with its id (`[id] rule`) so a role (the Reviewer) can cite
    // the id back in an ANCHOR-MEMORIAL-CONFIRM/VIOLATE signal — closing the accrual loop.
    return selected.map((e) => `[${e.id}] ${e.rule}`);
  }

  // Self-limiting selection: always keep "live" rules (violations outpace confirmations —
  // an active recurring problem must never be dropped to a cap), then the top-`cap` most
  // relevant of the rest. Output preserves original entry order for stable injection.
  private selectRelevant(eligible: MemorialEntry[], config: RoundConfig, cap: number): MemorialEntry[] {
    const live = eligible.filter((e) => e.vCount > e.cCount);
    const rest = eligible.filter((e) => !(e.vCount > e.cCount));
    const ranked = [...rest]
      .sort((a, b) => {
        const d = this.relevance(b, config) - this.relevance(a, config);
        return d !== 0 ? d : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // deterministic tiebreak
      })
      .slice(0, Math.max(0, cap));
    const keep = new Set([...live, ...ranked].map((e) => e.id));
    return eligible.filter((e) => keep.has(e.id));
  }

  async record(kind: 'violation' | 'confirmation', context: Record<string, unknown>): Promise<void> {
    const id = typeof context.memorialId === 'string' ? context.memorialId : undefined;
    const date = typeof context.date === 'string' ? context.date : undefined;
    if (!id) return; // no attribution -> nothing to accrete (callers pass context.memorialId)
    // Tolerate unknown/hallucinated ids: this path consumes model-emitted signals, so an
    // id that doesn't exist is ignored (no throw) rather than crashing the run. The strict
    // authoring methods (recordConfirmation/recordViolation) still throw on unknown ids.
    if (!this.entries.some((e) => e.id === id)) return;
    if (kind === 'confirmation') this.recordConfirmation(id, date);
    else this.recordViolation(id, date);
  }

  // ── Pruning / diagnostics (skill 02) ──
  prune(date?: string): { stabilized: string[]; retired: string[] } {
    const stabilized: string[] = [];
    const retired: string[] = [];
    for (const e of this.entries) {
      if (e.status === 'retired') continue;
      if (e.vCount === 0 && e.cCount >= this.thresholds.retireAt) {
        e.status = 'retired';
        e.retiredReason = `stabilized: ${e.cCount} confirmations, 0 violations`;
        if (date) e.retiredOn = date;
        retired.push(e.id);
      } else if (e.vCount === 0 && e.cCount >= this.thresholds.stabilizeAt) {
        if (e.status !== 'stabilized') { e.status = 'stabilized'; stabilized.push(e.id); }
      }
    }
    this.flush();
    return { stabilized, retired };
  }

  ratios(): RatioRow[] {
    return this.entries.map((e) => ({ id: e.id, v: e.vCount, c: e.cCount, status: e.status, healthy: e.cCount >= e.vCount }));
  }
}
