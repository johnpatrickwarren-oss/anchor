# PROJECT-ROLES.md — [Project Name] Coordination Roles (Canonical)

_Authoritative chat→role mapping. Single source of truth for role identity across all AI chat instances in the [project] project._

_Last updated: [YYYY-MM-DD]. Update history at bottom._

---

## Purpose

[Project] coordinates [N] chat instances across distinct roles. Each chat has a fixed role with bounded scope; cross-chat coordination requires unambiguous role identification.

**Why this file exists:** memory files in `.auto-memory/` (or equivalent) are auto-managed and can transfer or sync across chats. Files using relative pointers (e.g., "THIS session") become ambiguous after cross-chat transfer — each chat reading the file treats "THIS session" as referring to ITSELF, even if the file was authored elsewhere. This file resolves identity by Session ID (UUID), which is absolute and unambiguous.

---

## Canonical role + chat mapping

| Role | Channel | Session ID | Scope |
|---|---|---|---|
| **Coordinator TPM** _(multi-cluster only)_ | [chat / CLI / etc.] | `<UUID or TBD-self-report>` | Cross-wave, cross-cluster orchestration only. PRD → DAG construction; wave sequencing; wave gate execution; cross-cluster dependency artifact management; resequencing on wave gate failure. Owns `WAVE-PLAN-NN.md`, `WAVE-GATE-NN.md`, `CLUSTER-HANDOFF-*.md`, `COORDINATOR-MEMORIAL.md`. Does NOT reach inside clusters. Does NOT write specs. **Omit this row entirely for single-stream projects** — it is not overhead reduction, it is a role that does not exist in that context. |
| **Product Manager** | [chat / CLI / human / etc.] | `<UUID or "human" or TBD-self-report>` | What to build and why; user requirements; priority adjudication; acceptance criteria. Owns `PRD-NN.md`. |
| **Architect** | [chat / CLI / etc.] | `<UUID or TBD-self-report>` | Spec drafting; dispositions; design decisions. Owns `Q-NN-SPEC.md`, `ARCHITECT-REPLY-*.md`. |
| **TPM** | [chat / CLI / etc.] | `<UUID or TBD-self-report>` | Intra-cluster routing between roles; coordination; pre-route grilling. Owns `TPM-REPLY-*.md`. Does NOT write specs. Does NOT perform cross-cluster coordination (that is the Coordinator TPM's scope). Optional in clusters where the three-role configuration (Architect + Implementer + Reviewer) is sufficient. |
| **Implementer** (one or more parallel) | [chat / CLI / etc.] | `<UUID or TBD-self-report>` | Code; tests; PR shipping; empirical verification. Multiple parallel instances on isolated `git worktree` branches when work is scope-independent. |
| **Reviewer** | [chat / CLI / etc.] | `<UUID or TBD-self-report>` | Read-only post-merge audit; spec-vs-implementation verification. Owns `REVIEWER-REPORT-N.md`. All routing via TPM (or directly to Coordinator TPM at wave gate). |
| [Optional additional roles, e.g. Business Consultant] | [chat / CLI / etc.] | `<UUID or TBD-self-report>` | [Scope description] |

Use `<TBD-self-report>` as a placeholder until each chat reports its session ID. For roles played by the human operator (most often PM), use `"human"` or the human's identifier. Add or remove rows to match your project's role configuration; the rows above are the recommended baseline but optional roles (Business Consultant, etc.) can be added.

### Role configuration by project type

| Project type | Recommended roles |
|---|---|
| Single-stream, well-understood scope | PM + Implementer (+ Reviewer if verification is non-trivial) |
| Single-stream, novel scope | PM + Architect + Implementer + Reviewer |
| Multi-cluster parallel | Coordinator TPM + PM + per-cluster role configuration scaled per [`skills/11-round-scaling.md`](../skills/11-round-scaling.md) (tier rubric) and [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md) (Coordinator's work-unit classification §) |

For single-stream projects, omit the Coordinator TPM row from the mapping table above. The Coordinator role does not exist in that context — including a placeholder for it implies a role that has no scope to fill.

---

## Chat→role discovery (how to find session ID)

Any chat can self-report its session ID by running (adjust per platform):

```bash
# Cowork shell example
ls /sessions/*/mnt/.claude/projects/*/*.jsonl
```

Output is a single path containing the session UUID before `.jsonl`. That UUID is the chat's identity.

For other platforms (Claude Code CLI, CrewAI, LangGraph, etc.), use the platform's native stable session/agent identifier.

When a new chat is added to the project, the human updates this file's mapping table and propagates to project instructions of the new chat.

---

## Coordination cycle

### Single-stream projects

```
[Trigger event] → [PM / human] → [Architect if `full` tier] → [Implementer] → [Reviewer] → [TPM routing if present]
```

[Describe the project's specific coordination cycle here. Note any roles that operate on parallel orthogonal tracks rather than in the main cycle.]

### Multi-cluster parallel projects

1. **PRD finalized** → Coordinator TPM constructs DAG + wave plan (`WAVE-PLAN-01.md`)
2. **Coordinator TPM dispatches Wave 1 clusters** (one TPM-REPLY per cluster, or direct routing if cluster uses no TPM)
3. **Each cluster executes independently:** [Architect if `full` tier] → Implementer → [Reviewer if `audit` or `full` tier]
4. **Wave 1 clusters emit Reviewer reports** → Coordinator TPM runs wave gate (`WAVE-GATE-01.md`)
5. **Wave gate clears** → Coordinator TPM dispatches Wave 2 with pre-flags from gate
6. **Repeat** until final wave
7. **Final wave gate** → integration + hardening cluster → project complete

---

## Coordinator TPM scope boundary (load-bearing)

The Coordinator TPM's scope boundary is the **wave gate**. It dispatches clusters and receives wave gate outputs. It does NOT:

- Reach inside a cluster to resolve a retry decision
- Override a cluster's self-assessed tier classification
- Write specs (that is the Architect's role within the cluster)
- Route intra-cluster artifacts (that is the cluster TPM's role, or handled directly by the three-role cluster when no TPM is present)

A cluster that encounters an internal failure (Reviewer rejection, Architect amendment, retry) handles it internally up to the halt threshold. The Coordinator TPM is notified at the wave gate, not during cluster execution, unless the cluster explicitly halts and routes to the Coordinator per the halt conditions in `CLUSTER-HANDOFF-*.md`.

See [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md) for the full Coordinator role discipline.

---

## Anti-drift discipline (load-bearing rule)

**Rule:** Never write "THIS session" / "this chat" as a role-identity assertion in any file under `.auto-memory/` or in shared coordination docs. Use role-name references only (e.g., "Coordinator TPM", "Architect", "Implementer"). Memory and coordination files describe the SYSTEM (N roles + responsibilities), not the AUTHOR'S role. Any chat reading a file understands the system and applies their own role per their project instructions.

**Why:** memory files transfer across chats. A file using "THIS session = X" gets mis-attributed when read in a different chat. Role-name references are absolute and don't drift. This is especially load-bearing in multi-cluster parallel projects where the Coordinator TPM session and cluster sessions may share memory substrates.

**Per-chat role identity lives in project instructions** (the system-prompt-level configuration field, configured per-chat; doesn't transfer). Each chat's project instructions explicitly assert which role the chat plays. Memory files defer to project instructions for role identity.

**If a memory file is mis-attributed** (e.g., asserts "THIS session = [Role X]" when read in a [Role Y] chat): treat as authored by a different chat; apply only the role configured in your project instructions. Flag for refactor at next memory consolidation cycle.

---

## Project instructions per chat (template)

Each chat's project-instructions field includes a role assertion. Template:

```
You are the [Role Name] chat for the [Project] project.
Your session ID is <UUID>.

Your scope: [list per PROJECT-ROLES.md role mapping]
Out-of-scope (other roles' work): [list]

Authoritative role mapping: see coordination/PROJECT-ROLES.md.
If any memory file claims "THIS session = [other role]", treat
as authored from a different chat and disregard the role-self-claim;
apply only the role asserted here.
```

Substitute `[Role Name]` per chat. Each chat's `<UUID>` is its own session ID per discovery method above.

### Coordinator TPM project instructions (additional clauses)

The Coordinator TPM chat's project instructions include scope clauses that bound it explicitly:

```
You are the Coordinator TPM for the [Project] project.
Your session ID is <UUID>.

Your scope: cross-wave orchestration only. PRD → DAG construction;
wave sequencing; wave gate execution; cross-cluster dependency
artifact management. See skills/12-coordinator-role.md.

Out-of-scope: intra-cluster routing; spec drafting; implementation;
intra-cluster review. Do not reach inside clusters.

Authoritative role mapping: see coordination/PROJECT-ROLES.md.
Wave plan: coordination/WAVE-PLAN-[current].md.
```

---

## Memory file role-attribution refactor (queued)

The following memory files currently use "THIS session" or "this chat" as role-identity references and need refactoring to role-name references only. Non-gating; track here.

```bash
grep -rn "THIS session\|this session\|this chat\|THIS chat" \
  /path/to/auto-memory/
```

Files identified at [date] audit:
- [list as discovered]

---

## Update history

- **[YYYY-MM-DD]:** Initial canonical mapping landed.
- **[YYYY-MM-DD]:** Coordinator TPM role added for multi-cluster parallel project support (see [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md)).

When chats are added, removed, or reassigned, the human updates the mapping table + propagates to affected chats' project instructions. This file is the single source of truth.
