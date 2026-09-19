<#
.SYNOPSIS
  DESTRUCTIVE: stops the application AND permanently deletes the local
  data\ directory (the SQLite database and every uploaded/generated file).

.DESCRIPTION
  Use this only when you want to wipe local test data and start over. This
  deletes all runs, decisions, batches, and uploaded files stored by this
  local deployment. It does NOT affect the original bake-off seed package
  files. There is no undo.
#>

. (Join-Path $PSScriptRoot "common.ps1")

$repoRoot = Get-RepoRoot
Write-Host "==================================================================" -ForegroundColor Red
Write-Host " DESTRUCTIVE ACTION: this will PERMANENTLY DELETE all local        " -ForegroundColor Red
Write-Host " CozyWinters Olliix MVP data: the SQLite database (data\app.db)    " -ForegroundColor Red
Write-Host " and every uploaded/generated file under data\files. This cannot   " -ForegroundColor Red
Write-Host " be undone.                                                        " -ForegroundColor Red
Write-Host "==================================================================" -ForegroundColor Red

$confirmation = Read-Host "Type RESET to confirm permanent deletion of local test data"
if ($confirmation -ne "RESET") {
    Write-Host "Aborted. No changes were made." -ForegroundColor Yellow
    exit 1
}

$proc = Get-RunningServerProcess -RepoRoot $repoRoot
if ($proc) {
    Write-Host "Stopping the running application first..." -ForegroundColor Cyan
    Stop-Process -Id $proc.Id -Force
}

$dataDir = Join-Path $repoRoot "data"
if (Test-Path $dataDir) {
    Remove-Item -Recurse -Force $dataDir
}

Write-Host "`nAll local data was deleted. Run scripts\setup-windows.ps1 to start fresh." -ForegroundColor Green
exit 0
