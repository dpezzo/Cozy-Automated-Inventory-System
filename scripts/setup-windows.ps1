<#
.SYNOPSIS
  One-time (and safely re-runnable) native Windows setup for the CozyWinters
  Olliix reconciliation MVP: no Docker or PostgreSQL required. Verifies
  Node.js, installs locked dependencies, builds the app, creates the private
  data directories, initializes the SQLite database, and seeds the local
  administrator account.

.DESCRIPTION
  Run this once after extracting the submission, and again any time you want
  to reapply migrations/seed after pulling changes. It does not start the
  application server itself -- run start-windows.ps1 next.
#>

. (Join-Path $PSScriptRoot "common.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - native Windows setup (Node.js + SQLite, no Docker)" -ForegroundColor Cyan
Write-Host "Repository root: $repoRoot"

Test-NodeAvailable
Confirm-EnvFile -RepoRoot $repoRoot
# Deliberately NOT importing .env into the process yet: this repo's .env
# commonly sets NODE_ENV=production for the running server, but npm treats
# NODE_ENV=production as "skip devDependencies" for install/build commands --
# which would silently omit typescript/vite/vitest and break the build. The
# env file is imported later, only for the migrate/seed steps that actually
# need ADMIN_EMAIL/ADMIN_PASSWORD.

Push-Location $repoRoot
try {
    Write-Host "`nInstalling locked dependencies (npm ci)..." -ForegroundColor Cyan
    # npm ci deletes node_modules before reinstalling; if a prior attempt was
    # interrupted partway (e.g. a transient Windows antivirus file lock), a
    # half-deleted node_modules can make a retry silently install an
    # incomplete tree. Force a clean slate before each attempt so a retry is
    # actually a full retry, not a resume of a corrupted state. --include=dev
    # guarantees devDependencies (typescript, vite, vitest) install even if
    # NODE_ENV=production is set somewhere in the ambient environment.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Remove-Item -Recurse -Force (Join-Path $repoRoot "node_modules") -ErrorAction SilentlyContinue
        Get-ChildItem -Path (Join-Path $repoRoot "packages") -Directory | ForEach-Object {
            Remove-Item -Recurse -Force (Join-Path $_.FullName "node_modules") -ErrorAction SilentlyContinue
        }

        if (Test-Path (Join-Path $repoRoot "package-lock.json")) {
            & npm ci --include=dev
        } else {
            & npm install --include=dev
        }

        if ($LASTEXITCODE -eq 0) { break }
        if ($attempt -lt 3) {
            Write-Host "npm ci failed (attempt $attempt of 3), often a transient Windows file lock (antivirus real-time scanning). Retrying with a clean node_modules in 3 seconds..." -ForegroundColor Yellow
            Start-Sleep -Seconds 3
        } else {
            Write-Host "ERROR: npm ci failed after 3 attempts." -ForegroundColor Red
            Write-Host "If the error mentions EBUSY/EPERM, close any running 'node' processes for this project, temporarily pause antivirus real-time scanning for this folder, and re-run this script." -ForegroundColor Yellow
            exit $LASTEXITCODE
        }
    }

    Write-Host "`nBuilding the application (shared rules engine, server, web UI)..." -ForegroundColor Cyan
    Invoke-NpmWithRetry -Arguments @("run", "build") -MaxAttempts 1
} finally {
    Pop-Location
}

$dataDir = Join-Path $repoRoot "data"
$filesDir = Join-Path $dataDir "files"
Write-Host "`nCreating private data directories..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $filesDir | Out-Null
Write-Host "  $dataDir"
Write-Host "  $filesDir"

Import-DotEnvIntoProcess -RepoRoot $repoRoot

Write-Host "`nInitializing/migrating the SQLite database..." -ForegroundColor Cyan
& node (Join-Path $repoRoot "packages\server\dist\db\migrate.js")
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: database migration failed." -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host "`nSeeding the local administrator account..." -ForegroundColor Cyan
& node (Join-Path $repoRoot "packages\server\dist\db\seed.js")
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: administrator seed failed." -ForegroundColor Red; exit $LASTEXITCODE }

$appPort = Get-DotEnvValue -RepoRoot $repoRoot -Name "PORT" -Default "3000"
$adminEmail = Get-DotEnvValue -RepoRoot $repoRoot -Name "ADMIN_EMAIL" -Default "(see .env)"

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Database file: $dataDir\app.db"
Write-Host "Private files: $filesDir"
Write-Host "Administrator account: $adminEmail (password from .env)"
Write-Host "Next: run scripts\start-windows.ps1, then open http://localhost:$appPort" -ForegroundColor Green
exit 0
