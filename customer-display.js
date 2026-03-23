// Try to load serialport module, but don't crash if it fails
let SerialPort = null;
let serialPortLoadError = null;

try {
  SerialPort = require('serialport').SerialPort;
  console.log('[CustomerDisplay] SerialPort module loaded successfully');
} catch (error) {
  SerialPort = null;
  serialPortLoadError = error;
  console.warn('[CustomerDisplay] SerialPort not available. Customer display features will be disabled.', error.message);
}

class CustomerDisplay {
  constructor() {
    this.port = null;
    this.isConnected = false;
    this.displayModel = 'PREMIER CD-220 U';
    this.displaySize = { lines: 2, chars: 20 };
    this.serialPortAvailable = SerialPort !== null;

    // Dry-run mode: simulate a connected display and log what would be shown.
    // Useful for testing formatting when the physical customer display is not available.
    this.dryRun = ['1', 'true', 'yes', 'on'].includes(String(process.env.CUSTOMER_DISPLAY_DRY_RUN || '').toLowerCase());
    this._lastDryRunLines = null;

    // Cursor addressing differs across VFD models.
    // Many ESC/POS-style 20x2 customer displays use contiguous addresses:
    //   line1: 0x00..0x13, line2: 0x14..0x27
    // Some (HD44780-like) displays use:
    //   line1: 0x00..0x13, line2: 0x40..0x53
    // Allow override via env var (decimal or hex like 0x40).
    const envOffset = process.env.CUSTOMER_DISPLAY_LINE2_OFFSET;
    this._line2OffsetWasExplicitlySet = Boolean(envOffset);
    const parsedOffset = envOffset ? Number(envOffset) : NaN;
    const defaultOffset = (this.displayModel || '').toUpperCase().includes('CD-220') ? 0x14 : 0x40;
    this.cursorLine2Offset = Number.isFinite(parsedOffset) ? parsedOffset : defaultOffset;

    try {
      const src = this._line2OffsetWasExplicitlySet ? 'env' : 'auto';
      console.log(`[CustomerDisplay] Line2 cursor offset: 0x${this.cursorLine2Offset.toString(16)} (${src})`);
    } catch {
      // ignore
    }

    // Ensure display commands never interleave (renderer can trigger multiple updates quickly)
    this._writeQueue = Promise.resolve();

    // Ensure full-screen display updates (clear + both lines) never interleave.
    // This prevents mixed lines like "TOTAL:" from one update and an item name from another.
    this._displayQueue = Promise.resolve();

    // Flag set during _kickPort() to prevent the port 'close' event handler
    // from marking isConnected=false when we intentionally drop DTR.
    this._portKicking = false;

    // Remember the last successfully opened port so we can reconnect quickly
    // without rescanning all ports.
    this.lastPortPath = null;

    // Diagnostics (shown in the POS debug panel)
    this.lastPortError = null;
    this.lastPortErrorAt = null;
    this.lastPortCloseAt = null;
    this.lastWriteError = null;
    this.lastWriteErrorAt = null;

    // Prevent reconnect storms
    this._reconnectInFlight = null;
    this._lastReconnectAttemptAt = 0;
    this._reconnectCooldownMs = Number(process.env.CUSTOMER_DISPLAY_RECONNECT_COOLDOWN_MS || 1200);

    // Some VFDs drop the first character if we write too quickly after cursor commands.
    // Give the device a little more time by default.
    this.cursorSettleDelayMs = Number(process.env.CUSTOMER_DISPLAY_CURSOR_DELAY_MS || 35);
    this.writeSettleDelayMs = Number(process.env.CUSTOMER_DISPLAY_WRITE_DELAY_MS || 10);

    // Some PREMIER units intermittently miss the first character on a line.
    // Double-writing the same line is a simple, effective workaround.
    // Can be disabled by setting CUSTOMER_DISPLAY_DOUBLE_WRITE=0/false.
    const dw = String(process.env.CUSTOMER_DISPLAY_DOUBLE_WRITE || '').toLowerCase();
    this.doubleWrite = dw ? ['1', 'true', 'yes', 'on'].includes(dw) : true;

    // Older heuristic wrote line2 multiple times with different offsets to "try" to land correctly.
    // On real PREMIER displays this can cause random-looking corruption (overwrites/shift).
    // Keep it opt-in for troubleshooting only.
    // Some displays use a different DDRAM mapping (0x40). PREMIER CD-220 U should be 0x14.
    // Probing 0x40 on PREMIER can cause unstable output, so keep probing opt-in.
    this.tryMultipleLine2Offsets = ['1', 'true', 'yes', 'on'].includes(String(process.env.CUSTOMER_DISPLAY_TRY_OFFSETS || '').toLowerCase());

    // Safety: brute-forcing all ports can accidentally open the scale COM port.
    // Disable by default; opt-in with CUSTOMER_DISPLAY_TRY_ALL_PORTS=1.
    this.tryAllPortsIfNoMatch = ['1', 'true', 'yes', 'on'].includes(String(process.env.CUSTOMER_DISPLAY_TRY_ALL_PORTS || '').toLowerCase());

    // If the device drops the first byte after a cursor command, we can send a dummy NUL (0x00)
    // right after positioning the cursor. If a byte gets eaten, it will be the dummy, not the real text.
    // Can be disabled via CUSTOMER_DISPLAY_DUMMY_BYTE=0/false.
    const dummyRaw = String(process.env.CUSTOMER_DISPLAY_DUMMY_BYTE || '').toLowerCase();
    this.useDummyByteAfterCursor = dummyRaw ? ['1', 'true', 'yes', 'on'].includes(dummyRaw) : true;
  }

  formatCurrentItemLines(itemName, price, currencySymbol = '€', quantity = null, unitPrice = null, unit = null) {
    const safeName = this.sanitizeForDisplay(itemName) || 'ITEM';
    const safeTotal = this.normalizeAmount(price);
    const maxChars = this.displaySize?.chars || 20;

    const line1 = String(safeName).padEnd(maxChars, ' ').substring(0, maxChars);

    let line2 = '';
    const q = Number(quantity);
    const up = Number(unitPrice);
    if (Number.isFinite(q) && q > 0 && Number.isFinite(up) && up >= 0) {
      const qtyStr = this.formatQty(q, unit);
      const derivedUnitPrice = safeTotal / q;
      const displayUnitPrice = Number.isFinite(up) ? up : (Number.isFinite(derivedUnitPrice) ? derivedUnitPrice : 0);
      const unitPriceStr = this.formatMoney(displayUnitPrice);
      const absTotalStr = this.formatMoney(Math.abs(safeTotal));
      const totalStr = safeTotal < 0 ? `-${absTotalStr}` : absTotalStr;

      const u = (unit || '').toString().toLowerCase();
      const multiplySymbol = (u === 'kg' || u === 'g') ? '*' : 'x';
      line2 = `${qtyStr}${multiplySymbol}${unitPriceStr}=${totalStr}`;
    } else {
      line2 = `${this.formatMoney(safeTotal)}`;
      line2 = line2.padStart(maxChars, ' ');
    }

    const formattedLine2 = String(line2).padEnd(maxChars, ' ').substring(0, maxChars);
    return { line1, line2: formattedLine2 };
  }

  formatWelcomeLines() {
    const maxChars = this.displaySize?.chars || 20;
    const line1 = this.sanitizeForDisplay('WELCOME TO STORE').substring(0, maxChars).padEnd(maxChars, ' ');
    const line2 = this.sanitizeForDisplay('READY TO SERVE YOU').substring(0, maxChars).padEnd(maxChars, ' ');
    return { line1, line2 };
  }

  formatTotalLines(total, currencySymbol = '€') {
    const maxChars = this.displaySize?.chars || 20;
    const safeTotal = this.normalizeAmount(total);
    const line1 = this.sanitizeForDisplay('TOTAL:').padEnd(maxChars, ' ').substring(0, maxChars);
    const line2 = this.sanitizeForDisplay(`${safeTotal.toFixed(2)}`).padStart(maxChars, ' ').substring(0, maxChars);
    return { line1, line2 };
  }

  formatChangeLines(changeAmount, currencySymbol = '€') {
    const maxChars = this.displaySize?.chars || 20;
    const safeChange = this.normalizeAmount(changeAmount);
    const line1 = this.sanitizeForDisplay('CHANGE:').padEnd(maxChars, ' ').substring(0, maxChars);
    const line2 = this.sanitizeForDisplay(`${safeChange.toFixed(2)}`).padStart(maxChars, ' ').substring(0, maxChars);
    return { line1, line2 };
  }

  formatPaymentSummaryLines(total, paid, change, currencySymbol = '€') {
    const layout = this.getPaymentSummaryLayout();
    const maxChars = this.displaySize?.chars || 20;

    const t = this.formatMoney(total);
    const p = this.formatMoney(paid);
    const c = this.formatMoney(change);

    const line1 = this.formatColumns(layout.labels, layout.widths, layout.separator, 'left')
      .substring(0, maxChars)
      .padEnd(maxChars, ' ');
    const line2 = this.formatColumns([t, p, c], layout.widths, layout.separator, 'right')
      .substring(0, maxChars)
      .padEnd(maxChars, ' ');

    return { line1, line2 };
  }

  async _runExclusiveDisplayTask(taskFn) {
    const run = async () => await taskFn();
    this._displayQueue = this._displayQueue.then(run, run);
    return await this._displayQueue;
  }

  getPaymentSummaryLayout() {
    const chars = this.displaySize?.chars || 20;

    // For the common 2x20 VFD layout (like the photo):
    // Widths [6, 8, 6], no separator between = exactly 20 chars.
    // Line1: "TOTAL   ENTREGA CAMBIO" → "TOTAL   ENTREGA CAMBIO" (padded)
    // Line2: "297.64  300.00    2.36" — TOTAL gets 6 chars (fits up to 9999.99)
    if (chars === 20) {
      return {
        labels: ['TOTAL', 'ENTREGA', 'CAMBIO'],
        widths: [6, 8, 6],
        separator: ''
      };
    }

    // Generic fallback: evenly distributed columns.
    const columns = 3;
    const separators = columns - 1;
    const available = Math.max(0, chars - separators);
    const base = Math.floor(available / columns);
    const remainder = available - base * columns;
    const widths = new Array(columns).fill(base);
    for (let i = 0; i < remainder; i++) widths[i] += 1;
    return {
      labels: ['TOTAL', 'PAID', 'CHANGE'],
      widths,
      separator: ' '
    };
  }

  formatColumns(values, widths, separator = ' ', align = 'right') {
    const parts = [];
    for (let i = 0; i < widths.length; i++) {
      const w = Math.max(0, Number(widths[i]) || 0);
      let s = this.sanitizeForDisplay(values[i] ?? '');
      if (w > 0 && s.length > w) {
        // Keep the rightmost characters (important for amounts).
        s = s.slice(-w);
      }

      if (align === 'left') {
        s = w > 0 ? s.padEnd(w, ' ') : '';
      } else if (align === 'center') {
        if (w > 0) {
          const pad = Math.max(0, w - s.length);
          const left = Math.floor(pad / 2);
          const right = pad - left;
          s = ' '.repeat(left) + s + ' '.repeat(right);
        }
      } else {
        s = w > 0 ? s.padStart(w, ' ') : '';
      }
      parts.push(s);
    }

    return parts.join(separator);
  }

  normalizePortPath(portPath) {
    const p = this.normalizeText(portPath).trim();
    if (!p) return p;

    // On Windows, ports COM10+ often require the \\.\ prefix.
    if (process.platform === 'win32') {
      if (/^\\\\\.\\COM\d+$/i.test(p)) return p;
      const m = /^COM(\d+)$/i.exec(p);
      if (m) return `\\\\.\\COM${m[1]}`;
    }
    return p;
  }

  getPreferredPortFromEnv() {
    // Optional override: set CUSTOMER_DISPLAY_PORT to something like COM12 (Windows) or /dev/ttyUSB0
    const envPort = process.env.CUSTOMER_DISPLAY_PORT;
    if (!envPort) return null;
    return this.normalizePortPath(envPort);
  }

  getExcludedPortsFromEnv() {
    const raw = (process.env.CUSTOMER_DISPLAY_EXCLUDE_PORTS || '').toString().trim();
    if (!raw) return [];
    return raw
      .split(/[;,\s]+/)
      .map((p) => this.normalizePortPath(p))
      .filter(Boolean);
  }

  scorePortForDisplay(port) {
    const path = (port?.path || '').toString().toLowerCase();
    const manufacturer = (port?.manufacturer || '').toString().toLowerCase();
    const productId = (port?.productId || '').toString().toLowerCase();

    let score = 0;

    // Strong preference: Prolific PL2303 (commonly used in these VFDs)
    if (manufacturer.includes('prolific')) score += 100;
    if (productId === '2303') score += 100;

    // Other common USB-serial chipsets
    if (manufacturer.includes('ftdi') || productId === '6001') score += 60;
    if (manufacturer.includes('cp210') || manufacturer.includes('silicon') || productId === 'ea60') score += 50;
    if (manufacturer.includes('ch340') || productId === '7523') score += 30;

    // Path hints
    // Only treat COM ports as a hint on Windows (avoid matching macOS "Incoming").
    if (process.platform === 'win32' && (/^com\d+$/i.test(path) || /^\\\\\.\\com\d+$/i.test(path))) score += 10;
    if (path.includes('usb')) score += 5;

    return score;
  }

  normalizeText(value) {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  sanitizeForDisplay(text) {
    // Many customer displays do NOT support Unicode. Keep to printable ASCII.
    let s = this.normalizeText(text);

    // Common currency and symbols fallbacks
    s = s
      .replaceAll('€', 'EUR')
      .replaceAll('£', 'GBP')
      .replaceAll('¥', 'JPY');

    // Strip accents/diacritics (e.g., "Café" -> "Cafe")
    try {
      s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    } catch {
      // ignore if normalize isn't available
    }

    // Replace any remaining non-printable or non-ASCII with space
    // Keep range 0x20..0x7E
    s = s.replace(/[^\x20-\x7E]/g, ' ');
    return s;
  }

  sanitizeCurrencySymbol(currencySymbol) {
    const raw = this.normalizeText(currencySymbol).trim();
    if (!raw) return 'EUR';
    if (raw === '€') return 'EUR';
    // Keep short to avoid consuming display width
    const safe = this.sanitizeForDisplay(raw);
    return safe.substring(0, 3) || 'EUR';
  }

  normalizeAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  formatQty(value, unit) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const u = (unit || '').toString().toLowerCase();
    // Weight-based: show 3 decimals (e.g., 0.235)
    if (u === 'kg' || u === 'g') return n.toFixed(3);
    // Count-based: show up to 2 decimals, but trim trailing zeros
    const s = n.toFixed(2);
    return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  formatMoney(value) {
    const n = this.normalizeAmount(value);
    return n.toFixed(2);
  }

  // Initialize the customer display
  async initialize() {
    try {
      if (this.dryRun) {
        this.isConnected = true;
        console.log('[CustomerDisplay] Dry-run enabled (CUSTOMER_DISPLAY_DRY_RUN). No hardware will be used.');
        return true;
      }

      // Check if SerialPort module is available
      if (!this.serialPortAvailable) {
        console.error('[CustomerDisplay] SerialPort module not available:', serialPortLoadError?.message || 'Unknown error');
        console.log('[CustomerDisplay] To fix: npm install serialport');
        return false;
      }

      console.log('[CustomerDisplay] Searching for PREMIER CD-220 U display...');

      // If user provided an explicit port, try it first.
      const preferredPort = this.getPreferredPortFromEnv();
      if (preferredPort) {
        console.log(`[CustomerDisplay] CUSTOMER_DISPLAY_PORT is set, trying ${preferredPort} first...`);
        try {
          await this.connect(preferredPort);
          if (this.isConnected) {
            await this.initializeDisplaySettings();
            await this.showWelcomeMessage();
            console.log('[CustomerDisplay] Initialized via CUSTOMER_DISPLAY_PORT successfully');
            return true;
          }
        } catch (error) {
          console.warn(`[CustomerDisplay] Failed to connect via CUSTOMER_DISPLAY_PORT (${preferredPort}):`, error.message);
          // Continue below and try other candidate ports.
        }
      }
      
      // List all available ports
      const ports = await SerialPort.list();
      console.log(`[CustomerDisplay] Found ${ports.length} available ports`);

      // Exclusions (e.g. scale port) so we never grab it.
      const excluded = new Set(this.getExcludedPortsFromEnv().map((p) => String(p).toLowerCase()));
      
      // Rank ports so we try the most likely customer display first (avoids picking the scale, etc.)
      const rankedPorts = [...ports]
        .filter((p) => {
          const pathLower = String(p?.path || '').toLowerCase();
          if (!pathLower) return false;
          // Never try excluded ports
          if (excluded.size > 0 && excluded.has(pathLower)) return false;
          // Never try COM1/COM2 (commonly motherboard ports)
          if (process.platform === 'win32' && (/^com1$/i.test(p.path) || /^com2$/i.test(p.path))) return false;
          return true;
        })
        .sort((a, b) => this.scorePortForDisplay(b) - this.scorePortForDisplay(a));

      // Try likely candidates first. IMPORTANT: do not stop at the first "likely" port.
      // On Windows, the display COM port can be temporarily locked (Access denied),
      // or it can change after unplug/replug. We must try the next candidate.
      const scoredCandidates = rankedPorts
        .map((p) => ({ port: p, score: this.scorePortForDisplay(p) }))
        .sort((a, b) => b.score - a.score);

      // If we have any Prolific ports present, do NOT try CH340 for the customer display.
      // In your setup CH340 is the scale (COM10) and Prolific is the VFD (COM12).
      const hasProlific = scoredCandidates.some((x) => {
        const m = (x?.port?.manufacturer || '').toString().toLowerCase();
        const pid = (x?.port?.productId || '').toString().toLowerCase();
        return m.includes('prolific') || pid === '2303';
      });

      const filteredCandidates = hasProlific
        ? scoredCandidates.filter((x) => {
            const m = (x?.port?.manufacturer || '').toString().toLowerCase();
            const pid = (x?.port?.productId || '').toString().toLowerCase();
            // keep prolific + common alternatives, drop ch340 (usually the scale)
            if (m.includes('prolific') || pid === '2303') return true;
            if (m.includes('ftdi') || m.includes('cp210') || m.includes('silicon')) return true;
            if (m.includes('ch340') || pid === '7523') return false;
            return true;
          })
        : scoredCandidates;

      const likely = filteredCandidates.filter((x) => x.score > 0);
      const toTry = likely.length > 0 ? likely : (this.tryAllPortsIfNoMatch ? filteredCandidates : []);

      if (toTry.length === 0) {
        console.log('[CustomerDisplay] No likely customer display ports found. Set CUSTOMER_DISPLAY_PORT (e.g., COM12) to connect explicitly.');
        return false;
      }

      // Limit attempts for speed, but keep enough to handle COM changes.
      const maxAttempts = Math.min(toTry.length, 6);
      for (let i = 0; i < maxAttempts; i++) {
        const candidate = toTry[i]?.port;
        if (!candidate) continue;
        const p = this.normalizePortPath(candidate.path);
        console.log(`[CustomerDisplay] Trying candidate port: ${p} (score=${toTry[i].score})`);
        try {
          await this.connect(p);
          if (!this.isConnected) continue;
          await this.initializeDisplaySettings();
          await this.showWelcomeMessage();
          console.log(`[CustomerDisplay] Connected and initialized on: ${p}`);
          return true;
        } catch (error) {
          console.log(`[CustomerDisplay] Failed on ${p}: ${error.message}`);
          // Ensure we fully drop any half-open port before next attempt.
          try { await this.disconnect(); } catch { /* ignore */ }
        }
      }

      console.log('[CustomerDisplay] Failed to initialize customer display on all candidates');
      return false;
    } catch (error) {
      console.error('[CustomerDisplay] Initialization error:', error.message);
      console.log('[CustomerDisplay] Make sure the customer display is plugged into a USB port');
      return false;
    }
  }
  
  // Connect to the display port
  async connect(portPath) {
    try {
      if (!SerialPort) {
        throw new Error('SerialPort module not available');
      }

      // If we already have a port object, close it first.
      // Otherwise the same process may keep the handle open and the next open
      // attempt fails with "Access denied".
      try {
        if (this.port) {
          await this.disconnect();
        }
      } catch {
        // ignore
      }

      const normalizedPath = this.normalizePortPath(portPath);
      const plainPath = /^\\\\\.\\COM\d+$/i.test(normalizedPath) ? normalizedPath.replace(/^\\\\\.\\/i, '') : normalizedPath;
      const candidates = Array.from(new Set([normalizedPath, plainPath].filter(Boolean)));

      let lastErr = null;
      for (const candidatePath of candidates) {
        this.lastPortPath = candidatePath;

        // Retry a few times on transient Windows errors.
        const maxTries = 3;
        for (let attempt = 1; attempt <= maxTries; attempt++) {
          lastErr = null;
          try {
            this.port = new SerialPort({
              path: candidatePath,
        baudRate: 9600, // Standard baud rate for PREMIER displays
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        lock: false,
        autoOpen: false
            });

            await new Promise((resolve, reject) => {
              this.port.open((err) => {
                if (err) return reject(err);
                resolve();
              });
            });

            console.log(`[CustomerDisplay] Connected to ${candidatePath}`);
            this.isConnected = true;

            // Set up error handling
            this.port.on('error', (error) => {
              console.error('[CustomerDisplay] Port error:', error.message);
              this.isConnected = false;
              this.lastPortError = error.message;
              this.lastPortErrorAt = Date.now();

              // IMPORTANT: release the COM port immediately on error.
              // On Windows, leaving the handle open can make the next open fail
              // with "Access denied" until the USB device is replugged.
              try {
                if (this.port && this.port.isOpen) {
                  this.port.close(() => {});
                }
              } catch {
                // ignore
              }
              try {
                this.port = null;
              } catch {
                // ignore
              }
            });

            this.port.on('close', () => {
              if (this._portKicking) return;
              this.isConnected = false;
              this.lastPortCloseAt = Date.now();
              try { this.port = null; } catch { /* ignore */ }
              console.log('[CustomerDisplay] Port closed unexpectedly');
            });

            // Flush any stale bytes left in the buffer from a previous session
            try {
              if (typeof this.port.flush === 'function') {
                await new Promise((resolve) => this.port.flush(() => resolve()));
              }
            } catch {
              // ignore
            }

            return;
          } catch (err) {
            lastErr = err;
            const msg = err?.message || String(err);
            this.isConnected = false;
            this.lastPortError = msg;
            this.lastPortErrorAt = Date.now();
            try { if (this.port && this.port.isOpen) this.port.close(() => {}); } catch { /* ignore */ }
            try { this.port = null; } catch { /* ignore */ }

            // Retry only for common transient errors
            const lower = msg.toLowerCase();
            const retryable = lower.includes('access denied') || lower.includes('resource busy') || lower.includes('file not found');
            console.warn(`[CustomerDisplay] Open failed (${candidatePath}) attempt ${attempt}/${maxTries}: ${msg}`);
            if (!retryable || attempt === maxTries) break;
            await this.delay(400);
          }
        }
      }

      throw lastErr || new Error('Failed to open customer display port');
    } catch (error) {
      console.error('[CustomerDisplay] Connection error:', error);
      this.isConnected = false;
      this.lastPortError = error?.message || String(error);
      this.lastPortErrorAt = Date.now();
      throw error;
    }
  }

  async reconnectQuick() {
    if (this.dryRun) return true;
    if (!this.serialPortAvailable) return false;

    const portPath = this.lastPortPath;
    if (!portPath) {
      // No known last port — fall back to a full scan.
      try {
        return await this.initialize();
      } catch {
        return false;
      }
    }

    const now = Date.now();
    if ((now - this._lastReconnectAttemptAt) < this._reconnectCooldownMs) {
      return false;
    }

    if (this._reconnectInFlight) {
      try {
        return await this._reconnectInFlight;
      } catch {
        return false;
      }
    }

    this._lastReconnectAttemptAt = now;
    this._reconnectInFlight = (async () => {
      try {
        try {
          await this.disconnect();
        } catch {
          // ignore
        }
        await this.connect(portPath);
        if (!this.isConnected) return false;
        await this.initializeDisplaySettings();
        return true;
      } catch (e) {
        this.lastPortError = e?.message || String(e);
        this.lastPortErrorAt = Date.now();
        // If the last port is locked (Access denied) or changed, do a full scan.
        try {
          return await this.initialize();
        } catch {
          return false;
        }
      } finally {
        this._reconnectInFlight = null;
      }
    })();

    return await this._reconnectInFlight;
  }
  
  // Send command to display
  async sendCommand(command) {
    if (this.dryRun) return true;
    if (!this.isConnected || !this.port) {
      // Try a fast reconnect using the last known port.
      const reconnected = await this.reconnectQuick();
      if (!reconnected) {
        console.log('[CustomerDisplay] Display not connected');
        return false;
      }
    }
    
    try {
      const doWrite = () => new Promise((resolve) => {
        this.port.write(command, (err) => {
          if (err) {
            console.error('[CustomerDisplay] Write error:', err);
            this.lastWriteError = err.message || String(err);
            this.lastWriteErrorAt = Date.now();
            this.isConnected = false;

            // Release the COM handle immediately to avoid persistent "Access denied"
            // on subsequent reconnect attempts.
            try {
              if (this.port && this.port.isOpen) {
                this.port.close(() => {});
              }
            } catch {
              // ignore
            }
            try {
              this.port = null;
            } catch {
              // ignore
            }

            resolve(false);
            return;
          }

          // Ensure bytes are actually flushed to the device
          if (typeof this.port.drain === 'function') {
            this.port.drain((drainErr) => {
              if (drainErr) {
                console.error('[CustomerDisplay] Drain error:', drainErr);
                this.lastWriteError = drainErr.message || String(drainErr);
                this.lastWriteErrorAt = Date.now();
                this.isConnected = false;

                try {
                  if (this.port && this.port.isOpen) {
                    this.port.close(() => {});
                  }
                } catch {
                  // ignore
                }
                try {
                  this.port = null;
                } catch {
                  // ignore
                }

                resolve(false);
              } else {
                resolve(true);
              }
            });
          } else {
            resolve(true);
          }
        });
      });

      // Chain writes to prevent command interleaving
      this._writeQueue = this._writeQueue.then(doWrite, doWrite);
      return await this._writeQueue;
    } catch (error) {
      console.error('[CustomerDisplay] Send command error:', error);
      this.lastWriteError = error?.message || String(error);
      this.lastWriteErrorAt = Date.now();
      this.isConnected = false;
      return false;
    }
  }
  
  // Initialize display settings
  async initializeDisplaySettings() {
    // NOTE: We do NOT call _kickPort() here.
    // connect() already created the natural DTR LOW→HIGH rising edge that wakes
    // the VFD (previous session left DTR LOW; opening the port + asserting HIGH
    // is the wake signal). Calling _kickPort here would DROP DTR again, causing
    // the Windows Prolific driver to fire a spurious 'close' event that silently
    // breaks all subsequent writes (add-to-cart shows nothing).

    // Reset display
    const resetCmd = Buffer.from([0x1B, 0x40]); // ESC @ - Initialize display
    await this.sendCommand(resetCmd);
    await this.delay(200);
    
    // Set cursor to non-blinking
    const cursorOffCmd = Buffer.from([0x1B, 0x63, 0x00]); // ESC c 0 - Cursor off
    await this.sendCommand(cursorOffCmd);
    await this.delay(50);
    
    // Set display mode
    const displayOnCmd = Buffer.from([0x1B, 0x64, 0x01]); // ESC d 1 - Display on
    await this.sendCommand(displayOnCmd);
    await this.delay(50);
  }

  async _clearDisplayInternal() {
    if (this.dryRun) return;
    // Try multiple clear commands for better compatibility
    
    // Method 1: ESC C - Clear display (most common)
    const clearCmd = Buffer.from([0x1B, 0x43]); // ESC C
    await this.sendCommand(clearCmd);
    await this.delay(100);

    // Extra fallback: some devices ignore cursor positioning commands.
    // Write 2*width spaces sequentially from "home" to blank what is visible.
    const homeCmd = Buffer.from([0x1B, 0x48]); // ESC H - Home cursor
    await this.sendCommand(homeCmd);
    await this.delay(20);
    const spacesBlock = ' '.repeat(this.displaySize?.chars || 20).repeat(this.displaySize?.lines || 2);
    await this.sendCommand(Buffer.from(spacesBlock, 'ascii'));
    await this.delay(20);
    await this.sendCommand(homeCmd);
    await this.delay(20);
    
    // Method 2: Clear both lines manually with spaces
    const spaces = ' '.repeat(20);
    await this.setCursor(0, 0);
    await this.sendCommand(Buffer.from(spaces, 'ascii'));
    await this.setCursor(1, 0);
    await this.sendCommand(Buffer.from(spaces, 'ascii'));
    await this.delay(50);
    
    // Method 3: Home cursor
    await this.sendCommand(homeCmd);
    await this.delay(50);
  }

  // Clear the display
  async clearDisplay() {
    return await this._runExclusiveDisplayTask(async () => {
      await this._clearDisplayInternal();
    });
  }
  
  // Set cursor position (line 1: 0x00, line 2: configurable offset e.g. 0x14 or 0x40)
  async setCursor(line, column) {
    if (this.dryRun) return;
    const safeLine = line === 1 ? 1 : 0;
    const safeColumn = Math.max(0, Math.min(this.displaySize.chars - 1, Number(column) || 0));
    const position = safeLine === 0 ? safeColumn : (this.cursorLine2Offset + safeColumn);
    const cursorCmd = Buffer.from([0x1B, 0x6C, position]); // ESC l - Set cursor
    await this.sendCommand(cursorCmd);
    const d = Number(this.cursorSettleDelayMs);
    await this.delay(Number.isFinite(d) && d >= 0 ? d : 20);
  }
  
  // Write text to display (kept for internal _clearDisplayInternal compatibility)
  async writeText(text, line = 0, column = 0) {
    if (this.dryRun) return;
    // Unused cursor args kept for API compatibility; sequential write handles positioning.
    text = this.sanitizeForDisplay(text);
    const maxChars = this.displaySize.chars;
    const displayText = String(text).substring(0, maxChars).padEnd(maxChars, ' ');
    await this.sendCommand(Buffer.from(displayText, 'ascii'));
    await this.delay(10);
  }
  
  // Display two lines of text
  async displayText(line1 = '', line2 = '') {
    return await this._runExclusiveDisplayTask(async () => {
      const maxChars = this.displaySize?.chars || 20;
      const l1 = this.sanitizeForDisplay(line1).substring(0, maxChars).padEnd(maxChars, ' ');
      const l2 = this.sanitizeForDisplay(line2).substring(0, maxChars).padEnd(maxChars, ' ');

      // Optional preview hook (e.g., to show the lines in the main app UI).
      if (typeof this.onPreviewLines === 'function') {
        try {
          this.onPreviewLines({ line1: l1, line2: l2, maxChars });
        } catch {
          // ignore preview errors
        }
      }

      if (this.dryRun) {
        const next = { line1: l1, line2: l2 };
        const prev = this._lastDryRunLines;
        const changed = !prev || prev.line1 !== next.line1 || prev.line2 !== next.line2;
        if (changed) {
          this._lastDryRunLines = next;
          const ruler = '12345678901234567890'.substring(0, maxChars).padEnd(maxChars, ' ');
          console.log(`[CustomerDisplay][DryRun] RULER:|${ruler}|`);
          console.log(`[CustomerDisplay][DryRun] L1   :|${l1}|`);
          console.log(`[CustomerDisplay][DryRun] L2   :|${l2}|`);
        }
        return;
      }

      // PREMIER CD-220 U reliable method:
      // 1. ESC @ reset moves cursor to home and clears display
      // 2. Write all 40 chars as one block (20 for L1 + 20 for L2)
      // The display automatically wraps to line 2 after 20 chars.
      // Do NOT call port.set() here — any modem control change during writes
      // can cause the Windows Prolific driver to fire a spurious 'close' event
      // that sets isConnected=false and silently blocks all subsequent writes.
      const resetCmd = Buffer.from([0x1B, 0x40]); // ESC @ - reset, home, clear
      const okReset = await this.sendCommand(resetCmd);
      if (!okReset) throw new Error('Customer display write failed (reset)');
      await this.delay(80);

      // Some PREMIER units need an explicit Display-ON after ESC @ reset.
      const displayOnCmd = Buffer.from([0x1B, 0x64, 0x01]); // ESC d 1 - Display ON
      const okOn = await this.sendCommand(displayOnCmd);
      if (!okOn) throw new Error('Customer display write failed (display on)');
      await this.delay(30);

      // Write both lines as one 40-byte block
      const fullFrame = Buffer.from(l1 + l2, 'ascii');
      const okFrame = await this.sendCommand(fullFrame);
      if (!okFrame) throw new Error('Customer display write failed (frame)');
      await this.delay(20);
    });
  }
  
  // Show welcome message
  async showWelcomeMessage() {
    const { line1, line2 } = this.formatWelcomeLines();
    await this.displayText(line1, line2);
  }
  
  // Show current item being scanned
  // price = total line amount
  async showCurrentItem(itemName, price, currencySymbol = '€', quantity = null, unitPrice = null, unit = null) {
    const { line1, line2 } = this.formatCurrentItemLines(itemName, price, currencySymbol, quantity, unitPrice, unit);
    await this.displayText(line1, line2);
  }
  
  // Show total amount
  async showTotal(total, currencySymbol = '€') {
    const { line1, line2 } = this.formatTotalLines(total, currencySymbol);
    await this.displayText(line1, line2);
  }
  
  // Show change amount
  async showChange(changeAmount, currencySymbol = '€') {
    const { line1, line2 } = this.formatChangeLines(changeAmount, currencySymbol);
    await this.displayText(line1, line2);
  }

  // Show payment summary like: TOTAL ENTREGA CAMBIO /  1.20   5.00   3.80
  // total = sale total, paid = cash received, change = change to return
  async showPaymentSummary(total, paid, change, currencySymbol = '€') {
    const { line1, line2 } = this.formatPaymentSummaryLines(total, paid, change, currencySymbol);
    await this.displayText(line1, line2);
  }
  
  // Show payment processing
  async showPaymentProcessing(paymentMethod = 'CARD') {
    // Format payment method display
    const method = paymentMethod.toUpperCase();
    let displayMethod = method;
    
    // Customize display for different payment methods
    switch(method) {
      case 'CASH':
        displayMethod = 'CASH PAYMENT';
        break;
      case 'CARD':
        displayMethod = 'CARD PAYMENT';
        break;
      case 'CREDIT':
        displayMethod = 'CREDIT CARD';
        break;
      case 'DEBIT':
        displayMethod = 'DEBIT CARD';
        break;
      case 'CONTACTLESS':
        displayMethod = 'CONTACTLESS';
        break;
      default:
        displayMethod = method;
    }
    
    await this.displayText(
      'PROCESSING...      ',
      displayMethod.substring(0, 20).padEnd(20, ' ')
    );
  }
  
  // Show thank you message
  async showThankYou(changeAmount = null, currencySymbol = '€') {
    const safeChange = changeAmount === null || changeAmount === undefined ? null : this.normalizeAmount(changeAmount);
    if (safeChange !== null && safeChange > 0) {
      const line1 = 'Thank You!          ';
      const line2 = `Change: ${safeChange.toFixed(2)}`.padEnd(20, ' ');
      await this.displayText(line1, line2);
    } else {
      await this.displayText(
        'Thank You!          ',
        'Have a nice day!    '
      );
    }
  }
  
  // Show error message
  async showError(message) {
    await this.displayText(
      'ERROR:             ',
      message.substring(0, 20).padEnd(20, ' ')
    );
  }
  
  // Utility delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Flush stale bytes from the port buffer on startup/reconnect.
  async _kickPort(port) {
    if (!port) return;
    this._portKicking = true;
    // Flush any stale buffered bytes before sending fresh commands
    try {
      if (typeof port.flush === 'function') {
        await new Promise((resolve) => port.flush(() => resolve()));
      }
    } catch {
      // ignore
    }
    this._portKicking = false;
    await this.delay(100);
  }

  // Disconnect from display
  async disconnect() {
    if (this.port) {
      try {
        await this.clearDisplay();
      } catch {
        // ignore clear errors on shutdown
      }
      try {
        await new Promise((resolve) => {
          try {
            if (this.port && this.port.isOpen) {
              this.port.close((err) => {
                if (err) console.error('[CustomerDisplay] Close error:', err.message);
                resolve();
              });
            } else {
              resolve();
            }
          } catch {
            resolve();
          }
        });
        this.isConnected = false;
        try {
          this.port = null;
        } catch {
          // ignore
        }
        console.log('[CustomerDisplay] Disconnected');
      } catch (error) {
        console.error('[CustomerDisplay] Disconnect error:', error);
      }
    }
  }
  
  // Check if display is connected
  isDisplayConnected() {
    return this.isConnected;
  }
  
  // Get display info including troubleshooting information
  getDisplayInfo() {
    return {
      model: this.displayModel,
      lines: this.displaySize.lines,
      characters: this.displaySize.chars,
      connected: this.isConnected,
      serialPortAvailable: this.serialPortAvailable,
      troubleshooting: {
        serialPortError: serialPortLoadError?.message || null,
        suggestions: [
          'Make sure the customer display is plugged into a USB port',
          'Check that USB drivers are installed (may need CH340, FTDI, or Prolific drivers)',
          'Try unplugging and reconnecting the USB cable',
          'Check Windows Device Manager for unrecognized devices',
          'Install serialport module: npm install serialport'
        ]
      }
    };
  }

  // Get connection status with detailed information
  async getConnectionStatus() {
    const status = {
      connected: this.isConnected,
      serialPortAvailable: this.serialPortAvailable,
      lastPortPath: this.lastPortPath,
      lastPortError: this.lastPortError,
      lastPortErrorAt: this.lastPortErrorAt,
      lastPortCloseAt: this.lastPortCloseAt,
      lastWriteError: this.lastWriteError,
      lastWriteErrorAt: this.lastWriteErrorAt,
      availablePorts: [],
      error: null
    };

    if (!this.serialPortAvailable) {
      status.error = 'SerialPort module not available';
      return status;
    }

    try {
      if (SerialPort) {
        status.availablePorts = await SerialPort.list();
      }
    } catch (error) {
      status.error = `Failed to list ports: ${error.message}`;
    }

    return status;
  }
}

module.exports = CustomerDisplay;