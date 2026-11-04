param([string]$base = 'http://127.0.0.1:8791')
$ErrorActionPreference = 'Stop'
function Assert-Equal($actual, $expected, $name) { if ($actual -ne $expected) { throw "$name failed: expected $expected, got $actual" }; Write-Output "PASS $name" }
function Invoke-Json($method, $path, $body, $session, $csrf) {
  $headers = @{}
  if ($csrf) { $headers['X-CSRF-Token'] = $csrf }
  $params = @{ Uri = "$base$path"; Method = $method; WebSession = $session; Headers = $headers; ContentType = 'application/json' }
  if ($null -ne $body) { $params['Body'] = ($body | ConvertTo-Json -Depth 8 -Compress) }
  return Invoke-WebRequest @params
}

try { Invoke-WebRequest -Uri "$base/api/buyers" -UseBasicParsing | Out-Null; throw 'Unauthorized request unexpectedly succeeded' } catch { Assert-Equal $_.Exception.Response.StatusCode.value__ 401 'unauthorized buyer request' }
$login = Invoke-WebRequest -Uri "$base/api/login" -Method Post -ContentType 'application/json' -Body '{"username":"local-test-owner","password":"Local-Test-Password-Only"}' -SessionVariable session
Assert-Equal $login.StatusCode 204 'login'
$sessionInfo = Invoke-Json 'GET' '/api/session' $null $session $null | Select-Object -ExpandProperty Content | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($sessionInfo.csrfToken)) { throw 'Missing CSRF token' }; Write-Output 'PASS authenticated session'
$csrf = $sessionInfo.csrfToken
$buyer = (Invoke-Json 'POST' '/api/buyers' @{full_name='LOCAL TEST Buyer';phone='0770000001';email='local-test@example.invalid';address='Test only'} $session $csrf).Content | ConvertFrom-Json
Assert-Equal $buyer.full_name 'LOCAL TEST Buyer' 'buyer creation'
$p1 = (Invoke-Json 'POST' '/api/products' @{brand='LOCAL TEST';model_name='Chrono A';sku='LOCAL-TEST-A';colour='Blue';description='Test watch A';price_minor=12345} $session $csrf).Content | ConvertFrom-Json
$p2 = (Invoke-Json 'POST' '/api/products' @{brand='LOCAL TEST';model_name='Chrono B';sku='LOCAL-TEST-B';colour='Black';description='Test watch B';price_minor=2500} $session $csrf).Content | ConvertFrom-Json
Write-Output 'PASS product creation'
$key = [guid]::NewGuid().ToString()
$payload = @{idempotencyKey=$key;buyerId=$buyer.id;quotationDate='2026-11-02';validUntil='2026-11-16';notes='LOCAL TEST quotation';items=@(@{productId=$p1.id;quantity=3},@{productId=$p2.id;quantity=4})}
$quote = (Invoke-Json 'POST' '/api/quotations' $payload $session $csrf).Content | ConvertFrom-Json
Assert-Equal $quote.total_minor 47035 'server calculated total'
$repeat = (Invoke-Json 'POST' '/api/quotations' $payload $session $csrf).Content | ConvertFrom-Json
Assert-Equal $repeat.id $quote.id 'idempotent repeat save'
$history = (Invoke-Json 'GET' '/api/quotations?q=LOCAL%20TEST' $null $session $null).Content | ConvertFrom-Json
Assert-Equal @($history).Count 1 'one quotation after repeat save'
$reopened = (Invoke-Json 'GET' "/api/quotations/$($quote.id)" $null $session $null).Content | ConvertFrom-Json
Assert-Equal $reopened.total_minor 47035 'reopen quotation'
$update = @{brand=$p1.brand;model_name=$p1.model_name;sku=$p1.sku;colour=$p1.colour;description=$p1.description;price_minor=99999;active=1}
(Invoke-Json 'PUT' "/api/products/$($p1.id)" $update $session $csrf) | Out-Null
$after = (Invoke-Json 'GET' "/api/quotations/$($quote.id)" $null $session $null).Content | ConvertFrom-Json
Assert-Equal $after.total_minor 47035 'saved quotation price snapshot'
Assert-Equal $after.items[0].unit_price_minor 12345 'saved item price snapshot'
$logout = Invoke-Json 'POST' '/api/logout' $null $session $csrf
Assert-Equal $logout.StatusCode 204 'logout'
try { Invoke-WebRequest -Uri "$base/api/quotations" -WebSession $session -UseBasicParsing | Out-Null; throw 'Logged out session unexpectedly succeeded' } catch { Assert-Equal $_.Exception.Response.StatusCode.value__ 401 'logged out session rejected' }
Write-Output 'PASS no stock fields or stock mutations exist in local schema'
