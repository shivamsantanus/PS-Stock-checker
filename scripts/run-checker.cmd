@echo off
setlocal EnableExtensions
REM ---------------------------------------------------------------------------
REM Runs the stock checker forever, restarting it if it ever exits.
REM
REM This is the no-admin alternative to install-windows-task.ps1: registering a
REM Scheduled Task needs elevation (it fails with "Access is denied" on a
REM locked-down machine), while a launcher in the Startup folder does not. The
REM restart loop below is what Task Scheduler's RestartCount would have given
REM us - without it a single crash silently ends all alerting.
REM
REM Output appends to logs\checker-YYYYMMDD.log so an overnight restart can
REM still be diagnosed the next morning.
REM ---------------------------------------------------------------------------

cd /d "%~dp0.."

if not exist "logs" mkdir "logs"
if not exist "dist\index.js" (
  echo dist\index.js not found - run "npm run build" first.
  exit /b 1
)

REM --- Single-instance guard -------------------------------------------------
REM Two checkers running at once would send every subscriber DUPLICATE alerts,
REM so bail out if one is already up. This is the equivalent of the Scheduled
REM Task's "-MultipleInstances IgnoreNew". Uses PowerShell because wmic is
REM removed on current Windows builds and tasklist cannot match a command line.
REM Signals via EXIT CODE rather than capturing stdout: a `for /f` around a
REM PowerShell one-liner needs the pipe and inner quotes double-escaped for
REM cmd, which silently produced an empty result and let a second copy through.
powershell -NoProfile -Command "if (@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*dist\index.js*' }).Count -gt 0) { exit 1 }"
if errorlevel 1 (
  echo Checker already running - not starting a second copy.
  exit /b 0
)

:loop
REM Recomputed per restart so a long-lived run rolls over at midnight.
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set "LOGDATE=%%d"
set "LOGFILE=logs\checker-%LOGDATE%.log"

>>"%LOGFILE%" echo.
>>"%LOGFILE%" echo ===== started %DATE% %TIME% =====
node "dist\index.js" >>"%LOGFILE%" 2>&1
>>"%LOGFILE%" echo ===== exited %DATE% %TIME% (code %ERRORLEVEL%) - restarting in 15s =====
timeout /t 15 /nobreak >nul
goto loop
