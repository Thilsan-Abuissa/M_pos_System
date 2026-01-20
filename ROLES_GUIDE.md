# 🔐 Role-Based Access Control Guide

## Overview

Your POS system now has **three user roles** with different permissions, just like a real supermarket system!

---

## 👥 User Roles & Access

### 🛒 **CASHIER** (Basic Access)
**What they can do:**
- ✅ **Checkout** - Process sales and complete transactions
- ✅ **Sales History** - View today's sales and receipts

**What they CANNOT do:**
- ❌ Add/edit/delete products
- ❌ View detailed reports
- ❌ Manage inventory
- ❌ Manage users

**Perfect for:** Front-line staff who only need to ring up customers

---

### 📊 **MANAGER** (Extended Access)
**What they can do:**
- ✅ **Checkout** - Process sales
- ✅ **Products** - Add, edit, delete products
- ✅ **Sales History** - View all transactions
- ✅ **Reports** - Generate sales reports and analytics
- ✅ **Inventory** - Monitor stock levels and restocking needs

**What they CANNOT do:**
- ❌ Manage users (add/edit/delete employees)

**Perfect for:** Store managers who need operational control

---

### 👑 **ADMIN** (Full Access)
**What they can do:**
- ✅ **Everything a Manager can do**
- ✅ **User Management** - Add, edit, delete users
- ✅ **Change Passwords** - Reset passwords for any user
- ✅ **Full System Control** - Complete access to all features

**Perfect for:** System administrators and business owners

---

## 🔑 Test Accounts

The system comes with three pre-configured accounts:

| Role | Username | Password | Description |
|------|----------|----------|-------------|
| 👑 Admin | `admin` | `admin123` | Full system access |
| 📊 Manager | `manager` | `manager123` | Store management |
| 🛒 Cashier | `cashier` | `cashier123` | Sales only |

---

## 🎯 How It Works

### Login Experience
1. Enter username and password
2. System validates credentials
3. UI automatically adjusts based on role
4. Only authorized sections are visible

### Navigation Menu
- **Cashiers** see: Checkout, Sales History
- **Managers** see: Checkout, Products, Sales, Reports, Inventory
- **Admins** see: Everything + Users tab

### Security Features
- ✅ Navigation buttons hidden for unauthorized roles
- ✅ Permission checks on all operations
- ✅ Role badges displayed next to user name
- ✅ Users cannot delete their own account
- ✅ Session-based authentication

---

## 👥 Managing Users (Admin Only)

### Add New User
1. Login as **admin**
2. Click **Users** tab in sidebar
3. Click **+ Add User** button
4. Fill in:
   - Username (unique)
   - Full Name
   - Password (min 6 characters)
   - Role (Cashier/Manager/Admin)
5. Click **Save User**

### Edit User
1. Go to **Users** tab
2. Click the **✏️** (pencil) icon
3. Update details (cannot change password here)
4. Click **Save User**

### Change Password
1. Go to **Users** tab
2. Click the **🔑** (key) icon
3. Enter new password (min 6 characters)
4. Confirm password
5. Click **Update Password**

### Delete User
1. Go to **Users** tab
2. Click the **🗑️** (trash) icon
3. Confirm deletion
4. **Note:** You cannot delete your own account

---

## 💼 Real-World Usage Scenarios

### Scenario 1: Supermarket with Multiple Cashiers
- **Owner** logs in as **Admin**
- Creates 5 **Cashier** accounts (cashier1, cashier2, etc.)
- Cashiers only see checkout screen
- Manager monitors inventory and generates reports
- Owner manages users and system settings

### Scenario 2: Small Store with Owner and Helper
- **Owner** is **Admin** - full control
- **Helper** is **Cashier** - can only process sales
- Helper cannot see business analytics or change prices

### Scenario 3: Chain with Store Managers
- **Regional Manager** is **Admin**
- **Store Managers** have **Manager** role
- **Cashiers** have **Cashier** role
- Clear hierarchy and controlled access

---

## 🔒 Security Best Practices

### For Admins:
1. **Change default passwords** immediately in production
2. Only create Admin accounts for trusted personnel
3. Regularly review user list and remove inactive accounts
4. Use strong passwords (mix of letters, numbers, symbols)
5. Never share Admin credentials

### For All Users:
1. **Logout** when leaving the workstation
2. Don't share your password with anyone
3. Report suspicious activity to Admin
4. Keep your password private

### Password Requirements:
- Minimum 6 characters (you can increase this)
- Should be unique per user
- Can be changed by Admin anytime

---

## 🎨 Visual Indicators

### Role Badges
Users see their role next to their name in the header:
- 🔴 **RED** = Admin
- 🟡 **YELLOW** = Manager  
- 🔵 **BLUE** = Cashier

### In User Management Table:
- Color-coded role badges for easy identification
- Edit/Delete/Password buttons for each user
- Created date for audit purposes

---

## 🚀 Quick Setup for Your Store

### Step 1: Login as Admin
```
Username: admin
Password: admin123
```

### Step 2: Change Admin Password
1. Go to **Users** tab
2. Click **🔑** next to admin
3. Set a strong password

### Step 3: Create Manager Account
1. Click **+ Add User**
2. Enter manager details
3. Select **Manager** role

### Step 4: Create Cashier Accounts
1. For each cashier, click **+ Add User**
2. Use format: cashier1, cashier2, etc.
3. Select **Cashier** role

### Step 5: Test Each Account
1. Logout
2. Login as each user
3. Verify they see correct screens

---

## 📱 Cashier Experience

When a cashier logs in, they see:
- **Large checkout area** with product search
- **Shopping cart** on the right
- **Quick product buttons** for common items
- **Simple sales history** for reprints
- **No access** to inventory or management

This keeps the interface clean and focused on their job!

---

## 📊 Manager Experience

When a manager logs in, they see:
- All cashier features
- **Product management** - add/edit products
- **Full reports** - sales analytics, top products
- **Inventory dashboard** - stock alerts
- Everything needed to run the store

---

## 👑 Admin Experience

When an admin logs in, they see:
- All manager features
- **User management** tab
- **Full system control**
- Can manage employees and access

---

## 🔧 Customization Options

### Want More Roles?
Edit `renderer/app.js` and add to `PERMISSIONS`:
```javascript
const PERMISSIONS = {
  cashier: ['checkout', 'sales'],
  manager: ['checkout', 'products', 'sales', 'reports', 'inventory'],
  supervisor: ['checkout', 'products', 'sales', 'reports'],  // New role!
  admin: ['checkout', 'products', 'sales', 'reports', 'inventory', 'users']
};
```

### Change Permission Levels?
Just modify the arrays in the `PERMISSIONS` object!

---

## ❓ Common Questions

**Q: Can a cashier see other cashiers' sales?**  
A: Yes, all sales are visible in the sales history to any user with sales access.

**Q: Can a manager create new users?**  
A: No, only Admins can manage users.

**Q: What happens if I forget the admin password?**  
A: You'll need to delete the database file (see README.md) or manually edit it.

**Q: Can I have multiple admins?**  
A: Yes! Create as many admin accounts as needed.

**Q: Do users stay logged in?**  
A: No, they must login each time the app starts. This is for security.

---

## 🎉 Summary

Your POS system now works like a **professional supermarket system** with:
- ✅ Role-based access control
- ✅ Three permission levels
- ✅ Secure user management
- ✅ Clean, role-specific interfaces
- ✅ Easy employee onboarding

**Perfect for real business use!** 🏪
