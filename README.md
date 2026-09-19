# CozyWinters Olliix Inventory Reconciliation MVP (Claude submission)

This is the Claude bake-off submission for the CozyWinters Olliix Inventory
Reconciliation MVP. See `CONTESTANT_DEBRIEF.md` for the full methodology,
architecture, safety model, testing evidence, and evaluation case, and
`END_USER_TEST_GUIDE.md` for step-by-step operator instructions on Windows 11.

## Quick start (Windows 11, Node.js 24 LTS -- no Docker required)

```powershell
Copy-Item .env.example .env    # then edit ADMIN_PASSWORD and SESSION_SECRET
scripts\setup-windows.ps1
scripts\start-windows.ps1
scripts\test-windows.ps1       # runs the automated fixture + unit test suite
scripts\stop-windows.ps1
```

Open http://localhost:3000 (or the port set by `PORT` in `.env`) and sign in
with the administrator account from `.env`.

Node.js 24 LTS is the only required external runtime. Persistence is an
embedded SQLite database at `data/app.db`, with private uploaded/generated
files under `data/files` -- no PostgreSQL and no Docker Desktop are needed
for this path, and an inability to run Docker is not a blocker.

An optional, production-like Docker Compose + PostgreSQL path is still
available under `scripts/docker-optional/` for anyone who wants it, but it
is not the required or primary evaluator path -- see
`scripts/docker-optional/README.md`.

## Repository layout

- `packages/shared` -- the isolated, pure Olliix rule engine (normalization,
  matching, quantity/date rules, managed-value calculation, legacy
  comparison, post-import verification). No I/O, no framework dependencies.
- `packages/server` -- Express API, persistence, file storage, vendor file
  parsers (Olliix `.xlsx`, Miva CSV, legacy audit CSV), and the
  fixture-driven test suite.
  - `src/db/Repository.ts` defines the persistence interface every domain
    service depends on. `src/db/sqliteRepository.ts` (default, built on
    Node's built-in `node:sqlite`) and `src/db/postgresRepository.ts`
    (optional, Docker) both implement it, so reconciliation, approval,
    batch-generation, and validation logic never know which database is
    active.
  - `migrations-sqlite/` and `migrations/` hold the two backends' schemas.
- `packages/web` -- React review UI (Home, Run Review, Run History, Batch
  Detail).
- `packages/server/test-fixtures/synthetic` -- a byte-identical, checksum-
  verified copy of the shared bake-off synthetic fixture bundle, vendored
  here so the automated test suite is self-contained.
- `scripts/*.ps1` -- the native Windows deployment path (setup, start, test,
  stop, and an optional destructive reset).
- `scripts/docker-optional/` -- the optional Docker Compose + PostgreSQL
  path, kept for anyone who prefers it.
