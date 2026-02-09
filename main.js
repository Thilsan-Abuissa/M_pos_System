const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const Database = require('./database');

// Try to load serialport modules, but don't crash if they fail
let SerialPort = null;
let ReadlineParser = null;
let serialPortLoadError = null;
let readlineParserLoadError = null;
try {
  SerialPort = require('serialport').SerialPort;
  console.log('SerialPort loaded successfully');
} catch (error) {
  SerialPort = null;
  serialPortLoadError = error;
  console.warn('SerialPort not available. Scale features will be disabled.', error.message);
}

// Readline parser is optional; we do raw byte reads primarily.
try {
  ReadlineParser = require('@serialport/parser-readline').ReadlineParser;
  console.log('ReadlineParser loaded successfully');
} catch (error) {
  ReadlineParser = null;
  readlineParserLoadError = error;
  console.warn('ReadlineParser not available. Continuing with raw serial reads only.', error.message);
}

let mainWindow;
let customerDisplayWindow;
let db;
let scalePort = null;
let scaleParser = null;

// Track scale state for streaming (some scales output continuously)
let scaleState = {
  portPath: null,
  config: null,
  lastWeightKg: null,
  lastRawText: '',
  lastUpdatedAt: 0,
  lastError: null
};

function truncateForUi(text, maxLen) {
  const s = (text || '').toString();
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWindowsComPath(portPath) {
  const p = (portPath || '').toString();
  if (/^\\\\\.\\COM\d+$/i.test(p)) return p;
  if (/^COM\d+$/i.test(p)) return `\\\\.\\${p}`;
  return p;
}

async function kickScalePort(port) {
  if (!port || typeof port.set !== 'function') return;
  // Some RS232 devices start sending only after a DTR/RTS transition.
  const attempts = [
    { dtr: false, rts: false },
    { dtr: true, rts: true },
    { dtr: true, rts: false },
    { dtr: false, rts: true }
  ];
  for (const state of attempts) {
    try {
      await new Promise((resolve) => port.set(state, () => resolve()));
      await sleep(30);
    } catch {
      // ignore
    }
  }

  // Best-effort flush to drop stale buffered bytes
  try {
    if (typeof port.flush === 'function') {
      await new Promise((resolve) => port.flush(() => resolve()));
    }
  } catch {
    // ignore
  }
}

function attachScaleStreaming(port) {
  if (!port) return;
  if (port.__scaleStreamingAttached) return;
  port.__scaleStreamingAttached = true;

  port.on('data', (data) => {
    try {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      const text = buf.toString('utf8');
      // Keep a rolling window of recent raw text
      const combined = (scaleState.lastRawText || '') + text;
      scaleState.lastRawText = combined.slice(-800);
      scaleState.lastUpdatedAt = Date.now();

      const weight = parseWeightFromScalePayload(scaleState.lastRawText);
      if (typeof weight === 'number') {
        scaleState.lastWeightKg = weight;
      }
    } catch {
      // ignore
    }
  });

  port.on('error', (err) => {
    scaleState.lastError = err ? String(err.message || err) : 'Unknown scale error';
  });

  port.on('close', () => {
    // Keep last known values, but mark as disconnected
    if (scalePort === port) {
      scalePort = null;
      scaleParser = null;
    }
  });
}

function parseWeightFromScalePayload(payload) {
  try {
    const textRaw = Buffer.isBuffer(payload) ? payload.toString('latin1') : String(payload || '');

    // Remove control characters (STX/ETX/etc) but keep printable text
    const text = textRaw.replace(/[\x00-\x1F\x7F]/g, '');

    // Prefer the number that is directly paired with a unit.
    // Some scales include other numeric fields; picking the unit-paired number avoids
    // occasional spikes like "10000" / "20000" from unrelated tokens.
    let rawToken = null;
    let unit = null;

    const parseNumericToken = (token) => {
      if (!token) return null;
      let normalized = String(token);
      if (/^\d{1,3}(,\d{3})+(?:\.\d+)?$/.test(normalized)) {
        normalized = normalized.replace(/,/g, '');
      } else {
        normalized = normalized.replace(',', '.');
      }
      const v = Math.abs(parseFloat(normalized));
      return Number.isFinite(v) ? v : null;
    };

    const kgMatches = Array.from(text.matchAll(/([+-]?\d+(?:[\.,]\d+)?)\s*kg\b/gi));
    if (kgMatches.length > 0) {
      // Prefer the smallest *non-zero* kg token if present; otherwise 0; otherwise last.
      let bestNonZero = null;
      let bestNonZeroToken = null;
      let sawZero = false;
      for (const m of kgMatches) {
        const v = parseNumericToken(m[1]);
        if (v === null) continue;
        if (v === 0) {
          sawZero = true;
          continue;
        }
        if (bestNonZero === null || v < bestNonZero) {
          bestNonZero = v;
          bestNonZeroToken = m[1];
        }
      }
      rawToken = bestNonZeroToken || (sawZero ? '0' : kgMatches[kgMatches.length - 1][1]);
      unit = 'kg';
    } else {
      const gMatches = Array.from(text.matchAll(/([+-]?\d+(?:[\.,]\d+)?)\s*g\b/gi));
      if (gMatches.length > 0) {
        // Prefer smallest *non-zero* (in kg terms) g token if present; otherwise 0; otherwise last.
        let bestNonZeroKg = null;
        let bestNonZeroToken = null;
        let sawZero = false;
        for (const m of gMatches) {
          const vG = parseNumericToken(m[1]);
          if (vG === null) continue;
          if (vG === 0) {
            sawZero = true;
            continue;
          }
          const vKg = vG / 1000;
          if (bestNonZeroKg === null || vKg < bestNonZeroKg) {
            bestNonZeroKg = vKg;
            bestNonZeroToken = m[1];
          }
        }
        rawToken = bestNonZeroToken || (sawZero ? '0' : gMatches[gMatches.length - 1][1]);
        unit = 'g';
      }
    }

    if (!rawToken) {
      // Fallback: remove common prefixes/units/whitespace and take the LAST numeric value.
      // (Last tends to be the weight in many payloads.)
      const clean = text
        .replace(/ST,GS,/gi, '')
        .replace(/kg/gi, '')
        .replace(/g/gi, '')
        .replace(/\s+/g, '');

      const matches = Array.from(clean.matchAll(/([+-]?\d+(?:[\.,]\d+)?)/g));
      if (matches.length === 0) return null;
      rawToken = matches[matches.length - 1][1];
    }

    // Normalize number formats:
    // - If it looks like thousands separators (1,234 or 12,345,678) remove commas.
    // - Else treat comma as decimal separator.
    let normalized = rawToken;
    if (/^\d{1,3}(,\d{3})+(?:\.\d+)?$/.test(normalized)) {
      normalized = normalized.replace(/,/g, '');
    } else {
      normalized = normalized.replace(',', '.');
    }
    const rawValue = Math.abs(parseFloat(normalized));
    if (!Number.isFinite(rawValue)) return null;

    // Convert to kilograms when needed.
    // GRAM ZFOC commonly outputs in kg, but some outputs are grams (e.g. 500 => 500g).
    let weightKg = rawValue;
    if (unit === 'g') {
      weightKg = rawValue / 1000;
    } else if (unit !== 'kg') {
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
  if (!SerialPort) {
    throw new Error('SerialPort module not available');
  }

  const baudRate = options?.baudRate ?? 9600;
  const dataBits = options?.dataBits ?? 8;
  const stopBits = options?.stopBits ?? 1;
  const parity = options?.parity ?? 'none';
  const lock = options?.lock ?? false;

  // Some USB-RS232 bridges / scales require DTR/RTS asserted.
  const dtr = options?.dtr ?? true;
  const rts = options?.rts ?? true;

  const originalPath = (portPath || '').toString();
  const normalizedPath = normalizeWindowsComPath(originalPath);

  const portOpts = {
    baudRate,
    dataBits,
    stopBits,
    parity,
    lock,
    // Ensure we don't miss continuous streams due to buffering
    highWaterMark: 64 * 1024
  };

  let port;
  try {
    port = new SerialPort({ path: originalPath, ...portOpts });
  } catch (e) {
    // On Windows, some environments prefer \\.\COMx
    port = new SerialPort({ path: normalizedPath, ...portOpts });
  }

  // Keep a parser around for devices that do send newlines, but don't rely on it.
  const parser = ReadlineParser ? port.pipe(new ReadlineParser({ delimiter: '\n' })) : null;

  await new Promise((resolve, reject) => {
    if (port.isOpen) return resolve();
    port.once('open', resolve);
    port.once('error', reject);
  });

  // Best-effort modem control lines
  try {
    if (typeof port.set === 'function') {
      port.set({ dtr, rts }, () => {});
    }
  } catch {
    // ignore
  }

  await kickScalePort(port);

  // Attach streaming listener so we can capture continuous output
  attachScaleStreaming(port);

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
    const timers = [];
    let lastParsedWeight = null;
    let settleTimer = null;
    const settleMs = 80;

    // Drop any previously buffered bytes so we don't parse an old frame (common cause of UI "jump back").
    try {
      if (port && typeof port.flush === 'function') {
        port.flush(() => {});
      }
    } catch {
      // ignore
    }

    const clearAllTimers = () => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const finish = (result) => {
      if (done) return;
      done = true;
      clearAllTimers();
      try {
        port.removeListener('data', onData);
      } catch {
        // ignore
      }
      // Always attach a timestamp so the renderer can ignore stale/cached reads.
      const stamped = {
        ...(result || {}),
        lastUpdatedAt: typeof result?.lastUpdatedAt === 'number' ? result.lastUpdatedAt : Date.now(),
        source: result?.source || 'once'
      };
      resolve(stamped);
    };

    const onData = (data) => {
      chunks.push(data);
      const combined = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c)))));
      const raw = combined.toString('latin1');
      console.log('[Scale Debug] Received data:', raw.replace(/[\r\n\t\0]/g, ' ').substring(0, 100), `(${combined.length} bytes)`);
      const weight = parseWeightFromScalePayload(combined);
      if (weight === null) return;

      // Record the most recently parsed weight, and wait a tiny window for any newer frame.
      // This avoids "buffered" frames from reappearing after a change on the platform.
      lastParsedWeight = weight;

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (done) return;
        if (lastParsedWeight === 0) {
          finish({ success: true, weight: 0, isZero: true });
          return;
        }
        console.log('[Scale Debug] Parsed weight (settled):', lastParsedWeight, 'kg');
        finish({ success: true, weight: lastParsedWeight });
      }, settleMs);
    };

    port.on('data', onData);
    const timeout = setTimeout(() => {
      const raw = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c))))).toString('latin1');
      console.log('[Scale Debug] Timeout - Raw data received:', raw.replace(/[\r\n\t\0]/g, ' ').substring(0, 200));
      finish({
        success: false,
        message: 'Timeout reading from scale',
        rawSample: truncateForUi(raw.replace(/[\r\n\t\0]/g, ' '), 120),
        bytesReceived: chunks.reduce((acc, c) => acc + (Buffer.isBuffer(c) ? c.length : Buffer.byteLength(String(c))), 0)
      });
    }, timeoutMs);
    timers.push(timeout);

    // If the scale is streaming continuously, we may get data without commands.
    // After a very short delay, send a small set of common poll commands.
    // Goal: show weight with minimal latency (< 1s) without flooding the device.
    const safeWrite = (dataToWrite, name) => {
      if (done) return;
      try {
        port.write(dataToWrite);
        try {
          if (typeof port.drain === 'function') port.drain(() => {});
        } catch {
          // ignore
        }
        console.log(`[Scale Debug] Sent: ${name}`);
      } catch (e) {
        console.log(`[Scale Debug] Failed to send ${name}:`, e.message);
      }
    };

    const scheduleWriteIfSilent = (delayMs, dataToWrite, name) => {
      const t = setTimeout(() => {
        if (done) return;
        // If we already parsed a weight, don't send more poll commands (prevents backlog / old frames).
        if (lastParsedWeight !== null) return;
        safeWrite(dataToWrite, name);
      }, delayMs);
      timers.push(t);
    };

    scheduleWriteIfSilent(0, 'P\r\n', 'P\\r\\n');
    scheduleWriteIfSilent(60, Buffer.from([0x05]), 'ENQ (0x05)');
    scheduleWriteIfSilent(120, 'W\r\n', 'W\\r\\n');
    scheduleWriteIfSilent(180, 'S\r\n', 'S\\r\\n');
    scheduleWriteIfSilent(240, '\r\n', '\\r\\n only');
  });
}

function pickBestScalePort(ports) {
  const ranked = rankScalePorts(ports);
  return ranked.length > 0 ? ranked[0] : null;
}

function rankScalePorts(ports) {
  if (!Array.isArray(ports) || ports.length === 0) return [];

  const scored = ports
    .map((port) => {
      const manufacturer = (port.manufacturer || '').toString();
      const pnpId = (port.pnpId || '').toString();
      const pathVal = (port.path || '').toString();

      const pnpIdLower = pnpId.toLowerCase();
      const pathLower = pathVal.toLowerCase();

      let score = 0;

      // Strong signals for USB-serial adapters commonly used by scales
      if (/ch340|usb.*serial|ftdi|silicon|prolific|cp210/i.test(manufacturer)) score += 200;
      if (pnpIdLower.includes('usb')) score += 150;
      if (pnpIdLower.includes('vid_')) score += 50;
      if (port.vendorId || port.productId) score += 30;

      // ZFOC scales commonly use CH340 on COM3-COM10
      if (/ch340/i.test(manufacturer) && /^com[3-9]$|^com10$/i.test(pathVal)) score += 300;

      // Port name patterns
      if (/^com\d+$/i.test(pathVal)) score += 25;
      if (/ttyusb|ttyacm|cu\.usbserial|cu\.wchusbserial/i.test(pathLower)) score += 25;

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
        /CH340|USB.*Serial|FTDI|Silicon|Prolific|CP210/i.test(manufacturer) ||
        /USB/i.test(pnpId) ||
        /ttyUSB|ttyACM|cu\.usbserial|cu\.wchusbserial|^COM\d+$/i.test(pathVal)
      );
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.port);
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

  // If there is a second display, open the customer display there and fill it.
  const displays = screen?.getAllDisplays?.() || [];
  const targetDisplay = displays.length > 1 ? displays[1] : (screen?.getPrimaryDisplay?.() || null);
  const targetBounds = targetDisplay?.bounds;
  const initialWindowOpts = targetBounds
    ? {
        x: targetBounds.x,
        y: targetBounds.y,
        width: targetBounds.width,
        height: targetBounds.height
      }
    : {
        width: 800,
        height: 600,
        minWidth: 600,
        minHeight: 400
      };

  customerDisplayWindow = new BrowserWindow({
    ...initialWindowOpts,
    title: 'Customer Display',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#667eea'
  });

  customerDisplayWindow.loadFile('renderer/customer-display.html');
  customerDisplayWindow.setMenuBarVisibility(false);

  // Ensure it fills the chosen display.
  if (targetBounds) {
    customerDisplayWindow.setBounds(targetBounds);
    customerDisplayWindow.maximize();
  }

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
  // ReadlineParser is optional; we can read raw bytes.
  if (SerialPort) {
    setTimeout(async () => {
      try {
        const ports = await SerialPort.list();
        const bestPort = pickBestScalePort(ports);
        
        if (bestPort) {
          const scalePortPath = bestPort.path;
          console.log('Auto-connecting to scale on:', scalePortPath);

          const cfg = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', lock: false };
          const opened = await openScalePort(scalePortPath, cfg);
          scalePort = opened.port;
          scaleParser = opened.parser;
          scaleState.portPath = scalePortPath;
          scaleState.config = cfg;
          scaleState.lastError = null;
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

// Expense handlers
ipcMain.handle('expenses:create', async (event, expenseData) => {
  return db.createExpense(expenseData);
});

ipcMain.handle('expenses:getAll', async (event, startDate, endDate) => {
  return db.getExpenses(startDate, endDate);
});

ipcMain.handle('expenses:getById', async (event, id) => {
  return db.getExpenseById(id);
});

ipcMain.handle('expenses:update', async (event, id, expenseData) => {
  return db.updateExpense(id, expenseData);
});

ipcMain.handle('expenses:delete', async (event, id) => {
  return db.deleteExpense(id);
});

ipcMain.handle('expenses:getSummary', async (event, startDate, endDate) => {
  return db.getExpenseSummary(startDate, endDate);
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
    
    // Show payment and change for cash transactions
    if (receiptData.paymentMethod === 'cash' && receiptData.paymentAmount) {
      receipt += `Payment:`.padEnd(20) + `${receiptData.currency}${receiptData.paymentAmount.toFixed(2)}`.padStart(12) + '\n';
      receipt += ESC + 'E' + '\x01'; // Bold on
      receipt += `Change:`.padEnd(20) + `${receiptData.currency}${receiptData.changeAmount.toFixed(2)}`.padStart(12) + '\n';
      receipt += ESC + 'E' + '\x00'; // Bold off
    }
    
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

// Diagnostic: report whether SerialPort loaded and why not.
ipcMain.handle('scale:moduleStatus', async () => {
  return {
    serialportAvailable: !!SerialPort,
    serialportError: serialPortLoadError
      ? {
          message: String(serialPortLoadError.message || serialPortLoadError),
          stack: String(serialPortLoadError.stack || '')
        }
      : null,
    readlineParserAvailable: !!ReadlineParser,
    readlineParserError: readlineParserLoadError
      ? {
          message: String(readlineParserLoadError.message || readlineParserLoadError),
          stack: String(readlineParserLoadError.stack || '')
        }
      : null,
    platform: process.platform,
    arch: process.arch,
    versions: {
      node: process.versions?.node,
      electron: process.versions?.electron,
      chrome: process.versions?.chrome
    },
    isPackaged: !!app.isPackaged
  };
});

// Connect to scale
ipcMain.handle('scale:connect', async (event, portPath) => {
  if (!SerialPort) {
    throw new Error('SerialPort module not available. Scale features are disabled.');
  }
  try {
    if (scalePort && scalePort.isOpen) {
      scalePort.close();
    }

    const opened = await openScalePort(portPath, { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', lock: false });
    scalePort = opened.port;
    scaleParser = opened.parser;

    scaleState.portPath = portPath;
    scaleState.config = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' };
    scaleState.lastError = null;

    return { success: true, message: 'Scale connected successfully' };
  } catch (error) {
    console.error('Error connecting to scale:', error);
    return { success: false, message: error.message };
  }
});

// Read weight from scale
let isConnecting = false; // Prevent multiple simultaneous connections
let lastScaleAutoScanAt = 0;
let lastScaleAutoScanResult = null;

ipcMain.handle('scale:readWeight', async () => {
  // If we recently received streaming data, return immediately.
  if (scalePort && scalePort.isOpen && typeof scaleState.lastWeightKg === 'number') {
    const ageMs = Date.now() - (scaleState.lastUpdatedAt || 0);
    if (ageMs >= 0 && ageMs <= 1500) {
      return {
        success: true,
        weight: scaleState.lastWeightKg,
        isZero: scaleState.lastWeightKg === 0,
        portPath: scaleState.portPath,
        config: scaleState.config,
        lastUpdatedAt: scaleState.lastUpdatedAt || 0,
        ageMs,
        source: 'stream'
      };
    }
  }

  // Auto-connect to scale if not connected
  if (SerialPort && (!scalePort || !scalePort.isOpen)) {
    // Avoid hammering SerialPort.list() when the UI polls frequently.
    const now = Date.now();
    if (lastScaleAutoScanResult && now - lastScaleAutoScanAt < 1500) {
      return lastScaleAutoScanResult;
    }

    if (isConnecting) {
      console.log('Already attempting to connect, waiting...');
      return { success: false, message: 'Connection in progress, please wait' };
    }
    
    isConnecting = true;
    console.log('Scale not connected, attempting auto-connect...');
    try {
      const ports = await SerialPort.list();
      console.log('[Scale] All ports found:', ports.length);
      const rankedPorts = rankScalePorts(ports);
      const candidates = rankedPorts.length > 0 ? rankedPorts : [];
      
      // Build detailed port info for diagnostics
      const allPortsInfo = ports.map(p => `${p.path} (${p.manufacturer || 'unknown'})`).join(', ');
      const candidatePortsInfo = candidates.map(p => `${p.path} (${p.manufacturer || 'unknown'})`).join(', ');
      
      console.log('[Scale] All detected ports:', allPortsInfo);
      console.log('[Scale] Scale candidates:', candidatePortsInfo);
      
      if (candidates.length > 0) {
        console.log('Scale candidates:', candidates.map(p => p.path).join(', '));
        
        // Try common serial configurations used by RS232 scales.
        // Many GRAM/RS232 setups are 9600 8N1, but some are 4800/2400 or 7E1.
        const preferredCfg = scaleState?.config && typeof scaleState.config.baudRate === 'number'
          ? scaleState.config
          : null;

        // Keep this list short for speed; trying many baud/parity combos can add seconds.
        // If needed, we can add more later, but 9600 8N1 + a couple of common fallbacks covers most GRAM/ZFOC setups.
        const configsToTry = [
          ...(preferredCfg ? [preferredCfg] : []),
          { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
          { baudRate: 4800, dataBits: 8, stopBits: 1, parity: 'none' },
          { baudRate: 2400, dataBits: 8, stopBits: 1, parity: 'none' },
          { baudRate: 9600, dataBits: 7, stopBits: 1, parity: 'even' }
        ];
        let lastError = null;

        for (const candidatePort of candidates) {
          const scalePortPath = candidatePort.path;
          console.log('Trying scale port:', scalePortPath);

          // Close existing port if any (per attempt)
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
            } catch {
              // ignore
            }
            scalePort = null;
            scaleParser = null;
          }

          for (const cfg of configsToTry) {
            try {
              const opened = await openScalePort(scalePortPath, { ...cfg, lock: false });
              scalePort = opened.port;
              scaleParser = opened.parser;
              console.log('[Scale] Connected successfully using:', cfg, 'on', scalePortPath);

              scaleState.portPath = scalePortPath;
              scaleState.config = cfg;
              scaleState.lastError = null;

              // Quick probe read to validate we can parse data
              // Give a bit of time for streaming scales to send a frame.
              console.log('[Scale] Probing for weight data...');
              const probe = await readWeightFromOpenPortOnce(scalePort, 1200);
              if (probe && probe.success) {
                isConnecting = false;
                lastScaleAutoScanAt = Date.now();
                lastScaleAutoScanResult = { ...probe, portPath: scalePortPath, config: cfg, source: 'probe' };
                return lastScaleAutoScanResult;
              }

              // Some scales may be on but show 0; still treat as connected
              if (probe && probe.success && probe.isZero) {
                isConnecting = false;
                lastScaleAutoScanAt = Date.now();
                lastScaleAutoScanResult = { ...probe, portPath: scalePortPath, config: cfg, source: 'probe' };
                return lastScaleAutoScanResult;
              }

              // If the port opens but the device is silent, keep the connection open.
              // This prevents repeated open/close loops and allows later reads to succeed.
              if (probe && probe.success === false && (probe.bytesReceived ?? 0) === 0) {
                isConnecting = false;
                lastScaleAutoScanAt = Date.now();
                lastScaleAutoScanResult = {
                  success: false,
                  connected: true,
                  message: 'Scale connected, but no data received yet. Place an item, or ensure the scale is in PC/RS232 output mode.',
                  portPath: scalePortPath,
                  config: cfg,
                  bytesReceived: probe.bytesReceived,
                  rawSample: probe.rawSample,
                  source: 'probe'
                };
                return lastScaleAutoScanResult;
              }

              // No usable data; close and try next config
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
        }

        isConnecting = false;
        lastScaleAutoScanAt = Date.now();
        const detailedMsg = `Failed to connect/read from scale. Tried ${candidates.length} port(s): ${candidatePortsInfo}` + (lastError ? `. Last error: ${lastError.message}` : '');
        lastScaleAutoScanResult = { 
          success: false, 
          message: detailedMsg,
          portsScanned: candidates.map(p => p.path),
          totalPorts: ports.length,
          diagnostics: `All ports: ${allPortsInfo}`
        };
        return lastScaleAutoScanResult;
      } else {
        isConnecting = false;
        lastScaleAutoScanAt = Date.now();
        const noPortsMsg = `No scale found. Total ports detected: ${ports.length}. ${ports.length > 0 ? `Ports found: ${allPortsInfo}` : 'No COM ports detected - check USB connection and driver installation.'}`;
        
        // Last resort: Try COM8 directly (common ZFOC scale port)
        if (ports.some(p => p.path === 'COM8' || p.path === '\\\\.\\COM8')) {
          console.log('[Scale] Last resort: Trying COM8 directly...');
          try {
            const opened = await openScalePort('COM8', { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', lock: false });
            scalePort = opened.port;
            scaleParser = opened.parser;
            scaleState.portPath = 'COM8';
            scaleState.config = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' };
            scaleState.lastError = null;
            
            // Try to read
            const probe = await readWeightFromOpenPortOnce(scalePort, 1200);
            if (probe && (probe.success || (probe.success && probe.isZero))) {
              isConnecting = false;
              lastScaleAutoScanAt = Date.now();
              lastScaleAutoScanResult = { ...probe, portPath: 'COM8', config: scaleState.config, source: 'com8-fallback' };
              return lastScaleAutoScanResult;
            }

            if (probe && probe.success === false && (probe.bytesReceived ?? 0) === 0) {
              isConnecting = false;
              lastScaleAutoScanAt = Date.now();
              lastScaleAutoScanResult = {
                success: false,
                connected: true,
                message: 'Scale connected on COM8, but no data received yet. Place an item, or enable PC/RS232 output mode on the scale.',
                portPath: 'COM8',
                config: scaleState.config,
                bytesReceived: probe.bytesReceived,
                rawSample: probe.rawSample,
                source: 'com8-fallback'
              };
              return lastScaleAutoScanResult;
            }
          } catch (com8Error) {
            console.log('[Scale] COM8 fallback failed:', com8Error.message);
          }
        }
        
        lastScaleAutoScanResult = { 
          success: false, 
          message: noPortsMsg,
          totalPorts: ports.length,
          allPorts: allPortsInfo
        };
        return lastScaleAutoScanResult;
      }
    } catch (error) {
      console.error('Error connecting to scale:', error);
      isConnecting = false;
      lastScaleAutoScanAt = Date.now();
      lastScaleAutoScanResult = { success: false, message: 'Failed to connect to scale: ' + error.message };
      return lastScaleAutoScanResult;
    }
  }

  if (!SerialPort) {
    return {
      success: false,
      message: 'Scale driver/module not loaded in this build (SerialPort missing).',
      serialportAvailable: false,
      serialportError: serialPortLoadError ? String(serialPortLoadError.message || serialPortLoadError) : null,
      arch: process.arch,
      platform: process.platform
    };
  }

  if (!scalePort || !scalePort.isOpen) {
    return { success: false, message: 'Scale not connected' };
  }

  // Read raw bytes directly; works even if the device doesn't send newlines.
  console.log('[Scale] Reading weight from', scaleState.portPath, 'using', scaleState.config);
  const result = await readWeightFromOpenPortOnce(scalePort, 1000); // Target: fast UI response (~1s)
  if (!result.success) {
    const details = [];
    if (scaleState.portPath) details.push(`Port: ${scaleState.portPath}`);
    if (scaleState.config && scaleState.config.baudRate) details.push(`Baud: ${scaleState.config.baudRate}`);
    if (result.rawSample) details.push(`Raw: ${result.rawSample}`);
    const suffix = details.length ? ` (${details.join(' | ')})` : '';
    return { ...result, message: (result.message || 'Failed to read from scale') + suffix, portPath: scaleState.portPath, config: scaleState.config };
  }
  return { ...result, portPath: scaleState.portPath, config: scaleState.config, source: 'read' };
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
    scaleState.portPath = null;
    scaleState.config = null;
    scaleState.lastWeightKg = null;
    scaleState.lastRawText = '';
    scaleState.lastUpdatedAt = 0;
    scaleState.lastError = null;
    return { success: true };
  } catch (error) {
    scalePort = null;
    scaleParser = null;
    scaleState.portPath = null;
    scaleState.config = null;
    return { success: false, message: error.message };
  }
});

