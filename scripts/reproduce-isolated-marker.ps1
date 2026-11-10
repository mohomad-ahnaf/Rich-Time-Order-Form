<#
Minimal, disposable D1 identity reproduction. It never loads .dev.vars,
never touches the main Worker/state, and preserves its run directory on exit.
Run: powershell -ExecutionPolicy Bypass -File scripts/reproduce-isolated-marker.ps1
#>
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$wranglerCli = Join-Path $projectRoot 'node_modules\wrangler\wrangler-dist\cli.js'
$tsxCli = Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs'
$token = "marker-$([Guid]::NewGuid().ToString('N'))"
$configDir = Join-Path $projectRoot ('.cache\isolated-marker-reproduction\' + $token)
$runDir = Join-Path ([IO.Path]::GetTempPath()) ('rsk-isolated-marker-runs\' + $token)
$logDir = Join-Path $runDir 'logs'
$xdgDir = Join-Path $runDir 'xdg'
$stateDir = Join-Path $configDir '.wrangler\state'
$configPath = Join-Path $configDir 'wrangler.toml'
$marker = [Guid]::NewGuid().ToString('N')
$databaseId = [Guid]::NewGuid().ToString()
$databaseName = "rsk-marker-$($token.Replace('-',''))"
$worker = $null

function Find-FreePort {
  foreach ($port in 8820..8899) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { return $port }
  }
  throw 'No free marker-reproduction port in 8820-8899.'
}

function New-PasswordHash([string]$password) {
  $salt = [byte[]]::new(16); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
  $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($password, $salt, 210000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try {
    $encode = { param([byte[]]$bytes) [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
    return ('pbkdf2$210000${0}${1}' -f (& $encode $salt), (& $encode $derive.GetBytes(32)))
  } finally { $derive.Dispose() }
}

try {
  foreach ($path in @($configDir, $logDir, $xdgDir)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
  $env:XDG_CONFIG_HOME = $xdgDir
  $port = Find-FreePort; $baseUrl = "http://127.0.0.1:$port"
  $workerEntry = (Join-Path $projectRoot 'src\worker.ts').Replace('\','/')
  $assets = (Join-Path $projectRoot 'dist').Replace('\','/')
  $migrations = (Join-Path $projectRoot 'migrations').Replace('\','/')
  $state = $stateDir.Replace('\','/')
  @"
name = "$databaseName"
main = "$workerEntry"
compatibility_date = "2025-01-29"
assets = { directory = "$assets", binding = "ASSETS", not_found_handling = "single-page-application" }
[vars]
OWNER_USERNAME = "Admin"
OWNER_PASSWORD_HASH = "$(New-PasswordHash 'Marker-only-dummy-password!')"
SESSION_SECRET = "marker-only-dummy-session-secret"
VAPID_PUBLIC_KEY = "test-only-public-key"
VAPID_PRIVATE_KEY = "test-only-private-key"
VAPID_SUBJECT = "mailto:tests@example.invalid"
PUSH_TEST_MODE = "1"
[[d1_databases]]
binding = "DB"
database_name = "$databaseName"
database_id = "$databaseId"
migrations_dir = "$migrations"
"@ | Set-Content -LiteralPath $configPath -NoNewline

  $migrationLog = Join-Path $logDir 'migrations.log'
  & node.exe $wranglerCli d1 migrations apply $databaseName --config $configPath --local --persist-to $state *> $migrationLog
  $migrationExit = $LASTEXITCODE
  if ($migrationExit -ne 0) { throw "Migrations failed with exit $migrationExit. See $migrationLog" }
  $seedLog = Join-Path $logDir 'marker-seed.log'
  & node.exe $wranglerCli d1 execute $databaseName --config $configPath --local --persist-to $state --command "CREATE TABLE IF NOT EXISTS __isolated_harness_marker (id INTEGER PRIMARY KEY CHECK(id=1), marker TEXT NOT NULL); INSERT OR REPLACE INTO __isolated_harness_marker(id,marker) VALUES(1,'$marker');" *> $seedLog
  $seedExit = $LASTEXITCODE
  if ($seedExit -ne 0) { throw "Marker seed failed with exit $seedExit. See $seedLog" }

  $workerOut = Join-Path $logDir 'worker.out.log'; $workerErr = Join-Path $logDir 'worker.err.log'
  $args = ('"{0}" dev --config "{1}" --local --persist-to="{2}" --port {3}' -f $wranglerCli, $configPath, $state, $port)
  $worker = Start-Process node.exe -ArgumentList $args -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $workerOut -RedirectStandardError $workerErr -PassThru
  [pscustomobject]@{ phase='started'; worker_process_id=$worker.Id; executable='node.exe'; arguments=$args; working_directory=$projectRoot; config_path=$configPath; database_name=$databaseName; database_id=$databaseId; persistence_path=$state; port=$port; expected_marker=$marker } | ConvertTo-Json | Set-Content (Join-Path $logDir 'launch.json')

  $deadline=(Get-Date).AddSeconds(30); do { $status=(& curl.exe --connect-timeout 2 --max-time 3 -s -o NUL -w '%{http_code}' "$baseUrl/api/session" 2>$null).Trim(); if($status -in @('200','401')){break}; Start-Sleep -Milliseconds 250 } while((Get-Date)-lt $deadline)
  if($status -notin @('200','401')) { throw "Worker did not become ready at $baseUrl" }
  $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if(-not $listener -or $listener.OwningProcess -ne $worker.Id) { throw "Listener identity mismatch: expected worker PID $($worker.Id), observed $($listener.OwningProcess)" }

  $env:TEST_BASE_URL=$baseUrl; $env:TEST_ADMIN_USERNAME='Admin'; $env:TEST_ADMIN_PASSWORD='Marker-only-dummy-password!'; $env:TEST_ISOLATION_MARKER=$marker
  & node.exe $tsxCli (Join-Path $projectRoot 'scripts\verify-isolated-marker.ts') *> (Join-Path $logDir 'marker-verify.log')
  $verifyExit=$LASTEXITCODE
  if($verifyExit -ne 0){throw "Marker verification failed with exit $verifyExit. See $(Join-Path $logDir 'marker-verify.log')"}
  Write-Output "PASS marker identity. Logs: $logDir"
} catch {
  Write-Error $_
  Write-Output "FAIL marker identity. Logs retained: $logDir"
  exit 1
} finally {
  Remove-Item Env:TEST_BASE_URL,Env:TEST_ADMIN_USERNAME,Env:TEST_ADMIN_PASSWORD,Env:TEST_ISOLATION_MARKER -ErrorAction SilentlyContinue
  if($worker -and -not $worker.HasExited){ & taskkill.exe /PID $worker.Id /T /F | Out-Null; $worker.WaitForExit(5000)|Out-Null }
}
