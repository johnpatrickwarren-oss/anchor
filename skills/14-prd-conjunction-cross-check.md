# Skill: PRD-Conjunction Cross-Check

**Trigger:** Any spec being authored, reviewed, or routed where the spec's acceptance criteria are derived from a PRD (or product spec, or stakeholder requirement document). Applies at three checkpoints: spec-author grilling (§7/§8), Implementer pre-emit if T0/T1 self-spec, Reviewer cold-read.
**Application moment:** Every AC "Then" clause, every time. Not a one-time pass — repeated per AC per round.
**Owner:** Whoever authored the spec section containing the AC; whoever reviewed it cold.

## What it is

A meta-discipline that catches the entire class of "PRD-narrowing-without-disclosure" defects — cases where the spec's AC "Then" clause silently omits a conjunct, qualifier, enumerated item, or compound literal that the PRD explicitly required. The narrowing leaves a behavior unbound: production code can drift away from the dropped requirement (or never implement it) and the test suite stays green.

The class also covers the inverse case where the AC narrowing is correct (production should be reduced from PRD scope), but the narrowing is undocumented — so a future Reviewer cannot tell whether the gap is intentional anti-scope or a missed requirement.

## Why this is its own skill

Reinforcement accumulation in real projects (archfolio R39–R54) produced six distinct variant patterns of the same underlying defect class before consolidation:

1. **Compound-literal narrowing to substring** (R43) — PRD has a single quoted string `"Price last updated [date] — verify before finalizing"`; spec narrows to `contains "Price last updated"`. Production happens to be correct but tests don't pin the trailing "— verify before finalizing" — a future refactor dropping it passes silently.
2. **Narrowing-cell incomplete enumeration** (R54) — grilling table marks an AC "N (narrowing)" with one qualifier (e.g., "byte-vs-display") but the PRD sentence also has a positional qualifier ("on the document footer") that is undisclosed in both the table row AND §5 Anti-scope.
3. **T1 self-spec conjunction-level + HTTP-vs-domain mix** (R39) — compound PRD "Then" clauses (e.g., "firm name AND contact info AND placeholder") get checked at the prose level but not conjunct-level; HTTP-level PRD ACs ("GET /slug returns HTTP 200") silently narrowed to domain-call ACs without §5 disclosure.
4. **Structured per-AC table required** (R49) — a prose grilling pass ("these ACs look fine") systematically drops timing qualifiers ("within 2 minutes"), positional qualifiers ("signature block at the bottom"), and compound qualifiers. Only a per-AC table forces comparison cell-by-cell.
5. **Field-list AC: each field is a separate conjunct** (R50) — PRD AC "project containing: name, type, address, contract value, estimated start date, client display name" lists 6 fields. Cross-checking only one format literal while omitting the multi-field list misses 5 conjuncts.
6. **User-facing language assertion** (R52) — PRD requires "message explaining that the builder will be in touch with a contract"; test asserts only `getByText("Accepted")` because the production banner does literally contain "Accepted." The shorter visible token passes the substring check while the full required language is silently absent.

Each variant was its own reinforcement entry in CLAUDE.md. The methodology was playing whack-a-mole on narrowing dimensions (timing, positional, compound, field-list, user-facing) rather than catching the underlying class.

This skill names the class and provides one question that subsumes all variants:

> **"For each AC 'Then' clause: read the PRD equivalent verbatim. Is every conjunct (AND/OR-joined item), qualifier (timing, positional, structural), enumerated field, HTTP-vs-domain distinction, and compound quoted literal either (a) preserved in the AC or (b) explicitly documented as narrowed in §5 Anti-scope with rationale?"**

If NO on any dimension → the AC is a silent PRD narrowing. Either restore the dropped element to the AC, or document it as anti-scope.

## Why it works

A spec's AC table is the contract between spec author and test author. If the AC silently drops PRD elements, the test suite cannot detect drift from PRD scope:

- Production may correctly implement the dropped element today, but the test won't catch a future regression.
- Production may NEVER implement the dropped element, and no test will fail to indicate the gap.
- A Reviewer can't tell from the AC table alone whether a gap is intentional anti-scope or oversight.

The structured per-AC table format (Required: one row per AC × four columns) forces word-by-word comparison. Cell content can't be hand-waved past — every conjunct must be itemized.

## How to apply

For each AC "Then" clause in a spec being authored or reviewed, fill a row in this 4-column table:

| AC ID | PRD Then-clause (verbatim) | Spec AC Then-clause (verbatim) | Every conjunct/qualifier preserved? (Y/N — if N, list each dropped item AND where documented) |
|---|---|---|---|

### How to read the PRD "Then" clause

1. **Quote it verbatim**, including punctuation. The quoting itself disambiguates: a quote forces you to read the entire sentence; a paraphrase invites unconscious abbreviation.
2. **Tokenize into conjuncts.** Split on AND, OR, commas in a list, em-dashes that join compound phrases. For "project containing: name, type, address, contract value, estimated start date, client display name" → 6 conjuncts. For "renders within 2 minutes on the document footer" → 2 qualifiers (timing + positional) over a base behavior.
3. **Flag every compound quoted literal as one indivisible string.** "Price last updated [date] — verify before finalizing" is ONE conjunct that the AC must assert verbatim (or substring of it, with the dropped tail documented).

### Five high-signal red flags

These are syntactic patterns that strongly correlate with PRD-narrowing-without-disclosure. They don't replace the per-AC table but catch most cases mechanically:

1. **Spec AC uses `contains` or `toContain` where PRD has a quoted literal.** Substring matching does not verify the full literal. If PRD says `"Sent on [date]"` and the AC asserts `contains "Sent"`, mutating the `" on [date]"` suffix passes the test. Either assert the full literal OR document the substring narrowing in §5.
2. **PRD has 3+ field names in a list; spec AC asserts on only 1–2 of them.** Each field is a separate conjunct. Either bind each field with its own assertion, or list the unbound fields explicitly in §5 anti-scope.
3. **PRD specifies HTTP layer ("GET /x returns HTTP 200 + body 'Y'"); spec AC asserts on domain function output.** Domain-function tests don't verify the HTTP route. Either add an HTTP-level test, or document the narrowing.
4. **PRD has a positional, temporal, or structural qualifier ("on the footer", "within 2 minutes", "inside the unit-price label"); spec AC ignores it.** These qualifiers are testable claims. Either bind them or document anti-scope.
5. **Grilling table cell says "N (narrowing)" with only ONE narrowing listed.** Re-read the PRD verbatim; check whether multiple qualifiers/conjuncts were dropped. The first one is the most obvious; the second is the one that ships silently.

### Anti-pattern to avoid

A prose grilling section that reads "all ACs were cross-checked against the PRD — no narrowings detected" is structurally incapable of catching this class. The per-AC table is mandatory; prose review is insufficient. This was the failure mode in archfolio R39 (10-pass prose grilling missed 2 documented narrowings) and R49 (3 documented narrowings caught only by a Reviewer reading PRD verbatim).

## When this skill fires

- **Architect, writing a spec from a PRD:** every AC row of the spec is a candidate.
- **T0/T1 self-spec author (Implementer):** same — but with extra rigor because the author is also the implementer and may unconsciously narrow to what they already plan to build.
- **Reviewer, cold-read:** every AC the Reviewer reads should be cross-checked against PRD verbatim, not against the spec's paraphrase.
- **Memorial Updater:** when a Reviewer surfaces a PRD-narrowing finding, add a CONFIRMATION ("cross-check caught X") or VIOLATION ("cross-check missed X — reason: prose-only review"). Reinforcements about specific narrowing dimensions go into project-local CLAUDE.md, NOT into this canonical skill — the skill subsumes all variants by definition.

## Companion skills

- **Skill 01 — Pre-emit Grilling.** PRD-conjunction-cross-check is one row of the pre-emit grilling table; the canonical pre-emit pass includes other dimensions (correctness, anti-scope, manifest, etc.).
- **Skill 13 — Anti-Self-Confirming Tests.** The mutation question and this skill's verbatim-cross-check are complementary: anti-self-confirming asks "does the test depend on production behavior at all"; PRD-conjunction asks "does the test depend on the PRD's full behavior or only a subset."
- **Skill 06 — Anti-Scope Ledger.** Anything dropped from PRD scope must land in the anti-scope ledger with rationale. Empty anti-scope while AC text narrows PRD = audit-trail gap.
