# Customer Display Troubleshooting Guide

## Quick Setup (What the customer mentioned)
The customer said to "just plug in USB port" - this is correct! Here's the complete process:

1. **Plug the customer display into any available USB port**
2. **Wait for Windows to detect the device**
3. **Check if drivers are automatically installed**
4. **Run the test script to verify connection**

## Common Issues and Solutions

### Issue 1: "SerialPort module not available"
**Symptoms:** Error message about SerialPort not being available
**Solution:**
```bash
npm install serialport
```
If that fails on Windows:
```bash
npm install --global windows-build-tools
npm install serialport
```

### Issue 2: "No serial ports found"
**Symptoms:** Display not detected, no ports available
**Solutions:**
1. **Check USB connection:** Make sure display is plugged in and powered
2. **Try different USB port:** Some ports work better than others
3. **Check Windows Device Manager:**
   - Look for "Unknown devices" or devices with yellow warning signs
   - Right-click and "Update driver"
4. **Install USB drivers:** May need CH340, FTDI, or Prolific drivers depending on display

### Issue 3: "Failed to connect to customer display"
**Symptoms:** Ports are detected but connection fails
**Solutions:**
1. **Check display power:** Make sure display is turned on
2. **Try different baud rate:** Default is 9600, but try 19200 or 38400
3. **Restart application:** Sometimes helps reset the connection
4. **Check USB cable:** Try a different USB cable

### Issue 4: Display shows garbage characters
**Symptoms:** Display works but shows wrong characters
**Solutions:**
1. **Confirm the correct COM port** in Device Manager (Ports → COM & LPT)
2. **Force the app to use that port** (example COM12):
   ```bash
   setx CUSTOMER_DISPLAY_PORT COM12
   ```
3. **Fix line-2 overlap / wrong cursor addressing** (PREMIER CD-220 U usually needs 0x14):
   ```bash
   setx CUSTOMER_DISPLAY_LINE2_OFFSET 0x14
   ```
4. **Restart the POS app** (required after `setx`)
5. If it still prints line 2 in the wrong place, try:
   ```bash
   setx CUSTOMER_DISPLAY_LINE2_OFFSET 0x40
   ```
6. **Try different baud rate** only if the text is truly random/garbled (wrong speed can cause that)

### Issue 5: First letter/digit missing OR text shifts randomly
**Symptoms:**
- The first character of the product name is missing (e.g. "kiwi" shows as "iwi")
- The first digit of the calculation is missing (e.g. "0.235*7.02" shows as ".235*7.02")
- The layout changes randomly between updates

**Cause (common with PREMIER CD-220 U):** the VFD sometimes needs more delay between cursor commands and text writes.

**Fix (recommended):** increase cursor/write delays and enable double-write.

On Windows (run in CMD, then restart the POS app):
```bat
setx CUSTOMER_DISPLAY_CURSOR_DELAY_MS 60
setx CUSTOMER_DISPLAY_WRITE_DELAY_MS 20
setx CUSTOMER_DISPLAY_DOUBLE_WRITE 1
```

If text is still printing on the wrong line, set the line-2 offset (PREMIER is usually 0x14):
```bat
setx CUSTOMER_DISPLAY_LINE2_OFFSET 0x14
```

Advanced troubleshooting only (not recommended unless instructed): try multiple line-2 offsets automatically:
```bat
setx CUSTOMER_DISPLAY_TRY_OFFSETS 1
```

To disable double-write (only if you see flicker):
```bat
setx CUSTOMER_DISPLAY_DOUBLE_WRITE 0
```

### Issue 5: First letter / first digit is missing (or layout changes randomly)
**Symptoms:** The display sometimes drops the first character (e.g. `0.370*1.00=2.37` becomes `.370*1.00=2.37`) or text appears on the wrong row.

**Cause:** Some VFDs need a bit more time between cursor commands and text writes.

**Fix (recommended):** Increase the delays (requires restart after `setx`):
```bash
setx CUSTOMER_DISPLAY_CURSOR_DELAY_MS 30
setx CUSTOMER_DISPLAY_WRITE_DELAY_MS 10
```

**If line 2 is in the wrong place:** explicitly set the offset (PREMIER CD-220 U usually `0x14`):
```bash
setx CUSTOMER_DISPLAY_LINE2_OFFSET 0x14
```

**Advanced troubleshooting only (not recommended normally):** try probing multiple offsets:
```bash
setx CUSTOMER_DISPLAY_TRY_OFFSETS 1
```
This can help unknown display models, but may cause unstable output on PREMIER.

## Testing Instructions

### Automatic Test
1. **Run the test script:**
   ```bash
   node test_customer_display.js
   ```
   Or on Windows, double-click: `test_customer_display.bat`

2. **Follow the output:** The script will guide you through troubleshooting

### Manual Test
1. **Check available ports:** Look in Windows Device Manager under "Ports (COM & LPT)"
2. **Note the COM port number** (e.g., COM3, COM4)
3. **Run the test helper**: double-click `test_customer_display.bat` and enter the COM port
3. **Use a terminal program** like PuTTY to test communication:
   - Port: COM3 (or whatever you found)
   - Baud rate: 9600
   - Data bits: 8
   - Parity: None
   - Stop bits: 1

## Supported Customer Displays

The system is designed for **PREMIER CD-220 U** but should work with similar USB customer displays that:
- Connect via USB (with USB-to-Serial converter)
- Support standard VFD commands
- Use 9600 baud rate
- Have 2 lines × 20 characters display

## USB Driver Information

Common USB-to-Serial chips used in customer displays:
- **CH340/CH341:** Most common, usually auto-installs on Windows 10/11
- **FTDI:** Usually auto-installs, very reliable
- **Prolific PL2303:** May need manual driver installation
- **CP210x (Silicon Labs):** Usually auto-installs

## Installation Check

To verify everything is installed correctly:

1. **Check Node modules:**
   ```bash
   npm list serialport
   ```

2. **Check for customer display:**
   ```bash
   node -e "const {SerialPort} = require('serialport'); SerialPort.list().then(ports => console.log(ports));"
   ```

3. **Run full test:**
   ```bash
   node test_customer_display.js
   ```

## Getting Help

If you're still having issues:

1. **Run the test script** and copy the output
2. **Check Windows Device Manager** for unknown devices
3. **Try the manual terminal test** to isolate the issue
4. **Contact support** with the test script output and device manager screenshot

## Quick Fix Summary

For most "just plug into USB port" issues:

1. ✅ **Plug into USB port**
2. ✅ **Install serialport:** `npm install serialport`
3. ✅ **Run test:** `node test_customer_display.js`
4. ✅ **Restart application**

That should get 90% of customer displays working!