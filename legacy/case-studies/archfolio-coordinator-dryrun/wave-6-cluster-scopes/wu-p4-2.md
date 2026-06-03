## Round R61 scope (Wave 6b cluster wu-p4-2) — current round

R61 ships **WU-P4.2** from `WAVE-PLAN-01.md`. One PRD FR:
**FR-CLI-06 (milestone status link for clients)**. Audit tier.
Reads payment-milestone schema (from R40 contract base template +
will integrate with R62/WU-P4.3 milestone reminders).

### Tier verdict

**Tier:** `audit`. S3 (single bounded item).

### Scope

**In scope:**

1. **Client-facing milestone status link** — per AC-CLI-06-1:
   builder shares a "project status" link; client opens without
   logging in; sees list of payment milestones (label, amount,
   status Upcoming/Completed) + current project status + builder
   contact info. No internal data leakage (line items, pricing,
   other client info).
2. **Token-gated public route** — `/status/[token]` (or similar
   convention; align with R46 contract link pattern). Unique per
   project (or per contract).
3. **Live status reflection** — per AC-CLI-06-2: when builder
   marks a milestone Paid (via FR-CON-10 / WU-P4.3 lands later),
   the status link reflects update within 60s.
4. **MilestoneStatusLink schema** — token, projectId, expiresAt,
   createdAt.

### Acceptance criteria

- **AC-R61-01:** Schema migrated; status link generation works.
- **AC-R61-02:** Anonymous access via token. Test: no auth, GET
  /status/[token] returns rendered page with milestone list +
  project status + builder contact info.
- **AC-R61-03:** PII isolation. Test: assert rendered HTML does
  NOT contain line item descriptions, unit prices, or other
  clients' info from same firm.
- **AC-R61-04:** Status reflection. Test: mark milestone Paid via
  internal action; reload /status/[token]; assert milestone status
  updated.
- **AC-R61-05:** Invalid token returns 404 / not-found page.
- **AC-R61-06:** Audit event `status_link.viewed` emitted on
  client access (with first-view-only idempotency similar to R48
  viewedAt pattern).
- **AC-R61-07:** All 5 binding commands. test:e2e actually run.
- **AC-R61-08:** SHA-A invariant.

### Anti-scope

- No client account / authentication.
- No milestone payment processing.
- No client-side change order signing (R57 covers that separately).

### Reinforcements

- **Anti-self-confirming:** PII isolation test must read actual
  rendered HTML, not setup data.
- **§2.x manifest:** new public route + schema + action; inventory.

### Cluster context (Wave 6b)

Parallel with wu-p3-5, wu-p3-7, wu-p4-1, wu-p4-3. wu-p4-3 (payment
milestone reminders) writes the `paidAt` field this cluster reads;
both should land in same wave. Test for milestone-paid reflection
may mock-set the field if R62 hasn't landed yet.
