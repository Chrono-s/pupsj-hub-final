@echo off
title PUPSJ HUB - Stopping Services
echo Stopping PUPSJ HUB services...

:: Close named windows
taskkill /F /FI "WINDOWTITLE eq PUPSJ HUB Server" /T >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq PUPSJ HUB AI"     /T >nul 2>&1

:: Free port 3000 (Node)
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":3000 "') do (
    taskkill /F /PID %%p >nul 2>&1
)
:: Free port 8000 (AI sidecar)
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":8000 "') do (
    taskkill /F /PID %%p >nul 2>&1
)

echo Done. All services stopped.
timeout /t 2 /nobreak >nul
