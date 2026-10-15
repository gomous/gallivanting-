[CmdletBinding()]
param(
  [switch]$NoPrompt,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$OpenCodeArguments
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$opencode = Join-Path $env:APPDATA "npm\opencode.cmd"

if (-not (Test-Path -LiteralPath $opencode -PathType Leaf)) {
  throw "Standalone OpenCode was not found at '$opencode'. Install opencode-ai or update this launcher path."
}

Set-Location -LiteralPath $projectRoot

if ([string]::IsNullOrWhiteSpace($env:GITHUB_PERSONAL_ACCESS_TOKEN)) {
  if ($NoPrompt) {
    throw "GITHUB_PERSONAL_ACCESS_TOKEN is not set in this PowerShell session."
  }

  $securePat = Read-Host "GitHub PAT (input is hidden)" -AsSecureString
  $env:GITHUB_PERSONAL_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $securePat).Password
}

Write-Host "Checking project MCP servers..." -ForegroundColor Cyan
& $opencode mcp list

if ($LASTEXITCODE -ne 0) {
  throw "OpenCode MCP discovery failed with exit code $LASTEXITCODE."
}

Write-Host "Starting standalone OpenCode from $projectRoot" -ForegroundColor Green
& $opencode @OpenCodeArguments
exit $LASTEXITCODE
