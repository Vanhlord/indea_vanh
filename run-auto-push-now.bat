@echo off
setlocal EnableExtensions

set "TASK_NAME=WEB1 Auto Push 3h"

echo Running scheduled task: %TASK_NAME%
schtasks /Run /TN "%TASK_NAME%"
if errorlevel 1 (
    echo [ERROR] Could not start scheduled task.
    exit /b 1
)

echo.
echo Task started. Check status with:
echo check-auto-push.bat
exit /b 0
