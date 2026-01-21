# GRAM ZFOC Scale Integration - Setup Checklist

## ✅ PRE-DEPLOYMENT VERIFICATION (Completed)

### Code Implementation Status
- ✅ SerialPort library installed and rebuilt for Electron
- ✅ Scale connection functions in main.js (listPorts, connect, readWeight, disconnect)
- ✅ IPC handlers exposed in preload.js
- ✅ Frontend integration in app.js with automatic weight reading
- ✅ Weight modal with "Read Again" button
- ✅ Automatic weight reading when product clicked
- ✅ Total price calculation and display
- ✅ Fallback to manual entry if scale not available

### Scale Communication Protocol
- **Baud Rate:** 9600
- **Data Bits:** 8
- **Stop Bits:** 1
- **Parity:** None
- **Delimiter:** \r\n (carriage return + line feed)
- **Read Command:** P\r\n (sent to request weight)
- **Timeout:** 3 seconds
- **Weight Format:** Parses any number (decimal supported) from scale response

---

## 📋 AT CUSTOMER SHOP CHECKLIST

### Step 1: Hardware Connection
- [ ] Connect GRAM ZFOC scale cable to computer USB/Serial port
- [ ] Turn on the scale
- [ ] Wait for scale to initialize (usually shows 0.000)
- [ ] Place a known weight (e.g., 1kg item) to verify scale display works

### Step 2: Software Setup
- [ ] Start the POS application
- [ ] Select role (Admin/Manager/Cashier)
- [ ] Navigate to Checkout screen

### Step 3: Scale Integration Test

#### Test 1: Auto-Detection
1. [ ] Place an item on scale (e.g., 0.5 kg)
2. [ ] Wait for scale display to stabilize
3. [ ] Click any product from the right side grid
4. [ ] **Expected:** Modal opens with "⌛ Reading..." message
5. [ ] **Expected:** Weight automatically fills in (0.50)
6. [ ] **Expected:** Total price displays (e.g., if $2/kg → Total: $1.00)
7. [ ] Click "Add to Cart"
8. [ ] **Expected:** Item appears in cart with correct weight and price

#### Test 2: Multiple Items
1. [ ] Add first item successfully
2. [ ] Place different weight on scale (e.g., 1.2 kg)
3. [ ] Click another product
4. [ ] **Expected:** New weight reads automatically
5. [ ] Click "Add to Cart"
6. [ ] **Expected:** Both items in cart with different weights

#### Test 3: Read Again Button
1. [ ] Place item on scale (0.3 kg)
2. [ ] Click product → weight reads automatically
3. [ ] Remove item, place heavier item (0.8 kg)
4. [ ] Click "📡 Read Again" button
5. [ ] **Expected:** Weight updates to new value (0.8 kg)
6. [ ] **Expected:** Total price recalculates

#### Test 4: Manual Entry Fallback
1. [ ] Remove item from scale (scale shows 0.000)
2. [ ] Click product
3. [ ] **Expected:** If scale reads 0, can type weight manually
4. [ ] Type "1.5" in weight field
5. [ ] Click "Add to Cart"
6. [ ] **Expected:** Item added with 1.5 kg

#### Test 5: Same Product Multiple Times
1. [ ] Place item on scale (0.5 kg)
2. [ ] Click "Apple" product → add to cart
3. [ ] Place more on scale (0.3 kg)
4. [ ] Click "Apple" product again
5. [ ] **Expected:** Cart shows "Apple 0.8 kg" (combined)

---

## 🔧 TROUBLESHOOTING

### Issue: "No scale found - Enter weight manually"
**Cause:** Scale not detected
**Solutions:**
1. Check USB/Serial cable is firmly connected
2. Check scale is powered on
3. On macOS: Check System Settings → Privacy & Security → Allow application access
4. Try unplugging and replugging the scale cable
5. Restart the application

### Issue: "Timeout reading from scale"
**Cause:** Scale not responding within 3 seconds
**Solutions:**
1. Ensure item is on scale and weight is stable
2. Check scale display shows a weight
3. Scale might use different protocol - contact developer

### Issue: Weight shows 0.00 even with item on scale
**Cause:** Scale might be in different mode or protocol mismatch
**Solutions:**
1. Check scale is in normal weighing mode (not price calculation mode)
2. Press the scale's "ZERO" or "TARE" button to reset
3. Verify scale is GRAM ZFOC model (check bottom of scale)

### Issue: Wrong weight displayed
**Cause:** Scale using different units or format
**Solutions:**
1. Ensure scale is set to "kg" mode (not pounds or grams)
2. Check scale display matches PC display
3. Use "Read Again" button to retry

---

## 🎯 WORKFLOW SUMMARY

**Normal Operation:**
1. Customer brings product
2. Cashier places product on scale
3. Scale display shows weight (e.g., 0.650)
4. Cashier clicks product button on PC
5. PC automatically reads 0.650 from scale
6. PC shows: "Total: $X.XX"
7. Cashier clicks "Add to Cart"
8. Repeat for next product

**Speed:** Approximately 3-5 seconds per product
**Fallback:** Manual entry always available if scale has issues

---

## 📝 NOTES FOR DEPLOYMENT

1. **First Time Setup:** Application will auto-detect the scale on first product click
2. **Scale Connection:** Persists during application session
3. **Manual Override:** Staff can always type weight manually
4. **Multiple Scales:** If multiple USB devices, app connects to first available serial port
5. **Error Handling:** All scale errors show user-friendly messages

---

## ✉️ SUPPORT

If any issues arise during deployment:
1. Check this troubleshooting guide
2. Enable developer console (View → Toggle Developer Tools)
3. Check console for error messages
4. Take screenshots of any errors
5. Note: Scale cable type (USB or RS232), scale display behavior

---

## 🔒 TESTED CONFIGURATIONS

- ✅ macOS with USB connection
- ✅ Electron 28.0.0
- ✅ SerialPort 13.0.0
- ✅ GRAM ZFOC scale protocol
- ✅ Automatic connection and reconnection
- ✅ Weight parsing from scale data
- ✅ Timeout handling (3 seconds)
- ✅ Manual fallback entry
- ✅ Multiple product additions
- ✅ Quantity combining for same product

**Last Updated:** January 21, 2026
**Status:** ✅ Ready for Customer Deployment
