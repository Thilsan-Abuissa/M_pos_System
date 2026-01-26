# Cash Drawer Setup Guide (Windows)

## Overview
The cash drawer needs to be properly configured to work with your receipt printer. The drawer opens by sending ESC/POS commands through the printer.

## Setup Steps

### 1. Connect Hardware
- Connect the cash drawer's RJ11/RJ12 cable to the **cash drawer port** on your receipt printer (not the USB port)
- Connect the receipt printer to your Windows PC via USB
- Turn on the printer

### 2. Install Printer Driver
- Download and install the driver for your thermal printer from the manufacturer's website
- Make sure the printer appears in Windows "Devices and Printers"

### 3. Configure Printer in POS System
1. Open the POS application
2. Login as **Admin** (username: `admin`, password: `admin123`)
3. Click **Settings** → **System Settings**
4. Scroll down to **Printer Settings**
5. Click **🔍 Detect** button to see available printers
6. Click on your printer name from the list (or enter it manually)
7. Click **💾 Save Settings**

### 4. Common Printer Names on Windows

#### USB Connection:
- Usually shows as: `POS-80`, `POS-58`, `XP-80C`, `RP80`
- May also be: `Generic / Text Only`

#### Serial/COM Port:
- Format: `\\.\COM1`, `\\.\COM3`, etc.
- Check in Device Manager → Ports (COM & LPT)

#### Network Printer:
- Format: `\\COMPUTERNAME\PrinterName`
- Or: IP address like `192.168.1.100`

### 5. Test Cash Drawer
1. Complete a sale with **Cash** payment
2. The drawer should open automatically
3. Or click the **💰 Cash Drawer** button directly

### 6. Troubleshooting

#### Drawer doesn't open:
1. **Check cable connection**: Make sure RJ11/RJ12 cable is connected to cash drawer port on printer
2. **Verify printer name**: Go to Windows Settings → Devices → Printers & scanners and copy exact printer name
3. **Check printer driver**: Some printers need specific drivers (not "Generic / Text Only")
4. **Test with printer software**: Most thermal printers come with test software - use it to verify drawer works
5. **Check COM port**: If using serial connection, verify correct COM port in Device Manager

#### Error Messages:
- **"No printer configured"**: Set printer name in System Settings
- **"Failed to communicate with printer"**: Check printer is turned on and driver is installed
- **"Access denied"**: Run POS as Administrator (right-click → Run as administrator)

### 7. Alternative Methods (Advanced)

#### Method A: Direct COM Port
If your printer uses a serial port:
```
Printer Name: \\.\COM1
(Replace COM1 with your actual COM port)
```

#### Method B: LPT Port (Parallel)
For older parallel port printers:
```
Printer Name: LPT1
```

#### Method C: Network Printer
For network/Ethernet printers:
```
Printer Name: \\192.168.1.100\printer
(Use your printer's IP address)
```

### 8. Hardware Compatibility

#### Supported Cash Drawers:
- Any RJ11/RJ12 compatible cash drawer
- 12V or 24V models (check your printer specs)
- Most Epson, Star, and generic POS drawers

#### Supported Printers:
- ESC/POS compatible thermal printers
- 58mm or 80mm models
- USB, Serial (COM), or Network connection

## Quick Test Checklist

- [ ] Cash drawer cable connected to printer
- [ ] Printer connected to PC and powered on
- [ ] Printer driver installed in Windows
- [ ] Printer name configured in POS Settings
- [ ] Settings saved
- [ ] Test sale completed with cash payment
- [ ] Cash drawer opens successfully

## Need Help?

If the drawer still doesn't open after following these steps:
1. Check the printer manufacturer's documentation
2. Verify the drawer works with the printer's test utility
3. Ensure you're using the correct ESC/POS command (the system uses standard commands)
4. Contact your hardware vendor for compatibility confirmation

---

**Last Updated:** January 2026
