// META-VALIDATION GATE — grades the ORACLE, not the build.
//
// An oracle (the independent JSON-Schema draft2020-12 suite, via grade.mjs) is only trustworthy
// if it actually CATCHES bugs. This gate seeds known single-edit bugs into a KNOWN-GOOD validator
// and confirms the oracle KILLS them (oracle pass-count drops below baseline). Survivors are the
// oracle's coverage gaps. This is DISTINCT from mutate.mjs, which grades a build's OWN test suite;
// here the "test" is the external spec-derived suite that never saw the implementation.
//
// Run:  node /tmp/anchor-ctxbench/meta-validate.mjs
// Exit: 0 if oracle kill rate >= 0.9, else 1 (the GATE).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, statSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TARGET = '/tmp/anchor-ctxbench/e2e/build';
const GRADE = '/tmp/anchor-ctxbench/grade-authored.mjs';
const ENTRY_REL = 'src/index.ts';                     // ARM_VALIDATOR points here
const MAX_MUTANTS = 60;                               // bound runtime; sample if more candidates
const GRADE_TIMEOUT_MS = 120_000;                     // per oracle run; a hang counts as KILLED
const KILL_RATE_GATE = 0.9;

// --- mutation operators (copied from mutate.mjs OPS approach) ---
const OPS = [
  ['===', '!=='], ['!==', '==='], ['==', '!='],
  ['<=', '<'], ['>=', '>'], ['<', '>='], ['>', '<='],
  [' && ', ' || '], [' || ', ' && '],
  [' + ', ' - '], [' - ', ' + '],
  ['true', 'false'], ['false', 'true'],
];
const isComment = (line) => { const t = line.trimStart(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== '.git') walk(p); continue; }
      if (/\.(ts|js|mjs)$/.test(n) && !/\.test\./.test(n) && n !== '.gitkeep') out.push(p);
    }
  };
  walk(join(dir, 'src'));
  return out;
}

// Generate single-edit mutants for a file: [{file, line, before, after, content}]
function mutantsFor(file) {
  const orig = readFileSync(file, 'utf8');
  const lines = orig.split('\n');
  const seen = new Set();
  const mutants = [];
  let offset = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!isComment(line)) {
      for (const [from, to] of OPS) {
        let idx = line.indexOf(from);
        while (idx !== -1) {
          const abs = offset + idx;
          const content = orig.slice(0, abs) + to + orig.slice(abs + from.length);
          const key = `${abs}:${from}>${to}`;
          if (!seen.has(key) && content !== orig) { seen.add(key); mutants.push({ file, line: li + 1, before: from.trim(), after: to.trim(), content }); }
          idx = line.indexOf(from, idx + 1);
        }
      }
      // numeric literal n -> n+1 (integers only; skip if part of an identifier)
      for (const m of line.matchAll(/(?<![\w.])(\d+)(?![\w.])/g)) {
        const abs = offset + m.index;
        const n = m[1];
        const repl = String(parseInt(n, 10) + 1);
        const content = orig.slice(0, abs) + repl + orig.slice(abs + n.length);
        const key = `${abs}:num${n}>${repl}`;
        if (!seen.has(key) && content !== orig) { seen.add(key); mutants.push({ file, line: li + 1, before: n, after: repl, content }); }
      }
    }
    offset += line.length + 1; // +1 for '\n'
  }
  return mutants;
}

// Run the oracle against the copy; parse "RESULT: P/T". Returns { pass, total, ok, raw }.
function runOracle(copyDir) {
  const entry = join(copyDir, ENTRY_REL);
  const env = { ...process.env, ARM_VALIDATOR: entry };
  const r = spawnSync('node', [GRADE], { encoding: 'utf8', env, timeout: GRADE_TIMEOUT_MS });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.signal || r.error) return { pass: -1, total: -1, ok: false, raw: out, timedOut: r.signal === 'SIGTERM' || !!r.error };
  const m = out.match(/RESULT:\s*(\d+)\/(\d+)/);
  if (!m) return { pass: -1, total: -1, ok: false, raw: out, parseFail: true };
  return { pass: parseInt(m[1], 10), total: parseInt(m[2], 10), ok: true, raw: out };
}

const ts = () => new Date().toISOString();

// --- 1. copy known-good target to fresh temp dir ---
const work = mkdtempSync(join(tmpdir(), 'meta-validate-'));
cpSync(join(TARGET, 'src'), join(work, 'src'), { recursive: true });
for (const f of ['package.json', 'tsconfig.json']) {
  try { cpSync(join(TARGET, f), join(work, f)); } catch { /* optional */ }
}
console.log(`[${ts()}] copied known-good target -> ${work}`);

let exitCode = 1;
try {
  // --- 2. baseline ---
  const base = runOracle(work);
  if (!base.ok) {
    console.error(`[${ts()}] FATAL: baseline oracle run failed to produce a score.\n${base.raw}`);
    process.exit(2);
  }
  console.log(`[${ts()}] BASELINE oracle score: ${base.pass}/${base.total}`);
  if (base.pass !== 1296) console.log(`[${ts()}] WARN: expected baseline 1296, got ${base.pass} (continuing; gate is relative to this baseline)`);

  // --- 3. enumerate mutants across source files ---
  const files = sourceFiles(work);
  const perFile = files.map((f) => ({ file: f, muts: mutantsFor(f) }));
  const totalCandidates = perFile.reduce((a, p) => a + p.muts.length, 0);
  console.log(`[${ts()}] ${files.length} source files; ${totalCandidates} candidate mutants`);

  // --- 4. sample up to MAX_MUTANTS, spread across files (round-robin) ---
  let sampled = [];
  if (totalCandidates <= MAX_MUTANTS) {
    sampled = perFile.flatMap((p) => p.muts);
  } else {
    const cursors = perFile.map(() => 0);
    while (sampled.length < MAX_MUTANTS) {
      let progressed = false;
      for (let fi = 0; fi < perFile.length && sampled.length < MAX_MUTANTS; fi++) {
        const muts = perFile[fi].muts;
        const c = cursors[fi];
        if (c < muts.length) {
          // even stride within the file so we don't cluster at the top
          const stride = Math.max(1, Math.floor(muts.length / Math.ceil(MAX_MUTANTS / perFile.length)));
          sampled.push(muts[c]);
          cursors[fi] = c + stride;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    console.log(`[${ts()}] SAMPLED ${sampled.length}/${totalCandidates} mutants (round-robin across ${files.length} files)`);
  }
  const byFile = {};
  for (const m of sampled) { const k = m.file.replace(work + '/', ''); byFile[k] = (byFile[k] || 0) + 1; }
  console.log(`[${ts()}] sample distribution: ${Object.entries(byFile).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  // --- 5. run each mutant through the oracle; KILLED if pass < baseline ---
  let killed = 0, survived = 0;
  const survivors = [];
  for (let i = 0; i < sampled.length; i++) {
    const mut = sampled[i];
    const origContent = readFileSync(mut.file, 'utf8');
    let res;
    try {
      writeFileSync(mut.file, mut.content);
      res = runOracle(work);
    } finally {
      writeFileSync(mut.file, origContent); // revert no matter what (robustness)
    }
    const rel = mut.file.replace(work + '/', '');
    // A run that timed out or threw to the point of no score => oracle definitively detected breakage => KILLED.
    const passCount = res.ok ? res.pass : -1;
    if (!res.ok || passCount < base.pass) {
      killed++;
    } else {
      survived++;
      survivors.push(`${rel}:${mut.line}  "${mut.before} -> ${mut.after}"`);
    }
    if ((i + 1) % 10 === 0 || i === sampled.length - 1) {
      console.log(`[${ts()}]   ${i + 1}/${sampled.length}  killed=${killed} survived=${survived}`);
    }
  }

  const total = killed + survived;
  const killRate = total ? killed / total : 0;

  console.log('\n================ META-VALIDATION (ORACLE GRADING) ================');
  console.log(`target (known-good): ${TARGET}`);
  console.log(`oracle:              ${GRADE} (JSON-Schema draft2020-12 suite)`);
  console.log(`baseline score:      ${base.pass}/${base.total}`);
  console.log(`mutants tested:      ${total}  (of ${totalCandidates} candidates)`);
  console.log(`KILLED:              ${killed}`);
  console.log(`SURVIVED:            ${survived}`);
  console.log(`ORACLE KILL RATE:    ${(100 * killRate).toFixed(1)}%   (gate >= ${(100 * KILL_RATE_GATE).toFixed(0)}%)`);
  if (survivors.length) {
    console.log('\nSURVIVORS (oracle coverage gaps — bug seeded but oracle stayed at baseline):');
    for (const s of survivors) console.log(`  - ${s}`);
  } else {
    console.log('\nSURVIVORS: none — oracle caught every seeded bug.');
  }
  console.log('==================================================================');

  exitCode = killRate >= KILL_RATE_GATE ? 0 : 1;
  console.log(exitCode === 0 ? 'GATE: PASS' : 'GATE: FAIL');
} finally {
  // --- 6. no left-behind state: remove the temp copy ---
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.exit(exitCode);
