# CLUSTER-HANDOFF-[NN]-WU[A]-WU[B] — [Source Work Unit] → [Target Work Unit]

_Fillable scaffold for the cross-cluster dependency contract artifact
described in [`skills/12-coordinator-role.md`](../skills/12-coordinator-role.md).
One file per directed dependency edge. Filename convention:
`CLUSTER-HANDOFF-[wave]-WU[source]-WU[target].md`. Do not merge multiple
edges into one artifact — one edge, one file, one clear accountability
boundary._

**From:** Coordinator TPM
**Date:** [YYYY-MM-DD]
**Wave:** Source cluster CL-[NN]-[A] (Wave [N]) → Target cluster CL-[NN]-[B] (Wave [N+1])
**Foundation:** `WAVE-PLAN-[NN].md` §WU-[A] + §WU-[B]; Reviewer report `REVIEWER-REPORT-[NN].md`
**Type:** cross-cluster dependency contract

---

## Purpose

This artifact is the interface contract between two clusters where one
cluster's output is a required input for another cluster's work. It
exists so the target cluster has an unambiguous, verified description
of what it is receiving — not a reference to go read the source
cluster's full output.

The target cluster reads this artifact before beginning work. The
Coordinator verifies this artifact is current at the wave gate before
authorizing dispatch.

---

## Dependency edge

- **Source cluster:** CL-[NN]-[A]
- **Source work unit:** WU-[NN] — [Work unit name]
- **Target cluster:** CL-[NN]-[B]
- **Target work unit:** WU-[NN] — [Work unit name]
- **Dependency test that fired:** [D1 / D2 / D3 / D4 / Claude judgment]
- **Edge confidence:** [HIGH / MEDIUM]
- **Edge reasoning:** [1-2 sentences. Why does the target depend on the source?]

---

## What the source cluster produced

[Concrete description of the output the target cluster will consume. Not
a pointer to go read the source — an actual description of the
interface, schema, file, or behavior being handed off.]

### Output artifact(s)

| Artifact | Location | Description |
|---|---|---|
| [filename or schema name] | [file path] | [What it is; what it contains] |

### Interface contract

[The specific interface the target cluster depends on. Be precise — this
is the contract the target cluster will build against and the
Coordinator will verify at the next wave gate.]

_If a data schema:_
[Schema definition — field names, types, nullability, any constraints]

_If a function / API surface:_
[Function signature or API contract — inputs, outputs, error conditions]

_If a UI component or behavioral contract:_
[Description of the component's props, events, or behavior the target
cluster depends on]

_If a file or configuration:_
[File path, format, and the specific fields/sections the target cluster
reads]

---

## Verification status

Per the source cluster's Reviewer report (`REVIEWER-REPORT-[NN].md`):

- [ ] Output artifact exists at the stated location (verified by Coordinator at wave gate)
- [ ] Interface contract matches what the source cluster's Reviewer confirmed
- [ ] No CRITICAL findings in the source cluster's Reviewer report affect this contract
- [ ] Anti-scope clauses from the source cluster's scope do not unexpectedly bound this output

---

## What the target cluster must not assume

[Explicit list of things the target cluster might reasonably assume but
should not. These are the anti-scope clauses and scope boundaries of the
source cluster that are most likely to cause misalignment.]

- The source cluster did NOT produce: [item — e.g., "authentication logic; that is WU-NN's scope"]
- The interface contract does NOT include: [item — e.g., "pagination; treat all results as single-page for now"]
- The source cluster's output is NOT guaranteed to: [item — e.g., "handle null tenant IDs; target cluster must guard"]

---

## Pre-flags from wave gate

[LIKELY-SURFACES findings from the source cluster's Reviewer report that
are relevant to the target cluster's work. Copied from
`WAVE-GATE-[NN].md`.]

- [LS-1]: [Description; what the target cluster should watch for]

_If none: "No pre-flags from Wave [N] gate applicable to this handoff."_

---

## Halt conditions for target cluster

[Conditions under which the target cluster should stop work and route
back to the Coordinator rather than proceeding.]

1. The interface contract above does not match what is actually present
   at the stated location.
2. A dependency on the source cluster's output surfaces that is not
   described in this artifact (route back — handoff artifact needs
   amendment, not a cluster-internal workaround).
3. The source cluster's output contains a behavior that conflicts with
   the target cluster's acceptance criteria (route back — potential
   spec conflict requiring Coordinator + Architect resolution).

---

## Coordinator verification log

[Filled in by Coordinator at each wave gate where this artifact is in
scope. Running record of verification status.]

| Wave gate | Date | Status | Notes |
|---|---|---|---|
| Wave [N] gate | [YYYY-MM-DD] | [CURRENT / NEEDS UPDATE] | [Any discrepancies found] |

---

## Amendment history

[If this artifact is amended after initial creation — e.g., because the
source cluster's scope-reduce produced a v1 that differs from the
original plan — record here.]

| Version | Date | What changed | Triggered by |
|---|---|---|---|
| v1 | [YYYY-MM-DD] | Initial creation | Wave [N] gate |
| v2 | [YYYY-MM-DD] | [What changed] | [Reviewer rejection / scope reduce / Architect amendment] |
