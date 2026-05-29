// scripts/impl-model-select.ts — Implementer model selector.
// CANONICAL: @anchor/core/routing.selectImplementerClass is the source of truth for these rules; this CLI mirrors it (full code-merge tracked as a follow-up).
// Outputs JSON {round, model, model_class, rationale, decision_path, selector_version, matched_markers, model_source}.
// Bash invokes this and parses the .model field to set MODEL_IMPLEMENTER (when MODEL_ROUTING=true).
//
// The Implementer is the one statically-pinned role whose difficulty varies enough
// round-to-round to warrant a dynamic selector (same criterion that earned the
// Memorial-Updater its selector in R74). It reuses the SAME directive-marker lexicon
// as tier-router.ts so there is one vocabulary of complexity signals, not two:
//   - engine/architectural markers (tier-router's `full` signals)  -> reasoning (Opus)
//   - mechanical markers on implementer-only tier (tier-router's Z-signals) -> cheap (Haiku)
//   - otherwise -> balanced (Sonnet), preserving today's static default.
//
// Model IDs resolve from scripts/models.json (single source of truth); falls back to
// built-in class defaults if the manifest is missing/unreadable.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELECTOR_VERSION = '0.1.0';
const NA = 'n/a';

type Tier = 'full' | 'audit' | 'solo' | 'implementer-only' | 'coordinator-only';
type ModelClass = 'reasoning' | 'balanced' | 'cheap';

const FALLBACK_CLASSES: Record<ModelClass, string> = {
  reasoning: 'claude-opus-4-8',
  balanced: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5-20251001',
};

function resolveClasses(): { classes: Record<ModelClass, string>; source: string } {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifestPath = join(here, 'models.json');
    if (existsSync(manifestPath)) {
      const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (m?.classes?.reasoning && m?.classes?.balanced && m?.classes?.cheap) {
        return { classes: m.classes, source: 'models.json' };
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return { classes: FALLBACK_CLASSES, source: 'built-in-fallback' };
}

interface CLIArgs { directive: string; tier: Tier; }

function parseArgs(argv: string[]): CLIArgs {
  let directive = 'coordination/NEXT-ROLE.md';
  let tier: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--directive': directive = argv[++i]; break;
      case '--tier': tier = argv[++i]; break;
      default:
        process.stderr.write(`impl-model-select: unknown argument: ${argv[i]}\n`);
        process.exit(1);
    }
  }
  if (!tier) {
    process.stderr.write('impl-model-select: --tier <full|audit|solo|implementer-only|coordinator-only> is required\n');
    process.exit(1);
  }
  if (!['full', 'audit', 'solo', 'implementer-only', 'coordinator-only'].includes(tier)) {
    process.stderr.write(`impl-model-select: invalid --tier value: ${tier}\n`);
    process.exit(1);
  }
  return { directive, tier: tier as Tier };
}

function loadDirective(path: string): { content: string; round: string } {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    process.stderr.write(`impl-model-select: directive unreadable: ${path}\n`);
    process.exit(1);
  }
  const raw = readFileSync(absolutePath, 'utf-8');
  const headingRe = /^## § R(\d+) Round-scope directive/m;
  const headingMatch = raw.match(headingRe);
  if (!headingMatch) {
    const round = raw.match(/^CURRENT-ROUND:\s*(R\d+)/m)?.[1] ?? 'unknown';
    return { content: raw, round };
  }
  const round = `R${headingMatch[1]}`;
  const fromHeading = raw.slice(headingMatch.index!);
  const boundaryMatch = fromHeading.search(/\n(?=## § |\n---[ \t]*(?:\n|$))/m);
  const content = boundaryMatch === -1 ? fromHeading : fromHeading.slice(0, boundaryMatch);
  return { content, round };
}

// Same signals tier-router.ts uses to route `full` (high-stakes implementation).
const HIGH_STAKES: RegExp[] = [
  /\bengine\//,
  /architectural-decision/i,
  /architectural-reality/i,
  /validation-corpus failure/i,
  /A1 \(new dependency\)/,
  /A2 \(new architectural pattern\)/,
  /A4 \(novel data model\)/,
];
// Same Z-factor signals tier-router.ts uses to route `implementer-only`.
const MECHANICAL: RegExp[] = [
  /\bmechanical\b/i, /\bcosmetic\b/i, /documentation-only/i, /\bdoc-only\b/i, /\btypo\b/i,
];

function firstHit(content: string, res: RegExp[]): string | null {
  for (const re of res) { const m = content.match(re); if (m) return m[0]; }
  return null;
}

function main(): void {
  const { directive, tier } = parseArgs(process.argv);
  const { content, round } = loadDirective(directive);
  const { classes, source } = resolveClasses();

  const emit = (model_class: ModelClass | null, rationale: string, decision_path: string[], matched: string[]) => {
    process.stdout.write(JSON.stringify({
      round,
      model: model_class ? classes[model_class] : NA,
      model_class: model_class ?? NA,
      rationale,
      decision_path,
      selector_version: SELECTOR_VERSION,
      matched_markers: matched,
      model_source: model_class ? source : NA,
    }) + '\n');
    process.exit(0);
  };

  // Branch 1: tier has no Implementer role
  if (tier === 'coordinator-only') {
    return emit(null, 'Implementer not dispatched on this tier', ['tier_no_implementer'], []);
  }
  // Branch 2: high-stakes implementation wins over everything (upgrade)
  const high = firstHit(content, HIGH_STAKES);
  if (high) {
    return emit('reasoning', `engine/architectural marker -> reasoning tier: ${high}`, ['high_stakes'], [high]);
  }
  // Branch 3: mechanical work on the solo implementer tier (downgrade)
  const mech = firstHit(content, MECHANICAL);
  if (tier === 'implementer-only' && mech) {
    return emit('cheap', `mechanical marker on implementer-only tier -> cheap tier: ${mech}`, ['mechanical'], [mech]);
  }
  // Branch 4: default balanced (preserves today's static Sonnet default)
  return emit('balanced', 'default balanced (no high-stakes or mechanical marker)', ['default_balanced'], []);
}

main();
