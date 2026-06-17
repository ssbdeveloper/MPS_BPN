$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing .env file at $envFile"
}

$vars = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') {
    return
  }

  $parts = $_ -split '=', 2
  if ($parts.Length -eq 2) {
    $vars[$parts[0].Trim()] = $parts[1].Trim()
  }
}

$required = @("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
foreach ($key in $required) {
  if (-not $vars.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($vars[$key])) {
    throw "Missing required env var: $key"
  }
}

$dsn = "postgresql://{0}:{1}@{2}:{3}/{4}" -f `
  $vars["DB_USER"], `
  [Uri]::EscapeDataString($vars["DB_PASSWORD"]), `
  $vars["DB_HOST"], `
  $vars["DB_PORT"], `
  $vars["DB_NAME"]

& npx -y @bytebase/dbhub --dsn $dsn
