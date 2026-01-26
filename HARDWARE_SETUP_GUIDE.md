# Hardware Setup Guide for Supermarket POS System

## Equipment Required
- ✅ iggual TP Easy 80 (TP 7001) Thermal Printer
- ✅ iggual IRON-50 Cash Drawer
- ✅ GRAM ZFOC Scale
- 🖥️ Windows PC
- 🔌 USB cables
- 🔌 RJ11 cable (usually included with cash drawer)

---

## 🚀 Quick Start - Plug and Play!

**Good News:** The POS system now automatically detects all hardware when you plug them in!

### Simple 3-Step Setup:
1. **Install printer driver** (one-time only - see Step 1 below)
2. **Connect all cables** (USB and RJ11)
3. **Launch POS** - Everything works automatically! ✅

The system will:
- ✅ Auto-detect your thermal printer
- ✅ Auto-open cash drawer on cash payments
- ✅ Auto-connect to USB scale when weighing items

**No manual configuration needed!** 🎉

---

## Step 1: Install Epson TM-T20 Driver (One-Time Setup)

### Download the Driver
1. **Go to Epson's official website**: https://epson.com/Support/Printers/
2. Search for "**TM-T20**"
3. Select your Windows version (Windows 10/11)
4. Download the **Advanced Printer Driver** (APD)

### Alternative Download (if needed)
- Search Google for: "**Epson TM-T20 APD driver download**"
- Download from official Epson support page only

### Install the Driver
1. **Run the downloaded installer** (.exe file)
2. Click **Next** through the installation wizard
3. When asked to connect printer:
   - Connect your **iggual TP Easy 80** printer to USB port
   - Turn on the printer
   - Wait for Windows to detect it
4. **Important**: When asked to select printer model, choose "**Epson TM-T20**"
5. Complete the installation
6. Restart your computer if prompted

### Verify Installation
1. Open **Control Panel** → **Devices and Printers**
2. You should see a printer named "**Epson TM-T20**" or "**TM-T20**"
3. Right-click the printer → **Printer Properties** → **Print Test Page**
4. If test page prints successfully, driver is installed correctly ✅

---

## Step 2: Connect Hardware

### A. Connect the Thermal Printer
1. **Plug USB cable** from printer to PC
2. **Plug power adapter** into printer
3. **Turn on** the printer (switch on back/side)
4. **Wait** for Windows to recognize the device (may take 30 seconds)
5. **Check** that printer appears in "Devices and Printers" as "Epson TM-T20"

### B. Connect the Cash Drawer
1. **Locate the RJ11 port** on the back of your iggual TP Easy 80 printer
   - It looks like a telephone cable port
   - Usually labeled "DK" or "DRAWER" or "RJ11"
2. **Take the RJ11 cable** from your iggual IRON-50 cash drawer box
3. **Plug one end** into the cash drawer
4. **Plug the other end** into the printer's RJ11 port
5. **Plug power adapter** into cash drawer (if it has one)
6. **Important**: The drawer does NOT connect to the PC - it connects to the PRINTER only

### C. Connect the Scale
1. **Plug USB cable** from GRAM ZFOC scale to PC
2. **Turn on** the scale
3. **Wait 10 seconds** for Windows to install drivers automatically
4. The scale will be detected automatically by the POS software - no configuration needed ✅

---

## Step 3: Launch POS Application

### Start the Application
1. **Double-click** the POS application icon on desktop
2. **Login** with admin credentials:
   - Username: `admin`
   - Password: `admin123` (or your custom password)

**That's it!** The system will automatically:
- Detect your thermal printer when printing receipts
- Open the cash drawer on cash payments
- Connect to the scale when you weigh products

### Optional: Manual Printer Configuration
If you have multiple printers and want to specify which one to use:

1. Click on **⚙️ Settings** (gear icon in the sidebar)
2. Scroll down to **"Printer Settings"** section
3. In the **"Printer Name"** field, enter the exact printer name from Control Panel
4. Click **"Save Settings"**

To find your printer name:
1. Open **Control Panel** → **Devices and Printers**
2. Find your thermal printer and copy its exact name
3. Common names: `Epson TM-T20`, `TM-T20`, `EPSON TM-T20`

**Note:** If you don't configure a printer, the system will automatically use the first thermal printer it finds.

---

## Step 4: Test Everything

### Test the Scale
1. In POS application, go to **"Sales"** view
2. Click on any product that uses weight (fruits, vegetables, meat, etc.)
3. **Place item on scale**
4. Click the **"Read Scale"** button (or it may read automatically)
5. The weight should appear in the quantity field
6. **Troubleshooting:**
   - If weight doesn't appear, ensure scale is powered on
   - Check USB cable is securely connected
   - Try unplugging and replugging the USB cable
   - **The system auto-detects the scale** - no manual setup needed!

### Test Receipt Printing
1. Make a test sale:
   - Add any product to cart
   - Enter customer name (optional)
   - Click **"Complete Sale"** button
2. A receipt should print automatically on the thermal printer
3. **The system automatically finds your printer** - no configuration needed!
4. If it doesn't print:
   - Check printer is on and has paper
   - Verify Epson TM-T20 driver is installed
   - A Windows print dialog may appear as fallback - that's OK

### Test Cash Drawer
1. Make a test sale with **Cash payment**:
   - Add any product to cart
   - Select **"💵 Cash"** as payment method
   - Enter amount and click **"Complete Sale"**
2. The cash drawer should **automatically open** when sale completes
3. **The drawer opens automatically through the printer** - no setup needed!
4. If drawer doesn't open:
   - Check RJ11 cable is firmly connected to printer
   - Verify Epson TM-T20 driver is installed (not "80mm Series Printer")
   - Check cash drawer power cable is connected

---

## Troubleshooting

### Printer Not Found or Not Printing
**Problem**: POS shows "No printer found" or receipts don't print

**Solutions**:
1. ✅ **Check printer is ON and connected via USB**
2. ✅ **Verify Epson TM-T20 driver is installed** (Step 1 above)
3. ✅ Check printer status in Control Panel → Devices and Printers
   - Make sure printer shows "Ready" not "Offline" or "Error"
4. ✅ **The system auto-detects printers** - no manual configuration needed
5. If you have multiple printers, you can manually specify which one to use in Settings
6. Restart the POS application after connecting the printer

### Cash Drawer Not Opening
**Problem**: Drawer stays closed even after cash payment

**Solutions**:
1. ✅ **Check RJ11 cable** is firmly plugged into BOTH printer and drawer
2. ✅ **Verify Epson TM-T20 driver is installed** (not "80mm Series Printer")
   - Uninstall "80mm Series Printer" if present
   - Install Epson TM-T20 driver from Step 1
3. ✅ **Check drawer power cable** is connected (if your drawer has one)
4. ✅ **Test manually**: Settings → scroll to bottom → "Test Cash Drawer" button
5. ✅ Make sure printer is detected (receipts print successfully)
6. **The drawer opens automatically through the printer** - no extra configuration needed

### Scale Not Reading Weight
**Problem**: Weight stays at 0.000 or doesn't update

**Solutions**:
1. ✅ **Check USB cable is connected** securely
2. ✅ **Turn scale OFF then ON**
3. ✅ Unplug scale USB cable, wait 5 seconds, plug back in
4. ✅ **Place item on scale** - must have weight > 0 kg
5. ✅ Click the **"Read Scale"** button in the POS
6. ✅ **The system auto-connects to USB scales** - no manual setup needed!
7. Try different USB port on PC
8. Verify scale is GRAM ZFOC model or compatible
9. Restart POS application

### "No Scale Found" Message
**Problem**: System says "No scale found" when trying to weigh

**Solutions**:
1. ✅ **Connect scale to USB port**
2. ✅ Wait 5-10 seconds for Windows to recognize device
3. ✅ Make sure scale is powered ON
4. ✅ Try a different USB port (preferably USB 2.0)
5. ✅ Restart the POS application
6. **The system automatically detects USB scales when you click "Read Scale"**

### Receipt Prints from Windows Dialog Instead of Thermal Printer
**Problem**: Windows print dialog appears instead of direct thermal printing

**This is NORMAL** if:
- Epson TM-T20 driver not installed
- First time using the printer
- Printer is offline or has errors

**Solutions**:
1. ✅ Install Epson TM-T20 driver (see Step 1)
2. ✅ Check printer is online in Control Panel
3. ✅ Restart POS application after installing driver
4. If you're in a hurry, you can use Windows dialog temporarily - receipts will still print

---

## Quick Reference Card

### First-Time Setup (One Time Only)
1. ✅ Install Epson TM-T20 driver on Windows
2. ✅ Connect printer via USB
3. ✅ Connect cash drawer to printer via RJ11
4. ✅ Connect scale via USB
5. ✅ Launch POS - Everything works automatically!

### Daily Startup Checklist
- [ ] Turn on thermal printer
- [ ] Turn on scale  
- [ ] Connect USB cables (if unplugged)
- [ ] Launch POS application
- [ ] Login with your username
- [ ] **System auto-detects all devices!** ✅

### How It Works (Automatic Detection)
- **Printer:** System finds first thermal printer automatically
- **Cash Drawer:** Opens automatically through printer on cash sales
- **Scale:** Auto-connects when you click "Read Scale" button

### Manual Configuration (Optional)
Only needed if you have multiple printers or specific setup:
- Go to **Settings** → **Printer Settings**
- Enter exact printer name from Control Panel
- Save settings

### Support Information
**If you need help:**
1. Check this guide first
2. Take a photo of any error messages
3. Check printer status in Control Panel → Devices and Printers
4. Contact your POS system provider with:
   - Windows version
   - Printer name shown in Control Panel
   - Description of the problem
   - Any error messages

---

## Appendix: Driver Download Links

### Epson TM-T20 Driver
- **Official Site**: https://epson.com/Support/Printers/
- **Search term**: "TM-T20 Advanced Printer Driver"
- **Compatible with**: Windows 7, 8, 10, 11 (32-bit and 64-bit)
- **File size**: ~15-20 MB
- **Installation time**: 5-10 minutes

### Why Epson TM-T20 Driver Works with iggual TP Easy 80
- Both printers use ESC/POS command standard
- iggual TP Easy 80 is ESC/POS compatible
- Epson TM-T20 driver provides full ESC/POS support
- Generic Windows "80mm Series Printer" driver does NOT support hardware commands
- Using Epson driver enables: thermal printing, cash drawer control, barcode printing

---

**Setup Complete!** 🎉

Your POS system is now ready to use with:
- ✅ Thermal receipt printing
- ✅ Automatic cash drawer opening
- ✅ Weight scale integration
- ✅ Full sales tracking and analytics

**Happy selling!**
