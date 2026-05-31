// @anchor/core — task complexity/risk assessor (routing).
//
// The deterministic marker rules (tier-router.ts rules 1–5) catch tasks phrased in the
// methodology's vocabulary. Everything else used to fall to a hard-coded `full` default —
// "when unsure, run every role." That was the right bias when ROLES were the safety net.
// Now the green-test gate backstops correctness, so under-scaling is cheap to recover from
// and the bias should invert: when unsure, run the LEAN verified loop (audit), and spend the
// full cycle (architect + cold-eye + opus + a 2nd reviewer) only where a bug is genuinely
// expensive and verification can't catch it.
//
// This assesses the task from SEMANTIC signals in the directive — not whether someone typed a
// marker word — and is the home of the "is this actually risky/complex?" judgment.

import type { Tier } from '../types.ts';

// Risk domains: where a bug is expensive AND tests/types often can't catch the *judgment*
// error (security, money, data-loss, schema/migration, concurrency). These earn the full cycle
// + a second cold-eye reviewer regardless of how small the change looks.
export const RISK_DOMAINS: RegExp[] = [
  /\bauth(?:entication|orization)?\b|\blogin\b|\bpassword\b|\bcredential|\b(?:api[- ]?)?token\b|\bsecret\b|\boauth\b|\bsso\b|\bsession\b|\bencrypt|\bcrypto\b/i,
  /\bpayment|\bbilling|\bcharge\b|\binvoice|\bcheckout\b/i,
  /\bmigration|\bschema|\bsql\b|\bdatabase\b|\bddl\b/i,
  /\bconcurren|\brace condition|\bmutex\b|\bdeadlock|\bthread-?safe/i,
  /\bdelete\b|\bdestructive\b|\bdrop table|\bdata[- ]?loss|\bpurge\b|\btruncate\b/i,
  /\bsecurity\b|\bvulnerab|\binjection\b|\bxss\b|\bcsrf\b/i,
];

// Brownfield: the work MODIFIES existing code (regression risk → at least a cold-eye review).
const BROWNFIELD: RegExp[] = [
  /\brefactor|\brewrite|\bmigrate|\boverhaul|\bport\b/i,
  /\b(?:modif|chang|updat|replac|extend|alter|revamp|rework)(?:e|es|ed|ing|y|ies)?\b/i,
  /\bexisting\b/i,
  /\bthe (?:existing )?\w+ (?:flow|layer|client|module|pipeline|system|service|endpoint|component|handler|store)\b/i,
];

// Cross-cutting: spans many places → high blast radius (the gate alone won't cover the breadth).
const CROSS_CUTTING: RegExp[] = [
  /\bcross[- ]cutting\b|\b(?:across|throughout)\b|\bmiddleware\b|\bevery(?:where| \w+)\b/i,
  /\b(?:caching )?layer\b/i,
];

export const hasRiskDomain = (directive: string): boolean => RISK_DOMAINS.some((re) => re.test(directive));

export interface Assessment {
  tier: Tier;
  high: boolean;       // genuine high-risk → also earns the adaptive 2nd reviewer
  signals: string[];   // which signals fired (for transparency in the route output)
}

// Assess an UN-MARKED task (rules 1–5 already missed). Returns the lean default unless the task
// is genuinely high-risk. Never returns solo/implementer-only — that down-scale is reserved for
// explicitly mechanical work (rule 3); the policy keeps a cold-eye reviewer for anything
// substantive (cheap insurance), and only ADDS the architect + 2nd reviewer for high-risk.
export function assessTask(directive: string): Assessment {
  const signals: string[] = [];
  const risk = hasRiskDomain(directive);
  const brownfield = BROWNFIELD.some((re) => re.test(directive));
  const crossCutting = CROSS_CUTTING.some((re) => re.test(directive));
  if (risk) signals.push('risk-domain');
  if (brownfield) signals.push('brownfield');
  if (crossCutting) signals.push('cross-cutting');

  // full: a risk domain, OR a broad change to existing code (blast radius verification can't bound).
  if (risk || (brownfield && crossCutting)) return { tier: 'full', high: true, signals };

  // lean default: the verified loop (implementer + cold-eye reviewer + memorial + green-test gate),
  // minus the expensive architect. Covers ambiguous, greenfield-additive, and contained changes.
  return { tier: 'audit', high: false, signals: signals.length ? signals : ['lean-default'] };
}
