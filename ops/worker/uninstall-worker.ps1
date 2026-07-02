<#
.SYNOPSIS
  Remove every Fxmily local AI worker scheduled task (revert install-worker.ps1).
.DESCRIPTION
  Unregisters all tasks named Fxmily-worker-* under \Fxmily\. Leaves logs +
  worker.env untouched. Idempotent: a no-op if nothing is registered.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$TaskFolder = '\Fxmily\'
$TaskPrefix = 'Fxmily-worker-'

$tasks = Get-ScheduledTask -TaskPath $TaskFolder -ErrorAction SilentlyContinue |
  Where-Object { $_.TaskName -like "$TaskPrefix*" }

if (-not $tasks) {
  Write-Host "No Fxmily worker tasks registered — nothing to remove." -ForegroundColor DarkGray
  return
}

foreach ($t in $tasks) {
  if ($PSCmdlet.ShouldProcess($t.TaskName, 'Unregister scheduled task')) {
    Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $TaskFolder -Confirm:$false
    Write-Host "  [removed] $($t.TaskName)" -ForegroundColor Yellow
  }
}
Write-Host "Done." -ForegroundColor Cyan
