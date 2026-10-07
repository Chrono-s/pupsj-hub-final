@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   PUPSJ HUB - Automated Python AI Environment Setup
echo ========================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set PY_CMD=python
    goto FOUND_PYTHON
)

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set PY_CMD=py
    goto FOUND_PYTHON
)

echo [ERROR] Python was not found on this computer.
echo Please install Python 3.10, 3.11, 3.12, or 3.13 from https://www.python.org/
echo (Make sure to check "Add Python to PATH" during installation)
echo.
pause
exit /b 1

:FOUND_PYTHON
echo [1/3] Found Python: %PY_CMD%
%PY_CMD% --version
echo.

echo [2/3] Creating virtual environment in ai\.venv...
if not exist "ai" mkdir ai
%PY_CMD% -m venv ai\.venv
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
)
echo Successfully created ai\.venv

echo.
echo [3/3] Installing AI dependencies from ai\requirements.txt...
ai\.venv\Scripts\python.exe -m pip install --upgrade pip
ai\.venv\Scripts\python.exe -m pip install -r ai\requirements.txt

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo   [SUCCESS] AI environment is ready!
    echo   You can now start the app with: npm run dev
    echo ========================================================
) else (
    echo.
    echo [WARNING] Some dependencies failed to install, but fallback AI will still work.
)

echo.
pause
