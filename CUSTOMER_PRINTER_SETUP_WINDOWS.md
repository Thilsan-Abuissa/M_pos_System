# 💰 Cash Drawer Setup - Windows PC

## Quick Fix for Cash Drawer Not Opening

Hi! The cash drawer issue has been fixed. You just need to configure your printer name in the app.

---

## 🎯 3 Easy Steps:

### STEP 1: Find Your Printer Name

1. Press `Windows Key` on keyboard
2. Type: **Control Panel**
3. Click **Devices and Printers**
4. Find your receipt printer (the thermal printer)
5. **Write down the exact name** you see

Examples:
- `POS-80-Series`
- `EPSON TM-T88V Receipt`
- `Star TSP143`

---

### STEP 2: Enter Printer Name in POS App

1. Open the **POS application**
2. Login as **Admin** (use your admin username and password)
3. Click the **⚙️ Settings** button at the bottom of the screen
4. Click **🔧 System Settings** card
5. Find the **"Printer Name"** field
6. Type the EXACT printer name from Step 1
7. Click **💾 Save Settings**

---

### STEP 3: Test It!

1. Go back to the checkout screen
2. Click the **💵** button (top right corner, next to the search bar)
3. Your cash drawer should **POP OPEN!** 🎉

You can also test by:
- Adding items to cart
- Selecting **CASH** payment
- Clicking **COMPLETE SALE**
- Drawer will open automatically!

---

## ❌ Still Not Working?

### Problem: "No printer configured"
**Solution:** Go back to Step 2 and make sure you entered the printer name and clicked Save

### Problem: Error message or drawer doesn't open

**Check These:**

✅ **Printer is ON and ready**
- Look at Control Panel → Devices and Printers
- Printer should say "Ready" (not "Offline")
- If offline: Right-click → "See what's printing" → Printer menu → Uncheck "Use Printer Offline"

✅ **Printer name is correct**
- Must be EXACT (including spaces and capital letters)
- Example: `POS-80` is different from `POS 80` or `pos-80`

✅ **Cash drawer is connected**
- The cash drawer cable (looks like phone cable) plugs into the **PRINTER**, not the computer
- Look for a port on the printer labeled **"DK"** or **"DRAWER"**
- Cable should be plugged there

✅ **Test printer works**
- Try printing a test page from Windows
- Right-click printer → Printer Properties → Print Test Page
- If this doesn't work, fix the printer first

---

## 🔍 Advanced: Find Printer Name via Command

If you can't find the printer name:

1. Press `Windows Key + R`
2. Type: `cmd` and press Enter
3. Type this command and press Enter:
```
wmic printer get name
```

4. The list shows all printer names
5. Find your receipt printer name
6. Use that exact name in the POS app

---

## 📞 Need More Help?

If still not working, check:

1. **Is the cash drawer cable plugged into the printer?**
   - It's a cable that looks like a phone line (RJ11/RJ12)
   - Goes from drawer to printer (NOT to computer)

2. **Can you print receipts?**
   - If you can't print, the printer setup is the problem
   - Fix printer setup in Windows first

3. **Does your printer support cash drawer?**
   - Most thermal receipt printers do
   - Look for a port on the printer labeled "DK" or "DRAWER"
   - If no such port, your printer may not support cash drawer

4. **Take a screenshot:**
   - Settings → System Settings screen (showing printer name field)
   - Control Panel → Devices and Printers screen
   - Any error messages

---

## ✅ What Should Work Now:

- ✅ Complete CASH sale → Drawer opens automatically
- ✅ Click 💵 button → Drawer opens immediately
- ✅ Clear error messages if something is wrong

---

## 🎊 Success!

Once configured, the cash drawer will:
- Open automatically when you complete a **CASH** sale
- Open when you click the **💵** button
- Work reliably every time!

**That's it! You're all set!** 🎉

---

**Questions?** Contact your technical support with:
- Printer model/name
- Screenshot of Devices and Printers
- Any error messages from the app
