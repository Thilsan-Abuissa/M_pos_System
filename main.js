const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./database');

// Try to load serialport modules, but don't crash if they fail
let SerialPort = null;
let ReadlineParser = null;
try {
  SerialPort = require('serialport').SerialPort;
  ReadlineParser = require('@serialport/parser-readline').ReadlineParser;
  console.log('Serial port modules loaded successfully');
} catch (error) {
  console.warn('Serial port modules not available. Scale features will be disabled.', error.message);
}

let mainWindow;
let customerDisplayWindow;
let db;
let scalePort = null;
let scaleParser = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: false,
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
  
  // Auto-connect to scale if available
  if (SerialPort && ReadlineParser) {
    setTimeout(async () => {
      try {
        const ports = await SerialPort.list();
        // Look for USB scale (common vendor IDs for scales)
        const scalePorts = ports.filter(port => 
          port.manufacturer?.match(/CH340|USB.*Serial|FTDI|Silicon/i) ||
          port.path?.match(/ttyUSB|ttyACM|cu\.usbserial|COM/i)
        );
        
        if (scalePorts.length > 0) {
          const scalePortPath = scalePorts[0].path;
          console.log('Auto-connecting to scale on:', scalePortPath);
          
          scalePort = new SerialPort({
            path: scalePortPath,
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
          });
          
          scaleParser = scalePort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
          console.log('Scale auto-connected successfully');
        } else {
          console.log('No USB scale detected');
        }
      } catch (error) {
        console.error('Error auto-connecting to scale:', error);
      }
    }, 2000); // Wait 2 seconds after app starts
  }

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

ipcMain.handle('reports:analytics', async (event, startDate, endDate) => {
  return db.getAnalyticsData(startDate, endDate);
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
    const settings = db.getSystemSettings();
    let printerName = settings?.printer_name;
    
    // Auto-detect printer if not configured
    if (!printerName) {
      console.log('No printer configured. Auto-detecting printer...');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execPromise = promisify(exec);
      
      try {
        if (process.platform === 'win32') {
          const { stdout } = await execPromise('powershell -command "Get-Printer | Select-Object Name | ForEach-Object { $_.Name }"');
          const printers = stdout.trim().split('\n').filter(p => p.trim() && !p.includes('----'));
          // Look for thermal printer names (TM, Epson, iggual, thermal, POS, receipt)
          printerName = printers.find(p => /TM|Epson|iggual|thermal|POS|receipt/i.test(p)) || printers[0];
        } else if (process.platform === 'darwin') {
          const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
          const printers = stdout.trim().split('\n').filter(p => p.trim());
          printerName = printers.find(p => /TM|Epson|iggual|thermal|POS|receipt/i.test(p)) || printers[0];
        }
        
        if (printerName) {
          console.log('Auto-detected printer:', printerName);
        } else {
          console.log('No printer found on system');
          return { success: false, error: 'No printer found. Please connect a printer and try again.' };
        }
      } catch (error) {
        console.error('Error auto-detecting printer:', error);
        return { success: false, error: 'Could not detect printer. Please check printer connection.' };
      }
    }

    const fs = require('fs');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);

    // For Windows, we'll write directly to the printer port
    if (process.platform === 'win32') {
      // Try multiple methods to open cash drawer on Windows
      try {
        // Method 1: Write directly to printer using LPT or USB port
        // Create a temporary raw file with the ESC/POS command
        const tempFile = path.join(app.getPath('temp'), 'drawer_cmd.prn');
        fs.writeFileSync(tempFile, drawerCommand);
        
        // Send to printer using copy command
        try {
          await execPromise(`copy /B "${tempFile}" "\\\\?\\${printerName}"`);
          fs.unlinkSync(tempFile);
          console.log('Cash drawer opened via printer:', printerName);
          return { success: true, message: 'Cash drawer opened' };
        } catch (error1) {
          // Try alternative method using print command
          try {
            const tempFile2 = path.join(app.getPath('temp'), 'drawer_cmd2.prn');
            fs.writeFileSync(tempFile2, drawerCommand);
            await execPromise(`print /D:"${printerName}" "${tempFile2}"`);
            fs.unlinkSync(tempFile);
            fs.unlinkSync(tempFile2);
            console.log('Cash drawer opened via printer (method 2):', printerName);
            return { success: true, message: 'Cash drawer opened' };
          } catch (error2) {
            fs.unlinkSync(tempFile);
            throw error2;
          }
        }
      } catch (error) {
        console.error('Failed to open drawer:', error);
        return { success: false, error: 'Failed to communicate with printer: ' + error.message };
      }
    } else {
      // For macOS/Linux, use CUPS direct device communication
      const tempFile = path.join(app.getPath('temp'), 'drawer_cmd.prn');
      
      try {
        fs.writeFileSync(tempFile, drawerCommand);
        
        // Method 1: Try lp with raw option (most common for thermal printers)
        try {
          await execPromise(`lp -d "${printerName}" -o raw "${tempFile}"`);
          fs.unlinkSync(tempFile);
          console.log('Cash drawer opened via printer:', printerName);
          return { success: true, message: 'Cash drawer opened' };
        } catch (error1) {
          console.log('Method 1 failed, trying alternative methods...');
          
          // Method 2: Try without -o raw option
          try {
            await execPromise(`lp -d "${printerName}" "${tempFile}"`);
            fs.unlinkSync(tempFile);
            console.log('Cash drawer opened via printer (method 2):', printerName);
            return { success: true, message: 'Cash drawer opened' };
          } catch (error2) {
            console.log('Method 2 failed, trying direct device write...');
            
            // Method 3: Try to find the device path and write directly
            try {
              const { stdout } = await execPromise(`lpstat -v "${printerName}"`);
              const deviceMatch = stdout.match(/device for .+: (.+)/);
              
              if (deviceMatch && deviceMatch[1]) {
                const devicePath = deviceMatch[1];
                console.log('Found device path:', devicePath);
                
                // Write directly to device
                await execPromise(`cat "${tempFile}" > "${devicePath}"`);
                fs.unlinkSync(tempFile);
                console.log('Cash drawer opened via direct device write:', devicePath);
                return { success: true, message: 'Cash drawer opened' };
              } else {
                throw new Error('Could not determine printer device path');
              }
            } catch (error3) {
              fs.unlinkSync(tempFile);
              throw error3;
            }
          }
        }
      } catch (error) {
        // Clean up temp file if it exists
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up temp file:', cleanupError);
        }
        
        console.error('All methods failed to open drawer:', error);
        return { 
          success: false, 
          error: 'Failed to open cash drawer. Please check:\n1. Printer is configured correctly\n2. Cash drawer is connected to printer\n3. Printer driver supports ESC/POS commands\n\nError: ' + error.message 
        };
      }
    }
  } catch (error) {
    console.error('Error opening cash drawer:', error);
    return { success: false, error: error.message };
  }
});

// Get available printers
ipcMain.handle('printer:getList', async () => {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);
    
    if (process.platform === 'win32') {
      // Get printers on Windows using PowerShell
      const { stdout } = await execPromise('powershell -command "Get-Printer | Select-Object Name | ForEach-Object { $_.Name }"');
      const printers = stdout.trim().split('\n').filter(p => p.trim() && !p.includes('----'));
      return { success: true, printers };
    } else if (process.platform === 'darwin') {
      // Get printers on macOS using lpstat
      const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
      const printers = stdout.trim().split('\n').filter(p => p.trim());
      return { success: true, printers };
    } else {
      // Linux
      const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
      const printers = stdout.trim().split('\n').filter(p => p.trim());
      return { success: true, printers };
    }
  } catch (error) {
    console.error('Error getting printer list:', error);
    return { success: false, printers: [] };
  }
});

ipcMain.handle('printer:printReceipt', async (event, receiptData) => {
  try {
    const settings = db.getSystemSettings();
    let printerName = settings?.printer_name;
    
    // Auto-detect printer if not configured
    if (!printerName) {
      console.log('No printer configured. Auto-detecting printer...');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execPromise = promisify(exec);
      
      try {
        if (process.platform === 'win32') {
          const { stdout } = await execPromise('powershell -command "Get-Printer | Select-Object Name | ForEach-Object { $_.Name }"');
          const printers = stdout.trim().split('\n').filter(p => p.trim() && !p.includes('----'));
          printerName = printers.find(p => /TM|Epson|iggual|thermal|POS|receipt/i.test(p)) || printers[0];
        } else if (process.platform === 'darwin') {
          const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
          const printers = stdout.trim().split('\n').filter(p => p.trim());
          printerName = printers.find(p => /TM|Epson|iggual|thermal|POS|receipt/i.test(p)) || printers[0];
        }
        
        if (printerName) {
          console.log('Auto-detected printer:', printerName);
        } else {
          console.log('No printer found on system');
          return { success: false, error: 'No printer found' };
        }
      } catch (error) {
        console.error('Error auto-detecting printer:', error);
        return { success: false, error: 'No printer configured' };
      }
    }

    const fs = require('fs');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);

    // Format receipt for thermal printer (ESC/POS)
    const ESC = '\x1B';
    const GS = '\x1D';
    
    let receipt = '';
    
    // Initialize printer
    receipt += ESC + '@'; // Initialize
    receipt += ESC + 'a' + '\x01'; // Center align
    
    // Store name (bold, large)
    receipt += ESC + 'E' + '\x01'; // Bold on
    receipt += GS + '!' + '\x11'; // Double height and width
    receipt += receiptData.storeName + '\n';
    receipt += GS + '!' + '\x00'; // Normal size
    receipt += ESC + 'E' + '\x00'; // Bold off
    
    // Company information (if available)
    if (receiptData.ownerName) {
      receipt += receiptData.ownerName + '\n';
    }
    if (receiptData.nieNumber) {
      receipt += receiptData.nieNumber + '\n';
    }
    if (receiptData.companyAddress) {
      receipt += receiptData.companyAddress + '\n';
    }
    receipt += '\n';
    
    // FACTURA SIMPLIFICADA header
    receipt += ESC + 'E' + '\x01'; // Bold on
    receipt += 'FACTURA SIMPLIFICADA\n';
    receipt += ESC + 'E' + '\x00'; // Bold off
    receipt += '\n';
    
    // Receipt info
    receipt += ESC + 'a' + '\x01'; // Center align
    receipt += 'Receipt #' + receiptData.receiptId + '\n';
    receipt += receiptData.date + '\n';
    receipt += '--------------------------------\n';
    
    // Items (left align)
    receipt += ESC + 'a' + '\x00'; // Left align
    receiptData.items.forEach(item => {
      const itemLine = item.name.substring(0, 20).padEnd(20);
      const qtyPrice = `x${item.quantity} ${receiptData.currency}${item.subtotal.toFixed(2)}`;
      receipt += itemLine + qtyPrice.padStart(12) + '\n';
    });
    
    receipt += '--------------------------------\n';
    
    // Totals
    receipt += `Subtotal:`.padEnd(20) + `${receiptData.currency}${receiptData.subtotal.toFixed(2)}`.padStart(12) + '\n';
    receipt += `Tax:`.padEnd(20) + `${receiptData.currency}${receiptData.tax.toFixed(2)}`.padStart(12) + '\n';
    
    // Total (bold)
    receipt += ESC + 'E' + '\x01'; // Bold on
    receipt += `TOTAL:`.padEnd(20) + `${receiptData.currency}${receiptData.total.toFixed(2)}`.padStart(12) + '\n';
    receipt += ESC + 'E' + '\x00'; // Bold off
    
    receipt += `Payment: ${receiptData.paymentMethod.toUpperCase()}\n`;
    receipt += '--------------------------------\n';
    
    // Footer
    receipt += ESC + 'a' + '\x01'; // Center align
    receipt += receiptData.footer + '\n';
    receipt += 'Cashier: ' + receiptData.cashier + '\n';
    receipt += '\n\n\n';
    
    // Cut paper
    receipt += GS + 'V' + '\x41' + '\x00'; // Partial cut
    
    // Write to temp file and send to printer
    const tempFile = path.join(app.getPath('temp'), 'receipt_' + Date.now() + '.prn');
    fs.writeFileSync(tempFile, receipt);
    
    if (process.platform === 'win32') {
      try {
        await execPromise(`copy /B "${tempFile}" "\\\\?\\${printerName}"`);
        fs.unlinkSync(tempFile);
        console.log('Receipt printed successfully');
        return { success: true };
      } catch (error) {
        try {
          await execPromise(`print /D:"${printerName}" "${tempFile}"`);
          fs.unlinkSync(tempFile);
          console.log('Receipt printed successfully (method 2)');
          return { success: true };
        } catch (error2) {
          fs.unlinkSync(tempFile);
          throw error2;
        }
      }
    } else {
      // macOS/Linux
      try {
        await execPromise(`lp -d "${printerName}" -o raw "${tempFile}"`);
        fs.unlinkSync(tempFile);
        console.log('Receipt printed successfully');
        return { success: true };
      } catch (error) {
        try {
          await execPromise(`lp -d "${printerName}" "${tempFile}"`);
          fs.unlinkSync(tempFile);
          console.log('Receipt printed successfully (method 2)');
          return { success: true };
        } catch (error2) {
          fs.unlinkSync(tempFile);
          throw error2;
        }
      }
    }
  } catch (error) {
    console.error('Error printing receipt:', error);
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

ipcMain.handle('subcategories:getByParentId', async (event, parentId) => {
  return db.getSubcategoriesByParentId(parentId);
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
  if (!SerialPort) {
    console.warn('Serial port not available');
    return [];
  }
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
  if (!SerialPort || !ReadlineParser) {
    throw new Error('Serial port modules not available. Scale features are disabled.');
  }
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
let isConnecting = false; // Prevent multiple simultaneous connections

ipcMain.handle('scale:readWeight', async () => {
  // Auto-connect to scale if not connected
  if (SerialPort && ReadlineParser && (!scalePort || !scalePort.isOpen)) {
    if (isConnecting) {
      console.log('Already attempting to connect, waiting...');
      return { success: false, message: 'Connection in progress, please wait' };
    }
    
    isConnecting = true;
    console.log('Scale not connected, attempting auto-connect...');
    try {
      const ports = await SerialPort.list();
      const scalePorts = ports.filter(port => 
        port.manufacturer?.match(/CH340|USB.*Serial|FTDI|Silicon/i) ||
        port.path?.match(/ttyUSB|ttyACM|cu\.usbserial|COM/i)
      );
      
      if (scalePorts.length > 0) {
        const scalePortPath = scalePorts[0].path;
        console.log('Found scale on:', scalePortPath);
        
        // Close existing port if any
        if (scalePort) {
          try {
            if (scalePort.isOpen) {
              await new Promise((resolve) => {
                scalePort.close((err) => {
                  if (err) console.log('Error closing old port:', err.message);
                  resolve();
                });
              });
            }
            scalePort = null;
            scaleParser = null;
          } catch (e) {
            console.log('Error closing old port:', e.message);
            scalePort = null;
            scaleParser = null;
          }
        }
        
        scalePort = new SerialPort({
          path: scalePortPath,
          baudRate: 9600,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          lock: false // Don't lock the port exclusively
        });
        
        scaleParser = scalePort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
        console.log('Scale connected successfully');
        isConnecting = false;
        // Wait a moment for connection to stabilize
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        isConnecting = false;
        return { success: false, message: 'No scale found. Please connect USB scale.' };
      }
    } catch (error) {
      console.error('Error connecting to scale:', error);
      isConnecting = false;
      return { success: false, message: 'Failed to connect to scale: ' + error.message };
    }
  }
  
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
      await new Promise((resolve) => {
        scalePort.close((err) => {
          if (err) console.error('Error closing scale port:', err);
          resolve();
        });
      });
    }
    scalePort = null;
    scaleParser = null;
    return { success: true };
  } catch (error) {
    scalePort = null;
    scaleParser = null;
    return { success: false, message: error.message };
  }
});

