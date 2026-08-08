<#
.SYNOPSIS
  Registers the stock checker as a Windows Scheduled Task that starts at logon
  and restarts itself if it ever dies.

.DESCRIPTION
  The checker is a long-running process (see the tiered poller in
  src/index.ts), not a cron job - it keeps one Playwright browser warm and
  polls the hot tier every ~60s. Task Scheduler is used rather than PM2
  because it is native, survives reboots without extra tooling, and can be
  told to restart a crashed task.

  Node is resolved to an absolute path at install time: Task Scheduler does
  not reliably inherit the interactive PATH, so "node" alone often fails
  under a task while working fine in a terminal.

.EXAMPLE
  npm run install-task
#>

$ErrorActionPreference = "Stop"

$TaskName = "PS5StockChecker"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Entry = Join-Path $ProjectRoot "dist\index.js"

Write-Host "Project root: $ProjectRoot"

# --- Preconditions --------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    throw "node was not found on PATH. Install Node.js 18+ and re-run."
}
Write-Host "Node:         $node"

if (-not (Test-Path $Entry)) {
    throw "dist\index.js not found. Run 'npm run build' first, then re-run this script."
}

$envFile = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Warning ".env not found - the checker will refuse to start without a notification channel configured."
}

# --- Replace any previous registration ------------------------------------
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# --- Define the task ------------------------------------------------------
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$Entry`"" -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn

# ExecutionTimeLimit 0 = never kill it for running too long (it runs forever
# by design). RestartCount/RestartInterval bring it back if it crashes -
# without these a single unhandled crash silently ends all alerting.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "PS5 stock checker - tiered poller with Telegram alerts" | Out-Null

Write-Host ""
Write-Host "Registered scheduled task '$TaskName'." -ForegroundColor Green
Write-Host ""
Write-Host "  Start now:     Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Check status:  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "  Stop:          Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  Remove:        Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
Write-Host ""
Write-Host "NOTE: the task starts at logon. It does not run while signed out" -ForegroundColor Yellow
Write-Host "      unless you reconfigure it to 'Run whether user is logged on or not'." -ForegroundColor Yellow
