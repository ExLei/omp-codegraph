# Pull the latest version from the remote and reinstall.
# Usage: powershell -ExecutionPolicy Bypass -File update.ps1
$ErrorActionPreference = "Stop"

$SRC = Split-Path -Parent $MyInvocation.MyCommand.Path

git -C $SRC pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git pull failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

& (Join-Path $SRC "install.ps1")
exit $LASTEXITCODE
