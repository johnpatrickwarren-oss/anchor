// scripts/build-role-context.ts — R75 deterministic role-input context-bundle builder.
// Outputs: stable PREFIX (CLAUDE-COMMON.md + spec triad + directive section)
//          + per-role TAIL (CLAUDE-<ROLE>.md + role-stamp).
// Anthropic's prompt cache hits on byte-identical PREFIX across role sessions
// within a 5-minute TTL window. See Q-R75-SPEC.md § 0 for the load-bearing
// prefix-tail split.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const BUILDER_VERSION = '0.1.0';

type Role =
  | 'ARCHITECT'
  | 'IMPLEMENTER'
  | 'REVIEWER'
  | 'REVIEWER-OPUS'
  | 'REVIEWER-SONNET'
  | 'REVIEWER-MERGE'
  | 'MEMORIAL-UPDATER'
  | 'COORDINATOR';

type Emit = 'prefix' | 'tail' | 'full';

interface CLIArgs {
  emit: Emit;
  role?: Role;
  round: string;
  projectRoot: string;
  roleClaudeFile?: string;
}

function parseArgs(argv: string[]): CLIArgs {
  let emit: Emit | undefined;
  let role: Role | undefined;
  let round: string | undefined;
  let projectRoot: string = process.cwd();
  let roleClaudeFile: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--emit':              emit = argv[++i] as Emit; break;
      case '--role':              role = argv[++i] as Role; break;
      case '--round':             round = argv[++i]; break;
      case '--project-root':      projectRoot = resolve(argv[++i]); break;
      case '--role-claude-file':  roleClaudeFile = argv[++i]; break;
      default:
        process.stderr.write(`build-role-context: unknown argument: ${argv[i]}\n`);
        process.exit(1);
    }
  }
  if (!emit || !['prefix', 'tail', 'full'].includes(emit)) {
    process.stderr.write('build-role-context: --emit prefix|tail|full is required\n');
    process.exit(1);
  }
  if (!round || !/^R\d+$/.test(round)) {
    process.stderr.write('build-role-context: --round R<NN> is required\n');
    process.exit(1);
  }
  if ((emit === 'tail' || emit === 'full') && !role) {
    process.stderr.write(`build-role-context: --role is required for --emit ${emit}\n`);
    process.exit(1);
  }
  return { emit, role, round, projectRoot, roleClaudeFile };
}

// Resolve role → CLAUDE-<ROLE>.md mapping; mirror run-pipeline.sh:1606-1617.
function resolveRoleClaudeFile(role: Role, projectRoot: string): string {
  const map: Record<Role, string> = {
    'ARCHITECT':         'CLAUDE-ARCHITECT.md',
    'IMPLEMENTER':       'CLAUDE-IMPLEMENTER.md',
    'REVIEWER':          'CLAUDE-REVIEWER.md',
    'REVIEWER-OPUS':     'CLAUDE-REVIEWER.md',
    'REVIEWER-SONNET':   'CLAUDE-REVIEWER.md',
    'REVIEWER-MERGE':    'CLAUDE-REVIEWER.md',
    'MEMORIAL-UPDATER':  'CLAUDE-MEMORIAL.md',
    'COORDINATOR':       'CLAUDE-COORDINATOR.md',
  };
  return join(projectRoot, map[role]);
}

// Extract the directive section from NEXT-ROLE.md using the same shape as
// scripts/mu-model-select.ts:66-77. Returns '' if NEXT-ROLE.md is missing.
function extractDirectiveSection(projectRoot: string, round: string): string {
  const path = join(projectRoot, 'coordination', 'NEXT-ROLE.md');
  if (!existsSync(path)) return '';
  const raw = readFileSync(path, 'utf-8');
  const headingRe = /^## § R(\d+) Round-scope directive/m;
  const headingMatch = raw.match(headingRe);
  if (!headingMatch) return raw;  // fallback: whole file (same as mu-model-select)
  // Optional: verify round matches; if not, still return what's there.
  const startIdx = headingMatch.index!;
  const fromHeading = raw.slice(startIdx);
  const boundaryMatch = fromHeading.search(/\n(?=## § |\n---[ \t]*(?:\n|$))/m);
  return boundaryMatch === -1 ? fromHeading : fromHeading.slice(0, boundaryMatch);
}

// Load the spec triad files in the prescribed order. Returns the array of
// loaded contents (each entry is the raw file contents). Missing files are
// silently skipped — Architect session always misses all three.
function loadSpecTriad(projectRoot: string, round: string): string[] {
  const specsDir = join(projectRoot, 'coordination', 'specs');
  const order = [
    `Q-${round}-SPEC.md`,
    `Q-${round}-SPEC-AUDIT.md`,
    `Q-${round}-EMPIRICAL.sh`,
  ];
  const loaded: string[] = [];
  for (const name of order) {
    const p = join(specsDir, name);
    if (existsSync(p)) loaded.push(readFileSync(p, 'utf-8'));
  }
  return loaded;
}

function buildPrefix(projectRoot: string, round: string): string {
  const sections: string[] = [];
  const commonPath = join(projectRoot, 'CLAUDE-COMMON.md');
  if (!existsSync(commonPath)) {
    process.stderr.write(`build-role-context: CLAUDE-COMMON.md not found at ${commonPath}\n`);
    process.exit(1);
  }
  sections.push(readFileSync(commonPath, 'utf-8'));
  for (const sec of loadSpecTriad(projectRoot, round)) sections.push(sec);
  const directive = extractDirectiveSection(projectRoot, round);
  if (directive.length > 0) sections.push(directive);
  return sections.join('\n');
}

function buildRoleStamp(role: Role, round: string): string {
  return (
    `# ── ROLE-STAMP ────────────────────────────────────────────────────────────────\n` +
    `# THIS SESSION ROLE: ${role}\n` +
    `# Round: ${round}\n`
  );
}

function buildTail(role: Role, round: string, projectRoot: string, roleClaudeFile?: string): string {
  const path = roleClaudeFile ?? resolveRoleClaudeFile(role, projectRoot);
  if (!existsSync(path)) {
    process.stderr.write(`build-role-context: role discipline file not found at ${path}\n`);
    process.exit(1);
  }
  const roleContent = readFileSync(path, 'utf-8');
  const stamp = buildRoleStamp(role, round);
  return roleContent + '\n' + stamp;
}

function main(): void {
  const args = parseArgs(process.argv);
  let out: string;
  switch (args.emit) {
    case 'prefix':
      out = buildPrefix(args.projectRoot, args.round);
      break;
    case 'tail':
      out = buildTail(args.role!, args.round, args.projectRoot, args.roleClaudeFile);
      break;
    case 'full': {
      const prefix = buildPrefix(args.projectRoot, args.round);
      const tail = buildTail(args.role!, args.round, args.projectRoot, args.roleClaudeFile);
      out = prefix + '\n' + tail;
      break;
    }
  }
  // Use process.stdout.end to drain the buffer before process exit.
  // process.stdout.write + process.exit(0) truncates large payloads at the
  // 64KB stdio buffer boundary (process.exit forces termination without drain).
  process.stdout.end(out);
}

// Export for tests (the test file imports buildPrefix / buildTail / buildFull).
export { buildPrefix, buildTail, buildRoleStamp, extractDirectiveSection, loadSpecTriad, resolveRoleClaudeFile };

// Suppress unused-warning for BUILDER_VERSION in environments where the constant
// is read via reflection by future telemetry hooks. Implementer may rename if a
// lint rule complains; the literal value 0.1.0 is the contract surface.
if (typeof BUILDER_VERSION !== 'string') { throw new Error('builder version unset'); }

// Guard main() so it only runs when this file is the entry point, not on import
// (measure-cache-effect.ts imports buildPrefix/buildTail from this module).
if (require.main === module) {
  main();
}
