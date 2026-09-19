# Shared helpers for the native (Docker-free) Windows setup/start/test/stop
# scripts. Dot-sourced by the other scripts in this directory; not meant to
# be run directly.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:MinimumNodeMajor = 24

function Get-RepoRoot {
    # scripts/ is always directly under the app root.
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Test-NodeAvailable {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Host "ERROR: Node.js was not found on PATH." -ForegroundColor Red
        Write-Host "Install Node.js $script:MinimumNodeMajor LTS (or newer) from https://nodejs.org/ and re-run this script." -ForegroundColor Yellow
        exit 1
    }

    $versionOutput = (& node --version).TrimStart("v")
    $major = [int]($versionOutput.Split(".")[0])
    if ($major -lt $script:MinimumNodeMajor) {
        Write-Host "ERROR: Node.js $versionOutput was found, but $script:MinimumNodeMajor or newer is required (this app uses the built-in node:sqlite module)." -ForegroundColor Red
        Write-Host "Install Node.js $script:MinimumNodeMajor LTS from https://nodejs.org/ and re-run this script." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Node.js $versionOutput detected (>= $script:MinimumNodeMajor required)." -ForegroundColor Green
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

function Get-DotEnvValue {
    param([string]$RepoRoot, [string]$Name, [string]$Default)

    $envPath = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envPath)) { return $Default }
    $line = Get-Content $envPath | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
    if (-not $line) { return $Default }
    return ($line -split "=", 2)[1].Trim()
}

function Import-DotEnvIntoProcess {
    param([string]$RepoRoot)

    $envPath = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envPath)) { return }
    foreach ($line in Get-Content $envPath) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed -split "=", 2
        if ($parts.Length -ne 2) { continue }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Get-PidFilePath {
    param([string]$RepoRoot)
    return Join-Path $RepoRoot "data\server.pid"
}

function Get-RunningServerProcess {
    param([string]$RepoRoot)

    $pidFile = Get-PidFilePath -RepoRoot $RepoRoot
    if (-not (Test-Path $pidFile)) { return $null }
    $processId = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $processId) { return $null }
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    return $proc
}

function Invoke-NpmWithRetry {
    param([string[]]$Arguments, [int]$MaxAttempts = 3)

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        & npm @Arguments
        if ($LASTEXITCODE -eq 0) { return }

        if ($attempt -lt $MaxAttempts) {
            Write-Host "npm $($Arguments -join ' ') failed (attempt $attempt of $MaxAttempts)." -ForegroundColor Yellow
            Write-Host "This is often a transient Windows file lock (antivirus real-time scanning, or a lingering node process holding node_modules open). Retrying in 3 seconds..." -ForegroundColor Yellow
            Start-Sleep -Seconds 3
        }
    }

    Write-Host "ERROR: npm $($Arguments -join ' ') failed after $MaxAttempts attempts." -ForegroundColor Red
    Write-Host "If the error mentions EBUSY/EPERM on node_modules, close any running 'node' processes for this project, temporarily pause antivirus real-time scanning for this folder, and re-run this script." -ForegroundColor Yellow
    exit $LASTEXITCODE
}

function Test-PortInUseByOtherProcess {
    param([int]$Port, [int]$ExpectedProcessId = 0)

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        if ($conn.OwningProcess -ne $ExpectedProcessId) { return $conn.OwningProcess }
    }
    return $null
}

function Wait-ForAppHealthy {
    param([string]$Url, [int]$TimeoutSeconds = 60)

    # Checks both that something answers on the port AND that the JSON body
    # is actually this application's health payload (dbDriver field) --
    # this machine may have other local software sharing the same default
    # port, and a bare TCP/HTTP 200 check alone cannot tell them apart.
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                $body = $response.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($body -and $body.PSObject.Properties.Name -contains "dbDriver") {
                    return $true
                }
            }
        } catch {
            # Not up yet; keep waiting.
        }
        Start-Sleep -Seconds 1
    }
    return $false
}
