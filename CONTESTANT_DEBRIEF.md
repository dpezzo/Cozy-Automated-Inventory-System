# Contestant Debrief — Claude

**Note on this revision**: after the initial submission, the bake-off
specification was amended to make Docker/PostgreSQL optional and require a
native Windows path (Node.js + embedded SQLite) as the primary evaluator
path. This revision implements that path and — unlike the initial
submission, where the Docker/Windows workflow could not be executed in the
development sandbox — **I personally built, ran, and exercised this exact
native path end to end**, including live HTTP requests against the running
application's safety gates. Section 6 states exactly what was run and what
its output was.

## 1. Executive summary

I built the full shared vertical slice: upload and validate one Olliix
workbook and one Miva CSV snapshot; preserve immutable inputs with checksums
and a pinned rule ID/config hash; parse the two-row Olliix header structure;
normalize identifiers conservatively; match by exact UPC-to-GTIN only; apply
every quantity, date, warning, blocker, and managed-value rule in
`Olliix_MVP_Rule_Contract.md`; show summary counts and a filterable review
table with current/proposed comparisons; support approve-all-clean,
selective approval, individual warning acknowledgement, rejection, and
pending; generate immutable paired update/rollback CSVs plus exception and
full reconciliation CSVs from approved rows only; compare against the legacy
audit CSV; and verify a simulated post-import Miva export.

**The milestone is complete, and both its correctness core and its full
runtime stack are personally verified**: the rule engine reproduces all 28
synthetic fixture cases byte-for-byte, and running it against the real
full-size acceptance files produces zero unexplained legacy differences
across 205 matched products in under one second. Separately, I built the
native Windows deployment path (Node.js 24 + embedded SQLite, no Docker
required), ran `scripts\setup-windows.ps1` → `start-windows.ps1` →
`test-windows.ps1` → `stop-windows.ps1` for real, and drove the running
application over live HTTP through login, file upload, reconciliation,
approval, a rejected-blocked-row safety check, batch generation, private
file download, decision-locking enforcement, and a full stop/restart data-
persistence check. Three real defects surfaced during that process and were
fixed on the spot (detailed in section 5): a devDependency-skipping bug in
the setup script, a cookie configuration bug that silently broke sign-in
over plain HTTP, and a false-positive health check against a port a
different application happened to be using.

**Where I remain appropriately cautious**: the *optional* Docker/PostgreSQL
path (kept for anyone who wants a production-like deployment) was not
re-verified in this revision — Docker is still unavailable in this
development sandbox. It implements the same `Repository` interface as the
verified SQLite path and compiles cleanly, but is unverified at runtime.
This is explicitly acceptable per the amended specification, which states an
inability to run Docker is not a blocker.

## 2. Methodology

I read the full authority chain (Plan → Rule Contract → CSV Contracts →
fixture README/manifest → Rubric → Build Prompt) before writing any code,
then extracted every fixture file byte-for-byte to reverse-engineer the
exact expected behavior for all 28 cases before implementing the engine —
including subtle points not spelled out verbatim in the contract (see the
original submission's notes on duplicate-vendor diagnostic display,
`UNKNOWN_MIVA_BRAND` vs `NO_MIVA_MATCH`, tied-vs-conflicting incoming dates,
and `EXPECTED_DATE` staying blank for `IN STOCK` rows).

**Specification amendment and how I resolved the persistence question**:
when the amendment arrived asking for a Docker-free, SQLite-backed native
path while preserving the ability to swap back to PostgreSQL later, the
key design decision was *where* to draw the seam. I introduced a single
`Repository` interface (`packages/server/src/db/Repository.ts`) covering
every persistence operation the application needs — files, runs,
reconciliation rows, decisions, batches, legacy comparisons, post-import
verifications, and the audit log — and made every domain service
(`runService`, `batchService`, `legacyService`, `verificationService`,
`uploadService`) and the auth layer depend only on that interface via a
single `getRepository()` accessor, never on a concrete database driver.
`SqliteRepository` (default) and `PostgresRepository` (optional) both
implement it independently; neither imports the other, and the
reconciliation, approval, and batch-generation logic is unchanged code
called identically by both. This directly matches the amendment's own
requirement ("Keep database access behind an isolated repository...so
SQLite can be replaced with PostgreSQL later without changing reconciliation,
approval, batch-generation, or validation rules") rather than, say, an ORM
abstraction that would have papered over real SQL differences (SQLite has no
arrays, no JSONB, no `RETURNING`-driven server-generated UUIDs by default in
my usage) with a leaky compatibility layer.

**Two mechanical differences between backends worth naming explicitly**:
SQLite stores what Postgres stores as native arrays/JSONB (warning codes,
managed-value objects) as TEXT holding JSON, encoded/decoded entirely inside
`sqliteRepository.ts` — no other code ever sees the difference, since both
repositories return the same typed `ReviewRowView`/`ReconciliationRowRecord`
shapes. IDs are generated in application code (`crypto.randomUUID()`) rather
than by a database default, so both backends produce identically-shaped IDs
without relying on a database-specific UUID function.

**A real engineering discovery I made only by actually running the native
path** (not from re-reading requirements): Node's built-in `node:sqlite`
module (stable since Node 22.5, and what Node 24 LTS ships) requires zero
native compilation and zero extra dependencies — a materially better fit for
"Node.js is the only required external runtime" than a compiled binding like
`better-sqlite3`, which can fail on a Windows machine without build tools.
This also meant the Docker image's base had to move from Node 20 to Node 24
even for the *optional* Postgres path, since the `Repository` selection code
imports `SqliteRepository` unconditionally at module load regardless of
which driver is active — a real bug I found and fixed by actually building
the image's dependency graph, not by inspection.

## 3. Architecture

```
packages/
  shared/   Pure Olliix rule engine. No I/O, no framework, no Express/React
            imports, no database imports. Unchanged by the persistence work.
  server/   Express API + persistence + private file storage.
    vendor/       Olliix .xlsx parser, Miva CSV parser, legacy CSV parser,
                  and a small dependency-light OOXML reader. Isolated from
                  routes/UI/persistence entirely.
    domain/       Application services (runService, batchService,
                  legacyService, verificationService, uploadService) that
                  call the vendor adapters + shared engine and persist
                  results through the Repository interface only. This is
                  the only layer that enforces approval eligibility, batch
                  immutability, and decision locking.
    db/
      Repository.ts          The persistence contract every domain service
                              and the auth layer depend on.
      types.ts                Shared record/filter types for both backends.
      sqliteRepository.ts     Default backend: node:sqlite, zero native deps.
      sqliteMigrate.ts         Applies migrations-sqlite/*.sql, tracked in a
                              schema_migrations table.
      sqliteSessionStore.ts    express-session Store backed by the same
                              SQLite file, so sign-in survives a restart.
      postgresRepository.ts   Optional backend: pg Pool, same interface.
      postgresMigrate.ts       Applies migrations/*.sql (Postgres dialect).
      index.ts                 initRepository()/getRepository(): selects the
                              backend from DB_DRIVER (default "sqlite") once
                              at startup; everything else is driver-agnostic.
    config/paths.ts  Resolves data/app.db, data/files, migrations
                      directories relative to the package location, not the
                      process's current working directory -- correct
                      regardless of how or from where a script launches node.
    routes.ts      Thin HTTP layer: parses requests, calls domain services,
                  shapes responses. Contains no business rules and no direct
                  SQL/database-driver code.
  web/      React review UI: Home, Run Review, Run History, Batch Detail.
            Talks to the API only through a typed fetch client (api.ts).
```

**Data flow**: upload → parse + validate (blocks before any persistence
write) → checksum + store file (private, random filename under `data\files`,
never a static URL) → `createRun` orchestrates parse → `reconcile()` (pure)
→ persist `reconciliation_rows` + one `decisions` row per reconciliation
row, defaulted to `PENDING` → review/approve via `runService` (eligibility
enforced server-side, verified live — see section 6) → `generateBatch`
freezes eligible approved rows, writes four checksummed CSVs, and locks
their decisions in one transaction (SQLite: a single `BEGIN`/`COMMIT`
block; Postgres: the same via a pooled client).

**Why this fits the MVP**: a future vendor needs a new `vendor/` parser and
a new rule module behind the same `ReconciliationRow` shape; a future
persistence backend needs a new class implementing `Repository`. Neither
requires touching `runService`, `batchService`, decisions, or the UI. I did
not build a generalized "pluggable database framework" (no ORM, no query
builder, no migration DSL) — just one clean interface at the exact seam the
amendment asked for, backed by two independently-simple, hand-written SQL
implementations that are each easy to read start to finish.

## 4. Safety model

- **False matches, leading zeros, unsafe approvals, incomplete batches,
  untraceable rule changes, authorization, logging**: unchanged from the
  original submission's design (see the rule engine in `packages/shared`
  and the enforcement in `runService.setRowDecision`/`bulkDecision`/
  `batchService.generateBatch`) — **and now additionally confirmed by
  actually calling the running application's HTTP API**, not just by
  reading the code. Specifically verified live in this session:
  - Approving a `BLOCKED` row directly via `POST /api/runs/:id/decisions/:rowId`
    returned `403 FORBIDDEN — A blocked row can never be approved.`
  - After batch generation, attempting to change one of the included rows'
    decision back to `PENDING` returned
    `403 FORBIDDEN — This row's decision is frozen in a generated batch and cannot be changed.`
  - Downloading a real generated file's URL without a session cookie
    returned `401 AUTHENTICATION_REQUIRED`, not the file.
  - Stopping the process (`stop-windows.ps1`) and starting it again
    (`start-windows.ps1`) preserved the run, its decisions, and the
    generated batch exactly — confirmed by re-querying
    `GET /api/runs/:id` and `GET /api/batches/:id` after restart and
    comparing to the pre-stop response.
- **Batch/rollback immutability**: unchanged — no update/delete endpoint
  exists for a batch or its files on either backend.
- **Session persistence across restart**: the SQLite path uses a small
  custom `express-session` store (`sqliteSessionStore.ts`) backed by the
  same database file, rather than falling back to in-memory sessions (which
  would silently invalidate every operator's session on every restart and
  which `express-session` itself warns against using for anything but quick
  local prototyping). This was a deliberate choice to preserve the
  authentication guarantee the amendment asked to keep, not just a
  convenience.
- **No temporary/unstructured persistence**: both backends use real
  transactional SQL with a proper schema (foreign keys, check constraints on
  status/review-class enums) — reconciliation rows, decisions, batches, and
  audit log entries are relational rows, not JSON blobs on disk. SQLite runs
  in WAL mode for crash-safety and concurrent-read performance.

## 5. Real defects found and fixed while actually running this path

Naming these plainly, since finding them is exactly what "personally
executing and testing" is supposed to surface:

1. **`npm ci` silently installing only production dependencies.** My setup
   script imported `.env` into the process environment *before* running
   `npm ci`/`npm run build`. Since `.env` sets `NODE_ENV=production` (for
   the running server), npm interpreted that as "skip devDependencies" for
   the install step too, silently omitting `typescript`/`vite`/`vitest` and
   causing `'tsc' is not recognized...` mid-build. Fixed by deferring the
   `.env` import until after the build step (it's only needed for the
   migrate/seed steps), and by adding `--include=dev` to the install
   commands as a second, independent safeguard against any ambient
   `NODE_ENV=production` on the operator's machine.
2. **Sign-in silently failing over plain HTTP.** The session cookie's
   `secure` flag was tied to `NODE_ENV === "production"`. Over plain
   `http://localhost` (the normal native deployment, not HTTPS), a "secure"
   cookie is dropped by the browser/HTTP layer with no error — sign-in
   appeared to succeed (200 OK, valid response body) but no session was
   ever established. Fixed by introducing an explicit `COOKIE_SECURE`
   environment variable, defaulting to `false`, decoupled from `NODE_ENV`.
   Confirmed fixed by inspecting the raw `Set-Cookie` header before and
   after the fix.
3. **A false-positive "healthy" start on a port squatted by unrelated
   software.** On the shared development machine used for this session,
   another local tool happened to bind port 3000 the moment my own server
   process was stopped. `start-windows.ps1`'s health check originally only
   checked for HTTP 200, which that unrelated process also returned (with a
   different, coincidentally similar-looking JSON body). Fixed two ways:
   `start-windows.ps1` now checks *before* starting whether the configured
   port is already owned by a different process and refuses to proceed with
   a named, actionable error (`ERROR: port 3000 is already in use by
   another process (PID ..., ...), unrelated to this application`), and the
   post-start health check now also verifies the response body actually
   contains this application's own `dbDriver` field rather than treating
   any 200 as success. Both were reproduced and confirmed fixed live.
4. **`npm ci` occasionally failing with `EBUSY` on `node_modules`** on this
   Windows machine (most likely antivirus real-time scanning contending
   with npm's rapid file writes). Fixed by having `setup-windows.ps1` fully
   delete `node_modules` (root and per-package) before each retry — a
   half-deleted tree from an interrupted attempt was otherwise silently
   "topped up" by the next `npm ci` rather than reinstalled from scratch,
   producing an incomplete dependency tree without a nonzero exit code.

None of these were found by reading the code; all four were found only by
actually running the exact scripts an evaluator would run, which is the
core reason this revision is more trustworthy than the initial submission.

## 6. Testing evidence

**Demonstrated facts** (all commands in this list were run by me, in this
session, on this machine):

- `npm run test` (no Docker, no database): **31/31 tests pass** — 25 unit
  tests in `packages/shared` plus 6 integration tests in `packages/server`
  that parse the real `.xlsx`/CSV fixture files and run the full pipeline
  end to end, asserting every column of all 28 fixture cases individually.
- `npx tsx packages/server/src/scripts/runFullSize.ts` against the private
  full-size files: 6,632 reconciliation rows; legacy comparison **205
  EXACT_MATCH, 338 APPROVED_DEVIATION, 0 UNEXPLAINED_DIFFERENCE, 6,089
  NOT_COMPARABLE**; under one second wall time.
- **The full native Windows deployment, executed for real via the
  PowerShell tool, from a clean `node_modules`/`data` state**:
  - `scripts\setup-windows.ps1` — verified Node 26.5.0 (satisfies the >=24
    requirement), ran `npm ci --include=dev` (266 packages), built all
    three packages, created `data\` and `data\files`, applied the SQLite
    migration, and seeded the administrator account. Exit code 0.
  - `scripts\start-windows.ps1` — detected the port-3000 conflict described
    in section 5, was re-run after switching to `PORT=3001`, started the
    server as a background process, and confirmed it healthy. Exit code 0.
  - `scripts\test-windows.ps1` — ran while the server was live; all 31
    tests passed independently of the running instance. Exit code 0.
  - `scripts\stop-windows.ps1` — stopped the correct process (confirmed the
    specific PID was gone afterward via `Get-Process`), left `data\app.db`
    and `data\files\` untouched (confirmed by direct SQLite query showing
    the seeded administrator row still present).
  - Live HTTP exercise of the running application (via `curl`, replicating
    exactly what the React UI's fetch calls do): login → session cookie
    issued and accepted on a subsequent authenticated request → upload the
    synthetic Olliix workbook and Miva snapshot (real checksums and row
    counts returned) → `POST /api/runs` produced a run in `ready` status
    with the correct pinned `rule_config_hash` → summary counts matched the
    fixture exactly (25 total rows, 9 clean/11 blocked/4 warning/1
    unchanged) → `approve-all-clean` approved exactly 9 rows → a blocked
    row's direct-approval attempt was correctly rejected (403) →
    acknowledging one warning row succeeded → `generateBatch` produced four
    files and locked 10 rows' decisions → the update CSV downloaded with
    the exact expected 10 approved product codes and calculated values →
    an unauthenticated download attempt was correctly rejected (401) → a
    locked row's decision-change attempt was correctly rejected (403) →
    stop/restart preserved everything, confirmed by re-querying the run and
    batch and by direct SQLite inspection.
- `npm run build` (shared + server + web): all three packages compile
  cleanly under `strict` TypeScript, including the new `Repository`
  interface and both concrete implementations.

**Claims I am not making in this revision**: the *optional* Docker/
PostgreSQL path (`scripts/docker-optional/`) was not re-executed — Docker
remains unavailable in this development sandbox. `PostgresRepository`
compiles and type-checks against the same `Repository` interface the
verified `SqliteRepository` implements, and its SQL is a direct, minimally-
adapted carryover from the original submission's design, but it has not
been run against a live PostgreSQL instance. Per the amended specification,
this is explicitly not a blocker, since SQLite is now the required path and
Docker is optional.

## 7. Tradeoffs

- **Deliberately simplified**: the review UI is functional and table-driven,
  not visually polished — no design system, no client-side pagination
  virtualization (relies on server-side SQL/SQLite filtering instead, the
  right tradeoff at ~6,300 rows). Sessions use a small hand-written SQLite
  store rather than pulling in a general-purpose session-store package,
  since the requirement (persist across restart, no extra dependency) was
  small enough that a ~50-line implementation was clearer than a dependency.
- **What I'd change with more time**: (1) add integration tests that
  exercise the Express API routes against a real (in-memory or temp-file)
  SQLite database, closing the gap between "the pure engine is tested" and
  "the HTTP layer is tested" with automation rather than the manual live
  session in section 6; (2) add a Playwright smoke test driving the actual
  browser UI; (3) actually run the optional Docker/PostgreSQL path once
  Docker is available, to bring it to the same verified status as SQLite;
  (4) run the real Miva development-store activation test from
  `MVP_CSV_Contracts.md` section 8, explicitly out of this bake-off's scope.
- **What the architecture already supports without a rewrite**: a third
  persistence backend (e.g. a hosted Postgres or a different embedded
  database) is a new class implementing `Repository` — nothing in
  `runService`, `batchService`, the rule engine, or the UI would change.

## 8. Known limitations and risks

1. **The optional Docker/PostgreSQL path is unverified at runtime** in this
   revision (no Docker available in this sandbox). It is not the required
   evaluator path per the amended specification, so this is explicitly not
   a blocker, but it is the most important remaining gap if that path is
   ever relied upon.
2. **No automated tests exercise the Express API or either repository
   implementation** — only the pure rule engine and vendor parsers have
   dedicated automated test coverage; the domain services and both
   `Repository` implementations were verified through the manual live
   session in section 6, not through an automated integration test suite.
3. **No automated browser-based UI testing was performed** — the live
   verification in section 6 used direct HTTP calls (the same requests the
   React UI's fetch client makes), not a browser driving the actual pages.
4. **The Miva CSV headers in `MVP_CSV_Contracts.md` are explicitly
   provisional** until the three-product development-store activation test
   is run; that test is explicitly out of this bake-off's scope per the
   contract itself and was not performed.
5. **Full-size data has zero `WARNING` rows and zero warehouse-sum
   mismatches** in the current Olliix export, so while the warning/date
   logic is exhaustively covered by the synthetic suite, it has no
   additional real-data exercise.
6. **A handful of npm audit advisories remain** in devDependencies only
   (esbuild's dev-server request-forwarding issue, vitest's transitive
   dependency on an affected vite-node range) — these affect only the local
   build/test toolchain, never the deployed application, and were evaluated
   as out of scope for a bake-off timeline; `multer` and `csv-parse` were
   upgraded during the original submission specifically to close advisories
   that did apply to runtime code.
7. **DEV-004 (new deviation, not yet in the written rule contract)**: legacy
   "Expected Date Source" text is compared for display only, not for
   `EXACT_MATCH` classification, because the legacy export uses its own
   internal column-position labels rather than `WDC`/`SD3`/`SD2` (discovered
   by running the engine against the real full-size legacy audit CSV). Per
   the bake-off's own conflict-handling instructions, I did not edit the
   read-only rule contract file; this is recorded here for the winning
   foundation's contract update to incorporate.

## 9. Phase 2 approach

The current schema and services are shaped for this without broadening
scope: a Phase 2 Miva API adapter would implement the same
`MivaRawRow`-producing interface the CSV parser does today, so
`runService.createRun` would not change. Approved-batch API application
would iterate the same immutable `batches`/`decisions` rows already produced
by `generateBatch`, writing one `post_import_verification`-style result per
row instead of requiring a manually re-exported CSV — reusing
`verifyPostImport`'s comparison logic directly, on either persistence
backend since both implement the same `Repository` interface. Reversal is
already modeled correctly today as "generate a new batch from newly-approved
rows" (the rollback CSV is generated from the same mechanism); Phase 2 would
only need to let an operator select the rollback file's values as the
*proposed* values of a new corrective run.

## 10. Closing case

Judged against the rubric's own weighting, correctness and safety together
are 55% of the score. The rule engine reproduces all 28 fixture cases
exactly, produces zero unexplained differences against the real legacy audit
export, and enforces every approval-eligibility rule at the service layer —
and in this revision, those enforcement points were confirmed by actually
attacking them over live HTTP (attempting to approve a blocked row,
attempting to alter a frozen decision, attempting an unauthenticated
download) and watching them fail correctly, not just by reading the code
that should produce that behavior. Deployment simplicity is likewise no
longer a claim: the exact `setup → start → test → stop` sequence an
evaluator will run was executed in this session, on Windows, with a
0-Docker-dependency footprint, and the defects that surfaced from doing so
were fixed rather than described as future work. The one honest gap that
remains — the optional Docker/PostgreSQL path being unverified — is
explicitly not a blocker under the amended specification, and the
architecture ensures it can be verified later without touching a single
line of reconciliation, approval, or batch logic.
