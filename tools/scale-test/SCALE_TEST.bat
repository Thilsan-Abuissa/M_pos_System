@echo off
echo ============================================
echo  SCALE TEST
echo  1. CLOSE the POS program first
echo  2. Turn the scale ON and put an item on it
echo ============================================
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scale-test.ps1"
echo.
pause
