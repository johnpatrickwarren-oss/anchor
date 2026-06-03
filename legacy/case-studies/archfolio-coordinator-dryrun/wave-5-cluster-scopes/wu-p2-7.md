## Round R51 scope (Wave 5 cluster wu-p2-7) — current round

R51 ships **WU-P2.7** from `coordination/WAVE-PLAN-01.md`. One PRD FR:
**FR-NOT-02 (client notification events — quote sent, contract sent,
change-order sent)**. Audit tier. Extends existing postmark email
infrastructure (already used for builder notifications + sign
confirmations).

### Tier verdict

**Tier:** `audit`. A-factors all FALSE. S1 fires (extends existing
postmark + email pattern from R12 quote-send + R46 contract-sign).

### Scope

**In scope:**

1. **Quote-send client notification** — per AC-NOT-02-1. When
   `sendQuoteAction` (existing from prior rounds) succeeds,
   client receives email within 5 minutes:
   - Subject identifies builder firm name + project name
   - Brief description (project type + key fields)
   - Clearly labeled link to view the quote
   Email goes via existing postmark integration. Extend the
   action OR add a hook to fire the email post-success.
2. **Contract-send client notification** — per AC-NOT-02-2.
   When `sendContractAction` (R46) succeeds, client receives email
   within 5 minutes:
   - Subject identifies builder firm name + project name
   - Builder's name in body
   - Plain-language prompt to review and sign
   - Link to contract view
3. **Change-order notification** (forward-looking) — per
   AC-NOT-02-3. When a change order is sent (FR-CON-09; not
   yet implemented but will land in P3.6), the email body
   identifies it as a change order (NOT a new contract), shows
   cost delta + description visible in the email body without
   clickthrough. For R51: stub the function
   `sendChangeOrderClientNotification(changeOrderId)` that
   throws "not yet implemented" — actual integration with
   change-order flow will land in P3.6 / R-future. R51 includes
   the function signature + test asserting the throw, so P3.6's
   round just wires in the call.

**Out of scope:**
- Email template authoring beyond minimal HTML (operator can
  improve later).
- A/B testing or transactional analytics on email opens.
- Internationalization.
- Change order schema / actions (P3.6).

### Acceptance criteria

- **AC-R51-01:** `sendQuoteAction` triggers client email post-
  success. Integration test: send a quote; assert mailbox entry
  exists addressed to client email; subject contains firm name
  + project name; body contains link to quote view.
- **AC-R51-02:** `sendContractAction` triggers client email post-
  success. Integration test: send a contract; assert mailbox
  entry exists; subject contains firm + project name; body
  contains builder name + sign-prompt language + contract link.
- **AC-R51-03:** Both emails go via existing postmark / dev
  mailbox integration. No new dependency.
- **AC-R51-04:** Audit event `client.notified` (or sub-typed
  per event) emitted only on email-send success (`result.ok`
  gating per the standard discipline).
- **AC-R51-05:** Stub `sendChangeOrderClientNotification(changeOrderId)`
  exists, throws `"not yet implemented; will land in P3.6"`.
  Unit test asserts the throw.
- **AC-R51-06:** Email-send failure does NOT block the
  underlying action's success. Test: mock postmark to fail;
  call sendQuoteAction; assert quote status still changes to
  Sent; assert no client.notified audit event emitted; assert
  builder is somehow notified of the failure (log line OR
  separate failure audit event — Implementer chooses; documents).
- **AC-R51-07:** All 5 binding commands exit 0 at HEAD. Lint ≤
  baseline. **Actually run test:e2e per R47 reinforcement.**
- **AC-R51-08:** SHA-A attestation invariant.

### Anti-scope

- No new template engine or design.
- No HTML/CSS email polish.
- No internationalization.
- No change-order integration (stub only).

### Reinforcements in scope (call-outs)

- **Audit-emit failure-path gating.** Email failure → no client.
  notified event. Critical to test.
- **Anti-self-confirming-test (skills/13).** AC-R51-01/02 mailbox
  assertions must read the actual mailbox content, not re-assert
  what the test set up. Mutation-check.
- **AC-literal-pass umbrella.** Email subject/body literals
  asserted verbatim.

### Cluster context (Wave 5)

Parallel with wu-p2-5 (mobile view), wu-p2-6 (auto-project-record),
wu-p2-8 (client polish). Disjoint file scopes: this cluster touches
`src/lib/notifications/`, `src/lib/admin/contracts.ts` (post-send
hook), `src/lib/admin/quotes.ts` (post-send hook).

R12 quote-send + R46 contract-send + R48 SLA infra on main.
