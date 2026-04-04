@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "LOG_DIR=%~dp0logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "LOG_FILE=%LOG_DIR%\auto-push.log"

call :log ========================================
call :log Auto push started

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    call :log [ERROR] This folder is not a Git repository.
    exit /b 1
)

for /f "delims=" %%i in ('git branch --show-current') do set "CURRENT_BRANCH=%%i"
if not defined CURRENT_BRANCH (
    call :log [ERROR] Could not detect current branch.
    exit /b 1
)

call :log Branch: !CURRENT_BRANCH!
call :log Staging changes...
git add -A >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    call :log [ERROR] git add failed.
    exit /b 1
)

set "HAS_CHANGES="
for /f "delims=" %%i in ('git status --porcelain') do (
    set "HAS_CHANGES=1"
    goto :after_status
)
:after_status

if defined HAS_CHANGES (
    for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyy-MM-dd HH:mm\")"') do set "NOW=%%i"
    set "COMMIT_MSG=auto sync !NOW!"
    call :log Creating commit: !COMMIT_MSG!
    git commit -m "!COMMIT_MSG!" >> "%LOG_FILE%" 2>&1
    if errorlevel 1 (
        call :log [ERROR] git commit failed.
        exit /b 1
    )
) else (
    call :log No local changes. Skipping commit.
)

call :log Pushing to origin/!CURRENT_BRANCH!...
git push origin !CURRENT_BRANCH! >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    call :log [ERROR] git push failed.
    exit /b 1
)

call :log Auto push completed successfully
exit /b 0

:log
set "STAMP="
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyy-MM-dd HH:mm:ss\")"') do set "STAMP=%%i"
echo [!STAMP!] %~1
>> "%LOG_FILE%" echo [!STAMP!] %~1
exit /b 0
