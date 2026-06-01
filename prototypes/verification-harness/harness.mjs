#!/usr/bin/env node
// =============================================================================
// harness.mjs — Anchor independent-verification harness (prototype).
//
//   spec ──> [Oracle Author]* ──> oracle/run.mjs ──┐
//                (never sees impl)                  ▼
//   spec ──> [Builder]* ──────> build/src/index.ts ─> [Grader] ──> failures
//                (never sees oracle)                       │            │
//                                                          └─ pass? exit 0
//                                                          └─ else [Fixer]* (sees failures only)
//                                                                  └─ re-grade, loop --max-iters
//                                                                  └─ not converged -> exit 2
//
// CORE INVARIANT — INDEPENDENCE, enforced structurally:
//   * the oracle-author session runs in oracle/ and is NEVER given/pointed at build/;
//   * the builder & fixer run in build/ and are NEVER given/pointed at oracle/;
//   * the fixer sees ONLY the {case,expected,got} failure list, never the oracle source.
// Every claude session is wrapped in the CPU-liveness watchdog (session-watchdog.sh).
//
// CLI:
//   node harness.mjs --spec <specfile> --workdir <dir> [--max-iters N=3]
//                    [--model claude-opus-4-8] [--dry-run]
// =============================================================================

import { spawnSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync,
  readdirSync, statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');
// Resolve the watchdog relative to this file (robust regardless of checkout location):
const WATCHDOG_ABS =
  resolve(__dirname, '../../integrations/superpowers-claude-code/scripts/session-watchdog.sh');

// The build's contracted entry module (relative to build/). The grader imports this path.
const BUILD_ENTRY_REL = 'src/index.ts';

// ── arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    spec: null, workdir: null, maxIters: 3,
    model: 'claude-opus-4-8', dryRun: false,
    reference: null, gateKillRate: 0.7, gateMutants: 40,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    switch (k) {
      case '--spec': a.spec = argv[++i]; break;
      case '--workdir': a.workdir = argv[++i]; break;
      case '--max-iters': a.maxIters = parseInt(argv[++i], 10); break;
      case '--model': a.model = argv[++i]; break;
      case '--dry-run': a.dryRun = true; break;
      // --reference <entry>: a KNOWN-GOOD build entry. The oracle is cross-checked against it;
      // any case the oracle fails on known-correct code is a FALSE-POSITIVE -> reject the oracle.
      case '--reference': a.reference = argv[++i]; break;
      case '--gate-kill-rate': a.gateKillRate = parseFloat(argv[++i]); break;
      case '-h': case '--help': a.help = true; break;
      default:
        console.error(`harness: unknown arg '${k}'`);
        process.exit(64);
    }
  }
  return a;
}

const USAGE = `Usage: node harness.mjs --spec <specfile> --workdir <dir> \\
       [--max-iters N=3] [--model claude-opus-4-8] [--dry-run]`;

// ── logging ──────────────────────────────────────────────────────────────────
function makeLog(logfile) {
  return (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    process.stdout.write(line);
    try { appendFileSync(logfile, line); } catch { /* best-effort */ }
  };
}

// ── prompt assembly ────────────────────────────────────────────────────────────
function loadTemplate(name) {
  return readFileSync(join(PROMPTS_DIR, name), 'utf8');
}
function fill(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

// The module API contract appended to every prompt so oracle & builder agree on
// the import surface WITHOUT either seeing the other's directory.
function apiContract() {
  return [
    '',
    '## MODULE API CONTRACT',
    '',
    `- Build entry module (relative to the build root): \`${BUILD_ENTRY_REL}\`.`,
    '- The grader imports it dynamically: `await import(pathToFileURL(entryPath).href)`.',
    '- Export the symbol(s) the SPEC names. If the spec names a function `f`, export it both',
    '  as a named export `export function f(...)` and resolvable via `mod.f` (the grader also',
    '  falls back to `mod.default.f` and `mod.default`).',
    '- Node 25 executes `.ts` directly; a `.ts` entry is fine. No new npm dependencies.',
    '',
  ].join('\n');
}

// ── claude session runner (wrapped in the CPU-liveness watchdog) ────────────────
// Builds:  bash -c 'source watchdog; run_with_session_timeout LOG -- claude -p "<prompt>" ...'
// so the watchdog's CPU-progress kill protects every role session. Returns exit code.
function runClaudeSession({ prompt, cwd, model, logfile, log, dryRun }) {
  if (dryRun) {
    log(`[dry-run] WOULD spawn claude session  (cwd=${cwd}, model=${model})`);
    log('[dry-run] ---- begin exact prompt ----');
    for (const line of prompt.split('\n')) log(`[dry-run] | ${line}`);
    log('[dry-run] ---- end exact prompt ----');
    return 0;
  }
  if (!existsSync(WATCHDOG_ABS)) {
    log(`FATAL: watchdog not found at ${WATCHDOG_ABS}`);
    return 127;
  }
  // Pass the prompt via env var to avoid any shell-quoting hazard inside bash -c.
  const script =
    `set -euo pipefail; source "$ANCHOR_WATCHDOG"; ` +
    `run_with_session_timeout "$ANCHOR_ROLE_LOG" -- ` +
    `claude -p "$ANCHOR_PROMPT" --permission-mode bypassPermissions --model "$ANCHOR_MODEL"; ` +
    `exit "$WATCHED_EXIT_CODE"`;
  const r = spawnSync('bash', ['-c', script], {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      ANCHOR_WATCHDOG: WATCHDOG_ABS,
      ANCHOR_ROLE_LOG: logfile,
      ANCHOR_PROMPT: prompt,
      ANCHOR_MODEL: model,
    },
  });
  if (r.error) { log(`session spawn error: ${r.error.message}`); return 1; }
  return r.status == null ? 124 : r.status;
}

// ── grading ──────────────────────────────────────────────────────────────────
// Imports oracle/run.mjs and calls grade(buildEntryPath). On --dry-run, stubs.
async function grade({ oracleRunPath, buildEntryPath, dryRun, log }) {
  if (dryRun) {
    log(`[dry-run] WOULD import oracle ${oracleRunPath} and grade ${buildEntryPath}`);
    return { pass: 0, total: 0, failures: [] };
  }
  const mod = await import(pathToFileURL(oracleRunPath).href);
  if (typeof mod.grade !== 'function') {
    throw new Error(`oracle ${oracleRunPath} does not export grade()`);
  }
  const res = await mod.grade(buildEntryPath);
  return {
    pass: res.pass | 0,
    total: res.total | 0,
    failures: Array.isArray(res.failures) ? res.failures : [],
  };
}

function formatFailures(failures) {
  if (!failures.length) return '(none)';
  return failures.map((f, i) => {
    const ser = (v) => {
      try { return typeof v === 'string' ? v : JSON.stringify(v); }
      catch { return String(v); }
    };
    return `${i + 1}. case: ${ser(f.case)}\n   expected: ${ser(f.expected)}\n   got:      ${ser(f.got)}`;
  }).join('\n');
}

// =============================================================================
// ORACLE GATE — never trust an oracle to drive a fix-loop until it's validated.
// (First real run lesson: a generated oracle had a false-positive AND was weak;
//  trusting it wasted ~5x cost and corrupted the build chasing a phantom.)
// Three mechanisms, strongest first:
//   (A) Reference cross-check: if a known-good reference build is given, any case the
//       oracle FAILS on correct code is a FALSE-POSITIVE -> reject the oracle outright.
//   (B) Adequacy (kill-rate) gate: seed bugs into the build, confirm the oracle kills
//       them. Catches a too-weak oracle. (Threshold is advisory — equivalent mutants
//       drag even good oracles to ~70-80%, so this is a floor, not a fine discriminator.)
//   (C) Non-convergence detection lives in the fix-loop: a case that won't move after a
//       no-progress iteration is a suspected false-positive -> stop, don't thrash.
// =============================================================================

// Grade a build entry with the oracle in a FRESH subprocess (avoids ESM import cache
// when the build file is mutated in place). Returns { pass, total, failures, ok }.
function gradeSubprocess(oracleRunPath, buildEntryPath, timeoutMs = 120_000) {
  const code =
    `import(${JSON.stringify(pathToFileURL(oracleRunPath).href)})` +
    `.then(m => m.grade(${JSON.stringify(buildEntryPath)}))` +
    `.then(r => { const f = Array.isArray(r.failures) ? r.failures : []; ` +
    `process.stdout.write('GRADE:'+(r.pass|0)+'/'+(r.total|0)+':'+JSON.stringify(f.map(x=>x&&x.case))); })` +
    `.catch(e => process.stdout.write('GRADE:0/0:[]'));`;
  const r = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: timeoutMs });
  const m = (r.stdout || '').match(/GRADE:(\d+)\/(\d+):(.*)/s);
  if (!m) return { pass: 0, total: 0, failures: [], ok: false };
  let failures = [];
  try { failures = JSON.parse(m[3]); } catch { /* ignore */ }
  return { pass: +m[1], total: +m[2], failures, ok: true };
}

// (A) Reference cross-check: the oracle must PASS a known-good build. Any failure there
// is the oracle being wrong about correct behavior -> false-positive(s).
function referenceCrossCheck({ oracleRunPath, referenceEntry, log }) {
  const g = gradeSubprocess(oracleRunPath, referenceEntry);
  if (!g.ok) { log(`  reference cross-check: oracle could not grade the reference (load error) — treating as inconclusive`); return { falsePositives: [], inconclusive: true }; }
  const fp = (g.failures || []).filter(Boolean);
  log(`  reference cross-check: oracle scores known-good reference ${g.pass}/${g.total}; ${fp.length} case(s) the oracle WRONGLY fails`);
  return { falsePositives: fp, inconclusive: false };
}

// (B) Adequacy gate via build mutation. Returns kill rate.
const GATE_OPS = [
  ['===', '!=='], ['!==', '==='], ['==', '!='], ['<=', '<'], ['>=', '>'],
  ['<', '>='], ['>', '<='], [' && ', ' || '], [' || ', ' && '],
  [' + ', ' - '], [' - ', ' + '], ['true', 'false'], ['false', 'true'],
];
function buildSourceFiles(buildDir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== '.git') walk(p); continue; }
      if (/\.(ts|js|mjs)$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
  };
  walk(join(buildDir, 'src'));
  return out;
}
function adequacyGate({ oracleRunPath, buildDir, buildEntryPath, baselinePass, maxMutants, log }) {
  const files = buildSourceFiles(buildDir);
  const mutants = [];
  for (const f of files) {
    const orig = readFileSync(f, 'utf8');
    for (const [from, to] of GATE_OPS) {
      let idx = orig.indexOf(from);
      while (idx !== -1) { mutants.push({ f, idx, from, to }); idx = orig.indexOf(from, idx + 1); }
    }
  }
  let sample = mutants;
  if (mutants.length > maxMutants) {
    const stride = mutants.length / maxMutants;
    sample = Array.from({ length: maxMutants }, (_, i) => mutants[Math.floor(i * stride)]);
  }
  let killed = 0, survived = 0;
  for (const mut of sample) {
    const orig = readFileSync(mut.f, 'utf8');
    const mutated = orig.slice(0, mut.idx) + mut.to + orig.slice(mut.idx + mut.from.length);
    try {
      writeFileSync(mut.f, mutated);
      const g = gradeSubprocess(oracleRunPath, buildEntryPath);
      if (!g.ok || g.pass < baselinePass) killed++; else survived++;
    } finally { writeFileSync(mut.f, orig); }
  }
  const total = killed + survived;
  return { killed, survived, total, killRate: total ? killed / total : 0, candidates: mutants.length };
}

// ── main pipeline ──────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); process.exit(0); }
  if (!args.spec || !args.workdir) {
    console.error(USAGE);
    process.exit(64);
  }
  if (!Number.isInteger(args.maxIters) || args.maxIters < 1) {
    console.error('harness: --max-iters must be a positive integer');
    process.exit(64);
  }

  const specPath = resolve(args.spec);
  const workdir = resolve(args.workdir);
  const oracleDir = join(workdir, 'oracle');
  const buildDir = join(workdir, 'build');
  const oracleRunPath = join(oracleDir, 'run.mjs');
  const buildEntryPath = join(buildDir, BUILD_ENTRY_REL);
  const logfile = join(workdir, 'harness.log');

  // Separate cwds — the structural backbone of independence.
  mkdirSync(oracleDir, { recursive: true });
  mkdirSync(join(buildDir, 'src'), { recursive: true });

  const log = makeLog(logfile);
  log(`=== Anchor verification harness ${args.dryRun ? '(DRY RUN)' : ''} ===`);

  if (!existsSync(specPath)) {
    log(`FATAL: spec file not found: ${specPath}`);
    process.exit(64);
  }
  const spec = readFileSync(specPath, 'utf8');

  log(`spec=${specPath}`);
  log(`workdir=${workdir}`);
  log(`  oracle cwd = ${oracleDir}   (oracle-author session; NEVER given build dir)`);
  log(`  build  cwd = ${buildDir}   (builder/fixer sessions; NEVER given oracle dir)`);
  log(`model=${args.model}  max-iters=${args.maxIters}`);

  // ---- prompts (assembled up front so --dry-run can print them) ----
  const contract = apiContract();
  const oraclePrompt = fill(loadTemplate('oracle-author.md'), { SPEC: spec }) + contract;
  const builderPrompt = fill(loadTemplate('builder.md'), { SPEC: spec }) + contract;

  // ===== STEP 1: ORACLE AUTHOR (cwd=oracle/, never sees build) =====
  log('--- STEP 1: ORACLE AUTHOR (independent; derives oracle/run.mjs from spec only) ---');
  {
    const code = runClaudeSession({
      prompt: oraclePrompt, cwd: oracleDir, model: args.model,
      logfile: join(oracleDir, 'oracle-author.log'), log, dryRun: args.dryRun,
    });
    if (code !== 0 && !args.dryRun) {
      log(`oracle-author session exited ${code} (124=watchdog kill). ESCALATE.`);
      process.exit(2);
    }
    if (!args.dryRun && !existsSync(oracleRunPath)) {
      log(`FATAL: oracle did not produce ${oracleRunPath}. ESCALATE.`);
      process.exit(2);
    }
  }

  // ===== STEP 2: BUILDER (cwd=build/, never told about oracle) =====
  log('--- STEP 2: BUILDER (given ONLY the spec + API contract; never pointed at oracle) ---');
  {
    const code = runClaudeSession({
      prompt: builderPrompt, cwd: buildDir, model: args.model,
      logfile: join(buildDir, 'builder.log'), log, dryRun: args.dryRun,
    });
    if (code !== 0 && !args.dryRun) {
      log(`builder session exited ${code} (124=watchdog kill). ESCALATE.`);
      process.exit(2);
    }
    if (!args.dryRun && !existsSync(buildEntryPath)) {
      log(`FATAL: builder did not produce entry ${buildEntryPath}. ESCALATE.`);
      process.exit(2);
    }
  }

  // ===== STEP 3: GRADE =====
  log('--- STEP 3: GRADE (independent oracle scores the build) ---');
  let result = await grade({ oracleRunPath, buildEntryPath, dryRun: args.dryRun, log });
  log(`grade: ${result.pass}/${result.total} pass, ${result.failures.length} failing case(s)`);

  // ===== STEP 3b: ORACLE GATE — validate the oracle BEFORE trusting its verdict =====
  // Never let an unvalidated oracle drive a fix-loop (the first-run lesson).
  if (!args.dryRun) {
    log('--- STEP 3b: ORACLE GATE (meta-validate before trusting the verdict) ---');
    // (A) Reference cross-check (strongest, if a known-good reference is provided).
    if (args.reference) {
      const refEntry = resolve(args.reference);
      const { falsePositives, inconclusive } = referenceCrossCheck({ oracleRunPath, referenceEntry: refEntry, log });
      if (!inconclusive && falsePositives.length > 0) {
        log(`GATE REJECTED THE ORACLE: ${falsePositives.length} FALSE-POSITIVE case(s) — the oracle fails correct code: `
          + `${falsePositives.map((c) => JSON.stringify(c)).join(', ')}`);
        log('Refusing to run the fix-loop on a wrong oracle (would chase phantoms / corrupt the build). ESCALATE (oracle-rejected).');
        process.exit(3);
      }
    }
    // (B) Adequacy / kill-rate gate (advisory floor — catches a too-weak oracle).
    const mv = adequacyGate({ oracleRunPath, buildDir, buildEntryPath, baselinePass: result.pass, maxMutants: args.gateMutants, log });
    log(`  adequacy: oracle kill rate ${(100 * mv.killRate).toFixed(1)}% (${mv.killed}/${mv.total} of ${mv.candidates} seeded mutants)`);
    if (mv.killRate < args.gateKillRate) {
      log(`GATE REJECTED THE ORACLE: kill rate ${(100 * mv.killRate).toFixed(1)}% < floor ${(100 * args.gateKillRate).toFixed(0)}% `
        + `— too weak to trust (would miss real bugs). ESCALATE (oracle-rejected).`);
      process.exit(3);
    }
    log('GATE PASSED: oracle is trustworthy enough to drive the fix-loop.');
  }

  // ===== STEP 4: FIX-LOOP (with non-convergence = suspected-phantom detection) =====
  let iter = 0;
  let prevFailCount = result.failures.length;
  while (result.failures.length > 0 && iter < args.maxIters) {
    iter++;
    log(`--- STEP 4: FIX-LOOP iteration ${iter}/${args.maxIters} (fixer sees failures ONLY, not oracle) ---`);
    const fixerPrompt = fill(loadTemplate('fixer.md'), {
      SPEC: spec,
      FAILURES: formatFailures(result.failures),
    }) + contract;

    const code = runClaudeSession({
      prompt: fixerPrompt, cwd: buildDir, model: args.model,
      logfile: join(buildDir, `fixer-${iter}.log`), log, dryRun: args.dryRun,
    });
    if (code !== 0 && !args.dryRun) {
      log(`fixer session exited ${code} (124=watchdog kill). ESCALATE.`);
      process.exit(2);
    }
    result = await grade({ oracleRunPath, buildEntryPath, dryRun: args.dryRun, log });
    log(`re-grade: ${result.pass}/${result.total} pass, ${result.failures.length} failing case(s)`);

    if (args.dryRun) break; // one symbolic fix iteration is enough to show the loop

    // Non-convergence: a fixer that made NO progress on the failing set is a strong
    // signal the remaining case(s) are unfixable — i.e. oracle false-positives. Stop
    // instead of thrashing (the first-run failure burned 3 iterations on exactly this).
    if (result.failures.length > 0 && result.failures.length >= prevFailCount) {
      log(`NON-CONVERGENCE: no progress this iteration (${result.failures.length} failing, was ${prevFailCount}). `
        + `Suspected ORACLE FALSE-POSITIVE(S): ${result.failures.map((f) => JSON.stringify(f && f.case)).join(', ')}. `
        + 'Refusing to thrash further. ESCALATE (suspected-phantom).');
      process.exit(3);
    }
    prevFailCount = result.failures.length;
  }

  // ---- verdict ----
  if (result.failures.length === 0 && result.total > 0) {
    log(`PASS: ${result.pass}/${result.total}. Build converged against a GATED independent oracle.`);
    process.exit(0);
  }
  if (args.dryRun) {
    log('[dry-run] grade stubbed as {pass:0,total:0}; no real verdict. Steps + prompts printed above.');
    log('[dry-run] planned steps: oracle-author -> builder -> grade -> GATE -> (fix-loop up to '
      + `${args.maxIters}) -> verdict.`);
    process.exit(0);
  }
  log(`ESCALATE: ${result.pass}/${result.total}, ${result.failures.length} failing after `
    + `${iter} fix iteration(s). Not converged.`);
  process.exit(2);
}

main().catch((e) => {
  console.error('harness fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
