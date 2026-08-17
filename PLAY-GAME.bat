@echo off
rem ---------------------------------------------------------------
rem  NISSAN Z - ULTIMATE DRIVE   /   launcher
rem
rem  Keep this file ASCII-only. cmd.exe parses a .bat with the
rem  system OEM codepage, so non-ASCII text here breaks the parser
rem  (Persian instructions live in RAHNAMA.txt and README.md).
rem ---------------------------------------------------------------
title NISSAN Z - ULTIMATE DRIVE
cd /d "%~dp0"

echo.
echo   ============================================================
echo       N I S S A N   Z   --   U L T I M A T E   D R I V E
echo   ============================================================
echo.

rem ---- 1. Is Node.js installed? ----
where node >nul 2>nul
if errorlevel 1 goto NO_NODE

rem ---- 2. First run? install dependencies ----
if not exist "node_modules\three\package.json" goto INSTALL
goto RUN

:INSTALL
echo   [1/2] Installing dependencies - this happens only once
echo         and can take a few minutes. Please wait...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto INSTALL_FAILED
echo.

:RUN
echo   [2/2] Starting the game - your browser will open by itself.
echo.
echo   ------------------------------------------------------------
echo    KEEP THIS WINDOW OPEN. Closing it stops the game.
echo    To quit: press Ctrl + C, or just close this window.
echo   ------------------------------------------------------------
echo.
call npm run dev
echo.
echo   Server stopped.
echo.
pause
exit /b 0

:NO_NODE
echo   [X] Node.js was not found on this computer.
echo.
echo       1. Open https://nodejs.org
echo       2. Install the LTS version
echo       3. Run this file again
echo.
pause
exit /b 1

:INSTALL_FAILED
echo.
echo   [X] npm install failed. Check your internet connection
echo       and run this file again.
echo.
pause
exit /b 1
