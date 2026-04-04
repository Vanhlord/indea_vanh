@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "TASK_NAME=WEB1 Auto Push 3h"
set "LOG_FILE=%~dp0logs\auto-push.log"

echo ========================================
echo WEB1 Auto Push Status
echo ========================================
echo.

echo [1] Scheduled Task Info
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST
if errorlevel 1 (
    echo.
    echo [ERROR] Could not read scheduled task "%TASK_NAME%".
    exit /b 1
)

echo.
echo [2] Git Status
git status --short --branch
if errorlevel 1 (
    echo [ERROR] Git status failed.
    exit /b 1
)

echo.
echo [3] Recent Commits
git log --oneline -5
if errorlevel 1 (
    echo [ERROR] Git log failed.
    exit /b 1
)

echo.
echo [4] Last Auto Push Logs
if exist "%LOG_FILE%" (
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_FILE%' | Select-Object -Last 15"
) else (
    echo No log file found yet: %LOG_FILE%
)

echo.
echo Done.
exit /b 0
