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
del localtunnel.txt >nul 2>&1

echo.
echo ---------------------------------------------------------
echo Servers are successfully running!
echo.
echo  Front-end Link (Open in browser):
echo    http://localhost:8000
echo.
echo  Chatbot API Link:
echo    http://localhost:5000
echo ---------------------------------------------------------
echo.
echo -^> Press ANY KEY in this window to stop and close.
pause >nul

echo.
echo Stopping web servers running on ports 8000 and 5000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

exit
