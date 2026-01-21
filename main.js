const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./database');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

let mainWindow;
let customerDisplayWindow;
let db;
let scalePort = null;
let scaleParser = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  // Check if setup is required
  if (db.isSetupRequired()) {
    mainWindow.loadFile('renderer/setup.html');
  } else {
    mainWindow.loadFile('renderer/index.html');
  }
  
  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (customerDisplayWindow) {
      customerDisplayWindow.close();
    }
  });
}

function createCustomerDisplay() {
  if (customerDisplayWindow) {
    customerDisplayWindow.focus();
    return;
  }

  customerDisplayWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'Customer Display',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#667eea'
  });

  customerDisplayWindow.loadFile('renderer/customer-display.html');
  customerDisplayWindow.setMenuBarVisibility(false);

  customerDisplayWindow.on('closed', () => {
    customerDisplayWindow = null;
  });
}

function updateCustomerDisplay(data) {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow.webContents.send('update-display', data);
  }
}

app.whenReady().then(() => {
  // Initialize database
  db = new Database();
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers for database operations

// Products
ipcMain.handle('products:getAll', async () => {
  return db.getAllProducts();
});

ipcMain.handle('products:search', async (event, query) => {
  return db.searchProducts(query);
});

ipcMain.handle('products:getByBarcode', async (event, barcode) => {
  return db.getProductByBarcode(barcode);
});

ipcMain.handle('products:add', async (event, product) => {
  return db.addProduct(product);
});

ipcMain.handle('products:update', async (event, id, product) => {
  return db.updateProduct(id, product);
});

ipcMain.handle('products:delete', async (event, id) => {
  return db.deleteProduct(id);
});

// Sales
ipcMain.handle('sales:create', async (event, sale) => {
  return db.createSale(sale);
});

ipcMain.handle('sales:getAll', async (event, filters) => {
  return db.getAllSales(filters);
});

ipcMain.handle('sales:getById', async (event, id) => {
  return db.getSaleById(id);
});

ipcMain.handle('sales:getToday', async () => {
  return db.getTodaySales();
});

// Reports
ipcMain.handle('reports:sales', async (event, startDate, endDate) => {
  return db.getSalesReport(startDate, endDate);
});

ipcMain.handle('reports:inventory', async () => {
  return db.getInventoryReport();
});

// Users
ipcMain.handle('users:isSetupRequired', async () => {
  return db.isSetupRequired();
});

ipcMain.handle('users:createFirstAdmin', async (event, userData) => {
  return db.createFirstAdmin(userData.fullName, userData.username, userData.password);
});

ipcMain.handle('users:authenticate', async (event, username, password) => {
  return db.authenticateUser(username, password);
});

ipcMain.handle('users:getAll', async () => {
  return db.getAllUsers();
});

ipcMain.handle('users:add', async (event, user) => {
  return db.addUser(user);
});

ipcMain.handle('users:update', async (event, id, user) => {
  return db.updateUser(id, user);
});

ipcMain.handle('users:updatePassword', async (event, id, password) => {
  return db.updateUserPassword(id, password);
});

ipcMain.handle('users:delete', async (event, id) => {
  return db.deleteUser(id);
});

ipcMain.handle('users:getById', async (event, id) => {
  return db.getUserById(id);
});

// Loans
ipcMain.handle('loans:create', async (event, loanData) => {
  return db.createLoan(loanData);
});

ipcMain.handle('loans:getAll', async (event, status) => {
  return db.getAllLoans(status);
});

ipcMain.handle('loans:getByReceipt', async (event, receiptNumber) => {
  return db.getLoanByReceiptNumber(receiptNumber);
});

ipcMain.handle('loans:pay', async (event, loanId, paymentData) => {
  return db.payLoan(loanId, paymentData);
});

ipcMain.handle('loans:getById', async (event, id) => {
  return db.getLoanById(id);
});

ipcMain.handle('loans:getMonthlyRestaurantReport', async (event, month, year) => {
  return db.getMonthlyRestaurantReport(month, year);
});

// Returns handlers
ipcMain.handle('returns:create', async (event, returnData) => {
  return db.createReturn(returnData);
});

ipcMain.handle('returns:getAll', async () => {
  return db.getAllReturns();
});

ipcMain.handle('returns:getById', async (event, id) => {
  return db.getReturnById(id);
});

// Customer Display handlers
ipcMain.handle('customerDisplay:open', async () => {
  createCustomerDisplay();
  return { success: true };
});

ipcMain.handle('customerDisplay:update', async (event, data) => {
  updateCustomerDisplay(data);
  return { success: true };
});

ipcMain.handle('customerDisplay:close', async () => {
  if (customerDisplayWindow) {
    customerDisplayWindow.close();
    customerDisplayWindow = null;
  }
  return { success: true };
});

// Printer handlers
ipcMain.handle('printer:openDrawer', async () => {
  // ESC/POS command to open cash drawer: ESC p m t1 t2
  // Most thermal printers support this command
  const drawerCommand = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
  
  try {
    // In production, this would be sent to the printer
    // For now, we'll just log it
    console.log('Opening cash drawer...');
    return { success: true, message: 'Cash drawer opened' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('printer:printBarcode', async (event, barcodeData) => {
  try {
    console.log('Printing barcode label:', barcodeData);
    // In production, this would format and send to label printer
    return { success: true, message: 'Barcode label sent to printer' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Z-Report handlers
ipcMain.handle('zreport:create', async (event, reportData) => {
  return db.createZReport(reportData);
});

ipcMain.handle('zreport:getAll', async () => {
  return db.getAllZReports();
});

ipcMain.handle('zreport:getById', async (event, id) => {
  return db.getZReportById(id);
});

ipcMain.handle('zreport:getByNumber', async (event, reportNumber) => {
  return db.getZReportByNumber(reportNumber);
});

ipcMain.handle('zreport:getSalesByDateRange', async (event, startDate, endDate, cashierId) => {
  return db.getSalesByDateRange(startDate, endDate, cashierId);
});

ipcMain.handle('zreport:getReturnsByDateRange', async (event, startDate, endDate, cashierId) => {
  return db.getReturnsByDateRange(startDate, endDate, cashierId);
});

// System Settings handlers
ipcMain.handle('settings:get', async () => {
  return db.getSystemSettings();
});

ipcMain.handle('settings:update', async (event, settings) => {
  return db.updateSystemSettings(settings);
});

// Category handlers
ipcMain.handle('categories:getAll', async () => {
  return db.getAllCategories();
});

ipcMain.handle('categories:getById', async (event, id) => {
  return db.getCategoryById(id);
});

ipcMain.handle('categories:add', async (event, category) => {
  return db.addCategory(category);
});

ipcMain.handle('categories:update', async (event, id, category) => {
  return db.updateCategory(id, category);
});

ipcMain.handle('categories:delete', async (event, id) => {
  return db.deleteCategory(id);
});

ipcMain.handle('categories:toggleFavorite', async (event, id, isFavorite) => {
  return db.toggleCategoryFavorite(id, isFavorite);
});

ipcMain.handle('categories:getFavorites', async () => {
  return db.getFavoriteCategories();
});

// Subcategory handlers
ipcMain.handle('subcategories:getAll', async () => {
  return db.getAllSubcategories();
});

ipcMain.handle('subcategories:getByCategoryId', async (event, categoryId) => {
  return db.getSubcategoriesByCategoryId(categoryId);
});

ipcMain.handle('subcategories:getById', async (event, id) => {
  return db.getSubcategoryById(id);
});

ipcMain.handle('subcategories:add', async (event, subcategory) => {
  return db.addSubcategory(subcategory);
});

ipcMain.handle('subcategories:update', async (event, id, subcategory) => {
  return db.updateSubcategory(id, subcategory);
});

ipcMain.handle('subcategories:delete', async (event, id) => {
  return db.deleteSubcategory(id);
});

// ========== SCALE FUNCTIONS ==========
// List available serial ports
ipcMain.handle('scale:listPorts', async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(port => ({
      path: port.path,
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
      pnpId: port.pnpId,
      vendorId: port.vendorId,
      productId: port.productId
    }));
  } catch (error) {
    console.error('Error listing ports:', error);
    return [];
  }
});

// Connect to scale
ipcMain.handle('scale:connect', async (event, portPath) => {
  try {
    if (scalePort && scalePort.isOpen) {
      scalePort.close();
    }

    scalePort = new SerialPort({
      path: portPath,
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none'
    });

    scaleParser = scalePort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    return { success: true, message: 'Scale connected successfully' };
  } catch (error) {
    console.error('Error connecting to scale:', error);
    return { success: false, message: error.message };
  }
});

// Read weight from scale
ipcMain.handle('scale:readWeight', async () => {
  return new Promise((resolve, reject) => {
    if (!scalePort || !scalePort.isOpen) {
      resolve({ success: false, message: 'Scale not connected' });
      return;
    }

    let timeout = setTimeout(() => {
      resolve({ success: false, message: 'Timeout reading from scale' });
    }, 10000); // Increased to 10 seconds to allow more time for scale response

    const dataHandler = (data) => {
      clearTimeout(timeout);
      scaleParser.removeListener('data', dataHandler);
      
      console.log('Raw scale data:', data);
      
      // Parse weight from scale data
      // GRAM ZFOC can send various formats:
      // "  0.500 kg", "0.500", "ST,GS,+0.500kg", etc.
      
      // Remove common prefixes and suffixes
      let cleanData = data.replace(/ST,GS,/g, '').replace(/kg/gi, '').replace(/\s+/g, '');
      
      // Extract number (handle both positive and negative)
      const match = cleanData.match(/([+-]?\d+\.?\d*)/);
      if (match) {
        const weight = Math.abs(parseFloat(match[1])); // Use absolute value
        
        // Validate weight is reasonable (0.001 kg to 100 kg)
        if (weight >= 0.001 && weight <= 100) {
          console.log('Parsed weight:', weight);
          resolve({ success: true, weight: weight });
        } else if (weight === 0) {
          resolve({ success: false, message: 'Scale shows 0. Please place item on scale.' });
        } else {
          resolve({ success: false, message: 'Weight out of range: ' + weight });
        }
      } else {
        resolve({ success: false, message: 'Could not parse weight data: ' + data });
      }
    };

    scaleParser.on('data', dataHandler);

    // Try multiple commands that GRAM scales might respond to
    try {
      scalePort.write('P\r\n'); // Request weight
      
      // Some scales respond without needing a command
      // If no response after 1 second, try alternative command
      setTimeout(() => {
        if (scalePort && scalePort.isOpen) {
          try {
            scalePort.write('W\r\n'); // Alternative weight request
          } catch (e) {
            console.error('Error sending alternative command:', e);
          }
        }
      }, 1000);
      
    } catch (error) {
      clearTimeout(timeout);
      scaleParser.removeListener('data', dataHandler);
      resolve({ success: false, message: 'Error writing to scale' });
    }
  });
});

// Disconnect scale
ipcMain.handle('scale:disconnect', async () => {
  try {
    if (scalePort && scalePort.isOpen) {
      scalePort.close();
      scalePort = null;
      scaleParser = null;
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

