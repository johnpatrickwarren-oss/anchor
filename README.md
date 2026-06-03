# anchor

> **The behavioral half of code quality.** [sprag](https://github.com/johnpatrickwarren-oss/sprag)
> is the deterministic half.

Anchor is a small, deliberately short set of **behavioral disciplines** that still beat a strong
base model's defaults — the judgment calls you can't compile into a gate. It pairs with
[sprag](https://github.com/johnpatrickwarren-oss/sprag), which enforces the *deterministic* floor
(structure, test-efficacy, scope) mechanically, with no model in the loop.

**sprag is the gate. Anchor is the prompt.** Together they are the whole quality stack — a
mechanical floor plus a handful of disciplines — with no orchestration harness.

## The disciplines

The substance is one file: **[`DISCIPLINES.md`](DISCIPLINES.md)**. Six disciplines, two
load-bearing:

1. **Independent cold-eye review** — a fresh-context reviewer, prompted to find what's wrong, that never saw the build reasoning. *(load-bearing)*
2. **Spec-first contract** — acceptance criteria + anti-scope before code; every conjunct and every prescription gets a check. *(load-bearing)*
3. **Halt-on-contradiction** — verify the spec's premises; when spec ≠ reality, stop and ask a bounded question instead of coding around it.
4. **V/Q debugging** — enumerate hypothesis variants before going deep; frame the falsifying question; re-enumerate after ~3 dead ends.
5. **Honest measurement** — instrument the gap, don't footnote it; a headline that needs a caveat is misreporting.
6. **Durable project trail** — leave a cold-readable record: overwrite a short `STATE.md` (the "now"), append one ADR per decision (the "forever"). So a project survives a months-long gap or a handoff.

Each entry gives the trigger, the discipline, *why it beats the base model's default*, and how to
apply it in a dynamic session.

## Why it's short

A discipline earns a place only if it passes **both** sieves: (1) it can't be made deterministic —
else it's a sprag invariant, not prose; and (2) it still beats the base model's default — else
it's ceremony. Most of the original Anchor fails one sieve; the full mapping is in *What used to be
here* in `DISCIPLINES.md`. The list also has a **half-life**: re-test each entry on every model
upgrade and retire what the model now does unprompted — that ritual is what keeps the pack from
becoming the overhead it replaced.

## How to use it

Pair it with sprag. Reference `DISCIPLINES.md` from your project's `CLAUDE.md`
(e.g. `@DISCIPLINES.md`) so the agent applies the disciplines in-context, and let sprag's gate
enforce the deterministic floor. No roles, no pipeline, no runtime.

To produce the spec that Discipline 2 needs — especially when the operator isn't a developer — use
the question-driven [`PRD-INTERVIEW.md`](PRD-INTERVIEW.md): the operator answers plain-language
questions, a model drafts the PRD (and, per unit, candidate properties) **impl-blind**, and the
deterministic gate accepts. Two tiers: a project-scoping interview and the validated unit-property
set that feeds sprag's `arch property`.

## History

Anchor began as a five/six-role build-orchestration methodology distilled from running
[DeploySignal](https://github.com/johnpatrickwarren-oss/deploysignal) as a multi-agent project
(250+ coordination files; ~94% autonomous execution — self-measured, one project). With a
1M-context model the orchestration largely inverted into overhead. The design trail is in
[`design/adr/`](design/adr/): ADR-0001 (orchestration → overhead) and ADR-0002 (the
deterministic / behavioral split — sprag and this repo — that resulted). The original methodology
and the experimental `@anchor/*` tool are preserved, unmaintained, in [`legacy/`](legacy/).

## License

Apache-2.0 — see [`LICENSE`](LICENSE). © 2026 John Warren ·
john.patrick.warren@gmail.com
