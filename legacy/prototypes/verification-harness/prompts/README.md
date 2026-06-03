# Anchor verification-harness prototype

`spec → independent oracle → dynamic builder → grade → fix-loop`, with **independence enforced
structurally**: the oracle-author never sees the implementation, and the builder/fixer never see
the oracle. This is the core product skeleton for the pivot in
`design/adr/0001-pivot-to-verification-harness.md`.

The hard-won lesson (proven twice in benchmarks): a builder's OWN green suite hides real bugs; only
an INDEPENDENT oracle, derived from the spec and never shown the impl, catches them.
**completion + green ≠ correct.**

## Run

```bash
node harness.mjs --spec <specfile> --workdir <dir> [--max-iters N=3] [--model claude-opus-4-8] [--dry-run]
```

- `--dry-run` prints the planned steps and the EXACT prompts that would be sent, stubs the grade as
  `{pass:0,total:0}`, and spawns NO claude session — for cheap smoke testing.
- Exit codes: `0` = converged (oracle passes), `2` = escalate (not converged / a role session was
  killed by the watchdog or produced no artifact), `64` = bad usage, `1` = fatal.

## Pipeline

1. **Oracle author** — `claude -p` in `<workdir>/oracle/`, given the spec + API contract only.
   Writes `<workdir>/oracle/run.mjs` exporting
   `async function grade(buildModulePath) → { pass, total, failures: [{case, expected, got}] }`.
   The oracle IS code: conformance cases + property/differential checks that import the build by path.
2. **Builder** — `claude -p` in `<workdir>/build/`, given ONLY the spec + API contract. Never told
   about / pointed at `oracle/`. Builds `src/index.ts` to its own green tests.
3. **Grade** — the harness imports `oracle/run.mjs` and calls `grade('<workdir>/build/src/index.ts')`.
4. **Fix-loop** — on failures, a fixer session in `build/` is given the `{case,expected,got}` list
   ONLY (never the oracle source). Re-grade. Repeat up to `--max-iters`. Stop on pass; escalate (exit 2)
   if not converged.

Every claude session is wrapped in the CPU-liveness watchdog (`session-watchdog.sh`,
`run_with_session_timeout`): killed when CPU progress stalls (frozen) or a generous hard cap is hit.

## Independence — how it is enforced

- Separate cwds: `oracle/` vs `build/`. The oracle-author is never given the build dir; the
  builder/fixer are never given the oracle dir.
- The prompts (`oracle-author.md`, `builder.md`, `fixer.md`) carry only the spec + the shared
  MODULE API CONTRACT (the import surface both sides must agree on), never the other side's source.
- The fixer receives only the failure report (`case/expected/got`), never the oracle code — so it
  fixes against spec-derived truth, not against the checker's internals.

## Files

- `harness.mjs` — the orchestrator (in the parent dir of this `prompts/`).
- `prompts/oracle-author.md`, `prompts/builder.md`, `prompts/fixer.md` — role templates
  (`{{SPEC}}`, `{{FAILURES}}` are substituted).
- `specs/add.spec.md` — a tiny 3-line spec used to smoke-test `--dry-run`.
