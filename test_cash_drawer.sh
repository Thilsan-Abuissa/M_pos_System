#!/bin/bash

# Cash Drawer Test Script for macOS
# This script tests if your printer can open the cash drawer

echo "=========================================="
echo "Cash Drawer Test Script"
echo "=========================================="
echo ""

# Check if lpstat command is available
if ! command -v lpstat &> /dev/null; then
    echo "❌ Error: lpstat command not found. CUPS printing system may not be installed."
    exit 1
fi

# List available printers
echo "📋 Available Printers:"
echo "=========================================="
lpstat -p -d
echo ""

# Ask user to enter printer name
echo "Please enter your printer name exactly as shown above:"
read -r PRINTER_NAME

if [ -z "$PRINTER_NAME" ]; then
    echo "❌ Error: No printer name entered"
    exit 1
fi

# Verify printer exists
if ! lpstat -p "$PRINTER_NAME" &> /dev/null; then
    echo "❌ Error: Printer '$PRINTER_NAME' not found"
    echo "Please check the spelling and try again"
    exit 1
fi

echo ""
echo "✅ Printer '$PRINTER_NAME' found"
echo ""

# Show printer device path
echo "📍 Printer Device Path:"
echo "=========================================="
lpstat -v "$PRINTER_NAME"
echo ""

# Create ESC/POS command file for opening cash drawer
TEMP_FILE="/tmp/drawer_test_$$.prn"
printf "\x1B\x70\x00\x19\xFA" > "$TEMP_FILE"

echo "🧪 Testing cash drawer with different methods..."
echo ""

# Method 1: With -o raw option
echo "Method 1: Trying with 'lp -o raw'..."
if lp -d "$PRINTER_NAME" -o raw "$TEMP_FILE" 2>/dev/null; then
    echo "✅ Method 1 succeeded! Command sent to printer."
    echo "   Check if your cash drawer opened."
    rm "$TEMP_FILE"
    echo ""
    echo "If the drawer opened, your setup is working correctly!"
    echo "Make sure this printer name is configured in the POS app settings."
    exit 0
fi
echo "⚠️  Method 1 failed. Trying alternative..."
echo ""

# Method 2: Without -o raw option
echo "Method 2: Trying without 'raw' option..."
if lp -d "$PRINTER_NAME" "$TEMP_FILE" 2>/dev/null; then
    echo "✅ Method 2 succeeded! Command sent to printer."
    echo "   Check if your cash drawer opened."
    rm "$TEMP_FILE"
    echo ""
    echo "If the drawer opened, your setup is working correctly!"
    echo "Make sure this printer name is configured in the POS app settings."
    exit 0
fi
echo "⚠️  Method 2 failed. Trying alternative..."
echo ""

# Method 3: Direct device write (try to find device path)
echo "Method 3: Trying direct device write..."
DEVICE_PATH=$(lpstat -v "$PRINTER_NAME" | grep -oE '(usb|serial|socket|lpd)://[^ ]+' | head -1)

if [ -n "$DEVICE_PATH" ]; then
    echo "Found device path: $DEVICE_PATH"
    
    # For USB devices on macOS, the actual device path is different
    if [[ $DEVICE_PATH == usb://* ]]; then
        echo "⚠️  USB printer detected. Direct device write not recommended for USB printers."
    else
        echo "Attempting direct write..."
        if cat "$TEMP_FILE" > "$DEVICE_PATH" 2>/dev/null; then
            echo "✅ Method 3 succeeded! Command sent to printer."
            echo "   Check if your cash drawer opened."
            rm "$TEMP_FILE"
            exit 0
        fi
    fi
fi

# Cleanup
rm -f "$TEMP_FILE"

# All methods failed
echo ""
echo "=========================================="
echo "❌ All methods failed"
echo "=========================================="
echo ""
echo "Possible issues:"
echo "1. Printer does not support ESC/POS commands"
echo "2. Cash drawer is not connected to the printer"
echo "3. Printer driver does not support raw data"
echo "4. Printer is offline or not responding"
echo ""
echo "Next steps:"
echo "1. Verify cash drawer cable is connected to printer's drawer port"
echo "2. Check if printer is online: System Preferences > Printers & Scanners"
echo "3. Try printing a test page to confirm printer works"
echo "4. Consult your printer manual for ESC/POS support and drawer port"
echo "5. Some printers require enabling cash drawer in their settings"
echo ""

exit 1
