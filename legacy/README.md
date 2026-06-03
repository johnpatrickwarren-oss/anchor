# legacy/ — the original Anchor (archived)

This directory holds the original **Anchor build-orchestration methodology** and its
experimental `@anchor/*` tool, kept for provenance. **None of it is maintained.**

Anchor began as a five/six-role multi-agent orchestration pack (Architect → Implementer →
Reviewer → Memorial, plus TPM/Coordinator) distilled from running
[DeploySignal](https://github.com/johnpatrickwarren-oss/deploysignal) as a real multi-agent
project. With a 1M-context model, most of that machinery inverted into overhead — the reasoning
is in [`../design/adr/0001-pivot-to-verification-harness.md`](../design/adr/0001-pivot-to-verification-harness.md).

Anchor has since been re-founded as the **behavioral half** of a two-part quality stack: the
deterministic floor is [sprag](https://github.com/johnpatrickwarren-oss/sprag) (a mechanical
architectural-invariant gate), and the behavioral disciplines that still beat a strong base
model live in [`../DISCIPLINES.md`](../DISCIPLINES.md). Most of what's in this directory failed
one of two sieves — it's either now deterministically enforceable (so it belongs in sprag) or
something a strong model already does unprompted. See the *What used to be here* section of
`../DISCIPLINES.md` for the full mapping.

## What's here

| Path | What it was |
|---|---|
| `METHODOLOGY.md` | The consolidated reference for the five-role framework. Superseded by `../DISCIPLINES.md`. |
| `skills/` | The 16 individual disciplines. The portable ones are distilled into `../DISCIPLINES.md`; the rest were DeploySignal-specific scar tissue or are now sprag gates. |
| `templates/` | Fillable scaffolds for the coordination-heavy roles (PRD, spec, TPM reply, reviewer report, wave plan). |
| `packages/` | The `@anchor/*` TypeScript tool (role engine + gates + routing + memorial). |
| `integrations/` | The `superpowers-claude-code` bash pipeline (`run-pipeline.sh`, role prompts). |
| `case-studies/` | The DeploySignal coordination trail and other worked examples — the empirical record. |
| `prototypes/` | The verification-harness prototype that motivated the pivot. |
| `design/`, `design/multi-cluster-parallelism/` | The wave/DAG parallelism designs and the original arch-gate design that became sprag. |

If you want the orchestrator as it was, it still runs from here — but the maintained path is
sprag + `../DISCIPLINES.md`.
