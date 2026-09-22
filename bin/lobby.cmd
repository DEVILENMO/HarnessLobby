@echo off
setlocal
set "LOBBY_HOME=C:\Users\DEVIL\XiaomiMiMoProjects\ARCHarnessLobby"
if not exist "%LOBBY_HOME%\packages\cli\dist\index.js" (
  echo [lobby] Not built yet. Run in repo:
  echo   cd /d "%LOBBY_HOME%" ^&^& npm install ^&^& npm run build
  exit /b 1
)
node "%LOBBY_HOME%\packages\cli\dist\index.js" %*
