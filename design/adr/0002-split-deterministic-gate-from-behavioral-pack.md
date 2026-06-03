# ADR 0002 — Split: deterministic gate (sprag) + behavioral pack (Anchor)

- **Status:** Accepted
- **Date:** 2026-06-02
- **Decision owner:** project owner
- **Refines:** [`0001-pivot-to-verification-harness.md`](0001-pivot-to-verification-harness.md)

---

## Context

ADR-0001 concluded that with a 1M-context model the multi-role build orchestrator had inverted
into overhead, and that the durable value was **independent verification** of the build, not the
orchestration. Its *decision* was to re-found Anchor as an independent-verification harness — a
spec → independent oracle → build → grade → fix-loop around a dynamic builder.

What actually happened when we built it out diverged from that decision in one important way. The
"independent verification" 0001 identified resolved into **two orthogonal things**, not one harness:

1. **Deterministic structural / test-efficacy enforcement** — god-objects, coupling, layering,
   complexity, "no untested code," "no rotting tests," test *efficacy* via mutation. These are
   mechanically checkable with **no model in the loop**, so they have no oracle-quality ceiling and
   no "who-verifies-the-verifier" problem (0001's own central risk).
2. **A small set of behavioral disciplines** that still beat a strong base model's defaults —
   independent cold-eye review, spec-first contracts, halt-on-contradiction, V/Q debugging, and
   honest measurement. These are irreducibly judgmental; they can't be compiled
   into a gate.

The model-based "independent oracle" of 0001 turned out to be the weaker bet for (1): a generated
oracle shares the builder's **same-model-family blind spots**, so it re-imports the correlation
0001 was trying to escape. A deterministic gate does not. Meanwhile (2) is real but is a *prompt*,
not a harness.

## Decision

**Do not build a single verification harness. Split the value into two repos along the
deterministic / behavioral line.**

- **[sprag](https://github.com/johnpatrickwarren-oss/sprag)** — the deterministic gate. Human-
  authored architectural invariants, ratcheted, enforced mechanically on every change; test
  presence (`require_tests`), anti-rot (`time_bomb_tests`), and test *efficacy* (`arch mutate`).
  No model. This is the structural floor.
- **Anchor** — the behavioral pack ([`../../DISCIPLINES.md`](../../DISCIPLINES.md)): the five
  incentive-fighting disciplines, governed by a **two-sieve filter** (a discipline belongs here
  only if it can't be made deterministic *and* still beats the base-model default) and a
  **half-life ritual** (re-test each entry on every model upgrade; retire what the model now does
  unprompted).

**Clean partition, no item in two homes:**

- Anchor → the five behavioral disciplines.
- Base-model defaults (TDD, brainstorm, systematic debugging) → shipped **nowhere** as a
  discipline; the model does them. That is the filter working.
- sprag → the gate, the checks, and **gate-usage** notes that necessarily mention TDD / authoring
  invariants / running the gate (because the gate enforces them) — framed as how to operate the
  gate, not as a behavioral methodology. Plus a pointer up to Anchor for the behavioral half.

The irreducible residual 0001 was chasing — *is the build what we meant?* — stays where it belongs:
with the **human in the spec loop** (Anchor discipline 2), backed when stakes justify it by a
**genuinely decorrelated** reviewer — a different model, or property / differential tests (Anchor
discipline 1) — never a same-model oracle pretending to be independent.

## Consequences

**Positive**
- No "who-verifies-the-verifier" problem on the structural floor: it's deterministic.
- Each repo is one thing. sprag is purely deterministic; Anchor is purely behavioral. The overlap
  (a behavioral doc in both) is designed out.
- The half-life ritual keeps Anchor from re-accreting into the overhead it replaced — the failure
  mode the orchestrator died of.

**Negative / risks**
- The behavioral pack is a bet that the model *won't* do these unprompted — the same bet the
  orchestrator lost. Mitigated by the half-life re-test, not eliminated.
- Spec quality still bounds everything: both repos verify *conformance*, never that the spec was
  what you wanted. That residual is human, by design.

## Relationship to ADR-0001

This **refines, it does not reverse.** 0001's core finding holds: orchestration inverted into
overhead; the value is independent verification. What changed is the *shape* of "independent
verification" — it is a **deterministic gate (sprag) + a human-authored spec + an optional
decorrelated reviewer**, not a model-based oracle harness. The salvage 0001 mapped (the green-gate
with its criterion swapped to an independent check, role-isolation as independence enforcement)
landed as sprag's mechanical checks and Anchor's cold-eye discipline respectively. The original
orchestrator and the `@anchor/*` tool are archived, unmaintained, in [`../../legacy/`](../../legacy/).
