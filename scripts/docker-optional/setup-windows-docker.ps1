<#
.SYNOPSIS
  One-time (and safely re-runnable) setup for the CozyWinters Olliix
  reconciliation MVP on Windows 11: builds images, starts PostgreSQL,
  applies database migrations, and seeds the local test administrator.

.DESCRIPTION
  Run this once after extracting the bake-off submission, and again any time
  you want to reapply migrations/seed after pulling changes. It does not
  start the application server itself -- run start-windows.ps1 next.
#>

. (Join-Path $PSScriptRoot "common-docker.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - Windows setup" -ForegroundColor Cyan
Write-Host "Repository root: $repoRoot"

Test-DockerAvailable
Confirm-EnvFile -RepoRoot $repoRoot

Write-Host "`nBuilding Docker images (this can take a few minutes the first time)..." -ForegroundColor Cyan
Invoke-ComposeOrFail -Arguments @("build") -RepoRoot $repoRoot

Write-Host "`nStarting PostgreSQL..." -ForegroundColor Cyan
Invoke-ComposeOrFail -Arguments @("up", "-d", "postgres") -RepoRoot $repoRoot
Wait-ForHealthy -ServiceName "postgres" -RepoRoot $repoRoot

Write-Host "`nApplying database migrations..." -ForegroundColor Cyan
Invoke-ComposeOrFail -Arguments @("run", "--rm", "app", "node", "dist/db/migrate.js") -RepoRoot $repoRoot

Write-Host "`nSeeding the local test administrator account..." -ForegroundColor Cyan
Invoke-ComposeOrFail -Arguments @("run", "--rm", "app", "node", "dist/db/seed.js") -RepoRoot $repoRoot

$appPort = Get-DotEnvValue -RepoRoot $repoRoot -Name "HOST_APP_PORT" -Default "3000"
$adminEmail = Get-DotEnvValue -RepoRoot $repoRoot -Name "ADMIN_EMAIL" -Default "(see .env)"

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Administrator account: $adminEmail (password from .env)"
Write-Host "Next: run scripts\start-windows.ps1, then open http://localhost:$appPort" -ForegroundColor Green
exit 0
