// @anchor/core — built-in discipline memorial entries. These are the disciplines the
// engine's gates enforce; seeding them lets a run record V/C against them and inject their
// rules into role prompts (closing the learning loop). Idempotent: only adds what's missing.

import type { MemorialStore } from './store.ts';

export const BUILTIN_DISCIPLINES = [
  { id: 'pre-emit-grilling', trigger: 'spec emit', rule: 'Run a pre-emit grilling pass (CRITICAL / LIKELY-SURFACES / PRE-EMPTABLE) before emitting the spec (skill 01).', origin: 'Anchor skill 01' },
  { id: 'anti-scope', trigger: 'spec emit', rule: 'Every spec must carry an explicit Anti-scope section naming what is NOT in scope (skill 06).', origin: 'Anchor skill 06' },
  { id: 'tests-pass', trigger: 'implementation', rule: 'The full test suite must be GREEN before the round can complete; a failing suite blocks the round (no COMPLETE over red).', origin: 'Anchor test-green gate' },
];

export function seedBuiltinDisciplines(store: MemorialStore): void {
  const have = new Set(store.list().map((e) => e.id));
  for (const d of BUILTIN_DISCIPLINES) if (!have.has(d.id)) store.add(d);
}
