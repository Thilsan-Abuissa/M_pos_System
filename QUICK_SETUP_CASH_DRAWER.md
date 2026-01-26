# 🎯 CASH DRAWER - QUICK SETUP GUIDE

## 📍 Current Status: FIXED ✅

The cash drawer opening functionality has been updated and improved!

---

## 🚦 3-STEP SETUP

### STEP 1️⃣: Find Your Printer Name

Open **Terminal** and type:
```bash
lpstat -p
```

You'll see something like:
```
printer POS-80 is idle. enabled since...
printer EPSON_TM_T88 is idle. enabled since...
```

**Copy the printer name exactly** (e.g., `POS-80`)

---

### STEP 2️⃣: Configure in POS App

1. Open the **POS application**
2. Login as **Admin**
3. Click **⚙️ Settings** (bottom of screen)
4. Click **🔧 System Settings**
5. Find **Printer Name** field
6. Paste your printer name
7. Click **💾 Save Settings**

---

### STEP 3️⃣: Test It!

#### Quick Test with Script:
```bash
cd /opt/homebrew/var/www/supermarket_pos
./test_cash_drawer.sh
```

#### Or Test in App:
- Click the **💵** button on checkout screen
- Cash drawer should open! 🎉

---

## ✅ VERIFICATION

### Does it work?
- [x] Complete a CASH sale → Drawer opens ✅
- [x] Click 💵 button → Drawer opens ✅
- [x] No error messages ✅

### Still having issues?
See **TROUBLESHOOTING** below ⬇️

---

## 🔧 TROUBLESHOOTING

### Problem: "No printer configured"
**FIX:**
1. Go to Settings → System Settings
2. Enter printer name from `lpstat -p`
3. Save and try again

---

### Problem: "Failed to communicate with printer"
**CHECK:**
1. Is printer powered on?
   ```bash
   lpstat -p YourPrinterName
   ```
   Should say "idle" not "disabled"

2. Can you print a test page?
   - System Preferences → Printers & Scanners
   - Right-click printer → Print Test Page

3. Is printer name spelled exactly right?
   Run `lpstat -p` again and double-check

---

### Problem: No error, but drawer doesn't open

**PHYSICAL CHECK:**
```
┌─────────────┐
│ Cash Drawer │
└──────┬──────┘
       │ RJ11/RJ12 Cable
       │ (looks like phone cable)
       ↓
┌─────────────────────┐
│  Receipt Printer    │
│                     │
│  [DK] ← Drawer Port │  ← Cable should be here!
│  [●]  ← USB Port    │  ← NOT here
└──────┬──────────────┘
       │ USB Cable
       ↓
┌─────────────┐
│  Computer   │
└─────────────┘
```

**CHECKLIST:**
- [ ] Cable connected to printer's **DRAWER PORT** (labeled "DK" or with drawer icon)
- [ ] Cable is **NOT** in USB or network port
- [ ] Drawer has power (if it has a power cord)
- [ ] Drawer lock is not engaged

**TEST MANUALLY:**
- Use the key to open drawer
- If it doesn't open manually, the drawer mechanism is stuck

---

### Problem: Printer doesn't support ESC/POS

**COMPATIBLE PRINTERS:**
- ✅ Epson TM series (TM-T88, TM-T20, etc.)
- ✅ Star TSP series
- ✅ Bixolon SRP series
- ✅ Most 80mm thermal receipt printers
- ❌ Regular inkjet/laser printers (won't work)

**CHECK YOUR PRINTER:**
- Look for "ESC/POS" in the specifications
- Check if it has a drawer port (RJ11/RJ12)
- Consult the printer manual

---

## 🧪 ADVANCED TESTING

### Test Command Directly:
```bash
# Create test file with drawer command
printf "\x1B\x70\x00\x19\xFA" > /tmp/drawer_test.prn

# Send to printer (replace POS-80 with YOUR printer name)
lp -d POS-80 -o raw /tmp/drawer_test.prn
```

**If this works** → App setup is the issue  
**If this doesn't work** → Hardware/printer issue

---

### Check Printer Device:
```bash
# Show printer connection type
lpstat -v POS-80
```

Output examples:
- ✅ `device for POS-80: usb://...` → Good
- ✅ `device for POS-80: socket://...` → Good (network)
- ❌ `device for POS-80: ipp://...` → May not support raw commands

---

## 📊 DIAGNOSTIC FLOWCHART

```
Start: Cash drawer not opening
           ↓
    Run test script?
       /        \
     Yes        No
      ↓          ↓
   Pass?    Try manual test
   /    \        ↓
 Yes    No    Works?
  ↓      ↓    /     \
 Done! Check Yes    No
       Setup  ↓      ↓
           Done!  Check:
                  1. Printer name
                  2. Connections
                  3. Printer model
                  4. ESC/POS support
```

---

## 📞 NEED HELP?

### Information to Collect:

1. **Printer Details:**
   ```bash
   lpstat -p -d
   lpstat -v YourPrinterName
   ```

2. **Test Script Output:**
   ```bash
   ./test_cash_drawer.sh > results.txt
   ```

3. **App Console Errors:**
   - Open POS app
   - Press `Cmd + Option + I`
   - Click "Console" tab
   - Try to open drawer
   - Screenshot any red error messages

4. **Hardware Info:**
   - Printer model and brand
   - Cash drawer model
   - How are they connected?
   - Photo of the printer showing ports

### Send All Above Information

---

## 📚 MORE INFO

- **Detailed Guide**: CASH_DRAWER_FIX.md
- **Original Setup Guide**: CASH_DRAWER_SETUP.md
- **Delivery Notes**: DELIVERY_NOTES_CASH_DRAWER.md

---

## 🎉 SUCCESS!

Once working, you should see:
- ✅ Drawer pops open when completing CASH sales
- ✅ Drawer opens when clicking 💵 button
- ✅ No error messages in console
- ✅ Smooth checkout experience!

**Congratulations! Your cash drawer is now working!** 🎊

---

## 🛠️ WHAT WAS FIXED

Before:
- ❌ Single method to open drawer
- ❌ Failed silently on macOS
- ❌ Unclear error messages
- ❌ Bug in Windows fallback

After:
- ✅ Three different methods (tries all)
- ✅ Works reliably on macOS and Windows
- ✅ Clear error messages with solutions
- ✅ Proper cleanup and logging
- ✅ Test script for diagnostics

---

Last Updated: January 2026
Version: 1.0.1 (Cash Drawer Fix)
