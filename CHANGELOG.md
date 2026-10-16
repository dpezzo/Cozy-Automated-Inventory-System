# Changelog

All notable changes to the CozyWinters Olliix inventory reconciliation app are documented here, newest first. This is a living document — updated as part of each significant change going forward, not just at release time.

## 2026-10-16 — App-wide Live/Development banner

### Added
- A persistent, impossible-to-miss banner now appears at the top of every page's main content, naming which Miva site (Development or Live) every action on that page actually hits -- bright red "⚠ LIVE STORE" or slate "Development Store", with an icon and plain-language explanation. New `packages/web/src/components/ActiveSiteBanner.tsx`, mounted in `Shell` (`App.tsx`) above all page content, reusing the `activeSite` state `Shell` already tracked. Added after a real incident: the only prior indicator was a small pill at the bottom of the sidebar, easy to miss -- someone ran a catalog pull, saw a drastically different record count than expected, and didn't realize until after the fact they were looking at the other site.
- Uses fixed hex colors (`#dc2626` live / `#334155` dev), not the app's theme-adaptive `--red`/`--charcoal` tokens -- `--charcoal` flips to a *light* gray in dark mode, which would have made the Development banner's white text nearly unreadable (caught via a dark-mode screenshot check before shipping). Same color pairing as the batch-push email's own site banner, so the visual language for "which site" stays consistent between the email and the app, in both themes.

## 2026-10-16 — Email report: prominent Live/Dev banner, distinct CTA colors, per-section filter links

### Changed
- Batch push/rollback email now makes which Miva site it hit impossible to miss: a full-width colored banner (`#dc2626` bright red "⚠ LIVE STORE" / `#334155` slate "DEVELOPMENT STORE") sits right under the header, independent of the success/failure header color, and the subject line gets a leading "🔴 LIVE --" shout-prefix (instead of a trailing, easily-truncated "(Live)") so it survives inbox list truncation. `packages/server/src/mail/batchReportTemplate.ts`.
- "View Run" and "View Batch" buttons now use two visually distinct colors (charcoal `#333333` / brand red `#9d1c20`), matching the app's own existing two-sequential-action button convention (Run Review's "Approve all clean" vs "Generate batch").
- Each Clean/Updated/Warning/Skipped section now has a small "View these rows →" link that deep-links into Run Review pre-filtered to roughly that set: Clean/Warning map directly to `reviewClass`; Updated maps to `decisionStatus=APPROVED` (exactly the rows a generated batch locks and pushes); Skipped maps to `decisionStatus=PENDING,REJECTED` (everything not approved, matching how `skippedCount` itself is computed). `RunReviewPage.tsx` now reads `reviewClass`/`decisionStatus` query params once on first render to seed its filter checkboxes, so these are real, working deep links, not just decoration.

## 2026-10-16 — Idle-timeout sign-out, with a warning dialog; fixed stale-session UI

### Added
- Configurable idle-timeout sign-out: after N minutes of no mouse/keyboard/scroll activity, a warning dialog appears with a live countdown (fixed 60s) and a "Stay signed in" button; if it's not clicked before the countdown ends, the user is signed out (server session destroyed via the real logout call, not just a client-side state clear). New `packages/web/src/components/IdleTimeoutGuard.tsx`, mounted once in `Shell` (`App.tsx`) so it only runs for an authenticated session. Once the warning is showing, only the explicit button resets the timer -- incidental mouse movement near the dialog can't silently dismiss it.
- New Settings > Session Timeout page (`packages/web/src/pages/SessionTimeoutPage.tsx`) lets an admin set the idle-timeout minutes (5-480) app-wide. Backed by a new `app_settings` key (`idle_timeout_minutes`, default 30) via new `GET /session-config` (any signed-in user -- every browser needs this to run its own timer) and `PUT /admin/session-config` (admin-gated) routes.
- The login page now shows a one-line reason ("signed out after a period of inactivity" / "your session expired") when it was reached via an automatic sign-out, stashed through `sessionStorage` across the redirect and cleared immediately after being read once.

### Fixed
- Root cause of the reported "app goes stale after inactivity" behavior: the frontend's `AuthContext` only ever checked login state once, on page load -- if the session cookie expired (or was destroyed) while the tab sat open, the UI kept rendering as if still signed in until a manual refresh happened to notice. `packages/web/src/api.ts`'s request helper now dispatches a `session-expired` window event on any `401 AUTHENTICATION_REQUIRED` response, which `AuthContext` listens for to clear the signed-in user immediately, letting `RequireAuth` redirect to `/login` right away instead of silently breaking mid-session.

## 2026-10-16 — Fix: email report "Skipped" count exceeding total rows; post-login redirect back to the originally requested page
## 2026-10-16 — Fix: email report "Skipped" count exceeding total rows; post-login redirect back to the originally requested page

### Fixed
- Batch push/rollback email's "Skipped" stat could report a count larger than the run's own total rows (e.g. 13,203 skipped out of 6,841 total, seen on a real test push). Root cause: `skippedCount` summed `byReviewClass.BLOCKED + byDecisionStatus.PENDING`, but those two buckets overlap -- a BLOCKED row is always PENDING, and an UNCHANGED-but-undecided row is PENDING too, so both got double-counted. `packages/server/src/mail/sendBatchReportEmail.ts` now computes it as `total - APPROVED - APPROVED_WARNING_ACK`, the only partition of `byDecisionStatus` that's guaranteed not to overlap. New regression test in `sendBatchReportEmail.test.ts` reproduces the exact real-world numbers.
- Clicking "View Run" or "View Batch" in the email, while signed out in that browser, dropped the user on the Home page after logging in instead of the page they actually clicked through to. `RequireAuth` (`packages/web/src/App.tsx`) now passes the originally-requested path through `Navigate`'s `state.from`, and `LoginPage.tsx` redirects back to it (sanitized to a same-app relative path only, never an external URL) after a successful sign-in instead of always going to `/`.

## 2026-10-15 — Miva snapshot pulls now carry their source site; dropdowns filter to the active one

### Added
- New nullable `files.source_site` column (migration `0010_files_source_site.sql`, both Postgres and SQLite) recording which Miva site (Development or Live) a `miva_snapshot` file was pulled from via the API, captured from `getMivaActiveSite()` at the moment of the pull (`pullMivaSnapshotFromApi()` in `packages/server/src/miva/mivaProducts.ts`). Null for manually-uploaded files and anything pulled before this migration -- that history is genuinely unrecoverable, not backfilled.

### Changed
- Home page's and Catalog page's Miva snapshot dropdowns now only show an API-pulled snapshot while its own site is the currently active one (manual uploads always show, since they're not attributable to either site) -- previously an API pull from Development and one from Live were visually indistinguishable and both always listed together, so switching the active site risked running a reconciliation or browsing a catalog view against the wrong store's data without any warning. Visible snapshots also show a "· Dev" / "· Live" tag in the dropdown for clarity.

## 2026-10-15 — Batch push/rollback email reports

### Added
- Automatic HTML email report sent whenever a batch push or rollback to Miva finishes -- on success, partial failure, or full failure, for either the Development or Live site. Summarizes clean/updated/warning/skipped counts and a per-warning-code breakdown (not a full row dump), plus a capped sample of any failed rows, with "View Run" and "View Batch" links back into the app. Built with Resend; new server module `packages/server/src/mail/` (`resendClient.ts`, `batchReportTemplate.ts`, `sendBatchReportEmail.ts`), hooked into `pushBatchToMiva()` (`packages/server/src/miva/mivaApiPush.ts`). A failed or unconfigured email send never affects the push's own result -- it's swallowed and logged internally.
- New Settings > Email Reports page (`packages/web/src/pages/EmailReportsPage.tsx`) lets an admin change the recipient (defaults to `dev@delutti.com`) and turn the reports on/off entirely. Backed by two new `app_settings` keys (`report_recipient_email`, `report_enabled`) via new `GET`/`PUT /admin/report-settings` routes.
- New optional env vars (`.env.example`): `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `APP_BASE_URL` (used to build the run/batch links in the email). All optional -- leaving `RESEND_API_KEY` unset keeps the app in "no email" mode exactly as before.

## 2026-10-14 — Eastern-pinned timestamps everywhere

### Changed
- Extended the Eastern-pinned "ET"-suffixed timestamp formatting (added earlier today for Catalog/Run History/Run Review) to every remaining timestamp in the app: Home page's vendor-file and Miva-snapshot selectors, Activity Log, Audits & Reviews, and Batch Detail's "Created" line. Every timestamp in the app now consistently reads in Eastern time for all viewers.

## 2026-10-14 — Eastern-pinned timestamps, MIVA_PARENT_INACTIVE warning, Run Review toolbar cleanup

### Added
- New warning `MIVA_PARENT_INACTIVE`: a matched variant whose parent product (`parentCode` lookup against the Miva catalog) is inactive now carries this warning, even when the variant itself still shows stock. Triggered by a real case (a Serta plush heated throw variant) where every other variant of the family was NLA/discontinued and Cale decided to stop selling the whole line, even though this one variant still had stock -- previously there was no way to see that decision reflected in the review table. Computed in `reconcile.ts` via a `productCode -> MivaRawRow` lookup built once per run, checked against both the single-identifier and dual-identifier (upc-or-sku) match paths.
- Run Review's Warnings/Blockers column now renders each warning/blocker code as its own colored pill (amber for warnings, red for blockers) instead of one unreadable comma-joined string -- multi-warning rows are now scannable at a glance.

### Changed
- Catalog-pull and inventory-run timestamps (Catalog snapshot list, Miva Connection reference file, Run History, Run Review) now always render in `America/New_York` regardless of the viewer's own browser/system timezone, with a fixed " ET" suffix appended. Previously these used the browser's local timezone with no indicator of which zone was shown, so two people in different timezones viewing the exact same event (e.g. a catalog pull) would see different clock times with no label explaining why -- now everyone sees the same Eastern time for these shared business events.
- Run Review toolbar: removed "Approve all (blank tracked-flag only)" (confirmed unused, confusing) and all reject functionality (the toolbar's "Reject selected" and both per-row "Reject" buttons) -- an already-approved row can still be reverted via the existing "Reset to pending" control, which was judged sufficient. "Approve selected clean rows" is now hidden entirely (not just disabled/dimmed) until at least one row is selected. "Generate batch" switched from the same red/brand color as "Approve all clean" to the existing neutral `charcoal` button style, so the two steps of the review workflow (approve, then batch) are visually distinguishable instead of looking identical.

## 2026-10-13 — Delutti favicon

### Added
- App favicon (browser tab icon), from the Delutti brand favicon set (`favicon.ico`, `favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`) -- previously none was set. Files live in `packages/web/public/` (Vite's static-assets convention) and are linked from `index.html`.

## 2026-10-13 — Fix: Catalog stock-level/tracking columns blank on API pull; new Track inventory column

### Fixed
- "Pull latest catalog" populated the Stock level column with the Miva API, but every row came back blank even on products confirmed to have stock in Miva. Root cause: `product_inventory` is an on-demand column in Miva's JSON API (confirmed against the official docs), so it must be explicitly requested in `ProductList_Load_Query`'s `Filter` the same way `CustomField_Values:*` already is -- without it, Miva silently omits the field from every record rather than erroring. `mivaProducts.ts` now requests `["CustomField_Values:*", "product_inventory"]`.

### Added
- New "Track inventory" Catalog column: Miva's `product_inventory_active` flag (whether inventory tracking is turned on for this product), returned by the same `product_inventory` on-demand column fixed above. Informational only, like Stock level -- not used by matching/the rule engine, not pushed back to Miva. The manual-CSV-upload header (`TRACK_INVENTORY`) is an unconfirmed placeholder, same caveat as `ACTIVE`/`PARENT_CODE`.

## 2026-10-13 — Fix: sidebar LIVE/Dev badge not refreshing on same-page site switch

### Fixed
- Sidebar's "LIVE Miva store"/"Dev Miva store" badge only refetched on route navigation (`App.tsx`), so switching the active site on the Miva Connection page -- without navigating away -- left it showing the stale value until the admin left the page or hard-refreshed the browser. `MivaConnectionPage.tsx`'s `SiteSwitcher` now broadcasts a `miva-active-site-changed` window event right after a successful save, which the sidebar also listens for, so the badge updates immediately.

## 2026-10-13 — Catalog: CURRENT_STOCK_LEVEL column

### Added
- New "Stock level" column on the Catalog page, sourced from Miva's native `CURRENT_STOCK_LEVEL` field (on-hand stock quantity). Informational only -- not used by matching or the rule engine, and not pushed back to Miva (read-only, like Active/Product type/URL/thumbnail).
- Wired through the manual-CSV-upload path (`MIVA_HEADER_MAP` in `mivaCsv.ts`) end to end. The "Pull latest catalog" API path (`mivaProducts.ts`) also populates it, but the Miva JSON API field name (`product_inventory`) is an unconfirmed guess pending verification against a real `ProductList_Load_Query` response -- same caveat already flagged on the `active` field.

## 2026-10-13 — New safety net: MIVA_MARKED_DISCONTINUED

### Added
- Third warning alongside `MIVA_NOT_DROPSHIP_TRACKED` and `MIVA_CURRENTLY_NLA`: a genuine match now also forces `WARNING` when Miva's *status* field (`simpleInventory`) already says "NO LONGER AVAILABLE" -- independent of the tracked-flag field, since a product can be properly tracked (`"1"`) and still have this status set separately (by hand, or mid-transition). Previously such a row resolved `CLEAN` -- eligible for "Approve all clean" -- with no indication Miva already showed it discontinued. Found by Darren asking whether a specific example (a blank-tracked-flag product he'd seen reactivated) was the only scenario this app catches; it wasn't.

## 2026-10-13 — Run Review: "Show all Miva products" browsing toggle

### Added
- New Run Review checkbox, "Show all Miva products": fills in every brand-eligible Miva product this run's reconciliation has nothing to say about -- not matched, not already flagged "Missing" -- almost always because its tracked flag is blank. Previously completely invisible (deliberately excluded from the real "missing from vendor" scan to avoid flooding it before the tracked-flag backfill). New matchOutcome `IN MIVA - NOT TRACKED` ("Not tracked" in the UI), shown with the same full current-value detail as any other row.
- Computed on demand (`listUntrackedBrandRows` in `runService.ts`), never persisted to `reconciliation_rows` -- purely a browsing aid. These rows are always `UNCHANGED` and never eligible for approval, so there's no path for one to end up in a batch. Deliberately kept separate from the still-open question of whether this population should ever become real, actionable "missing" rows -- that's parked pending a live walkthrough, not decided by this toggle.
- Verified against real production data that every brand-eligible Miva product is accounted for exactly once across Matched / Missing / Not tracked / already-referenced-by-a-duplicate-blocked-row, reconciling exactly to the existing "Miva catalog (this brand)" summary count.

## 2026-10-13 — New vendor match strategy: UPC + SKU together ("upc-or-sku")

### Added

**Dual-identifier matching**
- New `matchStrategy` option, "Both (UPC + SKU)", alongside the existing UPC-to-GTIN and SKU-to-MPN. Checks a vendor row's UPC-to-GTIN and SKU-to-MPN independently rather than picking one identifier pair for the whole vendor: whichever one resolves to a confident, unique, brand-eligible Miva product is used (so a blank or stale value in either column doesn't lose the row); if both resolve and agree, nothing changes; if both resolve to two *different* products, the row is hard-blocked with a new `IDENTIFIER_MISMATCH` code rather than silently trusting either one. A uniquely-resolving identifier can also disambiguate the *other* identifier when it's ambiguous (e.g. a UPC duplicated across two Miva products) -- if only one of the ambiguous candidates also matches the SKU, that one wins instead of staying blocked.
- Vendor-file-side duplicate detection and the "missing from vendor" scan both now consider both identifiers independently for a "both"-strategy vendor: a row can be blocked for a duplicated SKU even with a unique UPC (or vice versa), and a Miva product only counts as missing from the vendor's file once neither its GTIN nor its MPN appears anywhere in it.
- Implemented as a fully separate code path (`reconcileDual` in `reconcile.ts`) rather than a refactor of the existing single-identifier matching, which is exercised byte-for-byte by the frozen bake-off fixture bundle -- zero behavior change for any vendor still on a single-identifier strategy.
- Olliix's parser now also populates `skuRaw` from its "Item No" column (confirmed to correspond to Miva's MPN field) -- previously display-only, needed for this vendor to actually use the new strategy. Verified against a real production Olliix file + Miva snapshot locally: identical match/missing/duplicate counts to the existing UPC-only strategy, zero identifier mismatches found.
- Manage Vendors: a vendor configured via the generic CSV/XLSX form can now specify a second identifier column when "Both" is selected.

## 2026-10-12 — Run Review: summary stat, filter-row cleanup, source tooltips, NLA rename

### Added
- New Run Review summary tile, "Miva catalog (this brand)": total Miva rows under the vendor's brand allowlist regardless of tracked flag/active status, computed by re-reading the run's stored Miva snapshot -- a denominator independent of what the run actually matched or missed.
- Tooltips on every Review class and Decision filter checkbox (previously zero on Decision, and Review class only had one combined tooltip on the "Class" column header). Added the four Decision states (Pending/Approved/Approved (ack)/Rejected) to the in-app Glossary -- a real content gap before, not just a discoverability one.
- Tooltips on the Item No and UPC/SKU column headers explaining their source varies by row (vendor file for a Matched row, Miva's own GTIN/MPN for a "Miva only" row with no vendor counterpart).

### Changed
- Removed the standalone "Changed only" checkbox -- verified in `reconcile.ts` that it's mathematically identical to "Review class = CLEAN or WARNING" (every BLOCKED/UNCHANGED row is `changed: false`, every CLEAN/WARNING row is `changed: true`), so folding it into the Review class checkboxes (now defaulting to CLEAN+WARNING checked) loses no capability.
- Collapsed the Decision filter from 4 checkboxes to 3 (Pending/Approved/Rejected) -- "Approved" now covers both `APPROVED` and `APPROVED_WARNING_ACK` as a filter, since reviewing whether a row needed warning acknowledgement isn't a distinction anyone filters by day to day. The underlying statuses, and `setRowDecision`'s enforcement of them, are unchanged -- this only simplifies the filter.
- Renamed "NLA (Miva only)" to "Miva only" throughout Run Review (Outcome column, Match filter, summary tile). "NLA" was being used for two different things on the same page -- this match-outcome label, and the literal value of Miva's Dropship Inventory Management field (what `MIVA_CURRENTLY_NLA` checks) -- now it means only the latter. Also matches the wording Legacy Comparison already used for this same concept.

## 2026-10-09 — DS_INV_MGT tracked-flag safety nets, Legacy Comparison fix

### Added

**DS_INV_MGT tracked-flag safety nets**
- Root-caused the overnight matching regression (Gobi/K&H/TechNiche matching zero products): `runService.ts` was silently discarding every Miva row with a blank `DROPSHIP_INVENTORY_MANAGEMENT` field *before* matching ever ran, so a vendor's genuine match against one of those rows looked identical to "doesn't exist in Miva at all." Confirmed via a full catalog export that the Live store's tracked flag is in fact blank on almost everything except the new Acme Test Brand vendor's products -- a real data gap from the recent field rename, not a code bug.
- The blank-flag pre-filter is removed; the full Miva catalog now reaches the matching engine. Two new warning codes instead catch the cases that actually need a human's attention: `MIVA_NOT_DROPSHIP_TRACKED` (a genuine match against a blank-flagged Miva product -- forces `WARNING`, never silently `CLEAN`, so it can't be swept up by "Approve all clean") and `MIVA_CURRENTLY_NLA` (a genuine match against a product already marked discontinued in Miva -- also forced to `WARNING`, so a vendor still shipping something you'd written off can't silently reactivate it). The "missing from vendor" review-required scan still excludes blank-flagged products, so this doesn't flood Run Review with thousands of fake "missing" rows for the untracked majority of the catalog.
- New dedicated bulk action on Run Review, "Approve all (blank tracked-flag only)", for clearing the one-time backlog this surfaces -- it only sweeps rows whose *sole* warning is the blank flag; anything with a second warning mixed in (date conflicts, warehouse mismatches) still requires individual review, same as every other warning today.
- Repopulating the Live store's historical tracked-flag data was deliberately left out of the app -- it's a one-time Miva-side cleanup (native product import), not an ongoing rule worth building into the most safety-critical code in the app.

**Legacy Comparison dropdown fix**
- Root-caused "Select legacy audit" showing no options after a successful-looking upload: `AuditsReviewsPage.tsx`'s run list and legacy-file list were both fetched with no error handling at all -- any failed request left the dropdown silently empty with zero feedback. Both now surface failures through the page's existing error banner instead of failing silently.

## 2026-10-09 — Acme Test Brand and TechNiche vendors backfilled, plugin files now ship via git

### Added
- New migration (`0009_acme_test_and_techniche_vendors.sql`, both DB drivers) backfills two vendor_configs rows that previously only existed as live rows created through the Manage Vendors UI on the local dev database, so they now reach every environment including production: `acme-test` ("Acme Test Brand", a synthetic simple-CSV test vendor matching the 10 Acme Test Brand products imported into the live Miva store, UPC/Description/Quantity columns), and `techniche` (relabeled "TechNiche International (Occunomix)" -- its `plugin_filename` actually parses Occunomix's UTF-16LE/tab-delimited export, not a real TechNiche file; it's a placeholder with no matching inventory until TechNiche's real file is available).
- Vendor parser plugin files (`vendor/pluginLoader.ts`) previously had to be copied onto a server's filesystem by hand. New `vendor/seedPluginFiles.ts`, called on every boot from `migrate.ts`, copies any `.js` file checked into the new `packages/server/vendor-plugins-seed/` directory into the runtime plugins directory, skipping files that already exist there. `occunomix.js` is the first file seeded this way; Dockerfile now copies `vendor-plugins-seed/` into the runtime image. Lets a plugin ship through a normal git push + deploy instead of manual server/volume access.

## 2026-10-08 — Home page name finalized, live Miva credentials, Dev/Live indicator, selective Clear Data

### Added

**Dev/Live Miva site indicator**
- A colored pill in the sidebar (above the user email/Sign out) now always shows "Dev Miva store" (green) or "LIVE Miva store" (red), refetched on every navigation. Exists so it's never ambiguous which store pull/push actions are about to hit, especially now that real Live credentials are configured.

**Live Miva credentials wired up**
- `MIVA_STORE_URL_LIVE`/`MIVA_STORE_CODE_LIVE`/`MIVA_API_TOKEN_LIVE`/`MIVA_API_SIGNING_KEY_LIVE` populated in both Railway and local `.env`, using the `_LIVE`-suffixed credential scheme already built on 2026-10-04. Removed the now-fully-dead `MIVA_ENVIRONMENT` env var (confirmed zero remaining runtime reads) from both.

**Selective Clear Data**
- Root-caused a real gap: Clear Data only ever deleted a Miva catalog file if it had been used to start a run that got deleted -- a snapshot pulled/uploaded on the Catalog page but never used in a run was invisible to it entirely. Confirmed live against this project's own dev data (2 orphaned catalog files, ~5MB, previously unreachable by any Clear Data scope).
- Replaced the single `beforeDate` clear with a `ClearDataScope` (`runHistory` + optional `runHistoryBeforeDate`, `catalog`, `activityLog`), implemented identically in both `sqliteRepository.ts` and `postgresRepository.ts`. Run-history deletion runs first within the same transaction so the catalog category's "still referenced?" check only ever sees rows that survive the same clear -- a catalog file a kept run still points at is never deleted even when Catalog is selected.
- Activity Log is now a clearable category, but deliberately excluded from "Clear all" and requires explicitly checking it under "Choose what to clear" (with an on-page warning) -- it's the audit trail of who cleared what, including past clears, so it shouldn't be erasable by accident. The clear action itself is always re-logged as a fresh entry afterward, even when it just wiped the table being written back into.
- `ClearDataPage.tsx` redesigned: radio between "Clear all" (run history + catalog, all runs, never the log) and "Choose what to clear" (per-category checkboxes, with the before-date filter now scoped specifically to Run History instead of being a page-wide mode).

### Changed
- Resolved the temporary "Home" vs "Run Reconciliation" owner-decision switcher (live since 2026-09-23) by permanently naming the page **Inventory Update** -- chosen over "Run Reconciliation" because "reconciliation" is internal jargon a new warehouse employee won't know, and over plain "Home" because it tells a first-time user what the page actually does, consistent with the 2026-09-24 login-tagline change that already reframed the app around "updating inventory" rather than "reconciliation" for the same reason. Removed `HomeLabelContext.tsx` and the preview switcher UI/CSS now that the decision is final; sidebar nav, page heading, and icon (`RefreshCcw`) are hardcoded. The underlying "reconciliation" terminology used on Run History/Run Review and the "Start Reconciliation" action were left as-is -- out of scope for this naming decision.

## 2026-10-07 — Catalog Active/Parent Code/brand filter, Miva site-switch safety, Settings version/changelog/activity log, column reordering

### Added

**Miva Catalog: Active, Parent Code, and a default vendor-brand filter**
- Added `active` (Miva's native per-product flag, rendered as Yes/No to match Miva's own display) and `parentCode` (custom field `customfields`/`parent_code`, confirmed against the dev store) end-to-end: `MivaRawRow`/`MivaCatalogRow` types, `MIVA_HEADER_MAP` (optional physical headers), `mivaProducts.ts`'s `toPhysicalRow()`, and new `ColumnDef` entries in `CatalogPage.tsx` positioned Image → Parent Code → Product Code → Active.
- New `GET /vendors/active-brands` endpoint (not admin-gated, brand names only -- same non-sensitive precedent as `/vendors/summary`) backing a new "Vendor brands only" toggle on the Catalog page (default on, persisted), which filters the catalog to only the brands configured on currently-active vendors.
- Catalog columns can now be dragged (via the header label) into any order, persisted to `localStorage`; a "Reset column order" button in the Columns menu restores the built-in default order.

**Miva Connection: site-switch safety + reset-dev-products changes**
- `SiteSwitcher`'s radios no longer apply instantly -- selecting Development/Live now stages a pending choice that only takes effect after clicking Save and confirming via `window.confirm()` (root cause of a real incident: the active site was accidentally left on Live, which silently broke the Catalog page's "Pull latest catalog" button since only Development has credentials configured).
- "Reset dev site products" merged into the same card as the site switcher and now only renders while Development is the actual (saved) active site, instead of being a separate always-visible card with a "switch to Development" message. Its reference-file upload is now a scoped drag-anywhere dropzone (heading through the upload box) instead of only the small upload control.

**Settings: version number, changelog, and a dedicated Activity Log page**
- New `app/packages/shared/src/releaseNotes.ts` (`RELEASE_NOTES`), a short plain-language list for end users, rendered on the Settings page alongside a date-derived version number (`RELEASE_NOTES[0].date` reformatted `YYYY.MM.DD`) and the existing commit-hash "Build" line. Served via new `GET /release-notes` (not admin-gated). Backfilled with one entry per `CHANGELOG.md` date back to the 2026-09-18 initial release.
- Activity Log split out of Audits & Reviews (where it was an admin-only tab easily mistaken for the page itself) into its own page/route (`ActivityLogPage.tsx`, `/settings/activity-log`), reached via a new admin-only Settings tile. Audits & Reviews is back to being just Legacy Comparison, no tabs.
- Every Settings sub-page (Manage Users, Manage Vendors, Clear Data, Miva Connection, Activity Log) now has a consistent "Back to settings" link, placed as its own card between the instructions card and the main content.

## 2026-10-04 — Dropship Inventory Management field, tracked-only filtering, Miva site switcher, dev reset

### Added

**`DS_INV_MGT` field rename and real three-value logic**
- Renamed the Miva custom field previously tracked as `dp_inv_rpt` ("Show in Darren Inventory Report (1)") to `DS_INV_MGT` ("Dropship Inventory Management"), per the business's updated field spec: `1` = Tracking Inventory, `NLA` = No Longer Available, blank = Not tracking. Renamed the internal identifier (`reportFlag` → `dsInvMgt`) and every CSV header/label end-to-end (Miva field map, physical/legacy/batch CSV headers, UI labels on Catalog/Run Review/Audits & Reviews).
- `NLA`/blank are business-set states in Miva the app only ever reads, never writes — `computeProposedManagedValues` still always proposes `"1"` for both IN STOCK and SOLD OUT, functionally unchanged from before the rename.

**Tracked-only Miva row filtering**
- A run's Miva snapshot is now filtered to only `DS_INV_MGT`-tracked products (non-blank) before reconciliation, cutting the working set down from the full ~8,000+ SKU catalog to the ~5 vendors actually managed. The stored `miva_snapshot` file itself is untouched (full catalog, for audit/legacy tooling) — only what reaches `reconcile()` and `reconciliation_rows` is scoped. Confirmed via Miva's own docs that custom-field server-side filtering isn't available today; this is a client-side filter in `runService.ts`, not a smaller Miva API pull.

**Dev/Live Miva site switcher**
- New Settings > Miva Connection page: switches which Miva store's credentials are active (`MIVA_STORE_URL`/etc. for Development, new `_LIVE`-suffixed vars for Live, placeholders until that store exists) via a DB-backed `miva_active_site` setting (`app_settings`), not an env var.
- Unified the production-push confirmation gate (`resolveMivaPushEnvironment`) with this same setting, retiring the separate `MIVA_ENVIRONMENT` env var — previously two independently-set values that could drift out of sync (the exact bug class a prior incident already flagged); now one switch drives both which credentials are used and whether a push requires confirmation.

**Dev site product reset**
- New "Reset dev site products" action on the same Settings page: uploads a reference CSV (seeded from `Vendors/dev-miva-products-reset.csv`) and pushes it wholesale to Miva via the same `Product_Update`/verification machinery as a real batch push, restoring the dev store to a known-good baseline. Hard-gated to the Development site unconditionally — no confirmation override can make it reach Live.

## 2026-09-24 — Full UX audit pass, Run Review layout fixes, and deployment prep

### Added

**Full UI/UX audit pass** (completing the deferred findings from the prior session's focused pass)
- Import-status pills (`GENERATED`/`DOWNLOADED`/`API_PUSH_SUCCEEDED`/etc.) now have plain-language tooltips everywhere they're shown (Run History, Run Review, Batch Detail), consolidated into a shared `IMPORT_STATUS_TOOLTIPS` map (`lib/format.ts`). Batch Detail's import status is now a color-coded pill matching the other pages instead of plain text. Run-status pills (`validating`/`normalizing`/etc.) similarly tooltipped.
- Manage Vendors: inline explanations added for Match strategy, In-stock threshold, and Timezone fields (previously unexplained settings with real reconciliation-logic consequences); vendor key immutability now a bold warning instead of easy-to-miss inline text; vendor table shows humanized labels and actual brand names instead of raw enums/counts; deactivate confirmation now states the actual consequence.
- Run Review: Outcome column/cell now shows "Matched"/"NLA (Miva only)" consistently instead of a raw enum in the table body; tooltips added for the rule/config hash, the vendor exception report's purpose, the Legacy Comparison link, and the "Changed fields" column.
- Terminology unified on "snapshot" (was a mix of "snapshot"/"export" for the same Miva catalog file across pages). Duplicate-file upload warning now explains why it matters and names the dropdown to use instead.
- Clear Data's storage-alert section now says where the resulting banner appears; "Everything" option relabeled and visually flagged. Manage Users: Admin vs. Member permissions now explained. Catalog's remaining column headers tooltipped. Run History shows empty-state copy instead of a blank grid. Login page tells a new hire to ask an admin for an account.
- The two temporary owner-decision switchers' on-page copy reworded from "(tell me which one to keep)" to "(preview -- pending final decision)" since the original phrasing read like an internal note left in the shipped UI; the switchers themselves are unchanged, still pending Cale's review.

**Run Reconciliation icon + sidebar polish**
- Wired an icon (`RefreshCcw`) to the "Run Reconciliation" preview label, switching automatically with the Home/Run Reconciliation toggle, in both the sidebar nav and the page heading.
- Sidebar nav and all page-heading icons made bolder and larger; sidebar widened so "Run Reconciliation" and "Audits & Reviews" no longer wrap; brand subtitle resized to match the logo's width exactly.
- Run History and Settings page headings were missing their icon (inconsistent with every other page) — added, matching their sidebar entries.
- Dark mode toggle moved from the sidebar footer to a fixed icon button in the top-right corner of every page.
- Login page tagline reworded to lead with updating inventory ("Update your Miva store's inventory using vendor stock files") rather than reconciliation, since that's the app's actual point from a user's perspective.

### Fixed
- **Run Review page's row table stuck at a fixed 400px height regardless of screen size** — root cause: the fill-the-viewport height calculation ran once before the run/summary data finished loading (the page shows a "Loading..." fallback first, so the table wasn't in the DOM yet), then never recomputed afterward. Now recomputes whenever the run/summary/batches data changes.
- **The same fill-the-viewport technique (also used by Run History, Miva Catalog, and Activity Log) didn't react to the Instructions card being collapsed/expanded**, since that changes page layout without resizing the window or visibly resizing `document.body` (pinned to `min-height: 100vh`). `InstructionsCard` now dispatches a synthetic `resize` event on toggle, fixing this for all four pages at the source.
- Run Review's trailing "Back to run history / Legacy comparison" links were forcing an extra scroll below the now-taller table; moved above the table as a breadcrumb (matching the pattern already used on Manage Vendors/Users) so nothing sits below the auto-fitting table anymore.

### Deployment
- Restored `Dockerfile` (deleted during troubleshooting) with its one Railway-incompatible line removed -- Railway rejects the Docker `VOLUME` instruction and expects a Railway Volume configured separately in its dashboard instead. Deploy is otherwise blocked on Railway usage credits resetting.

## 2026-09-23 — CozyWinters brand restyle, dark mode, icon pass, and novice-usability UX pass

### Added

**Brand restyle + dark mode**
- Full re-theme around the CozyWinters brand (colors pixel-sampled from the actual logo files), replacing the generic blue admin-tool palette. New CSS custom-property token set (`styles.css`) covers light and dark themes, including re-tokenized status colors, surfaces, and shadows.
- Dark mode with a sidebar toggle: detects OS preference on first visit, persists an explicit user choice to `localStorage`, and applies before first paint (no flash-of-wrong-theme). Brand logo swaps to the dark variant automatically.
- Adopted `lucide-react` as a real dependency (replacing an initial hand-drawn-SVG icon set) and added icons across the whole app: sidebar nav, Settings tiles (3-across grid with icon badges), section headings, primary action buttons, non-tabular status badges, and shared components (`UploadBox`, `InstructionsCard`, `DataSizeAlert`, new `ErrorBanner`). Deliberately left dense per-row table pills and config forms icon-free.
- Zebra-striped table rows (`tbody tr:nth-child(even)`) app-wide for readability on large tables.
- Temporary owner-decision switchers (Home page name: "Home" vs "Run Reconciliation"; Catalog Data layout: Tabs vs Side-by-side) — still live pending a final call, not yet removed.

**Novice-usability pass** (informed by a full audit of every page for a first-time employee with no inventory-domain knowledge)
- Centralized friendly error messages (`lib/errors.ts`) — removed raw `CODE: message` strings shown to users in several places.
- Run Review: tooltips on the Class/Outcome columns and the "(frozen)" decision suffix explaining what they mean and why BLOCKED rows have no action buttons. Confirmation dialogs added to "Approve all clean," "Reject selected," and "Generate batch" (previously zero friction on actions affecting many rows at once).
- Batch Detail: confirmation dialog before a live Miva push (states target and destination); tooltips on the four "Mark ..." import-outcome buttons.
- Vendor/user deactivation now requires confirmation (vendor deactivation previously had none, despite being unreversible from the UI).
- Humanized raw enum values shown in the UI (Audits & Reviews' class filters/pills and Activity Log actions/entities; previously showed constants like `UNEXPLAINED_DIFFERENCE` directly). Added GTIN/MPN column tooltips on the Catalog page.
- New in-app Glossary (sidebar "?" button) defining the ten most-used domain terms in plain language; one-line orientation copy added to the Login page (previously had none); Home page instructions extended to describe the full workflow instead of stopping after "start reconciliation."
- `InstructionsCard`'s collapsed/expanded state is now remembered per user instead of per browser, so one person collapsing it on a shared machine no longer hides it from the next person who signs in there.

**Batch Detail page restructure**
- Vendor added to the top summary strip (previously showed Run/Import status/Created only, with no indication of which vendor the batch belonged to).
- "Push to Miva via API" and the CSV downloads are now tabs in one card instead of two separately stacked cards, defaulting to the API tab (the recommended path). "Import outcome" and "Post-import verification" moved under the CSV tab, since both are artifacts of the manual-import path — an API push already reports its own pushed/failed/verification-mismatch counts. "Immutable generated files" heading simplified to "Downloadable files."
- Instructions/wording pass on Home, Run History, and Batch Detail to remove phrasing that implied one action (e.g. "generate a batch," "open a batch") automatically performed a separate one (e.g. "send to Miva," "push via API").

### Fixed
- **Crash on opening any run whose summary lacked `byMatchOutcome`** (`Cannot read properties of undefined`, blanking the whole page) — root cause was a stale compiled server build that predated the `byMatchOutcome` field already present in source; fixed by rebuilding `packages/server`. Added defensive optional-chaining around the run-summary stat grid regardless, so a similar mismatch degrades to showing `0` instead of crashing.

## 2026-09-22 — Batch push status tracking, Run History/Run Review overhaul, Legacy comparison detail, and Vendor Exception Report

### Added

**Batch import status now tracks Miva API pushes automatically**
- A batch's Import Status updates itself when pushed to Miva (`API_PUSH_SUCCEEDED` / `API_PUSH_FAILED` / `API_PUSH_PARTIAL_FAILURE`) instead of requiring a manual "Mark..." click afterward. A rollback push no longer changes Import Status at all — it's tracked separately via a new "rolled back" badge, since a rollback restores prior values rather than reporting on the batch's own import.
- One-time backfill script (`backfillImportStatusFromPushHistory.ts`) to correct batches that were pushed before this shipped, using their existing Activity Log entries.

**Run History and Run Review page overhaul**
- Runs and Batches tables now cross-link both ways (a run shows its batch + batch status; a batch shows its run), with aligned, `Columns`-consistent formatting between the two tables (shared pixel widths via `table-layout: fixed`, matching pill styling for every status column).
- Sidebar's "Run History" highlight now correctly stays active on a run's detail page and a batch's detail page, regardless of which page you navigated in from.
- Run Review: added Vendor to the run info card; split the "Matched" stat into a true `matchOutcome: MATCHED` count and a separate "NLA (Miva only)" count (previously blended non-blocked rows together, which didn't line up with any real-world reference count); added a "Matched"/"NLA" filter toggle.

**Legacy Comparison "Differences" report (Audits & Reviews)**
- Full field-level review table (previously just pass/fail counts): grouped column headers + tooltips naming each value's true source (vendor file / Miva / calculated / legacy file), a per-row "Vendor + Miva" vs. "Miva only" origin badge, an expandable per-row detail panel comparing Miva's current value / our calculation / the legacy file side by side (with mismatches highlighted), and a `Columns` show/hide menu matching the Miva Catalog page's pattern.
- Traced and fixed a real data gap surfaced while building this: a vendor UPC duplicated across two rows in the vendor file was silently "spending" the Miva lookup before being blocked, making that product invisible to both the Matched and NLA counts with no record anywhere it needed review.

**Vendor Exception Report**
- New exportable report (CSV or Excel) from Run Review, for sending back to a vendor to get exceptions clarified — separate from the existing internal batch exception CSV, which mixes every blocker/warning reason (including Miva-side-only issues that aren't the vendor's problem) and only exists after a batch is generated.
- Checkbox-selectable categories (duplicate UPC/SKU, missing/invalid identifier, missing/invalid quantity, missing-from-vendor/NLA candidates, data warnings; "unmatched in Miva" available but off by default since it's usually not a vendor error). Duplicate-UPC rows list their sibling row(s) directly in a `DETAIL` column. Includes Miva's current status per row.
- Minimal, dependency-free `.xlsx` writer (`writeXlsx.ts`, built on the same `jszip` already used to *read* `.xlsx` files) — no new library needed for Excel export.

### Fixed
- `getRunSummary` now also reports `byMatchOutcome`, needed for the Matched/NLA split above (previously only `byReviewClass`/`byDecisionStatus`).

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
