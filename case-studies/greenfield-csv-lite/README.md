# Case study — greenfield from empty repo with the `@anchor/*` tool

**Date:** 2026-05-30 · **Tool:** `@anchor/cli` (this repo's `packages/`) · **Runtime:** Claude Agent SDK (Claude Code subscription auth)

This is the proof point the project README had flagged as missing: driving a project
**from an empty directory to shipped, test-green code entirely by the tool** (not the
methodology + bash pipeline, and not feature-addition to an existing repo). Until this
run, the tool's live dogfooding was feature-addition to Cairn; from-empty greenfield
was unproven. This closes that gap for a small, self-contained library.

## What was built

`csv-lite` — a dependency-free RFC 4180-subset CSV `parse` / `stringify` library
(pure functions, no I/O). Chosen because it is tiny but **edge-case-rich** (quoting,
escaping, embedded newlines), so the cold-eye Reviewer and the anti-self-confirming
test discipline have something real to bite on. The PRD is in
[`artifacts/PRD.md`](artifacts/PRD.md) — the only file authored by hand.

## How it was run

```bash
anchor init <dir>                                  # scaffold the empty repo (gate-runnable from round 1)
$EDITOR <dir>/coordination/PRD.md                  # author the PRD (the one hand-written artifact)
anchor run --directive <dir>/coordination/PRD.md --cwd <dir> --memorial <dir>/.anchor/memorial.json
```

No `--tier` was given — the tool **self-routed to `full`** (Architect → Implementer →
Reviewer → Memorial) from the directive, putting the Reviewer on Opus (the cold-eye
pass) and the Memorial on Haiku.

## Result — `round R01 [full] → COMPLETE`

| Role | Model | Status | Output tokens | Cache read |
|---|---|---|---:|---:|
| architect | claude-sonnet-4-6 | READY | 5,844 | 16,160 |
| implementer | claude-sonnet-4-6 | READY | 19,548 | 515,502 |
| reviewer | claude-opus-4-8 | READY | 2,396 | 19,100 |
| memorial | claude-haiku-4-5-20251001 | READY | 2,857 | 46,865 |

`COMPLETE` is only reachable over a **green** suite — the engine's green-test gate runs
`npm test` after the implementer and blocks the round on red. The memorial recorded
`tests-pass C=1`, confirming the gate passed (not a self-reported status).

## Independent verification (not trusting the tool's COMPLETE)

The whole premise of Anchor is *not* trusting a model's self-reported "done", so the
output was re-checked independently of the run:

- **Re-ran the gate's exact command** (`npm test`) in the produced repo: **18/18 pass, 0 fail**
  (17 acceptance-derived cases + the scaffold smoke). See
  [`artifacts/produced-csv.test.js`](artifacts/produced-csv.test.js) — note the suite
  header: *"written so it FAILS if the production line is absent (no self-confirming tests)."*
- **Adversarial edge cases the PRD did NOT list**, run by hand against the produced code:
  empty fields `a,,c`, quoted-empty `"",x`, trailing comma `a,b,`, and a `\r\n`
  round-trip — **4/4 correct**. The implementation generalized correctly beyond its tests.
- Read the produced [`artifacts/produced-src-index.ts`](artifacts/produced-src-index.ts):
  a clean hand-rolled state machine, correct `""`-escape handling, `\r\n`/`\n` records,
  no extra empty trailing record. No obvious defects.

## Honest limits of this proof

- **Scope is one small, pure library in a single round.** It demonstrates from-empty →
  shipped + verified, not a multi-round app with I/O, persistence, or cross-module
  architecture. The from-empty claim is now proven *at this size*, not at arbitrary scale.
- **The tool runs the cycle in-process**, so it did not leave a per-role coordination file
  trail (architect spec / reviewer report) on disk the way the bash pipeline does — the
  evidence the roles fired is the per-role token usage, the gated green suite, and the
  anti-self-confirming test shape, not a `coordination/specs/` + `coordination/reviews/`
  trail. If you want that durable trail, use the bash pipeline.
- **Single run, no baseline comparison here.** This is an existence proof of correctness,
  not a head-to-head cost/velocity benchmark (those live in the main README's status note).

## Bottom line

`anchor init` + a hand-written PRD + one `anchor run` took an **empty directory** to a
**correct, independently-verified, test-green** library, fully autonomously, with the
green-test gate — not the model's say-so — enforcing "green before COMPLETE".
