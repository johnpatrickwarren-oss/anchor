## Round R59 scope (Wave 6b cluster wu-p3-7) — current round

R59 ships **WU-P3.7** from `WAVE-PLAN-01.md`. One PRD FR:
**FR-CLI-05 (client revision request)**. Audit tier. Extends
existing client quote view + builder notification.

### Tier verdict

**Tier:** `audit`. S3 (single bounded item). Reuses R52 quote view
+ postmark email infra.

### Scope

**In scope:**

1. **Client revision request input** — per AC-CLI-05-1: "Request a
   Revision" button on sent quote view; text field with minimum 10
   characters; submit shows confirmation "Your message was sent to
   [Builder Name]" verbatim.
2. **Builder email notification** — per AC-CLI-05-1: builder
   receives email with message content + link to quote.
3. **Communication thread display** — per AC-CLI-05-2: quote
   detail page (builder side) shows revision request with
   timestamp + client's message text.
4. **State-gating** — per AC-CLI-05-3: revision request disabled
   on Expired or Accepted quotes; message explains why.

### Acceptance criteria

- **AC-R59-01:** Revision request action accepts message ≥10
  chars; rejects shorter. Test asserts both branches.
- **AC-R59-02:** Confirmation text matches exact literal "Your
  message was sent to [Builder Name]" (AC-literal-pass).
- **AC-R59-03:** Builder email sent on submit. Test asserts
  mailbox entry; subject includes project name; body has
  message text + link.
- **AC-R59-04:** Builder quote detail shows revision thread.
  Test asserts revision message visible + timestamp.
- **AC-R59-05:** Revision request disabled on Accepted quote;
  disabled on Expired quote. Test covers both states.
- **AC-R59-06:** Audit event `quote.revision_requested` emitted
  on successful submit; failure-path-gated.
- **AC-R59-07:** All 5 binding commands. test:e2e actually run.
- **AC-R59-08:** SHA-A invariant.

### Anti-scope

- No builder reply / two-way thread (single inbound revision request only).
- No file attachments in revision messages.
- No revision-driven quote regeneration (manual builder action only).

### Reinforcements

- **AC-literal-pass:** confirmation text verbatim.
- **Anti-self-confirming:** disabled-state assertion must read
  rendered HTML's disabled attribute, not setup.

### Cluster context (Wave 6b)

Parallel with wu-p3-5, wu-p4-1, wu-p4-2, wu-p4-3. Disjoint scope:
client quote view + quote detail page + new RevisionRequest table
or column.
