# 把這個 mod 接進 %USERPROFILE%\.claude\skills\timeline（目錄接合點 junction，不需要管理員權限），
# Claude Code 下次開啟就會自動載入。再跑一次是安全的：已經是接合點的會重接；那個位置有真的資料夾就不動。
# 用法：在 PowerShell 裡  .\install.ps1   （沒有實機跑過；有問題請開 issue）
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$skills = Join-Path $env:USERPROFILE '.claude\skills'
New-Item -ItemType Directory -Force -Path $skills | Out-Null
$target = Join-Path $skills 'timeline'
if (Test-Path $target) {
  $item = Get-Item $target -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    $item.Delete()   # 只刪接合點本身，不會跟進去刪內容
  } else {
    throw "$target 已存在而且不是接合點，請自己處理"
  }
}
New-Item -ItemType Junction -Path $target -Target $repo | Out-Null
Write-Host "已接上 timeline -> $target；關掉再重開 Claude Code 就會看到。"
