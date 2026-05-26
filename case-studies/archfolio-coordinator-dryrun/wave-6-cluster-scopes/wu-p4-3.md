## Round R62 scope (Wave 6b cluster wu-p4-3) — current round

R62 ships **WU-P4.3** from `WAVE-PLAN-01.md`. One PRD FR:
**FR-CON-10 (payment milestone reminders)**. Audit tier. Extends
R40 ContractMilestone schema.

### Tier verdict

**Tier:** `audit`. S3 (single bounded item).

### Scope

**In scope:**

1. **ContractMilestone schema additions** — `dueDate`, `reminderDaysBefore`
   (configurable per milestone), `reminderSentAt`, `paidAt`. R40
   established the schema; this round adds payment-tracking fields.
2. **`sendMilestoneReminders()` action** — per AC-CON-10-1: scans
   for unpaid milestones where `(now + reminderDaysBefore) >= dueDate
   AND reminderSentAt IS NULL`; sends client email with milestone
   description, amount due, builder payment instructions. Sets
   `reminderSentAt` post-send (idempotency).
3. **`markMilestonePaidAction(milestoneId)`** — per AC-CON-10-2:
   builder marks Paid; sets `paidAt`; no further reminders for
   that milestone.

### Acceptance criteria

- **AC-R62-01:** Schema migrated; new fields available.
- **AC-R62-02:** Reminder fires for due milestones. Test: create
  milestone with dueDate +5 days, reminderDaysBefore=7; invoke
  sendMilestoneReminders; assert email sent + reminderSentAt set.
- **AC-R62-03:** Reminder does not fire for paid milestones. Test:
  mark milestone Paid; invoke reminders; assert no email.
- **AC-R62-04:** Idempotency. Test: invoke reminders twice; assert
  only one email per milestone.
- **AC-R62-05:** `markMilestonePaidAction` sets paidAt. Test
  asserts field set + status surfaces as Completed.
- **AC-R62-06:** Email content: subject identifies milestone +
  amount; body has payment instructions from firm settings.
- **AC-R62-07:** Audit events `milestone.reminder_sent`,
  `milestone.paid` emitted gated on result.ok.
- **AC-R62-08:** All 5 binding commands. test:e2e actually run.
- **AC-R62-09:** SHA-A invariant.

### Anti-scope

- No payment processing integration (Stripe, Plaid, etc.).
- No automated client-side payment portal beyond status link
  (WU-P4.2).
- No partial-payment tracking.

### Reinforcements

- **Anti-self-confirming:** idempotency mutate-checked.
- **AC-literal-pass:** email subject/body literals.

### Cluster context (Wave 6b)

Parallel with wu-p3-5, wu-p3-7, wu-p4-1, wu-p4-2. wu-p4-2's
status-link reads this cluster's `paidAt` field — same-wave
parallel is fine; wave-gate validates joint state.
