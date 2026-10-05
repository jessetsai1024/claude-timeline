# 把 install.ps1 建的接合點拿掉。只刪指到這個 repo 的接合點，不碰 repo 本身。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:USERPROFILE '.claude\skills\timeline'
if (Test-Path $target) {
  $item = Get-Item $target -Force
  $targets = @($item.Target) | ForEach-Object { ($_ -replace '^\\\\\?\\', '').TrimEnd('\').ToLowerInvariant() }
  $wanted = $repo.TrimEnd('\').ToLowerInvariant()
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and ($targets -contains $wanted)) {
    $item.Delete(); Write-Host "已拿掉 $target"
  } else {
    Write-Host "$target 不是指到這個 repo 的接合點，沒動。"
  }
}
