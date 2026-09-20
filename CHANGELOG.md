# Changelog

All notable changes to the CozyWinters Olliix inventory reconciliation app are documented here, newest first. This is a living document — updated as part of each significant change going forward, not just at release time.

## 2026-09-20 — Audits & Reviews page, storage cleanup + alerting, and page-wide UX pass

### Added

**Audits & Reviews page**
- New dedicated page (`/audits`) for one-time/periodic checks that don't belong in the regular reconciliation workflow. Legacy comparison (upload + run + results) moved here from the run detail page, with a run picker so it works standalone instead of requiring entry from a specific run.
- Structured for future audit types to be added alongside legacy comparison without a redesign.

**Admin: Clear Data**
- New Settings tool to permanently delete old runs and everything generated from them — reconciliation rows, decisions, batches, legacy comparisons, post-import verifications — plus the uploaded/generated files that become orphaned as a result, both the DB rows *and* the files on disk (nothing previously cleaned up files on disk at all).
- Two modes: clear everything (fresh-install reset) or clear runs created before a chosen date (periodic cleanup). A live preview shows exact counts and disk space before anything is deleted.
- Type-to-confirm safety gate (must type `DELETE`), backed by a server-side confirmation requirement as a second gate. Every clear is recorded in the audit log. Users, vendor configuration, and the audit log itself are never touched.
- Correctly handles files shared across multiple runs (via the checksum-dedupe upload flow) — a file is only deleted once nothing else still references it.

**Storage-size alert**
- Global, collapsible banner (visible on every page) warning that stored data has crossed a configurable size threshold — admins get a direct link to Clear Data; other users are told to ask an admin.
- Threshold (default 250,000 reconciliation rows or 500MB of files) is admin-configurable from the Clear Data page, with a one-click "Reset to default."

**Admin: edit users**
- Manage Users now supports editing a user's email, display name, and password in place, in addition to the existing role/active-status controls.

**Activity log**
- Admin-only browser for the `audit_log` table, which was previously written on every significant action but never surfaced anywhere in the UI. Lives on its own tab on the Audits & Reviews page (separate from Legacy comparison), with its table sized to fill the available viewport height — adapting to monitor size and to the instructions card being expanded or collapsed, same as Run History and Miva Catalog.

**Vendor onboarding: .xlsx support for "simple CSV" vendors**
- A dynamically-configured vendor (Manage Vendors → simple CSV column mapping) now accepts either a plain CSV or an `.xlsx` workbook for its inventory file — the parser detects which one it got from the file's own bytes (the zip "PK" signature), never the filename, so nothing about vendor setup changes.
- Verified end-to-end against the real upload/auto-detect pipeline with a temporary dummy vendor: a matching `.xlsx` parsed correctly (`rowCount` and detected vendor both correct) and one missing a mapped column was correctly rejected with the same `REQUIRED_COLUMNS_MISSING` message the CSV path already gives. No real vendor has needed this yet — first real use should still get a quick sanity check (row count matches the source file) the way any new vendor onboarding would.

**Page-wide UX pass**
- Every page now has a collapsible "Instructions" card explaining what the page does and how to use it — collapsed state remembered per page (per browser).
- Run History's Runs/Batches tables now scroll independently within a fixed page height instead of one long page scroll; copy expanded to explain what a run vs. a batch actually is.
- Miva Catalog: added a "Pull latest catalog" button (previously only available from Home); MPN added to the free-text search; fixed a bug where per-column filter dropdowns appeared to silently fail to open for *every* column (not just high-cardinality ones) due to the header clipping its own popover; capped filter dropdowns to 200 rendered values for near-unique columns (GTIN, MPN) to keep them responsive.
- Home: removed the redundant "Recent runs" table (already covered by Run History) and the "Advanced / one-time options" section (post-import-verification upload moved to the batch detail page, where it's actually used).

### Fixed
- Legacy comparison and post-import-verification file uploads were only reachable from Home, disconnected from where they're actually used (a specific run's audit, a specific batch's verification).

## 2026-09-19 — Miva API integration, multi-vendor support, and review UX

### Added

**Miva JSON API — read (Phase A)**
- Signed HMAC-SHA256 API client (`packages/server/src/miva/mivaApiClient.ts`) for Miva's JSON API, including the dev store's additional `.htaccess` HTTP Basic Auth layer.
- "Pull from Miva API" as an alternative to manually uploading a Miva catalog CSV export — fetches the full catalog via `ProductList_Load_Query`, confirmed against the real development store.
- New **Miva Catalog** browser page: search/filter/sort across the full catalog, with Product Type, thumbnail image, and clickable product-page columns, row virtualization for performance, and resizable/hideable columns.

**Home page redesign**
- Reorganized into a numbered Step 1/2/3 walkthrough (vendor data → Miva data → start reconciliation) instead of a stack of unrelated upload cards.
- Advanced/one-time uploads (legacy audit, post-import verification) collapsed out of the main flow.
- Drag-and-drop anywhere on a card, not just a small dropzone strip.
- Start Reconciliation now gates on an actual file being *selected*, not merely present in the system, with a clear "still needed" checklist.

**Multi-vendor support**
- Generalized the rule engine from Olliix-only to a vendor registry (`packages/shared/src/vendorRegistry.ts`): matching strategy (UPC→GTIN or SKU→MPN), in-stock threshold, and Miva-side brand scope are now one config entry per vendor.
- Added K&H Pet Products, Gobi Heat, and FieldSheer/MobileWarming as fully supported vendors, each with its own parser, verified against real vendor files.
- Per-warehouse incoming-date tracking (previously assumed for every vendor) is now optional — only Olliix has it.
- Replaced the four per-vendor upload tabs with a single upload area that **auto-detects the vendor from the file's own content** (sheet name / required columns), never the filename — removes the "wrong tab" failure mode entirely.

**Miva JSON API — write (Phase B)**
- "Push to Miva via API" on the batch detail page — pushes an approved batch's Update CSV rows directly to Miva via `Product_Update`, as an alternative to manually importing the CSV. Both outputs are generated from the same immutable approved change set.
- Post-update read-back verification — re-fetches every pushed product and confirms each managed field actually landed, never trusting a bare success response.
- Production-write confirmation gate (`MIVA_ENVIRONMENT=production` requires an explicit checkbox before anything is pushed).

**Review table improvements**
- "Highlight differences" checkbox — adds a compact "Changed fields" column and highlights cells for exactly which of the six managed fields differ (a row can show "changed" from fields like Datafeed or Report Flag even when the visible Current/Proposed status looks identical).
- Select-all checkbox in the table header for all currently visible, eligible rows.
- Renamed the identifier column from "UPC" to "UPC / SKU" to reflect that it holds a barcode for Olliix/K&H or a SKU for Gobi/FieldSheer, depending on the vendor's match strategy.

### Fixed
- `extensionFor()` was assuming a file's extension from its `FileKind` label instead of the actual uploaded filename — harmless for Olliix (`.xlsx`-only) but would have silently mislabeled a future CSV vendor's file.
- `buildCustomFieldValuesPayload()` was missing `simpleInventory` (the actual in-stock/sold-out field) from the six fields it could push to Miva.
- Miva API client's success/error check assumed every response was a plain object; multicall (`Iterations`) responses are actually a bare JSON array, one entry per call.

### Changed (schema / internal)
- Dropped the database-level `CHECK` constraint restricting `files.kind` to a hardcoded list — valid vendor kinds are now enforced by the application's `FileKind` union and vendor registry only, so adding a future vendor never requires a schema migration.
- Renamed `runs.olliix_file_id` to `runs.vendor_file_id` (and the matching API/TypeScript field) to reflect that a run references "a vendor file," not specifically an Olliix file.

## 2026-09-18 — Initial MVP (bake-off submission)

Built the Olliix/Miva inventory reconciliation MVP from scratch against the CozyWinters bake-off spec: Olliix workbook + Miva CSV upload, exact UPC-to-GTIN matching, review/approval workflow, immutable paired update/rollback CSV generation, legacy system comparison, and post-import verification. Won the three-way bake-off (Replit, Codex, Claude). Full methodology and architecture in `app/CONTESTANT_DEBRIEF.md`.
