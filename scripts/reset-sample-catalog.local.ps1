[CmdletBinding()]
param(
  [switch]$Confirm
)

if (-not $Confirm) {
  throw 'DESTRUCTIVE LOCAL ACTION: re-run with -Confirm to replace unreferenced buyers/products and deactivate referenced records.'
}

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:XDG_CONFIG_HOME = Join-Path $projectRoot '.cache/xdg'

Write-Host 'DESTRUCTIVE LOCAL ACTION: resetting the local sample buyer and product catalog.' -ForegroundColor Yellow
& npx.cmd wrangler d1 execute rich-time-db --local --persist-to .wrangler/state --file scripts/reset-sample-catalog.local.sql
if ($LASTEXITCODE -ne 0) {
  throw "Local sample catalog reset failed with exit code $LASTEXITCODE."
}
