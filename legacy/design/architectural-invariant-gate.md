# Design: the architectural-invariant gate

**Status:** BUILT and SHIPPED as its own repo + tool — **[johnpatrickwarren-oss/arch-gate](https://github.com/johnpatrickwarren-oss/arch-gate)** (`npm i -g github:johnpatrickwarren-oss/arch-gate`; 20/20 suites). It was prototyped here under `prototypes/architectural-gate/` and graduated to a standalone repo; this doc remains the design rationale. Refines the direction of ADR 0001 (`design/adr/0001-pivot-to-verification-harness.md`).

> **Built so far (2026-06-01):** all 5 k10s tenets enforced; real ASTs for Go (`@ast-grep/lang-go`)
> and TypeScript/JS (`@ast-grep/napi`) with a heuristic no-dep fallback; generic no-tuning checks
> (`oversized_files` God-file, `max_function_lines` God-function, `module_fanin` coupling/God-module
> hub); the full enforcement arc — ratchet vs baseline, pre-commit hook, AI-loop feedback (converge
> /escalate, never relaxes the invariant), auditable suppressions, debt-trend over real git history;
> a starter tenet library; `scope_diff` over dispatch labels AND top-level feature dirs. Adopted
> onto a real codebase (the verification-harness) via the ratchet-from-current-state pattern. The §12
> roadmap below is mostly done; remaining: richer per-language adapters, live hook adoption, broader
> real-repo trials.
**Date:** 2026-06-01.
**Origin:** https://blog.k10s.dev/im-going-back-to-writing-code-by-hand/ — "AI writes features,
not architecture." A 7-month AI-built codebase collapsed under architectural debt (god object,
positional `[]string` fragility, cross-view state leaks, off-event-loop mutations, scope creep)
*while remaining behaviorally fine*. The owner: "this is exactly what I want to solve for."

## 1. Problem & why the behavioral harness doesn't address it

This session proved two things about behavioral verification (oracle vs spec):
1. It's **capped by oracle quality** — a generated oracle false-positives (thrash) or false-negatives
   (green-lights real bugs); we saw both. Manufacturing a strong oracle is the unsolved hard part.
2. **It was never the problem the article describes.** k10s passed its own use ("worked 99%") right
   up to collapse. **Architectural rot is invisible to a behavioral oracle** — a 110-case god-object
   `Update()` passes every behavior test. `correct ≠ maintainable`.

Architectural decay is the *uncapped, under-served, project-killing* dimension. And much of it is
**mechanically checkable** — no oracle-quality ceiling, no "who-verifies-the-verifier" problem.

## 2. Goal / non-goals

**Goal:** continuously enforce **human-authored architectural invariants** as a **gate on every
change**, so AI-built codebases can't silently rot. Catch the decay *as it's introduced*, diff by
diff — not at collapse.

**Non-goals:** designing the architecture (the human does that — the article's Tenet 1; the gate
*enforces*, it doesn't invent); replacing behavioral tests; generic style-linting; being a silver
bullet for architecture that genuinely needs human judgment.

## 3. Core idea

> A project declares **architectural invariants** (mostly mechanical, human-authored). On every
> proposed change, the **gate** checks the new state *and the delta* against them. A violating
> change is **blocked with the specific invariant + location + the human's rationale**, and (in an
> AI loop) fed back to the builder to fix — exactly the build→gate→fix shape, but for architecture
> and continuous.

Two properties make it more than a linter (see §9 for the honest caveats):
- **Project-specific architectural intent**, not generic style (per-view isolation, *your* Model
  discipline, *your* scope boundary).
- **Ratcheting / delta-awareness** — "don't get worse" against a baseline (catches the *trend*: the
  Model grew 12→30 fields, the switch 20→110 cases), not just absolute thresholds that fire forever.
- **Wired into the AI loop as an enforcement gate**, not a passive report you ignore.

## 4. The invariant model

An invariant (in `.anchor/invariants.yaml`, say):

```yaml
- id: model-not-god-object
  intent: "The Model struct stays a thin coordinator; per-view state lives in view structs."
  check: { kind: metric, target: "struct Model", metric: field_count, max: 12, mode: ratchet }
  severity: block
  scope: ["internal/ui/**"]
- id: no-positional-rows
  intent: "Rows are typed structs, never []string with magic indices (Tenet 4)."
  check: { kind: forbid-pattern, engine: ast-grep, pattern: "$ARR[$N]  // on []string row vars" }
  severity: block
- id: per-view-isolation
  intent: "No central dispatch on view identity (Tenet 2)."
  check: { kind: metric, metric: dispatch_branches_on, symbol: currentGVR, max: 0, mode: ratchet }
  severity: block
- id: mutations-on-main-loop
  intent: "Background goroutines send messages; they never write Model fields (Tenet 5)."
  check: { kind: forbid-pattern, engine: semgrep, rule: "field-write-inside-go-func" }
  severity: block
- id: scope-boundary
  intent: "Stay a GPU dashboard; don't become a k9s clone (Tenet 3)."
  check: { kind: scope-diff, allowed: scope.md, flag: new top-level commands/views/dirs }
  severity: warn
```

**Check kinds:**
- **metric** — thresholds: struct field count, method/function length, cyclomatic/branch count,
  switch-case count, file length, fan-out/coupling, dispatch-on-identity count. (god object, isolation)
- **forbid-pattern** — AST/structural patterns to ban, via **semgrep / ast-grep** (multi-language;
  don't reinvent parsing): magic-index access into untyped arrays, field writes inside goroutines,
  cross-context field access. (positional fragility, mutation discipline, leaks)
- **require-structure** — e.g. every view module implements interface `View`; mutations go through
  one designated function. (per-view isolation, message-passing)
- **scope-diff** — new top-level capabilities/commands/dirs not in a declared `scope.md`. (scope creep)
- **llm-judged** — last resort for the non-mechanical (e.g. "does this change respect the layering in
  ARCHITECTURE.md?"). **Advisory only / human-confirm** (see §8 — the AI caused the rot, so AI judging
  architecture has correlated blind spots).

Each invariant has: `intent` (human rationale, shown on violation), `severity` (block/warn),
`scope` (globs), and `mode` (`absolute` threshold vs `ratchet` = never-worse-than-baseline).

## 5. Ratcheting (the key to catching decay, not just end-state)

Most rot is a *trend*. The gate keeps a **baseline** (committed `.anchor/baseline.json`: the metric
values / violation counts of the last accepted state). On a change:
- `ratchet` invariants **block any regression** vs baseline (Model fields can't increase; god-object
  metric can't grow) even if the absolute threshold isn't hit yet — so you catch the 13th field, not
  the 30th.
- Improvements update the baseline (the ratchet tightens automatically).
- A deliberate, justified regression is accepted via an explicit, auditable baseline bump.

This is what would have caught k10s at commit ~20, not commit 234.

## 6. Execution model

Input: the **diff** + the **repo** (for context) + the **baseline**. Runs in three places (same engine):
1. **Pre-commit / pre-push hook** — local, fast (only re-check changed scopes + ratchet).
2. **CI gate** — full check on PRs.
3. **AI-loop gate** — the builder proposes a change → gate runs → on `block`, the violation
   (`id + location + intent`) is fed back to the builder to revise → re-check. The architectural
   analog of the behavioral build→gate→fix loop, and the place it matters most for AI-built code.

Verdict per change: `pass` / `block(violations[])` / `warn(violations[])`. Blocks carry the human
rationale so the fix is directed, not guessed.

## 7. Engine: compose, don't reinvent

The mechanical core is **static analysis**, and that's a solved substrate — **compose existing
engines** rather than write AST parsers:
- **semgrep / ast-grep** for forbid-pattern / require-structure (multi-language, pattern DSL).
- Language tooling for metrics (Go: `go/ast`, staticcheck; TS: `ts-morph`/eslint AST) behind a thin
  **per-language adapter** so invariant *specs* stay abstract (`god-object`, `positional-array`)
  while *checks* are language-specific.
- Anchor adds the layer that doesn't exist: **the invariant model, the ratchet/baseline, scope-diff,
  and the gate-in-the-AI-loop integration.**

## 8. Authoring invariants & independence

The human authors the invariants (Tenet 1) — that's the **independent architectural truth**, and the
mechanical checks are **deterministic (no model)**, so no correlated-blind-spot problem. Lower the
barrier without taking over:
- **Starter library**: the article's 5 tenets shipped as ready-to-enable, tunable invariants.
- **Bootstrap from CLAUDE.md / ARCHITECTURE.md**: parse architectural statements into *candidate*
  invariants for the human to approve.
- **LLM-assisted proposal, human-approves**: suggest invariants from the codebase; the human owns
  the accepted set. Never auto-enforce a model-proposed invariant without human sign-off.
- **`llm-judged` checks** stay advisory / human-confirm — the riskiest tier, used only where static
  analysis can't express the intent.

## 9. Honest caveats — what this is and isn't

- **Much of the mechanical core overlaps existing linters / custom AST rules.** The differentiation
  is the *packaging for AI-built codebases*: project-specific architectural intent + ratcheting +
  the gate-in-the-AI-loop + the starter tenet library. Be honest that we're standing on semgrep/etc.,
  not inventing static analysis.
- **Authoring good invariants takes architectural expertise and effort** — the harness lowers the
  barrier but cannot remove the human's responsibility to design (the article's whole point).
- **Mechanical checks can't capture all architecture**; the `llm-judged` tier is risky and bounded.
- **Over-strict gates frustrate** — needs good escape hatches: auditable per-line suppressions with a
  required justification (`// anchor:allow no-positional-rows: legacy, tracked in #123`), ratchet
  bumps, tunable thresholds. A gate people route around is dead.

## 10. Decay visibility

Beyond blocking new rot, emit an **architectural-debt trend** (metrics over commits): god-object
size, dispatch-branch count, suppression count, scope drift. Makes accumulating debt *visible early*
— the thing the k10s author only discovered at collapse.

## 11. Reuse from Anchor

The gate/runner/loop machinery (ADR 0001), the watchdog (for any LLM-judged sessions), and the
CLAUDE.md-as-constraints heritage all transfer. `CLAUDE.md` becomes the human-readable architecture;
`.anchor/invariants.yaml` is its **enforced** form — closing the gap that Anchor (and the article's
author) always had: constraints were *advisory*, never *gated*.

## 12. Phased plan

- **P0 — mechanical gate on one language.** Pick the language of the codebase to protect first
  (TS or Go). Implement 3–4 tenet invariants (god-object metric, positional-array forbid-pattern,
  off-loop-mutation, scope-diff) + the ratchet/baseline + a `check <diff>` CLI. **Demo: a sample repo
  with seeded k10s-style rot; confirm the gate blocks the rot-introducing diff and passes clean ones.**
- **P1 — AI-loop integration.** Wire the gate as a pre-commit hook AND a builder-feedback step.
- **P2 — authoring UX + trend.** Starter library, CLAUDE.md bootstrap, LLM-assisted proposals
  (human-approve), debt-trend report.
- **P3 — multi-language** via the adapter pattern + semgrep rules.

## 13. First prototype (concrete)

Reconstruct a minimal **god-object/positional-array rot** in a small sample repo (mirroring k10s:
a `Model` struct + a `[]string` row type + a central dispatch), author the 3 invariants for it, and
build the `check` CLI with ratchet. Validate it (a) **passes** the clean baseline, (b) **blocks** a
diff that adds a Model field / a magic-index access / a new dispatch branch, with the intent message.
That's the architectural analog of `test-gate.mjs` — a self-contained proof the gate catches the
exact decay that sank k10s.
