// CLI wrapper: grade a build with the harness's AUTHORED oracle, print "RESULT: P/T" (meta-validate's expected format)
const ORACLE = process.env.ORACLE || new URL('./fixtures/bad-oracle-run.mjs', import.meta.url).pathname;
const BUILD = process.env.ARM_VALIDATOR;
try {
  const m = await import(ORACLE);
  const r = await m.grade(BUILD);
  console.log(`RESULT: ${r.pass}/${r.total}`);
} catch (e) { console.log(`RESULT: 0/0`); console.error(String(e?.message||e)); }
