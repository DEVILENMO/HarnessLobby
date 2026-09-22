#!/usr/bin/env pwsh
$env:LOBBY_HOME = 'C:\Users\DEVIL\XiaomiMiMoProjects\ARCHarnessLobby'
$entry = Join-Path $env:LOBBY_HOME 'packages\cli\dist\index.js'
if (-not (Test-Path $entry)) {
  Write-Host '[lobby] 尚未构建。请先：'
  Write-Host "  cd `"$env:LOBBY_HOME`" ; npm install ; npm run build"
  exit 1
}
node $entry @args
