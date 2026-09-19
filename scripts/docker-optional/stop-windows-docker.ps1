<#
.SYNOPSIS
  Stops the CozyWinters Olliix reconciliation MVP containers without deleting
  database or uploaded-file volumes. Safe to run any time; data persists for
  the next scripts\start-windows.ps1.
#>

. (Join-Path $PSScriptRoot "common-docker.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - stopping services" -ForegroundColor Cyan

Test-DockerAvailable
Invoke-ComposeOrFail -Arguments @("down") -RepoRoot $repoRoot

Write-Host "`nServices stopped. Database and uploaded files are preserved." -ForegroundColor Green
Write-Host "Run scripts\start-windows.ps1 to start again." -ForegroundColor Green
exit 0
