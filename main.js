const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('./database');
const CustomerDisplay = require('./customer-display');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const iconv = require('iconv-lite');

const execPromise = promisify(exec);

// Data folder: Electron names userData after package.json "name" ("supermarket-pos"), not
// build.productName. Keep "name" unchanged across renames, or every till opens an empty DB.

// Shared printer text encoding helper.
// Many ESC/POS printers in Spain expect CP858/CP850 variants for the Euro symbol.
const POS_PRINT_ENCODING = (() => {
  const enc = String(process.env.POS_PRINT_ENCODING || 'cp858').trim();
  return enc || 'cp858';
})();

// Some receipt printers stay in Chinese double-byte mode (they ignore FS .): every byte
// above 0x7F then swallows the next one, so lines merge and "für" prints a Chinese glyph.
// The "safe printing" setting sends only ASCII to such printers (and '€' as an image).
function isPrinterPlainText() {
  try {
    return Number(db?.getSystemSettings?.()?.printer_plain_text || 0) === 1;
  } catch {
    return false;
  }
}

// One ASCII character per input character, so layouts built before this keep their width.
// '€' is kept: encodePrinterText() draws it as a small image.
function toPlainPrinterText(text) {
  // The drawer kick (ESC p m t1 t2) carries a raw byte above 0x7F: keep it untouched.
  return String(text ?? '').split(/(\x1Bp[\s\S]{3})/).map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/ß/g, 's')
      .replace(/[¿]/g, '?')
      .replace(/[¡]/g, '!')
      .replace(/º/g, 'o')
      .replace(/ª/g, 'a')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x00-\x7F€]/g, '?');
  }).join('');
}

// '€' as a 12x24-dot bit image (ESC * 33), the size of one Font A character. Printed as
// an image it cannot be garbled by a printer stuck in Chinese mode, and keeps columns aligned.
const EURO_BITMAP_ROWS = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '.....######.',
  '....########',
  '...###....##',
  '..###.......',
  '..###.......',
  '########....',
  '########....',
  '..###.......',
  '########....',
  '########....',
  '..###.......',
  '..###.......',
  '...###....##',
  '....########',
  '.....######.',
  '............',
  '............',
  '............',
  '............'
];
const EURO_IMAGE_BYTES = (() => {
  const width = EURO_BITMAP_ROWS[0].length;
  const bytes = [0x1B, 0x2A, 33, width & 0xFF, width >> 8];
  for (let x = 0; x < width; x++) {
    for (let band = 0; band < 3; band++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (EURO_BITMAP_ROWS[band * 8 + bit][x] === '#') b |= 0x80 >> bit;
      }
      bytes.push(b);
    }
  }
  return Buffer.from(bytes);
})();

// Safe printing: plain text, with every '€' replaced by the euro image.
function encodePlainPrinterText(text, encode) {
  const parts = toPlainPrinterText(text).split('€');
  const chunks = [];
  parts.forEach((part, i) => {
    if (i > 0) chunks.push(EURO_IMAGE_BYTES);
    chunks.push(encode(part));
  });
  return Buffer.concat(chunks);
}

function safeEncode(text) {
  const encode = (t) => {
    try {
      return iconv.encode(String(t ?? ''), POS_PRINT_ENCODING);
    } catch {
      // Fallback to cp858 (Euro) if a custom encoding is invalid.
      return iconv.encode(String(t ?? ''), 'cp858');
    }
  };
  return isPrinterPlainText() ? encodePlainPrinterText(text, encode) : encode(text);
}

// Prevent multiple running instances (common cause of COM port "Access denied")
// If a second instance starts, it will steal focus and exit.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  try { app.quit(); } catch { /* ignore */ }
} else {
  app.on('second-instance', () => {
    try {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    } catch {
      // ignore
    }
  });
}

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

// Scale is enabled by default.
// Set `SCALE_ENABLED=0` to disable the scale module (barcode-only mode).
const SCALE_ENABLED = process.env.SCALE_ENABLED !== '0';

let mainWindow;
let customerDisplayWindow;
let db;
let scalePort = null;
let scaleParser = null;
let customerDisplay = null;

// Prevent overlapping drawer kicks (can race on Windows temp files / printer spooler)
let lastDrawerKickAt = 0;
const DRAWER_KICK_THROTTLE_MS = 250;

function makeTempName(prefix, ext = '') {
  const safePrefix = String(prefix || 'tmp').replace(/[^a-z0-9_-]/gi, '_');
  const safeExt = ext ? (ext.startsWith('.') ? ext : '.' + ext) : '';
  return `${safePrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`;
}

// Printer detection cache (used for drawer kicks and printing when printer_name is not configured)
let cachedAutoPrinterName = null;
let cachedAutoPrinterAt = 0;
const AUTO_PRINTER_TTL_MS = 10 * 60 * 1000;

function pickLikelyThermalPrinter(printers) {
  const list = (Array.isArray(printers) ? printers : []).map(p => String(p || '').trim()).filter(Boolean);
  return list.find(p => /JP-?80|TM|Epson|iggual|thermal|POS|receipt|80/i.test(p)) || list[0] || null;
}

async function autoDetectPrinterName() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execPromise('powershell -command "Get-Printer | Select-Object Name | ForEach-Object { $_.Name }"');
      const printers = stdout.split(/\r?\n/).map(p => p.trim()).filter(p => p && !p.includes('----'));
      return pickLikelyThermalPrinter(printers);
    }

    // macOS/Linux
    const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
    const printers = stdout.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    return pickLikelyThermalPrinter(printers);
  } catch (error) {
    console.error('Error auto-detecting printer:', error);
    return null;
  }
}

async function getPrinterNameFast() {
  try {
    const settings = db?.getSystemSettings?.();
    const configured = String(settings?.printer_name || '').trim();
    if (configured) return configured;

    const now = Date.now();
    if (cachedAutoPrinterName && (now - cachedAutoPrinterAt) < AUTO_PRINTER_TTL_MS) {
      return cachedAutoPrinterName;
    }

    const detected = await autoDetectPrinterName();
    if (detected) {
      cachedAutoPrinterName = detected;
      cachedAutoPrinterAt = now;
    }
    return detected;
  } catch {
    return null;
  }
}

function cupsSendBufferToPrinter(printerName, buffer, { raw = true } = {}) {
  return new Promise((resolve, reject) => {
    const args = raw ? ['-d', String(printerName), '-o', 'raw'] : ['-d', String(printerName)];
    const child = spawn('lp', args, { stdio: ['pipe', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error((stderr || `lp exited with code ${code}`).trim()));
    });

    try {
      child.stdin.write(buffer);
      child.stdin.end();
    } catch (e) {
      reject(e);
    }
  });
}

function isTruthyEnv(value) {
  const v = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function getCustomerDisplayMode() {
  // Modes:
  // - vfd: serial VFD/pole display only (default)
  // - monitor: modern HDMI/USB monitor customer display only
  // - both: send to both
  // - off: disable all customer display output
  const raw = String(process.env.CUSTOMER_DISPLAY_MODE || '').trim().toLowerCase();
  if (!raw) return 'vfd';
  if (['vfd', 'serial', 'hardware'].includes(raw)) return 'vfd';
  if (['monitor', 'screen', 'window'].includes(raw)) return 'monitor';
  if (['both', 'all'].includes(raw)) return 'both';
  if (['off', 'none', 'disable', 'disabled'].includes(raw)) return 'off';
  return 'vfd';
}

function isVfdCustomerDisplayEnabled() {
  const mode = getCustomerDisplayMode();
  return mode === 'vfd' || mode === 'both';
}

function isMonitorCustomerDisplayEnabled() {
  const mode = getCustomerDisplayMode();
  return mode === 'monitor' || mode === 'both';
}

function pickCustomerDisplayTargetDisplay() {
  const displays = screen?.getAllDisplays?.() || [];
  const primary = screen?.getPrimaryDisplay?.() || null;

  if (isTruthyEnv(process.env.CUSTOMER_DISPLAY_FORCE_PRIMARY)) {
    return primary;
  }

  const rawIndex = process.env.CUSTOMER_DISPLAY_SCREEN_INDEX;
  if (rawIndex !== undefined && rawIndex !== null && String(rawIndex).trim() !== '') {
    const parsed = parseInt(String(rawIndex), 10);
    if (Number.isFinite(parsed) && displays.length > 0) {
      // Accept either 0-based or 1-based input.
      const idx = parsed >= 1 ? parsed - 1 : parsed;
      if (idx >= 0 && idx < displays.length) return displays[idx];
    }
  }

  // Default: pick the first non-primary display if available, else primary.
  const external = primary ? displays.find(d => d.id !== primary.id) : null;
  return external || primary || (displays[0] || null);
}

// ==================== Activation (offline, first-run) ====================
// NOTE: This is a "master key" approach (same key can activate multiple PCs)
// because the user requested it. For 1-key-per-PC licensing, bind to a machine id.
const MASTER_ACTIVATION_KEY = (process.env.POS_ACTIVATION_KEY || 'TS POS').toString();

function normalizeActivationKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function getActivationFilePath() {
  return path.join(app.getPath('userData'), 'activation.json');
}

function readActivationState() {
  try {
    const p = getActivationFilePath();
    if (!fs.existsSync(p)) return { activated: false };
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      activated: !!parsed?.activated,
      activatedAt: parsed?.activatedAt || null
    };
  } catch {
    return { activated: false };
  }
}

function writeActivationState(key) {
  const p = getActivationFilePath();
  const keyHash = crypto.createHash('sha256').update(String(key)).digest('hex');
  const payload = {
    activated: true,
    activatedAt: new Date().toISOString(),
    keyHash
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
}

function getDatabasePath() {
  // Keep in sync with database.js
  return path.join(app.getPath('userData'), 'pos_database.db');
}

// Basic app info
ipcMain.handle('app:getVersion', async () => {
  try {
    return app.getVersion();
  } catch {
    return null;
  }
});

ipcMain.handle('activation:getStatus', async () => {
  return readActivationState();
});

ipcMain.handle('activation:activate', async (event, key) => {
  try {
    const inputRaw = (key || '').toString();
    const input = normalizeActivationKey(inputRaw);
    if (!input) {
      return { success: false, error: 'Activation key is required' };
    }

    const master = normalizeActivationKey(MASTER_ACTIVATION_KEY);
    if (input !== master) {
      return { success: false, error: 'Invalid activation key' };
    }

    writeActivationState(inputRaw);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Customer display init/reconnect throttling to avoid constant port scans
let customerDisplayLastInitAttemptAt = 0;
const CUSTOMER_DISPLAY_INIT_COOLDOWN_MS = 500; // 0.5s — fast reconnect if port closes unexpectedly

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

// Overwrites <userData>/scale-debug.txt (at most every 2s) with the latest raw bytes from
// the scale, so an unknown scale format can be diagnosed from the shop PC.
let lastScaleDebugWriteAt = 0;
function writeScaleDebugSnapshot(rawText, weight) {
  const now = Date.now();
  if (now - lastScaleDebugWriteAt < 2000) return;
  lastScaleDebugWriteAt = now;
  try {
    const visible = String(rawText || '').slice(-300).replace(/[\x00-\x1F\x7F]/g, (c) => `<${c.charCodeAt(0).toString(16).padStart(2, '0')}>`);
    const lines = [
      `time: ${new Date(now).toISOString()}`,
      `port: ${scaleState.portPath || '-'}  config: ${JSON.stringify(scaleState.config || {})}`,
      `parsed weight (kg): ${weight === null || weight === undefined ? 'none' : weight}`,
      `raw (control bytes as <hex>):`,
      visible
    ];
    fs.writeFileSync(path.join(app.getPath('userData'), 'scale-debug.txt'), lines.join('\n') + '\n');
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
      const text = buf.toString('latin1');
      const combined = ((scaleState.lastRawText || '') + text).slice(-800);

      const { weight, rest, framed } = parseLatestScaleWeight(combined, { framed: scaleState.framed });
      // Drop consumed frames so old readings can never be picked up again.
      scaleState.lastRawText = rest;
      if (framed) scaleState.framed = true;
      writeScaleDebugSnapshot(combined, weight);
      if (typeof weight === 'number') {
        scaleState.lastWeightKg = weight;
        // Only fresh *parsed* weights count as an update; otherwise a stale weight
        // would keep being served as current.
        scaleState.lastUpdatedAt = Date.now();
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

// Scales stream one reading per frame (terminated by CR/LF or ETX). Parse only the
// newest complete frame: parsing a buffer with several frames mixes old readings in,
// which showed the previous weight at 0 and flickered between old and new weights.
// Returns { weight, rest } where `rest` is the unterminated tail to keep buffering.
function parseLatestScaleWeight(text, { framed = false } = {}) {
  const raw = String(text || '');
  const parts = raw.split(/[\r\n\x03]+/);
  const tail = parts.pop() || '';
  const frames = parts.filter((p) => p.trim());

  // 1) Terminated frames (CR/LF/ETX): newest frame wins. Look back a few frames only,
  //    for multi-line outputs whose last line has no weight.
  for (let i = frames.length - 1; i >= Math.max(0, frames.length - 3); i--) {
    const frame = frames[i];
    // A Dialog error frame (e.g. unstable) means "no valid weight now" — don't fall back to older frames.
    if (/(^|\x02)\s*09\x1B/.test(frame)) return { weight: null, rest: tail, framed: true };
    const weight = parseWeightFromScalePayload(frame);
    if (weight !== null) return { weight, rest: tail, framed: true };
  }
  // This scale ends its frames with CR/LF/ETX: an unterminated tail is a half-received
  // frame (e.g. "1.2" of "1.250kg"), so wait for the rest instead of parsing it.
  if (framed || frames.length > 0) return { weight: null, rest: tail, framed: true };

  // 2) No usable terminated frame: newest number+unit token (e.g. "  0.500kg" streams).
  const tokens = Array.from(raw.matchAll(/[+-]?\s*\d+(?:[\.,]\d+)?\s*k?g\b/gi));
  if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    const weight = parseWeightFromScalePayload(last[0]);
    if (weight !== null) return { weight, rest: raw.slice(last.index + last[0].length) };
  }

  // 3) STX-framed without terminators: newest complete segment between two STX bytes.
  const stxSegments = raw.split('\x02');
  if (stxSegments.length >= 3) {
    for (let i = stxSegments.length - 2; i >= 1; i--) {
      const weight = parseWeightFromScalePayload(stxSegments[i]);
      if (weight !== null) return { weight, rest: '\x02' + stxSegments[stxSegments.length - 1] };
    }
  }

  // 4) Anything else (unitless, unframed): same parsing as before on a short rolling window.
  return { weight: parseWeightFromScalePayload(raw), rest: raw.slice(-200), framed: false };
}

function parseWeightFromScalePayload(payload) {
  try {
    const textRaw = Buffer.isBuffer(payload) ? payload.toString('latin1') : String(payload || '');

    // Dialog 02/06 protocol (GRAM XFOC+ and other price-computing scales in POS mode).
    // Weight reply: STX "02" ESC <status> ESC <weight 5 digits, grams> ESC <unit price> ESC <total> ETX
    // Error reply:  STX "09" ESC <code> ETX (e.g. 30/31 = unstable / no valid weight)
    // These frames must be handled before control chars are stripped, otherwise the
    // ESC-separated fields merge into one bogus number.
    if (textRaw.includes('\x1B')) {
      const frames = Array.from(textRaw.matchAll(/\x02?\s*(0[29])\x1B([^\x03]*)/g));
      if (frames.length > 0) {
        const last = frames[frames.length - 1];
        if (last[1] === '09') return null;
        const fields = last[2].split('\x1B');
        const weightField = fields.find((f) => /^\d{5}$/.test(f.trim()));
        if (weightField) {
          const grams = parseInt(weightField.trim(), 10);
          if (grams === 0) return 0;
          const kg = grams / 1000;
          return kg >= 0.001 && kg <= 100 ? kg : null;
        }
        return null;
      }
    }

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
    // GRAM ZFOC/XFOC+ commonly output in kg, but some outputs are grams (e.g. 500 => 500g).
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

  // If the customer display is holding this port, the scale takes it back and the
  // display is barred from it (it was e.g. saved by mistake as the display port).
  try {
    const norm = (p) => String(p || '').replace(/^\\\\\.\\/, '').toLowerCase();
    if (customerDisplay?.port?.path && norm(customerDisplay.port.path) === norm(portPath)) {
      console.warn(`[Scale] ${portPath} is held by the customer display - releasing it for the scale`);
      excludePortFromCustomerDisplay(portPath);
      try { await customerDisplay.disconnect(); } catch { /* ignore */ }
    }
  } catch {
    // ignore
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

  scaleState.framed = false;
  scaleState.lastRawText = '';

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
    let lastSentPoll = null;
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
      const { weight } = parseLatestScaleWeight(raw, { framed: scaleState.framed });
      if (weight === null) return;
      if (lastSentPoll) scaleState.workingPoll = lastSentPoll;

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
        lastSentPoll = name;
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

    // GRAM scales (ZFOC/XFOC+) answer "$" with the weight, so try it first. Once a
    // command is known to work it is sent alone first, so polled scales update fast.
    const polls = [
      ['$', '$'],
      ['P\\r\\n', 'P\r\n'],
      ['ENQ (0x05)', Buffer.from([0x05])],
      ['W\\r\\n', 'W\r\n'],
      ['S\\r\\n', 'S\r\n'],
      ['\\r\\n only', '\r\n'],
      ['EOT ENQ (Dialog)', Buffer.from([0x04, 0x05])]
    ];
    const known = polls.find(([name]) => name === scaleState.workingPoll);
    const ordered = known ? [known, ...polls.filter((p) => p !== known)] : polls;
    ordered.forEach(([name, bytes], i) => {
      // Give the known-good command time to answer before trying the others.
      const delay = known ? (i === 0 ? 0 : 300 + (i - 1) * 80) : i * 80;
      scheduleWriteIfSilent(delay, bytes, name);
    });
  });
}

function pickBestScalePort(ports, options = {}) {
  const ranked = rankScalePorts(ports, options);
  return ranked.length > 0 ? ranked[0] : null;
}

function rankScalePorts(ports, options = {}) {
  if (!Array.isArray(ports) || ports.length === 0) return [];

  const excludePathsRaw = Array.isArray(options.excludePaths) ? options.excludePaths : [];
  const excludePaths = new Set(
    excludePathsRaw
      .filter(Boolean)
      .map((p) => String(p).toLowerCase())
  );

  const forcedPath = String(process.env.SCALE_PORT || '').trim().toLowerCase();

  const scored = ports
    .map((port) => {
      const manufacturer = (port.manufacturer || '').toString();
      const pnpId = (port.pnpId || '').toString();
      const pathVal = (port.path || '').toString();

      const pnpIdLower = pnpId.toLowerCase();
      const pathLower = pathVal.toLowerCase();

      let score = 0;

      // Explicit override (e.g. SCALE_PORT=COM5) always wins, even for Prolific adapters.
      if (forcedPath && (pathLower === forcedPath || pathLower === `\\\\.\\${forcedPath}`)) {
        score += 100000;
      }

      // Never choose an explicitly configured customer display port for the scale.
      if (excludePaths.size > 0 && excludePaths.has(pathLower)) {
        score -= 10000;
      }

      // Strong signals for USB-serial adapters commonly used by scales
      if (/ch340|usb.*serial|ftdi|silicon|cp210/i.test(manufacturer)) score += 200;

      // IMPORTANT: Prolific PL2303 is very commonly used by pole/customer displays.
      // Treat Prolific as "NOT a scale" to avoid grabbing the VFD port (COM12 in your case).
      if (/prolific/i.test(manufacturer) || String(port.productId || '').toLowerCase() === '2303') {
        score -= 1000;
      }
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
    .filter(({ port, score }) => {
      const manufacturer = (port.manufacturer || '').toString();
      const pnpId = (port.pnpId || '').toString();
      const pathVal = (port.path || '').toString();
      const pathLower = pathVal.toLowerCase();

      // Drop excluded paths completely.
      if (excludePaths.size > 0 && excludePaths.has(pathLower)) return false;

      // Drop very negative scores (e.g. Prolific / VFD ports).
      if (score >= 100000) return true;
      if (score <= -500) return false;
      return (
        /CH340|USB.*Serial|FTDI|Silicon|CP210/i.test(manufacturer) ||
        /USB/i.test(pnpId) ||
        /ttyUSB|ttyACM|cu\.usbserial|cu\.wchusbserial|^COM\d+$/i.test(pathVal)
      );
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.port);
}

// Some receipt printers (e.g. JP-80M over USB) show up as a CH340 virtual COM port.
// The scale and customer display auto-detection must never open that port, or the
// Windows spooler can no longer print to it.
let cachedPrinterComPorts = [];
let cachedPrinterComPortsAt = 0;
async function getPrinterComPorts() {
  if (process.platform !== 'win32') return [];
  if (Date.now() - cachedPrinterComPortsAt < 60 * 1000) return cachedPrinterComPorts;
  try {
    // Only the configured receipt printer: other (old/unused) printer entries on a COM
    // port must not block the scale from using that port.
    const printerName = String(db?.getSystemSettings?.()?.printer_name || '').trim();
    if (!printerName) {
      cachedPrinterComPorts = [];
      cachedPrinterComPortsAt = Date.now();
      return cachedPrinterComPorts;
    }
    const psName = printerName.replace(/'/g, "''").replace(/"/g, '\\"');
    const { stdout } = await execPromise(`powershell -NoProfile -Command "(Get-Printer -Name '${psName}').PortName"`);
    cachedPrinterComPorts = stdout
      .split(/\r?\n/)
      .map((p) => p.trim().replace(/:$/, ''))
      .filter((p) => /^COM\d+$/i.test(p));
  } catch {
    cachedPrinterComPorts = [];
  }
  cachedPrinterComPortsAt = Date.now();

  if (cachedPrinterComPorts.length > 0) {
    const existing = String(process.env.CUSTOMER_DISPLAY_EXCLUDE_PORTS || '')
      .split(/[;,\s]+/)
      .filter(Boolean);
    process.env.CUSTOMER_DISPLAY_EXCLUDE_PORTS = Array.from(new Set([...existing, ...cachedPrinterComPorts])).join(',');
  }
  return cachedPrinterComPorts;
}

function excludePortFromCustomerDisplay(portPath) {
  if (!portPath) return;
  const existing = String(process.env.CUSTOMER_DISPLAY_EXCLUDE_PORTS || '').split(/[;,\s]+/).filter(Boolean);
  process.env.CUSTOMER_DISPLAY_EXCLUDE_PORTS = Array.from(new Set([...existing, String(portPath)])).join(',');
}

async function getScaleExcludePorts(ports = []) {
  // Keep the scale off a configured customer display port, unless that port is a CH340
  // (wch.cn, 1A86:7523) — that is the scale's own USB-RS232 cable, so the scale wins.
  const displayPort = String(process.env.CUSTOMER_DISPLAY_PORT || '').trim();
  const displayInfo = ports.find((p) => String(p.path || '').toLowerCase() === displayPort.toLowerCase());
  const displayIsCh340 = displayInfo && (/ch340|wch/i.test(String(displayInfo.manufacturer || '')) || String(displayInfo.productId || '').toLowerCase() === '7523');
  const exclude = displayPort && !displayIsCh340 ? [displayPort] : [];
  // An explicit SCALE_PORT always wins over automatic exclusions.
  const forced = String(process.env.SCALE_PORT || '').trim().toLowerCase();
  return [...exclude, ...(await getPrinterComPorts())].filter((p) => String(p).toLowerCase() !== forced);
}

// The C# raw-print helper, shared by the persistent print worker and the one-shot fallback.
const RAW_PRINTER_ADD_TYPE = `Add-Type -TypeDefinition @"
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

  // Returns "" on success, otherwise a description of the failing step + Win32 error code.
  static string TrySend(string printerName, byte[] bytes, string dataType) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      return "OpenPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")";
    }
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "RAW ESC/POS";
      di.pDataType = dataType;
      if (!StartDocPrinter(hPrinter, 1, di)) {
        return "StartDocPrinter[" + (dataType ?? "default") + "] failed (Win32 error " + Marshal.GetLastWin32Error() + ")";
      }
      try {
        if (!StartPagePrinter(hPrinter)) {
          return "StartPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")";
        }
        int dwWritten = 0;
        IntPtr unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
          if (!WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out dwWritten)) {
            return "WritePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")";
          }
          if (dwWritten != bytes.Length) {
            return "WritePrinter wrote " + dwWritten + " of " + bytes.Length + " bytes";
          }
        } finally {
          Marshal.FreeCoTaskMem(unmanagedBytes);
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
      return "";
    } finally {
      ClosePrinter(hPrinter);
    }
  }

  // Some drivers (Windows v4 / XPS-based, common on generic POS80 drivers) reject the
  // "RAW" datatype, so fall back to XPS_PASS and the driver default.
  public static string SendBytesToPrinter(string printerName, byte[] bytes) {
    string[] dataTypes = new string[] { "RAW", "XPS_PASS", null };
    string errors = "";
    foreach (string dt in dataTypes) {
      string err = TrySend(printerName, bytes, dt);
      if (err == "") return "";
      errors += (errors == "" ? "" : "; ") + err;
      // Only a rejected datatype is worth retrying; anything later could print twice.
      if (!err.StartsWith("StartDocPrinter")) break;
    }
    return errors;
  }
}
"@
`;

// Persistent PowerShell print worker (Windows). Starting PowerShell and compiling the
// helper with Add-Type took 2-4 s per print; the worker does that once at startup and
// then prints each job in milliseconds. Jobs: one line "id<TAB>base64(printer)<TAB>base64(file)".
const PRINT_WORKER_SCRIPT = `$ErrorActionPreference = 'Stop'
${RAW_PRINTER_ADD_TYPE}
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split([char]9)
  if ($parts.Length -lt 3) { continue }
  $err = ''
  try {
    $printerName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
    $filePath = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[2]))
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $err = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
    if ($err) {
      try {
        $p = Get-Printer -Name $printerName -ErrorAction Stop
        $err += " [Status: $($p.PrinterStatus), Port: $($p.PortName), Driver: $($p.DriverName)]"
      } catch { }
    }
  } catch { $err = $_.Exception.Message }
  $err = ($err -replace '[\\r\\n\\t]', ' ')
  [Console]::Out.WriteLine("RESULT" + [char]9 + $parts[0] + [char]9 + $err)
  [Console]::Out.Flush()
}
`;

const PRINT_JOB_TIMEOUT_MS = 20000;
let printWorker = null;
let printJobSeq = 0;

function startPrintWorker() {
  if (process.platform !== 'win32') return null;
  if (printWorker && !printWorker.dead) return printWorker;

  const scriptPath = path.join(app.getPath('temp'), 'pos_print_worker.ps1');
  fs.writeFileSync(scriptPath, PRINT_WORKER_SCRIPT, 'utf8');
  const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const worker = { proc, ready: false, dead: false, pending: new Map(), buf: '', stderr: '' };
  printWorker = worker;

  const failAll = (reason) => {
    worker.dead = true;
    if (printWorker === worker) printWorker = null;
    for (const job of worker.pending.values()) {
      clearTimeout(job.timer);
      // Never got READY: nothing was sent to the printer, so the caller may safely retry another way.
      job.reject(Object.assign(new Error(reason), { workerNeverReady: !worker.ready }));
    }
    worker.pending.clear();
  };

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    worker.buf += chunk;
    let nl;
    while ((nl = worker.buf.indexOf('\n')) >= 0) {
      const line = worker.buf.slice(0, nl).replace(/\r$/, '');
      worker.buf = worker.buf.slice(nl + 1);
      if (line === 'READY') {
        worker.ready = true;
        continue;
      }
      const [tag, id, err] = line.split('\t');
      if (tag !== 'RESULT') continue;
      const job = worker.pending.get(id);
      if (!job) continue;
      worker.pending.delete(id);
      clearTimeout(job.timer);
      if (err && err.trim()) job.reject(new Error(`Failed to send raw data to printer '${job.printerName}': ${err.trim()}`));
      else job.resolve();
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => { worker.stderr = (worker.stderr + chunk).slice(-2000); });
  proc.on('error', (e) => failAll(`Print worker error: ${e.message}`));
  proc.on('exit', (code) => failAll(`Print worker exited (code ${code}) ${worker.stderr.trim()}`.trim()));
  proc.stdin.on('error', () => { /* handled by exit */ });
  return worker;
}

function stopPrintWorker() {
  const worker = printWorker;
  printWorker = null;
  if (!worker) return;
  try { worker.proc.stdin.end(); } catch { /* ignore */ }
  try { worker.proc.kill(); } catch { /* ignore */ }
}

function printViaWorker(printerName, filePath) {
  const worker = startPrintWorker();
  if (!worker) return Promise.reject(Object.assign(new Error('Print worker unavailable'), { workerNeverReady: true }));
  return new Promise((resolve, reject) => {
    const id = String(++printJobSeq);
    const b64 = (v) => Buffer.from(String(v || ''), 'utf8').toString('base64');
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      // A stuck worker would block every later print: restart it on the next job.
      stopPrintWorker();
      reject(new Error('Printer did not respond (timeout)'));
    }, PRINT_JOB_TIMEOUT_MS);
    worker.pending.set(id, { resolve, reject, timer, printerName });
    try {
      worker.proc.stdin.write(`${id}\t${b64(printerName)}\t${b64(filePath)}\n`);
    } catch (e) {
      worker.pending.delete(id);
      clearTimeout(timer);
      reject(Object.assign(e, { workerNeverReady: !worker.ready }));
    }
  });
}

async function sendRawFileToPrinterWindows(printerName, filePath) {
  // Names detected from PowerShell output can carry a trailing '\r'; Windows then fails
  // with error 1801 (invalid printer name).
  printerName = String(printerName || '').trim();
  try {
    return await printViaWorker(printerName, filePath);
  } catch (error) {
    if (!error?.workerNeverReady) throw error;
    console.warn('[Print] Worker unavailable, using one-shot PowerShell:', error.message);
    return await sendRawFileToPrinterWindowsOneShot(printerName, filePath);
  }
}

async function sendRawFileToPrinterWindowsOneShot(printerName, filePath) {
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

${RAW_PRINTER_ADD_TYPE}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$err = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
if ($err) {
  $status = ''
  try {
    $p = Get-Printer -Name $PrinterName -ErrorAction Stop
    $status = " [Status: $($p.PrinterStatus), Port: $($p.PortName), Driver: $($p.DriverName)]"
  } catch { }
  [Console]::Error.WriteLine("PRINT_ERROR: Failed to send raw data to printer '$PrinterName': $err$status")
  exit 1
}
`;

  fs.writeFileSync(tempPs1, script, 'utf8');
  try {
    await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1}" -PrinterName "${safePrinterName}" -FilePath "${safeFilePath}"`);
  } catch (error) {
    const out = `${error?.stderr || ''}\n${error?.stdout || ''}`;
    const match = out.match(/PRINT_ERROR:\s*(.+)/);
    if (match) throw new Error(match[1].trim());
    throw error;
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

  // Auto-open monitor-based customer display when enabled.
  // (Hardware VFD is controlled separately via CUSTOMER_DISPLAY_MODE.)
  try {
    if (isMonitorCustomerDisplayEnabled()) {
      setTimeout(() => {
        try { createCustomerDisplay(); } catch { /* ignore */ }
      }, 700);
    }
  } catch {
    // ignore
  }
}

function createCustomerDisplay() {
  if (customerDisplayWindow) {
    customerDisplayWindow.focus();
    return;
  }

  const targetDisplay = pickCustomerDisplayTargetDisplay();
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

  const kiosk = String(process.env.CUSTOMER_DISPLAY_KIOSK || '').trim() === ''
    ? true
    : isTruthyEnv(process.env.CUSTOMER_DISPLAY_KIOSK);

  const frame = isTruthyEnv(process.env.CUSTOMER_DISPLAY_FRAME);
  const alwaysOnTop = isTruthyEnv(process.env.CUSTOMER_DISPLAY_ALWAYS_ON_TOP);

  customerDisplayWindow = new BrowserWindow({
    ...initialWindowOpts,
    title: 'Customer Display',
    show: false,
    frame,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'customer-display-preload.js')
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

  customerDisplayWindow.once('ready-to-show', () => {
    try {
      // Fullscreen/kiosk makes the modern 15.6" display look like a real customer-facing screen.
      if (kiosk) {
        customerDisplayWindow.setKiosk(true);
      } else {
        customerDisplayWindow.setFullScreen(true);
      }
    } catch {
      // ignore
    }

    try { customerDisplayWindow.showInactive(); } catch { /* ignore */ }
  });

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

  // Load persisted customer display port (if configured)
  try {
    const settings = db.getSystemSettings();
    const configuredPort = settings?.customer_display_port;
    if (configuredPort) {
      process.env.CUSTOMER_DISPLAY_PORT = String(configuredPort);
      console.log('[CustomerDisplay] Using saved port from settings:', process.env.CUSTOMER_DISPLAY_PORT);
    }
  } catch (e) {
    console.warn('[CustomerDisplay] Failed to load saved port setting:', e.message);
  }

  // Default: exclude the scale port from customer display probing once known.
  // This prevents the customer display logic from ever grabbing the scale COM.
  try {
    if (scaleState?.portPath) {
      excludePortFromCustomerDisplay(scaleState.portPath);
    }
  } catch {
    // ignore
  }
  // Look up printers on COM ports early so display/scale probing skips them.
  getPrinterComPorts().catch(() => {});
  // Start the print worker now so the first ticket prints without the PowerShell startup delay.
  try { startPrintWorker(); } catch (e) { console.warn('[Print] Could not start print worker:', e.message); }
  
  createWindow();
  
  // Auto-connect to scale if available
  // ReadlineParser is optional; we can read raw bytes.
  if (SerialPort) {
    setTimeout(async () => {
      try {
        const ports = await SerialPort.list();
        const exclude = await getScaleExcludePorts(ports);
        const bestPort = pickBestScalePort(ports, { excludePaths: exclude });
        
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

          // Ensure customer display probing never grabs the scale COM port.
          try {
            excludePortFromCustomerDisplay(scalePortPath);
          } catch {
            // ignore
          }
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

// Cleanly close the customer display serial port before the process exits.
app.on('before-quit', (event) => {
  stopPrintWorker();
  if (customerDisplay && customerDisplay.isDisplayConnected && customerDisplay.isDisplayConnected()) {
    event.preventDefault();
    // Safety timeout: if disconnect takes > 2s, exit anyway
    const forceExit = setTimeout(() => app.exit(0), 2000);
    customerDisplay.disconnect()
      .catch(() => {})
      .finally(() => {
        clearTimeout(forceExit);
        app.exit(0);
      });
  }
});

// IPC Handlers for database operations

// Products
ipcMain.handle('products:getAll', async () => {
  return db.getAllProducts();
});

ipcMain.handle('products:getAllLite', async () => {
  return db.getAllProductsLite();
});

ipcMain.handle('products:search', async (event, query) => {
  return db.searchProducts(query);
});

ipcMain.handle('products:getByBarcode', async (event, barcode) => {
  return db.getProductByBarcode(barcode);
});

ipcMain.handle('products:getById', async (event, id) => {
  return db.getProductById(id);
});

ipcMain.handle('products:getVariosId', async () => {
  return db.getVariosProductId();
});

ipcMain.handle('products:add', async (event, product) => {
  return db.addProduct(product);
});

ipcMain.handle('products:bulkAdd', async (event, products) => {
  const results = { created: 0, skipped: 0, errors: [] };
  for (const p of (products || [])) {
    try {
      const bc = String(p.barcode || '').replace(/\s+/g, '').trim();
      if (!bc) { results.skipped++; continue; }
      // Skip if barcode already exists
      const existing = db.getProductByBarcode(bc);
      if (existing && existing.id) { results.skipped++; continue; }
      db.addProduct(p);
      results.created++;
    } catch (e) {
      results.errors.push({ barcode: p.barcode, error: String(e?.message || e) });
    }
  }
  return results;
});

// VAT (IVA) rates
ipcMain.handle('vatRates:getAll', async (event, activeOnly = true) => {
  return db.getVatRates(activeOnly !== false);
});

ipcMain.handle('vatRates:add', async (event, percent, label = null) => {
  return db.addVatRate(percent, label);
});

ipcMain.handle('products:update', async (event, id, product) => {
  return db.updateProduct(id, product);
});

ipcMain.handle('products:setShowInCheckout', async (event, id, showInCheckout) => {
  return db.setProductShowInCheckout(id, showInCheckout);
});

ipcMain.handle('products:delete', async (event, id) => {
  return db.deleteProduct(id);
});

ipcMain.handle('products:getSortOrder', async (event, scopeCategory, scopeSubcategory) => {
  return db.getProductSortOrder(scopeCategory, scopeSubcategory);
});

ipcMain.handle('products:setSortOrder', async (event, scopeCategory, scopeSubcategory, productIds) => {
  return db.setProductSortOrder(scopeCategory, scopeSubcategory, productIds);
});

ipcMain.handle('products:archive', async (event, id) => {
  return db.archiveProduct(id);
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

ipcMain.handle('sales:getYesterday', async () => {
  return db.getYesterdaySales();
});

ipcMain.handle('business:getRange', async (event, which) => {
  return db.getBusinessDayRange((which || 'today').toString());
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
  try {
    const result = db.addUser(user);
    return { success: true, ...result };
  } catch (error) {
    const msg = String(error?.message || error || 'Unknown error');
    const code = String(error?.code || '');
    const isUsernameUnique = code === 'SQLITE_CONSTRAINT_UNIQUE'
      || msg.includes('UNIQUE constraint failed: users.username');
    if (isUsernameUnique) {
      return { success: false, errorCode: 'USERNAME_EXISTS' };
    }
    return { success: false, errorCode: 'UNKNOWN', message: msg };
  }
});

ipcMain.handle('users:update', async (event, id, user) => {
  try {
    const result = db.updateUser(id, user);
    return { success: true, ...result };
  } catch (error) {
    const msg = String(error?.message || error || 'Unknown error');
    const code = String(error?.code || '');
    const isUsernameUnique = code === 'SQLITE_CONSTRAINT_UNIQUE'
      || msg.includes('UNIQUE constraint failed: users.username');
    if (isUsernameUnique) {
      return { success: false, errorCode: 'USERNAME_EXISTS' };
    }
    return { success: false, errorCode: 'UNKNOWN', message: msg };
  }
});

ipcMain.handle('users:updatePassword', async (event, id, password) => {
  return db.updateUserPassword(id, password);
});

ipcMain.handle('users:delete', async (event, id) => {
  try {
    const result = db.deleteUser(id);
    if (result && typeof result === 'object' && 'success' in result) return result;
    return { success: true, ...result };
  } catch (error) {
    return { success: false, errorCode: 'UNKNOWN', message: String(error?.message || error || 'Unknown error') };
  }
});

ipcMain.handle('users:getById', async (event, id) => {
  return db.getUserById(id);
});

// Loans
ipcMain.handle('loans:create', async (event, loanData) => {
  // New behavior: if the renderer provides sale + items, create or append
  // into an existing active restaurant parking tab.
  if (loanData && loanData.sale && Array.isArray(loanData.items)) {
    return db.createOrAppendLoan(loanData);
  }
  return db.createLoan(loanData);
});

ipcMain.handle('loans:getAll', async (event, status) => {
  return db.getAllLoans(status);
});

ipcMain.handle('loans:search', async (event, query, status) => {
  return db.searchLoans(query, status);
});

ipcMain.handle('loans:listParties', async (event, query, limit) => {
  return db.listLoanParties(query, limit);
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

ipcMain.handle('loans:delete', async (event, loanId) => {
  return db.deleteLoan(Number(loanId));
});

// Edit PARKING (loan) items before settlement
ipcMain.handle('loans:removeSaleItem', async (event, loanId, saleItemId) => {
  return db.removeSaleItemFromLoan(Number(loanId), Number(saleItemId));
});

ipcMain.handle('loans:updateSaleItems', async (event, loanId, edits) => {
  return db.updateLoanSaleItems(Number(loanId), Array.isArray(edits) ? edits : []);
});

// Returns handlers
ipcMain.handle('returns:create', async (event, returnData) => {
  return db.createReturn(returnData);
});

ipcMain.handle('returns:getAll', async () => {
  return db.getAllReturns();
});

ipcMain.handle('returns:getBySaleId', async (event, originalSaleId) => {
  return db.getReturnByOriginalSaleId(Number(originalSaleId));
});

// Expense handlers
ipcMain.handle('expenses:create', async (event, expenseData) => {
  return db.createExpense(expenseData);
});

ipcMain.handle('expenses:getAll', async (event, startDate, endDate) => {
  return db.getExpenses(startDate, endDate);
});

ipcMain.handle('expenses:getAllByDateTimeRange', async (event, startDateTime, endDateTime) => {
  return db.getExpensesByDateTimeRange(startDateTime, endDateTime);
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

ipcMain.handle('expenses:getSummaryByDateTimeRange', async (event, startDateTime, endDateTime) => {
  return db.getExpenseSummaryByDateTimeRange(startDateTime, endDateTime);
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
    const now = Date.now();
    if (now - lastDrawerKickAt < DRAWER_KICK_THROTTLE_MS) {
      return { success: true, message: 'Cash drawer kick throttled' };
    }
    lastDrawerKickAt = now;

    const printerName = await getPrinterNameFast();
    if (!printerName) {
      return { success: false, error: 'No printer found. Please configure a printer in Setup.' };
    }

    // For Windows, we'll write directly to the printer port
    if (process.platform === 'win32') {
      try {
        const tempFile = path.join(app.getPath('temp'), makeTempName('drawer_cmd', 'prn'));
        fs.writeFileSync(tempFile, drawerCommand);
        try {
          await sendRawFileToPrinterWindows(printerName, tempFile);
        } finally {
          try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* ignore */ }
        }
        console.log('Cash drawer opened via printer:', printerName);
        return { success: true, message: 'Cash drawer opened' };
      } catch (error) {
        console.error('Failed to open drawer:', error);
        return { success: false, error: 'Failed to communicate with printer: ' + error.message };
      }
    } else {
      // macOS/Linux: send the ESC/POS pulse as a raw CUPS job (stdin) to avoid temp files.
      try {
        try {
          await cupsSendBufferToPrinter(printerName, drawerCommand, { raw: true });
          console.log('Cash drawer opened via printer:', printerName);
          return { success: true, message: 'Cash drawer opened' };
        } catch (error1) {
          console.log('Method 1 failed, trying without raw option...');
          try {
            await cupsSendBufferToPrinter(printerName, drawerCommand, { raw: false });
            console.log('Cash drawer opened via printer (method 2):', printerName);
            return { success: true, message: 'Cash drawer opened' };
          } catch (error2) {
            console.log('Method 2 failed, trying direct device write...');

            // Method 3: Try to find the device path and write directly (best-effort)
            const { stdout } = await execPromise(`lpstat -v "${printerName}"`);
            const deviceMatch = stdout.match(/device for .+: (.+)/);
            if (!deviceMatch || !deviceMatch[1]) {
              throw error2;
            }

            const devicePathRaw = String(deviceMatch[1]).trim();
            console.log('Found device path:', devicePathRaw);

            // Only attempt direct write if it looks like a local path.
            // Common non-file URIs include: usb://..., ipp://..., lpd://...
            const devicePath = devicePathRaw.startsWith('file:')
              ? devicePathRaw.replace(/^file:/, '')
              : devicePathRaw;

            if (!devicePath.startsWith('/')) {
              throw error2;
            }

            const tempFile = path.join(app.getPath('temp'), makeTempName('drawer_cmd', 'prn'));
            try {
              fs.writeFileSync(tempFile, drawerCommand);
              await execPromise(`cat "${tempFile}" > "${devicePath}"`);
              console.log('Cash drawer opened via direct device write:', devicePath);
              return { success: true, message: 'Cash drawer opened' };
            } finally {
              try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* ignore */ }
            }
          }
        }
      } catch (error) {
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
      const printers = stdout.split(/\r?\n/).map(p => p.trim()).filter(p => p && !p.includes('----'));
      return { success: true, printers };
    } else if (process.platform === 'darwin') {
      // Get printers on macOS using lpstat
      const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
      const printers = stdout.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
      return { success: true, printers };
    } else {
      // Linux
      const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
      const printers = stdout.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
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
    let printerName = String(settings?.printer_name || '').trim();

    // Auto-detect printer if not configured
    if (!printerName) {
      console.log('No printer configured. Auto-detecting printer...');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execPromise = promisify(exec);

      try {
        if (process.platform === 'win32') {
          const { stdout } = await execPromise('powershell -command "Get-Printer | Select-Object Name | ForEach-Object { $_.Name }"');
          const printers = stdout.split(/\r?\n/).map(p => p.trim()).filter(p => p && !p.includes('----'));
          printerName = printers.find(p => /JP-?80|TM|Epson|iggual|thermal|POS|receipt|80/i.test(p)) || printers[0];
        } else if (process.platform === 'darwin') {
          const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
          const printers = stdout.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
          printerName = printers.find(p => /JP-?80|TM|Epson|iggual|thermal|POS|receipt|80/i.test(p)) || printers[0];
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

    const plainText = isPrinterPlainText();
    const normalizeCurrencySymbol = (value) => {
      const raw = value === undefined || value === null ? '' : String(value);
      return raw.trim() || '€';
    };

    const receiptEncoding = (() => {
      const enc = String(process.env.POS_PRINT_ENCODING || 'cp858').trim();
      return enc || 'cp858';
    })();

    const escposCodeTable = (() => {
      const raw = String(process.env.POS_ESCPOS_CODE_TABLE ?? '19').trim();
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 && n <= 255 ? n : 19;
    })();

    const escposCountry = (() => {
      // ESC R n (international character set). 7 is Spain (common on ESC/POS).
      const raw = String(process.env.POS_ESCPOS_COUNTRY ?? '7').trim();
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 && n <= 255 ? n : 7;
    })();

    const safeEncode = (text) => {
      const encode = (t) => {
        try {
          return iconv.encode(t, receiptEncoding);
        } catch {
          // Fallback to cp858 (Euro) if a custom encoding is invalid.
          return iconv.encode(t, 'cp858');
        }
      };
      return plainText ? encodePlainPrinterText(text, encode) : encode(text);
    };

    const receiptTimeZone = 'Europe/Madrid';

    const parseDateTimeLoose = (value) => {
      if (!value) return null;
      const s = String(value).trim();
      // SQLite CURRENT_TIMESTAMP often: "YYYY-MM-DD HH:MM:SS" (UTC)
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        const dt = new Date(s.replace(' ', 'T') + 'Z');
        return Number.isNaN(dt.getTime()) ? null : dt;
      }
      const dt = new Date(s);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    const formatReceiptDateTime = (payload) => {
      try {
        const src = payload?.dateIso ?? payload?.sale_date ?? payload?.saleDateIso ?? payload?.date;
        const dt = parseDateTimeLoose(src) || new Date();
        // es-ES default format: dd/mm/yyyy, HH:MM:SS
        return new Intl.DateTimeFormat('es-ES', {
          timeZone: receiptTimeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(dt);
      } catch {
        return String(payload?.date || '').trim();
      }
    };

    // RAW TICKET PRINTING SUPPORT
    if (receiptData.raw && typeof receiptData.text === 'string') {
      // Write raw text directly to printer.
      // IMPORTANT: Many printers require setting the international charset + code table
      // for the Euro symbol (and Spanish characters) to render correctly.
      // Do it here so *all* raw prints (Z-report, sales history thermal, etc.) are consistent.
      const tempFile = path.join(app.getPath('temp'), 'ticket_' + Date.now() + '.txt');

      const ESC = '\x1B';
      const FS = '\x1C';

      const initSeq = (
        // Initialize + cancel kanji + set international charset + set code table
        ESC + '@' +
        FS + '.' +
        ESC + 'R' + String.fromCharCode(escposCountry) +
        ESC + 't' + String.fromCharCode(escposCodeTable)
      );

      const rawText = String(receiptData.text ?? '');
      // If caller already starts with ESC @, inject charset selection right after it.
      const normalizedText = rawText.startsWith(ESC + '@')
        ? (ESC + '@' + initSeq.slice(2) + rawText.slice(2))
        : (initSeq + rawText);

      const ticketBuffer = safeEncode(normalizedText);
      fs.writeFileSync(tempFile, ticketBuffer);

      if (process.platform === 'win32') {
        try {
          await sendRawFileToPrinterWindows(printerName, tempFile);
          fs.unlinkSync(tempFile);
          console.log('Ticket printed successfully (raw mode)');
          return { success: true };
        } catch (error) {
          try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (cleanupError) {}
          throw error;
        }
      } else {
        // macOS/Linux
        try {
          await execPromise(`lp -d "${printerName}" -o raw "${tempFile}"`);
          fs.unlinkSync(tempFile);
          console.log('Ticket printed successfully (raw mode)');
          return { success: true };
        } catch (error) {
          try { await execPromise(`lp -d "${printerName}" "${tempFile}"`); fs.unlinkSync(tempFile); console.log('Ticket printed successfully (raw mode, fallback)'); return { success: true }; } catch (error2) { fs.unlinkSync(tempFile); throw error2; }
        }
      }
    }

    // Format receipt for thermal printer (ESC/POS)
    const ESC = '\x1B';
    const GS = '\x1D';
    const FS = '\x1C';

    const inferLineWidth = (printer, data) => {
      const explicit = Number(data?.lineWidth);
      if (Number.isFinite(explicit) && explicit >= 24 && explicit <= 64) {
        return Math.round(explicit);
      }

      const name = String(printer || '').toLowerCase();
      // Heuristic: many 80mm ESC/POS printers are 48 columns in Font A.
      // Keep 32 as safe default for 58mm.
      const looks80mm = name.includes('80mm')
        || name.includes('80 mm')
        || name.includes('posprinter')
        || name.includes('pos-80')
        || name.includes('pos 80')
        || name.includes('easy 80')
        || name.includes('tp easy 80')
        || name.includes('tp7001')
        || name.includes('tp 7001')
        || name.includes('iggual')
        || name.includes('jp-80')
        || name.includes('jp80')
        || name.includes('tm-t20')
        || name.includes('tm t20')
        || name.includes('tm-t88')
        || name.includes('tm t88');
      return looks80mm ? 48 : 32;
    };

    const LINE_WIDTH = inferLineWidth(printerName, receiptData);
    const receiptStorePhone = String(settings?.store_phone || '').trim();

    // Special receipt: PARKING payment receipt
    if (receiptData && receiptData.type === 'loanPayment') {
      const padRight = (value, length) => {
        const text = String(value ?? '');
        return text.length >= length ? text.slice(0, length) : text + ' '.repeat(length - text.length);
      };

      const padLeft = (value, length) => {
        const text = String(value ?? '');
        return text.length >= length ? text.slice(text.length - length) : ' '.repeat(length - text.length) + text;
      };

      const center = (value) => {
        const text = String(value ?? '');
        if (text.length >= LINE_WIDTH) return text.slice(0, LINE_WIDTH);
        const left = Math.floor((LINE_WIDTH - text.length) / 2);
        return ' '.repeat(left) + text;
      };

      const rightLabelValue = (label, value, fillChar = '.') => {
        const labelText = String(label);
        const valueText = String(value);
        const gap = Math.max(1, LINE_WIDTH - labelText.length - valueText.length);
        return labelText + fillChar.repeat(gap) + valueText;
      };

      const currency = normalizeCurrencySymbol(receiptData.currency);
      const formatMoney = (amount) => {
        const num = Number(amount || 0);
        return num.toFixed(2).replace('.', ',') + currency;
      };

      const method = (receiptData.paymentMethod || '').toString().toLowerCase();
      const methodLabel = method === 'cash' ? 'CONTADO' : method === 'card' ? 'TARJETA' : method.toUpperCase();

      let receipt = '';
      receipt += ESC + '@';
      // Cancel kanji mode + set international charset + code table for proper symbols (€, ü, etc.)
      receipt += FS + '.';
      receipt += ESC + 'R' + String.fromCharCode(escposCountry);
      receipt += ESC + 't' + String.fromCharCode(escposCodeTable);
      receipt += ESC + '!' + String.fromCharCode(0);
      receipt += ESC + 'a' + String.fromCharCode(1);

      // Kick drawer only when explicitly requested.
      // (Never auto-kick on print, because the drawer is opened at payment time.)
      const shouldKickDrawer = !!receiptData?.kickDrawer;
      if (shouldKickDrawer) {
        receipt += ESC + 'p' + String.fromCharCode(0) + String.fromCharCode(0x19) + String.fromCharCode(0xFA);
      }

      receipt += ESC + '!' + String.fromCharCode(0x20);
      receipt += (receiptData.storeName || 'BDCONNECT POS').toString().toUpperCase() + '\n';
      receipt += ESC + '!' + String.fromCharCode(0);

      if (receiptData.companyAddress) receipt += receiptData.companyAddress + '\n';
      if (receiptStorePhone) receipt += 'Tel: ' + receiptStorePhone + '\n';
      if (receiptData.nieNumber) receipt += receiptData.nieNumber + '\n';
      receipt += '\n';

      receipt += ESC + '!' + String.fromCharCode(0x10);
      receipt += 'PAGO PARKING\n';
      receipt += 'NO VALIDO COMO FACTURA\n';
      receipt += ESC + '!' + String.fromCharCode(0);

      const dupNo = Math.floor(Number(receiptData?.duplicateNumber || 0));
      if (dupNo > 0) {
        receipt += ESC + '!' + String.fromCharCode(0x10);
        receipt += `DUPLICATE ${dupNo}\n`;
        receipt += ESC + '!' + String.fromCharCode(0);
      }
      receipt += '='.repeat(LINE_WIDTH) + '\n';

      receipt += ESC + 'a' + String.fromCharCode(0);
      receipt += 'FECHA: ' + formatReceiptDateTime(receiptData) + '\n';
      if (receiptData.loanReceiptNumber) {
        receipt += 'RECIBO PARKING: ' + String(receiptData.loanReceiptNumber) + '\n';
      }
      if (receiptData.paymentReceiptNumber) {
        receipt += 'PAGO N: ' + String(receiptData.paymentReceiptNumber) + '\n';
      }
      receipt += '-'.repeat(LINE_WIDTH) + '\n';

      const customerType = (receiptData.customerType || '').toString().toLowerCase();
      if (receiptData.restaurantName) {
        receipt += 'RESTAURANTE: ' + String(receiptData.restaurantName) + '\n';
        if (receiptData.restaurantNie) receipt += 'NIE: ' + String(receiptData.restaurantNie) + '\n';
      }
      if (receiptData.customerName) {
        receipt += 'CLIENTE: ' + String(receiptData.customerName) + '\n';
      } else if (customerType) {
        receipt += 'TIPO: ' + customerType.toUpperCase() + '\n';
      }
      if (receiptData.customerPhone) receipt += 'TEL: ' + String(receiptData.customerPhone) + '\n';
      receipt += '-'.repeat(LINE_WIDTH) + '\n';

      receipt += rightLabelValue('IMPORTE PAGADO', formatMoney(receiptData.amountPaid || 0)) + '\n';
      receipt += rightLabelValue('FORMA DE PAGO', methodLabel) + '\n';
      receipt += '-'.repeat(LINE_WIDTH) + '\n';

      const remainingAfter = Number(receiptData.remainingAfter ?? 0);
      const loanTotal = Number(receiptData.loanTotal ?? 0);
      if (Number.isFinite(loanTotal) && loanTotal > 0) {
        receipt += rightLabelValue('TOTAL PARKING', formatMoney(loanTotal)) + '\n';
      }
      receipt += rightLabelValue('PENDIENTE', formatMoney(remainingAfter)) + '\n';
      if (receiptData.status) {
        receipt += rightLabelValue('ESTADO', String(receiptData.status).toUpperCase(), ' ') + '\n';
      }
      receipt += '\n';

      if (receiptData.cashier) {
        receipt += 'LE ATENDIO: ' + String(receiptData.cashier).slice(0, Math.max(0, LINE_WIDTH - 12)) + '\n';
      }
      receipt += '='.repeat(LINE_WIDTH) + '\n';

      receipt += '\n\n';
      receipt += GS + 'V' + String.fromCharCode(65) + String.fromCharCode(2);

      const tempFile = path.join(app.getPath('temp'), 'loan_payment_' + Date.now() + '.txt');
      const receiptBuffer = safeEncode(receipt);
      fs.writeFileSync(tempFile, receiptBuffer);

      try {
        if (process.platform === 'win32') {
          await sendRawFileToPrinterWindows(printerName, tempFile);
        } else {
          await execPromise(`lp -d "${printerName}" -o raw "${tempFile}"`);
        }
        fs.unlinkSync(tempFile);
        console.log('Loan payment receipt printed successfully');
        return { success: true };
      } catch (printError) {
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (cleanupError) {}
        throw printError;
      }
    }

    const getItemLayout = (lineWidth) => {
      const isWide = lineWidth >= 42;
      if (isWide) {
        // 80mm style: Ud + (qty) + Descripción + Precio + Dt% + Importe
        const unitsWidth = 2;
        const weightWidth = 8; // e.g. (1,265)
        const priceWidth = 7;
        const discountWidth = 4;
        const totalWidth = 7;
        const descWidth = Math.max(10, lineWidth - unitsWidth - weightWidth - priceWidth - discountWidth - totalWidth);
        const headerLeftWidth = unitsWidth + weightWidth + descWidth;
        return {
          isWide,
          unitsWidth,
          weightWidth,
          descWidth,
          priceWidth,
          discountWidth,
          totalWidth,
          headerLeftWidth,
        };
      }

      // 58mm style
      const qtyWidth = 6;
      const priceWidth = 6;
      const totalWidth = 6;
      const gapDescPrice = 0;
      const gapPriceTotal = 1;
      const descWidth = lineWidth - qtyWidth - gapDescPrice - priceWidth - gapPriceTotal - totalWidth;
      const headerLeftWidth = qtyWidth + descWidth + gapDescPrice;
      return {
        isWide,
        qtyWidth,
        descWidth,
        priceWidth,
        totalWidth,
        gapDescPrice,
        gapPriceTotal,
        headerLeftWidth,
      };
    };

    const layout = getItemLayout(LINE_WIDTH);

    const padRight = (value, length) => {
      const text = String(value ?? '');
      return text.length >= length ? text.slice(0, length) : text + ' '.repeat(length - text.length);
    };

    const padLeft = (value, length) => {
      const text = String(value ?? '');
      return text.length >= length ? text.slice(text.length - length) : ' '.repeat(length - text.length) + text;
    };

    const formatMoney = (amount, { decimals = 2, decimal = ',', suffix = '' } = {}) => {
      const num = Number(amount || 0);
      return num.toFixed(decimals).replace('.', decimal) + suffix;
    };
  const currencySymbol = normalizeCurrencySymbol(receiptData?.currency);

    const formatQty = (amount, { decimals = 3, decimal = ',' } = {}) => {
      const num = Number(amount || 0);
      let text = num.toFixed(decimals).replace('.', decimal);
      if (decimal === ',') {
        text = text.replace(/0+$/, '').replace(/,$/, '');
      } else {
        text = text.replace(/0+$/, '').replace(/\.$/, '');
      }
      return text;
    };

    const rightLabelValue = (label, value, gap = 2) => {
      const labelText = String(label);
      const valueText = String(value);
      const spaces = Math.max(gap, LINE_WIDTH - labelText.length - valueText.length);
      return labelText + ' '.repeat(spaces) + valueText;
    };
    
    let receipt = '';
    
    // Initialize printer
    receipt += ESC + '@'; // Initialize
    // Cancel kanji mode + set international charset + code table for proper symbols (€, ü, etc.)
    receipt += FS + '.';
    receipt += ESC + 'R' + String.fromCharCode(escposCountry);
    receipt += ESC + 't' + String.fromCharCode(escposCodeTable);
    // Ensure standard mode + left margin
    receipt += ESC + '!\x00';
    receipt += ESC + 'a' + String.fromCharCode(1); // Center align

    // Kick drawer only when explicitly requested.
    // (Never auto-kick on print, because the drawer is opened at payment time.)
    const shouldKickDrawer = !!receiptData?.kickDrawer;
    if (shouldKickDrawer) {
      receipt += ESC + 'p' + String.fromCharCode(0) + String.fromCharCode(0x19) + String.fromCharCode(0xFA);
    }
    
    // Store name (large text)
    receipt += ESC + '!' + String.fromCharCode(0x20); // Bold + large
    receipt += (receiptData.storeName || '').toString().toUpperCase() + '\n';
    receipt += ESC + '!' + String.fromCharCode(0); // Normal text
    
    // Owner name
    if (receiptData.ownerName) {
      receipt += receiptData.ownerName + '\n';
    }
    // NIE/CIF number
    if (receiptData.nieNumber) {
      receipt += receiptData.nieNumber + '\n';
    }
    // Store address
    if (receiptData.companyAddress) {
      receipt += receiptData.companyAddress + '\n';
    }
    // Store phone (System Settings; read here so every receipt type gets it)
    if (receiptStorePhone) {
      receipt += 'Tel: ' + receiptStorePhone + '\n';
    }

    receipt += '\n';

    // Header label (receipt vs ticket)
    receipt += ESC + '!' + String.fromCharCode(0x10); // Bold
    if (receiptData.isRefund) {
      receipt += 'DEVOLUCION\n';
    } else if (receiptData.isTicket) {
      receipt += 'NO VALIDO COMO FACTURA\n';
    } else {
      receipt += 'FACTURA SIMPLIFICADA\n';
    }
    receipt += ESC + '!' + String.fromCharCode(0); // Normal text

    const dupNo = Math.floor(Number(receiptData?.duplicateNumber || 0));
    if (dupNo > 0) {
      receipt += ESC + '!' + String.fromCharCode(0x10); // Bold
      receipt += `DUPLICATE ${dupNo}\n`;
      receipt += ESC + '!' + String.fromCharCode(0);
    }

    // Optional customer/restaurant block (used for restaurant PARKING bills)
    // Match common Spanish receipt style: a dashed box under the header.
    const restaurantName = (receiptData.restaurantName || '').toString().trim();
    const restaurantNie = (receiptData.restaurantNie || '').toString().trim();
    const customerName = (receiptData.customerName || '').toString().trim();
    const customerPhone = (receiptData.customerPhone || '').toString().trim();
    if (restaurantName || customerName || customerPhone) {
      receipt += ESC + 'a' + String.fromCharCode(0); // Left align
      receipt += '-'.repeat(LINE_WIDTH) + '\n';
      if (restaurantName) receipt += restaurantName.toUpperCase().slice(0, LINE_WIDTH) + '\n';
      if (restaurantNie) receipt += restaurantNie.slice(0, LINE_WIDTH) + '\n';
      if (!restaurantName && customerName) receipt += customerName.toUpperCase().slice(0, LINE_WIDTH) + '\n';
      if (customerPhone) receipt += customerPhone.slice(0, LINE_WIDTH) + '\n';
      receipt += '-'.repeat(LINE_WIDTH) + '\n';
    }

    // Divider
    receipt += '='.repeat(LINE_WIDTH) + '\n';

    receipt += ESC + 'a' + String.fromCharCode(0); // Left align
    receipt += 'FECHA: ' + formatReceiptDateTime(receiptData) + '\n';
    if (receiptData.isRefund) {
      receipt += 'Devolucion N: D' + (receiptData.refundId || '') + '\n';
      receipt += 'Ticket original: ' + (receiptData.receiptId || '') + '\n';
    } else {
      if (!receiptData.isTicket) {
        receipt += 'Factura Simplificada PRINCIPAL\n';
      }
      receipt += 'Serie/N: ' + (receiptData.receiptId || '') + '\n';
    }

    // Columns header
    if (layout.isWide) {
      receipt += padRight('Ud.Descripcion', layout.headerLeftWidth)
        + padLeft('Precio', layout.priceWidth)
        + padLeft('Dt%', layout.discountWidth)
        + padLeft('Importe', layout.totalWidth)
        + '\n';
    } else {
      const totalHeaderLabel = layout.totalWidth >= 7 ? 'Importe' : 'Import';
      receipt += padRight('Ud.Descripcion', layout.headerLeftWidth)
        + padLeft('Precio', layout.priceWidth)
        + ' '.repeat(layout.gapPriceTotal)
        + padLeft(totalHeaderLabel, layout.totalWidth)
        + '\n';
    }
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    // Items
    (receiptData.items || []).forEach(item => {
      const qty = Number(item.quantity || 0);
      const subtotal = Number(item.subtotal || 0);
      const explicitUnitPrice = Number(item.unitPrice ?? item.unit_price);
      const unitPrice = Number.isFinite(explicitUnitPrice)
        ? explicitUnitPrice
        : (qty ? (subtotal / qty) : subtotal);

      const discountPercent = Number(item.discountPercent ?? item.discount_percent ?? 0);

      const qtyStrRaw = Number.isFinite(qty) ? (qty % 1 === 0 ? String(qty) : qty.toFixed(3)) : '';

      if (layout.isWide) {
        const isDecimalQty = Number.isFinite(qty) && qty % 1 !== 0;
        const units = isDecimalQty ? 1 : qty;
        const unitsStr = padRight((Number.isFinite(units) ? String(units) : ''), layout.unitsWidth);
        const weightText = isDecimalQty ? `(${formatQty(qty, { decimals: 3, decimal: ',' })})` : '';
        const weightStr = padRight(weightText, layout.weightWidth);
        const descStr = padRight(((item.name || '').toString()), layout.descWidth);
        const priceStr = padLeft(formatMoney(unitPrice, { decimal: ',' }), layout.priceWidth);
        const discountStr = padLeft(discountPercent ? `${Math.round(discountPercent)}%` : '', layout.discountWidth);
        const totalStr = padLeft(formatMoney(subtotal, { decimal: ',' }), layout.totalWidth);

        receipt += unitsStr + weightStr + descStr + priceStr + discountStr + totalStr + '\n';
      } else {
        const qtyStr = padRight(qtyStrRaw.replace(/0+$/,'').replace(/\.$/,''), layout.qtyWidth);
        const descStr = padRight(((item.name || '').toString().toUpperCase()), layout.descWidth);
        const priceStr = padLeft(formatMoney(unitPrice, { decimal: ',' }), layout.priceWidth);
        const totalStr = padLeft(formatMoney(subtotal, { decimal: ',' }), layout.totalWidth);

        receipt += qtyStr
          + descStr
          + ' '.repeat(layout.gapDescPrice)
          + priceStr
          + ' '.repeat(layout.gapPriceTotal)
          + totalStr
          + '\n';
      }

      // Returned part of this line (reprint after a refund), like the on-screen receipt.
      const returnedQty = Number(item.returnedQuantity || 0);
      if (returnedQty > 0) {
        const qtyText = returnedQty % 1 === 0 ? String(returnedQty) : formatQty(returnedQty, { decimals: 3, decimal: ',' });
        const label = `  ** DEVUELTO -${qtyText} **`;
        const amount = formatMoney(-Number(item.returnedAmount || 0), { decimal: ',' });
        receipt += GS + 'B' + String.fromCharCode(1); // White on black
        receipt += rightLabelValue(label, amount + ' ') + '\n';
        receipt += GS + 'B' + String.fromCharCode(0);
      }
    });

    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    // Refund ticket: what the bill was, what has been returned, what the customer kept.
    if (receiptData.isRefund && Number.isFinite(Number(receiptData.originalTotal))) {
      const originalTotal = Number(receiptData.originalTotal);
      const refundedAll = Number(receiptData.refundedTotalAll || 0);
      receipt += rightLabelValue('TOTAL TICKET', formatMoney(originalTotal, { decimal: ',', suffix: currencySymbol })) + '\n';
      receipt += rightLabelValue('TOTAL DEVUELTO', formatMoney(-refundedAll, { decimal: ',', suffix: currencySymbol })) + '\n';
      receipt += ESC + '!' + String.fromCharCode(0x08); // Bold
      receipt += rightLabelValue('NETO', formatMoney(originalTotal - refundedAll, { decimal: ',', suffix: currencySymbol })) + '\n';
      receipt += ESC + '!' + String.fromCharCode(0);
      receipt += '-'.repeat(LINE_WIDTH) + '\n';
    }

    // Tax breakdown table (scale to LINE_WIDTH)
    const ivaWidth = 5;
    const remaining = LINE_WIDTH - ivaWidth;
    const colWidth = Math.floor(remaining / 3);
    const rem = remaining - (colWidth * 3);
    const baseWidth = colWidth;
    const cuotaWidth = colWidth;
    const taxTotalWidth = colWidth + rem;

    receipt += padRight('Iva', ivaWidth)
      + padLeft('Base', baseWidth)
      + padLeft('Cuota', cuotaWidth)
      + padLeft('Total', taxTotalWidth)
      + '\n';

    let totalBase = 0;
    let totalCuota = 0;
    let totalAll = 0;

    (receiptData.taxBreakdown || []).forEach(taxLine => {
      const rate = Number(taxLine.rate || 0);
      const base = Number(taxLine.base || 0);
      const cuota = Number(taxLine.tax || 0);
      const total = Number(taxLine.total || 0);

      totalBase += base;
      totalCuota += cuota;
      totalAll += total;

      const ivaStr = padRight((Number.isFinite(rate) ? rate.toFixed(0) : '0') + '%', ivaWidth);
      const baseStr = padLeft(formatMoney(base, { decimal: ',', suffix: currencySymbol }), baseWidth);
      const cuotaStr = padLeft(formatMoney(cuota, { decimal: ',', suffix: currencySymbol }), cuotaWidth);
      const totalStr = padLeft(formatMoney(total, { decimal: ',', suffix: currencySymbol }), taxTotalWidth);
      receipt += ivaStr + baseStr + cuotaStr + totalStr + '\n';
    });

    receipt += '-'.repeat(LINE_WIDTH) + '\n';
    receipt += padRight('TOTAL', ivaWidth)
      + padLeft(formatMoney(totalBase, { decimal: ',', suffix: currencySymbol }), baseWidth)
      + padLeft(formatMoney(totalCuota, { decimal: ',', suffix: currencySymbol }), cuotaWidth)
      + padLeft(formatMoney(totalAll, { decimal: ',', suffix: currencySymbol }), taxTotalWidth)
      + '\n';

    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    // Payment method line (like sample: CONTADO/TARJETA with amount)
    const paymentMethod = (receiptData.paymentMethod || 'CASH').toString().toUpperCase();
    const paymentLabel = receiptData.isRefund
      ? (paymentMethod === 'CARD' ? 'DEVUELTO TARJETA' : 'DEVUELTO EFECTIVO')
      : paymentMethod === 'CASH' ? 'CONTADO'
      : paymentMethod === 'CARD' ? 'TARJETA'
      : paymentMethod === 'PARKING' ? 'CREDITO'
      : paymentMethod;
    receipt += rightLabelValue(paymentLabel, formatMoney(receiptData.total || 0, { decimal: ',', suffix: currencySymbol })) + '\n';

    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    // Big total section (comma decimal, with currency)
    receipt += ESC + 'a' + String.fromCharCode(1); // Center align
    receipt += ESC + '!' + String.fromCharCode(0x30); // Double height + double width
    receipt += 'TOTAL        ' + formatMoney(receiptData.total || 0, { decimal: ',', suffix: currencySymbol }) + '\n';
    receipt += ESC + '!' + String.fromCharCode(0); // Normal text
    receipt += '(Impuestos Incluidos)\n';
    receipt += '\n';

    // Refunds already made on this sale (shown on reprints): reference + net total
    const refunds = Array.isArray(receiptData.refunds) ? receiptData.refunds : [];
    if (!receiptData.isRefund && refunds.length > 0) {
      const refundedTotal = refunds.reduce((sum, ref) => sum + Number(ref.total || 0), 0);
      receipt += ESC + 'a' + String.fromCharCode(0); // Left align
      receipt += '-'.repeat(LINE_WIDTH) + '\n';
      refunds.forEach(ref => {
        receipt += `DEVOLUCION D${ref.id || ''}  ${formatReceiptDateTime({ dateIso: ref.dateIso })}\n`;
      });
      receipt += rightLabelValue('TOTAL DEVUELTO', formatMoney(-refundedTotal, { decimal: ',', suffix: currencySymbol })) + '\n';
      receipt += '-'.repeat(LINE_WIDTH) + '\n';
      receipt += ESC + 'a' + String.fromCharCode(1); // Center align
      receipt += ESC + '!' + String.fromCharCode(0x30); // Double height + double width
      receipt += 'NETO   ' + formatMoney(Number(receiptData.total || 0) - refundedTotal, { decimal: ',', suffix: currencySymbol }) + '\n';
      receipt += ESC + '!' + String.fromCharCode(0);
      receipt += '\n';
    }

    // ENTREGA / CAMBIO (not on a refund: money goes back to the customer)
    receipt += ESC + 'a' + String.fromCharCode(0); // Left align
    if (!receiptData.isRefund) {
      const entrega = formatMoney((receiptData.paymentAmount || receiptData.total), { decimal: ',', suffix: currencySymbol });
      const cambio = formatMoney((receiptData.changeAmount || 0), { decimal: ',', suffix: currencySymbol });
      receipt += rightLabelValue('ENTREGA', entrega) + '\n';
      receipt += rightLabelValue('CAMBIO', cambio) + '\n';
    }
    receipt += '\n';
    
    // Services count
    receipt += 'SERVICIOS: ' + receiptData.items.length + '\n';
    receipt += 'CUENTAS:   / 1 )\n';
    receipt += 'LE ATENDIO: ' + (receiptData.cashier || '') + '\n';
    receipt += '\n';
    
    // Footer message
    receipt += ESC + 'a' + String.fromCharCode(1); // Center align
    if (receiptData.footer) {
      receipt += '---- ' + receiptData.footer + ' ----\n';
    } else {
      receipt += '---- GRACIAS POR SU VISITA ----\n';
    }
    
    receipt += '\n\n';

    // Feed and cut
    // Use a single ESC/POS command to feed then cut. This avoids printers
    // that mis-handle double cut commands and can cause extra blank paper
    // before the next ticket/receipt.
    receipt += GS + 'V' + String.fromCharCode(65) + String.fromCharCode(2); // Full cut after feeding 2 lines
    
    // Write to temp file and print
    const tempFile = path.join(app.getPath('temp'), 'receipt_' + Date.now() + '.txt');
    const receiptBuffer = safeEncode(receipt);
    fs.writeFileSync(tempFile, receiptBuffer);
    
    try {
      if (process.platform === 'win32') {
        await sendRawFileToPrinterWindows(printerName, tempFile);
      } else {
        await execPromise(`lp -d "${printerName}" -o raw "${tempFile}"`);
      }
      
      fs.unlinkSync(tempFile);
      console.log('Receipt printed successfully');
      return { success: true };
    } catch (printError) {
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (cleanupError) {}
      throw printError;
    }
  } catch (error) {
    console.error('Error printing receipt:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('printer:printBarcode', async (event, barcodeData) => {
  try {
    const payload = barcodeData || {};
    const barcode = String(payload.barcode || '').replace(/\s+/g, '').trim();
    const name = String(payload.name || '').trim();
    const currencySymbol = String(payload.currencySymbol || '€').trim() || '€';
    const priceNum = Number(payload.price);

    if (!barcode) return { success: false, message: 'Missing barcode' };
    if (!name) return { success: false, message: 'Missing product name' };

    // Printer selection:
    // - LABEL_PRINTER_NAME env var (recommended for dedicated label printer)
    // - otherwise the receipt printer: the one set in Settings, or the auto-detected
    //   one when Settings is empty (same as receipt printing)
    const labelPrinterEnv = String(process.env.LABEL_PRINTER_NAME || '').trim();
    const printerName = (labelPrinterEnv || await getPrinterNameFast() || '').toString().trim();
    if (!printerName) {
      return { success: false, message: 'No printer found. Connect the printer, or set Receipt Printer Name in Settings.' };
    }

    const formatPrice = (amount) => {
      const n = Number(amount);
      const p = (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',');
      // Match sample label: 10,00€ (suffix for Euro)
      if (currencySymbol === '€') return `${p}€`;
      return `${currencySymbol}${p}`;
    };

    const escapeHtml = (s) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Try a "graphic" (HTML) label first so we can match the desired layout.
    // If it fails (driver/printer quirks), fall back to the raw ESC/POS implementation below.
    // On the receipt printer (no dedicated LABEL_PRINTER_NAME) always print raw ESC/POS, like
    // receipts: an HTML page goes through the Windows driver, which on POS thermal printers
    // prints a blank page and fires the driver's "open cash drawer" setting.
    const onReceiptPrinter = !labelPrinterEnv;
    const labelPrintMode = (onReceiptPrinter && !process.env.LABEL_PRINT_MODE)
      ? 'raw'
      : String(payload.labelPrintMode || process.env.LABEL_PRINT_MODE || 'auto').toLowerCase();
    const hasPrice = Number.isFinite(priceNum) && priceNum >= 0;
    const refValue = (payload.ref ?? payload.productId ?? payload.id ?? payload.sku ?? barcode);

    if (labelPrintMode !== 'raw') {
      try {
        const bwipjs = require('bwip-js');
        const { BrowserWindow } = require('electron');

        const isEAN13 = /^\d{13}$/.test(barcode);
        const isUPCA = /^\d{12}$/.test(barcode);
        const isEAN8 = /^\d{8}$/.test(barcode);
        const bcid = isEAN13 ? 'ean13' : (isUPCA ? 'upca' : (isEAN8 ? 'ean8' : 'code128'));

        // Label size in mm. Adjust via env vars if your sticker roll differs.
        const mmW = Number(payload.labelMmWidth ?? process.env.LABEL_MM_WIDTH ?? 57);
        const mmH = Number(payload.labelMmHeight ?? process.env.LABEL_MM_HEIGHT ?? 32);

        const barcodeSvg = bwipjs.toSVG({
          bcid,
          text: barcode,
          // Many shops use "internal" 12/13-digit codes that don't have a valid
          // EAN check digit. Be tolerant so preview/print doesn't fail.
          validatecheck: false,
          scale: 2,
          height: 9,
          includetext: true,
          textxalign: 'center',
          textsize: 9,
          paddingwidth: 0,
          paddingheight: 0,
        });

        const titleText = escapeHtml(name.toUpperCase());
        const priceText = escapeHtml(hasPrice ? formatPrice(priceNum) : '');
        const refText = escapeHtml(String(refValue));

        const layoutModeRaw = String(payload.labelLayout || '').toLowerCase();
        const layoutMode = layoutModeRaw.replace(/[_\s]/g, '-');

        const html = (layoutMode === 'pvp-right' || layoutMode === 'pvpright')
          ? `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
    html, body { width: ${mmW}mm; height: ${mmH}mm; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: 2mm;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 0.5mm;
    }
    .title { font-weight: 700; font-size: 12px; line-height: 1.1; letter-spacing: 0.3px; margin: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .barcode { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    svg { width: 88%; height: auto; max-height: 100%; }
    .priceRow { display: flex; flex-direction: column; align-items: center; justify-content: center; padding-bottom: 1mm; }
    .pvp { font-weight: 700; font-size: 10px; line-height: 1.0; margin: 0 0 0.3mm 0; }
    .price { font-weight: 900; font-size: 16px; line-height: 1.0; margin: 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">${titleText}</div>
    <div class="barcode">${barcodeSvg}</div>
    <div class="priceRow">
      <div class="pvp">P.V.P.</div>
      <div class="price">${priceText}</div>
    </div>
  </div>
</body>
</html>`
          : layoutMode === 'centered'
          ? `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
    html, body { width: ${mmW}mm; height: ${mmH}mm; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap { box-sizing: border-box; width: 100%; height: 100%; padding: 3mm; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; }
    .title { font-weight: 900; font-size: 26px; line-height: 1.05; letter-spacing: 0.5px; margin: 0 0 2mm 0; text-align:center; width:100%; }
    .price { font-weight: 900; font-size: 26px; line-height: 1.0; margin: 0 0 2mm 0; text-align:center; width:100%; }
    .pvp { font-weight: 900; font-size: 14px; margin-right: 6px; }
    .barcode { width: 100%; flex: 1 1 auto; display:flex; align-items:flex-end; justify-content:center; }
    svg { width: 92%; height: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">${titleText}</div>
    <div class="price"><span class="pvp">P.V.P.</span>${priceText}</div>
    <div class="barcode">${barcodeSvg}</div>
  </div>
</body>
</html>`
          : `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
    html, body { width: ${mmW}mm; height: ${mmH}mm; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { display:flex; align-items:flex-start; justify-content:center; overflow:hidden; }
    .wrap { box-sizing: border-box; width: 90%; height: 84%; margin: 1.5mm auto 0; border: 1px solid #111; padding: 1.4mm 1.6mm; }
    .title { font-weight: 900; font-size: 10px; letter-spacing: 0.25px; margin: 0 0 0.8mm 0; }
    .row { display: flex; gap: 1.5mm; align-items: center; height: calc(100% - 6mm); }
    .left { flex: 1 1 52%; display: flex; align-items: center; justify-content: center; overflow:hidden; }
    .right { flex: 1 1 48%; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; }
    .pvp { font-weight: 900; font-size: 8px; margin-bottom: 0.35mm; }
    .price { font-weight: 900; font-size: 22px; line-height: 0.92; }
    .ref { font-weight: 800; font-size: 8.5px; margin-top: 0.8mm; }
    svg { width: 82%; height: auto; max-height: 100%; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">${titleText}</div>
    <div class="row">
      <div class="left">${barcodeSvg}</div>
      <div class="right">
        <div class="pvp">P.V.P.</div>
        <div class="price">${priceText}</div>
        <div class="ref">Ref: ${refText}</div>
      </div>
    </div>
  </div>
</body>
</html>`;

        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        try {
          const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
          await win.loadURL(url);

          // Resolve the exact Electron printer name.
          // On some platforms, webContents.print requires an exact deviceName
          // (case-sensitive), otherwise it fails and we'd fall back to raw.
          let resolvedDeviceName = null;
          try {
            const printers = await win.webContents.getPrintersAsync();
            const wanted = String(printerName || '').trim().toLowerCase();
            const match = (printers || []).find(p => String(p?.name || '').trim().toLowerCase() === wanted)
              || (printers || []).find(p => String(p?.name || '').trim().toLowerCase().includes(wanted))
              || null;
            resolvedDeviceName = match ? String(match.name) : null;
          } catch {
            resolvedDeviceName = null;
          }

          const tryPrint = async ({ deviceName }) => {
            const printOptions = {
              silent: true,
              landscape: false,
              printBackground: true,
              marginsType: 1,
              pageSize: {
                width: Math.max(1000, Math.round(mmW * 1000)),
                height: Math.max(1000, Math.round(mmH * 1000))
              },
              ...(deviceName ? { deviceName } : {})
            };

            return await new Promise((resolve) => {
              win.webContents.print(printOptions, (success, failureReason) => {
                resolve({ success, failureReason });
              });
            });
          };

          // 1) Try with resolved device name (best)
          // 2) Try with configured printerName (legacy)
          // 3) Try without specifying a device (uses OS default)
          const attempts = [
            { label: 'resolved', deviceName: resolvedDeviceName },
            { label: 'configured', deviceName: printerName },
            { label: 'default', deviceName: null }
          ];

          let lastFailure = null;
          for (const a of attempts) {
            if (a.label !== 'default' && (!a.deviceName || !String(a.deviceName).trim())) continue;
            const printed = await tryPrint({ deviceName: a.deviceName });
            if (printed.success) {
              return {
                success: true,
                message: `Barcode label sent to printer (html mode, ${a.label})`,
                printerName,
                deviceName: a.deviceName || null
              };
            }
            lastFailure = { where: a.label, reason: String(printed.failureReason || 'Print failed') };
          }

          console.warn('HTML label print failed:', lastFailure);
          if (labelPrintMode === 'html') {
            return {
              success: false,
              error: String(lastFailure?.reason || 'Print failed'),
              printerName,
              deviceName: resolvedDeviceName || null
            };
          }
          // auto mode: fall through to raw
        } finally {
          try { win.close(); } catch { /* ignore */ }
        }
      } catch (e) {
        if (labelPrintMode === 'html') {
          return { success: false, error: String(e?.message || e), printerName };
        }
        // auto mode: fall through to raw
      }
    }

    // ESC/POS formatting (works for most 80mm thermal receipt printers and many label-capable ESC/POS devices).
    // Note: Dedicated label printers may require ZPL/TSPL; this is a best-effort generic implementation.
    const ESC = '\x1B';
    const GS = '\x1D';

    const colsEnv = Number(process.env.LABEL_COLS);
    // 80mm ESC/POS printers are commonly 48 columns (Font A, 576 dots wide).
    // Keep an env override for other paper widths / font configs.
    const COLS = Number.isFinite(colsEnv) && colsEnv > 16 ? Math.floor(colsEnv) : 48;

    // ESC t n (select character code table)
    // Common choices:
    // - 16 = WPC1252
    // - 19 = PC858 (often includes €)
    const cpEnv = Number(process.env.LABEL_CODEPAGE);
    const CODEPAGE = Number.isFinite(cpEnv) ? Math.max(0, Math.min(255, Math.floor(cpEnv))) : 19;

    const safeLine = (s, max = COLS) => {
      const t = String(s || '').replace(/[\r\n\t\0]/g, ' ').trim();
      return t.length > max ? t.slice(0, max) : t;
    };

    const padCenter = (s, width = COLS) => {
      const t = String(s ?? '');
      if (t.length >= width) return t.slice(0, width);
      const left = Math.floor((width - t.length) / 2);
      const right = width - t.length - left;
      return ' '.repeat(left) + t + ' '.repeat(right);
    };

    const padLeft = (s, width = COLS) => {
      const t = String(s ?? '');
      return t.length >= width ? t.slice(0, width) : t + ' '.repeat(width - t.length);
    };

    const padRight = (s, width = COLS) => {
      const t = String(s ?? '');
      return t.length >= width ? t.slice(0, width) : ' '.repeat(width - t.length) + t;
    };

    // Note: We intentionally avoid absolute positioning for labels.
    // Many ESC/POS printers behave inconsistently when mixing barcodes + ESC $ positioning.

    // formatPrice defined above (shared with html mode)

    // Choose barcode type
    const isEAN13 = /^\d{13}$/.test(barcode);
    const isUPCA = /^\d{12}$/.test(barcode);
    const isEAN8 = /^\d{8}$/.test(barcode);

    // Many low-cost ESC/POS printers support GS k "Function A" (m=0..6) but
    // NOT the newer "Function B" (m=65..73). If bars don't print, this is
    // usually the reason.
    const forceFunctionB = String(process.env.LABEL_BARCODE_FORCE_FUNCTION_B || '').trim() === '1';
    const forceFunctionA = String(process.env.LABEL_BARCODE_FORCE_FUNCTION_A || '').trim() === '1';

    const barcodeType = isEAN13 ? 'EAN13' : (isUPCA ? 'UPCA' : (isEAN8 ? 'EAN8' : 'CODE39'));

    // Function A modes:
    // 0 = UPC-A, 2 = EAN13, 3 = EAN8, 4 = CODE39
    const modeA = (barcodeType === 'EAN13') ? 2
      : ((barcodeType === 'UPCA') ? 0
      : ((barcodeType === 'EAN8') ? 3
      : ((barcodeType === 'CODE39') ? 4 : null)));

    // Function B modes:
    // 65 = UPC-A, 67 = EAN13, 68 = EAN8, 73 = CODE128
    // (We don't rely on CODE128 by default; some printers ignore it.)
    const modeB = (barcodeType === 'EAN13') ? 67 : ((barcodeType === 'UPCA') ? 65 : ((barcodeType === 'EAN8') ? 68 : 73));

    const getBarcodeDataForModeB = (mode) => {
      // Compatibility-first: send full digits for EAN/UPC.
      if (mode === 67 && /^\d{13}$/.test(barcode)) return barcode; // EAN13
      if (mode === 65 && /^\d{12}$/.test(barcode)) return barcode; // UPC-A
      if (mode === 68 && /^\d{8}$/.test(barcode)) return barcode;  // EAN8
      if (mode === 73) return '{B' + barcode; // CODE128 subset B
      return barcode;
    };

    const toCode39 = (raw) => {
      // CODE39 supports: A-Z 0-9 space - . $ / + %
      // Our internal barcodes are like POS-xxxxx-xxxxx; normalize to uppercase.
      const upper = String(raw || '').toUpperCase();
      // Replace unsupported chars with '-' (safe and readable)
      return upper.replace(/[^A-Z0-9 \-\.\$\/\+%]/g, '-');
    };

    let label = '';
    label += ESC + '@';
    // Cancel Chinese (GB18030) mode — JP-80M ships with it on, which garbles € and accents.
    label += '\x1C.';
    // Try to enable a code table that supports the Euro symbol.
    label += ESC + 't' + String.fromCharCode(CODEPAGE);

    const rawLayoutRaw = String(payload.labelLayout || process.env.LABEL_LAYOUT || 'compact').toLowerCase();
    const rawLayout = rawLayoutRaw.replace(/[_\s]/g, '-');

    if (rawLayout === 'centered') {
      // Centered layout:
      // 1) Product name (big)
      // 2) Price (big)
      // 3) Barcode (big)
      label += ESC + 'a' + String.fromCharCode(1); // center

      // Product name
      label += ESC + 'E' + String.fromCharCode(1);
      label += ESC + '!' + String.fromCharCode(0x10); // double height
      label += safeLine(name.toUpperCase(), COLS) + '\n';
      label += ESC + '!' + String.fromCharCode(0x00);
      label += ESC + 'E' + String.fromCharCode(0);

      // Price
      if (hasPrice) {
        label += ESC + 'E' + String.fromCharCode(1);
        label += ESC + 'G' + String.fromCharCode(1);
        label += ESC + '!' + String.fromCharCode(0x10); // double height
        label += safeLine(`P.V.P. ${formatPrice(priceNum)}`, COLS) + '\n';
        label += ESC + '!' + String.fromCharCode(0x00);
        label += ESC + 'G' + String.fromCharCode(0);
        label += ESC + 'E' + String.fromCharCode(0);
      }

      // Barcode (big)
      const hEnv = Number(process.env.LABEL_BARCODE_HEIGHT);
      const wEnv = Number(process.env.LABEL_BARCODE_WIDTH);
      const barcodeHeight = Number.isFinite(hEnv) && hEnv >= 40 && hEnv <= 120 ? Math.floor(hEnv) : 80;
      const barcodeWidth = Number.isFinite(wEnv) && wEnv >= 2 && wEnv <= 4 ? Math.floor(wEnv) : 3;

      label += ESC + 'a' + String.fromCharCode(1); // center
      label += GS + 'H' + String.fromCharCode(2); // HRI below
      label += GS + 'f' + String.fromCharCode(0); // HRI font A
      label += GS + 'h' + String.fromCharCode(barcodeHeight);
      label += GS + 'w' + String.fromCharCode(barcodeWidth);
      {
        const shouldUseA = !forceFunctionB && (forceFunctionA || modeA !== null);

        if (shouldUseA && modeA !== null) {
          const dataA = (modeA === 4) ? toCode39(barcode) : barcode;
          label += GS + 'k' + String.fromCharCode(modeA) + dataA + '\x00';
        } else {
          const data = getBarcodeDataForModeB(modeB);
          label += GS + 'k' + String.fromCharCode(modeB) + String.fromCharCode(data.length) + data;
        }
      }

      label += '\n';
      label += ESC + 'a' + String.fromCharCode(0);
    } else if (rawLayout === 'pvp-right' || rawLayout === 'pvpright') {
      // Layout like sample 2:
      // - Name centered
      // - Barcode centered with digits below
      // - P.V.P. + big price right-aligned at the bottom
      label += ESC + 'a' + String.fromCharCode(1); // center

      // Name
      label += ESC + 'E' + String.fromCharCode(1);
      label += ESC + '!' + String.fromCharCode(0x10); // double height
      label += safeLine(name.toUpperCase(), COLS) + '\n';
      label += ESC + '!' + String.fromCharCode(0x00);
      label += ESC + 'E' + String.fromCharCode(0);

      // Barcode (center + HRI below)
      const hEnv = Number(process.env.LABEL_BARCODE_HEIGHT);
      const wEnv = Number(process.env.LABEL_BARCODE_WIDTH);
      const barcodeHeight = Number.isFinite(hEnv) && hEnv >= 40 && hEnv <= 120 ? Math.floor(hEnv) : 76;
      const barcodeWidth = Number.isFinite(wEnv) && wEnv >= 2 && wEnv <= 4 ? Math.floor(wEnv) : 2;

      label += ESC + 'a' + String.fromCharCode(1);
      label += GS + 'H' + String.fromCharCode(2); // HRI below
      label += GS + 'f' + String.fromCharCode(0); // HRI font A
      label += GS + 'h' + String.fromCharCode(barcodeHeight);
      label += GS + 'w' + String.fromCharCode(barcodeWidth);
      {
        const shouldUseA = !forceFunctionB && (forceFunctionA || modeA !== null);
        if (shouldUseA && modeA !== null) {
          const dataA = (modeA === 4) ? toCode39(barcode) : barcode;
          label += GS + 'k' + String.fromCharCode(modeA) + dataA + '\x00';
        } else {
          const data = getBarcodeDataForModeB(modeB);
          label += GS + 'k' + String.fromCharCode(modeB) + String.fromCharCode(data.length) + data;
        }
      }
      label += '\n';

      // P.V.P. + price (right, big)
      if (hasPrice) {
        label += ESC + 'a' + String.fromCharCode(2); // right
        label += 'P.V.P.' + '\n';
        label += ESC + 'E' + String.fromCharCode(1);
        label += ESC + 'G' + String.fromCharCode(1);
        label += ESC + '!' + String.fromCharCode(0x30); // double width + height
        label += formatPrice(priceNum) + '\n';
        label += ESC + '!' + String.fromCharCode(0x00);
        label += ESC + 'G' + String.fromCharCode(0);
        label += ESC + 'E' + String.fromCharCode(0);
        label += ESC + 'a' + String.fromCharCode(0);
      }
    } else {
      // Layout (compact, like sample 1):
      // - Name top-left
      // - Barcode on its own line
      // - Price defaults to printing BESIDE the barcode (right side gap),
      //   can be forced BELOW via LABEL_PRICE_LAYOUT=below
      label += ESC + 'a' + String.fromCharCode(0); // left
      // Bigger + bold product name
      label += ESC + 'E' + String.fromCharCode(1); // emphasized
      label += ESC + '!' + String.fromCharCode(0x10); // double height
      label += safeLine(name.toUpperCase(), COLS) + '\n';
      label += ESC + '!' + String.fromCharCode(0x00);
      label += ESC + 'E' + String.fromCharCode(0);

      const priceLayout = String(process.env.LABEL_PRICE_LAYOUT || 'beside').toLowerCase();
      // "beside" is implemented in a printer-friendly way:
      // we print the barcode bars, then on the next line print BARCODE (left) and P.V.P.+PRICE (right).
      // This avoids unreliable attempts to print text in the same physical line as the barcode graphic.
      const printPriceBesideBarcode = hasPrice && priceLayout !== 'below';

      // Barcode (own line). Height/width can be overridden via env vars.
      const hEnv = Number(process.env.LABEL_BARCODE_HEIGHT);
      const wEnv = Number(process.env.LABEL_BARCODE_WIDTH);
      const barcodeHeight = Number.isFinite(hEnv) && hEnv >= 40 && hEnv <= 120 ? Math.floor(hEnv) : 72;
      const barcodeWidth = Number.isFinite(wEnv) && wEnv >= 2 && wEnv <= 4 ? Math.floor(wEnv) : 2;

      label += ESC + 'a' + String.fromCharCode(0); // left
      // HRI (barcode text) below tends to increase label height.
      // For the side-price layout, we print our own barcode text on the next line.
      label += GS + 'H' + String.fromCharCode(printPriceBesideBarcode ? 0 : 2); // HRI off (side) / below (legacy)
      label += GS + 'f' + String.fromCharCode(0); // HRI font A
      label += GS + 'h' + String.fromCharCode(barcodeHeight);
      label += GS + 'w' + String.fromCharCode(barcodeWidth);
      {
        const shouldUseA = !forceFunctionB && (forceFunctionA || modeA !== null);

        if (shouldUseA && modeA !== null) {
          // Function A: GS k m d1..dk NUL
          // Widely supported across ESC/POS printers.
          const dataA = (modeA === 4) ? toCode39(barcode) : barcode;
          label += GS + 'k' + String.fromCharCode(modeA) + dataA + '\x00';
        } else {
          // Function B: GS k m n d1..dn
          const data = getBarcodeDataForModeB(modeB);
          label += GS + 'k' + String.fromCharCode(modeB) + String.fromCharCode(data.length) + data;
        }
      }

      if (printPriceBesideBarcode) {
        // End the barcode line first.
        label += '\n';

        // Then print BARCODE (left) + P.V.P. PRICE (right) on the same line.
        // This is much more consistent across ESC/POS printers than attempting to
        // print text in the same physical line as the barcode graphic.
        const humanBarcode = safeLine((modeA === 4) ? toCode39(barcode) : barcode, COLS);
        const priceText = safeLine(`P.V.P. ${formatPrice(priceNum)}`, COLS);
        const leftWidth = Math.max(1, COLS - priceText.length);
        label += padLeft(humanBarcode, leftWidth) + priceText + '\n';
        label += ESC + 'a' + String.fromCharCode(0);
      } else {
        // Legacy layout: end the barcode line first.
        label += '\n';

        if (hasPrice) {
          // P.V.P. (right)
          label += ESC + 'a' + String.fromCharCode(2);
          label += 'P.V.P.' + '\n';

          // Price (right, BIG + BOLD)
          label += ESC + 'E' + String.fromCharCode(1); // emphasized (bold)
          // Double-strike (darker/bolder) – supported by many ESC/POS printers
          label += ESC + 'G' + String.fromCharCode(1);
          label += ESC + '!' + String.fromCharCode(0x30); // double width + height
          label += formatPrice(priceNum) + '\n';
          label += ESC + '!' + String.fromCharCode(0x00);
          label += ESC + 'G' + String.fromCharCode(0);
          label += ESC + 'E' + String.fromCharCode(0);
          label += ESC + 'a' + String.fromCharCode(0);
        }
      }
    }

    // Feed and cut
    label += '\n\n';
    label += GS + 'V' + String.fromCharCode(65) + String.fromCharCode(2);

    const tempFile = path.join(app.getPath('temp'), 'barcode_' + Date.now() + '.txt');
    const buf = safeEncode(label);
    fs.writeFileSync(tempFile, buf);

    try {
      if (process.platform === 'win32') {
        await sendRawFileToPrinterWindows(printerName, tempFile);
      } else {
        await execPromise(`lp -d "${printerName}" -o raw "${tempFile}"`);
      }
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* ignore */ }
      return { success: true, message: 'Barcode label sent to printer', printerName };
    } catch (printError) {
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* ignore */ }
      return { success: false, error: String(printError?.message || printError), printerName };
    }
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

ipcMain.handle('zreport:getSalesByDateTimeRange', async (event, startDateTime, endDateTime, cashierId) => {
  return db.getSalesByDateTimeRange(startDateTime, endDateTime, cashierId);
});

ipcMain.handle('zreport:getReturnsByDateRange', async (event, startDate, endDate, cashierId) => {
  return db.getReturnsByDateRange(startDate, endDate, cashierId);
});

ipcMain.handle('zreport:getReturnsByDateTimeRange', async (event, startDateTime, endDateTime, cashierId) => {
  return db.getReturnsByDateTimeRange(startDateTime, endDateTime, cashierId);
});

ipcMain.handle('zreport:getLoanPaymentsByDateRange', async (event, startDate, endDate, cashierId) => {
  return db.getLoanPaymentsByDateRange(startDate, endDate, cashierId);
});

ipcMain.handle('zreport:getLoanPaymentsByDateTimeRange', async (event, startDateTime, endDateTime, cashierId) => {
  return db.getLoanPaymentsByDateTimeRange(startDateTime, endDateTime, cashierId);
});

ipcMain.handle('zreport:getLoanPaymentsDetailedByDateTimeRange', async (event, startDateTime, endDateTime, cashierId) => {
  return db.getLoanPaymentsDetailedByDateTimeRange(startDateTime, endDateTime, cashierId);
});

ipcMain.handle('zreport:getMonthlySalesActualTotals', async () => {
  return db.getMonthlySalesActualTotals();
});

ipcMain.handle('zreport:getMoneyRows', async (event, startDateTime, endDateTime) => {
  return db.getZReportMoneyRows(startDateTime, endDateTime);
});

ipcMain.handle('zreport:getDailySalesActualTotals', async (event, yearMonth) => {
  return db.getDailySalesActualTotals(yearMonth);
});

// System Settings handlers
ipcMain.handle('settings:get', async () => {
  return db.getSystemSettings();
});

ipcMain.handle('settings:update', async (event, settings) => {
  const updated = db.updateSystemSettings(settings);
  try {
    const p = (settings?.customerDisplayPort || settings?.customer_display_port || '').toString().trim().toUpperCase();
    if (p) {
      process.env.CUSTOMER_DISPLAY_PORT = p;
    }
  } catch {
    // ignore
  }
  return updated;
});

ipcMain.handle('settings:setDeveloperPin', async (event, pin) => {
  return db.setDeveloperPin(pin);
});

// Database backup/restore (offline safe)
ipcMain.handle('db:backup', async () => {
  try {
    const defaultName = `pos_database_backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
    const dbPath = getDatabasePath();

    const save = await dialog.showSaveDialog(mainWindow, {
      title: 'Backup Database',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [
        { name: 'SQLite Database', extensions: ['db'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (save.canceled || !save.filePath) {
      return { success: false, canceled: true };
    }

    // Prefer live SQLite backup when available
    if (db && typeof db.backupTo === 'function') {
      await db.backupTo(save.filePath);
    } else {
      fs.copyFileSync(dbPath, save.filePath);
    }

    return { success: true, path: save.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:restore', async () => {
  try {
    const open = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore Database Backup',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite Database', extensions: ['db'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (open.canceled || !open.filePaths?.length) {
      return { success: false, canceled: true };
    }

    const selectedPath = open.filePaths[0];
    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Restore'],
      defaultId: 1,
      cancelId: 0,
      title: 'Restore Database',
      message: 'Restoring will replace the current database. The app will restart after restore. Continue?'
    });

    if (confirm.response !== 1) {
      return { success: false, canceled: true };
    }

    const dbPath = getDatabasePath();

    // Close DB before replacing
    try { db?.close?.(); } catch { /* ignore */ }

    // Replace DB file
    fs.copyFileSync(selectedPath, dbPath);

    // Clean up WAL/SHM if present
    try { fs.rmSync(dbPath + '-wal', { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(dbPath + '-shm', { force: true }); } catch { /* ignore */ }

    // Relaunch to re-open with restored DB
    app.relaunch();
    app.exit(0);

    return { success: true, restored: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Clear transactional test data (keeps products/users/settings)
ipcMain.handle('db:clearTestData', async () => {
  try {
    if (!db || typeof db.clearTestData !== 'function') {
      return { success: false, error: 'Clear test data is not available in this build.' };
    }
    return db.clearTestData();
  } catch (error) {
    return { success: false, error: error.message };
  }
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
  if (!SCALE_ENABLED) return [];
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
// On-screen scale diagnosis (Settings → Test scale) for touch-only PCs: reports the
// app's scale state and the raw bytes every COM port sends, so the scale format and
// port conflicts can be read from a photo of the screen.
ipcMain.handle('scale:diagnose', async () => {
  const lines = [];
  const log = (t) => lines.push(String(t));
  const showBytes = (buf) => buf.toString('latin1').replace(/[\x00-\x1F\x7F-\xFF]/g, (c) => `<${c.charCodeAt(0).toString(16).padStart(2, '0')}>`);

  log(`POS v${app.getVersion()}   ${new Date().toLocaleString('es-ES')}`);
  if (!SerialPort) {
    log(`SerialPort module NOT loaded: ${serialPortLoadError ? serialPortLoadError.message : '?'}`);
    return { success: false, text: lines.join('\n') };
  }

  const ageS = scaleState.lastUpdatedAt ? ((Date.now() - scaleState.lastUpdatedAt) / 1000).toFixed(1) : '-';
  log(`Scale: port=${scaleState.portPath || '-'} open=${!!(scalePort && scalePort.isOpen)} cfg=${JSON.stringify(scaleState.config || {})}`);
  log(`       last weight=${scaleState.lastWeightKg ?? '-'} kg (${ageS}s ago) error=${scaleState.lastError || '-'}`);
  log(`Display: mode=${getCustomerDisplayMode()} connected=${!!customerDisplay?.isConnected} port=${customerDisplay?.port?.path || '-'} exclude=${process.env.CUSTOMER_DISPLAY_EXCLUDE_PORTS || '-'}`);
  log(`Printer: ${db?.getSystemSettings?.()?.printer_name || '-'}  COM ports used by printer: ${(await getPrinterComPorts()).join(',') || 'none'}`);
  log(`SCALE_PORT=${process.env.SCALE_PORT || '-'}`);

  const ports = await SerialPort.list();
  log('');
  log(`COM ports (${ports.length}):`);
  for (const p of ports) log(`  ${p.path}  ${p.manufacturer || '?'}  vid=${p.vendorId || '-'} pid=${p.productId || '-'}`);

  // Release the scale port during the test and stop auto-connect from grabbing it.
  isConnecting = true;
  try {
    if (scalePort) await closeScalePort(scalePort);
  } catch { /* ignore */ }
  scalePort = null;
  scaleParser = null;

  const configs = [
    { baudRate: 9600, dataBits: 8, parity: 'none' },
    { baudRate: 4800, dataBits: 8, parity: 'none' },
    { baudRate: 2400, dataBits: 8, parity: 'none' },
    { baudRate: 19200, dataBits: 8, parity: 'none' },
    { baudRate: 9600, dataBits: 7, parity: 'even' }
  ];
  const polls = [
    ['$', Buffer.from('$')],
    ['EOT ENQ', Buffer.from([0x04, 0x05])],
    ['ENQ', Buffer.from([0x05])],
    ['P', Buffer.from('P\r\n')],
    ['W', Buffer.from('W\r\n')]
  ];
  // A lone ACK/NAK is only a handshake, not a weight: keep trying other commands.
  const hasRealData = (chunks) => Buffer.concat(chunks).some((b) => b !== 0x06 && b !== 0x15);

  try {
    for (const p of ports) {
      log('');
      const normPath = (x) => String(x || '').replace(/^\\\\\.\\/, '').toLowerCase();
      if (customerDisplay?.port?.path && normPath(customerDisplay.port.path) === normPath(p.path)) {
        log(`${p.path}: was held by CUSTOMER DISPLAY - released for the scale`);
        excludePortFromCustomerDisplay(p.path);
        try { await customerDisplay.disconnect(); } catch { /* ignore */ }
        await sleep(300);
      }
      for (const cfg of configs) {
        const label = `${p.path} ${cfg.baudRate} ${cfg.dataBits}${cfg.parity[0].toUpperCase()}1`;
        let port;
        try {
          port = new SerialPort({ path: p.path, baudRate: cfg.baudRate, dataBits: cfg.dataBits, parity: cfg.parity, stopBits: 1, autoOpen: false });
          await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
        } catch (e) {
          log(`${label}: CANNOT OPEN - ${e.message}`);
          break;
        }

        const chunks = [];
        port.on('data', (d) => chunks.push(Buffer.from(d)));
        try { port.set({ dtr: true, rts: true }, () => {}); } catch { /* ignore */ }

        await sleep(1500);
        let mode = 'by itself';
        if (chunks.length === 0) {
          const replies = [];
          for (const [name, bytes] of polls) {
            const before = chunks.length;
            try { port.write(bytes); } catch { /* ignore */ }
            await sleep(400);
            if (chunks.length > before) {
              replies.push(name);
              if (hasRealData(chunks.slice(before))) { mode = `after ${name}`; break; }
            }
          }
          if (mode === 'by itself') mode = replies.length ? `only ACK/NAK to ${replies.join(', ')}` : 'by itself';
        }
        await closeScalePort(port);

        const data = Buffer.concat(chunks);
        if (data.length === 0) {
          log(`${label}: silent`);
          continue;
        }
        const { weight } = parseLatestScaleWeight(data.toString('latin1'));
        log(`${label}: ${data.length} bytes ${mode} -> parsed ${weight ?? 'none'} kg`);
        log(`  ${showBytes(data.subarray(-120))}`);
        // Mostly printable data means the speed is right; no need to try the others.
        const printable = data.toString('latin1').replace(/[^\x20-\x7E\r\n]/g, '').length;
        if (printable >= data.length * 0.7) break;
      }
    }
  } finally {
    isConnecting = false;
    lastScaleAutoScanAt = 0;
    lastScaleAutoScanResult = null;
  }

  const text = lines.join('\n');
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'scale-test.txt'), text); } catch { /* ignore */ }
  return { success: true, text };
});

ipcMain.handle('scale:moduleStatus', async () => {
  return {
    scaleEnabled: SCALE_ENABLED,
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
  if (!SCALE_ENABLED) {
    return { success: false, message: 'Scale is disabled in this barcode-only build (unset SCALE_ENABLED=0 to enable).' };
  }
  if (!SerialPort) {
    throw new Error('SerialPort module not available. Scale features are disabled.');
  }
  try {
    if (scalePort && scalePort.isOpen) {
      scalePort.close();
    }

    const opened = await openScalePort(portPath, { baudRate: 57600, dataBits: 8, stopBits: 1, parity: 'none', lock: false });
    scalePort = opened.port;
    scaleParser = opened.parser;

    scaleState.portPath = portPath;
    excludePortFromCustomerDisplay(portPath);
    scaleState.config = { baudRate: 57600, dataBits: 8, stopBits: 1, parity: 'none' };
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
  if (!SCALE_ENABLED) {
    return { success: false, message: 'Scale is disabled (barcode-only mode).' };
  }
  // If we recently received streaming data, return immediately.
  if (scalePort && scalePort.isOpen && typeof scaleState.lastWeightKg === 'number') {
    const ageMs = Date.now() - (scaleState.lastUpdatedAt || 0);
    if (ageMs >= 0 && ageMs <= (scaleState.workingPoll ? 250 : 1500)) {
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
      const exclude = await getScaleExcludePorts(ports);
      const rankedPorts = rankScalePorts(ports, { excludePaths: exclude });
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
              excludePortFromCustomerDisplay(scalePortPath);
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
        const noPortsMsg = `No scale found. Total ports detected: ${ports.length}. ${ports.length > 0 ? `Ports found: ${allPortsInfo}` : 'No COM ports detected - check USB connection and driver installation.'}${exclude.length ? ` Skipped (printer/display): ${exclude.join(', ')}` : ''}`;
        
        // Last resort: Try COM8 directly (common ZFOC scale port)
        if (ports.some(p => p.path === 'COM8' || p.path === '\\\\.\\COM8')) {
          console.log('[Scale] Last resort: Trying COM8 directly...');
          try {
            const opened = await openScalePort('COM8', { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', lock: false });
            scalePort = opened.port;
            scaleParser = opened.parser;
            scaleState.portPath = 'COM8';
            excludePortFromCustomerDisplay('COM8');
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
    if (!SCALE_ENABLED) {
      // No-op cleanup for barcode-only mode.
      scalePort = null;
      scaleParser = null;
      scaleState.portPath = null;
      scaleState.config = null;
      scaleState.lastWeightKg = null;
      scaleState.lastRawText = '';
      scaleState.lastUpdatedAt = 0;
      scaleState.lastError = null;
      return { success: true };
    }
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

// ============== CUSTOMER DISPLAY HANDLERS ==============

// Initialize customer display
async function initializeCustomerDisplay() {
  if (!isVfdCustomerDisplayEnabled()) {
    return false;
  }
  // Never probe a COM port the receipt printer is using.
  try { await getPrinterComPorts(); } catch { /* ignore */ }
  if (!customerDisplay) {
    customerDisplay = new CustomerDisplay();
  }

  customerDisplayLastInitAttemptAt = Date.now();

  let success = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      success = await customerDisplay.initialize();
      if (success) {
        console.log('[CustomerDisplay] PREMIER CD-220 U connected and ready');
        break;
      } else {
        console.log(`[CustomerDisplay] Attempt ${attempt + 1} failed, retrying...`);
        await new Promise(res => setTimeout(res, 2000));
      }
    } catch (error) {
      console.error(`[CustomerDisplay] Initialization error (attempt ${attempt + 1}):`, error);
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  if (!success) {
    console.log('[CustomerDisplay] Failed to initialize customer display after retries');
  }
  return success;
}

async function ensureCustomerDisplayConnected(force = false) {
  if (!isVfdCustomerDisplayEnabled()) {
    return false;
  }
  if (!customerDisplay) {
    customerDisplay = new CustomerDisplay();
    customerDisplay.onPreviewLines = (payload) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('customerDisplay:previewLines', payload);
        }
      } catch { /* ignore */ }
    };
  }

  // If already connected, return immediately.
  if (customerDisplay.isDisplayConnected && customerDisplay.isDisplayConnected()) {
    return true;
  }

  // Not connected — attempt reconnect.
  // Apply a short cooldown to avoid hammering SerialPort.list() on every
  // rapid IPC call (e.g. multiple items scanned quickly), but only when
  // a recent attempt was made in the last 500ms.
  const now = Date.now();
  const msSinceLastAttempt = now - customerDisplayLastInitAttemptAt;
  if (!force && customerDisplayLastInitAttemptAt > 0 && msSinceLastAttempt < CUSTOMER_DISPLAY_INIT_COOLDOWN_MS) {
    console.log(`[CustomerDisplay] Reconnect cooldown active (${msSinceLastAttempt}ms < ${CUSTOMER_DISPLAY_INIT_COOLDOWN_MS}ms), skipping`);
    return false;
  }

  console.log('[CustomerDisplay] Not connected — attempting reconnect...');
  customerDisplayLastInitAttemptAt = now;
  try {
    return await initializeCustomerDisplay();
  } catch (err) {
    console.error('[CustomerDisplay] Reconnect failed:', err.message);
    return false;
  }
}

// Customer display IPC handlers
ipcMain.handle('customerDisplay:initialize', async () => {
  try {
    if (!isVfdCustomerDisplayEnabled()) {
      return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
    }
    customerDisplayLastInitAttemptAt = Date.now();
    const success = await initializeCustomerDisplay();
    return { success, message: success ? 'Customer display initialized' : 'Failed to initialize customer display' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:showWelcome', async () => {
  try {
    // Always compute+push preview to UI overlay (even without hardware).
    if (!customerDisplay) {
      customerDisplay = new CustomerDisplay();
      customerDisplay.onPreviewLines = (payload) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('customerDisplay:previewLines', payload);
          }
        } catch {
          // ignore
        }
      };
    }
    const preview = customerDisplay.formatWelcomeLines();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('customerDisplay:previewLines', { ...preview, maxChars: customerDisplay.displaySize?.chars || 20 });
    }

    if (!isVfdCustomerDisplayEnabled()) {
      return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
    }

    const connected = await ensureCustomerDisplayConnected();
    if (!connected) {
      return { success: false, message: 'Customer display not connected (preview shown)' };
    }

    await customerDisplay.showWelcomeMessage();
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:showItem', async (event, { itemName, price, currencySymbol, quantity = null, unitPrice = null, unit = null }) => {
  try {
    console.log(`[CustomerDisplay:showItem] called — item="${itemName}" price=${price} connected=${customerDisplay?.isConnected}`);
    // Always compute+push preview to UI overlay (even without hardware).
    if (!customerDisplay) {
      customerDisplay = new CustomerDisplay();
      customerDisplay.onPreviewLines = (payload) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('customerDisplay:previewLines', payload);
          }
        } catch {
          // ignore
        }
      };
    }
    const preview = customerDisplay.formatCurrentItemLines(itemName, price, currencySymbol, quantity, unitPrice, unit);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('customerDisplay:previewLines', { ...preview, maxChars: customerDisplay.displaySize?.chars || 20 });
    }

    if (!isVfdCustomerDisplayEnabled()) {
      return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
    }

    const connected = await ensureCustomerDisplayConnected();
    console.log(`[CustomerDisplay:showItem] ensureConnected=${connected}`);
    if (!connected) {
      console.warn('[CustomerDisplay:showItem] NOT connected — item will NOT show on hardware display');
      return { success: false, message: 'Customer display not connected (preview shown)' };
    }

    try {
      await customerDisplay.showCurrentItem(itemName, price, currencySymbol, quantity, unitPrice, unit);
      console.log(`[CustomerDisplay:showItem] sent to display OK`);
      return { success: true };
    } catch (sendErr) {
      // If the device dropped / driver hiccuped, try one quick reconnect+retry.
      console.warn('[CustomerDisplay:showItem] send failed, retrying once:', sendErr.message);
      try {
        if (customerDisplay && typeof customerDisplay.reconnectQuick === 'function') {
          await customerDisplay.reconnectQuick();
        } else if (customerDisplay) {
          await customerDisplay.disconnect().catch(() => {});
          await initializeCustomerDisplay();
        }
        await customerDisplay.showCurrentItem(itemName, price, currencySymbol, quantity, unitPrice, unit);
        console.log('[CustomerDisplay:showItem] retry succeeded');
        return { success: true, retried: true };
      } catch (retryErr) {
        console.error('[CustomerDisplay:showItem] retry failed:', retryErr.message);
        return { success: false, message: retryErr.message };
      }
    }
  } catch (error) {
    console.error('[CustomerDisplay:showItem] error:', error.message);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:showTotal', async (event, { total, currencySymbol }) => {
  try {
    // Always compute+push preview to UI overlay (even without hardware).
    if (!customerDisplay) {
      customerDisplay = new CustomerDisplay();
      customerDisplay.onPreviewLines = (payload) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('customerDisplay:previewLines', payload);
          }
        } catch {
          // ignore
        }
      };
    }
    const preview = customerDisplay.formatTotalLines(total, currencySymbol);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('customerDisplay:previewLines', { ...preview, maxChars: customerDisplay.displaySize?.chars || 20 });
    }

    if (!isVfdCustomerDisplayEnabled()) {
      return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
    }

    const connected = await ensureCustomerDisplayConnected();
    if (!connected) {
      return { success: false, message: 'Customer display not connected (preview shown)' };
    }

    await customerDisplay.showTotal(total, currencySymbol);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:showChange', async (event, { changeAmount, currencySymbol }) => {
  if (!isVfdCustomerDisplayEnabled()) {
    return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
  }
  const connected = await ensureCustomerDisplayConnected();
  if (!connected) {
    return { success: false, message: 'Customer display not connected' };
  }
  
  try {
    await customerDisplay.showChange(changeAmount, currencySymbol);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:showPaymentSummary', async (event, { total, paid, change, currencySymbol }) => {
  if (!isVfdCustomerDisplayEnabled()) {
    return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
  }
  const connected = await ensureCustomerDisplayConnected();
  if (!connected) {
    return { success: false, message: 'Customer display not connected' };
  }

  try {
    if (typeof customerDisplay.showPaymentSummary !== 'function') {
      return { success: false, message: 'Customer display firmware command not supported' };
    }
    await customerDisplay.showPaymentSummary(total, paid, change, currencySymbol);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:showPayment', async (event, { paymentMethod }) => {
  if (!isVfdCustomerDisplayEnabled()) {
    return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
  }
  const connected = await ensureCustomerDisplayConnected();
  if (!connected) {
    return { success: false, message: 'Customer display not connected' };
  }
  
  try {
    await customerDisplay.showPaymentProcessing(paymentMethod);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:showThankYou', async (event, { changeAmount, currencySymbol }) => {
  if (!isVfdCustomerDisplayEnabled()) {
    return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
  }
  const connected = await ensureCustomerDisplayConnected();
  if (!connected) {
    return { success: false, message: 'Customer display not connected' };
  }
  
  try {
    await customerDisplay.showThankYou(changeAmount, currencySymbol);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:clear', async () => {
  if (!isVfdCustomerDisplayEnabled()) {
    return { success: true, skipped: true, message: 'Hardware customer display disabled (monitor mode)' };
  }
  const connected = await ensureCustomerDisplayConnected();
  if (!connected) {
    return { success: false, message: 'Customer display not connected' };
  }
  
  try {
    await customerDisplay.clearDisplay();
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:getStatus', async () => {
  if (!customerDisplay) {
    return { 
      connected: false, 
      info: { 
        model: 'PREMIER CD-220 U', 
        lines: 2, 
        characters: 20, 
        connected: false,
        serialPortAvailable: false,
        troubleshooting: {
          suggestions: [
            'Make sure the customer display is plugged into a USB port',
            'Install required modules: npm install serialport',
            'Restart the application after connecting the display'
          ]
        }
      }
    };
  }
  
  return {
    connected: customerDisplay.isDisplayConnected(),
    info: customerDisplay.getDisplayInfo()
  };
});

ipcMain.handle('customerDisplay:getConnectionStatus', async () => {
  if (!customerDisplay) {
    return {
      connected: false,
      serialPortAvailable: false,
      availablePorts: [],
      error: 'Customer display not initialized'
    };
  }
  
  try {
    const status = await customerDisplay.getConnectionStatus();
    return {
      ...status,
      preferredPort: process.env.CUSTOMER_DISPLAY_PORT || null,
      excludedPorts: process.env.CUSTOMER_DISPLAY_EXCLUDE_PORTS || null
    };
  } catch (error) {
    return {
      connected: false,
      serialPortAvailable: false,
      availablePorts: [],
      error: error.message
    };
  }
});

// Touchscreen: set preferred COM port and reconnect
ipcMain.handle('customerDisplay:setPreferredPort', async (_event, { portPath }) => {
  try {
    const raw = portPath ? String(portPath).trim() : '';
    const p = raw.toUpperCase();

    // Allow clearing the preference (AUTO mode)
    if (!p) {
      db.setCustomerDisplayPort(null);
      delete process.env.CUSTOMER_DISPLAY_PORT;
      if (customerDisplay) {
        try { await customerDisplay.disconnect(); } catch { /* ignore */ }
      }
      const success = await initializeCustomerDisplay();
      return { success, message: success ? 'Customer display set to AUTO' : 'AUTO: Failed to connect' };
    }
    if (p && !/^COM\d+$/i.test(p)) {
      return { success: false, message: `Invalid port: ${raw}` };
    }

    // Verify port exists (best-effort) so we don't accidentally save COM1 etc.
    if (p && SerialPort) {
      try {
        const ports = await SerialPort.list();
        const exists = ports.some(x => String(x.path || '').toUpperCase() === p);
        if (!exists) {
          return { success: false, message: `Port not found: ${p}` };
        }
      } catch {
        // ignore verification failure
      }
    }

    db.setCustomerDisplayPort(p || null);
    if (p) process.env.CUSTOMER_DISPLAY_PORT = p;
    if (customerDisplay) {
      try { await customerDisplay.disconnect(); } catch { /* ignore */ }
    }
    const success = await initializeCustomerDisplay();
    return { success, message: success ? `Customer display set to ${p}` : `Failed to connect to ${p}` };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// Touchscreen: attempt to reset (disable/enable) the Windows device for the selected COM port.
// This fixes the common "Access denied" state without requiring a physical unplug/replug.
ipcMain.handle('customerDisplay:resetDevice', async () => {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Device reset is only supported on Windows' };
  }

  const preferred = (process.env.CUSTOMER_DISPLAY_PORT || '').toString().trim().toUpperCase();
  if (!preferred) {
    return { success: false, message: 'No preferred port set. Choose COM port first.' };
  }

  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);

  // PowerShell: find the Ports-class device whose FriendlyName contains "(COM12)", then disable+enable it.
  // NOTE: Disable/Enable usually requires Administrator privileges.
  const ps = `
$ErrorActionPreference = 'Stop'
$port = '${preferred}'
$dev = Get-PnpDevice -Class Ports | Where-Object { $_.FriendlyName -match '\\(' + $port + '\\)' } | Select-Object -First 1
if (-not $dev) { throw "No Ports device found for $port" }
Disable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false | Out-Null
Start-Sleep -Milliseconds 800
Enable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false | Out-Null
"RESET_OK: $($dev.FriendlyName)"
`;

  try {
    const { stdout } = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/\n/g, '; ').replace(/"/g, '\\"')}"`);
    // Give Windows some time to re-enumerate the COM port.
    await new Promise((r) => setTimeout(r, 1500));

    // Reconnect customer display
    try {
      if (customerDisplay) await customerDisplay.disconnect();
    } catch {
      // ignore
    }
    const ok = await initializeCustomerDisplay();
    return { success: ok, message: (stdout || '').toString().trim() || (ok ? 'Reset OK' : 'Reset done, connect failed') };
  } catch (e) {
    const msg = e?.message || String(e);
    // Typical failure: requires admin
    return { success: false, message: `Reset failed: ${msg}. Try running POS as Administrator.` };
  }
});

ipcMain.handle('customerDisplay:reconnect', async () => {
  try {
    if (customerDisplay) {
      await customerDisplay.disconnect();
    }
    const success = await initializeCustomerDisplay();
    return { 
      success, 
      message: success ? 'Customer display reconnected successfully' : 'Failed to reconnect customer display'
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('customerDisplay:disconnect', async () => {
  if (customerDisplay) {
    try {
      await customerDisplay.disconnect();
      return { success: true, message: 'Customer display disconnected' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
  return { success: true, message: 'No customer display to disconnect' };
});

// Initialize customer display when app starts
setTimeout(() => {
  initializeCustomerDisplay();
}, 2000); // Wait 2 seconds after app start

