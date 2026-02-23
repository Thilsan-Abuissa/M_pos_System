const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

class POSDatabase {
  constructor() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pos_database.db');
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  initializeDatabase() {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'General',
        price REAL NOT NULL,
        regular_price REAL,
        sale_price REAL,
        discount_percent REAL DEFAULT 0,
        cost REAL,
        tax_rate REAL DEFAULT 0.19,
        stock INTEGER DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_sale_id INTEGER NOT NULL,
        return_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        subtotal REAL NOT NULL,
        tax REAL DEFAULT 0,
        total REAL NOT NULL,
        refund_method TEXT,
        cashier_id INTEGER,
        reason TEXT,
        notes TEXT,
        FOREIGN KEY (original_sale_id) REFERENCES sales(id)
      );
      
      CREATE TABLE IF NOT EXISTS return_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        subtotal REAL NOT NULL,
        FOREIGN KEY (return_id) REFERENCES returns(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        subtotal REAL NOT NULL,
        tax REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        total REAL NOT NULL,
        payment_method TEXT,
        payment_amount REAL DEFAULT 0,
        change_amount REAL DEFAULT 0,
        cashier_id INTEGER,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        subtotal REAL NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT DEFAULT 'cashier',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT UNIQUE NOT NULL,
        customer_type TEXT DEFAULT 'regular',
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        restaurant_name TEXT,
        restaurant_nie TEXT,
        sale_id INTEGER NOT NULL,
        loan_amount REAL NOT NULL,
        paid_amount REAL DEFAULT 0,
        remaining_amount REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        loan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_date DATETIME,
        payment_method TEXT,
        cashier_id INTEGER,
        notes TEXT,
        FOREIGN KEY (sale_id) REFERENCES sales(id)
      );

      CREATE TABLE IF NOT EXISTS z_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_number TEXT UNIQUE NOT NULL,
        report_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        start_datetime DATETIME NOT NULL,
        end_datetime DATETIME NOT NULL,
        cashier_id INTEGER NOT NULL,
        cashier_name TEXT NOT NULL,
        total_sales INTEGER DEFAULT 0,
        total_returns INTEGER DEFAULT 0,
        net_sales_count INTEGER DEFAULT 0,
        gross_sales REAL DEFAULT 0,
        total_returns_amount REAL DEFAULT 0,
        net_sales REAL DEFAULT 0,
        cash_sales REAL DEFAULT 0,
        card_sales REAL DEFAULT 0,
        loan_sales REAL DEFAULT 0,
        total_sales_amount REAL DEFAULT 0,
        total_expenses REAL DEFAULT 0,
        expense_description TEXT,
        tax_7_base REAL DEFAULT 0,
        tax_7_amount REAL DEFAULT 0,
        tax_19_base REAL DEFAULT 0,
        tax_19_amount REAL DEFAULT 0,
        total_tax REAL DEFAULT 0,
        expected_cash REAL DEFAULT 0,
        actual_cash REAL,
        cash_difference REAL,
        notes TEXT,
        FOREIGN KEY (cashier_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
      CREATE INDEX IF NOT EXISTS idx_loans_receipt ON loans(receipt_number);
      CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
      CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
      CREATE INDEX IF NOT EXISTS idx_z_reports_date ON z_reports(report_date);
      CREATE INDEX IF NOT EXISTS idx_z_reports_number ON z_reports(report_number);

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_date DATE NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
      CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        tax_rate REAL DEFAULT 0,
        is_favorite INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS subcategories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        parent_id INTEGER,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES subcategories(id) ON DELETE CASCADE,
        UNIQUE(category_id, parent_id, name)
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        store_name TEXT DEFAULT 'SUPERMARKET POS',
        store_logo TEXT,
        owner_name TEXT,
        nie_number TEXT,
        company_address TEXT,
        currency_symbol TEXT DEFAULT '€',
        currency_code TEXT DEFAULT 'EUR',
        tax_rate REAL DEFAULT 0.19,
        receipt_footer TEXT DEFAULT 'Vielen Dank für Ihren Einkauf!',
        printer_name TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default settings if not exists
    const settingsCount = this.db.prepare('SELECT COUNT(*) as count FROM system_settings').get();
    if (settingsCount.count === 0) {
      this.db.prepare(`
        INSERT INTO system_settings (id, store_name, currency_symbol, currency_code, tax_rate)
        VALUES (1, 'SUPERMARKET POS', '€', 'EUR', 0.19)
      `).run();
    }
    
    // Update existing settings to Euro if still using USD
    const currentSettings = this.db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    if (currentSettings && currentSettings.currency_code === 'USD') {
      this.db.prepare(`
        UPDATE system_settings 
        SET currency_symbol = '€', 
            currency_code = 'EUR',
            tax_rate = 0.19,
            receipt_footer = 'Vielen Dank für Ihren Einkauf!'
        WHERE id = 1
      `).run();
    }

    // Add is_favorite column to categories table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE categories ADD COLUMN is_favorite INTEGER DEFAULT 0').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding is_favorite column:', error);
      }
    }
    
    // Add split_payments column to sales table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE sales ADD COLUMN split_payments TEXT').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding split_payments column:', error);
      }
    }
    
    // Add printer_name column to system_settings table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE system_settings ADD COLUMN printer_name TEXT').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding printer_name column:', error);
      }
    }

    // Add new columns to z_reports table if they don't exist
    try {
      this.db.prepare('ALTER TABLE z_reports ADD COLUMN total_sales_amount REAL DEFAULT 0').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding total_sales_amount column:', error);
      }
    }

    try {
      this.db.prepare('ALTER TABLE z_reports ADD COLUMN total_expenses REAL DEFAULT 0').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding total_expenses column:', error);
      }
    }

    try {
      this.db.prepare('ALTER TABLE z_reports ADD COLUMN expense_description TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding expense_description column:', error);
      }
    }

    // Add payment_amount and change_amount columns to sales table if they don't exist
    try {
      this.db.prepare('ALTER TABLE sales ADD COLUMN payment_amount REAL DEFAULT 0').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding payment_amount column:', error);
      }
    }

    try {
      this.db.prepare('ALTER TABLE sales ADD COLUMN change_amount REAL DEFAULT 0').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding change_amount column:', error);
      }
    }

    // Add subcategory column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN subcategory TEXT').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding subcategory column:', error);
      }
    }

    // Add image column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN image TEXT').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding image column:', error);
      }
    }

    // Add parent_id column to subcategories table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE subcategories ADD COLUMN parent_id INTEGER REFERENCES subcategories(id) ON DELETE CASCADE').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding parent_id column:', error);
      }
    }

    // Add company information columns to system_settings table if they don't exist
    try {
      this.db.prepare('ALTER TABLE system_settings ADD COLUMN owner_name TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding owner_name column:', error);
      }
    }

    try {
      this.db.prepare('ALTER TABLE system_settings ADD COLUMN nie_number TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding nie_number column:', error);
      }
    }

    try {
      this.db.prepare('ALTER TABLE system_settings ADD COLUMN company_address TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding company_address column:', error);
      }
    }

    // Add unit_type column to products table if it doesn't exist (weight or quantity)
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN unit_type TEXT DEFAULT "weight"').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding unit_type column:', error);
      }
    }

    // Add weight_unit column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN weight_unit TEXT DEFAULT "kg"').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding weight_unit column:', error);
      }
    }

    // Add quantity_unit column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN quantity_unit TEXT DEFAULT "piece"').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding quantity_unit column:', error);
      }
    }

    // Add weight_amount column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN weight_amount TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding weight_amount column:', error);
      }
    }

    // Add quantity_amount column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN quantity_amount TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding quantity_amount column:', error);
      }
    }

    // Don't create default users - let setup wizard handle it
    // System will check if any admin exists, if not show setup wizard

    // Insert sample products if table is empty
    const productCount = this.db.prepare('SELECT COUNT(*) as count FROM products').get();
    if (productCount.count === 0) {
      this.insertSampleProducts();
    }
  }

  insertSampleProducts() {
    const products = [
      { barcode: '1234567890123', name: 'Milk 1L', category: 'Dairy', price: 3.99, cost: 2.50, stock: 50 },
      { barcode: '1234567890124', name: 'Bread Whole Wheat', category: 'Bakery', price: 2.49, cost: 1.20, stock: 30 },
      { barcode: '1234567890125', name: 'Eggs (12 pack)', category: 'Dairy', price: 4.99, cost: 3.00, stock: 40 },
      { barcode: '1234567890126', name: 'Apple (per kg)', category: 'Produce', price: 3.49, cost: 2.00, stock: 100 },
      { barcode: '1234567890127', name: 'Orange Juice 1L', category: 'Beverages', price: 5.99, cost: 3.50, stock: 25 },
      { barcode: '1234567890128', name: 'Chicken Breast (per kg)', category: 'Meat', price: 12.99, cost: 8.00, stock: 20 },
      { barcode: '1234567890129', name: 'Rice 2kg', category: 'Grains', price: 6.99, cost: 4.00, stock: 35 },
      { barcode: '1234567890130', name: 'Pasta 500g', category: 'Grains', price: 2.99, cost: 1.50, stock: 45 },
      { barcode: '1234567890131', name: 'Tomatoes (per kg)', category: 'Produce', price: 4.49, cost: 2.50, stock: 60 },
      { barcode: '1234567890132', name: 'Cheese Cheddar 200g', category: 'Dairy', price: 7.99, cost: 5.00, stock: 15 }
    ];

    const stmt = this.db.prepare(`
      INSERT INTO products (barcode, name, category, price, cost, stock)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const product of products) {
      stmt.run(product.barcode, product.name, product.category, product.price, product.cost, product.stock);
    }
  }

  // Product operations
  getAllProducts() {
    return this.db.prepare('SELECT * FROM products ORDER BY name').all();
  }

  searchProducts(query) {
    return this.db.prepare(`
      SELECT * FROM products 
      WHERE name LIKE ? OR barcode LIKE ? OR category LIKE ?
      ORDER BY name
    `).all(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  getProductByBarcode(barcode) {
    return this.db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
  }

  addProduct(product) {
    const stmt = this.db.prepare(`
      INSERT INTO products (barcode, name, description, category, subcategory, price, regular_price, sale_price, 
                           discount_percent, cost, tax_rate, stock, min_stock, image, unit_type, weight_unit, quantity_unit, weight_amount, quantity_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      product.barcode,
      product.name,
      product.description || null,
      product.category || 'General',
      product.subcategory || null,
      product.price,
      product.regular_price || product.price,
      product.sale_price || null,
      product.discount_percent || 0,
      product.cost || 0,
      product.tax_rate || 0.19,
      product.stock || 0,
      product.min_stock || 5,
      product.image || null,
      product.unit_type || 'weight',
      product.weight_unit || 'kg',
      product.quantity_unit || 'piece',
      product.weight_amount || null,
      product.quantity_amount || null
    );
    return { id: result.lastInsertRowid, ...product };
  }

  updateProduct(id, product) {
    const stmt = this.db.prepare(`
      UPDATE products 
      SET barcode = ?, name = ?, description = ?, category = ?, subcategory = ?,
          price = ?, regular_price = ?, sale_price = ?, discount_percent = ?,
          cost = ?, tax_rate = ?, stock = ?, min_stock = ?, image = ?,
          unit_type = ?, weight_unit = ?, quantity_unit = ?, weight_amount = ?, quantity_amount = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      product.barcode,
      product.name,
      product.description || null,
      product.category || 'General',
      product.subcategory || null,
      product.price,
      product.regular_price || product.price,
      product.sale_price || null,
      product.discount_percent || 0,
      product.cost || 0,
      product.tax_rate || 0.19,
      product.stock || 0,
      product.min_stock || 5,
      product.image || null,
      product.unit_type || 'weight',
      product.weight_unit || 'kg',
      product.quantity_unit || 'piece',
      product.weight_amount || null,
      product.quantity_amount || null,
      id
    );
    return { id, ...product };
  }

  deleteProduct(id) {
    this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    return { success: true };
  }

  // Sale operations
  createSale(saleData) {
    const transaction = this.db.transaction((sale) => {
      // Insert sale
      const saleStmt = this.db.prepare(`
        INSERT INTO sales (subtotal, tax, discount, total, payment_method, payment_amount, change_amount, cashier_id, notes, split_payments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const saleResult = saleStmt.run(
        sale.subtotal,
        sale.tax || 0,
        sale.discount || 0,
        sale.total,
        sale.paymentMethod || 'cash',
        sale.paymentAmount || sale.total,
        sale.changeAmount || 0,
        sale.cashierId || null,
        sale.notes || null,
        sale.splitPayments ? JSON.stringify(sale.splitPayments) : null
      );
      const saleId = saleResult.lastInsertRowid;

      // Insert sale items and update stock
      const itemStmt = this.db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const updateStockStmt = this.db.prepare(`
        UPDATE products SET stock = stock - ? WHERE id = ?
      `);

      for (const item of sale.items) {
        itemStmt.run(saleId, item.productId, item.productName, item.quantity, item.unitPrice, item.subtotal);
        updateStockStmt.run(item.quantity, item.productId);
      }

      return saleId;
    });

    const saleId = transaction(saleData);
    return this.getSaleById(saleId);
  }

  getAllSales(filters = {}) {
    let query = 'SELECT * FROM sales';
    const params = [];

    if (filters.startDate && filters.endDate) {
      query += ' WHERE sale_date BETWEEN ? AND ?';
      params.push(filters.startDate, filters.endDate);
    }

    query += ' ORDER BY sale_date DESC LIMIT 100';
    return this.db.prepare(query).all(...params);
  }

  getSaleById(id) {
    const sale = this.db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (sale) {
      sale.items = this.db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
      // Parse split_payments JSON if exists
      if (sale.split_payments) {
        try {
          sale.split_payments = JSON.parse(sale.split_payments);
        } catch (e) {
          sale.split_payments = null;
        }
      }
    }
    return sale;
  }

  getTodaySales() {
    const today = new Date().toISOString().split('T')[0];
    const sales = this.db.prepare(`
      SELECT * FROM sales 
      WHERE DATE(sale_date) = ?
      ORDER BY sale_date DESC
    `).all(today);

    const summary = this.db.prepare(`
      SELECT 
        COUNT(*) as transaction_count,
        SUM(total) as total_sales,
        SUM(subtotal) as subtotal,
        SUM(tax) as total_tax
      FROM sales
      WHERE DATE(sale_date) = ?
    `).get(today);

    return { sales, summary };
  }

  // Report operations
  getSalesReport(startDate, endDate) {
    const sales = this.db.prepare(`
      SELECT 
        DATE(sale_date) as date,
        COUNT(*) as transaction_count,
        SUM(total) as total_sales,
        SUM(subtotal) as subtotal,
        SUM(tax) as tax,
        SUM(discount) as discount
      FROM sales
      WHERE DATE(sale_date) BETWEEN ? AND ?
      GROUP BY DATE(sale_date)
      ORDER BY date DESC
    `).all(startDate, endDate);

    const topProducts = this.db.prepare(`
      SELECT 
        si.product_name,
        SUM(si.quantity) as total_quantity,
        SUM(si.subtotal) as total_revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.sale_date) BETWEEN ? AND ?
      GROUP BY si.product_id, si.product_name
      ORDER BY total_revenue DESC
      LIMIT 10
    `).all(startDate, endDate);

    return { sales, topProducts };
  }

  getInventoryReport() {
    return this.db.prepare(`
      SELECT 
        id,
        name,
        category,
        stock,
        min_stock,
        price,
        cost,
        (stock * cost) as inventory_value,
        CASE 
          WHEN stock <= min_stock THEN 'Low Stock'
          WHEN stock = 0 THEN 'Out of Stock'
          ELSE 'In Stock'
        END as status
      FROM products
      ORDER BY 
        CASE 
          WHEN stock = 0 THEN 1
          WHEN stock <= min_stock THEN 2
          ELSE 3
        END,
        name
    `).all();
  }

  // User operations
  isSetupRequired() {
    // Check if any admin user exists
    const adminCount = this.db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
    return adminCount.count === 0;
  }

  createFirstAdmin(fullName, username, password) {
    try {
      // Check if admin already exists
      if (!this.isSetupRequired()) {
        return { success: false, message: 'Admin already exists' };
      }

      // Create the first admin user
      const stmt = this.db.prepare(`
        INSERT INTO users (username, password, full_name, role)
        VALUES (?, ?, ?, 'admin')
      `);
      const result = stmt.run(username, password, fullName);
      
      return { success: true, userId: result.lastInsertRowid };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  authenticateUser(username, password) {
    const user = this.db.prepare('SELECT * FROM users WHERE username = ? AND password = ?')
      .get(username, password);
    if (user) {
      delete user.password; // Don't send password back
      return user;
    }
    return null;
  }

  getAllUsers() {
    return this.db.prepare('SELECT id, username, full_name, role, created_at FROM users').all();
  }

  addUser(user) {
    const stmt = this.db.prepare(`
      INSERT INTO users (username, password, full_name, role)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(user.username, user.password, user.fullName, user.role || 'cashier');
    return { id: result.lastInsertRowid };
  }

  updateUser(id, user) {
    const stmt = this.db.prepare(`
      UPDATE users 
      SET username = ?, full_name = ?, role = ?
      WHERE id = ?
    `);
    stmt.run(user.username, user.fullName, user.role, id);
    return { id, ...user };
  }

  updateUserPassword(id, password) {
    const stmt = this.db.prepare(`
      UPDATE users 
      SET password = ?
      WHERE id = ?
    `);
    stmt.run(password, id);
    return { success: true };
  }

  deleteUser(id) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { success: true };
  }

  getUserById(id) {
    const user = this.db.prepare('SELECT id, username, full_name, role, created_at FROM users WHERE id = ?').get(id);
    return user;
  }

  // Loan operations
  createLoan(loanData) {
    const stmt = this.db.prepare(`
      INSERT INTO loans (receipt_number, customer_type, customer_name, customer_phone, restaurant_name, restaurant_nie, sale_id, loan_amount, remaining_amount, cashier_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      loanData.receiptNumber,
      loanData.customerType || 'regular',
      loanData.customerName,
      loanData.customerPhone || null,
      loanData.restaurantName || null,
      loanData.restaurantNie || null,
      loanData.saleId,
      loanData.loanAmount,
      loanData.loanAmount,
      loanData.cashierId || null,
      loanData.notes || null
    );
    // Return the actual inserted loan record
    return this.db.prepare('SELECT * FROM loans WHERE id = ?').get(result.lastInsertRowid);
  }

  getAllLoans(status = null) {
    if (status) {
      return this.db.prepare('SELECT * FROM loans WHERE status = ? ORDER BY loan_date DESC').all(status);
    }
    return this.db.prepare('SELECT * FROM loans ORDER BY loan_date DESC').all();
  }

  getLoanByReceiptNumber(receiptNumber) {
    const loan = this.db.prepare('SELECT * FROM loans WHERE receipt_number = ?').get(receiptNumber);
    if (loan) {
      loan.sale = this.getSaleById(loan.sale_id);
    }
    return loan;
  }

  payLoan(loanId, paymentData) {
    const transaction = this.db.transaction((data) => {
      const loan = this.db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
      if (!loan) throw new Error('Loan not found');

      const paidAmount = loan.paid_amount + data.amount;
      const remainingAmount = loan.loan_amount - paidAmount;
      const status = remainingAmount <= 0 ? 'paid' : 'partial';

      const stmt = this.db.prepare(`
        UPDATE loans 
        SET paid_amount = ?, remaining_amount = ?, status = ?, paid_date = ?, payment_method = ?
        WHERE id = ?
      `);
      stmt.run(
        paidAmount,
        Math.max(0, remainingAmount),
        status,
        status === 'paid' ? new Date().toISOString() : loan.paid_date,
        data.paymentMethod,
        loanId
      );

      return this.db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
    });

    return transaction(paymentData);
  }

  getLoanById(id) {
    return this.db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
  }

  // Get monthly restaurant report with all products ordered
  getMonthlyRestaurantReport(month, year) {
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
    
    // Get all restaurant loans for the month
    const loans = this.db.prepare(`
      SELECT * FROM loans 
      WHERE customer_type = 'restaurant' 
      AND loan_date >= ? AND loan_date <= ?
      ORDER BY restaurant_name, loan_date
    `).all(startDate, endDate);
    
    // Build report grouped by restaurant
    const restaurants = {};
    
    loans.forEach(loan => {
      const restName = loan.restaurant_name || 'Unknown';
      if (!restaurants[restName]) {
        restaurants[restName] = {
          name: restName,
          nie: loan.restaurant_nie,
          totalAmount: 0,
          paidAmount: 0,
          remainingAmount: 0,
          orderCount: 0,
          products: {},
          orders: []
        };
      }
      
      const rest = restaurants[restName];
      rest.totalAmount += loan.loan_amount;
      rest.paidAmount += loan.paid_amount;
      rest.remainingAmount += loan.remaining_amount;
      rest.orderCount++;
      
      // Get sale items for this loan
      const sale = this.getSaleById(loan.sale_id);
      if (sale) {
        const items = this.db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
        items.forEach(item => {
          if (!rest.products[item.product_name]) {
            rest.products[item.product_name] = {
              name: item.product_name,
              totalQuantity: 0,
              totalAmount: 0,
              unitPrice: item.unit_price
            };
          }
          rest.products[item.product_name].totalQuantity += item.quantity;
          rest.products[item.product_name].totalAmount += item.subtotal;
        });
      }
      
      rest.orders.push({
        receiptNumber: loan.receipt_number,
        date: loan.loan_date,
        amount: loan.loan_amount,
        status: loan.status
      });
    });
    
    return Object.values(restaurants);
  }

  // Returns Management
  createReturn(returnData) {
    const transaction = this.db.transaction((data) => {
      // Create return record
      const returnStmt = this.db.prepare(`
        INSERT INTO returns (original_sale_id, subtotal, tax, total, refund_method, cashier_id, reason, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = returnStmt.run(
        data.originalSaleId,
        data.subtotal,
        data.tax,
        data.total,
        data.refundMethod,
        data.cashierId,
        data.reason || '',
        data.notes || ''
      );
      
      const returnId = result.lastInsertRowid;
      
      // Insert return items and restore stock
      const itemStmt = this.db.prepare(`
        INSERT INTO return_items (return_id, product_id, product_name, quantity, unit_price, subtotal)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const updateStockStmt = this.db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      
      data.items.forEach(item => {
        itemStmt.run(
          returnId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice,
          item.subtotal
        );
        
        // Restore stock
        updateStockStmt.run(item.quantity, item.productId);
      });
      
      return this.db.prepare(`
        SELECT r.*, 
          (SELECT json_group_array(json_object(
            'product_id', ri.product_id,
            'product_name', ri.product_name,
            'quantity', ri.quantity,
            'unit_price', ri.unit_price,
            'subtotal', ri.subtotal
          ))
          FROM return_items ri WHERE ri.return_id = r.id) as items
        FROM returns r
        WHERE r.id = ?
      `).get(returnId);
    });
    
    return transaction(returnData);
  }

  getAllReturns() {
    return this.db.prepare(`
      SELECT r.*,
        (SELECT json_group_array(json_object(
          'product_id', ri.product_id,
          'product_name', ri.product_name,
          'quantity', ri.quantity,
          'unit_price', ri.unit_price,
          'subtotal', ri.subtotal
        ))
        FROM return_items ri WHERE ri.return_id = r.id) as items
      FROM returns r
      ORDER BY r.return_date DESC
    `).all();
  }

  getReturnById(id) {
    const result = this.db.prepare(`
      SELECT r.*,
        (SELECT json_group_array(json_object(
          'product_id', ri.product_id,
          'product_name', ri.product_name,
          'quantity', ri.quantity,
          'unit_price', ri.unit_price,
          'subtotal', ri.subtotal
        ))
        FROM return_items ri WHERE ri.return_id = r.id) as items
      FROM returns r
      WHERE r.id = ?
    `).get(id);
    
    if (result && result.items) {
      result.items = JSON.parse(result.items);
    }
    return result;
  }

  // Z-Report operations
  createZReport(reportData) {
    const transaction = this.db.transaction((data) => {
      const reportNumber = data.report_number || `Z${Date.now()}`;
      
      const result = this.db.prepare(`
        INSERT INTO z_reports (
          report_number, start_datetime, end_datetime, cashier_id, cashier_name,
          total_sales, total_returns, net_sales_count,
          gross_sales, total_returns_amount, net_sales,
          cash_sales, card_sales, loan_sales, total_sales_amount,
          total_expenses, expense_description,
          tax_7_base, tax_7_amount, tax_19_base, tax_19_amount, total_tax,
          expected_cash, actual_cash, cash_difference, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportNumber,
        data.start_datetime,
        data.end_datetime,
        data.cashier_id,
        data.cashier_name,
        data.total_sales || 0,
        data.total_returns || 0,
        data.net_sales_count || 0,
        data.gross_sales || 0,
        data.total_returns_amount || 0,
        data.net_sales || 0,
        data.cash_sales || 0,
        data.card_sales || 0,
        data.loan_sales || 0,
        data.total_sales_amount || 0,
        data.total_expenses || 0,
        data.expense_description || null,
        data.tax_7_base || 0,
        data.tax_7_amount || 0,
        data.tax_19_base || 0,
        data.tax_19_amount || 0,
        data.total_tax || 0,
        data.expected_cash || 0,
        data.actual_cash || null,
        data.cash_difference || null,
        data.notes || null
      );
      
      return this.db.prepare('SELECT * FROM z_reports WHERE id = ?').get(result.lastInsertRowid);
    });
    
    return transaction(reportData);
  }

  getAllZReports() {
    return this.db.prepare(`
      SELECT * FROM z_reports ORDER BY report_date DESC
    `).all();
  }

  getZReportById(id) {
    return this.db.prepare('SELECT * FROM z_reports WHERE id = ?').get(id);
  }

  getZReportByNumber(reportNumber) {
    return this.db.prepare('SELECT * FROM z_reports WHERE report_number = ?').get(reportNumber);
  }

  getSalesByDateRange(startDate, endDate, cashierId = null) {
    let query = `
      SELECT s.*,
        (SELECT json_group_array(json_object(
          'product_id', si.product_id,
          'product_name', si.product_name,
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'subtotal', si.subtotal
        ))
        FROM sale_items si WHERE si.sale_id = s.id) as items
      FROM sales s
      WHERE s.sale_date BETWEEN ? AND ?
    `;
    
    if (cashierId) {
      query += ` AND s.cashier_id = ?`;
      return this.db.prepare(query + ` ORDER BY s.sale_date`).all(startDate, endDate, cashierId);
    }
    
    return this.db.prepare(query + ` ORDER BY s.sale_date`).all(startDate, endDate);
  }

  getReturnsByDateRange(startDate, endDate, cashierId = null) {
    let query = `
      SELECT r.*,
        (SELECT json_group_array(json_object(
          'product_id', ri.product_id,
          'product_name', ri.product_name,
          'quantity', ri.quantity,
          'unit_price', ri.unit_price,
          'subtotal', ri.subtotal
        ))
        FROM return_items ri WHERE ri.return_id = r.id) as items
      FROM returns r
      WHERE r.return_date BETWEEN ? AND ?
    `;
    
    if (cashierId) {
      query += ` AND r.cashier_id = ?`;
      return this.db.prepare(query + ` ORDER BY r.return_date`).all(startDate, endDate, cashierId);
    }
    
    return this.db.prepare(query + ` ORDER BY r.return_date`).all(startDate, endDate);
  }

  // System Settings
  getSystemSettings() {
    return this.db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
  }

  updateSystemSettings(settings) {
    const stmt = this.db.prepare(`
      UPDATE system_settings 
      SET store_name = ?, 
          store_logo = ?,
          owner_name = ?,
          nie_number = ?,
          company_address = ?,
          currency_symbol = ?, 
          currency_code = ?,
          tax_rate = ?,
          receipt_footer = ?,
          printer_name = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `);
    stmt.run(
      settings.storeName,
      settings.storeLogo || null,
      settings.ownerName || null,
      settings.nieNumber || null,
      settings.companyAddress || null,
      settings.currencySymbol,
      settings.currencyCode,
      settings.taxRate,
      settings.receiptFooter,
      settings.printerName || null
    );
    return this.getSystemSettings();
  }

  // Category Management
  getAllCategories() {
    return this.db.prepare('SELECT * FROM categories ORDER BY name').all();
  }

  getCategoryById(id) {
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  }

  getCategoryByName(name) {
    return this.db.prepare('SELECT * FROM categories WHERE name = ?').get(name);
  }

  addCategory(category) {
    const stmt = this.db.prepare(`
      INSERT INTO categories (name, tax_rate)
      VALUES (?, ?)
    `);
    const result = stmt.run(category.name, category.taxRate || 0);
    return { success: true, id: result.lastInsertRowid };
  }

  updateCategory(id, category) {
    const stmt = this.db.prepare(`
      UPDATE categories 
      SET name = ?, tax_rate = ?
      WHERE id = ?
    `);
    stmt.run(category.name, category.taxRate || 0, id);
    return { success: true };
  }

  toggleCategoryFavorite(id, isFavorite) {
    const stmt = this.db.prepare('UPDATE categories SET is_favorite = ? WHERE id = ?');
    stmt.run(isFavorite ? 1 : 0, id);
    return { success: true };
  }

  getFavoriteCategories() {
    const stmt = this.db.prepare('SELECT * FROM categories WHERE is_favorite = 1 ORDER BY name LIMIT 10');
    return stmt.all();
  }

  deleteCategory(id) {
    const stmt = this.db.prepare('DELETE FROM categories WHERE id = ?');
    stmt.run(id);
    return { success: true };
  }

  // Subcategory Management
  getAllSubcategories() {
    return this.db.prepare(`
      SELECT s.*, c.name as category_name 
      FROM subcategories s 
      JOIN categories c ON s.category_id = c.id 
      ORDER BY c.name, s.name
    `).all();
  }

  getSubcategoriesByCategoryId(categoryId) {
    return this.db.prepare('SELECT * FROM subcategories WHERE category_id = ? AND parent_id IS NULL ORDER BY name').all(categoryId);
  }

  getSubcategoriesByParentId(parentId) {
    return this.db.prepare('SELECT * FROM subcategories WHERE parent_id = ? ORDER BY name').all(parentId);
  }

  getSubcategoryById(id) {
    return this.db.prepare('SELECT * FROM subcategories WHERE id = ?').get(id);
  }

  addSubcategory(subcategory) {
    const stmt = this.db.prepare(`
      INSERT INTO subcategories (category_id, parent_id, name)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(subcategory.categoryId, subcategory.parentId || null, subcategory.name);
    return { success: true, id: result.lastInsertRowid };
  }

  updateSubcategory(id, subcategory) {
    const stmt = this.db.prepare(`
      UPDATE subcategories 
      SET category_id = ?, parent_id = ?, name = ?
      WHERE id = ?
    `);
    stmt.run(subcategory.categoryId, subcategory.parentId || null, subcategory.name, id);
    return { success: true };
  }

  deleteSubcategory(id) {
    const stmt = this.db.prepare('DELETE FROM subcategories WHERE id = ?');
    stmt.run(id);
    return { success: true };
  }

  // Analytics operations
  getAnalyticsData(startDate, endDate) {
    // Sales trends by date
    const salesTrends = this.db.prepare(`
      SELECT 
        DATE(sale_date) as date,
        COUNT(*) as transaction_count,
        SUM(total) as total_sales,
        SUM(total - tax) as net_sales,
        SUM(tax) as total_tax
      FROM sales
      WHERE DATE(sale_date) BETWEEN ? AND ?
      GROUP BY DATE(sale_date)
      ORDER BY date
    `).all(startDate, endDate);

    // Peak hours analysis
    const peakHours = this.db.prepare(`
      SELECT 
        CAST(strftime('%H', sale_date) AS INTEGER) as hour,
        COUNT(*) as transaction_count,
        SUM(total) as total_sales,
        ROUND(AVG(total), 2) as avg_transaction
      FROM sales
      WHERE DATE(sale_date) BETWEEN ? AND ?
      GROUP BY hour
      ORDER BY hour
    `).all(startDate, endDate);

    // Top products by revenue
    const topProducts = this.db.prepare(`
      SELECT 
        si.product_id,
        si.product_name,
        p.category,
        SUM(si.quantity) as total_quantity,
        SUM(si.subtotal) as total_revenue,
        p.cost,
        (SUM(si.subtotal) - (SUM(si.quantity) * COALESCE(p.cost, 0))) as total_profit,
        ROUND(((SUM(si.subtotal) - (SUM(si.quantity) * COALESCE(p.cost, 0))) / SUM(si.subtotal) * 100), 2) as profit_margin_percent
      FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.sale_date) BETWEEN ? AND ?
      GROUP BY si.product_id, si.product_name, p.category, p.cost
      ORDER BY total_revenue DESC
      LIMIT 20
    `).all(startDate, endDate);

    // Profit by category
    const categoryProfit = this.db.prepare(`
      SELECT 
        COALESCE(p.category, 'Uncategorized') as category,
        SUM(si.subtotal) as total_revenue,
        SUM(si.quantity * COALESCE(p.cost, 0)) as total_cost,
        (SUM(si.subtotal) - SUM(si.quantity * COALESCE(p.cost, 0))) as total_profit,
        ROUND(((SUM(si.subtotal) - SUM(si.quantity * COALESCE(p.cost, 0))) / SUM(si.subtotal) * 100), 2) as profit_margin_percent
      FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.sale_date) BETWEEN ? AND ?
      GROUP BY p.category
      ORDER BY total_profit DESC
    `).all(startDate, endDate);

    // Payment method breakdown
    const paymentMethods = this.db.prepare(`
      SELECT 
        payment_method,
        COUNT(*) as transaction_count,
        SUM(total) as total_sales,
        ROUND(AVG(total), 2) as avg_transaction
      FROM sales
      WHERE DATE(sale_date) BETWEEN ? AND ?
      GROUP BY payment_method
    `).all(startDate, endDate);

    // Summary statistics
    const summary = this.db.prepare(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(total) as total_revenue,
        SUM(total - tax) as net_revenue,
        SUM(tax) as total_tax,
        ROUND(AVG(total), 2) as avg_transaction,
        MAX(total) as max_transaction,
        MIN(total) as min_transaction
      FROM sales
      WHERE DATE(sale_date) BETWEEN ? AND ?
    `).get(startDate, endDate);

    // Calculate total profit
    const profitData = this.db.prepare(`
      SELECT 
        SUM(si.subtotal) as total_revenue,
        SUM(si.quantity * COALESCE(p.cost, 0)) as total_cost
      FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.sale_date) BETWEEN ? AND ?
    `).get(startDate, endDate);

    const totalProfit = (profitData.total_revenue || 0) - (profitData.total_cost || 0);
    const profitMargin = profitData.total_revenue > 0 
      ? ((totalProfit / profitData.total_revenue) * 100).toFixed(2)
      : 0;

    return {
      salesTrends,
      peakHours,
      topProducts,
      categoryProfit,
      paymentMethods,
      summary: {
        ...summary,
        total_profit: totalProfit,
        profit_margin: profitMargin
      }
    };
  }

  // Expense operations
  createExpense(expenseData) {
    const stmt = this.db.prepare(`
      INSERT INTO expenses (expense_date, category, description, amount, payment_method, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      expenseData.expenseDate,
      expenseData.category,
      expenseData.description,
      expenseData.amount,
      expenseData.paymentMethod,
      expenseData.userId
    );
    return { id: result.lastInsertRowid, ...expenseData };
  }

  getExpenses(startDate, endDate) {
    const stmt = this.db.prepare(`
      SELECT e.*, u.full_name as user_name
      FROM expenses e
      LEFT JOIN users u ON e.user_id = u.id
      WHERE DATE(e.expense_date) BETWEEN ? AND ?
      ORDER BY e.expense_date DESC, e.created_at DESC
    `);
    return stmt.all(startDate, endDate);
  }

  getExpenseById(id) {
    return this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  }

  updateExpense(id, expenseData) {
    const stmt = this.db.prepare(`
      UPDATE expenses
      SET expense_date = ?, category = ?, description = ?, amount = ?, payment_method = ?
      WHERE id = ?
    `);
    stmt.run(
      expenseData.expenseDate,
      expenseData.category,
      expenseData.description,
      expenseData.amount,
      expenseData.paymentMethod,
      id
    );
    return { id, ...expenseData };
  }

  deleteExpense(id) {
    this.db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    return { success: true };
  }

  getExpenseSummary(startDate, endDate) {
    const summary = this.db.prepare(`
      SELECT 
        COUNT(*) as total_count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM expenses
      WHERE DATE(expense_date) BETWEEN ? AND ?
    `).get(startDate, endDate);

    const byCategory = this.db.prepare(`
      SELECT category, SUM(amount) as total, COUNT(*) as count
      FROM expenses
      WHERE DATE(expense_date) BETWEEN ? AND ?
      GROUP BY category
      ORDER BY total DESC
    `).all(startDate, endDate);

    return {
      ...summary,
      by_category: byCategory
    };
  }
}

module.exports = POSDatabase;
