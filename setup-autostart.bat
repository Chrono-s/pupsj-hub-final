@echo off
title PUPSJ HUB - Setup Auto-Start
cd /d "%~dp0"

echo ================================================
echo   PUPSJ HUB - Configure Auto-Start on Login
echo ================================================
echo.
echo This will make PUPSJ HUB start automatically
echo every time you log in to Windows.
echo.
pause

set "START_BAT=%~dp0start.bat"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

:: Create a shortcut in the Windows Startup folder
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$s = $ws.CreateShortcut('%STARTUP_FOLDER%\PUPSJ HUB.lnk');" ^
  "$s.TargetPath = '%START_BAT%';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'PUPSJ HUB Auto-Start';" ^
  "$s.Save();" ^
  "Write-Host 'Shortcut created successfully.'"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ================================================
    echo   SUCCESS! Auto-start is now configured.
    echo.
    echo   PUPSJ HUB will launch automatically every
    echo   time you log in to Windows.
    echo.
    echo   To REMOVE auto-start, delete this file:
    echo   %STARTUP_FOLDER%\PUPSJ HUB.lnk
    echo ================================================
) else (
    echo.
    echo   ERROR: Could not create the shortcut.
    echo   Try running this file as Administrator.
)
echo.
pause
