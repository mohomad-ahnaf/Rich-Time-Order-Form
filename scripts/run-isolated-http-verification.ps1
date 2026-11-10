<#
Runs the authenticated HTTP verification suites against a disposable D1 state.
It never reads .dev.vars, uses only generated dummy values, and owns every
temporary process it starts.

Run from the project root:
  npm run verify:http:isolated
#>

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
# Wrangler 4.156.2 has no supported option to disable Worker file watching.
# Keep all runtime-generated config, D1 state, logs and probes outside the
# project so those writes cannot trigger a development reload.
$runtimeParent = Join-Path ([System.IO.Path]::GetTempPath()) 'rsk-isolated-http-verification-runs'
$runToken = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([Guid]::NewGuid().ToString('N'))"
$runtimeRoot = Join-Path $runtimeParent $runToken
$logsPath = Join-Path $runtimeRoot 'logs'
# Wrangler resolves the Worker entry through its config directory on Windows.
# Keep this tiny, write-once config in the project; D1 state, logs and probes
# remain outside the watcher in the system temp directory.
$configDirectory = Join-Path $projectRoot ('.cache\isolated-http-harness-config\' + $runToken)
$wranglerCli = Join-Path $projectRoot 'node_modules\wrangler\wrangler-dist\cli.js'
$tsxCli = Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs'
$dummyAdminPassword = 'Admin-isolated-http-2026!'
$workerProcess = $null
$failures = 0
$completedSuccessfully = $false
$workerEntry = (Join-Path $projectRoot 'src\worker.ts').Replace('\', '/')
$assetsDirectory = (Join-Path $projectRoot 'dist').Replace('\', '/')
$migrationsDirectory = (Join-Path $projectRoot 'migrations').Replace('\', '/')

function Find-FreePort {
  foreach ($port in 8810..8899) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return $port }
  }
  throw 'No free port was found in 8810–8899. Stop a disposable test process and retry.'
}

function New-PasswordHash {
  param([string]$password)
  $salt = [byte[]]::new(16)
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
  $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($password, $salt, 210000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try {
    $toUrlBase64 = { param([byte[]]$bytes) [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
    $saltText = & $toUrlBase64 $salt
    $hashText = & $toUrlBase64 $derive.GetBytes(32)
    return ('pbkdf2$210000${0}${1}' -f $saltText, $hashText)
  } finally { $derive.Dispose() }
}

function Wait-ForWorker {
  param([string]$baseUrl)
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $status = (& curl.exe --connect-timeout 2 --max-time 3 -s -o NUL -w "%{http_code}" "$baseUrl/api/session" 2>$null).Trim()
    if ($status -eq '401' -or $status -eq '200') { return }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  throw "Isolated Worker did not become ready within 30 seconds at $baseUrl. Check $runtimeRoot\worker.err.log."
}

function Invoke-Suite {
  param([string]$name, [string]$scriptPath, [int]$timeoutSeconds = 120)
  $safeName = $name -replace '[^A-Za-z0-9_-]', '_'
  $stdout = Join-Path $logsPath ($safeName + '.out.log')
  $stderr = Join-Path $logsPath ($safeName + '.err.log')
  $fullScriptPath = if ([IO.Path]::IsPathRooted($scriptPath)) { $scriptPath } else { Join-Path $projectRoot $scriptPath }
  # Start-Process otherwise splits the workspace path at "Rich Time" before
  # Node sees it, so no HTTP request ever reaches the isolated Worker.
  $nodeArguments = ('"{0}" "{1}"' -f $tsxCli, $fullScriptPath)
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = 'node.exe'; $startInfo.Arguments = $nodeArguments; $startInfo.WorkingDirectory = $projectRoot
  $startInfo.UseShellExecute = $false; $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
  $suiteProcess = [System.Diagnostics.Process]::new(); $suiteProcess.StartInfo = $startInfo
  if (-not $suiteProcess.Start()) { throw "Could not start $name." }
  if (-not $suiteProcess.WaitForExit($timeoutSeconds * 1000)) {
    # Windows PowerShell's .NET runtime does not expose Kill(entireProcessTree).
    # Suite commands launch node directly, so the supported single-process call
    # terminates the process this harness created without touching other workers.
    $suiteProcess.Kill(); $suiteProcess.WaitForExit()
    [IO.File]::WriteAllText($stdout, $suiteProcess.StandardOutput.ReadToEnd())
    [IO.File]::WriteAllText($stderr, $suiteProcess.StandardError.ReadToEnd())
    Write-Host "FAIL $name - timed out after $timeoutSeconds seconds."
    return $false
  }
  $exitCode = $suiteProcess.ExitCode
  [IO.File]::WriteAllText($stdout, $suiteProcess.StandardOutput.ReadToEnd())
  [IO.File]::WriteAllText($stderr, $suiteProcess.StandardError.ReadToEnd())
  $output = @((Get-Content $stdout -ErrorAction SilentlyContinue), (Get-Content $stderr -ErrorAction SilentlyContinue)) -join [Environment]::NewLine
  if ($null -eq $exitCode) { Write-Host "FAIL $name - exit status unavailable."; if ($output.Trim()) { Write-Host $output }; return $false }
  if ([int]$exitCode -eq 0) { Write-Host "PASS $name"; if ($output.Trim()) { Write-Host $output }; return $true }
  Write-Host "FAIL $name - exit $exitCode"; if ($output.Trim()) { Write-Host $output }; return $false
}

try {
  if (-not (Test-Path $wranglerCli) -or -not (Test-Path $tsxCli)) { throw 'Dependencies are missing. Run npm install first.' }
  $migrationFiles = Get-ChildItem -LiteralPath $migrationsDirectory -Filter '*.sql' -File -ErrorAction Stop
  if ($migrationFiles.Count -lt 17) { throw "Expected the project migrations at $migrationsDirectory, found $($migrationFiles.Count) SQL file(s)." }
  if ($env:SKIP_HARNESS_BUILD -eq '1') {
    Write-Warning 'Skipping production build because SKIP_HARNESS_BUILD=1. This run does not verify a fresh production build.'
  } else {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed; isolated verification was not started.' }
  }

  New-Item -ItemType Directory -Path $runtimeRoot,$logsPath,$configDirectory | Out-Null
  $probeSuccess = Join-Path $logsPath 'probe-exit-0.mjs'; Set-Content -LiteralPath $probeSuccess -Value 'process.exit(0)' -NoNewline
  $probeFailure = Join-Path $logsPath 'probe-exit-7.mjs'; Set-Content -LiteralPath $probeFailure -Value 'process.exit(7)' -NoNewline
  $probeTimeout = Join-Path $logsPath 'probe-timeout.mjs'; Set-Content -LiteralPath $probeTimeout -Value 'setTimeout(() => process.exit(0), 10000)' -NoNewline
  if (-not (Invoke-Suite 'Probe exit 0' $probeSuccess 5)) { throw 'Exit-0 process probe failed.' }
  if (Invoke-Suite 'Probe exit 7' $probeFailure 5) { throw 'Exit-7 process probe was incorrectly reported as PASS.' }
  if (Invoke-Suite 'Probe timeout' $probeTimeout 1) { throw 'Timeout process probe was incorrectly reported as PASS.' }
  $port = Find-FreePort
  $baseUrl = "http://127.0.0.1:$port"
  # Keep the live Wrangler config separate from suite logs. Wrangler watches
  # its config directory; changing a log must not reload the Worker mid-suite.
  $configPath = Join-Path $configDirectory 'wrangler.toml'
  # Wrangler 4.156.2 does not bind a cross-volume Windows persistence path
  # consistently between `d1 migrations apply` and `dev`. Keep this unique
  # per-run state beside the per-run config on the same F: volume.
  $statePath = Join-Path $configDirectory '.wrangler\state'
  # D1 local bindings require a real UUID. Symbolic IDs are not isolated by
  # Miniflare and can resolve to previously persisted test data.
  $databaseId = [Guid]::NewGuid().ToString()
  $databaseName = "rsk-isolated-$($runToken.Replace('-',''))"
  # Wrangler 4 resolves --persist-to with Node's path resolver. Forward-slash
  # absolute paths are required here on Windows; a backslash path is otherwise
  # treated as project-relative and can accidentally reuse local dev state.
  $statePathForWrangler = $statePath.Replace('\', '/')
  $xdgPath = Join-Path $runtimeRoot 'xdg'
  $hash = New-PasswordHash $dummyAdminPassword
  @"
name = "rsk-isolated-http-verification"
main = "$workerEntry"
compatibility_date = "2025-01-29"
assets = { directory = "$assetsDirectory", binding = "ASSETS", not_found_handling = "single-page-application" }

[vars]
OWNER_USERNAME = "Admin"
OWNER_PASSWORD_HASH = "$hash"
SESSION_SECRET = "isolated-http-verification-session-secret"
VAPID_PUBLIC_KEY = "test-only-public-key"
VAPID_PRIVATE_KEY = "test-only-private-key"
VAPID_SUBJECT = "mailto:tests@example.invalid"
PUSH_TEST_MODE = "1"

[triggers]
crons = ["*/5 * * * *", "0 4 * * *"]

[[d1_databases]]
binding = "DB"
database_name = "$databaseName"
database_id = "$databaseId"
migrations_dir = "$migrationsDirectory"
"@ | Set-Content -LiteralPath $configPath -NoNewline

  $env:XDG_CONFIG_HOME = $xdgPath
  $migrationLog = Join-Path $logsPath 'migrations.log'
  $migrationStarted = Get-Date
  & node.exe $wranglerCli d1 migrations apply $databaseName --config $configPath --local --persist-to $statePathForWrangler *> $migrationLog
  $migrationExitCode = $LASTEXITCODE
  $migrationDuration = [math]::Round(((Get-Date) - $migrationStarted).TotalSeconds, 2)
  Write-Host "Isolated migrations exit=$migrationExitCode duration=${migrationDuration}s log=$migrationLog"
  if ($migrationExitCode -ne 0) { throw "Applying isolated D1 migrations failed (exit $migrationExitCode). See $migrationLog." }
  $isolationMarker = [Guid]::NewGuid().ToString('N')
  $markerLog = Join-Path $logsPath 'marker-seed.log'
  & node.exe $wranglerCli d1 execute $databaseName --config $configPath --local --persist-to $statePathForWrangler --command "CREATE TABLE IF NOT EXISTS __isolated_harness_marker (id INTEGER PRIMARY KEY CHECK (id=1), marker TEXT NOT NULL); INSERT OR REPLACE INTO __isolated_harness_marker(id,marker) VALUES(1,'$isolationMarker');" *> $markerLog
  $markerSeedExitCode = $LASTEXITCODE
  if ($markerSeedExitCode -ne 0) { throw "Could not seed isolated marker (exit $markerSeedExitCode). See $markerLog." }

  $workerOut = Join-Path $logsPath 'worker.log'; $workerErr = Join-Path $logsPath 'worker.err.log'
  # Start node directly. The prior cmd.exe wrapper transformed the Windows
  # absolute --persist-to value, so the Worker silently used non-isolated
  # state while the migration command used the disposable state.
  $workerArguments = ('"{0}" dev --config "{1}" --local --persist-to="{2}" --port {3}' -f $wranglerCli, $configPath, $statePathForWrangler, $port)
  $workerProcess = Start-Process -FilePath 'node.exe' -ArgumentList $workerArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $workerOut -RedirectStandardError $workerErr -PassThru
  Wait-ForWorker $baseUrl
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { throw "No listener was found for the Worker port $port after readiness." }
  [pscustomobject]@{ worker_process_id = $workerProcess.Id; listener_process_id = $listener.OwningProcess; executable = 'node.exe'; arguments = $workerArguments; working_directory = $projectRoot; config_path = $configPath; database_name = $databaseName; database_id = $databaseId; persistence_path = $statePathForWrangler; base_url = $baseUrl } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logsPath 'worker-launch.json')
  Write-Host "Isolated Worker ready at $baseUrl"

  $env:TEST_BASE_URL = $baseUrl; $env:TEST_BASE = $baseUrl
  $env:TEST_ADMIN_USERNAME = 'Admin'; $env:TEST_ADMIN_PASSWORD = $dummyAdminPassword
  $env:TEST_ISOLATION_MARKER = $isolationMarker
  if (-not (Invoke-Suite 'Isolated database marker' 'scripts/verify-isolated-marker.ts' 30)) { throw "Worker did not bind the seeded isolated D1 database. See $runtimeRoot for logs." }
  $allSuites = @(
    @{ Name = 'Jobs and checklist authorization'; Script = 'scripts/verify-jobs-isolated.ts' },
    @{ Name = 'Deleted Rep assignment denial'; Script = 'scripts/verify-job-deleted-rep-isolated.ts' },
    @{ Name = 'Rep order visibility'; Script = 'scripts/verify-rep-order-visibility-isolated.ts' },
    @{ Name = 'Order prices and PDF header'; Script = 'scripts/verify-order-prices-pdf-header-isolated.ts' },
    @{ Name = 'Notification inbox and recipient rules'; Script = 'scripts/verify-notifications-isolated.ts' },
    @{ Name = 'Mock push outbox'; Script = 'scripts/verify-push-outbox-isolated.ts' }
  )
  $requestedSuites = @($env:HARNESS_SUITES -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $suites = if ($requestedSuites.Count) { @($allSuites | Where-Object { $requestedSuites -contains $_.Name }) } else { $allSuites }
  if ($requestedSuites.Count -and $suites.Count -ne $requestedSuites.Count) { throw "Unknown HARNESS_SUITES value. Valid names: $($allSuites.Name -join ', ')" }
  foreach ($suite in $suites) {
    # Each suite receives a UUID; fixture helpers may truncate it while still
    # retaining entropy within the API's username length limit.
    $env:TEST_RUN_ID = [Guid]::NewGuid().ToString('N')
    if (-not (Invoke-Suite $suite.Name $suite.Script)) { $failures += 1 }
  }
  if ($failures) { throw "$failures isolated HTTP suite(s) failed. See $runtimeRoot for logs." }
  $completedSuccessfully = $true
  Write-Host 'PASS all isolated HTTP suites.'
}
finally {
  if ($workerProcess -and -not $workerProcess.HasExited) {
    & taskkill.exe /PID $workerProcess.Id /T /F | Out-Null
    $deadline = (Get-Date).AddSeconds(10)
    do {
      $workerProcess.Refresh()
      if ($workerProcess.HasExited) { break }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if (-not $workerProcess.HasExited) {
      Write-Warning "The owned isolated Worker process did not exit within 10 seconds. Preserving $runtimeRoot."
      $completedSuccessfully = $false
    }
  }
  Remove-Item Env:TEST_BASE_URL,Env:TEST_BASE,Env:TEST_ADMIN_USERNAME,Env:TEST_ADMIN_PASSWORD,Env:TEST_ISOLATION_MARKER,Env:TEST_RUN_ID -ErrorAction SilentlyContinue
  if ($completedSuccessfully -and (Test-Path $runtimeRoot)) {
    $removed = $false
    foreach ($attempt in 1..5) {
      try { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force -ErrorAction Stop; $removed = $true; break }
      catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $removed) { Write-Warning "Could not remove isolated run directory $runtimeRoot after its owned Worker exited. It was preserved for inspection." }
  } elseif (Test-Path $runtimeRoot) {
    Write-Warning "Isolated verification failed. Preserved logs and state at $runtimeRoot."
  }
  if ($completedSuccessfully -and (Test-Path $configDirectory)) {
    try { Remove-Item -LiteralPath $configDirectory -Recurse -Force -ErrorAction Stop }
    catch { Write-Warning "Could not remove isolated Worker config directory $configDirectory. It was preserved for inspection." }
  } elseif (Test-Path $configDirectory) {
    Write-Warning "Isolated verification failed. Preserved generated Worker config at $configDirectory."
  }
}

