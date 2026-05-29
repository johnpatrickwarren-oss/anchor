// @anchor/core — memorial service types (Phase 4). The cross-project learning loop:
// failures become reinforced rules injected into future role prompts; the V/C ratio drives
// pruning. This is the capability no commodity runtime has — Anchor's moat.

export type MemorialStatus = 'active' | 'stabilized' | 'retired';

export interface MemorialEntry {
  id: string;
  trigger: string; // when the discipline applies (free text / keyword the round may match)
  rule: string; // the reinforcement injected into role prompts
  origin: string; // birth event, e.g. "DeploySignal Topic 52"
  vCount: number; // violations
  cCount: number; // confirmations
  status: MemorialStatus;
  lastApplied?: string; // date string — passed in; the store never self-generates dates
  retiredReason?: string;
  retiredOn?: string;
}

export interface RatioRow {
  id: string;
  v: number;
  c: number;
  status: MemorialStatus;
  // V/C diagnostic (skill 02): confirmations should outpace violations. healthy === false
  // is the signal that the rule isn't enforceable as written and needs sharpening/retiring.
  healthy: boolean;
}

// Pluggable persistence so the store is testable in-memory and file-backed in production.
export interface MemorialPersistence {
  load(): MemorialEntry[];
  save(entries: MemorialEntry[]): void;
}
