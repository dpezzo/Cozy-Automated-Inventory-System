<#
.SYNOPSIS
  Stops the CozyWinters Olliix reconciliation MVP application process
  started by scripts\start-windows.ps1, without deleting the SQLite
  database, uploaded files, audit history, or generated batches. Safe to
  run any time; data persists for the next scripts\start-windows.ps1.
#>

. (Join-Path $PSScriptRoot "common.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - stopping the application" -ForegroundColor Cyan

$proc = Get-RunningServerProcess -RepoRoot $repoRoot
$pidFile = Get-PidFilePath -RepoRoot $repoRoot

if (-not $proc) {
    Write-Host "No running application process was found (it may already be stopped)." -ForegroundColor Yellow
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
    exit 0
}

Write-Host "Stopping process id $($proc.Id)..." -ForegroundColor Cyan
Stop-Process -Id $proc.Id -Force
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue

Write-Host "`nApplication stopped." -ForegroundColor Green
Write-Host "The SQLite database (data\app.db), uploaded files, audit history, and generated batches under data\files were not touched." -ForegroundColor Green
Write-Host "Run scripts\start-windows.ps1 to start again." -ForegroundColor Green
exit 0
