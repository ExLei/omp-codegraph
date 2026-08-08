# Install omp-codegraph on Windows: codegraph CLI + extension + skill.
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1
#
# The official codegraph installer is POSIX-only (uname/tar/symlinks); on
# Windows the npm package is the supported route: `@colbymchenry/codegraph`
# ships per-platform optionalDependencies (win32-x64 / win32-arm64) and a
# `codegraph.cmd` launcher in the npm global bin dir.
$ErrorActionPreference = "Stop"

$SRC = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1) codegraph CLI — install via npm when missing.
$codegraph = Get-Command codegraph -ErrorAction SilentlyContinue
if ($codegraph) {
    Write-Host "codegraph CLI: $($codegraph.Source)"
}
else {
    Write-Host "codegraph CLI not found - installing..."
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: npm not found. Install Node.js (https://nodejs.org) first." -ForegroundColor Red
        exit 1
    }
    npm install -g @colbymchenry/codegraph
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: npm install failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
    $codegraph = Get-Command codegraph -ErrorAction SilentlyContinue
    if (-not $codegraph) {
        Write-Host "ERROR: codegraph still not on PATH after install." -ForegroundColor Red
        Write-Host "       npm global bin dir ($env:APPDATA\npm) must be on PATH." -ForegroundColor Yellow
        Write-Host "       The Node.js installer adds it by default; restart the terminal if needed." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "codegraph CLI installed: $($codegraph.Source)"
}

# 2) extension + skill (same layout as install.sh, under %USERPROFILE%).
$extDir = Join-Path $HOME ".omp\agent\extensions"
$skillDir = Join-Path $HOME ".claude\skills\codegraph"
New-Item -ItemType Directory -Force -Path $extDir, $skillDir | Out-Null
Copy-Item (Join-Path $SRC "extensions\codegraph.ts") (Join-Path $extDir "codegraph.ts") -Force
Copy-Item (Join-Path $SRC "skills\codegraph\SKILL.md") (Join-Path $skillDir "SKILL.md") -Force

Write-Host "Installed:"
Write-Host "  $extDir\codegraph.ts"
Write-Host "  $skillDir\SKILL.md"
Write-Host "Note: running oh-my-pi sessions keep the extension version loaded at process start;"
Write-Host "      restart oh-my-pi (or reload agents) for changes to take effect."
