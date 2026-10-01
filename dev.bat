@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js and reopen the terminal.
  exit /b 1
)
node "%~dp0dev.cjs" %*
exit /b %errorlevel%
