<#!
Creates one visible local ADMIN account named Developer.

This script deliberately refuses to alter any existing Developer account. Its
password is read as a SecureString and is never printed or written to Git.
Run only from the project root:
  powershell -ExecutionPolicy Bypass -File scripts/create-local-developer-admin.ps1
#>

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:XDG_CONFIG_HOME = Join-Path $projectRoot '.wrangler\xdg'
$wrangler = Join-Path $projectRoot 'node_modules\wrangler\wrangler-dist\cli.js'

function Invoke-LocalD1Json([string]$Sql) {
  $result = & node $wrangler d1 execute rich-time-db --local --persist-to .wrangler/state --command $Sql --json
  if ($LASTEXITCODE -ne 0) { throw 'Local D1 command failed.' }
  return ($result | ConvertFrom-Json)
}

$existing = Invoke-LocalD1Json "SELECT id FROM users WHERE username_normalized='developer' LIMIT 1;"
if ($existing[0].results.Count -gt 0) {
  throw 'A Developer account already exists. It was not changed.'
}

$securePassword = Read-Host 'Password for Developer' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$sqlPath = $null
try {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ([string]::IsNullOrEmpty($password) -or $password.Length -gt 256) {
    throw 'Password must contain 1 to 256 characters.'
  }

  $salt = [byte[]]::new(16)
  $rng = [Security.Cryptography.RNGCryptoServiceProvider]::new()
  try { $rng.GetBytes($salt) } finally { $rng.Dispose() }
  $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($password, $salt, 210000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try {
    $hash = [Convert]::ToBase64String($derive.GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')
  } finally { $derive.Dispose() }
  $saltValue = [Convert]::ToBase64String($salt).TrimEnd('=').Replace('+','-').Replace('/','_')
  $passwordHash = "pbkdf2`$210000`$$saltValue`$$hash"

  $sqlPath = Join-Path $projectRoot '.local-backups\create-developer-admin.generated.sql'
  @"
INSERT INTO users(username,username_normalized,password_hash,role,role_v2,active)
SELECT 'Developer','developer','$passwordHash','ADMIN','ADMIN',1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username_normalized='developer');
"@ | Set-Content -LiteralPath $sqlPath -NoNewline

  & node $wrangler d1 execute rich-time-db --local --persist-to .wrangler/state --file $sqlPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Local Developer account creation failed.' }
  $created = Invoke-LocalD1Json "SELECT id,username,COALESCE(role_v2,role) AS role,active FROM users WHERE username_normalized='developer';"
  if ($created[0].results.Count -ne 1 -or $created[0].results[0].role -ne 'ADMIN' -or $created[0].results[0].active -ne 1) {
    throw 'Developer account verification failed.'
  }
  Write-Host 'Developer ADMIN account created and verified. Password was not displayed.'
} finally {
  if ($sqlPath -and (Test-Path -LiteralPath $sqlPath)) { Remove-Item -LiteralPath $sqlPath -Force }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}
