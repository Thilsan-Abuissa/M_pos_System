# 🎯 ZFOC Scale Quick Fix Card

## ⚠️ Problem: "Scale not connected" error

## ✅ QUICK FIX (5 minutes)

### 1. Check Physical Connection
- [ ] Scale USB cable is plugged in to PC
- [ ] Scale is powered ON (display is lit)
- [ ] Try different USB port

### 2. Install Driver (MOST COMMON FIX)

**Windows needs a driver for the scale!**

1. Download: https://www.wch-ic.com/downloads/CH341SER_ZIP.html
2. Extract the ZIP file
3. Right-click `SETUP.EXE` → "Run as administrator"
4. Click "Install"
5. **Restart your computer**
6. Restart POS application

### 3. Verify in Device Manager

1. Press `Windows Key + X`
2. Select "Device Manager"
3. Look under "Ports (COM & LPT)"
4. You should see: **"USB-SERIAL CH340 (COM3)"** or similar

✅ **If you see it with NO yellow warning = Driver is working!**

❌ **If you see yellow exclamation mark = Driver failed to install**

❌ **If you don't see it = Cable or scale problem**

---

## 🔍 Run Diagnostic Test

Run this file to test your scale connection:
- **Double-click: `test_scale_windows.bat`**

It will show you:
- ✅ If driver is installed
- ✅ If Windows can see the scale
- ✅ Which COM port the scale is on

---

## 📞 Still Not Working?

### Try These:

1. **Different USB Cable**
   - Must be a DATA cable (not just charging cable)
   - Test cable with phone to verify it transfers data

2. **Different USB Port**
   - Try USB 2.0 port (black) instead of USB 3.0 (blue)
   - Don't use USB hub - plug directly into PC

3. **Check Port Settings**
   - Device Manager → Your COM port → Properties → Port Settings
   - Should be: **9600, 8, None, 1, None**

4. **Restart Everything**
   - Unplug scale
   - Restart computer
   - Plug scale back in
   - Start POS application

---

## 📱 Contact Support With:

1. Screenshot of Device Manager (Ports section)
2. Result from `test_scale_windows.bat`
3. Scale model: **ZFOC**
4. Windows version
5. Steps you already tried

---

## 💡 Prevention Tips

- Don't unplug scale while POS is running
- Always use same USB port
- Keep scale powered ON during business hours
- If moving PC, reconnect scale and restart POS

---

**For detailed troubleshooting: See `ZFOC_SCALE_WINDOWS_FIX.md`**
