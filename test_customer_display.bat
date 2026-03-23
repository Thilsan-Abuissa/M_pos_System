@echo off
setlocal

echo ===============================================
echo   Customer Display Test (PREMIER CD-220 U)
echo ===============================================
echo.

set "PORT=%~1"
if "%PORT%"=="" (
	set /p PORT=Enter COM port (example: COM12): 
)

if "%PORT%"=="" (
	echo.
	echo ERROR: No COM port provided.
	echo.
	pause
	exit /b 1
)

REM Use session env vars so you don't have to permanently set them.
set "CUSTOMER_DISPLAY_PORT=%PORT%"

REM PREMIER CD-220 U typically uses contiguous line2 address offset 0x14.
set "CUSTOMER_DISPLAY_LINE2_OFFSET=0x14"

echo Using CUSTOMER_DISPLAY_PORT=%CUSTOMER_DISPLAY_PORT%
echo Using CUSTOMER_DISPLAY_LINE2_OFFSET=%CUSTOMER_DISPLAY_LINE2_OFFSET%
echo.

node test_customer_display.js
echo.
pause