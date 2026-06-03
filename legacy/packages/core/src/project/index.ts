// @anchor/core — project decomposition + dependency-aware staging.
//
// The tier-router scales the ROLE SET per round; wave fans out INDEPENDENT features. The
// missing layer (the methodology's Coordinator, done by hand) is turning ONE project directive
// into the set of features + their dependency edges, then scheduling them: features with no
// unmet dependency run concurrently (one wave), dependent features wait for their inputs.
//
// This module is the PURE half — parse the Coordinator's declared features and topologically
// group them into stages. No model, no git, no I/O; fully deterministic and unit-tested. The
// orchestration half (run the Coordinator to GET the features, then run a wave per stage on
// real worktrees) lives in run-project.ts and builds on this.

/** One independently-schedulable feature of a project. */
export interface Feature {
  /** Stable id — the wave item id, the dependency key. */
  id: string;
  /** The feature's brief; self-routes its own tier when run (like any directive). */
  directive: string;
  /** ids of features that must COMPLETE before this one can start. */
  dependsOn: string[];
}

/** Features grouped into a run order: every stage runs concurrently; stages run in sequence. */
export type Stage = Feature[];

// One feature per line, mirroring the Architect's ANCHOR-UNIT convention:
//   ANCHOR-FEATURE [id]: <scope>
//   ANCHOR-FEATURE [id] deps=[a, b]: <scope>
// Tolerant: deps optional, whitespace-flexible, case-insensitive, dedup by id (first wins). The
// leading `[\s>*\-\d.)]*` swallows list/quote markers models love to add (`- `, `* `, `1. `,
// `1) `, `> `) so a bulleted plan still parses; prose like "the ANCHOR-FEATURE" won't match.
const FEATURE_RE = /^[ \t>*\-\d.)]*ANCHOR-FEATURE\s*\[([^\]]+)\]\s*(?:deps\s*=\s*\[([^\]]*)\])?\s*:\s*(.+)$/gim;

/** Parse a Coordinator's ANCHOR-FEATURE lines into features. Lines without the marker are
 *  ignored, so the Coordinator can narrate around the plan. No lines → []. */
export function parseFeatures(text: string): Feature[] {
  const features: Feature[] = [];
  for (const m of text.matchAll(FEATURE_RE)) {
    const id = m[1].trim();
    const dependsOn = (m[2] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const directive = m[3].trim();
    if (!id || !directive) continue;
    if (features.some((f) => f.id === id)) continue; // first declaration wins
    features.push({ id, directive, dependsOn });
  }
  return features;
}

/**
 * Group features into dependency-ordered stages (Kahn's algorithm, level by level).
 *
 * - Stage 0 = features with no dependencies.
 * - Stage k = features whose every dependency landed in a stage < k.
 * - Within a stage, features are mutually independent → safe to run concurrently.
 * - Order within a stage follows input order (stable / replay-deterministic).
 *
 * Throws on a missing dependency reference or a dependency cycle (both are plan bugs the
 * Coordinator must fix — we fail loud rather than silently dropping work).
 */
export function planStages(features: Feature[]): Stage[] {
  const byId = new Map(features.map((f) => [f.id, f]));

  // Validate references up front so the error names the offending edge, not a vague cycle.
  const dupes = features.map((f) => f.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate feature id(s): ${[...new Set(dupes)].join(', ')}`);
  for (const f of features) {
    for (const d of f.dependsOn) {
      if (!byId.has(d)) throw new Error(`feature "${f.id}" depends on unknown feature "${d}"`);
      if (d === f.id) throw new Error(`feature "${f.id}" depends on itself`);
    }
  }

  const placed = new Set<string>();
  const stages: Stage[] = [];
  let remaining = [...features];

  while (remaining.length) {
    // A feature is ready when all its deps are already placed in an earlier stage.
    const ready = remaining.filter((f) => f.dependsOn.every((d) => placed.has(d)));
    if (ready.length === 0) {
      throw new Error(`dependency cycle among: ${remaining.map((f) => f.id).join(', ')}`);
    }
    stages.push(ready);
    for (const f of ready) placed.add(f.id);
    remaining = remaining.filter((f) => !placed.has(f.id));
  }
  return stages;
}

/** Human-readable rendering of a staged plan (for `anchor project --dry-run`). */
export function renderStages(stages: Stage[]): string {
  if (stages.length === 0) return '(no features)';
  return stages
    .map((stage, i) => {
      const rows = stage
        .map((f) => `    - ${f.id}${f.dependsOn.length ? ` (after ${f.dependsOn.join(', ')})` : ''}: ${f.directive}`)
        .join('\n');
      const conc = stage.length > 1 ? ` — ${stage.length} in parallel` : '';
      return `  stage ${i + 1}${conc}:\n${rows}`;
    })
    .join('\n');
}
