# 🔧 CASH DRAWER NOT OPENING - FIXED!

## What Was The Problem?

The cash drawer was not opening when:
1. Completing a cash sale
2. Clicking the manual cash drawer button

This has been **FIXED** with improved code that works better on macOS.

---

## 🚀 Quick Fix Instructions

### Step 1: Configure Your Printer

1. **Find your printer name** - Open Terminal and run:
   ```bash
   lpstat -p
   ```
   
2. **Copy the exact printer name** (e.g., `POS-80` or `EPSON_TM_T88`)

3. **Open the POS app** and login as admin

4. **Go to Settings** > System Settings > Printer Name

5. **Enter the exact printer name** and click Save

### Step 2: Test the Fix

#### Option A: Run the Test Script (Recommended)
1. Open Terminal
2. Run:
   ```bash
   cd /opt/homebrew/var/www/supermarket_pos
   ./test_cash_drawer.sh
   ```
3. Follow the prompts
4. The script will test if your drawer can open

#### Option B: Test in the App
1. Open the POS application
2. Go to the checkout screen
3. Click the **💵** button at the top
4. Cash drawer should open!

---

## ✅ How to Use

### Opening Cash Drawer Automatically
- Just complete any CASH sale
- The drawer will open automatically when you click "Complete Sale"

### Opening Cash Drawer Manually
- Click the **💵 Cash Drawer** button on the checkout screen
- Or go to Settings and click the "Cash Drawer" card

---

## ⚠️ Still Not Working?

### Checklist:
- [ ] Printer name is configured correctly in Settings
- [ ] Cash drawer cable (RJ11/RJ12) is connected to printer
- [ ] Cable is in the **drawer port** (not USB port)
- [ ] Printer is turned on and online
- [ ] Printer supports ESC/POS commands

### Common Issues:

**"No printer configured"**
→ Go to Settings > System Settings and enter your printer name

**"Failed to communicate with printer"**
→ Run the test script to diagnose: `./test_cash_drawer.sh`

**Drawer doesn't open but no error**
→ Check physical connections:
  - Is the drawer plugged into the printer's drawer port?
  - Is the drawer powered (if it has a power cord)?
  - Try manually unlocking the drawer to test the mechanism

---

## 📋 Hardware Setup

### Required Connections:
```
[Cash Drawer] ----RJ11/RJ12 Cable----> [Printer Drawer Port]
                                              |
                                              | USB Cable
                                              ↓
                                         [Computer]
```

### Important Notes:
- Cash drawer must be connected to the **PRINTER**, not directly to computer
- Use the printer's **drawer/DK port** (not the USB port)
- Most thermal printers have a dedicated port labeled "DK", "DRAWER", or with a drawer icon

---

## 🔍 Testing Commands (Advanced)

Test if your printer can receive the drawer command:

```bash
# Create test file
printf "\x1B\x70\x00\x19\xFA" > /tmp/test_drawer.prn

# Send to printer (replace POS-80 with your printer name)
lp -d POS-80 -o raw /tmp/test_drawer.prn
```

If this opens the drawer, your hardware is working correctly!

---

## 📞 Need More Help?

If the cash drawer still doesn't work:

1. **Run the test script** and save the output:
   ```bash
   ./test_cash_drawer.sh > drawer_test_results.txt
   ```

2. **Check the app console** for error messages:
   - Open the app
   - Press `Cmd + Option + I` to open Developer Tools
   - Click Console tab
   - Try to open drawer
   - Take a screenshot of any errors

3. **Verify your printer model** supports ESC/POS and has a cash drawer port

4. **Contact support** with:
   - Printer model name
   - Test script results
   - Console error messages (if any)
   - Photos of printer ports and connections

---

## 📚 Documentation

- See [CASH_DRAWER_FIX.md](CASH_DRAWER_FIX.md) for technical details
- See [CASH_DRAWER_SETUP.md](CASH_DRAWER_SETUP.md) for full setup guide

---

## ✨ What Changed in the Code?

- ✅ Added 3 different methods to communicate with printers on macOS
- ✅ Better error messages that tell you exactly what's wrong
- ✅ Automatic fallback if one method doesn't work
- ✅ Improved logging for troubleshooting
- ✅ Fixed Windows support bug
- ✅ Added test script for easy diagnostics

**You're all set!** The cash drawer should now work when you complete cash sales and when you click the manual button. 🎉
