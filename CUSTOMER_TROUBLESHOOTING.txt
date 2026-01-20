# 🔧 CUSTOMER TROUBLESHOOTING - If Login Appears Instead of Setup

## Problem:
You see a **LOGIN screen** with username/password fields instead of the **SETUP screen** to create your account.

## Solution:

### **Delete the app data folder and restart:**

1. **Close** the Supermarket POS application completely

2. **Press Windows Key + R** on your keyboard

3. **Type:** `%APPDATA%` and press **Enter**

4. **Find and DELETE** the folder named: `supermarket-pos`

5. **Double-click** `Supermarket POS.exe` again

6. You will now see the **SETUP screen** to create your account!

---

## Step-by-Step with Pictures:

### Step 1: Open Run Dialog
- Press **Windows Key + R** together
- A small window will appear

### Step 2: Type Command
- Type exactly: `%APPDATA%`
- Click OK

### Step 3: Delete Folder
- Look for folder: **supermarket-pos**
- Right-click it
- Click **Delete**

### Step 4: Restart App
- Go back to where you extracted the files
- Double-click **Supermarket POS.exe**
- Setup screen will appear!

---

## What This Does:
This deletes the old database file that might have been created during testing. After deleting, the app will be completely fresh and show the setup wizard.

---

**Need Help?** Contact your software provider.
