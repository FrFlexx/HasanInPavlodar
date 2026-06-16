$ErrorActionPreference = "Stop"

$certDir = Join-Path $PSScriptRoot "cert"
$certPath = Join-Path $certDir "cert.pem"
$pfxPath = Join-Path $certDir "noise-race.pfx"
$password = "noise-race"

if (!(Test-Path $certDir)) {
  New-Item -ItemType Directory -Path $certDir | Out-Null
}

if (Test-Path $pfxPath) {
  Write-Host "Certificate already exists: $certDir"
  exit 0
}

$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$hash = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=Hasan in Pavlodar Local", $rsa, $hash, $padding)

$san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName("localhost")
$san.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))

$ipLines = ipconfig | Select-String -Pattern "IPv4"
foreach ($line in $ipLines) {
  $ip = ($line.ToString() -split ":")[-1].Trim()
  if ($ip -match "^\d+\.\d+\.\d+\.\d+$") {
    $san.AddIpAddress([System.Net.IPAddress]::Parse($ip))
  }
}

$request.CertificateExtensions.Add($san.Build())
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))

$cert = $request.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddYears(1))

function ConvertTo-Pem($label, [byte[]] $bytes) {
  $base64 = [Convert]::ToBase64String($bytes)
  $lines = for ($i = 0; $i -lt $base64.Length; $i += 64) {
    $base64.Substring($i, [Math]::Min(64, $base64.Length - $i))
  }
  "-----BEGIN $label-----`n$($lines -join "`n")`n-----END $label-----`n"
}

[IO.File]::WriteAllText($certPath, (ConvertTo-Pem "CERTIFICATE" $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)))
[IO.File]::WriteAllBytes($pfxPath, $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password))

Write-Host "Created HTTPS certificate:"
Write-Host "  $certPath"
Write-Host "  $pfxPath"
