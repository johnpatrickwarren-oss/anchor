## Round R63 scope (Wave 6c cluster wu-p4-4) — current round

R63 ships **WU-P4.4** from `WAVE-PLAN-01.md`. Two PRD FRs:
**FR-INT-04 (read-only REST API)** + **FR-INT-06 (QuickBooks Online
integration)**. **FULL TIER**. New external surface + OAuth.

### Tier verdict

**Tier:** `full` (Architect + Implementer + Reviewer + Memorial).
A1 fires (new external surface for REST API; OAuth integration for
QBO).

### Scope

**In scope:**

1. **Read-only REST API** — per AC-INT-04:
   - Builder generates API key in Account Settings
   - `GET /api/v1/projects` with Bearer token returns JSON array
     of project records (ID, name, type, status, contractValue,
     startDate, completionDate)
   - Invalid/expired token → 401
   - Write attempts (POST/PUT/DELETE) → 405 Method Not Allowed
2. **QuickBooks OAuth + invoice push** — per AC-INT-06:
   - OAuth connection flow to QuickBooks Online
   - On contract signed: auto-create QB invoice for first
     milestone (project name = reference; milestone amount;
     client mapped to QB customer record)
   - Auto-create QB customer if doesn't exist (using client name +
     email)
   - On sync failure: builder notified via email + dashboard alert;
     contract intact; manual retry from project record

### Halt conditions

- **HALT (A1) — QuickBooks OAuth credentials.** Architect must
  ESCALATE for operator-provided QBO app client ID + secret.
  Without these, can't build OAuth flow.
- **HALT — sandbox vs production environment.** QBO has separate
  sandbox + production OAuth endpoints; operator must choose.
- **HALT — API rate limits.** QBO has rate limits; Architect must
  document caching/retry strategy.

### Acceptance criteria (preliminary; Architect refines)

- **AC-R63-01:** API key generation + storage. Test: builder
  generates key; key hash stored (not plaintext); raw key
  returned once.
- **AC-R63-02:** GET /api/v1/projects with valid token returns
  JSON array.
- **AC-R63-03:** Invalid token → 401 with error message; no
  project data leaked.
- **AC-R63-04:** Write methods → 405 Method Not Allowed.
- **AC-R63-05:** QBO OAuth flow completes successfully (test in
  sandbox).
- **AC-R63-06:** On contract signed: QB invoice created for
  first milestone. Test mocks QBO API; asserts correct payload.
- **AC-R63-07:** QB customer created if missing. Test asserts
  customer-create call before invoice-create.
- **AC-R63-08:** Sync failure handling: timeout → email + dashboard
  alert + contract intact + manual retry available.
- **AC-R63-09:** All 5 binding commands. test:e2e actually run.
- **AC-R63-10:** SHA-A invariant.

### Anti-scope

- No write API (read-only only — POST/PUT/DELETE return 405).
- No QB sync of estimates / change orders (first milestone only).
- No Xero / FreshBooks / Wave / other accounting integrations.
- No multi-firm QB connections (one per firm).

### Reinforcements

- **HALT umbrella:** ESCALATE on operator-needed OAuth credentials.
- **§2.x manifest:** new API routes + OAuth handlers + QB SDK
  integration; inventory all.
- **Empirical-verification:** new external API — verify build
  succeeds with QB SDK imported.
- **Anti-self-confirming:** API key validation tests must check
  actual hash comparison, not setup.

### Cluster context (Wave 6c — final wave)

Single cluster, full tier. Longest-running of the project (90-120
min). After R63 lands, ArchFolio MVP is fully shipped per the
PRD's P1+P2+P3+P4 functional scope.
