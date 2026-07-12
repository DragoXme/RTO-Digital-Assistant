@echo off
title RTO Digital Assistant Web Server
clear-host 2>nul || cls

echo =========================================================
echo              RTO Digital Assistant Server Launcher
echo =========================================================
echo.

:: Check for Python
where python >nul 2>&1
if %ERRORLEVEL% equ 0 goto :start_python

:: Check for Node/NPX
where npx >nul 2>&1
if %ERRORLEVEL% equ 0 goto :start_node

echo Error: Neither Python nor Node/NPX was found in your system's PATH.
echo Please install Python or Node.js to run this local mockup server.
echo.
pause
exit /b

:start_python
echo Starting local web server on port 8000 using Python...
start /b python -m http.server 8000 >nul 2>&1
goto :tunnel

:start_node
echo Starting local web server on port 8000 using Node/NPX...
start /b npx serve -p 8000 >nul 2>&1
goto :tunnel

:tunnel
:: Check if npx is available to launch localtunnel HTTPS tunnel
where npx >nul 2>&1
if %ERRORLEVEL% neq 0 goto :no_tunnel
echo.
echo Launching secure HTTPS public tunnel (localtunnel) for mobile microphone...
del localtunnel.txt >nul 2>&1
start /b npx --yes localtunnel --port 8000 > localtunnel.txt 2>&1

:no_tunnel
:: Wait 5 seconds to let the server start and localtunnel fetch public URL
ping 127.0.0.1 -n 6 >nul

echo.
echo ---------------------------------------------------------
echo Server is successfully running!
echo.
echo Access locally on this laptop:
echo   -^> http://localhost:8000
echo.
echo Access from your phone (when connected to Laptop's Hotspot):
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host '  -> http://' $_.IPAddress ':8000' -ForegroundColor Yellow }"
echo.
if not exist localtunnel.txt goto :no_tunnel_print
echo Access from ANY mobile network/Wi-Fi (HTTPS Secure Context):
powershell -NoProfile -Command "if (Test-Path localtunnel.txt) { $txt = Get-Content localtunnel.txt -Raw; if ($txt -match 'https://\S+') { Write-Host '  ->' $Matches[0] -ForegroundColor Green } else { Write-Host '  -> Tunnel starting, please restart script or open file' -ForegroundColor Cyan } }"
echo.
:no_tunnel_print
echo (Secure context is required for microphone/speech permission on phones)
echo ---------------------------------------------------------
echo.
echo -^> PRESS ANY KEY inside this window to STOP the server.
echo -^> CLOSING this window will also terminate the server.
echo.
pause >nul

echo.
echo Stopping web server running on port 8000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
del localtunnel.txt >nul 2>&1

echo Server stopped successfully. Goodbye!
ping 127.0.0.1 -n 2 >nul
exit
