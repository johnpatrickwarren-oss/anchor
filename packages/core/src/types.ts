// @anchor/core — core types for the role engine.
// Conservative TS (string-union types, no enums/namespaces) so the package runs
// directly under Node's type-stripping (`node --test`) with no build step.

export type Role = 'architect' | 'implementer' | 'reviewer' | 'memorial' | 'coordinator';

// Round-scaling tiers (skills/11-round-scaling.md) + the tier-router's two extra tiers.
export type Tier = 'full' | 'audit' | 'solo' | 'implementer-only' | 'coordinator-only';

// Capability classes; concrete model IDs resolve from a manifest (see models.ts).
export type ModelClass = 'reasoning' | 'balanced' | 'cheap';

// Raw billable token categories (the honest cost shape from the POC — never a bare total).
export interface Usage {
  input: number;
  cache_creation: number;
  cache_read: number;
  output: number;
}

export interface Escalation {
  // A bounded question for the operator — "option A does X, option B does Z, which?"
  question: string;
  options?: string[];
  raisedBy: Role;
}

export type RoleStatus = 'READY' | 'ESCALATE' | 'BLOCKED';

// What the engine asks a runtime to run for one role.
export interface RoleSpec {
  role: Role;
  model: string; // resolved concrete model id
  // Context passed by REFERENCE (paths/handles), lean per role — the explicit fix for the
  // context re-payment measured in the POC. The adapter resolves these for its substrate.
  contextRefs: string[];
  // The role's instruction (system + task). Built by the engine from the round + prior handoffs.
  prompt: string;
  tools?: string[];
}

// What a runtime returns after running a role.
export interface RoleResult {
  role: Role;
  status: RoleStatus;
  artifacts: string[]; // paths written by the role agent
  handoff: Record<string, unknown>; // structured data the next role needs
  usage: Usage;
  escalation?: Escalation; // present iff status === 'ESCALATE'
}

export interface Resolution {
  // Operator's answer to an escalation; fed back so the paused role can resume.
  answer: string;
}

export interface RoundConfig {
  roundId: string; // e.g. 'R01'
  tier: Tier;
  task: string; // the brief / PRD reference
  runDate: string; // passed in — engines must not self-generate dates (POC C0.5)
}

export interface PhaseRecord {
  role: Role;
  model: string;
  status: RoleStatus;
  usage: Usage;
  artifacts: string[];
}

export type RunStatus = 'COMPLETE' | 'PAUSED' | 'BLOCKED';

export interface RunResult {
  roundId: string;
  tier: Tier;
  status: RunStatus;
  phases: PhaseRecord[];
  pausedAt?: Role; // set when status === 'PAUSED' (an unresolved escalation)
  escalation?: Escalation;
  // Advisory (non-blocking) gate findings, accumulated across roles. Blocking findings
  // halt the run (status BLOCKED) instead of landing here.
  warnings: string[];
  // Per-role usage breakdown only — no bare "cost"/"tokens" total (POC AC-7 / instrumented-caveat).
  CAVEAT: string;
}
