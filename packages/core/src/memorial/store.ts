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
  // Optional: decide which entries are relevant to a round (default: any non-retired entry).
  triggerMatcher?: (entry: MemorialEntry, config: RoundConfig) => boolean;
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

  constructor(persistence: MemorialPersistence, opts: MemorialStoreOptions = {}) {
    this.persistence = persistence;
    this.entries = persistence.load();
    this.thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
    this.triggerMatcher = opts.triggerMatcher ?? (() => true);
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
    // Inject each rule PREFIXED with its id (`[id] rule`) so a role (the Reviewer)
    // can cite the id back in an ANCHOR-MEMORIAL-CONFIRM/VIOLATE signal — closing the
    // accrual loop for that specific discipline.
    return this.entries
      .filter((e) => e.status !== 'retired' && this.triggerMatcher(e, config))
      .map((e) => `[${e.id}] ${e.rule}`);
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
