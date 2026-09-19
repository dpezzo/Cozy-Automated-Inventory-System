# End-User Test Guide — CozyWinters Olliix Inventory Reconciliation MVP (Claude submission)

This guide is written for the person operating and evaluating the application —
not its developer. It assumes you understand the CozyWinters/Olliix inventory
process (from `CozyWinters_Vendor_Inventory_Automation_Plan.md` and
`Olliix_MVP_Rule_Contract.md`) but not this codebase.

Throughout this guide: **STOP** marks a condition where you should not
continue until it's resolved, because continuing risks an unsafe or
misleading result.

**The required evaluator path in this guide uses Node.js only — no Docker
Desktop, no PostgreSQL, no other external service.** Persistence is an
embedded SQLite database file; an inability to run Docker is not a blocker
and does not affect eligibility. An optional, production-like Docker
Compose + PostgreSQL path exists under `scripts/docker-optional/` for anyone
who wants it, but it is not required and is not covered step-by-step here —
see `scripts/docker-optional/README.md` if you choose to use it.

---

## 1. Prerequisites and supported environment

- Windows 11, 64-bit, standard laptop/desktop hardware.
- **Node.js 24 LTS** (or newer) — the only required external runtime. No
  Docker Desktop, no PostgreSQL, no database server to install or configure.
- No external cloud account, no Miva credentials, no internet access
  required once Node.js is installed.
- A few hundred MB of free disk space for `node_modules` and build output,
  plus space for uploaded files (a full-size Olliix workbook and Miva export
  are a few MB each).
- The extracted submission folder (this `app/` directory) can live anywhere,
  including a path with spaces (e.g. `C:\Users\Darren\Desktop\Olliix\...`) —
  every script in this submission was written and tested to tolerate spaces
  in the path.

**STOP** if you are on macOS or Linux — this guide assumes native Windows
PowerShell. (The application itself is cross-platform Node.js/TypeScript,
but this guide's exact commands and scripts target Windows 11.)

## 2. Installing Node.js and starting the app

1. Install **Node.js 24 LTS** from https://nodejs.org/ (choose the LTS
   installer for Windows, 64-bit). No virtualization, Hyper-V, or WSL needs
   to be enabled for this path — those are only relevant if you separately
   choose the optional Docker path.
2. Open **Windows PowerShell** (or PowerShell 7) and change to the extracted
   `app` folder, e.g.:
   ```powershell
   cd "C:\Users\Darren\Desktop\Olliix\...\app"
   ```
3. Copy the example environment file and edit it:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   At minimum, change `ADMIN_PASSWORD` and `SESSION_SECRET` to your own local
   values (see section 3). Leave `PORT`, `DB_DRIVER`, and other defaults
   unless port 3000 is already in use on your machine (section 17 explains
   how to change it).
4. Run setup, then start:
   ```powershell
   scripts\setup-windows.ps1
   scripts\start-windows.ps1
   ```
   `setup-windows.ps1` verifies your Node.js version, installs locked
   dependencies (`npm ci`), builds the application, creates the private
   `data\` and `data\files` directories, initializes the SQLite database at
   `data\app.db`, and seeds the administrator account. `start-windows.ps1`
   starts the application in the background, waits for it to report
   healthy, and prints the local URL.

**Expected result:** `start-windows.ps1` prints `The application is running
at http://localhost:3000` (or your configured `PORT`). Open that URL in a
browser.

**STOP** if either script exits with a nonzero code and a red `ERROR:` line —
see section 17 (Troubleshooting) before continuing.

## 3. Supplying local secrets safely

`.env` holds `ADMIN_PASSWORD` and `SESSION_SECRET`. Both are placeholders in
`.env.example`. **Never commit your real `.env` file** — it is already listed
in `.gitignore`. These are local-only development credentials; they are
never sent anywhere outside your machine, and the app never asks for or
stores Miva credentials (Phase 1 does not call the Miva API).

## 4. Signing in and confirming a development/test environment

1. Open `http://localhost:<PORT>`. You will land on a sign-in page.
2. Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env`.
3. There is exactly one account (the pre-authorized administrator/operator).
   There is no public registration and no role editor, confirming this is a
   single-operator local/test deployment, not a shared production system.
4. All application data lives in one file you control:
   `data\app.db` (SQLite), plus uploaded/generated files under
   `data\files`. Both are local to your machine and never shared with a
   production Miva store.

## 5. Running the synthetic fixture suite

This runs the shared 28-case synthetic bake-off suite plus unit tests for the
rule engine, natively via Node.js (no Docker, no database required — these
tests are pure/in-memory):

```powershell
scripts\test-windows.ps1
```

**Expected result:** output ending in `Test Files  1 passed` (twice — shared
and server packages) totalling 31 passing tests, and the script prints `All
tests passed` with exit code 0. This includes:

- Reproducing `expected_reconciliation.csv` field-for-field for all 28 cases.
- Reproducing `expected_exceptions.csv`, `expected_update.csv`,
  `expected_rollback.csv`, `expected_legacy_comparison.csv`, and
  `expected_post_import_verification.csv` exactly.

You can run this while the application is already started (section 2) — the
tests don't touch the running server or its database.

**STOP** if any test fails — do not proceed to full-size reconciliation or a
real import; the rule engine is the safety-critical core of this application.

## 6. Uploading the full-size Olliix and Miva inputs

1. On the **Home** page, use "Upload Olliix workbook (.xlsx)" and select
   `Olliix_daily_inventory.xlsx` from the bake-off seed package.
2. Use "Upload Miva catalog snapshot (.csv)" and select
   `Miva_complete_product_export.csv`.
3. Optionally upload `Olliix_Audit_Master.csv` under "Upload legacy
   Olliix_Audit_Master CSV" — needed later for legacy comparison.

**Expected result:** each upload shows "Uploaded: `<filename>` (`<N>` rows)".
If you upload the exact same file twice, you will instead see a duplicate-file
warning naming the earlier upload time; click "Confirm duplicate upload" only
if you intend to store it again (e.g. testing).

**STOP** if an upload is rejected with `REQUIRED_COLUMNS_MISSING`,
`SHEET_NOT_FOUND`, or `ZERO_DATA_ROWS` — the file itself needs correcting
before this application can safely process it.

## 7. Starting reconciliation and interpreting results

1. Under "Start reconciliation," select the uploaded Olliix workbook and Miva
   snapshot, then click **Start reconciliation**.
2. You will be taken to the Run Review page. The header shows the run's
   pinned rule ID and configuration hash, run date, and status
   (`validating` → `normalizing` → `matching` → `calculating` → `ready`, or
   `failed` with a reason).
3. The Summary panel shows total rows, changed count, and counts by review
   class (Clean / Warning / Blocked / Unchanged) and decision status.
4. The table below is filterable by review class, decision status, "changed
   only", and a text search across item number / UPC / product code.

**Expected result on the full-size acceptance set** (as run during
development against the private full-size files — your exact counts should
match, since the rule engine is deterministic): 6,632 total reconciliation
rows, 205 `MATCHED`, 88 `BLOCKED DUPLICATE VENDOR KEY`, 338
`MISSING - REVIEW REQUIRED`, 6,001 `UNMATCHED - BRAND ELIGIBILITY UNKNOWN`;
7 `CLEAN`, 198 `UNCHANGED`, 6,427 `BLOCKED`, 0 `WARNING`. Completed in under
one second, well inside the one-minute target for ~6,300 rows.

**STOP** if the run status becomes `failed` — the failure reason is shown on
the page and describes exactly what blocked processing (see section 17).

## 8. Approving, rejecting, and leaving rows pending

- **Approve all clean**: approves every eligible, changed, `CLEAN` row in one
  click. It never touches `WARNING`, `BLOCKED`, or `UNCHANGED` rows.
- **Selective clean approval**: check the boxes next to individual `CLEAN`
  rows, then "Approve selected clean rows" or "Reject selected."
- **Warning acknowledgement**: a `WARNING` row shows an "Acknowledge &
  approve" button — there is no bulk path for warnings by design; you must
  open each one and consciously approve it.
- **Rejection / pending**: any unlocked row can be rejected; a rejected or
  pending row can be reset to Pending later (before batch generation) and
  reconsidered.
- `BLOCKED` and `UNCHANGED` rows show no approve controls at all — the
  server also rejects any attempt to approve them (HTTP 403), so this is not
  merely a UI restriction. This was verified directly against the running
  application: attempting to approve a blocked row via the API returns
  `403 FORBIDDEN — A blocked row can never be approved.`

**Expected result:** after "Approve all clean," the Approved count in the
summary increases by exactly the number of clean+changed+eligible rows; warned
and blocked counts are unaffected.

## 9. Generating and locating update, rollback, exception, and reconciliation files

1. Click **Generate batch** on the Run Review page. This is only enabled
   while the run is `ready`; it fails with a clear message if there are no
   approved, changed, unlocked rows yet.
2. You are taken to the Batch Detail page, listing four downloadable files:
   - **Update CSV** — only approved, changed products, complete calculated
     managed state per row (import this into Miva).
   - **Rollback CSV** — the same products' complete pre-run values (for
     recovery).
   - **Exception CSV** — every warning and blocked row in the run.
   - **Full reconciliation CSV** — every row, current vs. proposed values,
     review class, warnings/blockers, and decision state.
3. Files are stored privately under `data\files\` and downloaded through
   `/api/files/:id/download`, which requires you to be signed in — there is
   no public/static URL for any uploaded or generated file. This was
   verified directly: an unauthenticated request to a real download URL
   returns `401 AUTHENTICATION_REQUIRED`, not the file.

**Expected result:** generating a batch freezes (locks) the decisions for the
rows it includes — you can confirm this by returning to Run Review: those
rows' Actions column no longer shows approve/reject buttons and their
decision pill shows "(frozen)". Attempting to change a frozen row's decision
returns `403 FORBIDDEN`. Pending/rejected rows remain open and can form a
later batch from the same run.

## 10. Checking the immutable batch contents before any import

Before importing anything into Miva, download and open the Update CSV and
Rollback CSV in a spreadsheet application. Confirm:

- Every row's `PRODUCT_CODE` is one you recognize and expected to change.
- The proposed values match what you saw approved on the Run Review page.
- The Rollback CSV has the exact same set of `PRODUCT_CODE` values as the
  Update CSV, with the pre-run values you'd want restored if the import goes
  wrong.

**STOP** if anything in the Update CSV looks unexpected — do not import it.
Because batches are immutable and decisions are frozen at generation time,
you cannot edit this file's intent after the fact; you would need to reject
the affected rows in a fresh run and generate a corrected batch.

## 11. Manually importing into the Miva development store

Phase 1 never writes to Miva itself. You import manually:

1. In the Miva **development store only** (never production), use your
   store's product import feature with the Update CSV.
2. This submission ships the CSV contract from `MVP_CSV_Contracts.md`
   (`PRODUCT_CODE`, `*CUSTOM_SIMPLE_INVENTORY`, `*DF-AVAILABILITY`,
   `*ORD-INV_RESTOCK_DATE_DF-MERG-IN:`, `*DF-DATAFEED`, `*DF-SHOPPING_FEED`,
   `SHOW_IN_DARREN_INVENTORY_REPORT_(1)`) as **provisional** headers — per
   the contract, these are not certified production-safe until the
   three-product development-store activation test in
   `MVP_CSV_Contracts.md` section 8 has actually been run and its exact
   import definition (encoding, delimiter, blank-clearing representation)
   recorded. **This activation test was not performed as part of this
   bake-off submission** — do it in the development store before relying on
   this for a real import, and record the results back into
   `MVP_CSV_Contracts.md` per its own instructions.
3. Save whatever import log or report Miva produces — you will want it if
   verification (`13`) surfaces a mismatch.

**STOP** and use the Rollback CSV (section 14) if the import reports errors
partway through, or if anything looks wrong immediately after import.

## 12. Exporting the post-import Miva CSV and running verification

1. In the Miva development store, export a fresh full catalog CSV using the
   same export definition as your original pre-import snapshot.
2. On the Home page, upload it under "Upload a post-import Miva export."
3. Open the batch (Run History → Batches → your batch, or the link from Run
   Review), select that file under "Post-import verification," and click
   **Run verification**.

## 13. Interpreting verification results

Each approved product shows `PASS` or `FAIL` with a reason code:

- `PASS` / `EXPECTED_APPROVED_VALUES_PRESENT` — every managed field matches
  the approved calculated value.
- `FAIL` / `FAILED_TO_CLEAR_RESTOCK` — a deliberate blank (e.g. clearing a
  stale restock message) did not take effect in Miva.
- `FAIL` / `APPROVED_VALUE_MISMATCH` — some other approved field didn't land
  as expected.
- `FAIL` / `PRODUCT_NOT_FOUND_POST_IMPORT` — the product is missing from the
  post-import export entirely.
- `FAIL` / `UNAPPROVED_PRODUCT_CHANGED` — a product **outside** the approved
  batch changed anyway; this means something unrelated to your import moved
  the catalog, or the import affected more than intended.

The batch's import status becomes `VERIFIED` only when every result is
`PASS`; a single `FAIL` sets it to `VERIFICATION_FAILED`, and it stays that
way until you generate and successfully verify a corrective batch — the
verification step itself never edits data or approvals.

**STOP** and investigate before telling anyone the import succeeded if you
see any `FAIL` row.

## 14. Recording an import failure and using the rollback file

1. On the Batch Detail page, click "Mark IMPORT_FAILED" (or
   "Mark IMPORT_REPORTED" / "Mark DOWNLOADED" for the non-failure states) to
   record what happened. This is an audit-trail action, not a technical
   safeguard — the CSVs themselves are unaffected either way.
2. To recover, manually import the **Rollback CSV** into the same
   development store. It restores the exact pre-run values for the same
   product set as the Update CSV.
3. Rollback is a manual recovery action in Phase 1 (per
   `CozyWinters_Vendor_Inventory_Automation_Plan.md` section 7) — the
   application does not automatically detect or apply it.

## 15. Rerunning or reopening a run without changing frozen batches

- Rows already included in a generated batch are locked and cannot be
  re-decided from that run — this is enforced server-side (HTTP 403), not
  just hidden in the UI.
- Rows left `PENDING` or `REJECTED` remain open indefinitely and can be
  approved later to form an additional batch from the *same* run.
- To reconcile again from scratch (e.g. a fresher Olliix export), start a new
  run from the Home page — it does not alter any previous run's history,
  decisions, or generated batches.

## 16. Stopping and restarting without losing state

```powershell
scripts\stop-windows.ps1     # stops the application process; keeps data\
scripts\start-windows.ps1    # starts again with all prior data intact
```

This was personally verified: after `stop-windows.ps1`, the `data\app.db`
file and every file under `data\files\` remained on disk unchanged, and
after `start-windows.ps1`, the same administrator account, run history, and
batch could still be queried exactly as before stopping.

Only `scripts\reset-windows.ps1` deletes data — it requires you to type
`RESET` to confirm and prints a prominent warning first. Do not run it if you
want to keep your runs, decisions, or generated batches.

## 17. Logs, port conflicts, and troubleshooting

**Viewing logs** (from the `app` folder):
```powershell
Get-Content data\logs\server.out.log -Tail 50   # application server output
Get-Content data\logs\server.err.log -Tail 50   # application server errors
```

**Port already in use**: `start-windows.ps1` checks this *before* starting
and reports it clearly, for example: `ERROR: port 3000 is already in use by
another process (PID 12345, node), unrelated to this application.` If you
see this, set a different `PORT` in `.env` (e.g. `PORT=3001`) and re-run
`start-windows.ps1`. (This exact scenario was hit and verified during
development on a shared machine that had unrelated software already bound
to port 3000 — the script correctly detected it, refused to proceed with a
false-positive "healthy" status, and named the actual conflicting process.)

**Node.js version too old**: every script checks this first (`node
--version`) and prints an actionable link to nodejs.org if Node.js 24+ is
not found.

**`npm ci` fails with `EBUSY` or `EPERM` on `node_modules`**: this is a
transient Windows file-lock issue, most often caused by antivirus real-time
scanning contending with npm's rapid file writes. `setup-windows.ps1`
already retries automatically (deleting `node_modules` fully and reinstalling
from a clean slate up to three times) — this was observed and fixed during
development. If it still fails after three attempts, close any other
`node.exe` processes for this project and temporarily pause antivirus
real-time scanning for the project folder, then re-run.

**Failed container start**: not applicable to this path — see
`scripts/docker-optional/README.md` if you are using the optional Docker
path instead.

**Common upload/processing issues:**

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `SHEET_NOT_FOUND` | Wrong file, or the `Item Inventory` sheet was renamed/removed | Re-export from Olliix with the standard sheet name |
| `REQUIRED_COLUMNS_MISSING` | A required column header was renamed or removed | Fix the source export; do not proceed |
| `ZERO_DATA_ROWS` | File has headers but no data rows | Re-check the export |
| Duplicate-file warning | You uploaded a file with an identical checksum before | Reuse the existing file, or confirm if this is a deliberate reprocessing |
| Run status `failed` | Shown failure reason names the exact validation error | Fix the input and start a new run |
| A row you expected to approve has no approve button | It is `BLOCKED` or `UNCHANGED` by design | Check its warning/blocker codes in the table; this is a safety gate, not a bug |
| CSV import errors in Miva | Header/format mismatch, or blank-clearing representation not yet certified | Run the development-store activation test in `MVP_CSV_Contracts.md` section 8 first |
| Verification shows unexpected `FAIL` | Import didn't fully apply, or an unrelated catalog change occurred | Compare the reason code against section 13 above |
| Signed in but immediately signed out again | Cookie not being set | Confirm `COOKIE_SECURE=false` in `.env` unless you are actually serving over HTTPS behind a reverse proxy — a "secure" cookie is silently dropped over plain `http://localhost` |

## 18. Collecting evidence for scoring

For each test you run, capture:

- A screenshot or copy of the terminal output from `scripts\test-windows.ps1`
  (shows the 31 automated tests passing).
- Screenshots of the Run Review summary counts and filtered table for both
  the synthetic run and the full-size run.
- The four generated files from at least one batch (update, rollback,
  exception, full reconciliation).
- The legacy comparison result counts (exact match / approved deviation /
  unexplained difference / not comparable).
- The post-import verification result table, if you completed a real
  development-store import.
- `data\logs\server.out.log` and `server.err.log` output if anything failed,
  for diagnosis.

---

## One-page evaluator checklist

Use this identical checklist across all three contestant builds.

1. [ ] `scripts\setup-windows.ps1` completes with no manual source edits and
       no Docker/PostgreSQL installation.
2. [ ] `scripts\start-windows.ps1` prints a working local URL; sign-in works.
3. [ ] `scripts\test-windows.ps1` passes the full automated suite (exit 0).
4. [ ] Upload the full-size Olliix workbook and Miva snapshot; reconciliation
       completes in under one minute with no partial/incomplete result shown
       as ready.
5. [ ] Summary counts and filters (Changed/Unchanged, Clean/Warning/Blocked,
       Pending/Approved/Rejected, In Stock/Sold Out, Missing, Unmatched) work.
6. [ ] Approve-all-clean only affects clean rows; a warning row requires
       individual acknowledgement; blocked/unchanged rows have no approve
       control and the server rejects attempts to approve them directly.
7. [ ] Generate a batch; confirm the four files download and the included
       rows' decisions are frozen.
8. [ ] Run legacy comparison against `Olliix_Audit_Master.csv`; confirm zero
       unexplained differences (or a documented, justified exception).
9. [ ] Run post-import verification against a sample post-import CSV;
       confirm PASS/FAIL reasons are legible without reading source code.
10. [ ] Stop and restart the stack (`stop-windows.ps1` / `start-windows.ps1`);
        confirm all data persisted in `data\app.db` and `data\files`.
11. [ ] Confirm uploaded/generated files are not reachable via any
        unauthenticated URL.
12. [ ] Review `CONTESTANT_DEBRIEF.md` for candor about gaps and limitations.
