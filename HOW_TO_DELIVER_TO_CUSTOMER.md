# 📦 HOW TO SEND TO YOUR CUSTOMER

## After Build Completes:

### **Step 1: Find the Built File**
Location: `dist/Supermarket POS.exe`
File Size: ~150-200 MB

### **Step 2: Create Customer Package**
1. Create a new folder named: `Supermarket_POS_Setup`
2. Copy these files into it:
   - `Supermarket POS.exe` (from dist folder)
   - `README_FOR_CUSTOMERS.md` (rename to `READ_ME_FIRST.txt`)

### **Step 3: ZIP the Package**
- Right-click the folder
- Select "Compress" or "Send to > Compressed folder"
- Result: `Supermarket_POS_Setup.zip`

### **Step 4: Send to Customer**
Send via:
- Email (if under 25MB)
- Google Drive / Dropbox / OneDrive
- USB Drive
- WeTransfer

---

## 📧 Email Template for Customer:

```
Subject: Supermarket POS Software - Installation Files

Hi [Customer Name],

Please find attached the Supermarket POS software.

Installation is very simple:
1. Extract the ZIP file
2. Open the folder
3. Double-click "Supermarket POS.exe"
4. Follow the setup wizard to create your admin account

That's it! No additional software needed.

Please read the "READ_ME_FIRST.txt" file for detailed instructions.

If you have any questions, feel free to contact me.

Best regards
```

---

## ⚠️ Important Notes:

✅ **What the customer gets:**
- Single .exe file (portable, no installation needed)
- First-run setup wizard (create their own password)
- Fresh database (empty, ready for their products)
- All features included

❌ **What the customer does NOT get:**
- Your database with your data
- Your products
- Your sales history
- Default passwords

✅ **Customer's first experience:**
1. Double-click .exe
2. See beautiful setup screen
3. Create admin username & password
4. Start using immediately

---

## 🔄 For Multiple Customers:

You can send the SAME .exe file to multiple customers.
Each customer will:
- Create their own unique admin credentials
- Have their own separate database
- Have independent data

---

## 💾 Database Location (for support):

Customer's data is saved in:
- **Windows:** `C:\Users\[Username]\AppData\Roaming\supermarket-pos\pos_database.db`
- **Mac:** `~/Library/Application Support/supermarket-pos/pos_database.db`

If customer needs backup/restore, this is the file to copy.

---

**Build Date:** January 19, 2026
**Version:** 1.0.0
