@echo off
echo ===============================================
echo   Supermarket POS - Installation
echo ===============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo.
    echo Please install Node.js from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM Check if npm is installed
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: npm is not found!
    echo.
    echo Please reinstall Node.js from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Installation failed!
    echo.
    pause
    exit /b 1
)

echo.
echo Installation complete!
echo.
echo Starting Supermarket POS...
call npm start

REM Keep window open if there's an error
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to start application!
    echo.
    pause
)
