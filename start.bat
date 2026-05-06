@echo off
title PUPSJ HUB Launcher
cd /d "%~dp0"
set "ROOT=%cd%"

echo ================================================
echo   PUPSJ HUB - Starting All Services
echo ================================================
echo.

:: ── Kill any leftover instances from a previous run ──────────────────────────
echo [1/3] Cleaning up old processes...
taskkill /F /FI "WINDOWTITLE eq PUPSJ HUB Server" /T >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq PUPSJ HUB AI"     /T >nul 2>&1
:: Free port 8000 if something is still holding it
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":8000 "') do (
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: ── Node.js server ────────────────────────────────────────────────────────────
echo [2/3] Starting Node.js server  (port 3000)...
start "PUPSJ HUB Server" /min /d "%ROOT%" cmd /k "node src/server.js"
timeout /t 2 /nobreak >nul

:: ── Python AI sidecar ─────────────────────────────────────────────────────────
echo [3/3] Starting AI sidecar      (port 8000)...
start "PUPSJ HUB AI" /min /d "%ROOT%" cmd /k "ai\.venv\Scripts\python.exe -m uvicorn ai.api:app --host 0.0.0.0 --port 8000"

echo.
echo ================================================
echo   Both services are running (minimized).
echo.
echo   App  ->  http://localhost:3000
echo   AI   ->  http://localhost:8000
echo.
echo   To stop everything, run:  stop.bat
echo ================================================
echo.
timeout /t 4 /nobreak >nul
