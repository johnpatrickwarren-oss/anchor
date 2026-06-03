// scripts/tier-router-validate.ts — Replay router against Tessera validation corpus.
// Usage: node scripts/tier-router-validate.js
// Exit 0 iff all load-bearing safety constraints pass; exit 1 otherwise.

import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface CorpusEntry {
  round_id: string;
  directive_source: { type: 'embedded_fixture'; path: string } | { type: 'git_show'; sha: string };
  expected_constraint: { must_route_full?: boolean; must_not_route_implementer_only?: boolean };
  label_rationale: string;
}

interface Corpus {
  schema_version: string;
  load_bearing_safety: {
    must_route_full: string[];
    must_not_route_implementer_only: string[];
  };
  entries: CorpusEntry[];
}

function loadCorpus(): Corpus {
  const corpusPath = resolve(__dirname, 'tier-router-fixtures', 'corpus.json');
  return JSON.parse(readFileSync(corpusPath, 'utf-8')) as Corpus;
}

function resolveDirectiveContent(source: CorpusEntry['directive_source']): string | null {
  if (source.type === 'embedded_fixture') {
    const path = resolve(__dirname, '..', source.path);
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  }
  // git_show
  const result = spawnSync('git', ['show', `${source.sha}:coordination/NEXT-ROLE.md`], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  return result.stdout;
}

function runRouterOnContent(content: string): { tier: string; confidence: number; rationale: string } | null {
  const tmpDir = mkdtempSync(join(tmpdir(), 'tier-router-validate-'));
  try {
    const tmpFile = join(tmpDir, 'directive.md');
    writeFileSync(tmpFile, content);
    const result = spawnSync(
      'node',
      [resolve(__dirname, 'tier-router.js'), '--directive', tmpFile, '--mode', 'heuristic'],
      { encoding: 'utf-8' },
    );
    if (result.status !== 0) return null;
    return JSON.parse(result.stdout) as { tier: string; confidence: number; rationale: string };
  } catch {
    return null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main(): void {
  const corpus = loadCorpus();
  const results: Array<{ round: string; expected: string; actual: string; pass: boolean }> = [];
  let safetyViolations = 0;

  for (const entry of corpus.entries) {
    const content = resolveDirectiveContent(entry.directive_source);
    if (!content) {
      results.push({ round: entry.round_id, expected: 'N/A', actual: 'directive_unavailable', pass: false });
      if (entry.expected_constraint.must_route_full) safetyViolations++;
      continue;
    }
    const routed = runRouterOnContent(content);
    if (!routed) {
      results.push({ round: entry.round_id, expected: 'N/A', actual: 'router_error', pass: false });
      if (entry.expected_constraint.must_route_full) safetyViolations++;
      continue;
    }
    let pass = true;
    let expected = '';
    if (entry.expected_constraint.must_route_full && routed.tier !== 'full') {
      pass = false;
      expected = 'full';
      safetyViolations++;
    }
    if (entry.expected_constraint.must_not_route_implementer_only && routed.tier === 'implementer-only') {
      pass = false;
      expected = '!= implementer-only';
      safetyViolations++;
    }
    results.push({ round: entry.round_id, expected: expected || 'unconstrained', actual: routed.tier, pass });
  }

  process.stdout.write('# Tier-router validation report\n\n');
  process.stdout.write('| Round | Expected | Actual | Pass |\n|---|---|---|---|\n');
  for (const r of results) {
    process.stdout.write(`| ${r.round} | ${r.expected} | ${r.actual} | ${r.pass ? '✓' : '✗'} |\n`);
  }
  process.stdout.write(`\nSafety violations: ${safetyViolations}\n`);
  process.exit(safetyViolations === 0 ? 0 : 1);
}

main();
