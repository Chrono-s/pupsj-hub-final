@echo off
title PUPSJ HUB Launcher
cd /d "%~dp0"
set "ROOT=%cd%"

echo ================================================
echo   PUPSJ HUB - Starting All Services
echo ================================================
echo.

set "APP_PORT=3000"
set "AI_PORT=8001"

:: ── Kill any leftover instances from a previous run ──────────────────────────
echo [1/3] Cleaning up old processes...
taskkill /F /FI "WINDOWTITLE eq PUPSJ HUB Server" /T >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq PUPSJ HUB AI"     /T >nul 2>&1
:: Free configured AI port if something is still holding it
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":%AI_PORT% "') do (
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: ── Node.js server ────────────────────────────────────────────────────────────
echo [2/3] Starting Node.js server  (port %APP_PORT%)...
start "PUPSJ HUB Server" /min /d "%ROOT%" cmd /k "node src/server.js"
timeout /t 2 /nobreak >nul

:: ── Python AI sidecar ─────────────────────────────────────────────────────────
echo [3/3] Starting AI sidecar      (port %AI_PORT%)...
start "PUPSJ HUB AI" /min /d "%ROOT%" cmd /k "node scripts\start-ai.js"

echo.
echo ================================================
echo   Both services are running (minimized).
echo.
echo   App  ->  http://localhost:%APP_PORT%
echo   AI   ->  http://localhost:%AI_PORT%
echo.
echo   To stop everything, run:  stop.bat
echo ================================================
echo.
timeout /t 4 /nobreak >nul
