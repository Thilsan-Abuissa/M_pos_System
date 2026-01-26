# Cash Drawer Fix - macOS

## What Was Fixed

The cash drawer opening function has been updated with improved error handling and multiple fallback methods for macOS systems.

### Changes Made:

1. **Enhanced macOS Support**: Added 3 different methods to open the cash drawer on macOS
   - Method 1: Uses `lp -d [printer] -o raw` (most common for thermal printers)
   - Method 2: Uses `lp -d [printer]` without raw option
   - Method 3: Finds the printer device path and writes directly to it

2. **Better Error Messages**: Shows specific error messages to help identify the problem

3. **Fixed Windows Support**: Corrected a bug in the Windows fallback method

4. **Improved Logging**: Added console logging to help troubleshoot issues

## How to Test

### Step 1: Configure Printer
1. Open the POS application
2. Login as admin
3. Go to **Settings** > **System Settings**
4. In the **Printer Name** field, enter your thermal printer's exact name
5. Click **Save Settings**

### Step 2: Find Your Printer Name on macOS

Run this command in Terminal to see all available printers:
```bash
lpstat -p -d
```

The output will look like:
```
printer POS-80 is idle. enabled since ...
printer HP_LaserJet is idle. enabled since ...
```

Use the exact printer name (e.g., `POS-80` or `HP_LaserJet`)

### Step 3: Test Cash Drawer

#### Test Method 1: Direct Button
1. On the checkout page, click the **💵 Cash Drawer** button at the top
2. The cash drawer should open
3. Check the browser console (View > Developer > JavaScript Console) for any error messages

#### Test Method 2: Complete a Sale
1. Add items to cart
2. Select **CASH** as payment method
3. Click **COMPLETE SALE**
4. The cash drawer should open automatically
5. Check console for any errors

## Troubleshooting

### Issue: "No printer configured"
**Solution**: Go to Settings > System Settings and configure your printer name

### Issue: "Failed to communicate with printer"
**Possible Causes**:
1. Printer name is incorrect
2. Printer is offline or turned off
3. Printer driver not installed properly
4. Cash drawer not connected to printer

**Solutions**:
1. Verify printer name with `lpstat -p` command
2. Check printer is powered on and connected
3. Make sure cash drawer RJ11/RJ12 cable is plugged into the printer's drawer port
4. Try printing a test receipt from System Preferences to verify printer works

### Issue: "Could not determine printer device path"
**Solution**: Your printer might not support ESC/POS commands or requires a different configuration

### Issue: Cash drawer still not opening
**Advanced Troubleshooting**:

1. **Check if printer accepts raw ESC/POS commands**:
   ```bash
   # Create test file with drawer command
   printf "\x1B\x70\x00\x19\xFA" > /tmp/drawer_test.prn
   
   # Send to printer (replace POS-80 with your printer name)
   lp -d POS-80 -o raw /tmp/drawer_test.prn
   ```
   If this works, the problem is with the app. If it doesn't work, the issue is with the printer configuration.

2. **Check printer device path**:
   ```bash
   lpstat -v POS-80
   ```
   Output should show something like: `device for POS-80: usb://...` or `serial://...`

3. **Verify cash drawer connection**:
   - Ensure RJ11/RJ12 cable from drawer is connected to the correct port on the printer
   - Most thermal printers have a dedicated "DK" or "Drawer Kick" port
   - The cash drawer will NOT work if connected to a regular USB or ethernet port

4. **Check printer specifications**:
   - Confirm your thermal printer supports ESC/POS commands
   - Check if the printer documentation mentions "cash drawer kick" or "peripheral port"
   - Some printers require enabling cash drawer support in their settings

## macOS-Specific Notes

### CUPS Configuration
macOS uses CUPS (Common Unix Printing System) for printer management. The cash drawer commands are sent through CUPS to the printer.

### Permissions
The app should have permission to access printers. If you encounter permission issues:
1. Open **System Preferences** > **Security & Privacy** > **Files and Folders**
2. Make sure the POS app has necessary permissions

### Firewall
If using a network printer, ensure macOS firewall isn't blocking communication.

## Hardware Requirements

✅ **Required**:
- ESC/POS compatible thermal printer
- Cash drawer with RJ11/RJ12 connector
- Cable connecting drawer to printer (usually included with cash drawer)

✅ **Verified Compatible Printers**:
- Most 80mm thermal receipt printers with ESC/POS support
- Epson TM series (TM-T88, TM-T20, etc.)
- Star TSP series
- Bixolon SRP series
- Generic ESC/POS thermal printers

## Getting Help

If the cash drawer still doesn't work after trying all troubleshooting steps:

1. **Check the Console**: Open the JavaScript Console (View > Developer > JavaScript Console) and look for error messages when you try to open the drawer

2. **Test the Printer**: Make sure you can print regular receipts from the POS system

3. **Test with Terminal**: Use the command line test from the Advanced Troubleshooting section to verify if the issue is with the app or the printer setup

4. **Hardware Check**: 
   - Verify drawer opens when you manually unlock it
   - Check all cable connections
   - Try a different cash drawer if available

5. **Contact Support**: Provide the following information:
   - Printer model and name
   - Error messages from console
   - Result of terminal command test
   - macOS version

## For Developers

The cash drawer opening code is in:
- **main.js**: Lines ~253-370 - IPC handler for printer:openDrawer
- **renderer/app.js**: Lines ~3903-3917 - Frontend function that calls the IPC handler
- **renderer/app.js**: Line ~1255 - Call from completeSale() function
- **preload.js**: Line ~83 - IPC bridge

The ESC/POS command used is:
```
0x1B 0x70 0x00 0x19 0xFA
```
This is: `ESC p 0 25 250` - which tells the printer to pulse pin 2 for 250ms

## Summary of Fix

The updated code now:
1. ✅ Tries multiple methods to communicate with the printer
2. ✅ Shows detailed error messages
3. ✅ Includes proper error handling and cleanup
4. ✅ Logs all attempts for troubleshooting
5. ✅ Works on both macOS and Windows
6. ✅ Provides helpful guidance when things fail
