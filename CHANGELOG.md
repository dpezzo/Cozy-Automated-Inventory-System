# Changelog

All notable changes to the CozyWinters Olliix inventory reconciliation app are documented here, newest first. This is a living document — updated as part of each significant change going forward, not just at release time.

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
