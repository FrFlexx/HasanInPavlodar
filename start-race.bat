@echo off
setlocal
cd /d "%~dp0"

powershell -ExecutionPolicy Bypass -File "%~dp0make-cert.ps1"

set "BUNDLED_NODE=C:\Users\FLEXX\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED_NODE%" (
  set "NODE_EXE=%BUNDLED_NODE%"
) else (
  set "NODE_EXE=node"
)

start "Hasan in Pavlodar Server" "%NODE_EXE%" server.js
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:3000"

echo.
echo Hasan in Pavlodar запущен.
echo Большой экран: http://127.0.0.1:3000
echo Телефоны: используйте HTTPS QR-код на большом экране.
echo.
pause
