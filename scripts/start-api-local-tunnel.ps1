param(
  [int]$LocalDbPort = 15433,
  [switch]$SkipTailscaleStart
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $repoRoot ".env"
$apiDir = Join-Path $repoRoot "apps\api"
$tunnelScript = Join-Path $repoRoot "scripts\pg_socks_tunnel.py"
$tailscaleStart = "C:\Users\tee.san\tools\tailscale\tailscale-start.sh"
$gitBash = "C:\Program Files\Git\bin\bash.exe"

function Read-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Key))=" } |
    Select-Object -First 1

  if (-not $line) {
    throw "Missing $Key in $Path"
  }

  $value = ($line -split "=", 2)[1].Trim()
  $commentIndex = $value.IndexOf(" #")
  if ($commentIndex -ge 0) {
    $value = $value.Substring(0, $commentIndex).Trim()
  }
  if (
    ($value.StartsWith("'") -and $value.EndsWith("'")) -or
    ($value.StartsWith('"') -and $value.EndsWith('"'))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Test-PortOpen {
  param(
    [string]$HostName,
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(700)) {
      return $false
    }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$dbHost = Read-DotEnvValue -Path $envPath -Key "DB_HOST"
$dbPort = Read-DotEnvValue -Path $envPath -Key "DB_PORT"
$isLoopbackDbHost = $dbHost -in @("127.0.0.1", "localhost", "::1")

if ($isLoopbackDbHost) {
  $fallbackHost = Read-DotEnvValue -Path $envPath -Key "TGT_HOST"
  $fallbackPort = Read-DotEnvValue -Path $envPath -Key "TGT_PORT"
  Write-Warning "DB_HOST in .env is $dbHost. Using TGT_HOST/TGT_PORT as remote tunnel target: ${fallbackHost}:${fallbackPort}"
  $dbHost = $fallbackHost
  $dbPort = $fallbackPort
}

if (($dbHost -in @("127.0.0.1", "localhost", "::1")) -and ([int]$dbPort -eq $LocalDbPort)) {
  throw "Refusing to create a loop tunnel: 127.0.0.1:$LocalDbPort -> ${dbHost}:${dbPort}"
}

if (-not $SkipTailscaleStart -and (Test-Path -LiteralPath $tailscaleStart) -and (Test-Path -LiteralPath $gitBash)) {
  Write-Host "Starting Tailscale SOCKS5 proxy..."
  & $gitBash "/c/Users/tee.san/tools/tailscale/tailscale-start.sh"
}

$tunnelProcess = $null
if (Test-PortOpen -HostName "127.0.0.1" -Port $LocalDbPort) {
  Write-Host "Reusing existing local PostgreSQL tunnel on 127.0.0.1:$LocalDbPort"
} else {
  Write-Host "Starting PostgreSQL tunnel: 127.0.0.1:$LocalDbPort -> ${dbHost}:${dbPort}"
  $tunnelProcess = Start-Process `
    -FilePath "python" `
    -ArgumentList @($tunnelScript, "--target-host", $dbHost, "--target-port", $dbPort, "--local-port", $LocalDbPort) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -PassThru

  Start-Sleep -Seconds 2
  if (-not (Test-PortOpen -HostName "127.0.0.1" -Port $LocalDbPort)) {
    if ($tunnelProcess) {
      Stop-Process -Id $tunnelProcess.Id -ErrorAction SilentlyContinue
    }
    throw "Local DB tunnel failed to start on 127.0.0.1:$LocalDbPort"
  }
}

Write-Host "Starting API with DB_HOST=127.0.0.1 DB_PORT=$LocalDbPort"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "$LocalDbPort"

try {
  Push-Location $apiDir
  node server.js
} finally {
  Pop-Location
  if ($tunnelProcess) {
    Stop-Process -Id $tunnelProcess.Id -ErrorAction SilentlyContinue
  }
}
