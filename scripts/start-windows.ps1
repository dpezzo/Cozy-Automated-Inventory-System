<#
.SYNOPSIS
  Starts the CozyWinters Olliix reconciliation MVP natively on Windows (no
  Docker) after setup-windows.ps1 has been run at least once, and reports
  the local browser address once it responds to health checks.
#>

. (Join-Path $PSScriptRoot "common.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - starting the application (native Node.js)" -ForegroundColor Cyan

Test-NodeAvailable
Confirm-EnvFile -RepoRoot $repoRoot
Import-DotEnvIntoProcess -RepoRoot $repoRoot

$entryPoint = Join-Path $repoRoot "packages\server\dist\index.js"
if (-not (Test-Path $entryPoint)) {
    Write-Host "ERROR: $entryPoint was not found. Run scripts\setup-windows.ps1 first." -ForegroundColor Red
    exit 1
}

$existing = Get-RunningServerProcess -RepoRoot $repoRoot
if ($existing) {
    $appPort = Get-DotEnvValue -RepoRoot $repoRoot -Name "PORT" -Default "3000"
    Write-Host "The application already appears to be running (process id $($existing.Id))." -ForegroundColor Yellow
    Write-Host "Open http://localhost:$appPort, or run scripts\stop-windows.ps1 first to restart cleanly." -ForegroundColor Yellow
    exit 0
}

$appPort = Get-DotEnvValue -RepoRoot $repoRoot -Name "PORT" -Default "3000"
$conflictingPid = Test-PortInUseByOtherProcess -Port ([int]$appPort)
if ($conflictingPid) {
    $conflictingProc = Get-Process -Id $conflictingPid -ErrorAction SilentlyContinue
    $procName = if ($conflictingProc) { $conflictingProc.ProcessName } else { "unknown" }
    Write-Host "ERROR: port $appPort is already in use by another process (PID $conflictingPid, $procName), unrelated to this application." -ForegroundColor Red
    Write-Host "Set a different PORT in .env (e.g. PORT=3001) and re-run this script." -ForegroundColor Yellow
    exit 1
}

$dataDir = Join-Path $repoRoot "data"
$logDir = Join-Path $dataDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdoutLog = Join-Path $logDir "server.out.log"
$stderrLog = Join-Path $logDir "server.err.log"

Write-Host "Starting the server in the background..." -ForegroundColor Cyan
$proc = Start-Process -FilePath "node" -ArgumentList "`"$entryPoint`"" `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path (Get-PidFilePath -RepoRoot $repoRoot) -Value $proc.Id

$url = "http://localhost:$appPort"
$healthUrl = "$url/api/health"

Write-Host "Waiting for the application to become healthy at $healthUrl ..." -ForegroundColor Cyan
$healthy = Wait-ForAppHealthy -Url $healthUrl -TimeoutSeconds 60

if (-not $healthy) {
    Write-Host "ERROR: the application did not respond within 60 seconds." -ForegroundColor Red
    Write-Host "Check the logs for details:" -ForegroundColor Yellow
    Write-Host "  $stdoutLog"
    Write-Host "  $stderrLog"
    exit 1
}

Write-Host "`nThe application is running at $url" -ForegroundColor Green
Write-Host "Sign in with the administrator account from your .env file." -ForegroundColor Green
Write-Host "Logs: $stdoutLog / $stderrLog" -ForegroundColor Green
Write-Host "Next: open $url in your browser, or run scripts\test-windows.ps1 to run the automated test suite." -ForegroundColor Green
exit 0
