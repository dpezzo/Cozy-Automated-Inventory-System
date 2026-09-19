<#
.SYNOPSIS
  Runs the automated shared-rules unit tests and the 28-case synthetic
  fixture suite natively on Windows (no Docker, no PostgreSQL) using the
  Node.js toolchain installed by setup-windows.ps1.

.DESCRIPTION
  These tests are pure/in-memory (they exercise the rules engine and vendor
  parsers directly against the vendored fixture bundle) and do not require
  the application server or SQLite database to be running. Exit code is
  nonzero if any test fails.
#>

. (Join-Path $PSScriptRoot "common.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - automated test suite (native, no Docker)" -ForegroundColor Cyan

Test-NodeAvailable

Push-Location $repoRoot
try {
    if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
        Write-Host "Dependencies not installed yet; run scripts\setup-windows.ps1 first." -ForegroundColor Red
        exit 1
    }

    & npm run test
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($exitCode -eq 0) {
    Write-Host "`nAll tests passed (unit tests + full 28-case synthetic fixture comparison)." -ForegroundColor Green
} else {
    Write-Host "`nTests failed (exit code $exitCode). See output above." -ForegroundColor Red
}
exit $exitCode
