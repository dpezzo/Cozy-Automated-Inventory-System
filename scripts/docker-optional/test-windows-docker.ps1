<#
.SYNOPSIS
  Runs the automated shared-rules and fixture-driven test suite (the 28-case
  synthetic bake-off suite plus unit tests) inside a Docker container, so no
  host Node.js installation is required.

.DESCRIPTION
  This does not require PostgreSQL or the running app -- the rules engine and
  fixture tests are pure/in-memory. Exit code is nonzero if any test fails.
#>

. (Join-Path $PSScriptRoot "common-docker.ps1")

$repoRoot = Get-RepoRoot
Write-Host "CozyWinters Olliix MVP - automated test suite" -ForegroundColor Cyan

Test-DockerAvailable

Push-Location $repoRoot
try {
    & docker compose --profile test build test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & docker compose --profile test run --rm test
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($exitCode -eq 0) {
    Write-Host "`nAll tests passed." -ForegroundColor Green
} else {
    Write-Host "`nTests failed (exit code $exitCode). See output above." -ForegroundColor Red
}
exit $exitCode
