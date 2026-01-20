# 🚀 QUICK START GUIDE

## Your POS System is Ready!

The application should now be running on your Mac. If not, follow these steps:

### 1. Start the Application
```bash
cd /opt/homebrew/var/www/supermarket_pos
npm start
```

### 2. Login

**Try different user roles:**
- **Admin**: `admin` / `admin123` - Full access
- **Manager**: `manager` / `manager123` - Store operations  
- **Cashier**: `cashier` / `cashier123` - Sales only

**Note:** Each role sees different menu options!

### 3. Main Features

#### 🛒 **Checkout (Main Screen)**
- Use the search bar to scan barcodes or search for products
- Click on quick product cards for fast selection
- Adjust quantities with +/- buttons
- Select payment method
- Click "Complete Sale" to generate receipt

#### 📦 **Products**
- View all products in your inventory
- Add new products with the "+ Add Product" button
- Edit or delete existing products
- Search and filter products

#### 💰 **Sales History**
- View today's sales summary at the top
- See all transactions with details
- Click the eye icon to view receipts

#### 📊 **Reports**
- Select date range
- Generate sales reports
- View top-selling products
- Analyze daily sales

#### 📋 **Inventory**
- Monitor stock levels
- Identify low-stock items (highlighted in yellow)
- Out-of-stock items (highlighted in red)
- View total inventory value

### 4. Sample Products Included

The system comes with 10 pre-loaded products:
- Milk 1L ($3.99)
- Bread Whole Wheat ($2.49)
- Eggs 12 pack ($4.99)
- Apple per kg ($3.49)
- Orange Juice 1L ($5.99)
- Chicken Breast per kg ($12.99)
- Rice 2kg ($6.99)
- Pasta 500g ($2.99)
- Tomatoes per kg ($4.49)
- Cheese Cheddar 200g ($7.99)

### 5. Understanding User Roles

**🛒 CASHIER** sees only:
- Checkout screen
- Sales History

**📊 MANAGER** sees:
- Everything Cashier sees, plus:
- Products, Reports, Inventory

**👑 ADMIN** sees:
- Everything Manager sees, plus:
- User Management

**📖 For complete role details, see [ROLES_GUIDE.md](ROLES_GUIDE.md)**

### 6. Building for Production

#### For Mac:
```bash
npm run build:mac
```
Creates a `.dmg` installer in the `dist/` folder.

#### For Windows:
```bash
npm run build:win
```
Creates an `.exe` installer in the `dist/` folder.

### 6. Tips

- **Barcode Scanning**: The checkout screen accepts barcode input in the search field
- **Keyboard Shortcuts**: Press Enter in the search field to add products
- **Quick Products**: First 12 in-stock products appear as quick-select cards
- **Tax Rate**: Currently set to 10% (can be modified in app.js)
- **Receipt Printing**: Click the print button in the receipt modal

### 7. Database Location

Your database is stored at:
- **macOS**: `~/Library/Application Support/supermarket-pos/pos_database.db`

To reset the database, delete this file and restart the app.

### 8. Common Tasks

**Add a New Product:**
1. Go to Products tab
2. Click "+ Add Product"
3. Fill in details (barcode, name, price, stock)
4. Click "Save Product"

**Process a Sale:**
1. Stay on Checkout tab
2. Search or scan products
3. Adjust quantities if needed
4. Select payment method
5. Click "Complete Sale"
6. Receipt will be displayed

**View Sales Report:**
1. Go to Reports tab
2. Select date range
3. Click "Generate Report"
4. View summary and top products

**Add a New User (Admin Only):**
1. Go to Users tab
2. Click "+ Add User"
3. Enter username, full name, password
4. Select role (Cashier/Manager/Admin)
5. Click "Save User"

**Change User Password (Admin Only):**
1. Go to Users tab
2. Click the 🔑 icon next to the user
3. Enter new password twice
4. Click "Update Password"

### 9. Troubleshooting

**App won't start:**
```bash
cd /opt/homebrew/var/www/supermarket_pos
npm install
npx electron-rebuild
npm start
```

**Database errors:**
Delete the database file and restart the app to recreate it with sample data.

### 10. Need Help?

Check the README.md file for more detailed documentation.

---

**Enjoy your new POS system! 🎉**
