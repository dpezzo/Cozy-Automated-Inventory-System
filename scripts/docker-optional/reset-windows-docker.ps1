<#
.SYNOPSIS
  DESTRUCTIVE: stops all containers AND permanently deletes the local
  PostgreSQL database volume and uploaded/generated file volume.

.DESCRIPTION
  Use this only when you want to wipe local test data and start over (for
  example, between clean bake-off demonstration runs). This deletes all
  runs, decisions, batches, and uploaded files stored by this local
  deployment. It does NOT affect the original bake-off seed package files.
  There is no undo.
#>

. (Join-Path $PSScriptRoot "common-docker.ps1")

$repoRoot = Get-RepoRoot
Write-Host "==================================================================" -ForegroundColor Red
Write-Host " DESTRUCTIVE ACTION: this will PERMANENTLY DELETE all local        " -ForegroundColor Red
Write-Host " CozyWinters Olliix MVP data: the PostgreSQL database and every    " -ForegroundColor Red
Write-Host " uploaded/generated file volume. This cannot be undone.           " -ForegroundColor Red
Write-Host "==================================================================" -ForegroundColor Red

$confirmation = Read-Host "Type RESET to confirm permanent deletion of local test data"
if ($confirmation -ne "RESET") {
    Write-Host "Aborted. No changes were made." -ForegroundColor Yellow
    exit 1
}

Test-DockerAvailable
Invoke-ComposeOrFail -Arguments @("down", "-v") -RepoRoot $repoRoot

Write-Host "`nAll local data was deleted. Run scripts\setup-windows.ps1 to start fresh." -ForegroundColor Green
exit 0
