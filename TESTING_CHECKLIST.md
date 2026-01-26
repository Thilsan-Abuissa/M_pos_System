# Testing Checklist - Plug and Play Hardware

## ✅ Pre-Deployment Testing

### System Requirements
- [ ] Windows 10/11 or macOS installed
- [ ] Epson TM-T20 driver installed
- [ ] All devices physically connected
- [ ] POS application installed

---

## 🖨️ Printer Auto-Detection Test

### Test 1: Printer Not Configured (Auto-Detection)
1. [ ] Open database file, ensure `printer_name` is NULL/empty
2. [ ] Connect thermal printer via USB
3. [ ] Turn on printer
4. [ ] Launch POS application
5. [ ] Login as admin
6. [ ] Make a test sale with any product
7. [ ] Click "Complete Sale"
8. [ ] **Expected:** Receipt prints automatically to thermal printer
9. [ ] **Verify:** Console log shows "Auto-detected printer: [printer_name]"

### Test 2: Multiple Printers (Auto-Select Thermal)
1. [ ] Connect multiple printers (1 thermal + 1 regular)
2. [ ] Launch POS application
3. [ ] Make a test sale
4. [ ] Click "Complete Sale"
5. [ ] **Expected:** Receipt prints to thermal printer (not regular printer)
6. [ ] **Verify:** System selected printer with "TM|Epson|iggual|thermal" in name

### Test 3: Manual Printer Configuration (Override)
1. [ ] Go to Settings → Printer Settings
2. [ ] Enter specific printer name: "Epson TM-T20"
3. [ ] Click Save
4. [ ] Make a test sale
5. [ ] **Expected:** Receipt prints to specified printer
6. [ ] **Verify:** System uses configured printer instead of auto-detecting

### Test 4: No Printer Connected
1. [ ] Disconnect all printers
2. [ ] Make a test sale
3. [ ] Click "Complete Sale"
4. [ ] **Expected:** Windows print dialog appears (fallback mode)
5. [ ] **Verify:** Error message: "No printer found"

---

## 💰 Cash Drawer Auto-Open Test

### Test 5: Cash Drawer Opens Automatically
1. [ ] Connect cash drawer to printer via RJ11
2. [ ] Ensure drawer power is connected
3. [ ] Make a test sale
4. [ ] Select **Cash** as payment method
5. [ ] Click "Complete Sale"
6. [ ] **Expected:** Cash drawer pops open automatically
7. [ ] **Verify:** No error messages in console

### Test 6: Cash Drawer with Auto-Detected Printer
1. [ ] Clear printer configuration (set to NULL)
2. [ ] Let system auto-detect printer
3. [ ] Make a cash sale
4. [ ] **Expected:** Drawer opens with auto-detected printer
5. [ ] **Verify:** Console shows "Cash drawer opened via printer: [auto-detected name]"

### Test 7: Non-Cash Payments (Drawer Should NOT Open)
1. [ ] Make a sale with **Card** payment
2. [ ] **Expected:** Drawer does NOT open
3. [ ] Make a sale with **Mobile** payment
4. [ ] **Expected:** Drawer does NOT open

### Test 8: Manual Drawer Test
1. [ ] Go to Settings (bottom of page)
2. [ ] Click "Test Cash Drawer" button
3. [ ] **Expected:** Drawer opens immediately
4. [ ] **Verify:** Success message displayed

### Test 9: Drawer with RJ11 Disconnected
1. [ ] Disconnect RJ11 cable
2. [ ] Make a cash sale
3. [ ] **Expected:** Drawer does not open (no crash/error)
4. [ ] **Verify:** Appropriate error message shown

---

## ⚖️ Scale Auto-Connection Test

### Test 10: Scale Auto-Connects on Startup
1. [ ] Connect USB scale
2. [ ] Turn on scale
3. [ ] Launch POS application
4. [ ] Wait 3 seconds
5. [ ] **Verify:** Console log shows "Scale auto-connected successfully"
6. [ ] **Verify:** No errors in console

### Test 11: Scale Reads Weight Automatically
1. [ ] Go to Sales view
2. [ ] Click on a weight-based product (e.g., "Apples - per kg")
3. [ ] Place item on scale (e.g., 0.5 kg)
4. [ ] Click "Read Scale" button
5. [ ] **Expected:** Weight appears in field (e.g., "0.500")
6. [ ] **Expected:** Total price calculated (e.g., "€2.50" if €5/kg)
7. [ ] Click "Add to Cart"
8. [ ] **Verify:** Product added with correct weight and price

### Test 12: Scale Reconnects if Disconnected
1. [ ] Unplug scale USB cable during operation
2. [ ] Click on weight-based product
3. [ ] Plug USB cable back in
4. [ ] Wait 2 seconds
5. [ ] Click "Read Scale" button
6. [ ] **Expected:** System auto-reconnects and reads weight
7. [ ] **Verify:** Console shows "Found scale on: [port]"

### Test 13: No Scale Connected
1. [ ] Disconnect scale completely
2. [ ] Click on weight-based product
3. [ ] Click "Read Scale" button
4. [ ] **Expected:** Message "No scale found. Please connect USB scale."
5. [ ] **Expected:** User can still enter weight manually
6. [ ] Enter weight manually (e.g., 0.5)
7. [ ] **Verify:** Product adds correctly with manual weight

### Test 14: Scale Shows Zero Weight
1. [ ] Scale connected but nothing on it (0.000 kg)
2. [ ] Click on weight-based product
3. [ ] Click "Read Scale"
4. [ ] **Expected:** Message "Scale shows 0 kg. Please place item on scale"
5. [ ] Place item on scale
6. [ ] Click "Read Scale" again
7. [ ] **Expected:** Weight reads correctly

---

## 🔄 Integration Tests

### Test 15: Complete Sale Flow (All Devices)
1. [ ] Start POS application (all devices connected)
2. [ ] Login as cashier
3. [ ] Add regular product (barcode scan or click)
4. [ ] Add weight-based product:
   - [ ] Click product
   - [ ] Place on scale
   - [ ] Click "Read Scale"
   - [ ] Verify weight appears
   - [ ] Click "Add to Cart"
5. [ ] Select **Cash** payment
6. [ ] Click "Complete Sale"
7. [ ] **Expected Results:**
   - [ ] Receipt prints automatically
   - [ ] Cash drawer opens automatically
   - [ ] Sale saved to database
   - [ ] Cart clears
   - [ ] Success message shown

### Test 16: Rapid Multiple Sales
1. [ ] Make 5 sales in quick succession
2. [ ] Alternate cash and card payments
3. [ ] **Expected:** All receipts print correctly
4. [ ] **Expected:** Drawer only opens for cash sales
5. [ ] **Verify:** No print queue backlog or errors

### Test 17: Cold Start (Nothing Configured)
1. [ ] Fresh database (no printer configured)
2. [ ] All devices connected
3. [ ] Launch POS for first time
4. [ ] Complete setup wizard
5. [ ] Make a sale
6. [ ] **Expected:** Everything works without configuration
7. [ ] **Verify:** Auto-detection working from first run

---

## 🔍 Error Recovery Tests

### Test 18: Printer Disconnected During Sale
1. [ ] Start a sale
2. [ ] Add products
3. [ ] Unplug printer
4. [ ] Click "Complete Sale"
5. [ ] **Expected:** Fallback to Windows print dialog
6. [ ] **Verify:** Sale still completes and saves

### Test 19: App Restart with Devices Connected
1. [ ] Close POS application
2. [ ] Keep all devices connected
3. [ ] Reopen POS application
4. [ ] **Expected:** All devices auto-detect again
5. [ ] Make a test sale
6. [ ] **Verify:** Everything works

### Test 20: USB Port Change
1. [ ] Unplug scale from USB port A
2. [ ] Plug scale into USB port B
3. [ ] Click "Read Scale"
4. [ ] **Expected:** System finds scale on new port
5. [ ] **Verify:** Weight reads correctly

---

## 📊 Performance Tests

### Test 21: Startup Time
1. [ ] Measure app launch time
2. [ ] **Expected:** < 5 seconds to login screen
3. [ ] **Expected:** Scale connects within 2-3 seconds after login
4. [ ] **Verify:** No significant delay

### Test 22: Print Speed
1. [ ] Make 10 consecutive sales
2. [ ] Measure time from "Complete Sale" to receipt printed
3. [ ] **Expected:** < 3 seconds per receipt
4. [ ] **Verify:** No print queue buildup

### Test 23: Scale Read Speed
1. [ ] Click "Read Scale" button
2. [ ] Measure time to display weight
3. [ ] **Expected:** < 2 seconds
4. [ ] **Verify:** Consistent timing across multiple reads

---

## 🖥️ Cross-Platform Tests (if applicable)

### Test 24: Windows 10
- [ ] All printer tests pass
- [ ] All drawer tests pass
- [ ] All scale tests pass

### Test 25: Windows 11
- [ ] All printer tests pass
- [ ] All drawer tests pass
- [ ] All scale tests pass

### Test 26: macOS (if supported)
- [ ] Printer auto-detection works (lpstat)
- [ ] Drawer opens via printer
- [ ] Scale connects and reads

---

## ✅ Final Validation

### Pre-Deployment Checklist
- [ ] All 26 tests passed
- [ ] No critical errors in console
- [ ] Performance meets requirements
- [ ] Documentation updated and accurate
- [ ] Customer training materials prepared

### Known Limitations (Document These)
- [ ] Requires Epson TM-T20 driver for ESC/POS commands
- [ ] Cash drawer must be connected to printer (not PC)
- [ ] Scale must be USB serial (9600 baud)
- [ ] Windows print dialog fallback if no thermal printer

---

## 🐛 Bug Reporting Template

If any test fails, document:
```
Test Number: [e.g., Test 5]
Test Name: [e.g., Cash Drawer Opens Automatically]
Expected: [What should happen]
Actual: [What actually happened]
Error Messages: [Console logs]
Environment: [Windows 10/11, POS version]
Steps to Reproduce:
1. [Step 1]
2. [Step 2]
...
```

---

## 📝 Sign-Off

**Tested By:** ___________________  
**Date:** ___________________  
**Version:** 1.0.0 - Plug and Play Edition  
**Result:** ☐ PASS ☐ FAIL  

**Notes:**
_____________________________________________
_____________________________________________
_____________________________________________

---

**All tests must pass before customer deployment!** ✅
