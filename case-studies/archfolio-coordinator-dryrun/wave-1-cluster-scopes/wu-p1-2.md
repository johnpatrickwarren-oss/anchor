## Round R42 scope (Wave 1 cluster wu-p1-2) — current round

R42 ships **WU-P1.2** from `coordination/WAVE-PLAN-01.md`. One PRD FR:
**FR-POR-03 (photo upload & management)**. Phase-1 island. Implementer
must determine at spec-authoring time whether the image pipeline can
extend an existing pattern (sharp is already a project dep — see
package.json) or requires a new pattern; if the latter, ESCALATE for
operator decision on tier reclassification (audit → full).

### Tier verdict

**Tier:** `audit` (Implementer + Reviewer + Memorial-Updater).
Coordinator prior from WAVE-PLAN-01.md Step 6.

A-factors: most likely all FALSE — sharp is already installed (see
package.json:38), no new external dependency expected.
- A1 (new dependency): likely FALSE — sharp + Next.js Image cover the
  common path. If the spec requires a CDN integration, S3 storage,
  Cloudinary, or any new package, A1 fires and the round reclassifies
  to `full`.
- A2 (new architectural pattern): borderline. If photo storage is
  local filesystem (e.g., `/public/uploads/`), it extends existing
  patterns. If it requires object storage or a separate static-asset
  domain, that's new.

S-factors firing (audit acceptable, assuming A factors all FALSE):
- **S1 extends existing image-handling pattern.** TRUE — sharp is
  installed; assume an existing image pipeline can be extended.
  Implementer verifies at spec time.

**Verdict:** `audit` with ESCALATE-to-full as a documented halt path
if image pipeline turns out to require new infrastructure. See halt
conditions below.

### Scope

**In scope:**

1. **Photo schema** — new `Photo` model in Prisma:
   - id, projectId (FK → Project.id), title, caption,
   - tag (enum: BEFORE / AFTER / DURING / DETAIL),
   - originalFilename, storagePath, thumbnailPath,
   - widthPx, heightPx, sortOrder, isHero,
   - createdAt, uploadedByUserId.
   - Indexed: (projectId, sortOrder), (projectId, isHero) partial.
2. **Photo upload server action** — `uploadProjectPhotoAction(projectId, file, opts)`:
   - Per AC-POR-03-1: store at minimum 1200px on long edge; generate
     thumbnail (e.g., 400px max). Sharp is the resize tool.
   - Per AC-POR-03-4: reject non-image file types. Accept JPG, PNG,
     HEIC, WebP. Return error with allowed-format list.
   - Per AC-POR-03-5: reject files >25MB. Return error with size
     limit.
3. **Photo metadata edit action** — `updateProjectPhotoAction(photoId, {title, caption, tag})`.
4. **Photo reorder action** — `reorderProjectPhotosAction(projectId, orderedPhotoIds)`:
   - Per AC-POR-03-2: bulk reorder via sortOrder updates. Public
     portfolio + project detail pages reflect new order immediately.
5. **Hero photo designation** — `setProjectHeroPhotoAction(photoId)`:
   - Per AC-POR-03-3: sets `isHero = true` on the named photo, clears
     it on all other photos in the project. Portfolio grid uses hero
     as project thumbnail.
6. **Photo delete action** — `deleteProjectPhotoAction(photoId)`:
   - Removes the row + the stored files from disk.
   - If the deleted photo was hero, the next-in-sortOrder photo
     becomes hero automatically (or no hero if none remain).
7. **Admin UI for photo management** — minimal: upload button on
   project detail; photo list with drag-handle reorder, edit metadata
   inline, delete; hero-photo radio button. UI polish is light;
   primary value is the action surface.
8. **Public surfaces consume Photo records** — project detail page
   `/[firmname]/project/[id]` and portfolio grid `/[firmname]` use
   the Photo data via the new model. Layout for the gallery on
   detail page = simple stack grouped by tag (Before / After / During
   / Detail) per AC-POR-06-1 — though FR-POR-06 itself is later P2.x,
   the data shape supports it now.

**Out of scope (downstream rounds):**

- Photo CDN / cloud storage integration (would be a separate round if
  needed)
- AI-assisted photo tagging or auto-rotation
- Bulk photo upload from a folder (single-upload + multi-file are in
  scope; ZIP-extract is not)
- Photo metadata export to portfolio CSV export (FR-POR-10 — separate)
- Image optimization beyond sharp resize (e.g., AVIF conversion,
  progressive JPEG)

### Acceptance criteria

- **AC-R42-01:** Prisma schema has new `Photo` model with all listed
  fields. Migration applied; `npm run test:integration` exit 0.
- **AC-R42-02:** `uploadProjectPhotoAction` accepts JPG, PNG, HEIC,
  WebP. Three tests, each asserting a successful upload + stored file
  exists at the resolved path: one per format (JPG, PNG, WebP — HEIC
  testable but optional if test infra lacks HEIC support; skip with
  a `test.skip` and operator note if unavailable).
- **AC-R42-03:** AC-POR-03-4 (non-image rejection). Two tests:
  uploading a PDF and uploading a DOCX both return `{ok: false}` with
  error message containing the accepted-format list.
- **AC-R42-04:** AC-POR-03-5 (size limit). Test uploading a 26MB file
  returns `{ok: false}` with error message identifying the 25MB
  limit. Use a smaller threshold in test (e.g., mock the size limit
  to 1KB and upload a 2KB file) to keep test runtime down.
- **AC-R42-05:** Resize discipline (AC-POR-03-1). Upload a 4000×3000
  image; assert the stored original is at minimum 1200px on long
  edge (sharp metadata read in test); assert thumbnail is generated
  and its long edge is at most 400px (or whatever value the
  Implementer picks — document the choice in spec).
- **AC-R42-06:** Reorder (AC-POR-03-2). Upload 3 photos; reorder via
  the action; assert `findMany` returns them in the new sortOrder.
  Per the 2026-05-12 sort-assertion reinforcement, do NOT `.sort()`
  the test result before asserting — assert the actual positional
  order.
- **AC-R42-07:** Hero designation (AC-POR-03-3). Set photo B as hero
  when photo A was hero; assert only B has `isHero === true`,
  others have `false`. Assert portfolio grid for that project's
  parent firm renders B's thumbnail as the project card.
- **AC-R42-08:** Delete cascade. Delete a project; assert all
  associated Photo rows are also deleted (via Prisma onDelete
  cascade). Audit-event emission gates on `result.ok` per the
  standard discipline.
- **AC-R42-09:** All 5 binding commands exit 0 at HEAD. Lint at or
  below baseline.
- **AC-R42-10:** SHA-A attestation invariant: `git diff <SHA-A>
  HEAD -- src/ tests/ prisma/` empty.

### Halt conditions specific to this round

- **HALT (escalate to full): image pipeline requires new
  infrastructure.** If implementer determines at spec time that
  local-filesystem photo storage is insufficient (e.g., the
  deployment target doesn't have persistent file storage; or the
  PRD's NFR for portfolio page load time within 3s for 12 photos
  requires CDN), STOP. Write
  `coordination/diagnostics/DIAGNOSTIC-R42-image-infrastructure.md`
  with bounded options (A: local filesystem with note about
  scaling; B: integrate sharp + Next.js Image at /public/uploads;
  C: introduce S3 or Cloudinary — A1 fires, reclassify full).
  Set STATUS: ESCALATE.

### Anti-scope

- No CDN integration unless absolutely required (and then HALT first).
- No AI image processing.
- No advanced gallery UI (carousels, lightboxes) — those are P2.x or
  P3.x polish.
- No image format conversion beyond what sharp does at upload
  (resize, JPEG quality optimization). No AVIF, no progressive
  JPEG, no WebP-from-anything.
- No EXIF-based auto-rotation (sharp does some of this automatically;
  if it doesn't, that's not this round's problem).

### Reinforcements in scope (call-outs)

- **2026-05-10 next.config.ts empirical verification.** sharp is
  already in deps; no new config expected. If anything new is needed
  for image processing, empirically verify `next build` succeeds
  before claiming "no config change needed."
- **2026-05-10 multi-format coverage discipline.** AC-R42-02 lists
  three formats (JPG, PNG, WebP, optionally HEIC) — each must have
  its own dedicated test per the "same-for enumeration" reinforcement.
- **2026-05-12 sort-assertion discipline.** AC-R42-06 reorder test
  must NOT call `.sort()` on the result before asserting positional
  order.
- **2026-05-13 audit-emit failure-path gating.** Every new server
  action (upload, update, reorder, hero, delete) gates audit on
  `result.ok === true`.

### Cluster context (Wave 1)

Parallel with WU-P2.1, WU-P1.1, WU-P1.5. No inter-cluster
dependencies. Migration is disjoint from the other clusters' migrations
(new Photo table; others touch Contract, Project fields, PriceListItem
— none touch Photo). D5-contention (lock at generation time), not
D5-strict.
