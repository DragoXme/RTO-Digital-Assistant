@echo off
title RTO Digital Assistant Web Server
clear-host 2>nul || cls

echo =========================================================
echo              RTO Digital Assistant Launcher
echo =========================================================
echo.

:: Check for Python
where python >nul 2>&1
if %ERRORLEVEL% equ 0 goto :start_python

:: Check for Node/NPX
where npx >nul 2>&1
if %ERRORLEVEL% equ 0 goto :start_node

echo Error: Neither Python nor Node/NPX was found in your system's PATH.
echo Please install Python or Node.js to run this local mockup.
echo.
pause
exit /b

:start_python
echo Starting local web server on port 8000 using Python...
start /b python -m http.server 8000 >nul 2>&1
echo Starting Flask chatbot backend on port 5000 (Console logs active)...
if exist backend\venv\Scripts\python.exe (
    start /b cmd /c "cd backend && venv\Scripts\python app.py"
) else (
    start /b cmd /c "cd backend && python app.py"
)
goto :started

:start_node
echo Starting local web server on port 8000 using Node/NPX...
start /b npx serve -p 8000 >nul 2>&1
echo Starting Flask chatbot backend on port 5000 (Console logs active)...
if exist backend\venv\Scripts\python.exe (
    start /b cmd /c "cd backend && venv\Scripts\python app.py"
) else (
    start /b cmd /c "cd backend && python app.py"
)
goto :started

:started
:: Wait 3 seconds to let both servers boot
ping 127.0.0.1 -n 4 >nul

:: Clean up old files
del localtunnel_fe.txt >nul 2>&1
del localtunnel_be.txt >nul 2>&1

echo.
echo Starting Localtunnel to generate public web URLs...
start /b cmd /c "npx --yes localtunnel --port 8000 > localtunnel_fe.txt 2>&1"
start /b cmd /c "npx --yes localtunnel --port 5000 > localtunnel_be.txt 2>&1"

:: Wait 4 seconds for localtunnel to acquire URLs
ping 127.0.0.1 -n 5 >nul

:: Automatically extract backend tunnel URL and write backend_url.js for frontend auto-discovery
if exist backend\venv\Scripts\python.exe (
    backend\venv\Scripts\python generate_tunnel_config.py >nul 2>&1
) else (
    python generate_tunnel_config.py >nul 2>&1
)

echo.
echo =========================================================
echo SERVERS AND PUBLIC TUNNELS ARE LIVE!
echo =========================================================
echo.
echo  1. Local Link (Open on your laptop):
echo     http://localhost:8000
echo.
echo  2. Local Backend API Link:
echo     http://localhost:5000
echo.
echo ---------------------------------------------------------
echo  3. PUBLIC INTERNET LINK (Share with anyone / test on phone):
if exist localtunnel_fe.txt (
    type localtunnel_fe.txt
) else (
    echo    (Connecting localtunnel...)
)
echo.
echo  4. PUBLIC BACKEND API LINK:
if exist localtunnel_be.txt (
    type localtunnel_be.txt
) else (
    echo    (Connecting localtunnel...)
)
echo ---------------------------------------------------------
echo.
echo -^> Press ANY KEY in this window to stop all servers and close tunnels.
pause >nul

echo.
echo Stopping web servers and localtunnels...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

del localtunnel_fe.txt >nul 2>&1
del localtunnel_be.txt >nul 2>&1
python generate_tunnel_config.py >nul 2>&1
exit
