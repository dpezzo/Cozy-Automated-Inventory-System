<#
.SYNOPSIS
  Starts the CozyWinters Olliix reconciliation MVP (PostgreSQL + app server)
  after setup-windows.ps1 has been run at least once.
#>

. (Join-Path $PSScriptRoot "common-docker.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - starting services" -ForegroundColor Cyan

Test-DockerAvailable
Confirm-EnvFile -RepoRoot $repoRoot

Invoke-ComposeOrFail -Arguments @("up", "-d", "postgres", "app") -RepoRoot $repoRoot
Wait-ForHealthy -ServiceName "postgres" -RepoRoot $repoRoot
Wait-ForHealthy -ServiceName "app" -RepoRoot $repoRoot

$appPort = Get-DotEnvValue -RepoRoot $repoRoot -Name "HOST_APP_PORT" -Default "3000"
$url = "http://localhost:$appPort"

Write-Host "`nThe application is running at $url" -ForegroundColor Green
Write-Host "Sign in with the administrator account from your .env file." -ForegroundColor Green
Write-Host "Next: open $url in your browser, or run scripts\test-windows.ps1 to run the automated fixture suite." -ForegroundColor Green
exit 0
