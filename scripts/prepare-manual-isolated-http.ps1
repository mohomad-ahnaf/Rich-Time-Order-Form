$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$wrangler = Join-Path $root 'node_modules\wrangler\wrangler-dist\cli.js'
$token = [Guid]::NewGuid().ToString('N')
$run = Join-Path $root ('.cache\manual-isolated-http\' + $token)
$logs = Join-Path $run 'logs'; $state = Join-Path $run '.wrangler\state'; $config = Join-Path $run 'wrangler.toml'
$databaseName = "manual-isolated-$token"; $databaseId = [Guid]::NewGuid().ToString(); $marker = [Guid]::NewGuid().ToString('N'); $port = 8820
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is already in use. Do not reuse this run." }
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$salt=[byte[]]::new(16); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt); $derive=[Security.Cryptography.Rfc2898DeriveBytes]::new('Manual-isolated-dummy-password!',$salt,210000,[Security.Cryptography.HashAlgorithmName]::SHA256)
try { $enc={param($v)[Convert]::ToBase64String($v).TrimEnd('=').Replace('+','-').Replace('/','_')}; $hash='pbkdf2$210000$'+(& $enc $salt)+'$'+(& $enc $derive.GetBytes(32)) } finally { $derive.Dispose() }
$entry=(Join-Path $root 'src\worker.ts').Replace('\','/'); $assets=(Join-Path $root 'dist').Replace('\','/'); $migrations=(Join-Path $root 'migrations').Replace('\','/'); $stateArg=$state.Replace('\','/')
@"
name = "$databaseName"
main = "$entry"
compatibility_date = "2025-01-29"
assets = { directory = "$assets", binding = "ASSETS", not_found_handling = "single-page-application" }
[vars]
OWNER_USERNAME = "Admin"
OWNER_PASSWORD_HASH = "$hash"
SESSION_SECRET = "manual-isolated-dummy-session-secret"
VAPID_PUBLIC_KEY = "test-only-public-key"
VAPID_PRIVATE_KEY = "test-only-private-key"
VAPID_SUBJECT = "mailto:tests@example.invalid"
PUSH_TEST_MODE = "1"
[[d1_databases]]
binding = "DB"
database_name = "$databaseName"
database_id = "$databaseId"
migrations_dir = "$migrations"
"@ | Set-Content $config -NoNewline
& node.exe $wrangler d1 migrations apply $databaseName --config $config --local --persist-to $stateArg *> (Join-Path $logs 'migrations.log'); if($LASTEXITCODE -ne 0){throw "Migration exit $LASTEXITCODE"}
$sql="CREATE TABLE __isolated_harness_marker (id INTEGER PRIMARY KEY CHECK(id=1), marker TEXT NOT NULL); INSERT INTO __isolated_harness_marker VALUES(1,'$marker'); INSERT INTO users(username,username_normalized,password_hash,role,role_v2,active) VALUES('Admin','admin','$hash','ADMIN','ADMIN',1);"
& node.exe $wrangler d1 execute $databaseName --config $config --local --persist-to $stateArg --command $sql *> (Join-Path $logs 'seed.log'); if($LASTEXITCODE -ne 0){throw "Seed exit $LASTEXITCODE"}
[pscustomobject]@{base_url="http://127.0.0.1:$port";port=$port;config_path=$config;state_path=$stateArg;database_name=$databaseName;database_id=$databaseId;marker=$marker;logs_path=$logs;admin_username='Admin';admin_password='Manual-isolated-dummy-password!'} | ConvertTo-Json | Set-Content (Join-Path $run 'run.json')
Write-Output (Join-Path $run 'run.json')
