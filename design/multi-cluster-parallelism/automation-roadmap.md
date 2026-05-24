# Multi-track Anchor — automation roadmap

**Status:** Planning document. Captures the gap between today's MVP
(operator-driven multi-track via cluster-setup script + manual git
merges) and a turnkey workflow suitable for a public repo that a
non-developer could pick up.

**Origin:** ArchFolio Wave 1 live-exercise attempt, 2026-05-14. The
manual operator burden surfaced enough friction that further
investment in multi-track automation became higher priority than
completing the wave under the current MVP.

---

## Vision (end-state operator experience)

A non-developer running multi-track Anchor against an existing
project should need three commands per wave, total:

```bash
anchor-wave init                          # one-time per project; sets up dirs, syncs canonical
anchor-wave dispatch --wave N             # creates worktrees, plants scopes, launches pipelines
anchor-wave gate --wave N                 # aggregates, merges, prompts for advance/hold
```

Plus optionally one running TPM-monitor Claude session for the whole
project, doing `anchor-wave monitor` continuously. ESCALATEs surface
in that one place. No per-cluster Claude sessions; no manual git
merges; no manual pnpm installs; no manual scope authoring; no
manual file copying from canonical.

---

## Pain points (observed in 2026-05-14 ArchFolio Wave 1 attempt)

| # | Friction | Today's burden |
|---|---|---|
| 1 | Prior round close still manual | Operator manually identifies 5 Memorial-Updater artifacts + writes commit message |
| 2 | WAVE-PLAN promotion manual | Operator manually `cp` from canonical case-study into archfolio coordination/ |
| 3 | 4 setup commands per wave | Operator runs setup script N times with copy-pasted args |
| 4 | 4 Claude sessions to manage | Operator opens N sessions in N worktrees, types commands in each |
| 5 | pnpm install per worktree | Operator must remember; node_modules not shared across worktrees |
| 6 | Tier-name CLI drift | Project's run-pipeline.sh stuck on T0/T1/T3; scope blocks use solo/audit/full; operator must mentally translate |
| 7 | Scope-block flag every call | Operator must remember `--scope $SCOPE_DIR/<id>.md` per cluster |
| 8 | Nested Claude / shell-escape confusion | Operator must know `!` prefix semantics, or open a separate terminal |
| 9 | Manual git merge per cluster | Operator merges each branch, resolves memorial/CLAUDE.md conflicts by hand |
| 10 | Manual verify-wave-merge | Operator remembers to run verify script after merging |
| 11 | Manual WAVE-GATE-NN authoring | Operator templates wave-gate doc and fills in 4 cluster results |
| 12 | Manual worktree cleanup | Operator runs `git worktree remove` per cluster + `git branch -D` |

Net cost: ~30-60 min of operator coordination per wave on top of the
actual pipeline runtime. Two waves doubles it. The four-clusters-of-
Wave-1 multiplier means the operator's attention is taxed across the
whole window even when pipelines are running themselves.

---

## Lifecycle phases (the dispatch model)

For each wave:

1. **Pre-flight** — verify clean main, wave plan present, scopes
   present, no in-flight worktrees from a prior aborted wave.
2. **Dispatch** — create N worktrees, plant N scopes, pnpm install
   per worktree, launch N background pipelines with log redirection,
   capture PIDs in a status file.
3. **Execution** — N pipelines run independently. Existing
   run-pipeline.sh unchanged (it already spawns headless `claude -p`
   per role).
4. **Monitor** (optional but recommended for operator visibility) — a
   single coordinator process aggregates all N log streams,
   surfaces role transitions and ESCALATEs, reports completion.
5. **Gate** — once all N reach terminal state (ROUND-COMPLETE or
   explicit disposition): aggregate memorial fragments, merge cluster
   branches with custom strategy, run verification, generate
   WAVE-GATE-NN draft, prompt operator for advance/hold.
6. **Cleanup** — remove worktrees, delete cluster branches.

Single-round project close (the not-multi-track-specific case from
pain point 1) is a separate one-command helper:
`anchor-round close` — auto-commits the standard Memorial-Updater
artifacts.

---

## Backlog (prioritized)

Effort estimates: S = <2 hours, M = ~half day, L = 1+ days, XL =
multi-day.

### Tier A — must land for first turnkey wave

| ID | Item | Effort | Depends on |
|---|---|---|---|
| A1 | `anchor-round close` — commits the standard 5 Memorial-Updater artifacts with auto-generated commit message | S | — |
| A2 | `anchor-wave init <project>` — copies WAVE-PLAN template, cluster-scopes scaffold, syncs run-pipeline.sh from canonical, adds `.gitignore` for clusters | S | — |
| A3 | `anchor-wave dispatch --wave N` — parses wave plan (probably needs YAML format alongside the .md), creates worktrees, plants scopes, runs pnpm install, launches N background pipelines with per-cluster log redirection, captures PIDs | L | A2; depends on wave-plan format change (B1) |
| A4 | Tier-name canonical sync OR backward-compat in run-pipeline.sh that accepts both legacy and new | S | — |
| A5 | `anchor-wave gate --wave N` — waits for all clusters to reach terminal state; aggregates memorial fragments via custom merge driver; auto-merges cluster branches; runs verify; generates WAVE-GATE-NN draft | L | A3 |
| A6 | Custom git merge driver for `coordination/MEMORIAL.md` and `CLAUDE.md` — union append-only strategy, no operator conflict resolution | M | — |
| A7 | **Memorial-Updater role auto-commits its outputs at clean completion.** Today the Memorial-Updater writes REVIEWER-REPORT-RNN.md, ROUND-RNN-SUMMARY.md, CLAUDE.md REINFORCED appends, MEMORIAL.md appends, and NEXT-ROLE.md final state — but does NOT commit them. The operator must commit at round-close. This is fine for single-track (operator is attending) but in multi-track the operator isn't attending each cluster end. **The Memorial-Updater step in run-pipeline.sh must run a final commit after the role's session ends.** Empirically validated as the highest-cost recovery item in Wave 1 (F1 finding). | S | — |
| A8 | **Fix `multi-track-verify-wave-merge.sh` to work post-merge.** Today it does `git diff main...$BRANCH` which is empty after merging the branches. Replace with a tag-based comparison: at dispatch time, the dispatcher tags `pre-wave-N-merge`; verify diffs main HEAD against that tag instead of the cluster branches. F2 finding. | S | A5 |
| A9 | **`.gitignore` per-round `.pipeline-RNN.lock` files.** Implementer commits these as part of SHA-A coordination artifacts, then run-pipeline.sh deletes them at pipeline end, but the deletions are uncommitted (rolled into Memorial-Updater's uncommitted state). Fix: add `coordination/.pipeline-*.lock` to project `.gitignore` so they're never tracked. F5 finding. | S | — |

### Tier B — quality of life

| ID | Item | Effort | Depends on |
|---|---|---|---|
| B1 | Wave-plan structured-format split — markdown for humans, YAML/JSON sibling for dispatchers (markdown table parsing in bash is unreliable) | S | — |
| B2 | `anchor-wave status` — snapshot of where each cluster is in its pipeline (which role, last log line, ESCALATE state) | S | A3 |
| B3 | `anchor-wave monitor` — long-running aggregator that tails all cluster logs into one stream with cluster-id prefixes; emits notifications on role transitions and ESCALATEs | M | A3 |
| B4 | ESCALATE handler — when a cluster ESCALATEs, monitor surfaces to operator with cluster-id context; operator's resolution writes back to the cluster's NEXT-ROLE.md and pipeline resumes | M | B3 |
| B5 | Cleanup integrated into gate command — auto-removes worktrees and deletes branches after successful merge + verify | S | A5 |

### Tier C — polish / future

| ID | Item | Effort | Depends on |
|---|---|---|---|
| C1 | TPM coordinator role as Claude session — one long-running interactive Claude that runs `anchor-wave monitor` under the hood; operator interacts only with this session | M | B3, B4 |
| C2 | Schema for `coordination/multi-track-config.json` — declares migration directory, per-DB lock opt-in, timeout overrides, max-parallelism-per-wave | S | A3 |
| C3 | Cross-project memorial merge script (`merge-cross-project-memorial.sh`) — weekly batched merge per skills/12 §Memorial state | S | — |
| C4 | Migration lock primitive (D5-contention runtime arbitration) | M | A3 |
| C5 | Cluster failure recovery — if a cluster's pipeline dies mid-flight, dispatcher detects and resequences | M | A3, A5 |

### Tier D — explicit non-goals

| Item | Why not |
|---|---|
| Real-time mid-flight cross-cluster coordination | Per skills/12, deliberately out of scope — clusters are independent during execution |
| Generic `claude` headless wrapper that's not Anchor-specific | Out of scope for this methodology; that's a Claude Code feature |
| GUI for wave dispatch / monitoring | The CLI + Claude monitor session already covers operator UX; GUI is a separate product |

---

## Wave 1 empirical findings (2026-05-14)

ArchFolio's Wave 1 ran 4 cluster pipelines in parallel against a real
PRD; all reached MERGE-READY with no CRITICAL findings. The empirical
exercise surfaced 5 friction points (F1–F5) that map onto the backlog
above. Captured here so the priority of the existing items is
data-driven rather than speculative.

| Finding | Backlog item it maps to | Empirical weight |
|---|---|---|
| **F1**: Memorial-Updater outputs uncommitted at cluster pipeline end | **A7** (new) | Highest. Caused ~10 min of recovery work per wave; 4 cluster outputs (Reviewer report, Round summary, MEMORIAL appends, CLAUDE.md REINFORCED appends, NEXT-ROLE.md final state) had to be manually committed in each worktree then cherry-picked onto main with union-merge resolution. |
| **F2**: `multi-track-verify-wave-merge.sh` uses pre-merge diff semantics post-merge | **A8** (new) | Medium. Verifier returned PASS with misleading "no CONFIRMATION/VIOLATION lines added" warnings — operator could plausibly trust PASS without realizing the check was inert. Independent sanity check on main revealed all 4 Reviewer reports were missing. |
| **F3**: Manual conflict resolution on 5 distinct conflict types per merge | **A6** (existing) | High. Per-merge cost of manual resolution scales with wave size. Validated patterns:<br/>• Trivial / role-stamp area → take theirs<br/>• Append-only files (MEMORIAL.md) → awk strip-markers union<br/>• Whole-file rewrites (NEXT-ROLE.md, PRD.md) → take theirs<br/>• Parallel schema additions to a shared model (prisma/schema.prisma Firm) → manual Edit, harmonize alignment + union relations<br/>• Constants list (audit-events.ts) → awk union worked clean.<br/>Custom merge driver in A6 covers append-only files; the schema/code cases probably need a "sentinel-comment region" convention for parallel additions to a shared file. Worth a sub-task under A6. |
| **F4**: Tier-name CLI drift (T0/T1/T3 in project, solo/audit/full in canonical/scopes) | **A4** (existing) | Medium. Operator had to mentally translate `--tier audit` → `--tier T1` at every dispatch. Error-prone. The existing A4 captures this cleanly. |
| **F5**: `.pipeline-RNN.lock` files committed by Implementer, deletions not committed | **A9** (new) | Low. Cosmetic — adds untracked deletion noise to each cluster worktree. Easy fix (gitignore line). |

### Pattern observed but not in backlog

**Same wall-clock-second migration timestamps** (R41 + R43 both at
`20260514120000`) — Prisma applied them in lexicographic order without
issue because the schemas were disjoint, validating the D5-contention
path in skills/12. If a project's wave had migrations writing to the
same schema surface AND identical timestamps, this could collide.
Lock primitive (existing C4) is the right place to address.

### Methodology learning yield from Wave 1

18 new REINFORCED lines added to ArchFolio CLAUDE.md (R40: 5, R41: 3,
R42: 4, R43: 6). 124 new CONFIRMATION/VIOLATION entries across the 4
clusters. The 4-way parallel dispatch surfaced more discipline gaps in
a single wave than several recent serial rounds combined — early
evidence that multi-track functions as a methodology stress-test
independent of its wall-clock benefit.

---

## Implementation order (suggested)

Three milestones:

**Milestone 1: single-round close + wave init.** A1 + A2 + A4. ~half
day total. Lands a clean `anchor-round close` (immediately useful for
single-track work too) plus the wave-init scaffolding. Validates the
end-to-end workflow at a small scale before committing to dispatch
automation.

**Milestone 2: end-to-end dispatch + gate.** A3 + A5 + A6 + B1. ~2-3
days total. The heart of the automation. After this milestone, a
non-developer can run `anchor-wave dispatch --wave N` and `anchor-wave
gate --wave N` to execute a full wave without touching git directly.

**Milestone 3: monitor + ESCALATE handling.** B2 + B3 + B4 + C1. ~1
day total. Adds the TPM coordinator role as a real interactive
session that the operator can talk to during the wave. ESCALATEs
surface in one place. Per-cluster failures get visibility.

After Milestone 3, multi-track Anchor is genuinely turnkey. Tier C
items can land opportunistically.

Total effort: ~4-5 days of focused work to get from today's MVP to
turnkey.

---

## Implementation considerations

- **Bash vs another language.** The setup/dispatch scripts so far are
  bash. For YAML parsing (B1) and per-cluster process management (A3),
  Python or Node may be cleaner. Trade-off: more dependencies vs more
  robust parsing/concurrency. Suggestion: stay bash for setup +
  individual scripts; introduce Python (already a system dep) for the
  dispatcher if bash gets ugly.
- **Process backgrounding strategy.** For A3, the cleanest pattern is
  bash `&` with PID capture to a status file. Alternatives (tmux,
  pm2, daemon) add operator-visible state without much win. Pick bash
  backgrounding + log redirection unless something forces an upgrade.
- **Custom merge driver for memorial files.** A6 needs a git custom
  merge driver registered in `.gitattributes`. Anchor's pattern is
  append-only; the driver does literal-line union with dedup. ~30
  lines of bash. The wave gate sets `merge.anchor-memorial.driver`
  before invoking `git merge`.
- **Wave-plan format.** Current WAVE-PLAN-NN.md is markdown with
  tables. For dispatchers to parse reliably, a sibling
  `WAVE-PLAN-NN.yaml` (same data, different format) is the cleanest
  fix. The Coordinator authors both at planning time, or a derive
  script produces the YAML from the markdown.
- **Project portability.** Today's scripts assume the project is at
  `~/projects/<name>/` and clusters land at `~/projects/<name>-
  clusters/`. Generalize via env var or config file so projects in
  other locations work.
- **R39-style "operator commits the round close" pattern.** A1's
  `anchor-round close` should detect the round number from
  `coordination/NEXT-ROLE.md` (CURRENT-ROUND field) so the operator
  doesn't have to type it. Same for the commit-message template.
- **Auto-detect tier from scope block.** The cluster-setup script
  already takes the tier as an arg. For full automation, the
  dispatcher reads the wave plan's Step 6 tier classifications, no
  manual tier passing.

---

## Open decisions

- **Distribute as anchor CLI or per-project scripts?** Today the
  scripts live at `~/anchor/integrations/superpowers-claude-code/`
  and are invoked by absolute path. A future `anchor` CLI installed
  globally (npm or homebrew) would be cleaner UX. Operator's call.
- **TPM coordinator session as Claude Code custom command?** Could
  be a `/wave-monitor` slash command in Claude Code (per the
  custom-skill mechanism). Or just a regular script the operator
  runs in any Claude session. Slash command is more discoverable;
  script is simpler to ship.
- **Round-close vs wave-close distinction.** Round close = one
  cluster's pipeline finishing inside a wave. Wave close = wave-gate
  aggregation. Today the line blurs because single-track is round-
  per-round. A1's `anchor-round close` works for both single-track
  and per-cluster contexts (each cluster's worktree gets its own
  round close). Wave close is `anchor-wave gate` and aggregates the N
  round closes.
