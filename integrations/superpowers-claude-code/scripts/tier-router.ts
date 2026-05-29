// scripts/tier-router.ts — Tier-routing classifier (R73)
// Outputs JSON tier recommendation given a directive content file.
// Usage: node scripts/tier-router.js [--directive <path>] [--mode heuristic|hybrid|haiku] [--confidence-threshold 0.70]

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { classifyTier } from '@anchor/core'; // canonical tier rules — this script is the bash-pipeline CLI wrapper over @anchor/core/routing

interface RouterResult {
  round: string;
  tier: 'full' | 'audit' | 'implementer-only' | 'coordinator-only';
  confidence: number;
  rationale: string;
  decision_path: string[];
  router_version: string;
  mode: 'heuristic' | 'haiku' | 'hybrid';
}

const ROUTER_VERSION = '0.1.0';
const DEFAULT_CONFIDENCE_THRESHOLD = 0.70;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

interface CLIArgs {
  directive: string;
  mode: 'heuristic' | 'haiku' | 'hybrid';
  confidenceThreshold: number;
}

function parseArgs(argv: string[]): CLIArgs {
  let directive = 'coordination/NEXT-ROLE.md';
  let mode: CLIArgs['mode'] = 'hybrid';
  let confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD;

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--directive':
        directive = argv[++i];
        break;
      case '--mode': {
        const m = argv[++i];
        if (m !== 'heuristic' && m !== 'haiku' && m !== 'hybrid') {
          process.stderr.write(`tier-router: invalid --mode value: ${m}\n`);
          process.exit(1);
        }
        mode = m as CLIArgs['mode'];
        break;
      }
      case '--confidence-threshold':
        confidenceThreshold = parseFloat(argv[++i]);
        break;
      default:
        process.stderr.write(`tier-router: unknown argument: ${argv[i]}\n`);
        process.exit(1);
    }
  }
  return { directive, mode, confidenceThreshold };
}

function loadDirective(path: string): { content: string; round: string } {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    process.stderr.write(`tier-router: directive unreadable: ${path}\n`);
    process.exit(1);
  }
  const raw = readFileSync(absolutePath, 'utf-8');

  // Try to extract the most recent `## § R{N} Round-scope directive` section.
  const headingRe = /^## § R(\d+) Round-scope directive/m;
  const headingMatch = raw.match(headingRe);
  if (!headingMatch) {
    const round = raw.match(/^CURRENT-ROUND:\s*(R\d+)/m)?.[1] ?? 'unknown';
    return { content: raw, round };
  }

  const round = `R${headingMatch[1]}`;
  const startIdx = headingMatch.index!;
  const fromHeading = raw.slice(startIdx);
  // Find next section boundary: another `## § ` heading or `---` separator line
  const boundaryMatch = fromHeading.search(/\n(?=## § |\n---[ \t]*(?:\n|$))/m);
  const content = boundaryMatch === -1 ? fromHeading : fromHeading.slice(0, boundaryMatch);
  return { content, round };
}

function heuristic(content: string, round: string): RouterResult {
  // Delegate the rule set to @anchor/core (single source of truth; retires the duplicate copy
  // flagged in PR #50). The Haiku tiebreaker below stays here — it needs the Claude CLI, which
  // is out of scope for the pure core classifier.
  const c = classifyTier(content);
  return {
    round,
    tier: c.tier as RouterResult['tier'], // classifyTier never returns 'solo'
    confidence: c.confidence,
    rationale: c.matched,
    decision_path: ['core_classifyTier'],
    router_version: ROUTER_VERSION,
    mode: 'heuristic',
  };
}

// Embed the Anchor tier-routing rubric for Haiku prompt construction.
// Source: CLAUDE-COMMON.md § Tier selection (A1-A7 / S1-S5 / Z1-Z5 criteria).
const TIER_RUBRIC = `
## Anchor tier-routing rubric

**A-factors (any single factor → full tier):**
- A1: New external dependency (npm lib, external service, new API)
- A2: New architectural pattern with no precedent in the codebase
- A3: Unresolved open question that this round must resolve
- A4: Novel data model (new entities or relationship patterns)
- A5: Critical NFR ties that materially constrain design choices
- A6: Large blast radius (touches ≥4 prior rounds' production code paths OR risks breaking backward compatibility for many existing tests)
- A7: First-time territory — the project has never done X before

**S-factors (all A-false + any S → audit candidate):**
- S1: Direct extension of a recent round's already-shipped pattern
- S2: Prior round artifacts (spec or Reviewer report) functionally describe the work
- S3: Single bounded item (one bug fix, one AC, one config change)
- S4: Tactical follow-up to a recent round (fixing leftover MINORs)
- S5: Tech-debt with empirical investigation where the investigation IS the design work

**Z-factors (audit candidate + pure-mechanical → implementer-only/solo candidate):**
- Z1: Single-file mechanical rename, version bump, or format change (no behavior change)
- Z2: Documentation-only change
- Z3: Test-only addition against existing production code (NOT modifying existing test assertions)
- Z4: Configuration value tweak
- Z5: Cosmetic UI tweak

**Coordinator-only:** Coordinator wave planning, wave-gate close, CLUSTER-HANDOFF emissions, operator-decision backlog resolution.
`;

function buildHaikuPrompt(directive: string): string {
  return `You are a tier-routing classifier for the Anchor/Tessera pipeline. Given a round directive, output a JSON object with fields: tier (one of: full, audit, implementer-only, coordinator-only), confidence (0.0-1.0), rationale (string ≤200 chars).
${TIER_RUBRIC}
DIRECTIVE:
${directive}

Output ONLY a valid JSON object, nothing else. Example: {"tier":"full","confidence":0.9,"rationale":"engine/ modification + new architectural pattern (A2)"}`;
}

function extractJSON(stdout: string): string {
  const trimmed = stdout.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function isValidRouterTier(v: unknown): v is { tier: RouterResult['tier']; confidence: number; rationale?: string } {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  const validTiers = ['full', 'audit', 'implementer-only', 'coordinator-only'];
  return validTiers.includes(obj.tier as string) && typeof obj.confidence === 'number';
}

function haikuTiebreaker(content: string, round: string, threshold: number): RouterResult | null {
  const prompt = buildHaikuPrompt(content);
  const result = spawnSync(
    'claude',
    ['-p', '--model', HAIKU_MODEL, '--max-turns', '1'],
    { input: prompt, encoding: 'utf-8', timeout: 60_000 },
  );
  if (result.status !== 0 || !result.stdout) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(extractJSON(result.stdout)); } catch { return null; }
  if (!isValidRouterTier(parsed)) return null;
  const haikuConfidence = (parsed as { confidence: number }).confidence;
  if (haikuConfidence < threshold) return null;
  return {
    round,
    tier: (parsed as { tier: RouterResult['tier'] }).tier,
    confidence: haikuConfidence,
    rationale: (parsed as { rationale: string }).rationale ?? 'haiku tiebreaker',
    decision_path: ['heuristic_rule_5_default', 'haiku_tiebreaker'],
    router_version: ROUTER_VERSION,
    mode: 'hybrid',
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const { content, round } = loadDirective(args.directive);
  let result = heuristic(content, round);

  if (args.mode === 'hybrid' && result.confidence < args.confidenceThreshold) {
    const haiku = haikuTiebreaker(content, round, args.confidenceThreshold);
    if (haiku) {
      result = haiku;
    } else {
      result = {
        ...result,
        decision_path: [...result.decision_path, 'haiku_tiebreaker', 'haiku_unavailable_or_low_confidence', 'default_full'],
        tier: 'full',
        confidence: 0.50,
        rationale: 'ambiguous directive + Haiku tiebreaker unavailable or low-confidence',
        mode: 'hybrid',
      };
    }
  } else if (args.mode === 'haiku') {
    // Force Haiku regardless of heuristic confidence (for evaluation/testing).
    const haiku = haikuTiebreaker(content, round, 0);
    if (haiku) {
      result = { ...haiku, decision_path: ['haiku_only_mode'], mode: 'haiku' };
    } else {
      result = {
        ...result,
        decision_path: ['haiku_only_mode', 'haiku_unavailable'],
        tier: 'full',
        confidence: 0.50,
        rationale: 'haiku-only mode but CLI unavailable; defaulting to full',
        mode: 'haiku',
      };
    }
  }

  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}

main();
