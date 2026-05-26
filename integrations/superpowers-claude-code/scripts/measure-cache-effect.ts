// scripts/measure-cache-effect.ts — R75 cache-savings measurement utility.
// Reads the deterministic bundles produced by build-role-context.ts and
// emits a JSON report with per-role byte counts + estimated cache-hit savings.
// Read-only: does NOT invoke any Anthropic API.

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildPrefix, buildTail } from './build-role-context';

const MEASURER_VERSION = '0.1.0';
const CHARS_PER_TOKEN = 3.5;  // Anthropic ballpark per pricing docs.
const CACHE_HIT_INPUT_RATIO = 0.1;  // Cached tokens billed at ~10% of standard input rate.

type Role = 'IMPLEMENTER' | 'REVIEWER' | 'MEMORIAL-UPDATER';
const DEFAULT_ROLES: Role[] = ['IMPLEMENTER', 'REVIEWER', 'MEMORIAL-UPDATER'];

function parseArgs(argv: string[]): { round: string; projectRoot: string; roles: Role[] } {
  let round: string | undefined;
  let projectRoot: string = process.cwd();
  let roles: Role[] = DEFAULT_ROLES;
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--round':         round = argv[++i]; break;
      case '--project-root':  projectRoot = resolve(argv[++i]); break;
      case '--roles':         roles = argv[++i].split(',').map(s => s.trim()) as Role[]; break;
      default:
        process.stderr.write(`measure-cache-effect: unknown argument: ${argv[i]}\n`);
        process.exit(1);
    }
  }
  if (!round || !/^R\d+$/.test(round)) {
    process.stderr.write('measure-cache-effect: --round R<NN> required\n');
    process.exit(1);
  }
  return { round, projectRoot, roles };
}

function bytes(s: string): number { return Buffer.byteLength(s, 'utf-8'); }
function tokens(s: string): number { return Math.ceil(bytes(s) / CHARS_PER_TOKEN); }
function sha256(s: string): string { return createHash('sha256').update(s, 'utf-8').digest('hex'); }

function main(): void {
  const { round, projectRoot, roles } = parseArgs(process.argv);
  const prefix = buildPrefix(projectRoot, round);
  const tails: Record<string, string> = {};
  for (const r of roles) tails[r] = buildTail(r as any, round, projectRoot);

  const prefix_bytes = bytes(prefix);
  const prefix_tokens_est = tokens(prefix);
  const tail_bytes: Record<string, number> = {};
  const tail_tokens_est: Record<string, number> = {};
  for (const r of roles) {
    tail_bytes[r] = bytes(tails[r]);
    tail_tokens_est[r] = tokens(tails[r]);
  }

  // Per-2nd+session savings: cached_prefix_tokens are billed at 10% instead
  // of 100%. Savings = prefix_tokens * (1 - 0.1) / total_tokens.
  // total_tokens = prefix + tail (per-role). Use the mean tail for the headline.
  const mean_tail_tokens = roles.length === 0 ? 0 :
    roles.reduce((acc, r) => acc + tail_tokens_est[r], 0) / roles.length;
  const total_input_per_session = prefix_tokens_est + mean_tail_tokens;
  const saved_input_per_session = prefix_tokens_est * (1 - CACHE_HIT_INPUT_RATIO);
  const estimated_cache_hit_savings_percent_per_2nd_plus_session =
    total_input_per_session === 0 ? 0 :
    Math.round(1000 * saved_input_per_session / total_input_per_session) / 10;  // 1 decimal

  const out = {
    round,
    prefix_bytes,
    prefix_sha256: sha256(prefix),
    tail_bytes,
    prefix_tokens_est,
    tail_tokens_est,
    chars_per_token: CHARS_PER_TOKEN,
    estimated_cache_hit_savings_percent_per_2nd_plus_session,
    measurer_version: MEASURER_VERSION,
  };
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}

main();
