# 🛒 Supermarket POS System

A modern, cross-platform Point of Sale (POS) desktop application for supermarkets, built with Electron. Works on both **Windows** and **macOS**.

## ✨ Features

- **🛒 Checkout System**: Fast barcode scanning and product search
- **📦 Product Management**: Add, edit, delete products with inventory tracking
- **💰 Sales Tracking**: Complete sales history with receipt generation
- **📊 Reports & Analytics**: Sales reports, top products, and daily breakdowns
- **📋 Inventory Management**: Real-time stock levels with low-stock alerts
- **� User Management**: Add, edit, delete users with role-based access
- **🔐 Role-Based Access Control**: Three permission levels (Cashier, Manager, Admin)
- **🖨️ Receipt Printing**: Professional receipt generation and printing
- **💳 Multiple Payment Methods**: Cash, card, and mobile payment support

## 🎯 User Roles

### 👤 Three Permission Levels:

1. **🛒 Cashier** - Checkout and sales only (perfect for front-line staff)
2. **📊 Manager** - All operations except user management (store managers)
3. **👑 Admin** - Full system access including user management (owners)

See [ROLES_GUIDE.md](ROLES_GUIDE.md) for detailed role documentation.

## 🚀 Quick Start

### Prerequisites

- **Node.js** (version 16 or higher)
- **npm** (comes with Node.js)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the application:**
   ```bash
   npm start
   ```

### Default Login Credentials

**Try different roles:**
- **Admin**: `admin` / `admin123` (Full access)
- **Manager**: `manager` / `manager123` (Store operations)
- **Cashier**: `cashier` / `cashier123` (Sales only)

## 📦 Sample Data

The application comes with 10 sample products pre-loaded:
- Dairy products (Milk, Eggs, Cheese)
- Bakery items (Bread)
- Produce (Apples, Tomatoes)
- Beverages (Orange Juice)
- Meat (Chicken Breast)
- Grains (Rice, Pasta)

## 💻 Building for Distribution

### Build for macOS:
```bash
npm run build:mac
```

This creates a `.dmg` installer in the `dist/` folder.

### Build for Windows:
```bash
npm run build:win
```

This creates an `.exe` installer in the `dist/` folder.

### Build for both platforms:
```bash
npm run build:all
```

**Note**: To build for Windows on Mac, you may need to install additional dependencies:
```bash
brew install wine
```

## 📱 How to Use

### 1. Checkout (Main POS Screen)
- **Scan or search products** using the barcode input
- **Click quick products** for fast selection
- **Adjust quantities** using +/- buttons
- **Select payment method** (Cash/Card/Mobile)
- **Complete sale** to generate receipt

### 2. Product Management
- **Add new products** with barcode, price, and stock
- **Edit existing products** to update details
- **Delete products** that are discontinued
- **Search and filter** to find products quickly

### 3. Sales History
- View **today's sales** summary
- See **transaction details** including items and totals
- **View receipts** for past transactions

### 4. Reports
- Generate **sales reports** for any date range
- View **top-selling products**
- See **daily sales breakdowns**
- Track **revenue and transactions**

### 5. Inventory
- Monitor **stock levels** for all products
- Identify **low stock** and **out of stock** items
- View **total inventory value**
- Plan **restocking** based on minimum stock levels

### 6. User Management (Admin Only)
- **Add new users** with specific roles
- **Edit user details** and change roles
- **Reset passwords** for any user
- **Delete users** who leave the organization
- View user **creation dates** for audit

## 🔐 Security & Roles

### Technologies Used
- **Electron**: Cross-platform desktop framework
- **SQLite**: Embedded database (better-sqlite3)
- **HTML/CSS/JavaScript**: Modern web technologies
- **Node.js**: JavaScript runtime

### Database Schema
- **products**: Product catalog with pricing and inventory
- **sales**: Transaction records
- **sale_items**: Individual items in each transaction
- **users**: User authentication and roles

### File Structure
```
supermarket_pos/
├── main.js              # Electron main process
├── preload.js           # Secure IPC bridge
├── database.js          # Database operations
├── package.json         # Project configuration
├── renderer/            # Frontend files
│   ├── index.html       # Main UI
│   ├── styles.css       # Styling
│   └── app.js           # Frontend logic
└── README.md            # Documentation
```

## 🔐 Security Features

- **Context isolation** enabled
- **Node integration** disabled in renderer
- **Secure IPC** communication via preload script
- **User authentication** with role-based access

## 📊 Database Location

The SQLite database is stored in:
- **macOS**: `~/Library/Application Support/supermarket-pos/pos_database.db`
- **Windows**: `%APPDATA%/supermarket-pos/pos_database.db`

## 🎨 Customization

### Adding More Users
Currently, users must be added directly to the database. Future versions will include a user management interface.

### Tax Configuration
Tax rate is set to 10% by default. To change it, edit the tax calculation in:
- `renderer/app.js` (line with `const tax = subtotal * 0.10`)

### Receipt Branding
Modify the receipt template in `renderer/app.js` in the `showReceipt()` function.

## 🐛 Troubleshooting

### Database Issues
If you encounter database errors, delete the database file and restart the app. A new database with sample data will be created.

### Build Errors
Make sure you have the latest version of Node.js and all dependencies installed:
```bash
npm install
```

### Permission Issues (macOS)
If the app doesn't open, you may need to allow it in System Preferences > Security & Privacy.

## 📝 Development

### Run in Development Mode
```bash
npm run dev
```
This opens the app with Developer Tools enabled.

### Modify Database Schema
Edit `database.js` and delete the existing database file to recreate it with the new schema.

## 🚀 Future Enhancements

- [ ] Barcode scanner hardware integration
- [ ] Multi-store support
- [ ] Customer loyalty program
- [ ] Employee time tracking
- [ ] Advanced reporting dashboard
- [ ] Email receipt option
- [ ] Discount/promotion system
- [ ] Supplier management
- [ ] Purchase order system

## 📄 License

MIT License - feel free to use and modify for your business needs.

## 🤝 Support

For issues or questions, please create an issue in the project repository.

---

**Built with ❤️ for small businesses**
