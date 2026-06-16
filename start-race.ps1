$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

& (Join-Path $PSScriptRoot "make-cert.ps1")

$bundledNode = "C:\Users\FLEXX\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$nodeExe = if (Test-Path $bundledNode) { $bundledNode } else { "node" }

Start-Process -FilePath $nodeExe -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Normal
Start-Sleep -Seconds 1
Start-Process "http://127.0.0.1:3000"

Write-Host ""
Write-Host "Hasan in Pavlodar запущен."
Write-Host "Большой экран: http://127.0.0.1:3000"
Write-Host "Телефоны: используйте QR-код на большом экране."
Write-Host ""
