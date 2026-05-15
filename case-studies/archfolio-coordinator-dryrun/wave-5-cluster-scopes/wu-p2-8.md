## Round R52 scope (Wave 5 cluster wu-p2-8) — current round

R52 ships **WU-P2.8** from `coordination/WAVE-PLAN-01.md`. Three PRD
FRs: **FR-CLI-01 (no-account client access)**, **FR-CLI-02 (client
quote view)**, **FR-CLI-04 (builder message on quote/contract)**.
Audit tier. Cross-surface UX polish on existing quote + contract
client views.

### Tier verdict

**Tier:** `audit`. A-factors all FALSE. S4 fires (cross-surface
polish; tactical follow-up to existing client surfaces).

### Scope

**In scope:**

1. **No-account access verification surface** — per AC-CLI-01-1.
   Confirm quote AND contract client links work without account
   creation. Test against Chrome + Safari + Firefox + Edge (or
   at least 2 in CI). Most of this already works; round adds
   explicit cross-browser e2e tests via Playwright projects (the
   existing playwright.config.ts likely runs Chromium; add
   Firefox + WebKit projects if not already present).
2. **Quote view branding + content** — per AC-CLI-02-1. Quote
   view at `/quote/[token]` renders:
   - Builder logo + contact info (header)
   - Project name + address (header)
   - Scope summary (body)
   - Line items at builder-selected detail level
   - Grand total + validity date
   - "Accept Quote" button
   Most exists from prior rounds (R10-R12). R52 audits + fills
   gaps.
3. **Itemized vs summary detail mode** — per AC-CLI-02-2. When
   quote's detail mode is "Itemized", all line items (description,
   quantity, unit, unit price, line total) visible. Internal
   notes (FR-EST-02-4) hidden unless builder opted in.
4. **Accept-quote action wire-through** — per AC-CLI-02-3. Client
   clicks Accept; quote status → Accepted; builder notification
   triggers (existing R12 path); confirmation message to client.
   Verify existing wiring; fix if broken.
5. **Builder personal message** — per AC-CLI-04. When builder
   has entered a message (new field on Quote/Contract or sent
   as part of the send-action), the message renders at the top
   of the client view in a visually distinct block (card or
   callout). When no message, no empty placeholder.

**Out of scope:**
- Mobile-specific contract layout (parallel cluster wu-p2-5).
- Email notification flows (parallel cluster wu-p2-7).
- New client account creation (anti to the entire no-account model).
- A11y deep audit.

### Acceptance criteria

- **AC-R52-01:** Cross-browser e2e for `/quote/[token]` +
  `/contract/[token]`. Playwright config exposes at least two
  browser projects (Chromium + WebKit or Chromium + Firefox).
  Single e2e test runs against both projects; both pass.
- **AC-R52-02:** Quote view at `/quote/[token]` renders all 7
  elements named in AC-CLI-02-1. Integration test asserts each
  element's presence via test-id or accessible role.
- **AC-R52-03:** Detail mode toggling — quote in Itemized mode
  shows line items; quote in Summary mode hides them. Test
  covers both states. Internal notes (`showNotesToClient: false`
  case) hidden by default.
- **AC-R52-04:** Accept-quote flow end-to-end: client clicks
  Accept; assert quote.status === 'Accepted'; assert builder
  receives notification (mailbox entry); assert confirmation
  message renders to client. e2e test covers full flow.
- **AC-R52-05:** Builder message renders in distinctive block
  when present. Integration test: send quote with message; open
  quote view; assert message text visible AND in a distinguishing
  CSS class / element (assert verbatim per AC-literal-pass).
- **AC-R52-06:** No message → no placeholder. Test: send quote
  without message; open view; assert no message-block selector
  is present in rendered HTML.
- **AC-R52-07:** All 5 binding commands exit 0 at HEAD. Lint ≤
  baseline. **Actually run test:e2e per R47 reinforcement.**
- **AC-R52-08:** SHA-A attestation invariant.

### Anti-scope

- No client account creation flows.
- No contract view mobile (wu-p2-5).
- No notification email work (wu-p2-7).
- No accessibility audit beyond minimum.

### Reinforcements in scope (call-outs)

- **AC-literal-pass umbrella.** Message-block CSS class asserted
  verbatim.
- **Anti-self-confirming (skills/13).** Cross-browser tests must
  actually run against multiple browsers — mocking would be
  self-confirming.
- **§2.x manifest.** Likely changes: playwright.config.ts (add
  browser projects), quote view component, contract view
  component, perhaps a new quote/contract optional `clientMessage`
  field on the Send actions. Inventory all.

### Cluster context (Wave 5)

Parallel with wu-p2-5 (mobile contract), wu-p2-6 (project record),
wu-p2-7 (notifications). Disjoint file scopes: this cluster touches
`src/app/quote/[token]/`, `src/app/contract/[token]/`,
`playwright.config.ts`, and possibly Quote/Contract send-action
extensions for the optional clientMessage field.
