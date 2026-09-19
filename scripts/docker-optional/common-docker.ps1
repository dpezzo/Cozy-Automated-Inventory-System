# Shared helpers for the Windows setup/start/test/stop scripts.
# Dot-sourced by the other scripts in this directory; not meant to be run directly.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    # This script lives under scripts/docker-optional/, two levels under the app root.
    return (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
}

function Test-DockerAvailable {
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Host "ERROR: Docker was not found on PATH." -ForegroundColor Red
        Write-Host "Install Docker Desktop for Windows from https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
        Write-Host "and enable virtualization (WSL2 backend) if prompted during installation." -ForegroundColor Yellow
        exit 1
    }

    try {
        docker info *> $null
    } catch {
        Write-Host "ERROR: Docker is installed but does not appear to be running." -ForegroundColor Red
        Write-Host "Start Docker Desktop and wait for it to report 'Engine running', then re-run this script." -ForegroundColor Yellow
        exit 1
    }

    try {
        docker compose version *> $null
    } catch {
        Write-Host "ERROR: 'docker compose' is not available. Update Docker Desktop to a version that bundles Compose v2." -ForegroundColor Red
        exit 1
    }
}

function Confirm-EnvFile {
    param([string]$RepoRoot)

    $envPath = Join-Path $RepoRoot ".env"
    $examplePath = Join-Path $RepoRoot ".env.example"

    if (-not (Test-Path $envPath)) {
        if (-not (Test-Path $examplePath)) {
            Write-Host "ERROR: .env.example is missing; cannot create a local .env file." -ForegroundColor Red
            exit 1
        }
        Copy-Item $examplePath $envPath
        Write-Host "Created .env from .env.example." -ForegroundColor Yellow
        Write-Host "IMPORTANT: open .env and set a real ADMIN_PASSWORD and SESSION_SECRET before continuing." -ForegroundColor Yellow
        Write-Host "This is a one-time step; re-run setup-windows.ps1 after editing .env." -ForegroundColor Yellow
        exit 1
    }
}

function Invoke-ComposeOrFail {
    param([string[]]$Arguments, [string]$RepoRoot)

    Push-Location $RepoRoot
    try {
        & docker compose @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($exitCode -ne 0) {
        Write-Host "ERROR: 'docker compose $($Arguments -join ' ')' failed with exit code $exitCode." -ForegroundColor Red
        exit $exitCode
    }
}

function Wait-ForHealthy {
    param([string]$ServiceName, [string]$RepoRoot, [int]$TimeoutSeconds = 120)

    Write-Host "Waiting for '$ServiceName' to become healthy (up to $TimeoutSeconds seconds)..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    Push-Location $RepoRoot
    try {
        while ((Get-Date) -lt $deadline) {
            $cid = (& docker compose ps -q $ServiceName)
            if ($cid) {
                $status = (& docker inspect --format "{{.State.Health.Status}}" $cid 2>$null)
                if ($status -eq "healthy") {
                    Write-Host "$ServiceName is healthy." -ForegroundColor Green
                    return
                }
            }
            Start-Sleep -Seconds 2
        }
    } finally {
        Pop-Location
    }

    Write-Host "ERROR: '$ServiceName' did not become healthy within $TimeoutSeconds seconds." -ForegroundColor Red
    Write-Host "Run 'docker compose logs $ServiceName' from $RepoRoot to diagnose." -ForegroundColor Yellow
    exit 1
}

function Get-DotEnvValue {
    param([string]$RepoRoot, [string]$Name, [string]$Default)

    $envPath = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envPath)) { return $Default }
    $line = Get-Content $envPath | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
    if (-not $line) { return $Default }
    return ($line -split "=", 2)[1].Trim()
}
