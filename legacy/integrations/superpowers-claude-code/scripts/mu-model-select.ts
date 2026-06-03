// scripts/mu-model-select.ts — Memorial-Updater model selector (R74).
// CANONICAL: @anchor/core/routing.selectMemorialClass is the source of truth for these rules; this CLI mirrors it (full code-merge tracked as a follow-up).
// Outputs JSON {round, model, rationale, decision_path, selector_version, matched_anchors}.
// Bash invokes this and parses the model field to set MODEL_MEMORIAL.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SELECTOR_VERSION = '0.1.0';
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const NA = 'n/a';

type Tier = 'full' | 'audit' | 'solo' | 'coordinator-only';

interface SelectorResult {
  round: string;
  model: string;
  rationale: string;
  decision_path: string[];
  selector_version: string;
  matched_anchors: string[];
}

interface CLIArgs {
  directive: string;
  tier: Tier;
  muSonnet: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  let directive = 'coordination/NEXT-ROLE.md';
  let tier: string | undefined;
  let muSonnet = false;

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--directive': directive = argv[++i]; break;
      case '--tier':      tier = argv[++i]; break;
      case '--mu-sonnet': muSonnet = true; break;
      default:
        process.stderr.write(`mu-model-select: unknown argument: ${argv[i]}\n`);
        process.exit(1);
    }
  }
  if (!tier) {
    process.stderr.write('mu-model-select: --tier <full|audit|solo|coordinator-only> is required\n');
    process.exit(1);
  }
  if (!['full', 'audit', 'solo', 'coordinator-only'].includes(tier)) {
    process.stderr.write(`mu-model-select: invalid --tier value: ${tier}\n`);
    process.exit(1);
  }
  return { directive, tier: tier as Tier, muSonnet };
}

function loadDirective(path: string): { content: string; round: string } {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    process.stderr.write(`mu-model-select: directive unreadable: ${path}\n`);
    process.exit(1);
  }
  const raw = readFileSync(absolutePath, 'utf-8');

  // Extract the most recent `## § R{N} Round-scope directive` section.
  // Same boundary logic as tier-router.ts: find next `## § ` heading or `---` separator.
  const headingRe = /^## § R(\d+) Round-scope directive/m;
  const headingMatch = raw.match(headingRe);
  if (!headingMatch) {
    const round = raw.match(/^CURRENT-ROUND:\s*(R\d+)/m)?.[1] ?? 'unknown';
    return { content: raw, round };
  }
  const round = `R${headingMatch[1]}`;
  const startIdx = headingMatch.index!;
  const fromHeading = raw.slice(startIdx);
  const boundaryMatch = fromHeading.search(/\n(?=## § |\n---[ \t]*(?:\n|$))/m);
  const content = boundaryMatch === -1 ? fromHeading : fromHeading.slice(0, boundaryMatch);
  return { content, round };
}

interface AnchorHit { class: 'A' | 'B' | 'C' | 'D'; anchor: string; }

function checkAnchorClasses(content: string): AnchorHit[] {
  const hits: AnchorHit[] = [];

  // Class A — cross-project rule derivation (any one fires)
  const classA: RegExp[] = [
    /cross-project promotion/i,
    /promote to cross-project/i,
    /Rule 5 threshold/i,
    /3-instance threshold/i,
    /cross-project canonical/i,
  ];
  for (const re of classA) {
    const m = content.match(re);
    if (m) { hits.push({ class: 'A', anchor: m[0] }); break; }
  }

  // Class B — multi-round catch-up (any one fires)
  const classB: RegExp[] = [
    /\bMU batch\b/i,
    /Memorial-Updater for R\d+\s*[-–]\s*R\d+/,
    /REINFORCEMENT consolidation/i,
    /\bMR-\d+\s+Pass\b/i,
    /re-accretion guard/i,
  ];
  for (const re of classB) {
    const m = content.match(re);
    if (m) { hits.push({ class: 'B', anchor: m[0] }); break; }
  }

  // Class C — multi-Reviewer-pass ESCALATE (BOTH must fire)
  const reviewer2 = content.match(/Reviewer-2/);
  const escalate  = content.match(/\bESCALATE\b/);
  if (reviewer2 && escalate) {
    hits.push({ class: 'C', anchor: `Reviewer-2 + ESCALATE` });
  }

  // Class D — operator-resolution archetype (BOTH must fire)
  const opres   = content.match(/operator[ -]resolution/i);
  const optionX = content.match(/\bOption\s+[A-F]\b/);
  if (opres && optionX) {
    hits.push({ class: 'D', anchor: `${opres[0]} + ${optionX[0]}` });
  }

  return hits;
}

function selectModel(content: string, round: string, tier: Tier, muSonnet: boolean): SelectorResult {
  // Branch 1: tier has no MU role
  if (tier === 'solo' || tier === 'coordinator-only') {
    return {
      round, model: NA,
      rationale: 'MU not dispatched on this tier',
      decision_path: ['tier_no_mu'],
      selector_version: SELECTOR_VERSION,
      matched_anchors: [],
    };
  }

  // Branch 2: operator override
  if (muSonnet) {
    return {
      round, model: SONNET,
      rationale: 'operator override (--mu-sonnet)',
      decision_path: ['operator_override'],
      selector_version: SELECTOR_VERSION,
      matched_anchors: [],
    };
  }

  // Branch 3: marker check (only on full-tier)
  if (tier === 'full') {
    const matched = checkAnchorClasses(content);
    if (matched.length > 0) {
      const classes = Array.from(new Set(matched.map(m => m.class))).join('+');
      return {
        round, model: SONNET,
        rationale: `cross-round-pattern marker (class ${classes}): ${matched[0].anchor}`.slice(0, 200),
        decision_path: ['marker_match', `class_${matched[0].class}`],
        selector_version: SELECTOR_VERSION,
        matched_anchors: matched.slice(0, 5).map(m => m.anchor),
      };
    }
  }

  // Branch 4: default Haiku (audit-tier no anchor; or full-tier no anchor)
  return {
    round, model: HAIKU,
    rationale: 'default haiku (no cross-round-pattern marker)',
    decision_path: ['default_haiku'],
    selector_version: SELECTOR_VERSION,
    matched_anchors: [],
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const { content, round } = loadDirective(args.directive);
  const result = selectModel(content, round, args.tier, args.muSonnet);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}

main();
