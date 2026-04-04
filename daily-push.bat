@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This folder is not a Git repository.
    exit /b 1
)

set "COMMIT_MSG="

:collect_args
if "%~1"=="" goto after_args
if defined COMMIT_MSG (
    set "COMMIT_MSG=!COMMIT_MSG! %~1"
) else (
    set "COMMIT_MSG=%~1"
)
shift
goto collect_args

:after_args

if not defined COMMIT_MSG (
    set "COMMIT_MSG="
    set /p COMMIT_MSG=Commit message ^(Enter for auto message^): 
)

if not defined COMMIT_MSG (
    set "NOW="
    for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyy-MM-dd HH:mm\")"') do set "NOW=%%i"
    set "COMMIT_MSG=daily update !NOW!"
)

echo.
echo [1/4] Checking current branch...
for /f "delims=" %%i in ('git branch --show-current') do set "CURRENT_BRANCH=%%i"
if not defined CURRENT_BRANCH (
    echo [ERROR] Could not detect current branch.
    exit /b 1
)
echo Current branch: !CURRENT_BRANCH!

echo.
echo [2/4] Staging changes...
git add -A
if errorlevel 1 (
    echo [ERROR] git add failed.
    exit /b 1
)

set "HAS_CHANGES="
for /f "delims=" %%i in ('git status --porcelain') do (
    set "HAS_CHANGES=1"
    goto :after_status
)
:after_status

if defined HAS_CHANGES (
    echo.
    echo [3/4] Creating commit...
    git commit -m "!COMMIT_MSG!"
    if errorlevel 1 (
        echo [ERROR] git commit failed.
        exit /b 1
    )
) else (
    echo.
    echo [3/4] No local changes to commit. Skipping commit...
)

echo.
echo [4/4] Pushing to origin/!CURRENT_BRANCH!...
git push origin !CURRENT_BRANCH!
if errorlevel 1 (
    echo [ERROR] git push failed.
    exit /b 1
)

echo.
echo Done. GitHub daily push completed.
exit /b 0
