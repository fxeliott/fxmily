<#
.SYNOPSIS
  Show the state + last run of every Fxmily local AI worker task (observability).
.DESCRIPTION
  For each Fxmily-worker-* task: registration state, last run time, last result,
  next run time, plus the machine-readable last-run status our wrapper writes to
  logs/<batch>.status.json (exitCode + ok). This is the J2 window into "did the
  worker actually run and succeed" — the answer the old manual flow never had.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$TaskFolder = '\Fxmily\'
$TaskPrefix = 'Fxmily-worker-'
$LogDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'logs'

$tasks = Get-ScheduledTask -TaskPath $TaskFolder -ErrorAction SilentlyContinue |
  Where-Object { $_.TaskName -like "$TaskPrefix*" } | Sort-Object TaskName

if (-not $tasks) {
  Write-Host "No Fxmily worker tasks registered. Run install-worker.ps1 first." -ForegroundColor Yellow
  return
}

$rows = foreach ($t in $tasks) {
  $info = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $TaskFolder
  $batch = $t.TaskName -replace [regex]::Escape($TaskPrefix), ''
  $statusFile = Join-Path $LogDir "$batch.status.json"
  $lastExit = '-'; $lastOk = '-'; $lastFinished = '-'
  if (Test-Path $statusFile) {
    try {
      $s = Get-Content $statusFile -Raw | ConvertFrom-Json
      $lastExit = $s.exitCode; $lastOk = $s.ok; $lastFinished = $s.finishedAt
    }
    catch { $lastExit = 'parse-error' }
  }
  [PSCustomObject]@{
    Batch        = $batch
    State        = $t.State
    LastRun      = $info.LastRunTime
    LastResult   = ('0x{0:X}' -f $info.LastTaskResult)
    NextRun      = $info.NextRunTime
    WrapperExit  = $lastExit
    WrapperOk    = $lastOk
    LastFinished = $lastFinished
  }
}

$rows | Format-Table -AutoSize
Write-Host ""
Write-Host "Logs: $LogDir\<batch>.log   |   LastResult 0x0 = task launched OK; WrapperOk = batch succeeded." -ForegroundColor DarkGray
