const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');

class POSDatabase {
  constructor() {
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'pos_database.db');
    this.db = new Database(this.dbPath);
    this.initializeDatabase();
  }

  // ===== Time helpers (business day) =====
  // Business rules:
  // - The business day resets when a Z-report is created.
  // - If no Z-report exists yet, "today" starts at 00:00 in Europe/Madrid.
  // Notes:
  // - We store and compare instants as ISO strings when needed.
  // - Existing DB timestamps may be UTC-like strings; we keep comparisons via SQLite datetime().
  getAppTimeZone() {
    return 'Europe/Madrid';
  }

  _getZonedParts(date, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = dtf.formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value;
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour: Number(get('hour')),
      minute: Number(get('minute')),
      second: Number(get('second'))
    };
  }

  _timeZoneOffsetMs(date, timeZone) {
    // Offset = (local time interpreted as UTC) - (actual UTC)
    const p = this._getZonedParts(date, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - date.getTime();
  }

  _zonedDateTimeToUtcDate({ year, month, day, hour, minute, second }, timeZone) {
    // Iteratively solve UTC instant for a given local (zoned) wall time.
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    let utc = targetAsUtc;
    let offset = this._timeZoneOffsetMs(new Date(utc), timeZone);
    utc = targetAsUtc - offset;
    // refine once (handles DST)
    offset = this._timeZoneOffsetMs(new Date(utc), timeZone);
    utc = targetAsUtc - offset;
    return new Date(utc);
  }

  _getStartOfDayUtcIsoForTimeZone(now = new Date(), timeZone) {
    const p = this._getZonedParts(now, timeZone);
    const utcDate = this._zonedDateTimeToUtcDate({
      year: p.year,
      month: p.month,
      day: p.day,
      hour: 0,
      minute: 0,
      second: 0
    }, timeZone);
    return utcDate.toISOString();
  }

  _getStartOfPreviousDayUtcIsoForTimeZone(now = new Date(), timeZone) {
    const startTodayIso = this._getStartOfDayUtcIsoForTimeZone(now, timeZone);
    const d = new Date(startTodayIso);
    // Go to previous day noon to avoid DST edge, then compute that day's start.
    const noonPrev = new Date(d.getTime() - 12 * 60 * 60 * 1000);
    return this._getStartOfDayUtcIsoForTimeZone(noonPrev, timeZone);
  }

  _getRecentZReportEnds(limit = 2) {
    try {
      return this.db.prepare(`
        SELECT end_datetime
        FROM z_reports
        WHERE end_datetime IS NOT NULL AND TRIM(end_datetime) != ''
        ORDER BY report_date DESC
        LIMIT ?
      `).all(limit).map(r => String(r.end_datetime));
    } catch {
      return [];
    }
  }

  getBusinessDayRange(which = 'today') {
    const tz = this.getAppTimeZone();
    const now = new Date();
    const nowIso = now.toISOString();
    const startOfTodayIso = this._getStartOfDayUtcIsoForTimeZone(now, tz);
    const startOfYesterdayIso = this._getStartOfPreviousDayUtcIsoForTimeZone(now, tz);

    const ends = this._getRecentZReportEnds(2);
    const lastEndIso = ends[0] || null;
    const prevEndIso = ends[1] || null;

    const parse = (s) => {
      const t = Date.parse(String(s || ''));
      return Number.isFinite(t) ? t : null;
    };

    const nowMs = parse(nowIso);
    const lastEndMs = parse(lastEndIso);
    const prevEndMs = parse(prevEndIso);
    const startTodayMs = parse(startOfTodayIso);
    const startYesterdayMs = parse(startOfYesterdayIso);

    // Guard: older installs may have Z reports with end_datetime set to end-of-day in the future.
    const isValidEnd = (endMs) => Number.isFinite(endMs) && Number.isFinite(nowMs) && endMs <= (nowMs + 5 * 60 * 1000);
    const lastEndValid = isValidEnd(lastEndMs);
    const prevEndValid = isValidEnd(prevEndMs);

    if (which === 'yesterday') {
      if (lastEndValid) {
        const startMs = prevEndValid ? prevEndMs : startYesterdayMs;
        return {
          startDateTime: new Date(startMs).toISOString(),
          endDateTime: new Date(lastEndMs).toISOString()
        };
      }
      return {
        startDateTime: new Date(startYesterdayMs).toISOString(),
        endDateTime: new Date(startTodayMs).toISOString()
      };
    }

    // today (current open business day)
    const startMs = lastEndValid ? Math.max(startTodayMs, lastEndMs) : startTodayMs;
    return {
      startDateTime: new Date(startMs).toISOString(),
      endDateTime: nowIso
    };
  }

  getDatabasePath() {
    return this.dbPath;
  }

  async backupTo(destinationPath) {
    if (!destinationPath) throw new Error('Missing destination path');
    if (!this.db || typeof this.db.backup !== 'function') {
      throw new Error('Database backup is not available');
    }
    await this.db.backup(destinationPath);
    return destinationPath;
  }

  close() {
    try {
      this.db?.close?.();
    } catch {
      // ignore
    }
  }

  clearTestData() {
    // Deletes transactional/test data but keeps products, users, categories, and system settings.
    // Safe for “fresh install” handoff after testing.
    const run = this.db.transaction(() => {
      // FK order matters.
      this.db.exec('PRAGMA foreign_keys = OFF;');

      const tablesToClear = [
        'loan_payments',
        'loans',
        'return_items',
        'returns',
        'sale_items',
        'sales',
        'z_reports',
        'expenses'
      ];

      const deletedCounts = {};
      for (const table of tablesToClear) {
        try {
          const row = this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
          deletedCounts[table] = Number(row?.c || 0);
        } catch {
          deletedCounts[table] = 0;
        }
      }

      for (const table of tablesToClear) {
        this.db.prepare(`DELETE FROM ${table}`).run();
      }

      // Reset autoincrement counters for cleared tables.
      try {
        const names = tablesToClear.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${names})`).run(...tablesToClear);
      } catch {
        // ignore
      }

      this.db.exec('PRAGMA foreign_keys = ON;');
      return deletedCounts;
    });

    const deletedCounts = run();

    // Best-effort compact; can take a moment on large DBs.
    try {
      this.db.exec('VACUUM;');
    } catch {
      // ignore
    }

    return { success: true, deletedCounts };
  }

  purgeDemoData() {
    // Deletes ALL demo data: products + categories + transactional data.
    // Keeps users and system settings.
    const run = this.db.transaction(() => {
      this.db.exec('PRAGMA foreign_keys = OFF;');

      const tablesToClear = [
        // transactional
        'loan_payments',
        'loans',
        'return_items',
        'returns',
        'sale_items',
        'sales',
        'z_reports',
        'expenses',
        // product-related
        'product_sort',
        'products',
        'subcategories',
        'categories'
      ];

      const deletedCounts = {};
      for (const table of tablesToClear) {
        try {
          const row = this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
          deletedCounts[table] = Number(row?.c || 0);
        } catch {
          deletedCounts[table] = 0;
        }
      }

      for (const table of tablesToClear) {
        try {
          this.db.prepare(`DELETE FROM ${table}`).run();
        } catch {
          // ignore per-table failures (older DBs may miss some tables)
        }
      }

      // Mark cleanup as used so we don't auto-seed sample products again.
      try {
        this.db.prepare('UPDATE system_settings SET demo_cleanup_used = 1 WHERE id = 1').run();
      } catch {
        // ignore
      }

      // Reset autoincrement counters for cleared tables.
      try {
        const names = tablesToClear.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${names})`).run(...tablesToClear);
      } catch {
        // ignore
      }

      this.db.exec('PRAGMA foreign_keys = ON;');
      return deletedCounts;
    });

    const deletedCounts = run();

    try {
      this.db.exec('VACUUM;');
    } catch {
      // ignore
    }

    return { success: true, deletedCounts };
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
        show_in_checkout INTEGER DEFAULT 1,
        is_archived INTEGER DEFAULT 0,
        price REAL NOT NULL,
        regular_price REAL,
        sale_price REAL,
        discount_percent REAL DEFAULT 0,
        cost REAL,
        tax_rate REAL DEFAULT 0.21,
        purchase_tax_rate REAL DEFAULT 0.21,
        stock INTEGER DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- VAT rates (IVA) presets used in product forms (e.g., 4%, 10%, 21%).
      CREATE TABLE IF NOT EXISTS vat_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        percent REAL NOT NULL,
        label TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(percent)
      );

      -- Persist custom product order for a given view (category/subcategory scope)
      CREATE TABLE IF NOT EXISTS product_sort (
        scope_category TEXT NOT NULL,
        scope_subcategory TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        sort_index INTEGER NOT NULL,
        PRIMARY KEY (scope_category, scope_subcategory, product_id),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_product_sort_scope
        ON product_sort(scope_category, scope_subcategory, sort_index);
      
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
        tax_rate REAL DEFAULT 0,
        discount_percent REAL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS loan_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id INTEGER NOT NULL,
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        cashier_id INTEGER,
        FOREIGN KEY (loan_id) REFERENCES loans(id),
        FOREIGN KEY (cashier_id) REFERENCES users(id)
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
        expenses_json TEXT,
        tax_7_base REAL DEFAULT 0,
        tax_7_amount REAL DEFAULT 0,
        tax_19_base REAL DEFAULT 0,
        tax_19_amount REAL DEFAULT 0,
        total_tax REAL DEFAULT 0,
        tax_breakdown_json TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON loan_payments(loan_id);
      CREATE INDEX IF NOT EXISTS idx_loan_payments_date ON loan_payments(payment_date);

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
        tax_rate REAL DEFAULT 0.21,
        receipt_footer TEXT DEFAULT 'Vielen Dank für Ihren Einkauf!',
        printer_name TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Performance indexes (important for 10k+ products)
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_is_archived_name ON products(is_archived, name);
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
        CREATE INDEX IF NOT EXISTS idx_return_items_product_id ON return_items(product_id);
      `);
    } catch {
      // ignore (older SQLite versions / permissions)
    }

    // Insert default settings if not exists
    const settingsCount = this.db.prepare('SELECT COUNT(*) as count FROM system_settings').get();
    if (settingsCount.count === 0) {
      this.db.prepare(`
        INSERT INTO system_settings (id, store_name, currency_symbol, currency_code, tax_rate)
        VALUES (1, 'SUPERMARKET POS', '€', 'EUR', 0.21)
      `).run();
    }
    
    // Update existing settings to Euro if still using USD
    const currentSettings = this.db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    if (currentSettings && currentSettings.currency_code === 'USD') {
      this.db.prepare(`
        UPDATE system_settings 
        SET currency_symbol = '€', 
            currency_code = 'EUR',
            tax_rate = 0.21,
            receipt_footer = 'Vielen Dank für Ihren Einkauf!'
        WHERE id = 1
      `).run();
    }

    // Migration: older installs used 19% as the default VAT (0.19).
    // If the tax_rate was never customized (still 0.19 or invalid), set it to 21%.
    try {
      const st = this.db.prepare('SELECT tax_rate FROM system_settings WHERE id = 1').get();
      const tax = Number(st?.tax_rate);
      if (!Number.isFinite(tax) || Math.abs(tax - 0.19) < 0.00001) {
        this.db.prepare('UPDATE system_settings SET tax_rate = 0.21, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run();
      }
    } catch {
      // ignore
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

    // Add discount_percent column to sale_items table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE sale_items ADD COLUMN discount_percent REAL DEFAULT 0').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding discount_percent column:', error);
      }
    }

    // Add tax_rate column to sale_items table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE sale_items ADD COLUMN tax_rate REAL DEFAULT 0').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding tax_rate column:', error);
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

    // Add customer_display_port column to system_settings table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE system_settings ADD COLUMN customer_display_port TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding customer_display_port column:', error);
      }
    }

    // Add loan_payments table for tracking PARKING payments by date
    // (CREATE TABLE IF NOT EXISTS is safe across versions)
    try {
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS loan_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          loan_id INTEGER NOT NULL,
          payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          amount REAL NOT NULL,
          payment_method TEXT NOT NULL,
          cashier_id INTEGER,
          FOREIGN KEY (loan_id) REFERENCES loans(id),
          FOREIGN KEY (cashier_id) REFERENCES users(id)
        );
      `).run();
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON loan_payments(loan_id)').run();
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_loan_payments_date ON loan_payments(payment_date)').run();
    } catch (error) {
      console.error('Error ensuring loan_payments table:', error);
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

    try {
      this.db.prepare('ALTER TABLE z_reports ADD COLUMN tax_breakdown_json TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding tax_breakdown_json column:', error);
      }
    }

    try {
      this.db.prepare('ALTER TABLE z_reports ADD COLUMN expenses_json TEXT').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding expenses_json column:', error);
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

    // Add show_in_checkout column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN show_in_checkout INTEGER DEFAULT 1').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding show_in_checkout column:', error);
      }
    }

    // Expenses table migrations (older DBs may use cashier_id instead of user_id)
    try {
      const cols = new Set(
        (this.db.prepare('PRAGMA table_info(expenses)').all() || [])
          .map(r => String(r?.name || ''))
          .filter(Boolean)
      );

      if (!cols.has('user_id')) {
        try {
          this.db.prepare('ALTER TABLE expenses ADD COLUMN user_id INTEGER').run();
        } catch (error) {
          if (!String(error?.message || '').includes('duplicate column name')) {
            console.error('Error adding expenses.user_id column:', error);
          }
        }
      }

      if (!cols.has('created_at')) {
        try {
          this.db.prepare('ALTER TABLE expenses ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP').run();
        } catch (error) {
          if (!String(error?.message || '').includes('duplicate column name')) {
            console.error('Error adding expenses.created_at column:', error);
          }
        }
      }

      // Backfill: if the old column exists, map it into user_id
      const colsAfter = new Set(
        (this.db.prepare('PRAGMA table_info(expenses)').all() || [])
          .map(r => String(r?.name || ''))
          .filter(Boolean)
      );
      if (colsAfter.has('cashier_id') && colsAfter.has('user_id')) {
        try {
          this.db.prepare('UPDATE expenses SET user_id = cashier_id WHERE user_id IS NULL').run();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
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
      this.db.prepare('ALTER TABLE products ADD COLUMN unit_type TEXT DEFAULT "quantity"').run();
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding unit_type column:', error);
      }
    }

    // Barcode-only default: normalize legacy/missing unit types to quantity.
    try {
      this.db.prepare(`
        UPDATE products
        SET unit_type = 'quantity'
        WHERE unit_type IS NULL OR TRIM(unit_type) = '' OR unit_type = 'weight'
      `).run();
    } catch (error) {
      console.error('Error normalizing unit_type:', error);
    }

    // Add is_archived column to products table if it doesn't exist
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN is_archived INTEGER DEFAULT 0').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding is_archived column:', error);
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

    // Add purchase_tax_rate column to products table if it doesn't exist
    // (Used for IVA de compra / purchase VAT tracking)
    try {
      this.db.prepare('ALTER TABLE products ADD COLUMN purchase_tax_rate REAL DEFAULT 0.21').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding purchase_tax_rate column:', error);
      }
    }

    // Migration: update products that still have legacy 19% VAT to the current system default.
    // This prevents 19% from appearing in Z-reports unless explicitly configured.
    try {
      const st = this.db.prepare('SELECT tax_rate FROM system_settings WHERE id = 1').get();
      const defaultTax = Number(st?.tax_rate);
      const safeDefaultTax = Number.isFinite(defaultTax) ? defaultTax : 0.21;

      this.db.prepare(`
        UPDATE products
        SET tax_rate = ?,
            purchase_tax_rate = CASE
              WHEN purchase_tax_rate IS NULL THEN ?
              WHEN ABS(purchase_tax_rate - 0.19) < 0.00001 THEN ?
              ELSE purchase_tax_rate
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE ABS(COALESCE(tax_rate, 0) - 0.19) < 0.00001
      `).run(safeDefaultTax, safeDefaultTax, safeDefaultTax);
    } catch {
      // ignore
    }

    // One-time demo cleanup flag (used to hide the purge button and prevent sample re-seeding)
    try {
      this.db.prepare('ALTER TABLE system_settings ADD COLUMN demo_cleanup_used INTEGER DEFAULT 0').run();
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding demo_cleanup_used column:', error);
      }
    }

    // Don't create default users - let setup wizard handle it
    // System will check if any admin exists, if not show setup wizard

    // Insert sample products if table is empty
    const productCount = this.db.prepare('SELECT COUNT(*) as count FROM products').get();
    let demoCleanupUsed = false;
    try {
      const st = this.db.prepare('SELECT demo_cleanup_used FROM system_settings WHERE id = 1').get();
      demoCleanupUsed = Number(st?.demo_cleanup_used || 0) === 1;
    } catch {
      demoCleanupUsed = false;
    }

    if (productCount.count === 0 && !demoCleanupUsed) {
      this.insertSampleProducts();
    }

    // Seed default VAT rates if empty
    try {
      const vatCount = this.db.prepare('SELECT COUNT(*) AS c FROM vat_rates').get();
      if (Number(vatCount?.c || 0) === 0) {
        const stmt = this.db.prepare('INSERT INTO vat_rates (percent, label, is_active) VALUES (?, ?, 1)');
        stmt.run(4, 'Super-reduced');
        stmt.run(10, 'Reduced');
        stmt.run(21, 'Standard');
      }
    } catch (error) {
      console.error('Error seeding vat_rates:', error);
    }
  }

  // VAT rates operations
  getVatRates(activeOnly = true) {
    if (activeOnly) {
      return this.db.prepare('SELECT * FROM vat_rates WHERE COALESCE(is_active, 1) = 1 ORDER BY percent ASC').all();
    }
    return this.db.prepare('SELECT * FROM vat_rates ORDER BY percent ASC').all();
  }

  addVatRate(percent, label = null) {
    const p = Number(percent);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      throw new Error('Invalid VAT percent');
    }

    const cleanLabel = (label === null || label === undefined) ? null : String(label).trim();

    try {
      const res = this.db.prepare('INSERT INTO vat_rates (percent, label, is_active) VALUES (?, ?, 1)').run(p, cleanLabel || null);
      return this.db.prepare('SELECT * FROM vat_rates WHERE id = ?').get(res.lastInsertRowid);
    } catch (e) {
      const msg = String(e?.message || e || '');
      const isUnique = e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || msg.includes('UNIQUE') || msg.includes('vat_rates.percent');
      if (isUnique) {
        // If already exists, return existing record (idempotent behavior)
        const existing = this.db.prepare('SELECT * FROM vat_rates WHERE percent = ?').get(p);
        if (existing) return existing;
      }
      throw e;
    }
  }

  normalizeSortScope(category, subcategory) {
    const scope_category = (category === null || category === undefined || category === '') ? 'all' : String(category);
    const scope_subcategory = (subcategory === null || subcategory === undefined) ? '' : String(subcategory);
    return { scope_category, scope_subcategory };
  }

  getProductSortOrder(category, subcategory) {
    const { scope_category, scope_subcategory } = this.normalizeSortScope(category, subcategory);
    return this.db.prepare(`
      SELECT product_id, sort_index
      FROM product_sort
      WHERE scope_category = ? AND scope_subcategory = ?
      ORDER BY sort_index ASC
    `).all(scope_category, scope_subcategory);
  }

  setProductSortOrder(category, subcategory, productIds) {
    const { scope_category, scope_subcategory } = this.normalizeSortScope(category, subcategory);
    const ids = Array.isArray(productIds) ? productIds : [];
    const normalized = ids
      .map(v => parseInt(v, 10))
      .filter(v => Number.isFinite(v) && v > 0);

    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM product_sort WHERE scope_category = ? AND scope_subcategory = ?').run(scope_category, scope_subcategory);
      if (normalized.length === 0) return;
      const stmt = this.db.prepare(`
        INSERT INTO product_sort (scope_category, scope_subcategory, product_id, sort_index)
        VALUES (?, ?, ?, ?)
      `);
      for (let i = 0; i < normalized.length; i++) {
        stmt.run(scope_category, scope_subcategory, normalized[i], i);
      }
    });

    run();
    return { success: true, scope_category, scope_subcategory, count: normalized.length };
  }

  generateInternalBarcode() {
    // Customer may not use barcodes; DB requires a unique non-null value.
    // Use a prefix so it’s visually distinct from real EAN/UPC.
    const rand = crypto.randomBytes(9).toString('hex');
    return `POS-${Date.now().toString(36)}-${rand}`;
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
    return this.db.prepare('SELECT * FROM products WHERE COALESCE(is_archived, 0) = 0 ORDER BY name').all();
  }

  // Same as getAllProducts(), but excludes the (potentially large) image column.
  getAllProductsLite() {
    return this.db.prepare(`
      SELECT id, barcode, name, description, category, subcategory, is_archived,
             show_in_checkout,
             price, regular_price, sale_price, discount_percent, cost, tax_rate, purchase_tax_rate,
             stock, min_stock, unit_type, weight_unit, quantity_unit, weight_amount, quantity_amount,
             created_at, updated_at
      FROM products
      WHERE COALESCE(is_archived, 0) = 0
      ORDER BY name
    `).all();
  }

  searchProducts(query) {
    // Cashier search is used to pick products quickly; avoid returning large image blobs.
    return this.db.prepare(`
      SELECT id, barcode, name, description, category, subcategory, is_archived,
             show_in_checkout,
             price, regular_price, sale_price, discount_percent, cost, tax_rate, purchase_tax_rate,
             stock, min_stock, unit_type, weight_unit, quantity_unit, weight_amount, quantity_amount,
             created_at, updated_at
      FROM products
      WHERE COALESCE(is_archived, 0) = 0
        AND (name LIKE ? OR barcode LIKE ? OR category LIKE ?)
      ORDER BY name
    `).all(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  getProductByBarcode(barcode) {
    return this.db.prepare('SELECT * FROM products WHERE COALESCE(is_archived, 0) = 0 AND barcode = ?').get(barcode);
  }

  getProductById(id) {
    return this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  }

  getProductReferenceCounts(id) {
    const saleRow = this.db.prepare('SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?').get(id);
    const returnRow = this.db.prepare('SELECT COUNT(*) AS c FROM return_items WHERE product_id = ?').get(id);
    return {
      sale_items: Number(saleRow?.c || 0),
      return_items: Number(returnRow?.c || 0)
    };
  }

  archiveProduct(id) {
    const result = this.db.prepare('UPDATE products SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return { success: true, changes: result.changes };
  }

  addProduct(product) {
    const stmt = this.db.prepare(`
      INSERT INTO products (barcode, name, description, category, subcategory, show_in_checkout, price, regular_price, sale_price, 
                           discount_percent, cost, tax_rate, purchase_tax_rate, stock, min_stock, image, unit_type, weight_unit, quantity_unit, weight_amount, quantity_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const base = {
      ...product,
      barcode: (product?.barcode || '').toString().trim()
    };

    const settings = (() => {
      try { return this.getSystemSettings(); } catch { return null; }
    })();
    const defaultTaxRate = Number(settings?.tax_rate);
    const safeDefaultTaxRate = Number.isFinite(defaultTaxRate) ? defaultTaxRate : 0.21;

    // Retry on rare collisions (or if UI provided empty barcode).
    for (let attempt = 0; attempt < 5; attempt++) {
      const bc = base.barcode || this.generateInternalBarcode();
      try {
        const result = stmt.run(
          bc,
          base.name,
          base.description || null,
          (base.category === undefined || base.category === null || String(base.category).trim() === '')
            ? null
            : String(base.category).trim(),
          base.subcategory || null,
          (base.show_in_checkout === undefined || base.show_in_checkout === null) ? 1 : (base.show_in_checkout ? 1 : 0),
          base.price,
          base.regular_price || base.price,
          base.sale_price || null,
          base.discount_percent || 0,
          base.cost || 0,
          (base.tax_rate ?? safeDefaultTaxRate),
          (base.purchase_tax_rate ?? base.tax_rate ?? safeDefaultTaxRate),
          base.stock || 0,
          base.min_stock || 5,
          base.image || null,
          base.unit_type || 'quantity',
          base.weight_unit || 'kg',
          base.quantity_unit || 'piece',
          base.weight_amount || null,
          base.quantity_amount || null
        );
        return { id: result.lastInsertRowid, ...base, barcode: bc };
      } catch (e) {
        const msg = String(e?.message || e || '');
        const isUnique = e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || msg.includes('UNIQUE constraint failed: products.barcode');
        if (!isUnique) throw e;
        // Collision: generate a new internal barcode and retry.
        base.barcode = '';
      }
    }

    throw new Error('Failed to generate a unique internal product code. Please try again.');
  }

  updateProduct(id, product) {
    const stmt = this.db.prepare(`
      UPDATE products 
      SET barcode = ?, name = ?, description = ?, category = ?, subcategory = ?,
          show_in_checkout = ?,
          price = ?, regular_price = ?, sale_price = ?, discount_percent = ?,
          cost = ?, tax_rate = ?, purchase_tax_rate = ?, stock = ?, min_stock = ?, image = ?,
          unit_type = ?, weight_unit = ?, quantity_unit = ?, weight_amount = ?, quantity_amount = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const base = {
      ...product,
      barcode: (product?.barcode || '').toString().trim()
    };

    const bc = base.barcode || this.generateInternalBarcode();

    const settings = (() => {
      try { return this.getSystemSettings(); } catch { return null; }
    })();
    const defaultTaxRate = Number(settings?.tax_rate);
    const safeDefaultTaxRate = Number.isFinite(defaultTaxRate) ? defaultTaxRate : 0.21;

    stmt.run(
      bc,
      product.name,
      product.description || null,
      (product.category === undefined || product.category === null || String(product.category).trim() === '')
        ? null
        : String(product.category).trim(),
      product.subcategory || null,
      (product.show_in_checkout === undefined || product.show_in_checkout === null) ? 1 : (product.show_in_checkout ? 1 : 0),
      product.price,
      product.regular_price || product.price,
      product.sale_price || null,
      product.discount_percent || 0,
      product.cost || 0,
      (product.tax_rate ?? safeDefaultTaxRate),
      (product.purchase_tax_rate ?? product.tax_rate ?? safeDefaultTaxRate),
      product.stock || 0,
      product.min_stock || 5,
      product.image || null,
      product.unit_type || 'quantity',
      product.weight_unit || 'kg',
      product.quantity_unit || 'piece',
      product.weight_amount || null,
      product.quantity_amount || null,
      id
    );
    return { id, ...product, barcode: bc };
  }

  setProductShowInCheckout(id, showInCheckout) {
    const v = showInCheckout ? 1 : 0;
    const result = this.db.prepare(
      'UPDATE products SET show_in_checkout = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(v, id);
    return { success: true, changes: result.changes, id, show_in_checkout: v };
  }

  deleteProduct(id) {
    // Some products cannot be deleted once used in sales/returns due to FK constraints.
    // In that case, archive it so it disappears from Products but remains in reports/history.
    const refs = this.getProductReferenceCounts(id);
    if (refs.sale_items > 0 || refs.return_items > 0) {
      const archived = this.archiveProduct(id);
      return { success: true, archived: true, reason: 'in_use', references: refs, ...archived };
    }

    this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    return { success: true, archived: false };
  }

  // Sale operations
  createSale(saleData) {
    const moneyToCents = (amount) => {
      const num = Number(amount);
      if (!Number.isFinite(num)) return 0;
      return Math.round((num + Number.EPSILON) * 100);
    };

    const centsToMoney = (cents) => {
      const num = Number(cents);
      if (!Number.isFinite(num)) return 0;
      return num / 100;
    };

    const roundMoney2 = (amount) => centsToMoney(moneyToCents(amount));

    const transaction = this.db.transaction((sale) => {
      // Insert sale
      const saleStmt = this.db.prepare(`
        INSERT INTO sales (subtotal, tax, discount, total, payment_method, payment_amount, change_amount, cashier_id, notes, split_payments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const saleResult = saleStmt.run(
        roundMoney2(sale.subtotal),
        roundMoney2(sale.tax || 0),
        roundMoney2(sale.discount || 0),
        roundMoney2(sale.total),
        sale.paymentMethod || 'cash',
        roundMoney2(sale.paymentAmount || sale.total),
        roundMoney2(sale.changeAmount || 0),
        sale.cashierId || null,
        sale.notes || null,
        sale.splitPayments ? JSON.stringify(sale.splitPayments) : null
      );
      const saleId = saleResult.lastInsertRowid;

      // Insert sale items and update stock
      const itemStmt = this.db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, tax_rate, discount_percent, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStockStmt = this.db.prepare(`
        UPDATE products SET stock = stock - ? WHERE id = ?
      `);

      for (const item of sale.items) {
        const discountPercent = Number(item.discountPercent || 0);
        const lineSubtotalCents = moneyToCents(item.subtotal || 0);
        const discountCents = Math.round(lineSubtotalCents * (discountPercent / 100));
        const finalSubtotal = centsToMoney(lineSubtotalCents - discountCents);
        const unitPrice = roundMoney2(item.unitPrice || 0);

        itemStmt.run(
          saleId,
          item.productId,
          item.productName,
          item.quantity,
          unitPrice,
          Number(item.taxRate || 0),
          discountPercent,
          finalSubtotal
        );
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
    const sale = this.db.prepare(`
      SELECT s.*, 
        l.status as loan_status,
        l.payment_method as loan_payment_method,
        l.paid_date as loan_paid_date,
        l.customer_type as loan_customer_type,
        l.customer_name as loan_customer_name,
        l.customer_phone as loan_customer_phone,
        l.restaurant_name as loan_restaurant_name,
        l.restaurant_nie as loan_restaurant_nie
      FROM sales s
      LEFT JOIN loans l ON l.sale_id = s.id
      WHERE s.id = ?
    `).get(id);
    if (sale) {
      sale.items = this.db.prepare(`
        SELECT si.*, COALESCE(si.tax_rate, p.tax_rate, c.tax_rate, 0) AS tax_rate
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.name = p.category
        WHERE si.sale_id = ?
      `).all(id);

      // Attach latest return info (if refunded)
      sale.return = this.db.prepare(`
        SELECT id, return_date, subtotal, tax, total, refund_method, reason
        FROM returns
        WHERE original_sale_id = ?
        ORDER BY return_date DESC
        LIMIT 1
      `).get(id) || null;

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
    const range = this.getBusinessDayRange('today');
    return this.getSalesByDateTimeRange(range.startDateTime, range.endDateTime, null);
  }

  getYesterdaySales() {
    const range = this.getBusinessDayRange('yesterday');
    return this.getSalesByDateTimeRange(range.startDateTime, range.endDateTime, null);
  }

  getSalesByDateTimeRange(startDateTime, endDateTime, cashierId = null) {
    let query = `
      SELECT s.*,
        l.status as loan_status,
        l.payment_method as loan_payment_method,
        l.paid_date as loan_paid_date,
        l.customer_type as loan_customer_type,
        l.customer_name as loan_customer_name,
        l.customer_phone as loan_customer_phone,
        l.restaurant_name as loan_restaurant_name,
        l.restaurant_nie as loan_restaurant_nie
        ,(SELECT json_group_array(json_object(
          'product_id', si.product_id,
          'product_name', si.product_name,
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'tax_rate', COALESCE(si.tax_rate, p.tax_rate, c.tax_rate, 0),
          'discount_percent', si.discount_percent,
          'subtotal', si.subtotal
        ))
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.name = p.category
        WHERE si.sale_id = s.id) as items
      FROM sales s
      LEFT JOIN loans l ON l.sale_id = s.id
      WHERE datetime(s.sale_date) >= datetime(?)
        AND datetime(s.sale_date) <= datetime(?)
    `;

    const params = [startDateTime, endDateTime];
    if (cashierId) {
      query += ' AND s.cashier_id = ?';
      params.push(cashierId);
    }

    const sales = this.db.prepare(query + ' ORDER BY s.sale_date DESC').all(...params);
    for (const sale of sales) {
      try {
        sale.items = sale.items ? JSON.parse(sale.items) : [];
      } catch {
        sale.items = [];
      }
    }

    const summaryParams = cashierId ? [startDateTime, endDateTime, cashierId] : [startDateTime, endDateTime];
    const summary = this.db.prepare(`
      SELECT
        COUNT(*) as transaction_count,
        SUM(total) as total_sales,
        SUM(subtotal) as subtotal,
        SUM(tax) as total_tax
      FROM sales
      WHERE datetime(sale_date) >= datetime(?)
        AND datetime(sale_date) <= datetime(?)
        ${cashierId ? 'AND cashier_id = ?' : ''}
    `).get(...summaryParams);

    return { sales, summary };
  }

  // Report operations
  getSalesReport(startDate, endDate) {
    // Include returns (refunds) in sales reports.
    // - Returns are counted on their return_date.
    // - De-duplicate returns per original_sale_id (keep latest) to avoid historical duplicate refunds.
    // - Compute return totals + return tax from return_items (more reliable than stored totals).
    const returnsCte = `
      return_latest_date AS (
        SELECT original_sale_id, MAX(return_date) AS max_return_date
        FROM returns
        WHERE DATE(return_date) BETWEEN ? AND ?
        GROUP BY original_sale_id
      ),
      return_candidates AS (
        SELECT r.*
        FROM returns r
        JOIN return_latest_date m
          ON m.original_sale_id = r.original_sale_id
         AND m.max_return_date = r.return_date
      ),
      effective_returns AS (
        SELECT rc.*
        FROM return_candidates rc
        JOIN (
          SELECT original_sale_id, MAX(id) AS max_id
          FROM return_candidates
          GROUP BY original_sale_id
        ) mx
          ON mx.original_sale_id = rc.original_sale_id
         AND mx.max_id = rc.id
      ),
      return_totals AS (
        SELECT
          er.id AS return_id,
          er.return_date,
          er.original_sale_id,
          er.refund_method
        FROM effective_returns er
      ),
      return_item_totals AS (
        SELECT
          rt.return_id,
          DATE(rt.return_date) AS date,
          COUNT(DISTINCT rt.return_id) AS return_count,
          COALESCE(SUM(ri.subtotal), 0) AS return_total,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(p.tax_rate, 0) > 0
                THEN (ri.subtotal - (ri.subtotal / (1 + COALESCE(p.tax_rate, 0))))
              ELSE 0
            END
          ), 0) AS return_tax,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(p.tax_rate, 0) > 0
                THEN (ri.subtotal / (1 + COALESCE(p.tax_rate, 0)))
              ELSE ri.subtotal
            END
          ), 0) AS return_subtotal
        FROM return_totals rt
        JOIN return_items ri ON ri.return_id = rt.return_id
        LEFT JOIN products p ON p.id = ri.product_id
        GROUP BY rt.return_id, DATE(rt.return_date)
      ),
      returns_by_date AS (
        SELECT
          date,
          COUNT(*) AS return_count,
          COALESCE(SUM(return_total), 0) AS return_total,
          COALESCE(SUM(return_tax), 0) AS return_tax,
          COALESCE(SUM(return_subtotal), 0) AS return_subtotal
        FROM return_item_totals
        GROUP BY date
      )
    `;

    const sales = this.db.prepare(`
      WITH ${returnsCte},
      dates AS (
        SELECT DATE(s.sale_date) AS date
        FROM sales s
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        UNION
        SELECT date
        FROM returns_by_date
      ),
      sales_by_date AS (
        SELECT
          DATE(sale_date) AS date,
          COUNT(*) AS sales_count,
          COALESCE(SUM(total), 0) AS sales_total,
          COALESCE(SUM(subtotal), 0) AS sales_subtotal,
          COALESCE(SUM(tax), 0) AS sales_tax,
          COALESCE(SUM(discount), 0) AS sales_discount
        FROM sales
        WHERE DATE(sale_date) BETWEEN ? AND ?
        GROUP BY DATE(sale_date)
      )
      SELECT
        d.date AS date,
        CASE
          WHEN (COALESCE(s.sales_count, 0) - COALESCE(r.return_count, 0)) > 0
            THEN (COALESCE(s.sales_count, 0) - COALESCE(r.return_count, 0))
          ELSE 0
        END AS transaction_count,
        (COALESCE(s.sales_total, 0) - COALESCE(r.return_total, 0)) AS total_sales,
        (COALESCE(s.sales_subtotal, 0) - COALESCE(r.return_subtotal, 0)) AS subtotal,
        (COALESCE(s.sales_tax, 0) - COALESCE(r.return_tax, 0)) AS tax,
        COALESCE(s.sales_discount, 0) AS discount,
        COALESCE(s.sales_total, 0) AS gross_sales,
        COALESCE(r.return_total, 0) AS returns_amount,
        COALESCE(s.sales_count, 0) AS gross_transactions,
        COALESCE(r.return_count, 0) AS return_count
      FROM dates d
      LEFT JOIN sales_by_date s ON s.date = d.date
      LEFT JOIN returns_by_date r ON r.date = d.date
      ORDER BY d.date DESC
    `).all(startDate, endDate, startDate, endDate, startDate, endDate);

    const topProducts = this.db.prepare(`
      WITH ${returnsCte},
      sales_by_product AS (
        SELECT
          si.product_id,
          si.product_name,
          COALESCE(SUM(si.quantity), 0) AS sold_quantity,
          COALESCE(SUM(si.subtotal), 0) AS sold_revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        GROUP BY si.product_id, si.product_name
      ),
      returns_by_product AS (
        SELECT
          ri.product_id,
          COALESCE(SUM(ri.quantity), 0) AS return_quantity,
          COALESCE(SUM(ri.subtotal), 0) AS return_revenue
        FROM return_items ri
        JOIN return_totals rt ON rt.return_id = ri.return_id
        GROUP BY ri.product_id
      )
      SELECT
        s.product_name,
        (s.sold_quantity - COALESCE(r.return_quantity, 0)) AS total_quantity,
        (s.sold_revenue - COALESCE(r.return_revenue, 0)) AS total_revenue
      FROM sales_by_product s
      LEFT JOIN returns_by_product r ON r.product_id = s.product_id
      ORDER BY total_revenue DESC
      LIMIT 10
    `).all(startDate, endDate, startDate, endDate);

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
    const row = this.db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!row) {
      return { success: false, errorCode: 'NOT_FOUND', message: 'User not found' };
    }

    if (String(row.role) === 'admin') {
      const adminCount = this.db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
      const count = Number(adminCount?.count || 0);
      if (count <= 1) {
        return { success: false, errorCode: 'LAST_ADMIN', message: 'Cannot delete the last admin user' };
      }
    }

    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { success: true };
  }

  getUserById(id) {
    const user = this.db.prepare('SELECT id, username, full_name, role, created_at FROM users WHERE id = ?').get(id);
    return user;
  }

  // Loan operations
  createOrAppendLoan(loanData) {
    const transaction = this.db.transaction((data) => {
      const customerType = (data.customerType || 'regular').toString().toLowerCase();
      const restaurantName = (data.restaurantName || '').toString().trim();
      const restaurantNie = (data.restaurantNie || '').toString().trim();
      const mergeMode = (data.mergeMode || 'append').toString().toLowerCase();
      const forceNewParking = mergeMode === 'new' || !!data.forceNewParking;
      const canMergeRestaurant = customerType === 'restaurant' && restaurantName.length > 0 && !forceNewParking;

      const targetLoanId = Number.isFinite(Number(data.targetLoanId)) ? Number(data.targetLoanId) : null;

      const sale = data.sale || null;
      const items = Array.isArray(data.items) ? data.items : [];
      if (!sale || !Number.isFinite(Number(sale.total)) || Number(sale.total) <= 0) {
        throw new Error('Invalid sale data for loan');
      }
      if (!items.length) {
        throw new Error('No sale items provided for loan');
      }

      const insertSaleStmt = this.db.prepare(`
        INSERT INTO sales (subtotal, tax, discount, total, payment_method, payment_amount, change_amount, cashier_id, notes, split_payments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertItemStmt = this.db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, tax_rate, discount_percent, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const findMergeableItemStmt = this.db.prepare(`
        SELECT id
        FROM sale_items
        WHERE sale_id = ?
          AND product_id = ?
          AND ABS(unit_price - ?) < 0.0001
          AND ABS(discount_percent - ?) < 0.0001
        LIMIT 1
      `);

      const mergeItemStmt = this.db.prepare(`
        UPDATE sale_items
        SET quantity = quantity + ?,
            subtotal = subtotal + ?
        WHERE id = ?
      `);

      const updateStockStmt = this.db.prepare(`
        UPDATE products SET stock = stock - ? WHERE id = ?
      `);

      const updateSaleTotalsStmt = this.db.prepare(`
        UPDATE sales
        SET subtotal = subtotal + ?,
            tax = tax + ?,
            discount = discount + ?,
            total = total + ?
        WHERE id = ?
      `);

      const updateLoanStmt = this.db.prepare(`
        UPDATE loans
        SET customer_name = ?,
            customer_phone = ?,
            restaurant_name = ?,
            restaurant_nie = ?,
            loan_amount = ?,
            remaining_amount = ?,
            status = ?,
            cashier_id = ?,
            notes = ?
        WHERE id = ?
      `);

      const findExistingRestaurantLoan = () => {
        if (forceNewParking) return null;

        // If a specific loan was selected in the UI, append to it.
        if (targetLoanId) {
          const chosen = this.db.prepare('SELECT * FROM loans WHERE id = ?').get(targetLoanId);
          if (!chosen) throw new Error('Selected parking not found');
          if ((chosen.status || '').toString().toLowerCase() === 'paid') {
            throw new Error('Selected parking is already paid');
          }
          return chosen;
        }

        if (!canMergeRestaurant) return null;

        if (restaurantNie) {
          return this.db.prepare(`
            SELECT * FROM loans
            WHERE customer_type = 'restaurant'
              AND status != 'paid'
              AND LOWER(TRIM(restaurant_name)) = LOWER(TRIM(?))
              AND TRIM(COALESCE(restaurant_nie, '')) = TRIM(?)
            ORDER BY loan_date DESC
            LIMIT 1
          `).get(restaurantName, restaurantNie);
        }

        return this.db.prepare(`
          SELECT * FROM loans
          WHERE customer_type = 'restaurant'
            AND status != 'paid'
            AND LOWER(TRIM(restaurant_name)) = LOWER(TRIM(?))
          ORDER BY loan_date DESC
          LIMIT 1
        `).get(restaurantName);
      };

      const existingLoan = findExistingRestaurantLoan();
      if (existingLoan) {
        const saleId = existingLoan.sale_id;

        for (const item of items) {
          const discountPercent = Number(item.discountPercent || 0);
          const lineSubtotal = Number(item.subtotal || 0);
          const discountAmount = lineSubtotal * (discountPercent / 100);
          const finalSubtotal = lineSubtotal - discountAmount;

          // If the same item already exists in this PARKING, merge it (avoids duplicate lines).
          const productId = Number.isFinite(Number(item.productId)) ? Number(item.productId) : null;
          const unitPrice = Number(item.unitPrice || 0);
          const qty = Number(item.quantity || 0);

          const mergeableId = (productId !== null)
            ? findMergeableItemStmt.get(saleId, productId, unitPrice, discountPercent)?.id
            : null;

          if (mergeableId) {
            mergeItemStmt.run(qty, finalSubtotal, mergeableId);
          } else {
            insertItemStmt.run(
              saleId,
              item.productId,
              item.productName,
              item.quantity,
              item.unitPrice,
              Number(item.taxRate || 0),
              discountPercent,
              finalSubtotal
            );
          }
          updateStockStmt.run(item.quantity, item.productId);
        }

        updateSaleTotalsStmt.run(
          Number(sale.subtotal || 0),
          Number(sale.tax || 0),
          Number(sale.discount || 0),
          Number(sale.total || 0),
          saleId
        );

        const newLoanAmount = Number(existingLoan.loan_amount || 0) + Number(sale.total || 0);
        const paidAmount = Number(existingLoan.paid_amount || 0);
        const remainingAmount = newLoanAmount - paidAmount;
        const status = remainingAmount <= 0.01
          ? 'paid'
          : (paidAmount > 0.01 ? 'partial' : 'pending');

        const nextNotes = (() => {
          const prev = (existingLoan.notes || '').toString().trim();
          const add = (data.notes || '').toString().trim();
          if (!add) return prev || null;
          if (!prev) return add;
          return prev + '\n' + add;
        })();

        updateLoanStmt.run(
          (data.customerName || existingLoan.customer_name),
          (data.customerPhone || existingLoan.customer_phone || null),
          (restaurantName || existingLoan.restaurant_name || null),
          (restaurantNie || existingLoan.restaurant_nie || null),
          newLoanAmount,
          Math.max(0, remainingAmount),
          status,
          data.cashierId || null,
          nextNotes,
          existingLoan.id
        );

        const updated = this.db.prepare('SELECT * FROM loans WHERE id = ?').get(existingLoan.id);
        updated.merged = true;
        return updated;
      }

      // Create a new sale
      const saleResult = insertSaleStmt.run(
        Number(sale.subtotal || 0),
        Number(sale.tax || 0),
        Number(sale.discount || 0),
        Number(sale.total || 0),
        sale.paymentMethod || 'loan',
        Number(sale.paymentAmount || 0),
        Number(sale.changeAmount || 0),
        data.cashierId || null,
        sale.notes || null,
        sale.splitPayments ? JSON.stringify(sale.splitPayments) : null
      );
      const saleId = saleResult.lastInsertRowid;

      for (const item of items) {
        const discountPercent = Number(item.discountPercent || 0);
        const lineSubtotal = Number(item.subtotal || 0);
        const discountAmount = lineSubtotal * (discountPercent / 100);
        const finalSubtotal = lineSubtotal - discountAmount;

        insertItemStmt.run(
          saleId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice,
          Number(item.taxRate || 0),
          discountPercent,
          finalSubtotal
        );
        updateStockStmt.run(item.quantity, item.productId);
      }

      const loanStmt = this.db.prepare(`
        INSERT INTO loans (receipt_number, customer_type, customer_name, customer_phone, restaurant_name, restaurant_nie, sale_id, loan_amount, remaining_amount, cashier_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const loanResult = loanStmt.run(
        data.receiptNumber,
        customerType || 'regular',
        data.customerName,
        data.customerPhone || null,
        restaurantName || null,
        restaurantNie || null,
        saleId,
        Number(sale.total || 0),
        Number(sale.total || 0),
        data.cashierId || null,
        data.notes || null
      );

      const created = this.db.prepare('SELECT * FROM loans WHERE id = ?').get(loanResult.lastInsertRowid);
      created.merged = false;
      return created;
    });

    const loan = transaction(loanData);
    if (loan && loan.sale_id) {
      try {
        loan.sale = this.getSaleById(loan.sale_id);
      } catch {
        // ignore
      }
    }
    return loan;
  }

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
    if (status === 'active') {
      // Return only pending and partial transactions (exclude paid)
      return this.db.prepare('SELECT * FROM loans WHERE status != ? ORDER BY loan_date DESC').all('paid');
    }
    if (status) {
      return this.db.prepare('SELECT * FROM loans WHERE status = ? ORDER BY loan_date DESC').all(status);
    }
    return this.db.prepare('SELECT * FROM loans ORDER BY loan_date DESC').all();
  }

  searchLoans(query, status = null) {
    const raw = String(query || '').trim();
    if (!raw) {
      return this.getAllLoans(status);
    }

    // Case-insensitive LIKE across: receipt, customer, restaurant, phone
    // Note: we use lower(...) so SQLite's default case rules don't bite us.
    const q = '%' + raw.toLowerCase() + '%';

    let where = `(
      lower(receipt_number) LIKE ? OR
      lower(customer_name) LIKE ? OR
      lower(restaurant_name) LIKE ? OR
      lower(customer_phone) LIKE ?
    )`;

    const params = [q, q, q, q];

    if (status === 'active') {
      where = `status != 'paid' AND ` + where;
    } else if (status) {
      where = `status = ? AND ` + where;
      params.unshift(String(status));
    }

    return this.db
      .prepare(`SELECT * FROM loans WHERE ${where} ORDER BY loan_date DESC`)
      .all(...params);
  }

  listLoanParties(query = '', limit = 60) {
    const raw = String(query || '').trim().toLowerCase();
    const like = '%' + raw + '%';
    const maxUnique = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 60;

    // Pull the most recent loans and dedupe in JS. This keeps the SQL simple and fast enough.
    const rows = this.db.prepare(`
      SELECT id, receipt_number, customer_type, customer_name, customer_phone, restaurant_name, restaurant_nie, status, loan_date
      FROM loans
      WHERE (
        lower(COALESCE(receipt_number, '')) LIKE ? OR
        lower(COALESCE(customer_name, '')) LIKE ? OR
        lower(COALESCE(customer_phone, '')) LIKE ? OR
        lower(COALESCE(restaurant_name, '')) LIKE ?
      )
      ORDER BY loan_date DESC
      LIMIT 600
    `).all(like, like, like, like);

    const keyFor = (r) => {
      const type = (r.customer_type || 'regular').toString().toLowerCase();
      if (type === 'restaurant') {
        const name = (r.restaurant_name || '').toString().trim().toLowerCase();
        const nie = (r.restaurant_nie || '').toString().trim().toLowerCase();
        return `restaurant:${name}|${nie}`;
      }
      const name = (r.customer_name || '').toString().trim().toLowerCase();
      const phone = (r.customer_phone || '').toString().trim().toLowerCase();
      return `regular:${name}|${phone}`;
    };

    const parties = new Map();

    for (const r of rows) {
      const key = keyFor(r);
      if (!key || key.endsWith(':|')) continue;
      if (!parties.has(key)) {
        parties.set(key, {
          key,
          customer_type: (r.customer_type || 'regular').toString().toLowerCase(),
          customer_name: r.customer_name || '',
          customer_phone: r.customer_phone || '',
          restaurant_name: r.restaurant_name || '',
          restaurant_nie: r.restaurant_nie || '',
          last_loan_date: r.loan_date || null,
          last_receipt_number: r.receipt_number || null,
          active_loan_id: null,
          active_receipt_number: null
        });
      }

      // Track the most recent unpaid loan for this party (used for "append")
      const status = (r.status || '').toString().toLowerCase();
      if (status !== 'paid') {
        const p = parties.get(key);
        if (!p.active_loan_id) {
          p.active_loan_id = r.id;
          p.active_receipt_number = r.receipt_number || null;
        }
      }
    }

    return Array.from(parties.values()).slice(0, maxUnique);
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

      // Store payment event (so Z report can count it by payment date)
      this.db.prepare(`
        INSERT INTO loan_payments (loan_id, payment_date, amount, payment_method, cashier_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        loanId,
        new Date().toISOString(),
        data.amount,
        data.paymentMethod,
        data.cashierId || null
      );

      const paidAmount = loan.paid_amount + data.amount;
      const remainingAmount = loan.loan_amount - paidAmount;
      const status = remainingAmount <= 0.01 ? 'paid' : 'partial'; // Use small threshold for floating point precision
      
      console.log('Loan payment calculation:', {
        loanAmount: loan.loan_amount,
        previouslyPaid: loan.paid_amount,
        paymentAmount: data.amount,
        newPaidAmount: paidAmount,
        remainingAmount: remainingAmount,
        newStatus: status
      });

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

  getLoanPaymentsByDateRange(startDate, endDate, cashierId = null) {
    let query = `
      SELECT lp.*
      FROM loan_payments lp
      WHERE lp.payment_date BETWEEN ? AND ?
    `;

    if (cashierId) {
      query += ' AND lp.cashier_id = ?';
      return this.db.prepare(query + ' ORDER BY lp.payment_date').all(startDate, endDate, cashierId);
    }

    return this.db.prepare(query + ' ORDER BY lp.payment_date').all(startDate, endDate);
  }

  getLoanPaymentsByDateTimeRange(startDateTime, endDateTime, cashierId = null) {
    let query = `
      SELECT lp.*
      FROM loan_payments lp
      WHERE datetime(lp.payment_date) >= datetime(?)
        AND datetime(lp.payment_date) <= datetime(?)
    `;

    const params = [startDateTime, endDateTime];
    if (cashierId) {
      query += ' AND lp.cashier_id = ?';
      params.push(cashierId);
    }

    return this.db.prepare(query + ' ORDER BY lp.payment_date').all(...params);
  }

  getLoanPaymentsDetailedByDateTimeRange(startDateTime, endDateTime, cashierId = null) {
    // Includes the underlying loan sale + items so reports can attribute VAT and revenue
    // on the day money is collected.
    let query = `
      SELECT
        lp.*,
        l.sale_id AS sale_id,
        l.loan_amount AS loan_amount,
        s.total AS sale_total,
        s.sale_date AS sale_date,
        (SELECT json_group_array(json_object(
          'product_id', si.product_id,
          'product_name', si.product_name,
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'tax_rate', COALESCE(si.tax_rate, p.tax_rate, c.tax_rate, 0),
          'discount_percent', si.discount_percent,
          'subtotal', si.subtotal
        ))
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.name = p.category
        WHERE si.sale_id = s.id) as items
      FROM loan_payments lp
      JOIN loans l ON l.id = lp.loan_id
      JOIN sales s ON s.id = l.sale_id
      WHERE datetime(lp.payment_date) >= datetime(?)
        AND datetime(lp.payment_date) <= datetime(?)
    `;

    const params = [startDateTime, endDateTime];
    if (cashierId) {
      query += ' AND lp.cashier_id = ?';
      params.push(cashierId);
    }

    const rows = this.db.prepare(query + ' ORDER BY lp.payment_date').all(...params);
    for (const r of rows) {
      try {
        r.items = r.items ? JSON.parse(r.items) : [];
      } catch {
        r.items = [];
      }
    }
    return rows;
  }

  getLoanById(id) {
    return this.db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
  }

  // Remove a single item line from a loan's underlying sale and recalculate totals.
  // Used for editing PARKING before payment.
  removeSaleItemFromLoan(loanId, saleItemId) {
    const moneyToCents = (amount) => {
      const num = Number(amount);
      if (!Number.isFinite(num)) return 0;
      return Math.round((num + Number.EPSILON) * 100);
    };

    const centsToMoney = (cents) => {
      const num = Number(cents);
      if (!Number.isFinite(num)) return 0;
      return num / 100;
    };

    const transaction = this.db.transaction(() => {
      const loan = this.db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
      if (!loan) throw new Error('Loan not found');
      if ((loan.status || '').toString().toLowerCase() === 'paid') {
        throw new Error('Cannot edit a paid PARKING');
      }

      const saleId = loan.sale_id;
      if (!saleId) throw new Error('Loan sale not found');

      const item = this.db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(saleItemId, saleId);
      if (!item) throw new Error('Sale item not found');

      // Restore stock (best-effort)
      if (item.product_id !== null && item.product_id !== undefined) {
        try {
          this.db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
        } catch {
          // ignore
        }
      }

      this.db.prepare('DELETE FROM sale_items WHERE id = ? AND sale_id = ?').run(saleItemId, saleId);

      // Recalculate sale totals from remaining sale_items
      const rows = this.db.prepare(`
        SELECT si.*, COALESCE(p.tax_rate, c.tax_rate, 0) AS tax_rate
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.name = p.category
        WHERE si.sale_id = ?
      `).all(saleId);

      let subtotalCents = 0;
      let taxCents = 0;
      let discountCents = 0;
      let totalCents = 0;

      for (const r of rows) {
        const qty = Number(r.quantity || 0);
        const unitPriceCents = moneyToCents(Number(r.unit_price || 0));
        const originalCents = Math.round(unitPriceCents * qty);
        const discPercent = Number(r.discount_percent || 0);
        const lineDiscountCents = Math.round(originalCents * (discPercent / 100));
        const finalCents = Math.max(0, originalCents - lineDiscountCents);

        const taxRate = Number(r.tax_rate || 0);
        const baseCents = Math.round(finalCents / (1 + taxRate));
        const lineTaxCents = finalCents - baseCents;

        subtotalCents += baseCents;
        taxCents += lineTaxCents;
        discountCents += lineDiscountCents;
        totalCents += finalCents;
      }

      this.db.prepare(`
        UPDATE sales
        SET subtotal = ?, tax = ?, discount = ?, total = ?
        WHERE id = ?
      `).run(
        centsToMoney(subtotalCents),
        centsToMoney(taxCents),
        centsToMoney(discountCents),
        centsToMoney(totalCents),
        saleId
      );

      const paidAmount = Number(loan.paid_amount || 0);
      const newLoanAmount = centsToMoney(totalCents);
      const remainingAmount = Math.max(0, newLoanAmount - paidAmount);
      const status = remainingAmount <= 0.01
        ? 'paid'
        : (paidAmount > 0.01 ? 'partial' : 'pending');

      this.db.prepare(`
        UPDATE loans
        SET loan_amount = ?, remaining_amount = ?, status = ?
        WHERE id = ?
      `).run(
        newLoanAmount,
        remainingAmount,
        status,
        loanId
      );

      const updated = this.db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
      try {
        updated.sale = this.getSaleById(updated.sale_id);
      } catch {
        // ignore
      }
      return updated;
    });

    return transaction();
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
      const existing = this.db.prepare(
        'SELECT id, return_date FROM returns WHERE original_sale_id = ? ORDER BY return_date DESC LIMIT 1'
      ).get(data.originalSaleId);

      if (existing) {
        const msg = `Return already exists for receipt #${data.originalSaleId} (Return ID: ${existing.id}).`;
        const err = new Error(msg);
        err.code = 'RETURN_ALREADY_EXISTS';
        throw err;
      }

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

  getReturnByOriginalSaleId(originalSaleId) {
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
      WHERE r.original_sale_id = ?
      ORDER BY r.return_date DESC
      LIMIT 1
    `).get(originalSaleId);

    if (result && result.items) {
      try {
        result.items = JSON.parse(result.items);
      } catch (e) {
        // leave as-is
      }
    }
    return result;
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
          total_expenses, expense_description, expenses_json,
          tax_7_base, tax_7_amount, tax_19_base, tax_19_amount, total_tax, tax_breakdown_json,
          expected_cash, actual_cash, cash_difference, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        data.expenses_json || null,
        data.tax_7_base || 0,
        data.tax_7_amount || 0,
        data.tax_19_base || 0,
        data.tax_19_amount || 0,
        data.total_tax || 0,
        data.tax_breakdown_json || null,
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

  getMonthlySalesActualTotals() {
    try {
      return this.db.prepare(`
        SELECT
          strftime('%Y-%m', sale_date) AS month,
          COALESCE(SUM(CASE WHEN payment_method != 'loan' THEN total ELSE 0 END), 0) AS total,
          COALESCE(SUM(CASE WHEN payment_method = 'cash'  THEN total ELSE 0 END), 0) AS cash,
          COALESCE(SUM(CASE WHEN payment_method = 'card'  THEN total ELSE 0 END), 0) AS card,
          COUNT(CASE WHEN payment_method != 'loan' THEN 1 END) AS sale_count
        FROM sales
        GROUP BY strftime('%Y-%m', sale_date)
        ORDER BY month DESC
      `).all();
    } catch (e) {
      console.error('getMonthlySalesActualTotals error:', e);
      return [];
    }
  }

  getSalesByDateRange(startDate, endDate, cashierId = null) {
    let query = `
      SELECT s.*,
        l.status as loan_status,
        l.payment_method as loan_payment_method,
        l.paid_date as loan_paid_date,
        l.customer_type as loan_customer_type,
        l.customer_name as loan_customer_name,
        l.customer_phone as loan_customer_phone,
        l.restaurant_name as loan_restaurant_name,
        l.restaurant_nie as loan_restaurant_nie,
        (SELECT json_group_array(json_object(
          'product_id', si.product_id,
          'product_name', si.product_name,
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'tax_rate', COALESCE(si.tax_rate, p.tax_rate, c.tax_rate, 0),
          'discount_percent', si.discount_percent,
          'subtotal', si.subtotal
        ))
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.name = p.category
        WHERE si.sale_id = s.id) as items
      FROM sales s
      LEFT JOIN loans l ON l.sale_id = s.id
      WHERE DATE(s.sale_date) BETWEEN DATE(?) AND DATE(?)
    `;
    
    if (cashierId) {
      query += ` AND s.cashier_id = ?`;
      const sales = this.db.prepare(query + ` ORDER BY s.sale_date DESC`).all(startDate, endDate, cashierId);
    } else {
      const sales = this.db.prepare(query + ` ORDER BY s.sale_date DESC`).all(startDate, endDate);
    }
    
    // Parse JSON items and calculate summary
    const salesWithItems = cashierId 
      ? this.db.prepare(query + ` ORDER BY s.sale_date DESC`).all(startDate, endDate, cashierId)
      : this.db.prepare(query + ` ORDER BY s.sale_date DESC`).all(startDate, endDate);
      
    salesWithItems.forEach(sale => {
      try {
        sale.items = sale.items ? JSON.parse(sale.items) : [];
      } catch (e) {
        sale.items = [];
      }
    });

    const summary = {
      transaction_count: salesWithItems.length,
      total_sales: salesWithItems.reduce((sum, sale) => sum + (sale.total || 0), 0),
      subtotal: salesWithItems.reduce((sum, sale) => sum + (sale.subtotal || 0), 0),
      tax: salesWithItems.reduce((sum, sale) => sum + (sale.tax || 0), 0)
    };

    return {
      sales: salesWithItems,
      summary: summary
    };
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
      WHERE DATE(r.return_date) BETWEEN DATE(?) AND DATE(?)
    `;
    
    if (cashierId) {
      query += ` AND r.cashier_id = ?`;
      return this.db.prepare(query + ` ORDER BY r.return_date`).all(startDate, endDate, cashierId);
    }
    
    return this.db.prepare(query + ` ORDER BY r.return_date`).all(startDate, endDate);
  }

  getReturnsByDateTimeRange(startDateTime, endDateTime, cashierId = null) {
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
      WHERE datetime(r.return_date) >= datetime(?)
        AND datetime(r.return_date) <= datetime(?)
    `;

    const params = [startDateTime, endDateTime];
    if (cashierId) {
      query += ` AND r.cashier_id = ?`;
      params.push(cashierId);
    }

    return this.db.prepare(query + ` ORDER BY r.return_date`).all(...params);
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
          customer_display_port = ?,
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
      settings.printerName || null,
      settings.customerDisplayPort || null
    );
    return this.getSystemSettings();
  }

  setCustomerDisplayPort(portPath) {
    const value = portPath ? String(portPath) : null;
    this.db.prepare(`
      UPDATE system_settings
      SET customer_display_port = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(value);
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
    // Returns are stored separately from sales. For analytics we want net figures:
    //   net = sales in range - returns in range
    // Also, de-duplicate returns by original_sale_id (keep the latest) to avoid old duplicate refunds
    // inflating reports.
    const returnsCte = `
      return_latest_date AS (
        SELECT original_sale_id, MAX(return_date) AS max_return_date
        FROM returns
        WHERE DATE(return_date) BETWEEN ? AND ?
        GROUP BY original_sale_id
      ),
      return_candidates AS (
        SELECT r.*
        FROM returns r
        JOIN return_latest_date m
          ON m.original_sale_id = r.original_sale_id
         AND m.max_return_date = r.return_date
      ),
      effective_returns AS (
        SELECT rc.*
        FROM return_candidates rc
        JOIN (
          SELECT original_sale_id, MAX(id) AS max_id
          FROM return_candidates
          GROUP BY original_sale_id
        ) mx
          ON mx.original_sale_id = rc.original_sale_id
         AND mx.max_id = rc.id
      ),
      return_totals AS (
        SELECT er.id AS return_id,
               er.return_date,
               er.original_sale_id,
               er.refund_method,
               COALESCE((SELECT SUM(subtotal) FROM return_items ri WHERE ri.return_id = er.id), 0) AS return_total
        FROM effective_returns er
      )
    `;

    // Sales trends by date (net)
    const salesTrends = this.db.prepare(`
      WITH ${returnsCte},
      dates AS (
        SELECT DATE(s.sale_date) AS date
        FROM sales s
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        UNION
        SELECT DATE(rt.return_date) AS date
        FROM return_totals rt
      ),
      sales_by_date AS (
        SELECT
          DATE(s.sale_date) AS date,
          COUNT(*) AS gross_transaction_count,
          COALESCE(SUM(s.total), 0) AS gross_sales,
          COALESCE(SUM(s.total - s.tax), 0) AS gross_net_sales,
          COALESCE(SUM(s.tax), 0) AS total_tax
        FROM sales s
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        GROUP BY DATE(s.sale_date)
      ),
      returns_by_date AS (
        SELECT
          DATE(rt.return_date) AS date,
          COUNT(*) AS return_count,
          COALESCE(SUM(rt.return_total), 0) AS total_returns
        FROM return_totals rt
        GROUP BY DATE(rt.return_date)
      )
      SELECT
        d.date AS date,
        (COALESCE(s.gross_transaction_count, 0) - COALESCE(r.return_count, 0)) AS transaction_count,
        (COALESCE(s.gross_sales, 0) - COALESCE(r.total_returns, 0)) AS total_sales,
        (COALESCE(s.gross_net_sales, 0) - COALESCE(r.total_returns, 0)) AS net_sales,
        COALESCE(s.total_tax, 0) AS total_tax,
        COALESCE(s.gross_sales, 0) AS gross_sales,
        COALESCE(r.total_returns, 0) AS total_returns,
        COALESCE(s.gross_transaction_count, 0) AS gross_transaction_count,
        COALESCE(r.return_count, 0) AS return_count
      FROM dates d
      LEFT JOIN sales_by_date s ON s.date = d.date
      LEFT JOIN returns_by_date r ON r.date = d.date
      ORDER BY d.date
    `).all(startDate, endDate, startDate, endDate, startDate, endDate);

    // Peak hours analysis (net)
    const peakHours = this.db.prepare(`
      WITH ${returnsCte},
      hours AS (
        SELECT CAST(strftime('%H', s.sale_date) AS INTEGER) AS hour
        FROM sales s
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        UNION
        SELECT CAST(strftime('%H', rt.return_date) AS INTEGER) AS hour
        FROM return_totals rt
      ),
      sales_by_hour AS (
        SELECT
          CAST(strftime('%H', s.sale_date) AS INTEGER) AS hour,
          COUNT(*) AS gross_transaction_count,
          COALESCE(SUM(s.total), 0) AS gross_sales
        FROM sales s
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        GROUP BY hour
      ),
      returns_by_hour AS (
        SELECT
          CAST(strftime('%H', rt.return_date) AS INTEGER) AS hour,
          COUNT(*) AS return_count,
          COALESCE(SUM(rt.return_total), 0) AS total_returns
        FROM return_totals rt
        GROUP BY hour
      )
      SELECT
        h.hour AS hour,
        (COALESCE(s.gross_transaction_count, 0) - COALESCE(r.return_count, 0)) AS transaction_count,
        (COALESCE(s.gross_sales, 0) - COALESCE(r.total_returns, 0)) AS total_sales,
        CASE
          WHEN (COALESCE(s.gross_transaction_count, 0) - COALESCE(r.return_count, 0)) > 0
            THEN ROUND((COALESCE(s.gross_sales, 0) - COALESCE(r.total_returns, 0)) / (COALESCE(s.gross_transaction_count, 0) - COALESCE(r.return_count, 0)), 2)
          ELSE 0
        END AS avg_transaction,
        COALESCE(s.gross_transaction_count, 0) AS gross_transaction_count,
        COALESCE(r.return_count, 0) AS return_count,
        COALESCE(s.gross_sales, 0) AS gross_sales,
        COALESCE(r.total_returns, 0) AS total_returns
      FROM hours h
      LEFT JOIN sales_by_hour s ON s.hour = h.hour
      LEFT JOIN returns_by_hour r ON r.hour = h.hour
      ORDER BY h.hour
    `).all(startDate, endDate, startDate, endDate, startDate, endDate);

    // Top products by net revenue
    const topProducts = this.db.prepare(`
      WITH ${returnsCte},
      sales_by_product AS (
        SELECT
          si.product_id,
          si.product_name,
          COALESCE(p.category, 'Uncategorized') AS category,
          COALESCE(p.cost, 0) AS cost,
          COALESCE(SUM(si.quantity), 0) AS sold_quantity,
          COALESCE(SUM(si.subtotal), 0) AS sold_revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        LEFT JOIN products p ON si.product_id = p.id
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        GROUP BY si.product_id, si.product_name, category, cost
      ),
      returns_by_product AS (
        SELECT
          ri.product_id,
          COALESCE(SUM(ri.quantity), 0) AS return_quantity,
          COALESCE(SUM(ri.subtotal), 0) AS return_revenue
        FROM return_items ri
        JOIN return_totals rt ON rt.return_id = ri.return_id
        GROUP BY ri.product_id
      )
      SELECT
        s.product_id,
        s.product_name,
        s.category,
        (s.sold_quantity - COALESCE(r.return_quantity, 0)) AS total_quantity,
        (s.sold_revenue - COALESCE(r.return_revenue, 0)) AS total_revenue,
        s.cost,
        ((s.sold_revenue - COALESCE(r.return_revenue, 0)) - ((s.sold_quantity - COALESCE(r.return_quantity, 0)) * s.cost)) AS total_profit,
        CASE
          WHEN (s.sold_revenue - COALESCE(r.return_revenue, 0)) > 0
            THEN ROUND((((s.sold_revenue - COALESCE(r.return_revenue, 0)) - ((s.sold_quantity - COALESCE(r.return_quantity, 0)) * s.cost)) / (s.sold_revenue - COALESCE(r.return_revenue, 0)) * 100), 2)
          ELSE 0
        END AS profit_margin_percent
      FROM sales_by_product s
      LEFT JOIN returns_by_product r ON r.product_id = s.product_id
      ORDER BY total_revenue DESC
      LIMIT 20
    `).all(startDate, endDate, startDate, endDate);

    // Profit by category (net)
    const categoryProfit = this.db.prepare(`
      WITH ${returnsCte},
      sales_by_category AS (
        SELECT
          COALESCE(p.category, 'Uncategorized') AS category,
          COALESCE(p.cost, 0) AS cost,
          COALESCE(SUM(si.quantity), 0) AS sold_quantity,
          COALESCE(SUM(si.subtotal), 0) AS sold_revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        LEFT JOIN products p ON si.product_id = p.id
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        GROUP BY category
      ),
      returns_by_category AS (
        SELECT
          COALESCE(p.category, 'Uncategorized') AS category,
          COALESCE(SUM(ri.quantity), 0) AS return_quantity,
          COALESCE(SUM(ri.subtotal), 0) AS return_revenue,
          COALESCE(SUM(ri.quantity * COALESCE(p.cost, 0)), 0) AS return_cost
        FROM return_items ri
        JOIN return_totals rt ON rt.return_id = ri.return_id
        LEFT JOIN products p ON ri.product_id = p.id
        GROUP BY category
      ),
      sales_costs AS (
        SELECT
          COALESCE(p.category, 'Uncategorized') AS category,
          COALESCE(SUM(si.quantity * COALESCE(p.cost, 0)), 0) AS sold_cost
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        LEFT JOIN products p ON si.product_id = p.id
        WHERE DATE(s.sale_date) BETWEEN ? AND ?
        GROUP BY category
      )
      SELECT
        sc.category AS category,
        (COALESCE(sc.sold_revenue, 0) - COALESCE(rc.return_revenue, 0)) AS total_revenue,
        (COALESCE(c.sold_cost, 0) - COALESCE(rc.return_cost, 0)) AS total_cost,
        ((COALESCE(sc.sold_revenue, 0) - COALESCE(rc.return_revenue, 0)) - (COALESCE(c.sold_cost, 0) - COALESCE(rc.return_cost, 0))) AS total_profit,
        CASE
          WHEN (COALESCE(sc.sold_revenue, 0) - COALESCE(rc.return_revenue, 0)) > 0
            THEN ROUND((((COALESCE(sc.sold_revenue, 0) - COALESCE(rc.return_revenue, 0)) - (COALESCE(c.sold_cost, 0) - COALESCE(rc.return_cost, 0))) / (COALESCE(sc.sold_revenue, 0) - COALESCE(rc.return_revenue, 0)) * 100), 2)
          ELSE 0
        END AS profit_margin_percent
      FROM sales_by_category sc
      LEFT JOIN returns_by_category rc ON rc.category = sc.category
      LEFT JOIN sales_costs c ON c.category = sc.category
      ORDER BY total_profit DESC
    `).all(startDate, endDate, startDate, endDate, startDate, endDate);

    // Payment method breakdown (net, subtract returns by refund method)
    const paymentMethods = this.db.prepare(`
      WITH ${returnsCte},
      sales_by_method AS (
        SELECT
          COALESCE(payment_method, 'Unknown') AS payment_method,
          COUNT(*) AS gross_transaction_count,
          COALESCE(SUM(total), 0) AS gross_sales
        FROM sales
        WHERE DATE(sale_date) BETWEEN ? AND ?
        GROUP BY payment_method
      ),
      returns_by_method AS (
        SELECT
          COALESCE(rt.refund_method, 'Unknown') AS payment_method,
          COUNT(*) AS return_count,
          COALESCE(SUM(rt.return_total), 0) AS total_returns
        FROM return_totals rt
        GROUP BY rt.refund_method
      )
      SELECT
        s.payment_method AS payment_method,
        (COALESCE(s.gross_transaction_count, 0) - COALESCE(r.return_count, 0)) AS transaction_count,
        (COALESCE(s.gross_sales, 0) - COALESCE(r.total_returns, 0)) AS total_sales,
        CASE
          WHEN (COALESCE(s.gross_transaction_count, 0) - COALESCE(r.return_count, 0)) > 0
            THEN ROUND((COALESCE(s.gross_sales, 0) - COALESCE(r.total_returns, 0)) / (COALESCE(s.gross_transaction_count, 0) - COALESCE(r.return_count, 0)), 2)
          ELSE 0
        END AS avg_transaction
      FROM sales_by_method s
      LEFT JOIN returns_by_method r ON r.payment_method = s.payment_method
    `).all(startDate, endDate, startDate, endDate);

    // Summary statistics (net)
    const salesSummary = this.db.prepare(`
      SELECT
        COUNT(*) AS gross_transactions,
        COALESCE(SUM(total), 0) AS gross_revenue,
        COALESCE(SUM(tax), 0) AS gross_tax,
        COALESCE(MAX(total), 0) AS max_transaction,
        COALESCE(MIN(total), 0) AS min_transaction
      FROM sales
      WHERE DATE(sale_date) BETWEEN ? AND ?
    `).get(startDate, endDate);

    const returnsSummary = this.db.prepare(`
      WITH ${returnsCte}
      SELECT
        COUNT(*) AS total_returns,
        COALESCE(SUM(return_total), 0) AS returns_amount
      FROM return_totals
    `).get(startDate, endDate);

    const grossTransactions = Number(salesSummary?.gross_transactions || 0);
    const grossRevenue = Number(salesSummary?.gross_revenue || 0);
    const grossTax = Number(salesSummary?.gross_tax || 0);
    const totalReturns = Number(returnsSummary?.total_returns || 0);
    const returnsAmount = Number(returnsSummary?.returns_amount || 0);

    const netTransactions = Math.max(0, grossTransactions - totalReturns);
    const netRevenue = grossRevenue - returnsAmount;

    // Calculate total profit (net)
    const grossProfitData = this.db.prepare(`
      SELECT
        COALESCE(SUM(si.subtotal), 0) AS total_revenue,
        COALESCE(SUM(si.quantity * COALESCE(p.cost, 0)), 0) AS total_cost
      FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.sale_date) BETWEEN ? AND ?
    `).get(startDate, endDate);

    const returnsProfitData = this.db.prepare(`
      WITH ${returnsCte}
      SELECT
        COALESCE(SUM(ri.subtotal), 0) AS return_revenue,
        COALESCE(SUM(ri.quantity * COALESCE(p.cost, 0)), 0) AS return_cost
      FROM return_items ri
      JOIN return_totals rt ON rt.return_id = ri.return_id
      LEFT JOIN products p ON ri.product_id = p.id
    `).get(startDate, endDate);

    const grossProfit = Number(grossProfitData?.total_revenue || 0) - Number(grossProfitData?.total_cost || 0);
    const returnsProfit = Number(returnsProfitData?.return_revenue || 0) - Number(returnsProfitData?.return_cost || 0);
    const totalProfit = grossProfit - returnsProfit;

    const profitMargin = netRevenue > 0
      ? ((totalProfit / netRevenue) * 100).toFixed(2)
      : 0;

    const avgTransaction = netTransactions > 0 ? (netRevenue / netTransactions) : 0;

    const summary = {
      total_transactions: netTransactions,
      total_revenue: netRevenue,
      net_revenue: netRevenue,
      total_tax: grossTax,
      avg_transaction: Number.isFinite(avgTransaction) ? Number(avgTransaction.toFixed(2)) : 0,
      max_transaction: Number(salesSummary?.max_transaction || 0),
      min_transaction: Number(salesSummary?.min_transaction || 0),
      gross_transactions: grossTransactions,
      gross_revenue: grossRevenue,
      total_returns: totalReturns,
      returns_amount: returnsAmount
    };

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
  _getExpensesColumns() {
    if (this._expensesColumnsCache) return this._expensesColumnsCache;
    try {
      const cols = new Set(
        (this.db.prepare('PRAGMA table_info(expenses)').all() || [])
          .map(r => String(r?.name || ''))
          .filter(Boolean)
      );
      this._expensesColumnsCache = cols;
      return cols;
    } catch {
      this._expensesColumnsCache = new Set();
      return this._expensesColumnsCache;
    }
  }

  _invalidateExpensesColumnsCache() {
    this._expensesColumnsCache = null;
  }

  createExpense(expenseData) {
    const cols = this._getExpensesColumns();

    const insertCols = ['expense_date', 'category', 'description', 'amount', 'payment_method'];
    const insertVals = [
      expenseData.expenseDate,
      expenseData.category,
      expenseData.description,
      expenseData.amount,
      expenseData.paymentMethod
    ];

    // Support both schemas:
    // - New: user_id
    // - Old: cashier_id
    const uid = expenseData.userId ?? expenseData.cashierId ?? null;
    if (cols.has('user_id')) {
      insertCols.push('user_id');
      insertVals.push(uid);
    }
    if (cols.has('cashier_id')) {
      insertCols.push('cashier_id');
      insertVals.push(uid);
    }

    // Older schemas may require cashier_name NOT NULL.
    if (cols.has('cashier_name')) {
      let cashierName = (expenseData.cashierName ?? expenseData.cashier_name ?? expenseData.userName ?? expenseData.user_name ?? '').toString().trim();
      if (!cashierName && Number.isFinite(Number(uid))) {
        try {
          const u = this.db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(uid);
          cashierName = String(u?.full_name || u?.username || '').trim();
        } catch {
          // ignore
        }
      }
      if (!cashierName) cashierName = 'Unknown';
      insertCols.push('cashier_name');
      insertVals.push(cashierName);
    }

    const placeholders = insertCols.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `INSERT INTO expenses (${insertCols.join(', ')}) VALUES (${placeholders})`
    );

    const result = stmt.run(...insertVals);
    return { id: result.lastInsertRowid, ...expenseData };
  }

  getExpenses(startDate, endDate) {
    const cols = this._getExpensesColumns();
    const joinCol = cols.has('user_id') ? 'e.user_id' : (cols.has('cashier_id') ? 'e.cashier_id' : null);
    const joinClause = joinCol ? `LEFT JOIN users u ON ${joinCol} = u.id` : '';
    const userSelect = joinCol ? 'u.full_name as user_name' : 'NULL as user_name';
    const orderClause = cols.has('created_at')
      ? 'e.expense_date DESC, e.created_at DESC'
      : 'e.expense_date DESC, e.id DESC';

    const stmt = this.db.prepare(`
      SELECT e.*, ${userSelect}
      FROM expenses e
      ${joinClause}
      WHERE DATE(e.expense_date) BETWEEN ? AND ?
      ORDER BY ${orderClause}
    `);
    return stmt.all(startDate, endDate);
  }

  getExpensesByDateTimeRange(startDateTime, endDateTime) {
    const cols = this._getExpensesColumns();
    const joinCol = cols.has('user_id') ? 'e.user_id' : (cols.has('cashier_id') ? 'e.cashier_id' : null);
    const joinClause = joinCol ? `LEFT JOIN users u ON ${joinCol} = u.id` : '';
    const userSelect = joinCol ? 'u.full_name as user_name' : 'NULL as user_name';

    // Prefer created_at for shift/business-day boundaries.
    if (cols.has('created_at')) {
      const stmt = this.db.prepare(`
        SELECT e.*, ${userSelect}
        FROM expenses e
        ${joinClause}
        WHERE datetime(e.created_at) >= datetime(?)
          AND datetime(e.created_at) <= datetime(?)
        ORDER BY e.created_at DESC, e.id DESC
      `);
      return stmt.all(startDateTime, endDateTime);
    }

    // Fallback: older schemas without created_at.
    const stmt = this.db.prepare(`
      SELECT e.*, ${userSelect}
      FROM expenses e
      ${joinClause}
      WHERE DATE(e.expense_date) BETWEEN DATE(?) AND DATE(?)
      ORDER BY e.expense_date DESC, e.id DESC
    `);
    return stmt.all(startDateTime, endDateTime);
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

  getExpenseSummaryByDateTimeRange(startDateTime, endDateTime) {
    const cols = this._getExpensesColumns();
    if (cols.has('created_at')) {
      const summary = this.db.prepare(`
        SELECT
          COUNT(*) as total_count,
          SUM(amount) as total_amount,
          AVG(amount) as avg_amount
        FROM expenses
        WHERE datetime(created_at) >= datetime(?)
          AND datetime(created_at) <= datetime(?)
      `).get(startDateTime, endDateTime);

      const byCategory = this.db.prepare(`
        SELECT category, SUM(amount) as total, COUNT(*) as count
        FROM expenses
        WHERE datetime(created_at) >= datetime(?)
          AND datetime(created_at) <= datetime(?)
        GROUP BY category
        ORDER BY total DESC
      `).all(startDateTime, endDateTime);

      return { ...summary, by_category: byCategory };
    }

    // Fallback: older schemas without created_at.
    return this.getExpenseSummary(startDateTime, endDateTime);
  }
}

module.exports = POSDatabase;
