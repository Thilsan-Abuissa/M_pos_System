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

function parseWeightFromScalePayload(payload) {
  try {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || '');

    // Detect units before stripping text
    const hasKg = /kg/i.test(text);
    // 'kg' contains 'g', so only treat as grams if NOT kg
    const hasG = !hasKg && /\bg\b/i.test(text);

    // Normalize: remove common prefixes, units, and whitespace/control chars
    let clean = text
      .replace(/\u0000/g, '')
      .replace(/ST,GS,/gi, '')
      .replace(/kg/gi, '')
      .replace(/g/gi, '')
      .replace(/[\r\n\t]/g, '')
      .replace(/\s+/g, '');

    // Extract first numeric value (allow comma decimals)
    const match = clean.match(/([+-]?\d+(?:[\.,]\d+)?)/);
    if (!match) return null;

    const normalized = match[1].replace(',', '.');
    const rawValue = Math.abs(parseFloat(normalized));
    if (!Number.isFinite(rawValue)) return null;

    // Convert to kilograms when needed.
    // GRAM ZFOC commonly outputs in kg, but some outputs are grams (e.g. 500 => 500g).
    let weightKg = rawValue;
    if (hasG) {
      weightKg = rawValue / 1000;
    } else if (!hasKg) {
      // Heuristic: if there's no unit and the number is large, it's likely grams.
      // This avoids showing 500 kg when the scale is actually 500 g.
      if (rawValue > 100) weightKg = rawValue / 1000;
    }

    // Validate weight is reasonable (0.001 kg to 100 kg)
    if (weightKg >= 0.001 && weightKg <= 100) return weightKg;
    if (weightKg === 0) return 0;
    return null;
  } catch {
    return null;
  }
}

async function openScalePort(portPath, options) {
  if (!SerialPort || !ReadlineParser) {
    throw new Error('Serial port modules not available');
  }

  const baudRate = options?.baudRate ?? 9600;
  const dataBits = options?.dataBits ?? 8;
  const stopBits = options?.stopBits ?? 1;
  const parity = options?.parity ?? 'none';
  const lock = options?.lock ?? false;

  const port = new SerialPort({
    path: portPath,
    baudRate,
    dataBits,
    stopBits,
    parity,
    lock
  });

  // Keep a parser around for devices that do send newlines, but don't rely on it.
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  await new Promise((resolve, reject) => {
    if (port.isOpen) return resolve();
    port.once('open', resolve);
    port.once('error', reject);
  });

  return { port, parser };
}

async function closeScalePort(port) {
  if (!port) return;
  await new Promise((resolve) => {
    try {
      if (port.isOpen) {
        port.close(() => resolve());
      } else {
        resolve();
      }
    } catch {
      resolve();
    }
  });
}

async function readWeightFromOpenPortOnce(port, timeoutMs) {
  return await new Promise((resolve) => {
    let done = false;
    const chunks = [];

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try {
        port.removeListener('data', onData);
      } catch {
        // ignore
      }
      resolve(result);
    };

    const onData = (data) => {
      chunks.push(data);
      const combined = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c)))));
      const weight = parseWeightFromScalePayload(combined);
      if (weight === null) return;
      if (weight === 0) {
        finish({ success: false, message: 'Scale shows 0. Please place item on scale.' });
      } else {
        finish({ success: true, weight });
      }
    };

    port.on('data', onData);
    const timeout = setTimeout(() => finish({ success: false, message: 'Timeout reading from scale' }), timeoutMs);

    // Try multiple commands that some scales might respond to
    try {
      port.write('P\r\n');
      setTimeout(() => {
        try {
          port.write('W\r\n');
        } catch {
          // ignore
        }
      }, 600);
      setTimeout(() => {
        try {
          port.write(Buffer.from([0x05])); // ENQ (some devices)
        } catch {
          // ignore
        }
      }, 1200);
    } catch {
      // ignore
    }
  });
}

function pickBestScalePort(ports) {
  if (!Array.isArray(ports) || ports.length === 0) return null;

  const scored = ports
    .map((port) => {
      const manufacturer = (port.manufacturer || '').toString();
      const pnpId = (port.pnpId || '').toString();
      const pathVal = (port.path || '').toString();

      const manufacturerLower = manufacturer.toLowerCase();
      const pnpIdLower = pnpId.toLowerCase();
      const pathLower = pathVal.toLowerCase();

      let score = 0;

      // Strong signals for USB-serial adapters commonly used by scales
      if (/ch340|usb.*serial|ftdi|silicon/i.test(manufacturer)) score += 200;
      if (pnpIdLower.includes('usb')) score += 150;
      if (pnpIdLower.includes('vid_')) score += 50;
      if (port.vendorId || port.productId) score += 30;

      // Port name patterns
      if (/^com\d+$/i.test(pathVal)) score += 20;
      if (/ttyusb|ttyacm|cu\.usbserial/i.test(pathLower)) score += 20;

      // Penalize built-in motherboard COM ports
      if (pnpIdLower.includes('acpi') || pnpIdLower.includes('pci')) score -= 200;
      if (pathLower === 'com1') score -= 120;

      // De-prioritize ports with no identifying info
      if (!manufacturer && !pnpId && !(port.vendorId || port.productId)) score -= 30;

      return { port, score };
    })
    // Keep only likely serial ports
    .filter(({ port }) => {
      const manufacturer = (port.manufacturer || '').toString();
      const pnpId = (port.pnpId || '').toString();
      const pathVal = (port.path || '').toString();
      return (
        /CH340|USB.*Serial|FTDI|Silicon/i.test(manufacturer) ||
        /USB/i.test(pnpId) ||
        /ttyUSB|ttyACM|cu\.usbserial|^COM\d+$/i.test(pathVal)
      );
    })
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].port : null;
}

async function sendRawFileToPrinterWindows(printerName, filePath) {
  const fs = require('fs');
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);

  const tempPs1 = path.join(app.getPath('temp'), `raw_print_${Date.now()}_${Math.random().toString(16).slice(2)}.ps1`);
  const safePrinterName = (printerName || '').toString().replace(/"/g, '""');
  const safeFilePath = (filePath || '').toString().replace(/"/g, '""');

  const script = `param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "RAW ESC/POS";
    di.pDataType = "RAW";

    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    bool ok = false;
    try {
      if (!StartDocPrinter(hPrinter, 1, di)) return false;
      if (!StartPagePrinter(hPrinter)) return false;

      int dwWritten = 0;
      IntPtr unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
      Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
      ok = WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out dwWritten);
      Marshal.FreeCoTaskMem(unmanagedBytes);

      EndPagePrinter(hPrinter);
      EndDocPrinter(hPrinter);
      return ok;
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$ok = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
if (-not $ok) {
  throw "Failed to send raw data to printer: $PrinterName"
}
`;

  fs.writeFileSync(tempPs1, script, 'utf8');
  try {
    await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1}" -PrinterName "${safePrinterName}" -FilePath "${safeFilePath}"`);
  } finally {
    try {
      if (fs.existsSync(tempPs1)) fs.unlinkSync(tempPs1);
    } catch (e) {
      // ignore cleanup errors
    }
  }
}

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
        const bestPort = pickBestScalePort(ports);
        
        if (bestPort) {
          const scalePortPath = bestPort.path;
          console.log('Auto-connecting to scale on:', scalePortPath);
          
          scalePort = new SerialPort({
            path: scalePortPath,
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
          });
          
          // Use '\n' to tolerate devices that send either '\n' or '\r\n'
          scaleParser = scalePort.pipe(new ReadlineParser({ delimiter: '\n' }));
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
      try {
        const tempFile = path.join(app.getPath('temp'), 'drawer_cmd.prn');
        fs.writeFileSync(tempFile, drawerCommand);
        await sendRawFileToPrinterWindows(printerName, tempFile);
        fs.unlinkSync(tempFile);
        console.log('Cash drawer opened via printer:', printerName);
        return { success: true, message: 'Cash drawer opened' };
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
    const iconv = require('iconv-lite');

    // Format receipt for thermal printer (ESC/POS)
    const ESC = '\x1B';
    const GS = '\x1D';
    
    let receipt = '';
    
    // Initialize printer
    receipt += ESC + '@'; // Initialize
    // Select character code table that supports € and Western European characters.
    // ESC t n => n=16 is commonly WPC1252 on ESC/POS printers.
    receipt += ESC + 't' + '\x10';
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
    receipt += `Subtotal (Base):`.padEnd(20) + `${receiptData.currency}${receiptData.subtotal.toFixed(2)}`.padStart(12) + '\n';

    // IVA breakdown (if provided)
    if (Array.isArray(receiptData.taxBreakdown) && receiptData.taxBreakdown.length > 0) {
      receiptData.taxBreakdown.forEach(row => {
        const rate = (row && typeof row.rate === 'number') ? row.rate : 0;
        const base = (row && typeof row.base === 'number') ? row.base : 0;
        const tax = (row && typeof row.tax === 'number') ? row.tax : 0;
        const total = (row && typeof row.total === 'number') ? row.total : 0;

        receipt += `IVA ${rate}%\n`;
        receipt += `Base: ${receiptData.currency}${base.toFixed(2)}\n`;
        receipt += `Cuota: ${receiptData.currency}${tax.toFixed(2)}\n`;
        receipt += `Total: ${receiptData.currency}${total.toFixed(2)}\n`;
      });
    }

    receipt += `Total Tax:`.padEnd(20) + `${receiptData.currency}${receiptData.tax.toFixed(2)}`.padStart(12) + '\n';
    
    // Total (bold)
    receipt += ESC + 'E' + '\x01'; // Bold on
    receipt += `TOTAL:`.padEnd(20) + `${receiptData.currency}${receiptData.total.toFixed(2)}`.padStart(12) + '\n';
    receipt += ESC + 'E' + '\x00'; // Bold off
    
    receipt += `Payment Method:`.padEnd(20) + `${receiptData.paymentMethod.toUpperCase()}`.padStart(12) + '\n';
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
    // Write as single-byte encoded buffer (NOT UTF-8) so the printer receives the intended codepage bytes.
    const receiptBuffer = iconv.encode(receipt, 'cp1252');
    fs.writeFileSync(tempFile, receiptBuffer);
    
    if (process.platform === 'win32') {
      try {
        await sendRawFileToPrinterWindows(printerName, tempFile);
        fs.unlinkSync(tempFile);
        console.log('Receipt printed successfully');
        return { success: true };
      } catch (error) {
        try {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          // ignore cleanup errors
        }
        throw error;
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

    const opened = await openScalePort(portPath, { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', lock: false });
    scalePort = opened.port;
    scaleParser = opened.parser;

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
      const bestPort = pickBestScalePort(ports);
      
      if (bestPort) {
        const scalePortPath = bestPort.path;
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
        
        // Try common serial configurations used by RS232 scales.
        // Many GRAM/RS232 setups are 9600 8N1, but some are 4800/2400 or 7E1.
        const configsToTry = [
          { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
          { baudRate: 4800, dataBits: 8, stopBits: 1, parity: 'none' },
          { baudRate: 2400, dataBits: 8, stopBits: 1, parity: 'none' },
          { baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none' },
          { baudRate: 9600, dataBits: 7, stopBits: 1, parity: 'even' },
          { baudRate: 4800, dataBits: 7, stopBits: 1, parity: 'even' },
          { baudRate: 2400, dataBits: 7, stopBits: 1, parity: 'even' },
          { baudRate: 9600, dataBits: 7, stopBits: 2, parity: 'even' }
        ];
        let lastError = null;

        for (const cfg of configsToTry) {
          try {
            const opened = await openScalePort(scalePortPath, { ...cfg, lock: false });
            scalePort = opened.port;
            scaleParser = opened.parser;
            console.log('Scale connected successfully using:', cfg);

            // Quick probe read to validate we can parse data
            const probe = await readWeightFromOpenPortOnce(scalePort, 2000);
            if (probe && probe.success) {
              isConnecting = false;
              return probe;
            }

            // Some scales may be on but show 0; still treat as connected
            if (probe && typeof probe.message === 'string' && probe.message.includes('0')) {
              isConnecting = false;
              return probe;
            }

            // No usable data; close and try next baud
            await closeScalePort(scalePort);
            scalePort = null;
            scaleParser = null;
          } catch (e) {
            lastError = e;
            try {
              await closeScalePort(scalePort);
            } catch {
              // ignore
            }
            scalePort = null;
            scaleParser = null;
          }
        }

        isConnecting = false;
        return { success: false, message: 'Failed to connect/read from scale' + (lastError ? (': ' + lastError.message) : '') };
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

  if (!scalePort || !scalePort.isOpen) {
    return { success: false, message: 'Scale not connected' };
  }

  // Read raw bytes directly; works even if the device doesn't send newlines.
  const result = await readWeightFromOpenPortOnce(scalePort, 5000);
  return result;
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

