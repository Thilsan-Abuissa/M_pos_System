# 📋 ZFOC Scale Setup Checklist (Print This!)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│          🏪 ZFOC SCALE SETUP CHECKLIST - WINDOWS                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

BEFORE LEAVING CUSTOMER SITE, VERIFY ALL THESE:

┌─────────────────────────────────────────────────────────────────┐
│ HARDWARE CONNECTION                                             │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ Scale is plugged into PC USB port (directly, not through hub)
[ ] ✅ Scale power cable is connected
[ ] ✅ Scale is turned ON
[ ] ✅ Scale display shows "0.000" or current weight
[ ] ✅ USB cable is DATA cable (tested with phone)
[ ] ✅ Cable is firmly connected on both ends

┌─────────────────────────────────────────────────────────────────┐
│ WINDOWS DRIVER INSTALLATION                                     │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ Downloaded CH340/CH341 driver from official source
[ ] ✅ Ran SETUP.EXE as Administrator
[ ] ✅ Driver installation completed successfully
[ ] ✅ Computer was RESTARTED after driver installation
[ ] ✅ No error messages during installation

┌─────────────────────────────────────────────────────────────────┐
│ DEVICE MANAGER VERIFICATION                                     │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ Opened: Windows Key + X → Device Manager
[ ] ✅ Expanded "Ports (COM & LPT)" section
[ ] ✅ Can see: "USB-SERIAL CH340 (COMx)" or similar
[ ] ✅ NO yellow exclamation mark (!) on the device
[ ] ✅ Device shows "This device is working properly"
[ ] ✅ Port Settings are: 9600, 8, None, 1, None

COM Port Number: COM_____ (write down the number)

┌─────────────────────────────────────────────────────────────────┐
│ POS APPLICATION TEST                                            │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ Closed POS application completely
[ ] ✅ Restarted POS application
[ ] ✅ Logged in successfully
[ ] ✅ Navigated to Checkout screen
[ ] ✅ Placed test item on scale (e.g., 500g item)
[ ] ✅ Scale display shows correct weight
[ ] ✅ Weight is stable (not fluctuating)
[ ] ✅ Clicked a product button
[ ] ✅ Weight modal opened
[ ] ✅ Weight was read automatically (no manual entry needed)
[ ] ✅ Weight matches what scale display shows
[ ] ✅ Added item to cart successfully

Test Item Weight: ________ kg
POS Read Weight: ________ kg

┌─────────────────────────────────────────────────────────────────┐
│ MULTIPLE WEIGHT TEST                                            │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ Removed first item from scale
[ ] ✅ Placed different weight item (e.g., 1kg item)
[ ] ✅ Clicked another product
[ ] ✅ New weight read correctly
[ ] ✅ Added second item to cart
[ ] ✅ Both items show different, correct weights

┌─────────────────────────────────────────────────────────────────┐
│ STRESS TEST                                                     │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ Added 5+ items with different weights successfully
[ ] ✅ Completed a full transaction
[ ] ✅ Printed receipt
[ ] ✅ Started new transaction
[ ] ✅ Scale still reading correctly after 10 minutes
[ ] ✅ No timeout errors or disconnections

┌─────────────────────────────────────────────────────────────────┐
│ CUSTOMER TRAINING                                               │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ Showed customer how to place items on scale
[ ] ✅ Explained to wait for weight to stabilize
[ ] ✅ Showed "Read Again" button feature
[ ] ✅ Explained manual entry as backup
[ ] ✅ Gave customer QUICK_FIX_SCALE.md document
[ ] ✅ Showed customer test_scale_windows.bat file
[ ] ✅ Explained what to do if "Scale not connected" appears
[ ] ✅ Customer understands to keep scale powered ON always

┌─────────────────────────────────────────────────────────────────┐
│ DOCUMENTATION PROVIDED                                          │
└─────────────────────────────────────────────────────────────────┘

[ ] ✅ QUICK_FIX_SCALE.md (quick reference)
[ ] ✅ ZFOC_SCALE_WINDOWS_FIX.md (detailed troubleshooting)
[ ] ✅ test_scale_windows.bat (diagnostic tool)
[ ] ✅ Driver installer saved to Desktop

Driver Location: _____________________________________________

┌─────────────────────────────────────────────────────────────────┐
│ TROUBLESHOOTING INFORMATION COLLECTED                           │
└─────────────────────────────────────────────────────────────────┘

Customer Name: ________________________________________________

Business Name: ________________________________________________

Installation Date: ____/____/________

Windows Version: Windows _____ (10 / 11)

PC Model: ____________________________________________________

Scale Model: ZFOC

USB Port Used: Front ☐  Back ☐  Left ☐  Right ☐

COM Port: COM_____

Issues Encountered: _________________________________________

____________________________________________________________

____________________________________________________________

Resolution: ________________________________________________

____________________________________________________________

____________________________________________________________

Tested By: ___________________  Time: ____:____

Customer Signature: ________________________________________

┌─────────────────────────────────────────────────────────────────┐
│ ⚠️  IMPORTANT REMINDERS FOR CUSTOMER                            │
└─────────────────────────────────────────────────────────────────┘

  🔌 Keep scale powered ON during business hours

  ⚡ Don't unplug scale while POS is running
  
  🔄 If error appears: Run test_scale_windows.bat first
  
  📞 Contact support BEFORE trying to fix yourself
  
  💾 Keep driver installer file saved on Desktop
  
  ❌ Don't update Windows without testing scale after

┌─────────────────────────────────────────────────────────────────┐
│ SUPPORT CONTACT                                                 │
└─────────────────────────────────────────────────────────────────┘

Tech Support: _____________________________________________

Emergency: ________________________________________________

Email: ____________________________________________________

```

---

## 📸 Photo Documentation

Take photos of:
1. ✅ Scale connected to PC (full setup view)
2. ✅ Scale display showing weight
3. ✅ Device Manager with COM port visible
4. ✅ POS application showing successful weight read
5. ✅ Completed transaction receipt

Save photos as: `CustomerName_YYYYMMDD_ScaleSetup.jpg`

---

## ⭐ POST-INSTALLATION

Email customer:
- [ ] Copy of this checklist
- [ ] All troubleshooting documents
- [ ] Photos of working setup
- [ ] Support contact information
- [ ] Invoice/completion certificate

---

**Installation Verified By:** _____________________________

**Date:** ____________________  **Time:** ________________

**Customer Satisfaction:** ⭐⭐⭐⭐⭐ (circle stars)

---

**Keep this checklist for your records**
