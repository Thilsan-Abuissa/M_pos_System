@echo off
REM ZFOC Scale Connection Test for Windows
REM This script helps diagnose USB scale connection issues

echo ========================================
echo ZFOC Scale Connection Test
echo ========================================
echo.

echo [Step 1] Checking USB Serial Devices...
echo.

REM Check for COM ports using PowerShell
powershell -Command "Get-WmiObject Win32_PnPEntity | Where-Object {$_.Name -like '*COM*' -or $_.Name -like '*Serial*' -or $_.Name -like '*CH340*' -or $_.Name -like '*USB*'} | Select-Object Name, DeviceID, Status | Format-Table -AutoSize"

echo.
echo ========================================
echo.

echo [Step 2] Checking for CH340/CH341 Driver...
echo.

powershell -Command "$driver = Get-WmiObject Win32_PnPSignedDriver | Where-Object {$_.DeviceName -like '*CH340*' -or $_.DeviceName -like '*CH341*' -or $_.DeviceName -like '*USB-SERIAL*'}; if ($driver) { Write-Host 'CH340/CH341 Driver Found:' -ForegroundColor Green; $driver | Select-Object DeviceName, DriverVersion, Manufacturer | Format-Table -AutoSize } else { Write-Host 'CH340/CH341 Driver NOT Found!' -ForegroundColor Red; Write-Host 'You need to install the CH340/CH341 driver.' -ForegroundColor Yellow }"

echo.
echo ========================================
echo.

echo [Step 3] Checking Available COM Ports...
echo.

powershell -Command "$ports = [System.IO.Ports.SerialPort]::getportnames(); if ($ports) { Write-Host 'Available COM Ports:' -ForegroundColor Green; $ports | ForEach-Object { Write-Host \"  - $_\" } } else { Write-Host 'No COM ports detected!' -ForegroundColor Red }"

echo.
echo ========================================
echo.

echo [Step 4] Device Manager Ports Status...
echo.

powershell -Command "Get-WmiObject Win32_SerialPort | Select-Object Name, DeviceID, Description, Status | Format-Table -AutoSize"

echo.
echo ========================================
echo DIAGNOSIS COMPLETE
echo ========================================
echo.

echo INTERPRETING RESULTS:
echo.
echo [GOOD] If you see entries with "CH340", "CH341", or "USB-SERIAL" - Your driver is installed!
echo [GOOD] If you see COM ports (COM3, COM4, etc.) - Windows can see the scale!
echo.
echo [BAD] If you see NO COM ports - Driver is missing or scale not connected
echo [BAD] If you see "Unknown Device" - Driver installation failed
echo.
echo NEXT STEPS:
echo.
echo 1. If NO driver found: Download and install CH340 driver
echo    Download from: https://www.wch-ic.com/downloads/CH341SER_ZIP.html
echo.
echo 2. If driver found but no COM port: Check USB cable and scale power
echo.
echo 3. If COM port found: Try running the POS application again
echo.
echo 4. For detailed troubleshooting, see: ZFOC_SCALE_WINDOWS_FIX.md
echo.

pause
