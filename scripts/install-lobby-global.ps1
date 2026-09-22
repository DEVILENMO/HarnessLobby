# 将 lobby 安装为全局命令（任意目录可执行）
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$srcCmd = Join-Path $repo 'bin\lobby.cmd'
$srcPs1 = Join-Path $repo 'bin\lobby.ps1'

$targets = @(
  (Join-Path $env:APPDATA 'npm'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
)

foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Copy-Item $srcCmd (Join-Path $dir 'lobby.cmd') -Force
  Copy-Item $srcPs1 (Join-Path $dir 'lobby.ps1') -Force
  Write-Host "installed -> $dir\lobby.cmd"
}

# 确保 %APPDATA%\npm 在用户 PATH
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$npmDir = Join-Path $env:APPDATA 'npm'
if ($userPath -notlike "*$npmDir*") {
  $newPath = if ($userPath) { "$userPath;$npmDir" } else { $npmDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Host "added to user PATH: $npmDir"
}

Write-Host '完成。新开终端后可直接： lobby'
