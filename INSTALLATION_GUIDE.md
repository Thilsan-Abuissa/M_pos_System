# Supermarket POS - Installation Guide

## For Your Friend (Simple Installation)

### Option 1: Send Entire Folder (Easiest)
1. **Compress the entire folder** `supermarket_pos` into a ZIP file
2. Send the ZIP file to your friend
3. Your friend needs to:
   - Install **Node.js** from https://nodejs.org (download and double-click installer)
   - Extract the ZIP file to any location (e.g., Desktop)
   - Open the folder
   - Double-click on `INSTALL_AND_RUN.bat` (Windows) or run terminal commands below

### Option 2: Create Installer (Professional)

#### To create installer file:
```bash
# Run this command on your Mac:
npm run build:win

# This creates: dist/Supermarket POS Setup.exe (for Windows)
# Or for Mac:
npm run build:mac

# This creates: dist/Supermarket POS.dmg (for Mac)
```

#### Send the installer:
1. Find the installer in the `dist` folder
2. Send **only the installer file** to your friend
3. Your friend double-clicks to install (no technical knowledge needed)

---

## Manual Installation (If no installer)

### Windows:
1. Install Node.js from https://nodejs.org
2. Extract the project folder
3. Open Command Prompt in the folder
4. Run:
   ```
   npm install
   npm start
   ```

### Mac/Linux:
1. Install Node.js from https://nodejs.org
2. Extract the project folder
3. Open Terminal in the folder
4. Run:
   ```bash
   npm install
   npm start
   ```

---

## Database & Data

### To share YOUR data with your friend:
- Include the file `pos_system.db` in the folder
- This contains all products, sales, users, and settings
- Your friend will have the exact same data as you

### Fresh installation:
- If `pos_system.db` is not included, a new database is created automatically
- Default login: **admin** / **admin123**

---

## Default Login:
- **Username:** admin
- **Password:** admin123

---

## System Requirements:
- Windows 10/11, macOS 10.13+, or Linux
- 4GB RAM minimum
- 500MB disk space
- Node.js 16+ (only if not using installer)

---

## Support:
For issues, check that:
1. Node.js is installed (if not using installer)
2. All files are in the same folder
3. The `pos_system.db` file is included for existing data
