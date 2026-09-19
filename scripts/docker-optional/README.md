# Optional Docker Compose + PostgreSQL path

This folder holds an **optional**, production-like local environment using
Docker Compose and PostgreSQL. It is **not** the required or primary
evaluator path -- that is the native Windows path in `scripts/` (Node.js 24
LTS + embedded SQLite, no Docker). Use this folder only if you specifically
want to exercise the PostgreSQL-backed `Repository` implementation
(`packages/server/src/db/postgresRepository.ts`) or prefer a containerized
deployment.

```powershell
Copy-Item ..\..\.env.example ..\..\.env   # then edit and uncomment the
                                            # "Optional PostgreSQL/Docker path"
                                            # section, plus set ADMIN_PASSWORD
                                            # and SESSION_SECRET
cd ..\..                                   # run from the app root
scripts\docker-optional\setup-windows-docker.ps1
scripts\docker-optional\start-windows-docker.ps1
scripts\docker-optional\test-windows-docker.ps1
scripts\docker-optional\stop-windows-docker.ps1
```

This path requires Docker Desktop and was **not** personally executed as
part of this submission (no Docker runtime was available in the development
environment) -- see `CONTESTANT_DEBRIEF.md` for exactly what was and was not
verified. The native SQLite path in `scripts/` was fully built, run, and
verified end to end, including live HTTP requests against the safety gates,
restart persistence, and the automated test suite.
