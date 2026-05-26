## Round R49 scope (Wave 5 cluster wu-p2-5) — current round

R49 ships **WU-P2.5** from `coordination/WAVE-PLAN-01.md`. One PRD FR:
**FR-CLI-03 (client contract view & mobile-optimized signing)**.
Audit tier. Extends R46/R48's contract view + signature capture
surfaces with mobile-first responsive behavior + accessibility.

### Tier verdict

**Tier:** `audit`. A-factors all FALSE. S1 fires (extends R46
contract view + R46 signature capture). Implementer authors thin
spec, executes, Reviewer audits cold.

### Scope

**In scope:**

1. **Mobile-responsive contract view layout** — per AC-CLI-03-1.
   `/contract/[token]` page renders contract text in scrollable
   readable format with body text ≥ 16px on mobile (375px viewport).
   Signature block at bottom; no horizontal scrolling.
2. **Typed-signature script-font rendering** — per AC-CLI-03-2.
   When client types their name in the signature field, the
   rendered preview uses a script-style font (e.g.,
   "Dancing Script", "Great Vibes", or system handwriting font
   fallback).
3. **Drawn-signature canvas** — per AC-CLI-03-3. HTML5 canvas
   accepts mouse + touch drawing input; captures signature as
   image (data URL) for submission. Touch + pointer events both
   handled.
4. **Sign-confirmation screen + email SLA** — per AC-CLI-03-4.
   After "Sign & Submit" click: immediate confirmation screen
   (no redirect to a generic success page); signed copy email
   sent to client email within 2 minutes (existing R46 + R48
   email path; verify the 2-minute SLA via test).

**Out of scope:**
- Signed PDF generation (R48 already shipped).
- Mobile UX for non-contract surfaces (FR-CLI-01 / FR-CLI-02 are
  parallel cluster wu-p2-8).
- A11y audit beyond minimum (no axe-core integration in this round).

### Acceptance criteria

- **AC-R49-01:** Contract view page renders ≥16px body text at
  375px viewport. Playwright e2e test: emulate 375px viewport,
  open contract link, identity-confirm, assert computed style
  fontSize >= 16px on contract body.
- **AC-R49-02:** No horizontal scrolling at 375px. Same e2e test:
  assert `document.documentElement.scrollWidth <=
  document.documentElement.clientWidth`.
- **AC-R49-03:** Typed signature renders in a script-style font.
  Integration test (component-level): type "John Smith" into
  signature input; assert preview element has
  `font-family` matching the script font (verify exact CSS
  literal per AC-literal-pass umbrella).
- **AC-R49-04:** Drawn signature canvas captures touch/mouse input
  and produces a data URL submittable via the existing R46
  sign action. Component test: simulate canvas drawing events;
  assert `canvas.toDataURL()` produces a non-empty image data URL.
- **AC-R49-05:** Sign-confirmation screen shows immediately on
  submit (no page reload). E2e test: sign; assert confirmation
  text appears in <2 seconds of click.
- **AC-R49-06:** Signed copy email delivered to client within 2
  minutes (existing R46 email path; integration test asserts
  mailbox entry exists for client email within tolerance).
- **AC-R49-07:** All 5 binding commands exit 0 at HEAD. Lint ≤
  baseline. **Implementer MUST actually run `pnpm run test:e2e`
  and report real output per R47 reinforcement.**
- **AC-R49-08:** SHA-A attestation invariant.

### Anti-scope

- No payment flows. No change orders.
- No additional client-facing surfaces beyond /contract/[token].
- No client account creation.
- No re-implementation of R46 sign action; reuse as-is.

### Reinforcements in scope (call-outs)

- **AC-literal-pass umbrella.** Font literals + 16px threshold
  assert verbatim.
- **Anti-self-confirming (skills/13).** Each test mutate-checked.
- **HALT umbrella.** If canvas drawing requires a new dep, HALT
  + DIAGNOSTIC + ESCALATE.

### Cluster context (Wave 5)

Parallel with wu-p2-6 (auto-project-record), wu-p2-7 (notifications),
wu-p2-8 (client polish). Zero inter-cluster dependency edges. Disjoint
file scopes: this cluster touches `src/app/contract/[token]/` only.
