# Customer Display Setup Instructions

## PREMIER CD-220 U (USB) VFD Customer Display

This POS supports a 2-line × 20-character VFD customer display (like PREMIER CD-220 U) via USB-Serial.

### What the customer should see (example)

When you add an item to cart:

- Line 1: item name
- Line 2: quantity/weight and calculation

Example (like the reference photo):

Line 1: `CHUMBOS`

Line 2: `0.235x 5.50 = 1.29`

### Windows setup (recommended)

1. Plug the display into USB
2. Open **Device Manager** → **Ports (COM & LPT)**
3. Find the display port (often **Prolific PL2303**) and note the COM number (example: `COM12`)

Then set the environment variables (Command Prompt):

```
setx CUSTOMER_DISPLAY_PORT COM12
setx CUSTOMER_DISPLAY_LINE2_OFFSET 0x14
```

Restart the POS application after running `setx`.

Notes:

- `CUSTOMER_DISPLAY_PORT` forces the app to use the correct COM port (recommended). This also prevents the POS from accidentally opening the **scale** COM port.
- `CUSTOMER_DISPLAY_LINE2_OFFSET` fixes displays that otherwise print line 2 in the wrong place.
  - PREMIER CD-220 U typically uses `0x14`.
  - If your display still prints wrong, try `0x40` instead.

### Quick test

On Windows, double-click:

- `test_customer_display.bat`

It will ask for the COM port and run `test_customer_display.js` with the correct settings.

### Hardware defaults

- 9600 baud, 8 data bits, no parity, 1 stop bit (8N1)
- 2 lines × 20 chars