param([string]$Path = '.dev.vars')

$username = Read-Host 'Owner username'
if ([string]::IsNullOrWhiteSpace($username)) { throw 'A username is required.' }
$securePassword = Read-Host 'Owner password' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  if ($password.Length -lt 12) { throw 'Use a password of at least 12 characters.' }
  $saltBytes = [byte[]]::new(16)
  $rng = [Security.Cryptography.RNGCryptoServiceProvider]::new()
  $rng.GetBytes($saltBytes)
  $iterations = 210000
  $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($password, $saltBytes, $iterations, [Security.Cryptography.HashAlgorithmName]::SHA256)
  $hashBytes = $derive.GetBytes(32)
  $toUrlBase64 = { param([byte[]]$bytes) [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
  $passwordHash = "pbkdf2`$$iterations`$$( & $toUrlBase64 $saltBytes )`$$( & $toUrlBase64 $hashBytes )"
  $sessionBytes = [byte[]]::new(32)
  $rng.GetBytes($sessionBytes)
  $sessionSecret = & $toUrlBase64 $sessionBytes

  $values = @{}
  if (Test-Path -LiteralPath $Path) {
    Get-Content -LiteralPath $Path | ForEach-Object {
      if ($_ -match '^([^#=]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
    }
  }
  $values['OWNER_USERNAME'] = $username
  $values['OWNER_PASSWORD_HASH'] = $passwordHash
  if (-not $values.ContainsKey('SESSION_SECRET') -or [string]::IsNullOrWhiteSpace($values['SESSION_SECRET'])) { $values['SESSION_SECRET'] = $sessionSecret }
  @('OWNER_USERNAME','OWNER_PASSWORD_HASH','SESSION_SECRET') | ForEach-Object { "$_=$($values[$_])" } | Set-Content -LiteralPath $Path -NoNewline:$false
  Write-Host 'Local credentials saved to .dev.vars. Secrets were not displayed.'
} finally {
  if ($null -ne $rng) { $rng.Dispose() }
  if ($passwordPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
}
