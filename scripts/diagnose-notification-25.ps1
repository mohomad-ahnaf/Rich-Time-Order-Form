$base = 'http://127.0.0.1:8787'
$username = Read-Host 'Rep username'
$securePassword = Read-Host 'Rep password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  try {
    $login = Invoke-WebRequest -UseBasicParsing -WebSession $webSession -Method POST -ContentType 'application/json' -Body (@{ username=$username; password=$password } | ConvertTo-Json) "$base/api/login" -ErrorAction Stop
  } catch {
    $response = $_.Exception.Response
    $status = if ($response) { [int]$response.StatusCode } else { 'connection failed' }
    throw "Login failed ($status). Check the Worker is running and the Rep credentials are correct."
  }
  if ($login.StatusCode -ne 204) { throw "Login failed (HTTP $($login.StatusCode))." }
  try {
    $session = Invoke-RestMethod -WebSession $webSession "$base/api/session" -ErrorAction Stop
  } catch { throw "Login succeeded but the session cookie was not accepted. Keep the same $base origin and check the Worker cookie settings." }
  $inbox = Invoke-RestMethod -WebSession $webSession "$base/api/notifications?limit=50" -ErrorAction Stop
  $item = @($inbox.notifications | Where-Object { $_.id -eq 25 })
  $delivery = if ($item) { Invoke-RestMethod -WebSession $webSession "$base/api/notifications/25/delivery" -ErrorAction Stop } else { $null }
  [pscustomobject]@{ userId=$session.userId; username=$session.username; role=$session.role; notification25Present=[bool]$item; notification25=$item; delivery=$delivery } | ConvertTo-Json -Depth 6
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable password -ErrorAction SilentlyContinue
}
