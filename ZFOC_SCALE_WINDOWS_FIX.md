# ZFOC Scale Not Detected on Windows - Troubleshooting Guide

## Issue
Customer is experiencing "Scale not connected" error on Windows PC with ZFOC scale model. The scale is powered ON and USB cable is connected to PC, but the POS system is not detecting it.

---

## ✅ SOLUTION STEPS

### Step 1: Check USB Device Detection in Windows

1. **With the scale connected and powered ON**, open Device Manager:
   - Press `Windows Key + X`
   - Select "Device Manager"

2. **Look for the scale under these sections:**
   - **Ports (COM & LPT)** - Look for entries like:
     - "USB Serial Port (COM3, COM4, COM5, etc.)"
     - "USB-SERIAL CH340 (COMx)"
     - "Prolific USB-to-Serial Comm Port"
     - "USB Serial Device"
   - **Universal Serial Bus controllers** - Look for:
     - "USB Serial Converter"
     - "CH340" or "CH341"

3. **If you see a yellow exclamation mark (!)** or the device is under "Other Devices":
   - The USB driver is missing or not installed correctly
   - Continue to Step 2

4. **If you don't see ANY new device when you plug in the scale:**
   - Try a different USB port
   - Try a different USB cable
   - The USB cable might be power-only (not data cable)
   - The scale's USB-to-Serial chip might be faulty

---

### Step 2: Install USB-to-Serial Driver (CH340/CH341)

Most ZFOC scales use CH340 or CH341 USB-to-Serial chips. Windows needs a driver for these.

#### Method A: Automatic Driver Installation (Recommended)

1. **Right-click** on the device with the yellow exclamation mark in Device Manager
2. Select **"Update driver"**
3. Choose **"Search automatically for drivers"**
4. Windows will download and install the driver
5. **Restart your computer**
6. **Unplug and replug the scale** after restart

#### Method B: Manual Driver Installation

If automatic installation fails:

1. **Download CH340/CH341 Driver:**
   - Visit: https://www.wch-ic.com/downloads/CH341SER_ZIP.html
   - Or search Google for "CH340 driver Windows download"
   - Download the ZIP file

2. **Extract and Install:**
   - Extract the ZIP file
   - Run `SETUP.EXE` as Administrator (right-click → "Run as administrator")
   - Click "Install"
   - Wait for installation to complete

3. **Restart your computer**

4. **Verify Installation:**
   - Open Device Manager again
   - You should now see "USB-SERIAL CH340 (COMx)" under "Ports (COM & LPT)"
   - Note the COM port number (e.g., COM3, COM4, etc.)

---

### Step 3: Verify Serial Port Settings

After driver installation:

1. **Open Device Manager**
2. **Expand "Ports (COM & LPT)"**
3. **Right-click** on your USB Serial Port (e.g., "USB-SERIAL CH340 (COM3)")
4. Select **"Properties"**
5. Go to **"Port Settings"** tab
6. **Verify these settings match:**
   - **Bits per second:** 9600
   - **Data bits:** 8
   - **Parity:** None
   - **Stop bits:** 1
   - **Flow control:** None

7. If they don't match, change them and click **"OK"**

---

### Step 4: Test Scale in POS Application

1. **Close the POS application** completely (if open)
2. **Ensure the scale is:**
   - Plugged into USB port
   - Powered ON
   - Showing "0.000" or a stable weight on its display

3. **Launch the POS application**
4. **Login and go to Checkout**
5. **Place a test item on the scale** (500g or 1kg item)
6. **Wait for the scale display to stabilize**
7. **Click any product** from the product grid
8. The weight modal should open and attempt to read the weight

**Expected Result:** Weight should be read automatically from the scale

---

## 🔧 ADVANCED TROUBLESHOOTING

### Issue A: Driver Installed but Scale Still Not Detected

**Cause:** POS application is checking wrong COM ports or multiple USB devices are confusing the detection

**Solution:**
1. **Open Device Manager**
2. **Note the exact COM port** of your scale (e.g., COM3)
3. **Disconnect all other USB-to-Serial devices** (Arduino, GPS devices, etc.)
4. **Restart the POS application**
5. The application will automatically scan and find the scale

### Issue B: "Timeout reading from scale"

**Cause:** Scale is connected but not sending data, or wrong baud rate

**Solutions:**
1. **Check scale power:** Make sure scale is fully powered on and not in sleep mode
2. **Place weight on scale:** Some scales only transmit when weight changes
3. **Check cable:** Ensure you're using a DATA USB cable, not just a charging cable
4. **Try different USB port:** Some USB 3.0 ports have compatibility issues; try USB 2.0 port

### Issue C: Scale Shows Wrong Weight (e.g., 500kg instead of 0.5kg)

**Cause:** Weight unit parsing issue

**Solution:** This is a software parsing issue. The scale is working but the application is misinterpreting the units. Contact support for a software update.

---

## 📝 QUICK CHECKLIST

Before contacting support, verify:

- [ ] Scale is powered ON (display is lit)
- [ ] USB cable is firmly connected to both scale and PC
- [ ] USB cable supports DATA transfer (not just power)
- [ ] Scale appears in Windows Device Manager under "Ports (COM & LPT)"
- [ ] No yellow exclamation mark in Device Manager
- [ ] CH340/CH341 driver is installed
- [ ] Port settings are: 9600 baud, 8 data bits, None parity, 1 stop bit
- [ ] Computer has been restarted after driver installation
- [ ] POS application has been restarted
- [ ] Test weight placed on scale before clicking product
- [ ] Scale display shows stable weight (not blinking)

---

## 🎯 COMMON WINDOWS ERRORS & FIXES

### Error: "Code 10 - This device cannot start"
**Fix:** Uninstall the device in Device Manager, unplug scale, restart PC, plug scale back in

### Error: "Code 28 - Drivers not installed"
**Fix:** Follow Step 2 to install CH340/CH341 drivers

### Error: "Port already in use"
**Fix:** Close any other software that might be using serial ports (Arduino IDE, Putty, Tera Term, etc.)

---

## 📞 COLLECTING DEBUG INFORMATION

If the scale still doesn't work after all steps, collect this information:

1. **Device Manager Screenshot:**
   - Expand "Ports (COM & LPT)" section
   - Take screenshot

2. **Scale COM Port Properties:**
   - Right-click on scale port → Properties
   - Take screenshot of "General" tab
   - Take screenshot of "Port Settings" tab
   - Take screenshot of "Driver" tab

3. **POS Application Console Output:**
   - Close POS application
   - Run POS in development mode (if available)
   - Try to read from scale
   - Copy any error messages

4. **USB Cable Test:**
   - Try the same USB cable with another device (phone, etc.)
   - Verify it can transfer data, not just power

---

## ⚡ QUICK FIX SUMMARY

**Most Common Solution (90% of cases):**

1. Download CH340 driver: https://www.wch-ic.com/downloads/CH341SER_ZIP.html
2. Install driver as Administrator
3. Restart computer
4. Restart POS application
5. Test with weight on scale

**If that doesn't work:**
- Try different USB cable (must be data cable)
- Try different USB port (prefer USB 2.0 over 3.0)
- Uninstall device in Device Manager and replug

---

## 📸 VISUAL GUIDE

### Where to find COM Port in Device Manager:
```
Device Manager
└── Ports (COM & LPT)
    └── USB-SERIAL CH340 (COM3)  ← Your scale should appear here
```

### Correct Port Settings:
```
Bits per second: 9600
Data bits: 8
Parity: None
Stop bits: 1
Flow control: None
```

---

## 🔍 TECHNICAL DETAILS

The ZFOC scale uses:
- **Connection:** USB (with CH340/CH341 USB-to-Serial chip)
- **Protocol:** RS232 Serial Communication
- **Baud Rate:** 9600 bps (default)
- **Data Format:** 8N1 (8 data bits, No parity, 1 stop bit)
- **Data Output:** Continuous or on-demand weight data

The POS application will automatically:
1. Scan all COM ports
2. Try multiple baud rates (9600, 4800, 2400, 19200, 38400, 115200)
3. Try multiple configurations (8N1, 7E1, etc.)
4. Test each port for scale responses
5. Connect to the first working scale detected

---

## ✅ SUCCESS INDICATORS

You'll know it's working when:
- ✅ No yellow warning in Device Manager
- ✅ Scale appears as "USB-SERIAL CH340 (COMx)" under Ports
- ✅ POS application shows weight automatically when product is clicked
- ✅ Weight updates when you place different items on scale
- ✅ No timeout errors in the application

---

## 🚨 WHEN TO REPLACE HARDWARE

Consider hardware replacement if:
- ❌ Scale doesn't appear in Device Manager even with driver installed
- ❌ Multiple USB cables don't work
- ❌ Scale works on another computer but not this one
- ❌ Device Manager shows "Unknown Device" that cannot be identified
- ❌ Scale's USB port is physically damaged

---

## 📧 SUPPORT CONTACT

If none of these steps work, contact technical support with:
1. Screenshots from Device Manager
2. Scale model number (ZFOC)
3. Windows version
4. List of steps already tried
5. Any error messages from POS application

---

**Last Updated:** January 27, 2026
**Applies to:** ZFOC Scale Model, Windows 10/11
**Software Version:** POS System v3.0.0
