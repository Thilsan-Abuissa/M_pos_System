// Global state
let _currentView = 'checkout'; // Tracks the last active view
let currentUser = null;
let cart = [];
let allProducts = [];
let allProductsById = new Map();
let allCategories = [];
let allCategoriesByName = new Map();
let selectedPaymentMethod = null; // No default - must select payment method
let paymentMode = 'single'; // 'single' or 'split'
let cashDrawerOpenedInPaymentFlow = false; // Prevent double drawer-open (CASH select + complete sale)
let systemSettings = null; // System settings
let currentLogoData = ''; // Current logo data
let scaleConnected = false; // Scale connection status
let scalePort = null; // Currently connected scale port
let scaleDebugLogs = []; // Store debug logs
let scaleDebugVisible = false; // Debug panel visibility
let lastSale = null; // Store last sale for reprinting
let lastSalePaymentMethod = null; // Track payment method for drawer-open-on-print
let isWeightModalOpen = false; // Flag to prevent multiple modal opens
let currentInvoiceNote = ''; // Store note for current invoice
let currentSalesReportPrintContext = null; // Store last generated sales report for thermal printing

// Barcode scanner capture (works even if the search box isn't focused)
let barcodeScanCaptureState = {
  buffer: '',
  lastKeyAt: 0,
  startedAt: 0
};

function isTextInputElement(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function isCheckoutViewActive() {
  const v = document.getElementById('checkoutView');
  return !!(v && v.classList.contains('active'));
}

function isBlockingOverlayOpen() {
  // If a modal/overlay is open, do not hijack keystrokes.
  if (document.querySelector('.modal.active')) return true;
  if (document.getElementById('copilotConfirmOverlay')) return true;
  if (document.getElementById('quickAddProductOverlay')) return true;
  if (document.getElementById('quickVatPromptOverlay')) return true;
  if (document.getElementById('barcodePreviewOverlay')) return true;
  if (document.getElementById('unitPriceEntryOverlay')) return true;
  return false;
}

function cacheProductRecord(product) {
  try {
    const id = parseInt(product?.id, 10);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!(allProductsById instanceof Map)) allProductsById = new Map();
    // Ensure lowercase cache fields exist for fast filtering
    if (product && typeof product._lcName !== 'string') product._lcName = String(product.name || '').toLowerCase();
    if (product && typeof product._lcCategory !== 'string') product._lcCategory = String(product.category || '').toLowerCase();
    if (product && typeof product._lcBarcode !== 'string') product._lcBarcode = String(product.barcode || '').toLowerCase();
    allProductsById.set(id, product);
  } catch {
    // ignore
  }
}

function setupGlobalBarcodeScannerCapture() {
  if (setupGlobalBarcodeScannerCapture._attached) return;
  setupGlobalBarcodeScannerCapture._attached = true;

  const SCAN_GAP_MS = 65; // if time between keys is larger, treat as new input

  document.addEventListener('keydown', async (e) => {
    try {
      if (!isCheckoutViewActive()) return;
      if (isBlockingOverlayOpen()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const active = document.activeElement;
      // Let normal typing work in inputs (especially the checkout search input).
      if (isTextInputElement(active)) {
        return;
      }

      const key = e.key;
      const now = Date.now();

      if (key === 'Escape') {
        barcodeScanCaptureState.buffer = '';
        barcodeScanCaptureState.lastKeyAt = 0;
        barcodeScanCaptureState.startedAt = 0;
        return;
      }

      if (key === 'Enter') {
        const q = String(barcodeScanCaptureState.buffer || '').trim();
        barcodeScanCaptureState.buffer = '';
        barcodeScanCaptureState.lastKeyAt = 0;
        barcodeScanCaptureState.startedAt = 0;
        if (!q) return;

        e.preventDefault();
        e.stopPropagation();

        hideCashierPaymentSummaryOverlay();
        await searchAndAddProduct(q);
        return;
      }

      // Only collect typical barcode characters (digits/letters and a few safe symbols)
      if (typeof key === 'string' && key.length === 1 && /^[0-9A-Za-z\-_.]+$/.test(key)) {
        if (!barcodeScanCaptureState.startedAt || (now - barcodeScanCaptureState.lastKeyAt) > SCAN_GAP_MS) {
          barcodeScanCaptureState.buffer = key;
          barcodeScanCaptureState.startedAt = now;
          barcodeScanCaptureState.lastKeyAt = now;
        } else {
          barcodeScanCaptureState.buffer += key;
          barcodeScanCaptureState.lastKeyAt = now;
        }
      }
    } catch {
      // ignore
    }
  }, true);
}

// Set to true for barcode-only POS (no scale/weight flow).
// When false, products with unit_type 'weight' open the weight/scale modal at checkout.
const POS_DISABLE_SCALE_AND_WEIGHT = false;

// Checkout: Undo last scan (either remove last added line, or revert a quantity-increase).
let lastScanUndoAction = null;

function setLastScanUndoAction(action) {
  lastScanUndoAction = action || null;
  try {
    updateUndoScanButton();
  } catch {
    // ignore
  }

  // Live barcode preview in the modal
  try {
    const barcodeEl = document.getElementById('productBarcode');
    const previewSvg = document.getElementById('productBarcodePreview');
    if (barcodeEl && previewSvg) {
      const render = () => renderBarcodeToSvg(previewSvg, barcodeEl.value, { height: 56, width: 2, displayValue: true, textMargin: 2 });
      render();

      if (!barcodeEl.dataset.previewAttached) {
        barcodeEl.dataset.previewAttached = '1';
        barcodeEl.addEventListener('input', () => {
          try {
            clearTimeout(barcodeEl.__barcodePreviewTimer);
            barcodeEl.__barcodePreviewTimer = setTimeout(render, 40);
          } catch {
            // ignore
          }
        });
      }
    }
  } catch {
    // ignore
  }
}

function updateUndoScanButton() {
  const btn = document.getElementById('undoScanBtn');
  if (!btn) return;
  const enabled = !!(lastScanUndoAction && cart && cart.length > 0);
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.6';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

function updateDeleteAllButton() {
  const btn = document.getElementById('deleteAllBtn');
  if (!btn) return;
  const enabled = !!(cart && cart.length > 0);
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.6';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

function clearCurrentCart() {
  if (!Array.isArray(cart) || cart.length === 0) {
    updateDeleteAllButton();
    return;
  }

  cart = [];
  currentInvoiceNote = '';
  selectedPaymentMethod = null;
  paymentMode = 'single';
  cashDrawerOpenedInPaymentFlow = false;

  const paymentInput = document.getElementById('paymentInput');
  if (paymentInput) paymentInput.value = '';

  const cashPaidInput = document.getElementById('cashPaidInput');
  if (cashPaidInput) cashPaidInput.value = '';

  const splitCashAmount = document.getElementById('splitCashAmount');
  if (splitCashAmount) splitCashAmount.value = '';

  const splitCardAmount = document.getElementById('splitCardAmount');
  if (splitCardAmount) splitCardAmount.value = '';

  try {
    closePaymentModalFunc();
  } catch {
    // ignore
  }

  updateCartDisplay();
  showAlert('Cart cleared', 'success');
}

function undoLastScan() {
  const action = lastScanUndoAction;
  if (!action) {
    showAlert('Nothing to undo', 'info');
    return;
  }

  // Clear first to avoid double-tap repeating the undo.
  setLastScanUndoAction(null);

  try {
    if (action.type === 'add') {
      const id = Number(action.cartItemId);
      if (!Number.isFinite(id)) throw new Error('Invalid undo item id');
      const exists = cart.some(i => i && i.cartItemId === id);
      if (!exists) {
        showAlert('Last item is no longer in cart', 'warning');
        return;
      }
      removeFromCart(id);
      showAlert('Last scan removed', 'success');
      return;
    }

    if (action.type === 'merge') {
      const id = Number(action.cartItemId);
      const prevQty = Number(action.prevQty);
      if (!Number.isFinite(id) || !Number.isFinite(prevQty)) throw new Error('Invalid undo merge');
      const item = cart.find(i => i && i.cartItemId === id);
      if (!item) {
        showAlert('Last item is no longer in cart', 'warning');
        return;
      }

      // Restore previous quantity
      if (prevQty <= 0) {
        removeFromCart(id);
      } else {
        item.quantity = prevQty;
        item.quantityGrams = null;
        try { recalcCartItemMoney(item); } catch { /* ignore */ }
        updateCartDisplay();
      }

      showAlert('Last scan undone', 'success');
      return;
    }
  } catch (e) {
    const msg = String(e?.message || e || 'Undo failed');
    showAlert(msg, 'error', 'Undo');
  }
}

// ============== BARCODE RENDERING (JsBarcode) ==============
function getBarcodeFormatForValue(value) {
  const v = String(value || '').replace(/\s+/g, '').trim();
  if (/^\d{13}$/.test(v)) return 'ean13';
  if (/^\d{12}$/.test(v)) return 'upc';
  return 'code128';
}

function renderBarcodeToSvg(svgEl, value, { height = 62, width = 2, displayValue = true, textMargin = 2 } = {}) {
  if (!svgEl) return false;
  const v = String(value || '').replace(/\s+/g, '').trim();
  if (!v) {
    try { svgEl.innerHTML = ''; } catch { /* ignore */ }
    return false;
  }

  const JsBarcode = window.JsBarcode;
  if (typeof JsBarcode !== 'function') {
    try {
      svgEl.innerHTML = '<text x="0" y="16" fill="#64748b" font-size="12">Barcode renderer not loaded</text>';
    } catch {
      // ignore
    }
    return false;
  }

  const format = getBarcodeFormatForValue(v);
  try {
    svgEl.innerHTML = '';
    JsBarcode(svgEl, v, {
      format,
      height,
      width,
      displayValue,
      textMargin,
      font: 'monospace',
      fontSize: 14,
      margin: 0,
      background: '#ffffff',
      lineColor: '#0f172a'
    });
    return true;
  } catch {
    // EAN/UPC can fail if check-digit is wrong; fall back to CODE128.
    try {
      svgEl.innerHTML = '';
      JsBarcode(svgEl, v, {
        format: 'code128',
        height,
        width,
        displayValue,
        textMargin,
        font: 'monospace',
        fontSize: 14,
        margin: 0,
        background: '#ffffff',
        lineColor: '#0f172a'
      });
      return true;
    } catch {
      try {
        svgEl.innerHTML = `<text x="0" y="16" fill="#dc2626" font-size="12">Invalid barcode: ${v}</text>`;
      } catch {
        // ignore
      }
      return false;
    }
  }
}

function showBarcodeOverlay({ barcode, name } = {}) {
  const bc = String(barcode || '').replace(/\s+/g, '').trim();
  const titleName = String(name || '').trim();
  if (!bc) {
    showAlert('Missing barcode', 'warning');
    return;
  }

  const existing = document.getElementById('barcodePreviewOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'barcodePreviewOverlay';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,0.55)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:18px',
    'z-index:10050'
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(640px, 94vw)',
    'background:#fff',
    'border-radius:22px',
    'box-shadow:0 18px 60px rgba(0,0,0,0.35)',
    'overflow:hidden'
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = [
    'background:#6E8FAF',
    'color:#fff',
    'padding:18px 20px',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:12px'
  ].join(';');
  header.innerHTML = `
    <div style="font-size:22px; font-weight:900; letter-spacing:0.12em;">BARCODE</div>
    <button id="barcodeOverlayClose" style="border:none; background:rgba(255,255,255,0.18); color:#fff; width:42px; height:42px; border-radius:14px; font-size:22px; font-weight:900; cursor:pointer;">×</button>
  `;

  const body = document.createElement('div');
  body.style.cssText = 'padding:18px 20px 20px 20px;';
  body.innerHTML = `
    <div style="font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;">
      ${titleName ? `<div style="font-size:16px; font-weight:800; color:#0f172a; margin-bottom:10px;">${titleName}</div>` : ''}
      <div style="border:2px dashed #cbd5e1; border-radius:16px; padding:16px; background:#f8fafc;">
        <svg id="barcodeOverlaySvg" style="width:100%; height:160px;"></svg>
      </div>
      <div style="margin-top:12px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size:18px; font-weight:900; color:#334155; text-align:center;">${bc}</div>
    </div>
  `;

  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => {
    try { overlay.remove(); } catch { /* ignore */ }
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  header.querySelector('#barcodeOverlayClose')?.addEventListener('click', close);

  const svg = body.querySelector('#barcodeOverlaySvg');
  renderBarcodeToSvg(svg, bc, { height: 120, width: 2, displayValue: false });
}

// Receipt reprint tracking (sale.id -> number of times printed in this session)
const printedReceiptCounts = new Map();

// PARKING (Loans) list filters
let currentLoansStatus = 'active';
let currentLoansSearchQuery = '';

// Checkout banner for active PARKING context
let parkingContextHydrateInFlight = false;
let parkingContextLastHydratedReceipt = '';

function getParkingPaymentContext() {
  try {
    const raw = sessionStorage.getItem('parkingPayment');
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || !ctx.receiptNumber) return null;
    return ctx;
  } catch {
    return null;
  }
}

function setParkingPaymentContext(nextCtx) {
  try {
    if (!nextCtx) {
      sessionStorage.removeItem('parkingPayment');
      return;
    }
    sessionStorage.setItem('parkingPayment', JSON.stringify(nextCtx));
  } catch {
    // ignore
  }
}

async function hydrateParkingPaymentContextIfNeeded(ctx) {
  try {
    if (!ctx || !ctx.receiptNumber) return;
    const receiptNumber = String(ctx.receiptNumber || '').trim();
    if (!receiptNumber) return;

    const hasNames = !!((ctx.restaurantName || ctx.customerName) && ctx.customerType);
    if (hasNames && ctx.remainingAmount !== undefined) return;
    if (parkingContextHydrateInFlight) return;
    if (parkingContextLastHydratedReceipt === receiptNumber) return;

    parkingContextHydrateInFlight = true;
    parkingContextLastHydratedReceipt = receiptNumber;

    const loan = await window.api.getLoanByReceipt(receiptNumber);
    if (!loan) return;

    const updated = {
      ...ctx,
      receiptNumber,
      remainingAmount: Number(loan.remaining_amount || 0),
      status: (loan.status || '').toString().toLowerCase(),
      customerType: (loan.customer_type || '').toString().toLowerCase(),
      restaurantName: loan.restaurant_name || null,
      customerName: loan.customer_name || null,
      customerPhone: loan.customer_phone || null
    };
    setParkingPaymentContext(updated);
  } catch {
    // ignore
  } finally {
    parkingContextHydrateInFlight = false;
  }
}

function updateParkingContextBanner() {
  const banner = document.getElementById('parkingContextBanner');
  const titleEl = document.getElementById('parkingContextTitle');
  const subEl = document.getElementById('parkingContextSub');
  if (!banner || !titleEl || !subEl) return;

  const ctx = getParkingPaymentContext();
  if (!ctx || !ctx.receiptNumber) {
    banner.style.display = 'none';
    return;
  }

  const receiptNumber = String(ctx.receiptNumber || '').trim();
  const type = (ctx.customerType || '').toString().toLowerCase();
  const restaurantName = (ctx.restaurantName || '').toString().trim();
  const customerName = (ctx.customerName || '').toString().trim();
  const remaining = Number(ctx.remainingAmount);
  const currencySymbol = systemSettings?.currency_symbol || '€';

  let partyLine = '';
  if (type === 'restaurant' && restaurantName) {
    partyLine = `RESTAURANT: ${restaurantName}`;
  } else if (customerName) {
    partyLine = `CUSTOMER: ${customerName}`;
  } else {
    partyLine = 'PARKING CUSTOMER';
  }

  const remainingText = Number.isFinite(remaining)
    ? ` | REMAINING: ${currencySymbol}${remaining.toFixed(2)}`
    : '';

  titleEl.textContent = partyLine;
  subEl.textContent = `PARKING TAB: ${receiptNumber}${remainingText}`;
  banner.style.display = 'flex';

  // Hydrate missing details asynchronously (best effort)
  if (!ctx.customerType || (!ctx.restaurantName && !ctx.customerName) || !Number.isFinite(remaining)) {
    hydrateParkingPaymentContextIfNeeded(ctx).finally(() => {
      try { updateParkingContextBanner(); } catch { /* ignore */ }
    });
  }
}

// Logging: keep production fast (console logging can slow down over long sessions)
const DEBUG_LOGS = false;
function debugLog(...args) {
  if (DEBUG_LOGS) console.log(...args);
}

function shouldUseKeyboardModeUi() {
  try {
    const qs = new URLSearchParams(window.location.search || '');
    const forced = qs.get('keyboard');
    if (forced === '1') return true;
    if (forced === '0') return false;

    const ls = (localStorage.getItem('posKeyboardMode') || '').toString();
    if (ls === '1') return true;
    if (ls === '0') return false;

    const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const touchPoints = Number(navigator.maxTouchPoints || 0);
    const touchLikely = coarsePointer || touchPoints > 0;

    // Auto-enable on desktop PCs (mouse/trackpad, no touch).
    return !!finePointer && !touchLikely;
  } catch {
    return false;
  }
}

function applyKeyboardModeUi() {
  try {
    if (shouldUseKeyboardModeUi()) {
      document.body.classList.add('keyboard-mode');
    } else {
      document.body.classList.remove('keyboard-mode');
    }
  } catch {
    // ignore
  }
}

// In production builds, silence noisy logs to keep the UI responsive.
// (Keep warn/error so operational issues still surface.)
if (!DEBUG_LOGS) {
  try {
    console.log = () => {};
    console.debug = () => {};
    console.info = () => {};
  } catch {
    // ignore
  }
}

function showConfirmDialog({
  title = 'Confirm',
  message = 'Are you sure?',
  confirmText = 'OK',
  cancelText = 'Cancel',
  tone = 'warning' // 'warning' | 'danger' | 'info'
} = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('copilotConfirmOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'copilotConfirmOverlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(15, 23, 42, 0.55)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'z-index:10050'
    ].join(';');

    const accent = tone === 'danger' ? '#ef4444' : (tone === 'info' ? '#0ea5e9' : '#f59e0b');
    const confirmBg = tone === 'danger' ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#2563eb,#06b6d4)';

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(520px, 94vw)',
      'background:#ffffff',
      'border-radius:22px',
      'box-shadow:0 22px 70px rgba(0,0,0,0.35)',
      'border:1px solid rgba(148,163,184,0.55)',
      'padding:22px 20px',
      'font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial'
    ].join(';');

    card.innerHTML = `
      <div style="display:flex; gap:14px; align-items:flex-start;">
        <div style="width:46px; height:46px; border-radius:14px; background:${accent}22; display:flex; align-items:center; justify-content:center; flex:0 0 auto;">
          <div style="width:18px; height:18px; border-radius:999px; background:${accent};"></div>
        </div>
        <div style="flex:1 1 auto; min-width:0;">
          <div style="font-size:20px; font-weight:900; color:#0f172a; margin:2px 0 8px;">${String(title)}</div>
          <div style="font-size:15px; line-height:1.35; color:#475569; white-space:pre-wrap;">${String(message)}</div>
        </div>
      </div>
      <div style="display:flex; gap:12px; margin-top:18px;">
        <button id="copilotConfirmCancel" style="flex:1; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:#e2e8f0; color:#0f172a;">${String(cancelText)}</button>
        <button id="copilotConfirmOk" style="flex:1; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:${confirmBg}; color:#ffffff;">${String(confirmText)}</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = () => {
      try { overlay.remove(); } catch { /* ignore */ }
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onOk = () => {
      cleanup();
      resolve(true);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) onCancel();
    });
    document.getElementById('copilotConfirmCancel')?.addEventListener('click', onCancel, { once: true });
    document.getElementById('copilotConfirmOk')?.addEventListener('click', onOk, { once: true });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        onCancel();
      }
    });
  });
}

// Prompt the cashier for a VAT percent (0-100). Returns number or null.
function promptForVatPercent() {
  return new Promise((res) => {
    const existingPrompt = document.getElementById('quickVatPromptOverlay');
    if (existingPrompt) existingPrompt.remove();

    const o = document.createElement('div');
    o.id = 'quickVatPromptOverlay';
    o.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(15, 23, 42, 0.55)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'z-index:10070'
    ].join(';');

    const c = document.createElement('div');
    c.style.cssText = [
      'width:min(460px, 94vw)',
      'background:#fff',
      'border-radius:20px',
      'box-shadow:0 22px 70px rgba(0,0,0,0.35)',
      'border:1px solid rgba(148,163,184,0.55)',
      'padding:18px 18px 16px 18px',
      'font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial'
    ].join(';');

    c.innerHTML = `
      <div style="font-size:18px; font-weight:950; color:#0f172a;">Add VAT Rate</div>
      <div style="font-size:14px; color:#64748b; margin-top:4px;">Enter VAT percent (0-100)</div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:12px;">
        <input id="quickVatPromptInput" type="text" inputmode="decimal" placeholder="e.g., 8" style="flex:1; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; font-size:16px;" />
        <div style="font-weight:950; color:#334155;">%</div>
      </div>
      <div style="display:flex; gap:12px; margin-top:14px;">
        <button id="quickVatPromptCancel" style="flex:1; border:none; border-radius:16px; padding:12px 10px; font-size:16px; font-weight:900; background:#e2e8f0; color:#0f172a;">Cancel</button>
        <button id="quickVatPromptOk" style="flex:1; border:none; border-radius:16px; padding:12px 10px; font-size:16px; font-weight:900; background:linear-gradient(135deg,#2563eb,#06b6d4); color:#fff;">Add</button>
      </div>
    `;

    o.appendChild(c);
    document.body.appendChild(o);

    const closePrompt = (val = null) => {
      try { o.remove(); } catch { /* ignore */ }
      res(val);
    };

    const parsePercent = (value) => {
      const v = String(value || '').trim().replace(',', '.');
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return null;
      if (n < 0 || n > 100) return null;
      return n;
    };

    o.addEventListener('click', (e) => {
      if (e.target === o) closePrompt(null);
    });

    document.getElementById('quickVatPromptCancel')?.addEventListener('click', () => closePrompt(null), { once: true });
    document.getElementById('quickVatPromptOk')?.addEventListener('click', () => {
      const v = document.getElementById('quickVatPromptInput')?.value;
      const pct = parsePercent(v);
      closePrompt(pct);
    });

    setTimeout(() => {
      try {
        const inp = document.getElementById('quickVatPromptInput');
        inp?.focus?.();
        inp?.select?.();
      } catch {
        // ignore
      }
    }, 0);
  });
}

async function getVatPercentOptions() {
  try {
    if (typeof window.api.getVatRates === 'function') {
      const rows = await window.api.getVatRates(true);
      const opts = (Array.isArray(rows) ? rows : [])
        .map(r => Math.round(Number(r?.percent)))
        .filter(p => Number.isFinite(p) && p >= 0 && p <= 100)
        .sort((a, b) => a - b);
      if (opts.length) return Array.from(new Set(opts));
    }
  } catch {
    // ignore
  }
  return [4, 10, 21];
}

function fillVatSelect(selectEl, options, selectedPct) {
  if (!selectEl) return;
  const selected = Math.round(Number(selectedPct));
  const safeOptions = (Array.isArray(options) ? options : [4, 10, 21])
    .map(v => Math.round(Number(v)))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 100);

  // "Add VAT" is a separate + button (see attachVatAddHandler), not a dropdown option:
  // as the last option it sat right over the Save button and was easy to hit by accident.
  selectEl.innerHTML = safeOptions
    .map(pct => `<option value="${pct}" ${pct === selected ? 'selected' : ''}>${pct}%</option>`)
    .join('');

  // Ensure a valid value is selected
  if (!safeOptions.includes(selected)) {
    const fallback = safeOptions.includes(21) ? 21 : (safeOptions[0] ?? 21);
    selectEl.value = String(fallback);
  }
}

function attachVatAddHandler(selectEl, { onAdded } = {}) {
  if (!selectEl) return;
  if (selectEl.dataset.vatAddAttached === '1') return;
  selectEl.dataset.vatAddAttached = '1';

  // Put the select and a small "+" button side by side.
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:8px; align-items:stretch;';
  selectEl.parentNode.insertBefore(row, selectEl);
  row.appendChild(selectEl);
  selectEl.style.flex = '1';
  selectEl.style.minWidth = '0';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-secondary';
  addBtn.textContent = '+';
  addBtn.title = 'Add VAT';
  addBtn.setAttribute('aria-label', 'Add VAT');
  addBtn.style.cssText = 'flex:0 0 auto; min-width:48px; padding:0 14px; font-size:22px; font-weight:800; line-height:1;';
  row.appendChild(addBtn);

  addBtn.addEventListener('click', async () => {
    const pct = await promptForVatPercent();
    if (pct === null) return;
    if (!Number.isFinite(pct)) {
      showAlert('Please enter a valid VAT percent', 'error', 'Invalid VAT');
      return;
    }

    try {
      if (typeof window.api.addVatRate !== 'function') {
        showAlert('VAT presets are not available in this build', 'error');
        return;
      }
      const created = await window.api.addVatRate(pct, null);
      const createdPct = Math.round(Number(created?.percent ?? pct));
      showAlert(`VAT ${createdPct}% added`, 'success');
      if (typeof onAdded === 'function') {
        await onAdded(createdPct);
      }
    } catch (e) {
      showAlert('Failed to add VAT: ' + (e?.message || e), 'error', 'VAT');
    }
  });
}

// Quick-add product dialog (optimized for barcode scan flow in Checkout)
// Fields: barcode (prefilled), name, price, sales VAT, purchase VAT, stock (optional)
async function showQuickAddProductDialog({ barcode, defaults = {} } = {}) {
  let vatRates = [];
  try {
    if (typeof window.api.getVatRates === 'function') {
      vatRates = await window.api.getVatRates(true);
    }
  } catch {
    vatRates = [];
  }

  const VAT_OPTIONS = Array.isArray(vatRates) && vatRates.length
    ? vatRates
        .map(r => Number(r?.percent))
        .filter(p => Number.isFinite(p) && p >= 0 && p <= 100)
        .sort((a, b) => a - b)
    : [4, 10, 21];

  const normalizeVatDefault = (v, fallback = 21) => {
    const n = Math.round(Number(v));
    if (VAT_OPTIONS.includes(n)) return n;
    // Pick closest if not in list
    let closest = fallback;
    let bestDist = Infinity;
    for (const opt of VAT_OPTIONS) {
      const d = Math.abs(opt - n);
      if (d < bestDist) {
        bestDist = d;
        closest = opt;
      }
    }
    return closest;
  };

  return new Promise((resolve) => {
    const bc = String(barcode || '').replace(/\s+/g, '').trim();
    if (!bc) {
      resolve({ ok: false, reason: 'missing_barcode' });
      return;
    }

    const existing = document.getElementById('quickAddProductOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'quickAddProductOverlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(15, 23, 42, 0.55)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'z-index:10000'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(720px, 96vw)',
      'background:#ffffff',
      'border-radius:22px',
      'box-shadow:0 22px 70px rgba(0,0,0,0.35)',
      'border:1px solid rgba(148,163,184,0.55)',
      'padding:20px 20px 18px 20px',
      'font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial'
    ].join(';');

    const rawSalesVat = Number.isFinite(Number(defaults.salesVatPercent)) ? Number(defaults.salesVatPercent) : 21;
    const rawPurchaseVat = Number.isFinite(Number(defaults.purchaseVatPercent)) ? Number(defaults.purchaseVatPercent) : rawSalesVat;
    const defaultSalesVat = normalizeVatDefault(rawSalesVat, 21);
    const defaultPurchaseVat = normalizeVatDefault(rawPurchaseVat, defaultSalesVat);
    const defaultStock = (defaults.stock === '' || defaults.stock === null || defaults.stock === undefined) ? '' : String(defaults.stock);

    const vatOptionsHtml = (selectedPct) => {
      const options = VAT_OPTIONS
        .map(pct => `<option value="${pct}" ${Number(pct) === Number(selectedPct) ? 'selected' : ''}>${pct}%</option>`)
        .join('');
      // Add action at bottom
      return options + '<option value="__add__">+ Add VAT…</option>';
    };

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:14px;">
        <div>
          <div style="font-size:22px; font-weight:950; color:#0f172a;">Add New Product</div>
          <div style="font-size:14px; color:#64748b; margin-top:4px;">Barcode not found. Enter details and save.</div>
        </div>
        <button id="quickAddProductClose" style="border:none; background:#e2e8f0; color:#0f172a; width:44px; height:44px; border-radius:14px; font-size:20px; font-weight:900; cursor:pointer;">×</button>
      </div>

      <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:14px; margin-top:16px;">
        <div>
          <div style="font-size:13px; font-weight:900; color:#334155; margin-bottom:6px;">Barcode</div>
          <input id="quickAddBarcode" type="text" value="${bc}" readonly
            style="width:100%; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; font-size:16px; font-weight:900; background:#f8fafc; color:#0f172a;" />
        </div>
        <div>
          <div style="font-size:13px; font-weight:900; color:#334155; margin-bottom:6px;">Stock (optional)</div>
          <input id="quickAddStock" type="text" inputmode="numeric" placeholder="e.g., 10" value="${defaultStock}"
            style="width:100%; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; font-size:16px;" />
        </div>

        <div style="grid-column: 1 / -1;">
          <div style="font-size:13px; font-weight:900; color:#334155; margin-bottom:6px;">Product Name</div>
          <input id="quickAddName" type="text" placeholder="e.g., Coca Cola 330ml"
            style="width:100%; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; font-size:16px;" />
        </div>

        <div>
          <div style="font-size:13px; font-weight:900; color:#334155; margin-bottom:6px;">Price (€)</div>
          <input id="quickAddPrice" type="text" inputmode="decimal" placeholder="0.00"
            style="width:100%; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; font-size:16px; text-align:right;" />
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px;">
          <div>
            <div style="font-size:13px; font-weight:900; color:#334155; margin-bottom:6px;">IVA de venta</div>
            <select id="quickAddSalesVat"
              style="width:100%; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; font-size:16px; font-weight:900; background:#ffffff;">
              ${vatOptionsHtml(defaultSalesVat)}
            </select>
          </div>
          <div>
            <div style="font-size:13px; font-weight:900; color:#334155; margin-bottom:6px;">IVA de compra</div>
            <select id="quickAddPurchaseVat"
              style="width:100%; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; font-size:16px; font-weight:900; background:#ffffff;">
              ${vatOptionsHtml(defaultPurchaseVat)}
            </select>
          </div>
        </div>
      </div>

      <div class="checkout-visibility-toggle" style="margin-top:14px;" role="group" aria-label="Checkout visibility">
        <div class="checkout-visibility-text">
          <div class="checkout-visibility-title">Show in Checkout quick list</div>
          <div class="checkout-visibility-help">Keep this off if you don’t want it in the quick grid.</div>
        </div>
        <label class="touch-switch" aria-label="Show in Checkout">
          <input id="quickAddShowInCheckout" type="checkbox" />
          <span class="touch-switch-slider" aria-hidden="true"></span>
        </label>
      </div>

      <div style="display:flex; gap:12px; margin-top:16px;">
        <button id="quickAddCancel" style="flex:1; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:#e2e8f0; color:#0f172a;">Cancel</button>
        <button id="quickAddSave" style="flex:1; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:linear-gradient(135deg,#16a34a,#22c55e); color:#ffffff;">Save & Add</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = () => {
      try { overlay.remove(); } catch { /* ignore */ }
    };

    const close = () => {
      cleanup();
      resolve({ ok: false, reason: 'cancel' });
    };

    const normalizeDecimal = (value) => String(value || '').trim().replace(',', '.');
    const parsePercent = (value) => {
      const v = normalizeDecimal(value);
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return null;
      if (n < 0 || n > 100) return null;
      return n;
    };

    const attachVatAddHandler = (selectEl, fallbackValue) => {
      if (!selectEl) return;
      selectEl.addEventListener('change', async () => {
        const v = String(selectEl.value || '');
        if (v !== '__add__') return;

        // Reset to previous value while we prompt
        selectEl.value = String(fallbackValue);

        const pct = await promptForVatPercent();
        if (pct === null) return;

        if (!Number.isFinite(pct)) {
          showAlert('Please enter a valid VAT percent', 'error', 'Invalid VAT');
          return;
        }

        try {
          if (typeof window.api.addVatRate !== 'function') {
            showAlert('VAT presets are not available in this build', 'error');
            return;
          }
          const created = await window.api.addVatRate(pct, null);
          const createdPct = Math.round(Number(created?.percent ?? pct));

          // Add to all VAT selects in this dialog and select it
          const salesSel = document.getElementById('quickAddSalesVat');
          const purchaseSel = document.getElementById('quickAddPurchaseVat');

          for (const sel of [salesSel, purchaseSel]) {
            if (!sel) continue;
            const exists = Array.from(sel.options || []).some(o => String(o.value) === String(createdPct));
            if (!exists) {
              const opt = document.createElement('option');
              opt.value = String(createdPct);
              opt.textContent = `${createdPct}%`;
              // Insert before the add option if present
              const addOpt = Array.from(sel.options || []).find(o => String(o.value) === '__add__');
              if (addOpt && addOpt.parentElement) {
                sel.insertBefore(opt, addOpt);
              } else {
                sel.appendChild(opt);
              }
            }
          }

          // Select new VAT in the dropdown that triggered it
          selectEl.value = String(createdPct);
          showAlert(`VAT ${createdPct}% added`, 'success');
        } catch (e) {
          showAlert('Failed to add VAT: ' + (e?.message || e), 'error', 'VAT');
        }
      });
    };

    const parsePrice = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return 0;
      const v = normalizeDecimal(raw);
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    };

    const parseStock = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return 0;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    };

    const onSave = async () => {
      const name = String(document.getElementById('quickAddName')?.value || '').trim();
      const price = parsePrice(document.getElementById('quickAddPrice')?.value);
      const salesVatPercent = parsePercent(document.getElementById('quickAddSalesVat')?.value);
      const purchaseVatPercent = parsePercent(document.getElementById('quickAddPurchaseVat')?.value);
      const stock = parseStock(document.getElementById('quickAddStock')?.value);
      const showInCheckout = document.getElementById('quickAddShowInCheckout')?.checked !== false;

      if (!name) {
        showAlert('Please enter a product name', 'error', 'Missing Name');
        return;
      }
      if (price === null) {
        showAlert('Please enter a valid price (0 or more)', 'error', 'Invalid Price');
        return;
      }
      if (salesVatPercent === null) {
        showAlert('Please enter a valid IVA de venta (0-100)', 'error', 'Invalid VAT');
        return;
      }
      if (purchaseVatPercent === null) {
        showAlert('Please enter a valid IVA de compra (0-100)', 'error', 'Invalid VAT');
        return;
      }
      if (stock === null) {
        showAlert('Stock must be a number (0 or more)', 'error', 'Invalid Stock');
        return;
      }

      // Prevent duplicate barcode
      try {
        if (typeof window.api.getProductByBarcode === 'function') {
          const existing = await window.api.getProductByBarcode(bc);
          if (existing && existing.id) {
            showAlert(`Barcode already exists for: ${existing.name || 'another product'}`, 'error', 'Duplicate Barcode');
            return;
          }
        }
      } catch {
        // ignore
      }

      const product = {
        barcode: bc,
        name,
        description: '',
        category: null,
        subcategory: null,
        show_in_checkout: showInCheckout ? 1 : 0,
        unit_type: 'quantity',
        weight_unit: 'kg',
        quantity_unit: 'piece',
        weight_amount: null,
        quantity_amount: null,
        regular_price: price,
        sale_price: null,
        discount_percent: 0,
        price,
        tax_rate: salesVatPercent / 100,
        purchase_tax_rate: purchaseVatPercent / 100,
        cost: 0,
        stock,
        min_stock: 5,
        image: null
      };

      const saveBtn = document.getElementById('quickAddSave');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.7';
      }

      try {
        const res = await window.api.addProduct(product);
        cleanup();
        resolve({ ok: true, productId: res?.id, barcode: bc });
      } catch (e) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.style.opacity = '1';
        }
        showAlert('Error saving product: ' + (e?.message || e), 'error', 'Error');
      }
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.getElementById('quickAddCancel')?.addEventListener('click', close, { once: true });
    document.getElementById('quickAddProductClose')?.addEventListener('click', close, { once: true });
    document.getElementById('quickAddSave')?.addEventListener('click', onSave);

    // Allow adding VAT rates from within the dropdown
    attachVatAddHandler(document.getElementById('quickAddSalesVat'), defaultSalesVat);
    attachVatAddHandler(document.getElementById('quickAddPurchaseVat'), defaultPurchaseVat);

    // Focus name field for fastest data entry
    setTimeout(() => {
      try {
        const nameEl = document.getElementById('quickAddName');
        if (nameEl) {
          nameEl.focus();
          nameEl.select?.();
        }
      } catch {
        // ignore
      }
    }, 0);

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        close();
      }
    });
  });
}

// ============== PAGINATION HELPERS (Products & Categories) ==============
function ensurePaginationBar({
  containerSelector,
  barId,
  onPrev,
  onNext,
  onPerPage,
  perPageOptions = [25, 50, 100, 200]
}) {
  const container = document.querySelector(containerSelector);
  if (!container) return null;

  let bar = document.getElementById(barId);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = barId;
    bar.className = 'pagination-bar';
    bar.innerHTML = `
      <div class="pagination-info" data-role="info"></div>
      <div class="pagination-controls">
        <button type="button" class="btn-secondary pagination-btn" data-role="prev">Prev</button>
        <div class="pagination-page" data-role="page"></div>
        <button type="button" class="btn-secondary pagination-btn" data-role="next">Next</button>
        <select class="pagination-size" data-role="perPage"></select>
      </div>
    `;

    // Insert above the table
    container.insertBefore(bar, container.firstChild);

    // Populate per-page options
    const select = bar.querySelector('[data-role="perPage"]');
    if (select) {
      select.innerHTML = perPageOptions.map(v => `<option value="${v}">${v}/page</option>`).join('');
    }

    // Wire events once
    bar.querySelector('[data-role="prev"]')?.addEventListener('click', () => onPrev?.());
    bar.querySelector('[data-role="next"]')?.addEventListener('click', () => onNext?.());
    bar.querySelector('[data-role="perPage"]')?.addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v)) onPerPage?.(v);
    });
  }

  return bar;
}

function updatePaginationBar(barId, { page, perPage, total }) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  const totalPages = Math.max(1, Math.ceil((total || 0) / (perPage || 1)));
  const safePage = Math.min(Math.max(1, page || 1), totalPages);
  const start = total === 0 ? 0 : ((safePage - 1) * perPage + 1);
  const end = total === 0 ? 0 : Math.min(total, safePage * perPage);

  const info = bar.querySelector('[data-role="info"]');
  const pageEl = bar.querySelector('[data-role="page"]');
  const prevBtn = bar.querySelector('[data-role="prev"]');
  const nextBtn = bar.querySelector('[data-role="next"]');
  const select = bar.querySelector('[data-role="perPage"]');

  if (info) info.textContent = `Showing ${start}-${end} of ${total}`;
  if (pageEl) pageEl.textContent = `Page ${safePage} / ${totalPages}`;
  if (prevBtn) prevBtn.disabled = safePage <= 1;
  if (nextBtn) nextBtn.disabled = safePage >= totalPages;
  if (select) select.value = String(perPage);
}

// Money/quantity helpers
function moneyToCents(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100);
}

function centsToMoney(cents) {
  const num = Number(cents);
  if (!Number.isFinite(num)) return 0;
  return num / 100;
}

function formatMoneyForUi(amount, currencySymbol = '€') {
  const n = Number(amount);
  const v = Number.isFinite(n) ? n : 0;
  return `${currencySymbol}${v.toFixed(2)}`;
}

let cashierPayOverlayTimer = null;
let pendingCashierPaySummary = null;
function showCashierPaymentSummaryOverlay({ total, paid, change, currencySymbol = '€', autoHideMs = 8000 } = {}) {
  try {
    const overlay = document.getElementById('cashierCartSummary');
    if (!overlay) return;

    const totalEl = document.getElementById('cashierCartTotal');
    const paidEl = document.getElementById('cashierCartPaid');
    const changeEl = document.getElementById('cashierCartChange');
    const methodEl = document.getElementById('cashierCartSummaryMethod');

    if (totalEl) totalEl.textContent = formatMoneyForUi(total, currencySymbol);
    if (paidEl) paidEl.textContent = formatMoneyForUi(paid, currencySymbol);
    if (changeEl) changeEl.textContent = formatMoneyForUi(change, currencySymbol);
    if (methodEl) methodEl.textContent = 'EFECTIVO';

    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');

    if (cashierPayOverlayTimer) clearTimeout(cashierPayOverlayTimer);
    cashierPayOverlayTimer = null;
  } catch {
    // ignore
  }
}

function hideCashierPaymentSummaryOverlay() {
  try {
    const overlay = document.getElementById('cashierCartSummary');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
  } catch {
    // ignore
  }
}

function queueCashierPaymentSummaryOverlay({ total, paid, change, currencySymbol = '€', autoHideMs = 8000 } = {}) {
  pendingCashierPaySummary = {
    total,
    paid,
    change,
    currencySymbol,
    autoHideMs
  };
}

function kgToGrams(kg) {
  const num = Number(kg);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 1000);
}

function gramsToKg(grams) {
  const num = Number(grams);
  if (!Number.isFinite(num)) return 0;
  return num / 1000;
}

function calcDiscountCents(lineSubtotalCents, discountPercent) {
  const pct = Number(discountPercent || 0);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round(lineSubtotalCents * (pct / 100));
}

function recalcCartItemMoney(cartItem) {
  if (!cartItem) return;

  // Normalize weight to integer grams for stable math
  if (cartItem.isWeightBased) {
    const grams = typeof cartItem.quantityGrams === 'number'
      ? cartItem.quantityGrams
      : kgToGrams(cartItem.quantity);
    cartItem.quantityGrams = grams;
    cartItem.quantity = gramsToKg(grams);
  }

  const unitPriceCents = typeof cartItem.unitPriceCents === 'number'
    ? cartItem.unitPriceCents
    : moneyToCents(cartItem.unitPrice);
  cartItem.unitPriceCents = unitPriceCents;
  cartItem.unitPrice = centsToMoney(unitPriceCents);

  let subtotalCents = 0;
  if (cartItem.isWeightBased) {
    const grams = cartItem.quantityGrams || 0;
    subtotalCents = Math.round((unitPriceCents * grams) / 1000);
  } else {
    const qty = Number(cartItem.quantity);
    subtotalCents = Number.isFinite(qty) ? Math.round(unitPriceCents * qty) : 0;
  }

  cartItem.subtotalCents = subtotalCents;
  cartItem.subtotal = centsToMoney(subtotalCents);
}

// Scale Debug Functions for Touchscreen
function addScaleDebugLog(message, type = 'info') {
  const timestamp = formatTimeWithDisplayTimeZone(new Date());
  const colors = {
    info: '#0ff',
    success: '#0f0',
    error: '#f00',
    warning: '#ff0'
  };
  scaleDebugLogs.push({ time: timestamp, message, type });
  if (scaleDebugLogs.length > 100) scaleDebugLogs.shift();
  updateScaleDebugPanel();
  console.log(`[Scale Debug] ${message}`);
}

function updateScaleDebugPanel() {
  const content = document.getElementById('scaleDebugContent');
  if (!content) return;
  const colors = {
    info: '#0ff',
    success: '#0f0',
    error: '#f00',
    warning: '#ff0'
  };
  content.innerHTML = scaleDebugLogs.map(log => 
    `<div style="color: ${colors[log.type] || '#0ff'}; margin-bottom: 5px; word-break: break-all;">[${log.time}] ${log.message}</div>`
  ).join('');
  content.scrollTop = content.scrollHeight;
}

window.toggleScaleDebug = function() {
  const panel = document.getElementById('scaleDebugPanel');
  if (!panel) return;
  scaleDebugVisible = !scaleDebugVisible;
  panel.style.display = scaleDebugVisible ? 'block' : 'none';
  if (scaleDebugVisible) {
    addScaleDebugLog('🔍 Debug panel opened', 'info');
    addScaleDebugLog('System ready for scale testing', 'success');
  }
};

// Enable debug button - Always visible after 2 seconds
document.addEventListener('DOMContentLoaded', () => {
  // Optional: keep keyboard shortcut for staff/devs if the panel exists.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      window.toggleScaleDebug();
    }
  });

  addScaleDebugLog('⚡ Application started', 'info');
});

// Role-based permissions - Only admin can manage users and system settings
const PERMISSIONS = {
  cashier: ['checkout', 'products', 'barcodes', 'sales', 'expenses', 'returns', 'inventory', 'loans', 'categories', 'settings'],
  manager: ['checkout', 'products', 'barcodes', 'sales', 'expenses', 'reports', 'analytics', 'returns', 'inventory', 'loans', 'categories', 'settings'],
  admin: ['checkout', 'products', 'barcodes', 'sales', 'expenses', 'reports', 'analytics', 'returns', 'inventory', 'loans', 'users', 'system', 'categories', 'settings']
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  showLoadingScreen();
  updateAppVersionUI();
  setupCustomerDisplayPreviewOverlay();
  setupGlobalBarcodeScannerCapture();

  // Cashier payment overlay close handlers
  try {
    const overlay = document.getElementById('cashierCartSummary');
    const closeBtn = document.getElementById('cashierCartSummaryClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => hideCashierPaymentSummaryOverlay());
    }
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideCashierPaymentSummaryOverlay();
      });
    }
  } catch {
    // ignore
  }
});

function setupCustomerDisplayPreviewOverlay() {
  try {
    // Disabled by default: hide the on-screen debug/preview overlay.
    // (Customer display output still works normally.)
    const enablePreviewOverlay = false;
    if (!enablePreviewOverlay) return;

    if (!window.api || typeof window.api.onCustomerDisplayPreview !== 'function') return;

    const ensurePanel = () => {
      let panel = document.getElementById('customerDisplayPreviewPanel');
      if (panel) return panel;

      panel = document.createElement('div');
      panel.id = 'customerDisplayPreviewPanel';
      panel.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:16px',
        'z-index:99999',
        'background:rgba(10,10,10,0.90)',
        'color:#fff',
        'border:1px solid rgba(255,255,255,0.2)',
        'border-radius:10px',
        'padding:10px 12px',
        'min-width:260px',
        'max-width:420px',
        'font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        'box-shadow:0 10px 30px rgba(0,0,0,0.35)'
      ].join(';');

      panel.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
          <div style="font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial; font-weight:700; font-size:12px; opacity:0.9;">
            Customer Display Preview
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button id="customerDisplayPreviewDebug" style="border:none; background:rgba(59,130,246,0.30); color:#fff; padding:4px 10px; border-radius:8px; cursor:pointer; font-weight:800;">DEBUG</button>
            <button id="customerDisplayPreviewClose" style="border:none; background:rgba(255,255,255,0.12); color:#fff; padding:4px 8px; border-radius:8px; cursor:pointer; font-weight:700;">×</button>
          </div>
        </div>
        <div id="customerDisplayPreviewRuler" style="opacity:0.55; font-size:12px;">|12345678901234567890|</div>
        <div id="customerDisplayPreviewL1" style="white-space:pre; font-size:14px; margin-top:4px;">|                    |</div>
        <div id="customerDisplayPreviewL2" style="white-space:pre; font-size:14px;">|                    |</div>

        <div id="customerDisplayDebugPanel" style="display:none; margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.18);">
          <div style="display:flex; gap:8px; margin-bottom:8px;">
            <button id="customerDisplayDebugReconnect" style="flex:1; border:none; background:rgba(16,185,129,0.85); color:#06281f; padding:8px 10px; border-radius:10px; cursor:pointer; font-weight:900;">RECONNECT</button>
            <button id="customerDisplayDebugRefresh" style="flex:1; border:none; background:rgba(148,163,184,0.30); color:#fff; padding:8px 10px; border-radius:10px; cursor:pointer; font-weight:900;">REFRESH</button>
          </div>
          <div style="display:flex; gap:8px; margin-bottom:8px;">
            <button id="customerDisplayDebugAuto" style="flex:1; border:none; background:rgba(245,158,11,0.85); color:#2a1b04; padding:8px 10px; border-radius:10px; cursor:pointer; font-weight:900;">AUTO</button>
            <button id="customerDisplayDebugReset" style="flex:1; border:none; background:rgba(239,68,68,0.85); color:#2a0b0b; padding:8px 10px; border-radius:10px; cursor:pointer; font-weight:900;">RESET</button>
          </div>
          <div id="customerDisplayPortButtons" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;"></div>
          <div id="customerDisplayDebugAction" style="white-space:pre-wrap; font-size:12px; opacity:0.95; line-height:1.3; color:#fde68a; margin-bottom:8px;">action: (none)</div>
          <div id="customerDisplayDebugInfo" style="white-space:pre-wrap; font-size:12px; opacity:0.95; line-height:1.3;">loading...</div>
        </div>
      `;

      document.body.appendChild(panel);

      const closeBtn = document.getElementById('customerDisplayPreviewClose');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          panel.style.display = 'none';
        });
      }

      const debugBtn = document.getElementById('customerDisplayPreviewDebug');
      const debugPanel = document.getElementById('customerDisplayDebugPanel');
      const infoEl = document.getElementById('customerDisplayDebugInfo');
      const actionEl = document.getElementById('customerDisplayDebugAction');
      const portButtonsEl = document.getElementById('customerDisplayPortButtons');
      const reconnectBtn = document.getElementById('customerDisplayDebugReconnect');
      const refreshBtn = document.getElementById('customerDisplayDebugRefresh');
      const autoBtn = document.getElementById('customerDisplayDebugAuto');
      const resetBtn = document.getElementById('customerDisplayDebugReset');

      let debugBusy = false;

      const setAction = (text) => {
        if (!actionEl) return;
        actionEl.textContent = `action: ${text || '(none)'}`;
      };

      const refreshDebugInfo = async () => {
        try {
          if (!window.api || typeof window.api.getCustomerDisplayConnectionStatus !== 'function') {
            if (infoEl) infoEl.textContent = 'debug API not available';
            return;
          }
          const st = await window.api.getCustomerDisplayConnectionStatus();

          // Build touch buttons for each detected port (COMxx)
          if (portButtonsEl) {
            portButtonsEl.innerHTML = '';

            const portsRaw = Array.isArray(st?.availablePorts) ? st.availablePorts : [];
            const entries = portsRaw
              .map((p) => {
                const portName = (p?.path || p || '').toString().trim();
                const manufacturer = (p?.manufacturer || '').toString().trim();
                return { portName, manufacturer };
              })
              .filter((x) => /^COM\d+$/i.test(x.portName))
              // Avoid COM1/COM2 (usually motherboard ports, easy to tap by mistake)
              .filter((x) => !/^COM[12]$/i.test(x.portName));

            // Deduplicate by port name
            const byName = new Map();
            for (const e of entries) {
              if (!byName.has(e.portName.toUpperCase())) byName.set(e.portName.toUpperCase(), e);
            }

            // Sort COM ports numerically
            const sorted = Array.from(byName.values()).sort((a, b) => {
              const na = Number(String(a.portName).replace(/[^0-9]/g, ''));
              const nb = Number(String(b.portName).replace(/[^0-9]/g, ''));
              return (na || 0) - (nb || 0);
            });

            for (const e of sorted) {
              const portName = e.portName;
              const manufacturer = e.manufacturer;
              const label = manufacturer ? `${portName} (${manufacturer.slice(0, 12)})` : portName;

              const btn = document.createElement('button');
              btn.textContent = label;
              btn.style.cssText = [
                'border:none',
                // Highlight Prolific ports (most likely the customer display)
                (manufacturer.toLowerCase().includes('prolific') ? 'background:rgba(16,185,129,0.30)' : 'background:rgba(255,255,255,0.10)'),
                'color:#fff',
                'padding:8px 10px',
                'border-radius:10px',
                'cursor:pointer',
                'font-weight:900',
                'min-width:110px'
              ].join(';');
              btn.addEventListener('click', async () => {
                try {
                  if (!window.api || typeof window.api.setCustomerDisplayPreferredPort !== 'function') {
                    setAction('set-port API not available');
                    return;
                  }
                  debugBusy = true;
                  setAction(`setting port: ${portName}...`);
                  const res = await window.api.setCustomerDisplayPreferredPort(portName);
                  setAction(`set port: ${res?.success ? 'OK' : 'FAIL'}\n${res?.message || ''}`);
                  await refreshDebugInfo();
                } catch (e) {
                  setAction(`set port error: ${e.message}`);
                } finally {
                  debugBusy = false;
                }
              });
              portButtonsEl.appendChild(btn);
            }
          }

          const lines = [];
          lines.push(`connected: ${!!st?.connected}`);
          lines.push(`serialPortAvailable: ${!!st?.serialPortAvailable}`);
          if (st?.preferredPort) lines.push(`preferredPort: ${st.preferredPort}`);
          if (st?.excludedPorts) lines.push(`excludedPorts: ${st.excludedPorts}`);
          if (st?.lastPortPath) lines.push(`lastPortPath: ${st.lastPortPath}`);
          if (st?.lastPortCloseAt) lines.push(`lastPortCloseAt: ${formatDateTimeWithDisplayTimeZone(new Date(st.lastPortCloseAt), 'en-GB', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })}`);
          if (st?.lastPortError) lines.push(`lastPortError: ${st.lastPortError}`);
          if (st?.lastWriteError) lines.push(`lastWriteError: ${st.lastWriteError}`);
          if (st?.error) lines.push(`error: ${st.error}`);
          if (Array.isArray(st?.availablePorts) && st.availablePorts.length) {
            lines.push(`ports: ${st.availablePorts.map(p => p.path || p).join(', ')}`);
          }
          if (infoEl) infoEl.textContent = lines.join('\n');
        } catch (e) {
          if (infoEl) infoEl.textContent = `status error: ${e.message}`;
        }
      };

      if (debugBtn && debugPanel) {
        debugBtn.addEventListener('click', async () => {
          const next = debugPanel.style.display === 'none' ? 'block' : 'none';
          debugPanel.style.display = next;
          if (next === 'block') await refreshDebugInfo();
        });
      }

      if (refreshBtn) refreshBtn.addEventListener('click', refreshDebugInfo);

      if (autoBtn) {
        autoBtn.addEventListener('click', async () => {
          try {
            if (!window.api || typeof window.api.setCustomerDisplayPreferredPort !== 'function') return;
            debugBusy = true;
            setAction('AUTO: clearing saved port...');
            const res = await window.api.setCustomerDisplayPreferredPort('');
            setAction(`AUTO: ${res?.success ? 'OK' : 'FAIL'}\n${res?.message || ''}`);
            await refreshDebugInfo();
          } catch (e) {
            setAction(`AUTO error: ${e.message}`);
          } finally {
            debugBusy = false;
          }
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
          try {
            if (!window.api || typeof window.api.resetCustomerDisplayDevice !== 'function') {
              setAction('reset API not available');
              return;
            }
            debugBusy = true;
            setAction('resetting device...');
            const res = await window.api.resetCustomerDisplayDevice();
            setAction(`reset: ${res?.success ? 'OK' : 'FAIL'}\n${res?.message || ''}`);
            await refreshDebugInfo();
          } catch (e) {
            setAction(`reset error: ${e.message}`);
          } finally {
            debugBusy = false;
          }
        });
      }

      if (reconnectBtn) {
        reconnectBtn.addEventListener('click', async () => {
          try {
            if (!window.api || typeof window.api.reconnectCustomerDisplay !== 'function') {
              if (infoEl) infoEl.textContent = 'reconnect API not available';
              return;
            }
            if (infoEl) infoEl.textContent = 'reconnecting...';
            const res = await window.api.reconnectCustomerDisplay();
            if (infoEl) infoEl.textContent = `reconnect: ${res?.success ? 'OK' : 'FAIL'}\n${res?.message || ''}`;
            await refreshDebugInfo();
          } catch (e) {
            if (infoEl) infoEl.textContent = `reconnect error: ${e.message}`;
          }
        });
      }

      // Keep debug info fresh while open
      setInterval(() => {
        if (debugPanel && debugPanel.style.display !== 'none' && !debugBusy) refreshDebugInfo();
      }, 2000);

      return panel;
    };

    window.api.onCustomerDisplayPreview((payload) => {
      const maxChars = Number(payload?.maxChars) || 20;
      const line1 = (payload?.line1 ?? '').toString();
      const line2 = (payload?.line2 ?? '').toString();

      const panel = ensurePanel();
      if (!panel) return;

      panel.style.display = 'block';

      const rulerEl = document.getElementById('customerDisplayPreviewRuler');
      const l1El = document.getElementById('customerDisplayPreviewL1');
      const l2El = document.getElementById('customerDisplayPreviewL2');
      const ruler = '12345678901234567890'.substring(0, maxChars).padEnd(maxChars, ' ');
      if (rulerEl) rulerEl.textContent = `|${ruler}|`;
      if (l1El) l1El.textContent = `|${line1.substring(0, maxChars).padEnd(maxChars, ' ')}|`;
      if (l2El) l2El.textContent = `|${line2.substring(0, maxChars).padEnd(maxChars, ' ')}|`;
    });
  } catch {
    // ignore
  }
}

async function updateAppVersionUI() {
  try {
    const el = document.getElementById('appVersion');
    if (!el) return;
    if (!window.api || typeof window.api.getAppVersion !== 'function') return;
    const v = await window.api.getAppVersion();
    if (v) el.textContent = String(v);
  } catch {
    // ignore
  }
}

function showLoadingScreen() {
  // Update loading screen with branding
  updateLoadingBranding();
  
  // Show loading screen for 3 seconds
  setTimeout(() => {
    // Hide loading screen
    document.getElementById('loadingScreen').classList.remove('active');

    // Initialize app after loading screen
    initializeApp().catch((e) => console.error('Init error:', e));
  }, 3000); // 3 seconds
}

async function updateLoadingBranding() {
  try {
    const systemSettings = await window.api.getSystemSettings();
    const storeName = systemSettings?.store_name || 'Supermarket POS';
    const storeLogo = systemSettings?.store_logo || '';
    
    const hasLogo = storeLogo && storeLogo.trim() !== '';
    const isImage = hasLogo && storeLogo.startsWith('data:image');
    
    const loadingLogo = document.getElementById('loadingLogo');
    const loadingTitle = document.getElementById('loadingTitle');
    
    if (loadingLogo && loadingTitle) {
      if (hasLogo) {
        loadingLogo.style.display = 'flex';
        loadingTitle.style.display = 'none';
        if (isImage) {
          loadingLogo.innerHTML = `<img src="${storeLogo}" alt="Logo">`;
        } else {
          loadingLogo.textContent = storeLogo;
        }
      } else {
        loadingLogo.style.display = 'none';
        loadingTitle.style.display = 'block';
        loadingTitle.textContent = storeName;
      }
    }
  } catch (error) {
    console.error('Error updating loading branding:', error);
  }
}

let appInitialized = false;

function setupActivationHandlers() {
  const input = document.getElementById('activationKeyInput');
  const btn = document.getElementById('activateBtn');
  const err = document.getElementById('activationError');

  const setError = (text) => {
    if (!err) return;
    if (!text) {
      err.style.display = 'none';
      err.textContent = '';
      return;
    }
    err.style.display = 'block';
    err.textContent = String(text);
  };

  const doActivate = async () => {
    setError('');
    if (!window.api || typeof window.api.activateApp !== 'function') {
      setError('Activation API not available.');
      return;
    }
    const key = (input?.value || '').toString().trim();
    const result = await window.api.activateApp(key);
    if (result?.success) {
      setError('');
      // Continue boot into login
      await initializeApp();
    } else {
      setError(result?.error || 'Activation failed');
    }
  };

  if (btn) {
    btn.onclick = () => {
      doActivate().catch((e) => setError(e.message));
    };
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doActivate().catch((err) => setError(err.message));
      }
    });
  }
}

async function initializeApp() {
  applyKeyboardModeUi();
  // On-screen keyboard (safe if DOM doesn't include it)
  try { setupVirtualKeyboard(); } catch { /* ignore */ }
  // Always wire activation handlers (safe to call multiple times)
  setupActivationHandlers();
  await updateAppVersionUI();
  try {
    const el = document.getElementById('activationAppVersion');
    if (el && window.api && typeof window.api.getAppVersion === 'function') {
      const v = await window.api.getAppVersion();
      if (v) el.textContent = String(v);
    }
  } catch {
    // ignore
  }

  // Check activation status
  try {
    if (window.api && typeof window.api.getActivationStatus === 'function') {
      const st = await window.api.getActivationStatus();
      if (!st?.activated) {
        showScreen('activationScreen');
        const input = document.getElementById('activationKeyInput');
        if (input) {
          // Ensure the on-screen keyboard appears reliably on touch devices.
          setTimeout(() => {
            try {
              window.__virtualKeyboardForceOpen = true;
              input.focus();
              input.dispatchEvent(new Event('focusin', { bubbles: true }));
            } catch {
              // ignore
            }
          }, 50);
        }
        return;
      }
    }
  } catch {
    // If activation check fails, default to requiring activation
    showScreen('activationScreen');
    return;
  }

  // Proceed with normal app init only once
  if (appInitialized) {
    showScreen('loginScreen');
    return;
  }
  appInitialized = true;

  showScreen('loginScreen');

  loadUserRoles(); // Load users dynamically for role selection
  setupLoginHandlers();
  setupNavigationHandlers();
  setupCheckoutHandlers();
  setupProductHandlers();
  setupUserHandlers();
  setupCategoryHandlers();
  setupSubcategoryHandlers();
  setupSystemSettingsHandlers();
  setupLoanHandlers();
  setupReturnsHandlers();
  setupZReportHandlers();
  setupModalHandlers();
  updateDateTime();
  setInterval(updateDateTime, 1000);
  
  // Load and display branding (logo/name)
  updateBrandingUI();
}

// ============== BRANDING UPDATE ==============
async function updateBrandingUI() {
  try {
    // Load system settings if not already loaded
    if (!systemSettings) {
      systemSettings = await window.api.getSystemSettings();
    }
    
    const storeName = systemSettings?.store_name || 'Supermarket POS';
    const storeLogo = systemSettings?.store_logo || '';
    
    // Check if logo exists
    const hasLogo = storeLogo && storeLogo.trim() !== '';
    const isImage = hasLogo && storeLogo.startsWith('data:image');
    
    // Update login page
    const loginLogo = document.getElementById('loginLogo');
    const loginTitle = document.getElementById('loginTitle');
    if (loginLogo && loginTitle) {
      if (hasLogo) {
        // Show logo, hide name
        loginLogo.style.display = 'flex';
        loginTitle.style.display = 'none';
        if (isImage) {
          loginLogo.innerHTML = `<img src="${storeLogo}" alt="Logo">`;
        } else {
          loginLogo.textContent = storeLogo;
        }
      } else {
        // Show name, hide logo
        loginLogo.style.display = 'none';
        loginTitle.style.display = 'block';
        loginTitle.textContent = storeName;
      }
    }
    
    // Update navbar
    const navbarLogo = document.getElementById('navbarLogo');
    const navbarTitle = document.getElementById('navbarTitle');
    if (navbarLogo && navbarTitle) {
      if (hasLogo) {
        // Show logo, hide name
        navbarLogo.style.display = 'flex';
        navbarTitle.style.display = 'none';
        if (isImage) {
          navbarLogo.innerHTML = `<img src="${storeLogo}" alt="Logo">`;
        } else {
          navbarLogo.textContent = storeLogo;
        }
      } else {
        // Show name, hide logo
        navbarLogo.style.display = 'none';
        navbarTitle.style.display = 'block';
        navbarTitle.textContent = storeName;
      }
    }
  } catch (error) {
    console.error('Error updating branding:', error);
  }
}

// ============== DYNAMIC USER ROLE LOADING ==============
async function loadUserRoles() {
  try {
    const users = await window.api.getAllUsers();
    const container = document.getElementById('userRolesContainer');
    
    if (!container) return;
    
    // Clear existing buttons
    container.innerHTML = '';
    
    if (users.length === 0) {
      container.innerHTML = '<p style="color: white; text-align: center;">No users found. Please set up users first.</p>';
      return;
    }
    
    // Create a button for each user
    users.forEach(user => {
      const button = document.createElement('button');
      button.className = `role-select-btn ${user.role}-role`;
      button.dataset.userId = user.id;
      button.dataset.username = user.username;
      button.dataset.fullName = user.full_name;
      button.dataset.role = user.role;
      
      // Select icon based on role
      let icon = '👤';
      if (user.role === 'admin') icon = '👨‍💼';
      else if (user.role === 'manager') icon = '👔';
      else if (user.role === 'cashier') icon = '💰';
      
      button.innerHTML = `
        <span class="role-icon">${icon}</span>
        <div class="role-info">
          <span class="role-name">${user.full_name}</span>
          <span class="role-badge">${user.role.toUpperCase()}</span>
        </div>
      `;
      
      // Add click handler
      button.addEventListener('click', () => {
        selectUser(user).catch((e) => {
          console.error('Select user error:', e);
          showAlert('Login failed. Please try again.', 'error', 'Error');
        });
      });
      
      container.appendChild(button);
    });
  } catch (error) {
    console.error('Error loading user roles:', error);
    showAlert('Failed to load users', 'error');
  }
}

// ============== USER SELECTION ==============
// Master password (requested): if entered for Admin/Manager login, bypasses per-user password.
// WARNING: Anyone who knows this value can access admin/manager features.
const MASTER_ROLE_BYPASS_PASSWORD = '1@23';

async function promptForRolePassword(user) {
  const role = String(user?.role || '').toLowerCase();
  const roleLabel = role ? role.toUpperCase() : 'USER';
  const name = (user?.full_name || user?.username || '').toString();

  const existing = document.getElementById('rolePasswordOverlay');
  if (existing) existing.remove();

  return await new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'rolePasswordOverlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.55)',
      'padding:18px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      // Keep below the on-screen keyboard so it remains tappable/usable.
      'z-index:10001',
      'overflow:auto'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(560px, 96vw)',
      'background:#fff',
      'border-radius:22px',
      'box-shadow:0 18px 60px rgba(0,0,0,0.35)',
      'padding:22px 16px'
    ].join(';');

    card.innerHTML = `
      <div style="text-align:center; font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;">
        <div style="font-size:24px; font-weight:900; color:#0f172a; margin-bottom:4px;">${roleLabel} Access</div>
        <div style="font-size:14px; color:#64748b; margin-bottom:14px;">Enter password for ${name}</div>

        <!-- Password display (dots) -->
        <div id="rolePasswordDisplay" style="width:min(320px,78vw); margin:0 auto 14px auto; font-size:28px; letter-spacing:10px; text-align:center; padding:12px 14px; border-radius:14px; border:2px solid #cbd5e1; background:#f8fafc; min-height:54px; color:#0f172a;">&#8203;</div>
        <input id="rolePasswordInput" type="hidden" value="" />

        <!-- Built-in keyboard: numbers + letters -->
        <div style="margin-bottom:16px;">
          <!-- Number row -->
          <div style="display:flex; justify-content:center; gap:6px; margin-bottom:6px;">
            ${[1,2,3,4,5,6,7,8,9,0].map(n=>`<button onclick="roleKbKey('${n}')" style="width:46px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:18px;font-weight:700;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1);">${n}</button>`).join('')}
          </div>
          <!-- QWERTY rows -->
          ${[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['z','x','c','v','b','n','m']].map(row=>`
          <div style="display:flex; justify-content:center; gap:6px; margin-bottom:6px;">
            ${row.map(k=>`<button onclick="roleKbKey('${k}')" style="width:46px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:16px;font-weight:600;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1);">${k}</button>`).join('')}
          </div>`).join('')}
          <!-- Bottom row: SHIFT + special chars + backspace -->
          <div style="display:flex; justify-content:center; gap:6px; margin-bottom:2px;">
            <button onclick="roleKbShift()" id="roleKbShiftBtn" style="padding:0 14px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#e2e8f0;font-size:13px;font-weight:700;cursor:pointer;">⇧ SHIFT</button>
            <button onclick="roleKbKey('@')" style="width:46px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:16px;cursor:pointer;">@</button>
            <button onclick="roleKbKey('.')" style="width:46px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:16px;cursor:pointer;">.</button>
            <button onclick="roleKbKey('_')" style="width:46px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:16px;cursor:pointer;">_</button>
            <button onclick="roleKbKey('-')" style="width:46px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:16px;cursor:pointer;">-</button>
            <button onclick="roleKbKey(' ')" style="padding:0 20px;height:46px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:13px;cursor:pointer;">SPACE</button>
            <button onclick="roleKbBack()" style="padding:0 14px;height:46px;border-radius:10px;border:1px solid #f87171;background:#fee2e2;font-size:18px;cursor:pointer;">⌫</button>
          </div>
        </div>

        <div style="display:flex; gap:12px; justify-content:center;">
          <button id="rolePasswordCancel" style="flex:1; max-width:180px; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:#94a3b8; color:#fff; cursor:pointer;">Cancel</button>
          <button id="rolePasswordOk"     style="flex:1; max-width:180px; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:#0ea5e9; color:#fff; cursor:pointer;">Continue</button>
        </div>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const input = document.getElementById('rolePasswordInput');
    const okBtn = document.getElementById('rolePasswordOk');
    const cancelBtn = document.getElementById('rolePasswordCancel');

    // Suppress virtual keyboard for this overlay
    let _roleKbShifted = false;
    window.roleKbKey = (k) => {
      const ch = _roleKbShifted ? k.toUpperCase() : k;
      input.value += ch;
      const disp = document.getElementById('rolePasswordDisplay');
      if (disp) disp.textContent = '●'.repeat(input.value.length) || '\u200b';
    };
    window.roleKbBack = () => {
      input.value = input.value.slice(0, -1);
      const disp = document.getElementById('rolePasswordDisplay');
      if (disp) disp.textContent = '●'.repeat(input.value.length) || '\u200b';
    };
    window.roleKbShift = () => {
      _roleKbShifted = !_roleKbShifted;
      const btn = document.getElementById('roleKbShiftBtn');
      if (btn) { btn.style.background = _roleKbShifted ? '#0ea5e9' : '#e2e8f0'; btn.style.color = _roleKbShifted ? '#fff' : '#0f172a'; }
    };

    // Prevent system virtual keyboard from opening
    const keyboardEl = document.getElementById('virtualKeyboard');
    let keyboardObserver = null;
    let resizeHandler = null;

    const syncKeyboardInset = () => {
      try {
        const basePadding = 18;
        if (!keyboardEl) {
          overlay.style.paddingBottom = `${basePadding}px`;
          return;
        }
        const isActive = keyboardEl.classList.contains('active');
        if (!isActive) {
          overlay.style.paddingBottom = `${basePadding}px`;
          return;
        }
        const rect = keyboardEl.getBoundingClientRect();
        const kbHeight = Math.max(0, Math.round(rect.height || 0));
        overlay.style.paddingBottom = `${basePadding + kbHeight}px`;
      } catch {
        // ignore
      }
    };

    const cleanup = (result) => {
      try { document.removeEventListener('keydown', keydownHandler, true); } catch { /* ignore */ }
      try { keyboardObserver?.disconnect?.(); } catch { /* ignore */ }
      try { if (resizeHandler) window.removeEventListener('resize', resizeHandler, true); } catch { /* ignore */ }
      try { overlay.remove(); } catch { /* ignore */ }
      // Clean up globals
      delete window.roleKbKey;
      delete window.roleKbBack;
      delete window.roleKbShift;
      resolve(result);
    };

    const submit = () => {
      const pwd = (input?.value || '').toString();
      cleanup(pwd);
    };

    // Return the typed password, but allow master bypass value to be entered as well.
    // (Logic is handled in selectUser.)

    const keydownHandler = (e) => {
      try {
        if (!document.getElementById('rolePasswordOverlay')) return;
        const k = String(e.key || '');
        if (k === 'Escape') {
          e.preventDefault();
          cleanup(null);
          return;
        }
        if (k === 'Enter') {
          e.preventDefault();
          submit();
        }
      } catch {
        // ignore
      }
    };

    document.addEventListener('keydown', keydownHandler, true);

    // Keep modal positioned above the virtual keyboard while it opens/closes.
    try {
      syncKeyboardInset();
      if (keyboardEl && typeof MutationObserver !== 'undefined') {
        keyboardObserver = new MutationObserver(() => syncKeyboardInset());
        keyboardObserver.observe(keyboardEl, { attributes: true, attributeFilter: ['class', 'style'] });
      }
      resizeHandler = () => syncKeyboardInset();
      window.addEventListener('resize', resizeHandler, true);
    } catch {
      // ignore
    }

    if (cancelBtn) cancelBtn.addEventListener('click', () => cleanup(null), { once: true });
    if (okBtn) okBtn.addEventListener('click', submit);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(null);
    });

    setTimeout(() => {
      try {
        window.__virtualKeyboardForceOpen = true;
        input?.focus?.();
        input?.select?.();
        syncKeyboardInset();
      } catch {
        // ignore
      }
    }, 30);
  });
}

async function selectUser(user) {
  const role = String(user?.role || '').toLowerCase();
  const requiresPassword = role === 'admin' || role === 'manager';

  if (requiresPassword) {
    const password = await promptForRolePassword(user);
    if (password == null) return; // cancelled
    if (!password.trim()) {
      showAlert('Password is required.', 'warning', 'Login');
      return;
    }

    // Master bypass
    if (String(password) === MASTER_ROLE_BYPASS_PASSWORD) {
      // Allow access without changing the user's stored password.
    } else {
      const authed = await window.api.authenticateUser(user.username, password);
      if (!authed || !authed.id) {
        showAlert('Incorrect password.', 'error', 'Access Denied');
        return;
      }

      // Use the authenticated user record (no password included).
      user = authed;
    }
  }

  // Set current user
  currentUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
    name: user.full_name
  };
  
  showScreen('posScreen');
  
  // Display user info with role badge
  const roleBadgeClass = user.role;
  document.getElementById('currentUser').innerHTML = `
    <span>${user.full_name}</span>
    <span class="user-role-badge ${roleBadgeClass}">${user.role.toUpperCase()}</span>
  `;
  
  // Setup UI based on role
  setupRoleBasedUI();
  
  // Hide navbar initially for checkout view
  toggleNavbarForView('checkout');
  
  // Load initial view
  loadAllProducts();
  loadCheckoutView();
}

// ============== LOGIN ==============
function setupLoginHandlers() {
  // Login handlers are now handled by dynamic user buttons in loadUserRoles()
  // This function is kept for compatibility
}

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  logoutToLoginScreen();
});

function logoutToLoginScreen() {
  currentUser = null;
  cart = [];
  showScreen('loginScreen');
  // Reload user roles when returning to login screen
  loadUserRoles();
}

// ============== DEVELOPER PIN ==============
let _devPinCallback = null;
let _devPinValue = '';
let _devPinPrevView = 'checkout';

function showDeveloperPinPrompt(onSuccess) {
  _devPinCallback = onSuccess;
  _devPinPrevView = _currentView;
  _devPinValue = '';
  _devPinUpdateDisplay();
  document.getElementById('devPinError').textContent = '';
  const overlay = document.getElementById('devPinOverlay');
  overlay.style.display = 'flex';
}

function devPinKey(key) {
  if (key === 'back') {
    _devPinValue = _devPinValue.slice(0, -1);
  } else {
    if (_devPinValue.length >= 8) return;
    _devPinValue += key;
  }
  document.getElementById('devPinError').textContent = '';
  _devPinUpdateDisplay();
}

function _devPinUpdateDisplay() {
  const el = document.getElementById('devPinDisplay');
  el.textContent = _devPinValue ? '●'.repeat(_devPinValue.length) : '​';
}

async function devPinConfirm() {
  if (!_devPinValue) return;
  try {
    const settings = await window.api.getSystemSettings();
    const storedPin = String(settings?.developer_pin || '1234');
    if (_devPinValue === storedPin) {
      document.getElementById('devPinOverlay').style.display = 'none';
      if (typeof _devPinCallback === 'function') _devPinCallback();
      _devPinCallback = null;
    } else {
      document.getElementById('devPinError').textContent = 'Incorrect PIN. Try again.';
      _devPinValue = '';
      _devPinUpdateDisplay();
    }
  } catch {
    document.getElementById('devPinError').textContent = 'Error checking PIN.';
  }
}

function devPinCancel() {
  // The view was never switched (PIN is checked before any DOM change),
  // so cancelling just closes the overlay and stays on the current page.
  document.getElementById('devPinOverlay').style.display = 'none';
  _devPinCallback = null;
  _devPinValue = '';
}

// Switches the active view DOM + nav button and loads its data.
function _activateView(view) {
  const navBtns = document.querySelectorAll('.tab-btn');
  navBtns.forEach(b => b.classList.remove('active'));
  const targetBtn = document.querySelector(`[data-view="${view}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`${view}View`);
  if (el) el.classList.add('active');

  toggleNavbarForView(view);
  loadViewData(view);
}

async function saveDeveloperPin() {
  const input = document.getElementById('developerPinNew');
  const pin = (input?.value || '').trim();
  if (!pin) { alert('Please enter a new PIN.'); return; }
  if (!/^\d+$/.test(pin)) { alert('PIN must contain digits only.'); return; }
  if (pin.length < 4) { alert('PIN must be at least 4 digits.'); return; }
  try {
    await window.api.setDeveloperPin(pin);
    input.value = '';
    alert('Developer PIN updated successfully.');
  } catch (e) {
    alert('Error saving PIN: ' + e.message);
  }
}

// ============== ROLE-BASED UI ==============
function setupRoleBasedUI() {
  const userRole = currentUser.role;
  const allowedViews = PERMISSIONS[userRole] || [];
  
  // Hide/show navigation buttons based on role
  const navBtns = document.querySelectorAll('.tab-btn');
  navBtns.forEach(btn => {
    const view = btn.dataset.view;
    if (allowedViews.includes(view)) {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  });
  
  // Hide/show settings menu items based on role
  const menuItems = document.querySelectorAll('.settings-menu-item');
  menuItems.forEach(item => {
    const view = item.dataset.view;
    if (allowedViews.includes(view)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });

  // Sync checkout menu bar visibility
  document.querySelectorAll('#checkoutMenuBar .cmb-btn[data-co-view]').forEach(btn => {
    btn.hidden = !allowedViews.includes(btn.dataset.coView);
  });

  // Extra hardening: hide Users UI completely for non-admin roles
  try {
    const canSeeUsers = allowedViews.includes('users');
    const usersMenuBtn = document.getElementById('usersMenuBtn');
    const usersSettingsCard = document.getElementById('usersSettingsCard');
    const usersView = document.getElementById('usersView');

    if (usersMenuBtn) usersMenuBtn.style.display = canSeeUsers ? 'flex' : 'none';
    if (usersSettingsCard) usersSettingsCard.style.display = canSeeUsers ? 'flex' : 'none';
    if (usersView) usersView.style.display = canSeeUsers ? '' : 'none';
  } catch {
    // ignore
  }
  
  // Set first available view as active
  const firstAllowedView = allowedViews[0];
  navBtns.forEach(btn => btn.classList.remove('active'));
  const firstBtn = document.querySelector(`[data-view="${firstAllowedView}"]`);
  if (firstBtn) {
    firstBtn.classList.add('active');
  }
  
  // Show first allowed view
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const firstView = document.getElementById(`${firstAllowedView}View`);
  if (firstView) {
    firstView.classList.add('active');
  }
  
  // Load the appropriate view
  loadViewData(firstAllowedView);
}

function hasPermission(view) {
  if (!currentUser) return false;
  const allowedViews = PERMISSIONS[currentUser.role] || [];
  return allowedViews.includes(view);
}

function loadViewData(view) {
  switch(view) {
    case 'settings':
      // Settings view doesn't need to load data, just setup cards
      setupSettingsCards();
      break;
    case 'checkout':
      loadCheckoutView();
      break;
    case 'products':
      if (hasPermission('products')) loadProductsView();
      break;
    case 'barcodes':
      if (hasPermission('barcodes')) loadBarcodesView();
      break;
    case 'sales':
      if (hasPermission('sales')) loadSalesView();
      break;
    case 'reports':
      if (hasPermission('reports')) {
        openArqueoOverlay();
      }
      break;
    case 'expenses':
      loadExpensesView();
      break;
    case 'analytics':
      if (hasPermission('analytics')) loadAnalyticsView();
      break;
    case 'returns':
      if (hasPermission('sales')) loadReturnsView();
      break;
    case 'inventory':
      if (hasPermission('inventory')) loadInventoryView();
      break;
    case 'loans':
      if (hasPermission('loans')) loadLoansView('active');
      break;
    case 'system':
      if (hasPermission('system')) loadSystemSettingsView();
      break;
    case 'users':
      if (hasPermission('users')) loadUsersView();
      break;
    case 'categories':
      if (hasPermission('categories')) loadCategoriesView();
      break;
  }
}

function navigateToView(view) {
  try {
    if (!hasPermission(view)) {
      showAlert('You do not have permission to access this section.', 'warning', 'Access Denied');
      return;
    }

    // Always require PIN for system view — never touch DOM until confirmed
    if (view === 'system') {
      showDeveloperPinPrompt(() => _activateView('system'));
      return;
    }

    _currentView = view;
    _activateView(view);
  } catch {
    // ignore
  }
}

// ============== BARCODE LIST VIEW ==============
let barcodeListState = {
  observer: null,
  renderedIds: new Set(),
  list: [],
  selected: new Map(), // productId -> qty
  printing: false
};

function updateBarcodeBulkUi() {
  try {
    const selectedEl = document.getElementById('barcodeBulkSelected');
    const totalLabelsEl = document.getElementById('barcodeBulkTotalLabels');
    const statusEl = document.getElementById('barcodeBulkStatus');
    const printBtn = document.getElementById('barcodeBulkPrintBtn');
    const clearBtn = document.getElementById('barcodeBulkClearBtn');

    const selectedCount = barcodeListState.selected instanceof Map ? barcodeListState.selected.size : 0;
    let totalLabels = 0;
    if (barcodeListState.selected instanceof Map) {
      for (const qty of barcodeListState.selected.values()) {
        const n = parseInt(qty, 10);
        if (Number.isFinite(n) && n > 0) totalLabels += n;
      }
    }

    if (selectedEl) selectedEl.textContent = String(selectedCount);
    if (totalLabelsEl) totalLabelsEl.textContent = String(totalLabels);
    if (statusEl && !barcodeListState.printing) statusEl.textContent = '';

    const disabled = barcodeListState.printing || selectedCount === 0;
    if (printBtn) printBtn.disabled = disabled;
    if (clearBtn) clearBtn.disabled = barcodeListState.printing || selectedCount === 0;
  } catch {
    // ignore
  }
}

async function bulkPrintSelectedBarcodes() {
  if (barcodeListState.printing) return;

  if (!window.api?.printBarcodeLabel) {
    showAlert('Barcode label printing is not available in this build', 'error', 'Print');
    return;
  }

  const entries = Array.from((barcodeListState.selected instanceof Map) ? barcodeListState.selected.entries() : []);
  if (entries.length === 0) {
    showAlert('Please select up to 20 products to print', 'warning', 'Print');
    return;
  }

  // Enforce max 20 distinct products
  if (entries.length > 20) {
    showAlert('You can print max 20 products at a time', 'warning', 'Print');
    return;
  }

  const currencySymbol = systemSettings?.currency_symbol || '€';
  const jobs = [];
  const labelDefaults = {
    // Force HTML so the printer respects the label layout instead of
    // falling back to full-width receipt-style raw printing.
    labelPrintMode: 'html',
    // Layout to match the working sample label.
    labelLayout: 'pvp-right',
    labelMmWidth: 57,
    labelMmHeight: 32
  };
  for (const [productIdRaw, qtyRaw] of entries) {
    const productId = Number(productIdRaw);
    const qty = Math.max(1, Math.min(99, parseInt(qtyRaw, 10) || 1));
    const product = barcodeListState.list.find(p => p && Number(p.id) === productId);
    if (!product) continue;

    const barcode = String(product.barcode || '').replace(/\s+/g, '').trim();
    const name = String(product.name || '').trim();
    const price = Number(product.price);

    if (!barcode || !name) continue;
    for (let i = 0; i < qty; i++) {
      jobs.push({ barcode, name, price, currencySymbol, ...labelDefaults });
    }
  }

  if (jobs.length === 0) {
    showAlert('Selected products have no barcodes to print', 'warning', 'Print');
    return;
  }

  barcodeListState.printing = true;
  updateBarcodeBulkUi();

  const statusEl = document.getElementById('barcodeBulkStatus');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < jobs.length; i++) {
      if (statusEl) statusEl.textContent = `Printing ${i + 1}/${jobs.length}...`;
      const res = await window.api.printBarcodeLabel(jobs[i]);
      if (res && res.success === false) {
        throw new Error(res.error || res.message || 'Print failed');
      }
      // Small delay to avoid printer spooler congestion
      await sleep(180);
    }
    if (statusEl) statusEl.textContent = '';
    showAlert('Barcode labels sent to printer', 'success', 'Print');
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    showAlert(String(e?.message || e || 'Print failed'), 'error', 'Print');
  } finally {
    barcodeListState.printing = false;
    updateBarcodeBulkUi();
  }
}

function ensureBarcodeListObserver() {
  if (barcodeListState.observer) return barcodeListState.observer;
  if (typeof IntersectionObserver !== 'function') return null;
  barcodeListState.observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const barcode = el?.dataset?.barcode;
      if (!barcode) continue;
      const svg = el.querySelector('svg');
      if (svg) renderBarcodeToSvg(svg, barcode, { height: 86, width: 2, displayValue: false });
      try { barcodeListState.observer.unobserve(el); } catch { /* ignore */ }
    }
  }, { root: null, threshold: 0.12 });
  return barcodeListState.observer;
}

function renderBarcodeList(items, query = '') {
  const container = document.getElementById('barcodeListContainer');
  if (!container) return;

  const q = String(query || '').trim().toLowerCase();
  const filtered = q
    ? items.filter(p =>
        (p._lcName || '').includes(q) ||
        (p._lcBarcode || '').includes(q)
      )
    : items;

  if (!filtered.length) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 30px; color:#64748b; font-weight:800;">No barcodes found</div>';
    return;
  }

  container.innerHTML = filtered.map(p => {
    const bc = String(p.barcode || '').replace(/\s+/g, '').trim();
    const safeName = String(p.name || '').trim();
    const show = bc ? '' : 'opacity:0.55;';
    const selectedQty = (barcodeListState.selected instanceof Map) ? (barcodeListState.selected.get(Number(p.id)) || 0) : 0;
    const isSelected = selectedQty > 0;
    return `
      <div class="barcode-card" data-product-id="${p.id}" data-barcode="${bc}" style="${show}">
        <div class="barcode-card-controls" aria-label="Bulk print controls">
          <input class="barcode-select" type="checkbox" data-product-id="${p.id}" ${isSelected ? 'checked' : ''} ${bc ? '' : 'disabled'} title="Select (max 20)" />
          <select class="barcode-qty" data-product-id="${p.id}" ${isSelected ? '' : 'disabled'} title="Quantity">
            ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}" ${Number(selectedQty || 1) === n ? 'selected' : ''}>×${n}</option>`).join('')}
          </select>
        </div>
        <div class="barcode-card-title">${safeName}</div>
        <div class="barcode-card-preview">
          <svg style="width:100%; height:120px;"></svg>
        </div>
        <div class="barcode-card-code">${bc || '(no barcode)'}</div>
      </div>
    `;
  }).join('');

  const obs = ensureBarcodeListObserver();
  const cards = Array.from(container.querySelectorAll('.barcode-card'));
  for (const card of cards) {
    const bc = card.dataset.barcode;
    if (!bc) continue;
    if (obs) {
      try { obs.observe(card); } catch { /* ignore */ }
    } else {
      const svg = card.querySelector('svg');
      if (svg) renderBarcodeToSvg(svg, bc, { height: 86, width: 2, displayValue: false });
    }
  }

  // Tap/click card => open full-screen overlay
  if (!container.dataset.listenerAttached) {
    container.dataset.listenerAttached = '1';
    container.addEventListener('click', (e) => {
      // Ignore clicks on the bulk controls
      if (e.target?.closest?.('.barcode-card-controls, .barcode-select, .barcode-qty')) return;
      const card = e.target?.closest?.('.barcode-card');
      if (!card) return;
      const bc = String(card.dataset.barcode || '').trim();
      const productId = Number(card.dataset.productId);
      const product = barcodeListState.list.find(x => x && Number(x.id) === productId);
      showBarcodeOverlay({ barcode: bc, name: product?.name || '' });
    });

    // Selection / qty handlers
    container.addEventListener('change', (e) => {
      const cb = e.target?.closest?.('.barcode-select');
      if (cb) {
        const id = Number(cb.dataset.productId);
        const card = cb.closest('.barcode-card');
        const bc = String(card?.dataset?.barcode || '').trim();
        if (!id || !Number.isFinite(id)) return;
        if (!bc) {
          cb.checked = false;
          showAlert('This product has no barcode', 'warning', 'Print');
          return;
        }

        if (cb.checked) {
          // Enforce max 20
          if (barcodeListState.selected.size >= 20 && !barcodeListState.selected.has(id)) {
            cb.checked = false;
            showAlert('Max 20 products can be selected for bulk print', 'warning', 'Print');
            return;
          }
          if (!barcodeListState.selected.has(id)) barcodeListState.selected.set(id, 1);
        } else {
          barcodeListState.selected.delete(id);
        }

        // Enable/disable qty selector
        const qtySel = card?.querySelector?.('.barcode-qty');
        if (qtySel) qtySel.disabled = !cb.checked;
        updateBarcodeBulkUi();
        return;
      }

      const qtySel = e.target?.closest?.('.barcode-qty');
      if (qtySel) {
        const id = Number(qtySel.dataset.productId);
        if (!Number.isFinite(id)) return;
        const qty = parseInt(qtySel.value, 10);
        if (barcodeListState.selected.has(id)) {
          barcodeListState.selected.set(id, Number.isFinite(qty) && qty > 0 ? qty : 1);
          updateBarcodeBulkUi();
        }
      }
    });
  }

  updateBarcodeBulkUi();
}

async function loadBarcodesView() {
  try {
    // Load lite products list
    const list = await (window.api.getAllProductsLite ? window.api.getAllProductsLite() : window.api.getAllProducts());
    const items = Array.isArray(list) ? list : [];
    for (const p of items) {
      if (!p) continue;
      if (typeof p._lcName !== 'string') p._lcName = String(p.name || '').toLowerCase();
      if (typeof p._lcBarcode !== 'string') p._lcBarcode = String(p.barcode || '').toLowerCase();
    }
    barcodeListState.list = items;

    // Reset selection when (re)loading the view
    if (!(barcodeListState.selected instanceof Map)) barcodeListState.selected = new Map();
    barcodeListState.selected.clear();
    barcodeListState.printing = false;

    const search = document.getElementById('barcodeListSearch');
    renderBarcodeList(items, search?.value || '');

    // Bulk toolbar handlers
    const printBtn = document.getElementById('barcodeBulkPrintBtn');
    if (printBtn && !printBtn.dataset.listenerAttached) {
      printBtn.dataset.listenerAttached = '1';
      printBtn.addEventListener('click', () => bulkPrintSelectedBarcodes());
    }
    const clearBtn = document.getElementById('barcodeBulkClearBtn');
    if (clearBtn && !clearBtn.dataset.listenerAttached) {
      clearBtn.dataset.listenerAttached = '1';
      clearBtn.addEventListener('click', () => {
        try {
          barcodeListState.selected.clear();
          renderBarcodeList(barcodeListState.list, document.getElementById('barcodeListSearch')?.value || '');
          updateBarcodeBulkUi();
        } catch {
          // ignore
        }
      });
    }
    updateBarcodeBulkUi();

    // Handlers
    const backBtn = document.getElementById('barcodeListBackBtn');
    if (backBtn && !backBtn.dataset.listenerAttached) {
      backBtn.dataset.listenerAttached = '1';
      backBtn.addEventListener('click', () => navigateToView('products'));
    }
    if (search && !search.dataset.listenerAttached) {
      search.dataset.listenerAttached = '1';
      let t = null;
      search.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => renderBarcodeList(barcodeListState.list, search.value), 90);
      });
    }
  } catch (e) {
    showAlert(String(e?.message || e || 'Failed to load barcode list'), 'error');
  }
}

// ============== NAVIGATION ==============
function setupNavigationHandlers() {
  const navBtns = document.querySelectorAll('.tab-btn');
  const topNavbar = document.getElementById('topNavbar');
  
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      
      // Reports: open Arqueo overlay directly, don't switch view
      if (view === 'reports') {
        if (!hasPermission('reports')) {
          showAlert('You do not have permission to access this section.', 'warning', 'Access Denied');
          return;
        }
        openArqueoOverlay();
        return;
      }
      
      // Check permission
      if (!hasPermission(view)) {
        showAlert('You do not have permission to access this section.', 'warning', 'Access Denied');
        return;
      }

      // System: require developer PIN every time before showing the page
      if (view === 'system') {
        showDeveloperPinPrompt(() => _activateView('system'));
        return;
      }

      _currentView = view;
      _activateView(view);
    });
  });
  
  // Setup settings dropdown
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsMenu = document.getElementById('settingsMenu');
  const settingsMenuItems = document.querySelectorAll('.settings-menu-item');
  
  if (settingsBtn) {
    // Navigate to settings page instead of dropdown
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Show settings view
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('settingsView').classList.add('active');
      
      // Toggle navbar visibility
      toggleNavbarForView('settings');
      
      // Setup settings cards if not already done
      setupSettingsCards();
    });
  }
  
  // Setup settings page cards
  function setupSettingsCards() {
    const settingsCards = document.querySelectorAll('.settings-card');
    const userRole = currentUser ? currentUser.role : null;
    const allowedViews = userRole ? (PERMISSIONS[userRole] || []) : [];
    
    settingsCards.forEach(card => {
      const view = card.dataset.view;
      
      // Skip special action buttons (Customer Display, Cash Drawer)
      if (!view) {
        card.style.display = 'flex';
        return;
      }
      
      // Show/hide based on permissions
      if (allowedViews.includes(view)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
      
      // Remove old listeners and add new ones
      const newCard = card.cloneNode(true);
      card.parentNode.replaceChild(newCard, card);
      
      newCard.addEventListener('click', () => {
        // Check permission
        if (!hasPermission(view)) {
          showAlert('You do not have permission to access this section.', 'warning', 'Access Denied');
          return;
        }

        // Reports: open Arqueo overlay directly
        if (view === 'reports') {
          openArqueoOverlay();
          return;
        }

        // System: require developer PIN every time before showing the page
        if (view === 'system') {
          showDeveloperPinPrompt(() => _activateView('system'));
          return;
        }

        _activateView(view);
      });
    });
  }
  
  // Setup special action buttons (Customer Display & Cash Drawer)
  function setupSpecialButtons() {
    const customerDisplayBtn = document.querySelector('.customer-display-btn');
    const cashDrawerBtn = document.querySelector('.cash-drawer-btn');
    
    if (customerDisplayBtn) {
      customerDisplayBtn.style.display = 'flex';
      customerDisplayBtn.addEventListener('click', () => {
        toggleCustomerDisplay();
      });
    }
    
    if (cashDrawerBtn) {
      cashDrawerBtn.style.display = 'flex';
      cashDrawerBtn.addEventListener('click', () => {
        openCashDrawer();
      });
    }
  }
  
  // Call after settings cards are setup
  setTimeout(() => {
    setupSpecialButtons();
    setupCheckoutMenuBar();
  }, 100);
  
  if (settingsMenu) {    // Handle menu item clicks
    settingsMenuItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;

        // Check permission
        if (!hasPermission(view)) {
          alert('You do not have permission to access this section.');
          settingsMenu.classList.remove('active');
          return;
        }

        // Close menu
        settingsMenu.classList.remove('active');

        // System: require developer PIN every time before showing the page
        if (view === 'system') {
          showDeveloperPinPrompt(() => _activateView('system'));
          return;
        }

        _activateView(view);
      });
    });
  }
  
  // Setup logout button in right panel
  const logoutBtnRight = document.getElementById('logoutBtnRight');
  if (logoutBtnRight) {
    logoutBtnRight.addEventListener('click', () => {
      logoutToLoginScreen();
    });
  }
}

/* ===== In-checkout slide panel ===== */
const CO_PANEL_TITLES = {
  products: 'Products', barcodes: 'Barcodes', sales: 'Sales',
  returns: 'Returns', loans: 'Parking', expenses: 'Expenses',
  reports: 'Z Reports', analytics: 'Analytics', inventory: 'Inventory',
  categories: 'Categories', users: 'Users', system: 'System Settings'
};
let _coPanelViewEl = null;
let _coPanelViewParent = null;

function openCoPanel(view, pinConfirmed = false) {
  if (!hasPermission(view)) {
    showAlert('You do not have permission to access this section.', 'warning', 'Access Denied');
    return;
  }

  // System: require developer PIN every time before opening the panel
  if (view === 'system' && !pinConfirmed) {
    showDeveloperPinPrompt(() => openCoPanel('system', true));
    return;
  }

  const panel   = document.getElementById('coPanel');
  const content = document.getElementById('coPanelContent');
  const titleEl = document.getElementById('coPanelTitle');
  if (!panel || !content) return;

  // Toggle: clicking the same button again closes the panel
  if (panel.dataset.openView === view && panel.classList.contains('co-panel--open')) {
    closeCoPanel();
    return;
  }

  // Restore any previously moved view
  if (_coPanelViewEl && _coPanelViewParent) {
    _coPanelViewEl.classList.remove('active');
    _coPanelViewParent.appendChild(_coPanelViewEl);
  }

  const viewEl = document.getElementById(view + 'View');
  if (!viewEl) return;

  _coPanelViewEl    = viewEl;
  _coPanelViewParent = viewEl.parentElement;

  // Move view node into panel content area and activate it
  content.appendChild(viewEl);
  viewEl.classList.add('active');

  titleEl.textContent = CO_PANEL_TITLES[view] || view;
  panel.dataset.openView = view;
  panel.classList.add('co-panel--open');
  panel.setAttribute('aria-hidden', 'false');

  // Highlight the active menu button
  document.querySelectorAll('#checkoutMenuBar .cmb-btn').forEach(b => {
    b.classList.toggle('cmb-btn--active', b.dataset.coView === view);
  });

  // Load view data
  loadViewData(view);
}

function closeCoPanel() {
  const panel = document.getElementById('coPanel');
  if (!panel) return;

  // Move the view back to its original parent
  if (_coPanelViewEl && _coPanelViewParent) {
    _coPanelViewEl.classList.remove('active');
    _coPanelViewParent.appendChild(_coPanelViewEl);
    _coPanelViewEl    = null;
    _coPanelViewParent = null;
  }

  panel.dataset.openView = '';
  panel.classList.remove('co-panel--open');
  panel.setAttribute('aria-hidden', 'true');

  document.querySelectorAll('#checkoutMenuBar .cmb-btn').forEach(b => b.classList.remove('cmb-btn--active'));
}

function setupCheckoutMenuBar() {
  const bar = document.getElementById('checkoutMenuBar');
  if (!bar || bar.dataset.wired) return;
  bar.dataset.wired = '1';

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.cmb-btn');
    if (!btn) return;

    const view   = btn.dataset.coView;
    const action = btn.dataset.coAction;

    if (view) {
      openCoPanel(view);
    } else if (action === 'display') {
      if (typeof toggleCustomerDisplay === 'function') toggleCustomerDisplay();
    } else if (action === 'drawer') {
      if (typeof openCashDrawer === 'function') openCashDrawer();
    } else if (action === 'logout') {
      if (typeof logoutToLoginScreen === 'function') logoutToLoginScreen();
    }
  });

  // Wire close button
  const closeBtn = document.getElementById('coPanelClose');
  if (closeBtn && !closeBtn.dataset.wired) {
    closeBtn.dataset.wired = '1';
    closeBtn.addEventListener('click', closeCoPanel);
  }

  // Apply role-based visibility
  const userRole     = currentUser ? currentUser.role : null;
  const allowedViews = userRole ? (PERMISSIONS[userRole] || []) : [];
  bar.querySelectorAll('.cmb-btn[data-co-view]').forEach(btn => {
    btn.hidden = !allowedViews.includes(btn.dataset.coView);
  });
}

function toggleNavbarForView(view) {
  const topNavbar = document.getElementById('topNavbar');
  const mainWrapper = document.querySelector('.main-content-wrapper');
  
  if (view === 'checkout') {
    // Hide navbar for checkout view
    topNavbar.style.display = 'none';
    if (mainWrapper) mainWrapper.style.height = '100vh';
  } else if (view === 'settings') {
    // Show navbar for settings view
    topNavbar.style.display = 'flex';
    if (mainWrapper) mainWrapper.style.height = 'calc(100vh - 60px)';
  } else {
    // Show navbar for other views
    topNavbar.style.display = 'flex';
    if (mainWrapper) mainWrapper.style.height = 'calc(100vh - 60px)';
  }
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ============== CHECKOUT VIEW ==============
function setupCheckoutHandlers() {
  const productSearch = document.querySelector('#checkoutView #productSearch');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const undoBtn = document.getElementById('undoScanBtn');

  // Virtual Numpad handlers
  const numpadBtns = document.querySelectorAll('.numpad-btn');

  // Pending numpad value for type-first-then-tap-cell flow
  let _numpadPending = '';

  function clearNumpadPending() {
    _numpadPending = '';
  }

  // Helper: return the currently focused cart inline-edit input, if any
  function getActiveCartInput() {
    const el = document.activeElement;
    if (!el || el.tagName !== 'INPUT') return null;
    if (el.dataset.noVk !== '1') return null;
    if (!document.getElementById('cartTableBody')?.contains(el)) return null;
    return el;
  }

  numpadBtns.forEach(btn => {
    // Prevent the button click from stealing focus away from a cart input
    btn.addEventListener('mousedown', (e) => {
      if (getActiveCartInput()) e.preventDefault();
    });

    btn.addEventListener('click', () => {
      const value = btn.dataset.value;

      // Skip if no value (hidden buttons)
      if (!value) return;

      const cartInput = getActiveCartInput();

      if (cartInput) {
        // Route numpad into the focused cart input
        clearNumpadPending();
        if (value === 'clear') {
          // BORRAR = backspace one character
          const pos = cartInput.selectionStart ?? cartInput.value.length;
          if (pos > 0) {
            cartInput.value = cartInput.value.slice(0, pos - 1) + cartInput.value.slice(pos);
            try { cartInput.setSelectionRange(pos - 1, pos - 1); } catch { /* ignore */ }
          }
        } else if (value === 'enter') {
          cartInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        } else if (value === '00') {
          const wasEmpty = cartInput.value === '' || cartInput.dataset.replaceOnNextKey === '1';
          if (wasEmpty) {
            cartInput.value = '0';
          } else {
            cartInput.value += '00';
          }
          cartInput.dataset.replaceOnNextKey = '0';
        } else {
          // Replace-on-first-key behaviour (mirrors scanner flow)
          if (cartInput.dataset.replaceOnNextKey === '1') {
            cartInput.value = value;
            cartInput.dataset.replaceOnNextKey = '0';
          } else {
            const pos = cartInput.selectionStart ?? cartInput.value.length;
            cartInput.value = cartInput.value.slice(0, pos) + value + cartInput.value.slice(pos);
            try { cartInput.setSelectionRange(pos + value.length, pos + value.length); } catch { /* ignore */ }
          }
        }
        cartInput.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      // Default: route to payment input + track pending for type-first-tap-cell flow
      if (value === 'clear') {
        const paymentInput = document.getElementById('paymentInput');
        if (paymentInput) paymentInput.value = '';
        clearNumpadPending();
        updateCartSummary();
      } else if (value === 'enter') {
        // Enter does nothing for payment numpad
      } else {
        // Number or decimal - add to payment input AND pending buffer
        const digit = value; // '0'-'9', '00', '.'
        _numpadPending += digit;
        const paymentInput = document.getElementById('paymentInput');
        if (paymentInput) {
          paymentInput.value += digit;
          updateCartSummary();
        }
      }
    });
  });

  // Expose so cart click handler can access the pending value
  setupCheckoutHandlers._getNumpadPending  = () => _numpadPending;
  setupCheckoutHandlers._clearNumpadPending = () => { clearNumpadPending(); const p = document.getElementById('paymentInput'); if(p) { p.value = ''; updateCartSummary(); } };

  if (productSearch && !productSearch.dataset.scanHandlersAttached) {
    productSearch.dataset.scanHandlersAttached = '1';

    // Debounce search to keep typing smooth on slower Windows PCs.
    let productSearchDebounceTimer = null;
    productSearch.addEventListener('input', (e) => {
      const searchQuery = e.target.value.trim();
      if (productSearchDebounceTimer) clearTimeout(productSearchDebounceTimer);
      productSearchDebounceTimer = setTimeout(() => {
        displayQuickProducts(searchQuery);
      }, 120);
    });

    // Use keydown (keypress is deprecated and can be flaky with scanners)
    productSearch.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = String(productSearch.value || '').trim();
      if (!q) return;
      await searchAndAddProduct(q);
      try {
        productSearch.value = '';
        displayQuickProducts('');
        try { window.__virtualKeyboardSuppressOnce = true; } catch { /* ignore */ }
        productSearch.focus();
        productSearch.select?.();
      } catch {
        // ignore
      }
    });
  }

  // Category tab event listeners
  const categoryTabs = document.querySelectorAll('.category-tab');
  categoryTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs
      categoryTabs.forEach(t => t.classList.remove('active'));
      // Add active class to clicked tab
      tab.classList.add('active');
      // Get category and filter products
      const category = tab.getAttribute('data-category');
      displayQuickProducts('', category);
    });
  });

  checkoutBtn.addEventListener('click', async () => {
    await completeSale();
  });

  // Add TICKET button handler
  const ticketBtn = document.getElementById('ticketBtn');
  if (ticketBtn) {
    ticketBtn.addEventListener('click', async () => {
      if (ticketBtn.disabled || cart.length === 0) return;
      await printTicket();
    });
  }

  // Add NOTE button handler
  const noteBtn = document.getElementById('noteBtn');
  if (noteBtn) {
    noteBtn.addEventListener('click', () => {
      openNoteModal();
    });
  }

  // Add VARIOS button handler: take the amount typed on the numpad and add a
  // generic "Varios" line to the cart at that price.
  const variosBtn = document.getElementById('variosBtn');
  if (variosBtn && !variosBtn.dataset.listenerAttached) {
    variosBtn.dataset.listenerAttached = '1';
    variosBtn.addEventListener('click', () => {
      addVariosToCart();
    });
  }

  if (deleteAllBtn && !deleteAllBtn.dataset.listenerAttached) {
    deleteAllBtn.dataset.listenerAttached = '1';
    deleteAllBtn.addEventListener('click', () => {
      if (deleteAllBtn.disabled) return;
      clearCurrentCart();
    });
  }

  // UNDO last scan
  if (undoBtn && !undoBtn.dataset.listenerAttached) {
    undoBtn.dataset.listenerAttached = '1';
    undoBtn.addEventListener('click', () => {
      undoLastScan();
    });
  }

  // Add PAYMENT button handler - opens modal
  const paymentBtn = document.getElementById('paymentBtn');
  if (paymentBtn) {
    paymentBtn.addEventListener('click', () => {
      if (paymentBtn.disabled || cart.length === 0) return;
      openPaymentModal();
    });
  }

  // Add Open Drawer button handler
  const openDrawerBtn = document.getElementById('openDrawerBtn');
  if (openDrawerBtn) {
    openDrawerBtn.addEventListener('click', () => {
      openCashDrawer();
    });
  }

  // Payment modal handlers
  setupPaymentModal();

  // Quick products reorder toggle
  setupQuickProductsReorderToggle();
  setupCheckoutScanEditToggle();
}

function setupPaymentModal() {
  const paymentModal = document.getElementById('paymentModal');
  const closePaymentModal = document.getElementById('closePaymentModal');
  const paymentMethodBtns = document.querySelectorAll('.payment-method-btn');
  const checkoutBtnModal = document.querySelector('.btn-complete-sale-modal');

  const cashPaymentDetails = document.getElementById('cashPaymentDetails');
  const cashPaidInput = document.getElementById('cashPaidInput');
  const cashNumpad = document.getElementById('cashNumpad');
  
  // Payment mode toggle buttons
  const singlePaymentModeBtn = document.getElementById('singlePaymentModeBtn');
  const splitPaymentModeBtn = document.getElementById('splitPaymentModeBtn');
  const singlePaymentSection = document.getElementById('singlePaymentSection');
  const splitPaymentSection = document.getElementById('splitPaymentSection');
  
  // Split payment controls
  const splitCashAmount = document.getElementById('splitCashAmount');
  const splitCardAmount = document.getElementById('splitCardAmount');
  const clearSplitBtn = document.getElementById('clearSplitBtn');

  // Close modal button
  if (closePaymentModal) {
    closePaymentModal.addEventListener('click', () => {
      closePaymentModalFunc();
    });
  }

  // Close modal when clicking outside
  if (paymentModal) {
    paymentModal.addEventListener('click', (e) => {
      if (e.target === paymentModal) {
        closePaymentModalFunc();
      }
    });
  }

  // Payment mode toggle
  if (singlePaymentModeBtn) {
    singlePaymentModeBtn.addEventListener('click', () => {
      singlePaymentModeBtn.classList.add('active');
      singlePaymentModeBtn.style.background = '#3b82f6';
      singlePaymentModeBtn.style.color = 'white';
      singlePaymentModeBtn.style.borderColor = '#3b82f6';
      
      splitPaymentModeBtn.classList.remove('active');
      splitPaymentModeBtn.style.background = 'white';
      splitPaymentModeBtn.style.color = '#64748b';
      splitPaymentModeBtn.style.borderColor = '#cbd5e1';
      
      singlePaymentSection.style.display = 'block';
      splitPaymentSection.style.display = 'none';
      
      paymentMode = 'single';

      // Only show cash details if CASH is currently selected
      if (cashPaymentDetails) {
        cashPaymentDetails.style.display = selectedPaymentMethod === 'cash' ? 'block' : 'none';
      }
      updatePaymentModalValidation();
    });
  }

  if (splitPaymentModeBtn) {
    splitPaymentModeBtn.addEventListener('click', () => {
      splitPaymentModeBtn.classList.add('active');
      splitPaymentModeBtn.style.background = '#3b82f6';
      splitPaymentModeBtn.style.color = 'white';
      splitPaymentModeBtn.style.borderColor = '#3b82f6';
      
      singlePaymentModeBtn.classList.remove('active');
      singlePaymentModeBtn.style.background = 'white';
      singlePaymentModeBtn.style.color = '#64748b';
      singlePaymentModeBtn.style.borderColor = '#cbd5e1';
      
      singlePaymentSection.style.display = 'none';
      splitPaymentSection.style.display = 'block';
      
      paymentMode = 'split';

      // Hide cash keypad/details in split mode
      if (cashPaymentDetails) {
        cashPaymentDetails.style.display = 'none';
      }
      updatePaymentModalValidation();
    });
  }

  // Split amount input handlers
  if (splitCashAmount) {
    splitCashAmount.addEventListener('input', updatePaymentModalValidation);
  }

  if (splitCardAmount) {
    splitCardAmount.addEventListener('input', updatePaymentModalValidation);
  }

  // Clear split button
  if (clearSplitBtn) {
    clearSplitBtn.addEventListener('click', () => {
      splitCashAmount.value = '';
      splitCardAmount.value = '';
      
      updatePaymentModalValidation();
    });
  }

  // Single payment method selection
  paymentMethodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      
      // Remove selected class from all buttons
      paymentMethodBtns.forEach(b => b.classList.remove('selected'));
      
      // Add selected class to clicked button
      btn.classList.add('selected');
      
      // Set selected payment method
      selectedPaymentMethod = value;
      console.log('Payment method selected:', value);

      // Toggle cash keypad/details
      if (cashPaymentDetails) {
        const showCash = paymentMode === 'single' && selectedPaymentMethod === 'cash';
        cashPaymentDetails.style.display = showCash ? 'block' : 'none';
      }

      // For non-cash methods, treat payment as exact total.
      // For CASH, leave the amount empty so the cashier can type immediately
      // without deleting a prefilled exact-total value.
      if (paymentMode === 'single') {
        const paymentInputHidden = document.getElementById('paymentInput');
        const total = calculateTotal();
        if (paymentInputHidden) {
          if (selectedPaymentMethod === 'cash') {
            paymentInputHidden.value = cashPaidInput ? String(cashPaidInput.value || '') : '';
          } else {
            paymentInputHidden.value = String(total.toFixed(2));
          }
        }
        // Update summary + change display (now inside modal)
        updateCartSummary();
      }

      if (cashPaidInput && selectedPaymentMethod === 'cash') {
        try {
          // Ensure validation updates after auto-default.
          const ev = new Event('input', { bubbles: true });
          cashPaidInput.dispatchEvent(ev);
        } catch {
          // ignore
        }
        cashPaidInput.focus();
        cashPaidInput.select();
      }
      
      updatePaymentModalValidation();
    });
  });

  // Cash paid input sync -> hidden paymentInput + live change
  const syncCashPaid = () => {
    const total = calculateTotal();
    const paymentInputHidden = document.getElementById('paymentInput');
    const raw = cashPaidInput ? String(cashPaidInput.value || '') : '';
    const normalized = raw.replace(/[^0-9.]/g, '');
    const paid = parseFloat(normalized);

    if (paymentInputHidden) {
      if (Number.isFinite(paid)) {
        paymentInputHidden.value = String(paid);
      } else {
        paymentInputHidden.value = '';
      }
    }

    // Keep the modal change tile up-to-date via the existing summary updater.
    updateCartSummary();

    // Show remaining when cash is insufficient
    const paymentRemainingAmount = document.getElementById('paymentRemainingAmount');
    const remainingValue = document.getElementById('remainingValue');
    if (paymentRemainingAmount && remainingValue && selectedPaymentMethod === 'cash' && paymentMode === 'single') {
      const paidAmount = Number.isFinite(paid) ? paid : 0;
      const remaining = Math.max(0, total - paidAmount);
      if (paidAmount > 0 && remaining > 0.009) {
        paymentRemainingAmount.style.visibility = 'visible';
        remainingValue.textContent = (systemSettings?.currency_symbol || '€') + remaining.toFixed(2);
        remainingValue.style.color = '#dc2626';
      } else {
        paymentRemainingAmount.style.visibility = 'hidden';
      }
    }

    updatePaymentModalValidation();
  };

  if (cashPaidInput) {
    cashPaidInput.addEventListener('input', syncCashPaid);
    cashPaidInput.addEventListener('focus', () => {
      if (selectedPaymentMethod === 'cash') syncCashPaid();
    });
  }

  // Modal numpad for cash
  if (cashNumpad && cashPaidInput) {
    cashNumpad.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.modal-numpad-btn');
      if (!btn) return;
      const v = btn.dataset.value;
      const total = calculateTotal();

      const setVal = (next) => {
        cashPaidInput.value = next;
        syncCashPaid();
      };

      const cur = String(cashPaidInput.value || '');
      if (v === 'clear') {
        setVal('');
        return;
      }
      if (v === 'back') {
        setVal(cur.slice(0, -1));
        return;
      }
      if (v === 'exact') {
        setVal(total.toFixed(2));
        return;
      }
      if (v === 'next') {
        // Convenience: round up to next whole unit (e.g., 12.34 -> 13.00)
        const next = Math.ceil(total);
        setVal(next.toFixed(2));
        return;
      }

      // Append digits / dot / 00
      if (v === '.') {
        if (cur.includes('.')) return;
        setVal(cur === '' ? '0.' : cur + '.');
        return;
      }

      if (/^(\d|00)$/.test(v)) {
        // Limit length to keep it usable
        if ((cur + v).length > 10) return;
        setVal(cur + v);
      }
    });
  }
}

function updatePaymentModalValidation() {
  const checkoutBtnModal = document.querySelector('.btn-complete-sale-modal');
  const paymentRemainingAmount = document.getElementById('paymentRemainingAmount');
  const remainingValue = document.getElementById('remainingValue');
  
  if (!checkoutBtnModal) return;
  
  const total = calculateTotal();
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  if (paymentMode === 'single') {
    // Single payment mode
    if (!selectedPaymentMethod) {
      checkoutBtnModal.disabled = true;
      if (paymentRemainingAmount) paymentRemainingAmount.style.visibility = 'hidden';
      return;
    }

    if (selectedPaymentMethod === 'cash') {
      const cashPaidInput = document.getElementById('cashPaidInput');
      const rawPaidValue = (cashPaidInput?.value || '').toString().trim();
      const hasPaidValue = rawPaidValue.length > 0;
      const paid = hasPaidValue ? (parseFloat(rawPaidValue) || 0) : total;
      const remaining = total - paid;

      // Blank cash input is treated as exact payment
      checkoutBtnModal.disabled = remaining > 0.009;

      if (paymentRemainingAmount && remainingValue) {
        if (hasPaidValue && paid > 0 && remaining > 0.009) {
          paymentRemainingAmount.style.visibility = 'visible';
          remainingValue.textContent = currencySymbol + remaining.toFixed(2);
          remainingValue.style.color = '#dc2626';
        } else {
          paymentRemainingAmount.style.visibility = 'hidden';
        }
      }
    } else {
      // CARD / PARKING: always exact, no remaining
      checkoutBtnModal.disabled = false;
      if (paymentRemainingAmount) paymentRemainingAmount.style.visibility = 'hidden';
    }
  } else {
    // Split payment mode - validate amounts
    const splitCashAmount = document.getElementById('splitCashAmount');
    const splitCardAmount = document.getElementById('splitCardAmount');
    
    let cashAmount = 0;
    let cardAmount = 0;
    
    cashAmount = parseFloat(splitCashAmount.value) || 0;
    cardAmount = parseFloat(splitCardAmount.value) || 0;
    
    const totalPaid = cashAmount + cardAmount;
    const remaining = total - totalPaid;
    
    // Show remaining amount
    if (paymentRemainingAmount && remainingValue) {
      if (totalPaid > 0) {
        paymentRemainingAmount.style.visibility = 'visible';
        remainingValue.textContent = currencySymbol + remaining.toFixed(2);

        if (remaining > 0.01) {
          remainingValue.style.color = '#dc2626'; // Red for remaining
        } else if (remaining < -0.01) {
          remainingValue.style.color = '#f59e0b'; // Orange for overpayment
        } else {
          remainingValue.style.color = '#059669'; // Green for exact
        }
      } else {
        paymentRemainingAmount.style.visibility = 'hidden';
      }
    }
    
    // Enable checkout if at least one method is selected and total matches (within 1 cent tolerance)
    const hasPayment = totalPaid > 0;
    const amountValid = Math.abs(remaining) < 0.01;
    
    checkoutBtnModal.disabled = !(hasPayment && amountValid && totalPaid > 0);
  }
}

function openPaymentModal() {
  const paymentModal = document.getElementById('paymentModal');
  const paymentTotalAmount = document.getElementById('paymentTotalAmount');
  const cashPaymentDetails = document.getElementById('cashPaymentDetails');
  const cashPaidInput = document.getElementById('cashPaidInput');
  const paymentInputHidden = document.getElementById('paymentInput');
  
  if (paymentModal) {
    paymentModal.classList.add('active');

    // New payment flow
    cashDrawerOpenedInPaymentFlow = false;
    
    // Display total amount
    const total = calculateTotal();
    if (paymentTotalAmount) {
      const currencySymbol = systemSettings?.currency_symbol || '€';
      paymentTotalAmount.textContent = currencySymbol + total.toFixed(2);
    }
    // Show total on customer display
    updateCustomerDisplayTotal(total);
    
    // Reset single payment selections
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
      btn.classList.remove('selected');
    });

    // Reset cash inputs
    if (cashPaidInput) cashPaidInput.value = '';
    if (paymentInputHidden) paymentInputHidden.value = '';
    if (cashPaymentDetails) cashPaymentDetails.style.display = 'none';
    
    // Reset split payment
    const splitCashAmount = document.getElementById('splitCashAmount');
    const splitCardAmount = document.getElementById('splitCardAmount');
    
    if (splitCashAmount) {
      splitCashAmount.value = '';
    }
    if (splitCardAmount) {
      splitCardAmount.value = '';
    }
    
    // Reset to single payment mode
    const singlePaymentModeBtn = document.getElementById('singlePaymentModeBtn');
    const splitPaymentModeBtn = document.getElementById('splitPaymentModeBtn');
    const singlePaymentSection = document.getElementById('singlePaymentSection');
    const splitPaymentSection = document.getElementById('splitPaymentSection');
    
    if (singlePaymentModeBtn) {
      singlePaymentModeBtn.classList.add('active');
      singlePaymentModeBtn.style.background = '#3b82f6';
      singlePaymentModeBtn.style.color = 'white';
      singlePaymentModeBtn.style.borderColor = '#3b82f6';
    }
    
    if (splitPaymentModeBtn) {
      splitPaymentModeBtn.classList.remove('active');
      splitPaymentModeBtn.style.background = 'white';
      splitPaymentModeBtn.style.color = '#64748b';
      splitPaymentModeBtn.style.borderColor = '#cbd5e1';
    }
    
    if (singlePaymentSection) singlePaymentSection.style.display = 'block';
    if (splitPaymentSection) splitPaymentSection.style.display = 'none';
    
    paymentMode = 'single';
    
    const checkoutBtnModal = document.querySelector('.btn-complete-sale-modal');
    if (checkoutBtnModal) {
      checkoutBtnModal.disabled = true;
    }

    // Ensure main summary is recalculated (updates change tile inside modal)
    updateCartSummary();
  }
}

function closePaymentModalFunc() {
  const paymentModal = document.getElementById('paymentModal');
  if (paymentModal) {
    paymentModal.classList.remove('active');
  }
  // Reset payment method selection
  selectedPaymentMethod = null;
  paymentMode = 'single';
  cashDrawerOpenedInPaymentFlow = false;
}


async function loadCheckoutView() {
  // Load system settings if not already loaded
  if (!systemSettings) {
    systemSettings = await window.api.getSystemSettings();
  }
  await loadAllProducts();
  await loadCategoryTabs();
  displayQuickProducts();
  updateCartDisplay();
}

async function loadCategoryTabs() {
  const categoryTabsContainer = document.getElementById('categoryTabs');
  const categories = await window.api.getAllCategories();

  // Show category tabs for any category that has at least one checkout-enabled product.
  // (Favorites are listed first, then the rest alphabetically.)
  const visibleCategoryNames = new Set();
  let hasUncategorizedProducts = false;
  try {
    for (const p of (allProducts || [])) {
      if (!p) continue;
      if (!isProductEnabledForCheckout(p)) continue;
      if (isProductUncategorized(p)) {
        hasUncategorizedProducts = true;
        continue;
      }
      const name = (p.category ?? '').toString().trim();
      if (name) visibleCategoryNames.add(name);
    }
  } catch {
    // ignore
  }

  const knownByName = new Map((categories || []).map(c => [String(c?.name || ''), c]));
  // Starred (favorite) categories always get a tab, even before they have products;
  // other categories appear once they have at least one checkout-enabled product.
  const knownVisible = (categories || []).filter(c =>
    visibleCategoryNames.has(String(c?.name || '')) || Number(c?.is_favorite || 0) === 1
  );
  knownVisible.sort((a, b) => {
    const af = Number(a?.is_favorite || 0);
    const bf = Number(b?.is_favorite || 0);
    if (af !== bf) return bf - af;
    return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
  });

  const unknownVisibleNames = Array.from(visibleCategoryNames)
    .filter(name => !knownByName.has(name))
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));

  // Add categories that have visible products in Checkout
  const visibleCategories = [
    ...knownVisible,
    ...unknownVisibleNames.map(name => ({ id: null, name }))
  ];
  
  // Clear and rebuild all category tabs (including ALL button)
  categoryTabsContainer.innerHTML = '';
  
  // Array of vibrant colors for category buttons
  const categoryColors = [
    '#4d6b8a', // Default blue (for ALL)
    '#e74c3c', // Red
    '#3498db', // Blue
    '#2ecc71', // Green
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Turquoise
    '#e67e22', // Dark Orange
    '#34495e', // Dark Gray
    '#16a085', // Dark Turquoise
    '#c0392b'  // Dark Red
  ];
  
  // Decide active category: keep selection if possible, otherwise default to ALL (if present) or first category.
  const visibleCategorySet = new Set(visibleCategories.map(c => String(c?.name || '').trim()).filter(Boolean));
  const canKeepSelected = selectedCategory && selectedCategory !== 'all' && visibleCategorySet.has(String(selectedCategory));
  const shouldShowAll = !!hasUncategorizedProducts;
  const nextActiveCategory = canKeepSelected
    ? selectedCategory
    : (shouldShowAll ? 'all' : (visibleCategories[0]?.name || 'all'));
  selectedCategory = nextActiveCategory;

  // Create ALL button only when it has products ("ALL" = uncategorized)
  if (shouldShowAll) {
    const allButton = document.createElement('button');
    allButton.className = 'category-tab' + (nextActiveCategory === 'all' ? ' active' : '');
    allButton.setAttribute('data-category', 'all');
    allButton.textContent = 'ALL';
    allButton.style.backgroundColor = categoryColors[0];
    categoryTabsContainer.appendChild(allButton);
  }

  visibleCategories.forEach((category, index) => {
    const button = document.createElement('button');
    button.className = 'category-tab' + (nextActiveCategory === category.name ? ' active' : '');
    button.setAttribute('data-category', category.name);
    if (category.id) button.setAttribute('data-category-id', category.id);
    button.textContent = category.name.toUpperCase();
    
    // Assign color from array (cycling through colors if more than 10 categories)
    const colorIndex = (index + 1) % categoryColors.length;
    button.style.backgroundColor = categoryColors[colorIndex];
    
    categoryTabsContainer.appendChild(button);
  });
  
  // Setup double-click detection using event delegation
  setupCategoryTabListeners();

  // Ensure the subcategory panel matches the active tab on initial load.
  try {
    if (nextActiveCategory === 'all') {
      hideSubcategoryFilters();
    } else {
      const activeTab = categoryTabsContainer.querySelector('.category-tab.active');
      const categoryId = activeTab?.getAttribute?.('data-category-id');
      if (categoryId) {
        await loadSubcategoryFilters(parseInt(categoryId, 10), nextActiveCategory);
      } else {
        hideSubcategoryFilters();
      }
    }
  } catch {
    // ignore
  }
}

function setupCategoryTabListeners() {
  const categoryTabsContainer = document.getElementById('categoryTabs');
  if (!categoryTabsContainer) {
    console.error('Category tabs container not found!');
    return;
  }

  // Prevent duplicate listeners when loadCategoryTabs() is called multiple times.
  if (categoryTabsContainer.dataset.listenerAttached === '1') return;
  categoryTabsContainer.dataset.listenerAttached = '1';
  
  console.log('Setting up category tab listeners...');
  
  let clickTimer = null;
  let clickedCategoryName = null;
  
  categoryTabsContainer.addEventListener('click', async (e) => {
    console.log('Click on categoryTabs container', e.target);
    const tab = e.target.closest('.category-tab');
    if (!tab) {
      console.log('Not a category tab');
      return;
    }
    
    const categoryName = tab.getAttribute('data-category');
    const categoryId = tab.getAttribute('data-category-id');
    console.log('Category tab clicked:', categoryName, 'Timer exists:', !!clickTimer, 'Previous clicked:', clickedCategoryName);
    
    // If there's already a timer for the same category, this is a double-click
    if (clickTimer && clickedCategoryName === categoryName) {
      console.log('DOUBLE-CLICK DETECTED for category:', categoryName);
      clearTimeout(clickTimer);
      clickTimer = null;
      clickedCategoryName = null;
      
      // Double-click: open add product modal
      if (!hasPermission('products')) {
        alert('You do not have permission to add products');
        return;
      }
      
      console.log('Opening product modal with category:', categoryId, categoryName);
      openProductModal(null, categoryId ? parseInt(categoryId) : null, categoryName === 'all' ? null : categoryName);
    } else {
      console.log('First click, setting timer...');
      // First click: set timer for single-click action
      clickedCategoryName = categoryName;
      clickTimer = setTimeout(async () => {
        console.log('Single-click action executing for:', categoryName);
        clickTimer = null;
        clickedCategoryName = null;
        
        // Single-click: change category
        document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        if (categoryName === 'all') {
          hideSubcategoryFilters();
          displayQuickProducts('', 'all');
        } else {
          if (categoryId) {
            await loadSubcategoryFilters(parseInt(categoryId), categoryName);
          } else {
            hideSubcategoryFilters();
          }
          displayQuickProducts('', categoryName);
        }
      }, 250);
    }
  });
  
  console.log('Category tab listeners setup complete');
}

async function loadSubcategoryFilters(categoryId, categoryName) {
  const subcategoryFilters = document.getElementById('subcategoryFilters');
  const subcategories = await window.api.getSubcategoriesByCategoryId(categoryId);
  
  if (subcategories.length === 0) {
    subcategoryFilters.style.display = 'none';
    return;
  }
  
  // Array of vibrant colors for subcategory buttons
  const subcategoryColors = [
    '#3498db', // Blue
    '#e74c3c', // Red
    '#2ecc71', // Green
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Turquoise
    '#e67e22', // Dark Orange
    '#16a085', // Dark Turquoise
    '#c0392b', // Dark Red
    '#8e44ad', // Dark Purple
    '#27ae60', // Dark Green
    '#d35400'  // Pumpkin
  ];
  
  subcategoryFilters.style.display = 'flex';
  subcategoryFilters.innerHTML = '';
  
  // Add "All" button for subcategories
  const allBtn = document.createElement('button');
  allBtn.className = 'subcategory-btn active';
  allBtn.textContent = 'All';
  allBtn.style.backgroundColor = subcategoryColors[0];
  allBtn.style.borderColor = subcategoryColors[0];
  allBtn.addEventListener('click', () => {
    document.querySelectorAll('.subcategory-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    displayQuickProducts('', categoryName);
  });
  subcategoryFilters.appendChild(allBtn);
  
  // Add subcategory buttons
  subcategories.forEach((subcategory, index) => {
    const btn = document.createElement('button');
    btn.className = 'subcategory-btn';
    btn.textContent = subcategory.name;
    
    // Assign color from array (cycling through colors)
    const colorIndex = (index + 1) % subcategoryColors.length;
    btn.style.backgroundColor = subcategoryColors[colorIndex];
    btn.style.borderColor = subcategoryColors[colorIndex];
    
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subcategory-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      displayQuickProducts('', categoryName, subcategory.name);
    });
    subcategoryFilters.appendChild(btn);
  });
}

function hideSubcategoryFilters() {
  const subcategoryFilters = document.getElementById('subcategoryFilters');
  subcategoryFilters.style.display = 'none';
  subcategoryFilters.innerHTML = '';
}

async function loadAllProducts() {
  // Loading 10k products WITH base64 images can make Windows PCs slow/hang.
  // Prefer a "lite" product list and hydrate images only for visible cards.
  allProducts = await (window.api.getAllProductsLite ? window.api.getAllProductsLite() : window.api.getAllProducts());

  // Cache lowercase fields for faster filtering
  for (const p of allProducts) {
    if (!p) continue;
    if (typeof p._lcName !== 'string') p._lcName = String(p.name || '').toLowerCase();
    if (typeof p._lcCategory !== 'string') p._lcCategory = String(p.category || '').toLowerCase();
    if (typeof p._lcBarcode !== 'string') p._lcBarcode = String(p.barcode || '').toLowerCase();
  }

  // Build a fast lookup map used by cart rendering and other hot paths.
  allProductsById = new Map();
  for (const p of allProducts) {
    const id = parseInt(p?.id, 10);
    if (Number.isFinite(id)) allProductsById.set(id, p);
  }
  allCategories = await window.api.getAllCategories();

  allCategoriesByName = new Map();
  for (const c of (allCategories || [])) {
    const name = (c?.name ?? '').toString();
    if (name) allCategoriesByName.set(name, c);
  }
}

function getCachedProductById(productId) {
  const id = parseInt(productId, 10);
  if (!Number.isFinite(id)) return null;
  return allProductsById.get(id) || null;
}

function getCachedCategoryByName(categoryName) {
  const key = (categoryName ?? '').toString();
  if (!key) return null;
  return allCategoriesByName.get(key) || null;
}

const QUICK_PRODUCTS_RENDER_LIMIT = 240;
const QUICK_PRODUCTS_IMAGE_HYDRATE_LIMIT = 60;
const QUICK_PRODUCTS_INLINE_IMAGE_MAX_CHARS = 20000; // avoid inlining huge base64 images in the grid
const QUICK_PRODUCTS_IMAGE_MAX_CONCURRENCY = 4;

let quickProductsImageObserver = null;
let quickProductsImageQueue = [];
let quickProductsImageInFlight = 0;

function enqueueQuickProductImageHydration(productId, imageEl) {
  const id = parseInt(productId, 10);
  if (!Number.isFinite(id) || id <= 0) return;
  if (!imageEl || !imageEl.isConnected) return;
  if (imageEl.dataset && imageEl.dataset.hydrate === '0') return;

  quickProductsImageQueue.push({ id, imageEl });
  pumpQuickProductsImageQueue();
}

function pumpQuickProductsImageQueue() {
  if (quickProductsImageInFlight >= QUICK_PRODUCTS_IMAGE_MAX_CONCURRENCY) return;
  const next = quickProductsImageQueue.shift();
  if (!next) return;

  quickProductsImageInFlight++;
  (async () => {
    try {
      if (!next.imageEl || !next.imageEl.isConnected) return;
      if (next.imageEl.dataset && next.imageEl.dataset.hydrate === '0') return;
      if (!window.api.getProductById) return;

      const full = await window.api.getProductById(next.id);
      const img = (full?.image || '').toString();
      if (!img) return;
      if (!next.imageEl || !next.imageEl.isConnected) return;
      if (next.imageEl.dataset && next.imageEl.dataset.hydrate === '0') return;

      next.imageEl.innerHTML = `<img src="${img}" alt="${String(full?.name || '')}" loading="lazy" decoding="async" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
      next.imageEl.dataset.hydrate = '0';
      next.imageEl.dataset.hydrated = '1';
    } catch {
      // ignore per-item failures
    } finally {
      quickProductsImageInFlight--;
      pumpQuickProductsImageQueue();
    }
  })();
}

function ensureQuickProductsImageObserver() {
  const container = document.getElementById('quickProductsList');
  if (!container) return false;
  if (!('IntersectionObserver' in window)) return false;

  if (quickProductsImageObserver) return true;

  quickProductsImageObserver = new IntersectionObserver((entries) => {
    try {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        if (!el) continue;
        const id = parseInt(el.dataset.productId, 10);
        if (!id) continue;

        try { quickProductsImageObserver.unobserve(el); } catch { /* ignore */ }
        enqueueQuickProductImageHydration(id, el);
      }
    } catch {
      // ignore
    }
  }, {
    root: null,
    rootMargin: '250px',
    threshold: 0.01
  });

  return true;
}

async function hydrateQuickProductImages(productIds) {
  if (!window.api.getProductById) return;
  if (!Array.isArray(productIds) || productIds.length === 0) return;

  const container = document.getElementById('quickProductsList');
  if (!container) return;

  const ids = productIds.slice(0, QUICK_PRODUCTS_IMAGE_HYDRATE_LIMIT);
  for (const id of ids) {
    const imageEl = container.querySelector(`.product-image[data-product-id="${id}"]`);
    if (!imageEl) continue;
    enqueueQuickProductImageHydration(id, imageEl);
  }
}

let selectedCategory = 'all';
let selectedSubcategory = '';
let quickProductsReorderMode = false;
// When ON, scanning a known product's barcode at checkout opens its Edit modal
// instead of adding it to the cart. Stays ON until the cashier turns it off.
let checkoutScanEditMode = false;

function isProductEnabledForCheckout(product) {
  // Backward compatible: older DBs may not have the column yet.
  const v = product?.show_in_checkout;
  if (v === undefined || v === null) return true;
  return Number(v) !== 0;
}

function isProductUncategorized(product) {
  const raw = (product?.category ?? '').toString().trim();
  if (!raw) return true;

  // Backward compatible: older builds forced "General" as a default.
  // If "General" isn't an actual category in the Categories table, treat it as uncategorized.
  if (raw.toLowerCase() === 'general') {
    try {
      return !(allCategoriesByName && allCategoriesByName.has('General'));
    } catch {
      return true;
    }
  }

  return false;
}

// Persisted ordering for quick products (by category/subcategory scope)
const quickProductsSortCache = new Map(); // key -> Map(productId -> sortIndex)

function getQuickProductsSortKey(category, subcategory) {
  const c = (category === null || category === undefined || category === '') ? 'all' : String(category);
  const s = (subcategory === null || subcategory === undefined) ? '' : String(subcategory);
  return `${c}||${s}`;
}

async function getQuickProductsSortMap(category, subcategory) {
  const key = getQuickProductsSortKey(category, subcategory);
  if (quickProductsSortCache.has(key)) return quickProductsSortCache.get(key);
  if (!window.api || typeof window.api.getProductSortOrder !== 'function') {
    quickProductsSortCache.set(key, null);
    return null;
  }
  try {
    const rows = await window.api.getProductSortOrder(category, subcategory);
    const map = new Map();
    for (const r of (rows || [])) {
      const id = parseInt(r.product_id, 10);
      const idx = parseInt(r.sort_index, 10);
      if (Number.isFinite(id) && id > 0 && Number.isFinite(idx)) map.set(id, idx);
    }
    quickProductsSortCache.set(key, map);
    return map;
  } catch {
    quickProductsSortCache.set(key, null);
    return null;
  }
}

async function persistQuickProductsSortOrder(category, subcategory, orderedProductIds) {
  if (!window.api || typeof window.api.setProductSortOrder !== 'function') return;
  const ids = Array.isArray(orderedProductIds) ? orderedProductIds : [];
  const normalized = ids.map(v => parseInt(v, 10)).filter(v => Number.isFinite(v) && v > 0);
  await window.api.setProductSortOrder(category, subcategory, normalized);

  const key = getQuickProductsSortKey(category, subcategory);
  const map = new Map();
  for (let i = 0; i < normalized.length; i++) map.set(normalized[i], i);
  quickProductsSortCache.set(key, map);
}

async function displayQuickProducts(searchQuery = '', category = null, subcategory = null) {
  const container = document.getElementById('quickProductsList');

  // When switching views quickly, drop any queued image hydration work from the previous render.
  // (In-flight requests will finish but won't affect disconnected elements.)
  try {
    quickProductsImageQueue = [];
    if (quickProductsImageObserver) quickProductsImageObserver.disconnect();
  } catch {
    // ignore
  }
  
  // Update selected category if provided
  if (category !== null) {
    selectedCategory = category;
  }

  if (subcategory !== null && subcategory !== undefined) {
    selectedSubcategory = subcategory || '';
  }
  
  let filteredProducts;
  const q = String(searchQuery || '').trim().toLowerCase();
  
  if (q) {
    // Search by barcode or name
    filteredProducts = allProducts.filter(p =>
      isProductEnabledForCheckout(p) &&
      ((p._lcBarcode || '').includes(q) || (p._lcName || '').includes(q))
    );
  } else {
    // Show all checkout-enabled products (including out-of-stock)
    filteredProducts = allProducts.filter(p => isProductEnabledForCheckout(p));
  }
  
  // Filter by category if not 'all'
  if (selectedCategory === 'all') {
    // "ALL" behaves as "Uncategorized" in checkout.
    filteredProducts = filteredProducts.filter(p => isProductUncategorized(p));
  } else {
    filteredProducts = filteredProducts.filter(p => (p?.category || '') === selectedCategory);
  }
  
  // Filter by subcategory if provided
  if (subcategory) {
    filteredProducts = filteredProducts.filter(p => p.subcategory === subcategory);
  }

  // Apply persisted custom order for this view (category/subcategory scope)
  const sortMap = await getQuickProductsSortMap(selectedCategory, subcategory || '');
  if (sortMap && sortMap.size > 0) {
    const originalIndex = new Map();
    for (let i = 0; i < filteredProducts.length; i++) {
      const id = parseInt(filteredProducts[i]?.id, 10);
      if (Number.isFinite(id)) originalIndex.set(id, i);
    }
    filteredProducts.sort((a, b) => {
      const aId = parseInt(a?.id, 10);
      const bId = parseInt(b?.id, 10);
      const aSort = Number.isFinite(aId) ? sortMap.get(aId) : undefined;
      const bSort = Number.isFinite(bId) ? sortMap.get(bId) : undefined;
      const aHas = Number.isFinite(aSort);
      const bHas = Number.isFinite(bSort);
      if (aHas && bHas) return aSort - bSort;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return (originalIndex.get(aId) || 0) - (originalIndex.get(bId) || 0);
    });
  }

  const totalMatches = filteredProducts.length;
  if (totalMatches > QUICK_PRODUCTS_RENDER_LIMIT) {
    filteredProducts = filteredProducts.slice(0, QUICK_PRODUCTS_RENDER_LIMIT);
  }
  
  // Product icons mapping
  const productIcons = {
    'Apple': '🍎',
    'Bread': '🍞',
    'Cheese': '🧀',
    'Chicken': '🍗',
    'Eggs': '🥚',
    'Milk': '🥛',
    'Orange': '🍊',
    'Pasta': '🍝',
    'Rice': '🍚',
    'Cauliflower': '🥦'
  };
  
  if (filteredProducts.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #a0aec0; font-size: 18px;">No products found</div>';
    return;
  }
  
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  const noticeHtml = totalMatches > QUICK_PRODUCTS_RENDER_LIMIT
    ? `<div style="grid-column: 1/-1; background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; padding:10px 12px; border-radius:12px; font-weight:800;">
         Showing first ${QUICK_PRODUCTS_RENDER_LIMIT} of ${totalMatches} products. Use search/category to narrow.
       </div>`
    : '';

  container.innerHTML = noticeHtml + filteredProducts.map(product => {
    // Use product image if available, otherwise use emoji icon
    let imageHtml = '';
    const icon = productIcons[product.name] || '📦';
    const imgStr = (product.image && String(product.image).trim() !== '') ? String(product.image).trim() : '';
    const isDataUrl = imgStr.startsWith('data:image');
    const isHeavyInline = isDataUrl && imgStr.length > QUICK_PRODUCTS_INLINE_IMAGE_MAX_CHARS;
    const hasInlineImage = !!imgStr;
    const shouldInlineImage = hasInlineImage && !isHeavyInline;
    const shouldHydrate = !!(window.api.getProductById && (!hasInlineImage || isHeavyInline));

    if (shouldInlineImage) {
      imageHtml = `<img src="${imgStr}" alt="${product.name}" loading="lazy" decoding="async" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
    } else {
      imageHtml = `<div style="font-size: 34px; line-height: 1;">${icon}</div>`;
    }
    
    // Barcode-only POS: show quantity amount info (no kg/g UI).
    let amountInfo = '';
    const quantityUnit = product.quantity_unit || 'piece';
    if (product.quantity_amount) {
      const amount = String(product.quantity_amount || '').trim();
      if (amount) {
        const hasUnit = /\s*(piece|pack|box|bottle|can|bag|pc|pcs)s?$/i.test(amount);
        const displayAmount = hasUnit ? amount : `${amount} ${quantityUnit}`;
        amountInfo = `<div class="product-unit-info">${displayAmount}</div>`;
      }
    }
    
    return `
      <div class="quick-product-card" data-product-id="${product.id}">
        <div class="product-image" data-product-id="${product.id}" data-hydrate="${shouldHydrate ? '1' : '0'}">${imageHtml}</div>
        <div class="name">${product.name}</div>
        ${amountInfo}
        <div class="price">${currencySymbol}${product.price.toFixed(2)}</div>
      </div>
    `;
  }).join('');
  
  // Add event listeners for single click and double click
  setupProductCardListeners();

  // Enable touch drag-reorder for quick products (two-finger hold)
  ensureQuickProductsReorderHandlers();

  // Hydrate images only when visible to keep memory/CPU low on Windows.
  const needsHydrateEls = Array.from(container.querySelectorAll('.product-image[data-hydrate="1"]'));
  if (needsHydrateEls.length > 0) {
    if (ensureQuickProductsImageObserver()) {
      try { quickProductsImageObserver.disconnect(); } catch { /* ignore */ }
      for (const el of needsHydrateEls) {
        try { quickProductsImageObserver.observe(el); } catch { /* ignore */ }
      }
    } else {
      hydrateQuickProductImages(needsHydrateEls
        .map(el => parseInt(el.dataset.productId, 10))
        .filter(v => Number.isFinite(v) && v > 0));
    }
  }
}

// ============== QUICK PRODUCTS REORDER (TOUCH DRAG) ==============
// Gesture: two-finger long-press (default 280ms) on a product card, then drag to reorder.
// This avoids interfering with single-finger taps (add to cart) and double-tap (edit).
const QUICK_PRODUCTS_REORDER_HOLD_MS = 280;
const QUICK_PRODUCTS_REORDER_MOVE_CANCEL_PX = 10;

let quickProductsReorderState = {
  handlersAttached: false,
  pending: null, // { productId, cardEl, startX, startY, timerId }
  active: null, // { productId, cardEl, placeholderEl, offsetX, offsetY, fixedWidth, fixedHeight }
  suppressClickUntil: 0,
  pointerId: null,
  globalGuardAttached: false
};

function isQuickProductsReordering() {
  return !!(quickProductsReorderState.pending || quickProductsReorderState.active);
}

function ensureQuickProductsReorderHandlers() {
  if (quickProductsReorderState.handlersAttached) return;
  const container = document.getElementById('quickProductsList');
  if (!container) return;

  quickProductsReorderState.handlersAttached = true;

  // Guard against "click-through" after a drag on touchscreens.
  // Without this, the click generated on release can land on navbar tabs
  // (because the dragged card has pointer-events:none), switching pages.
  if (!quickProductsReorderState.globalGuardAttached) {
    quickProductsReorderState.globalGuardAttached = true;

    const shouldSuppress = () => {
      const until = Number(quickProductsReorderState.suppressClickUntil || 0);
      return isQuickProductsReordering() || (until && Date.now() < until);
    };

    const swallow = (e) => {
      try {
        if (!shouldSuppress()) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
      } catch {
        // ignore
      }
    };

    // Capture phase to beat other handlers.
    document.addEventListener('click', swallow, true);
    document.addEventListener('pointerup', swallow, true);
  }

  const clearPending = () => {
    const p = quickProductsReorderState.pending;
    if (p?.timerId) clearTimeout(p.timerId);
    quickProductsReorderState.pending = null;
  };

  const cleanupActive = () => {
    const a = quickProductsReorderState.active;
    if (!a) return;
    try {
      a.cardEl?.classList?.remove('quick-product-dragging');
      if (a.cardEl) {
        a.cardEl.style.position = '';
        a.cardEl.style.left = '';
        a.cardEl.style.top = '';
        a.cardEl.style.width = '';
        a.cardEl.style.height = '';
        a.cardEl.style.zIndex = '';
        a.cardEl.style.pointerEvents = '';
        a.cardEl.style.boxShadow = '';
        a.cardEl.style.transform = '';
      }
      a.placeholderEl?.remove?.();
    } catch {
      // ignore
    }
    quickProductsReorderState.active = null;
  };

  const computeDropIndexFromPlaceholder = (placeholderEl, draggingEl) => {
    if (!placeholderEl?.parentElement) return null;
    const children = Array.from(placeholderEl.parentElement.children);
    let idx = 0;
    for (const child of children) {
      if (child === draggingEl) continue;
      if (child === placeholderEl) return idx;
      if (child?.classList?.contains('quick-product-card')) idx++;
    }
    return idx;
  };

  const startDrag = (cardEl, productId, startX, startY) => {
    if (!cardEl || !cardEl.isConnected) return;
    if (quickProductsReorderState.active) return;

    const rect = cardEl.getBoundingClientRect();
    const placeholderEl = document.createElement('div');
    placeholderEl.className = 'quick-product-placeholder';
    placeholderEl.style.width = `${Math.round(rect.width)}px`;
    placeholderEl.style.height = `${Math.round(rect.height)}px`;

    cardEl.parentElement?.insertBefore(placeholderEl, cardEl.nextSibling);

    cardEl.classList.add('quick-product-dragging');
    cardEl.style.position = 'fixed';
    cardEl.style.left = `${Math.round(rect.left)}px`;
    cardEl.style.top = `${Math.round(rect.top)}px`;
    cardEl.style.width = `${Math.round(rect.width)}px`;
    cardEl.style.height = `${Math.round(rect.height)}px`;
    cardEl.style.zIndex = '10030';
    cardEl.style.pointerEvents = 'none';
    cardEl.style.boxShadow = '0 18px 40px rgba(15, 23, 42, 0.25)';
    cardEl.style.transform = 'scale(1.02)';

    quickProductsReorderState.active = {
      productId,
      cardEl,
      placeholderEl,
      offsetX: startX - rect.left,
      offsetY: startY - rect.top,
      fixedWidth: rect.width,
      fixedHeight: rect.height
    };
  };

  const onTouchStart = (e) => {
    try {
      if (!quickProductsReorderMode) return;
      if (!e.touches) return;
      const touchCount = e.touches.length;
      const allowed = touchCount === 1 || touchCount === 2;
      if (!allowed) return;
      if (quickProductsReorderState.active) return;

      const cardEl = e.target?.closest?.('.quick-product-card');
      if (!cardEl) return;
      const productId = parseInt(cardEl.dataset.productId, 10);
      if (!Number.isFinite(productId) || productId <= 0) return;

      // Prevent click/tap behaviors while we're preparing to reorder.
      e.preventDefault();
      e.stopPropagation();

      const { x, y } = getTouchesCentroid(e.touches);
      clearPending();

      // In explicit REORDER mode, start drag immediately.
      if (touchCount === 1 || touchCount === 2) {
        startDrag(cardEl, productId, x, y);
        quickProductsReorderState.suppressClickUntil = Date.now() + 650;
        return;
      }

      const timerId = setTimeout(() => {
        const p = quickProductsReorderState.pending;
        if (!p) return;
        if (!p.cardEl?.isConnected) { clearPending(); return; }
        startDrag(p.cardEl, p.productId, p.startX, p.startY);
        clearPending();
      }, QUICK_PRODUCTS_REORDER_HOLD_MS);

      quickProductsReorderState.pending = {
        productId,
        cardEl,
        startX: x,
        startY: y,
        timerId
      };
    } catch {
      // ignore
    }
  };

  const onTouchMove = (e) => {
    try {
      const a = quickProductsReorderState.active;
      if (a) {
        e.preventDefault();
        if (!e.touches || e.touches.length === 0) return;
        const { x, y } = getTouchesCentroid(e.touches);

        a.cardEl.style.left = `${Math.round(x - a.offsetX)}px`;
        a.cardEl.style.top = `${Math.round(y - a.offsetY)}px`;

        const el = document.elementFromPoint(x, y);
        const targetCard = el?.closest?.('.quick-product-card');
        if (targetCard && targetCard !== a.cardEl && !targetCard.classList.contains('quick-product-dragging')) {
          const r = targetCard.getBoundingClientRect();
          const before = y < (r.top + r.height / 2);
          if (before) container.insertBefore(a.placeholderEl, targetCard);
          else container.insertBefore(a.placeholderEl, targetCard.nextSibling);
        } else {
          // If dragging beyond cards, keep placeholder at the end
          if (!container.contains(a.placeholderEl)) container.appendChild(a.placeholderEl);
        }
        return;
      }

      const p = quickProductsReorderState.pending;
      if (!p) return;
      if (!e.touches) {
        clearPending();
        return;
      }
      const touchCount = e.touches.length;
      const allowed = quickProductsReorderMode && (touchCount === 1 || touchCount === 2);
      if (!allowed) {
        clearPending();
        return;
      }
      const { x, y } = getTouchesCentroid(e.touches);
      const dx = x - p.startX;
      const dy = y - p.startY;
      if (Math.hypot(dx, dy) > QUICK_PRODUCTS_REORDER_MOVE_CANCEL_PX) {
        clearPending();
      }
    } catch {
      // ignore
    }
  };

  const onTouchEndOrCancel = async () => {
    try {
      clearPending();
      const a = quickProductsReorderState.active;
      if (!a) return;

      const dropIndex = computeDropIndexFromPlaceholder(a.placeholderEl, a.cardEl);
      const draggedId = a.productId;
      cleanupActive();

      // Avoid immediate click-to-add after dropping.
      quickProductsReorderState.suppressClickUntil = Date.now() + 500;

      if (typeof dropIndex === 'number') {
        const visibleIds = Array.from(container.querySelectorAll('.quick-product-card'))
          .map(el => parseInt(el.dataset.productId, 10))
          .filter(v => Number.isFinite(v) && v > 0);

        const fromIndex = visibleIds.indexOf(draggedId);
        if (fromIndex >= 0) visibleIds.splice(fromIndex, 1);
        const safeTo = Math.max(0, Math.min(dropIndex, visibleIds.length));
        visibleIds.splice(safeTo, 0, draggedId);

        await persistQuickProductsSortOrder(selectedCategory, selectedSubcategory, visibleIds);
        await displayQuickProducts('', selectedCategory, selectedSubcategory);
      }
    } catch {
      cleanupActive();
    }
  };

  // Mouse/pen support: press-and-hold, then drag to reorder.
  const onPointerDown = (e) => {
    try {
      if (!e || e.pointerType === 'touch') return; // touch handled by touch events (needs 2 fingers)
      if (e.button !== 0) return;
      if (quickProductsReorderState.active) return;
      if (!quickProductsReorderMode) return;

      const cardEl = e.target?.closest?.('.quick-product-card');
      if (!cardEl) return;
      const productId = parseInt(cardEl.dataset.productId, 10);
      if (!Number.isFinite(productId) || productId <= 0) return;

      clearPending();
      const startX = e.clientX;
      const startY = e.clientY;

      if (quickProductsReorderMode) {
        // In explicit REORDER mode, start immediately.
        startDrag(cardEl, productId, startX, startY);
        quickProductsReorderState.suppressClickUntil = Date.now() + 650;
        quickProductsReorderState.pointerId = e.pointerId;
        try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        return;
      }

      // Long-press with mouse to enter reorder mode (prevents accidental reorders while clicking).
      const timerId = setTimeout(() => {
        const p = quickProductsReorderState.pending;
        if (!p) return;
        if (!p.cardEl?.isConnected) { clearPending(); return; }
        startDrag(p.cardEl, p.productId, p.startX, p.startY);
        clearPending();
      }, QUICK_PRODUCTS_REORDER_HOLD_MS);

      quickProductsReorderState.pending = { productId, cardEl, startX, startY, timerId };
      quickProductsReorderState.pointerId = e.pointerId;
      try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    } catch {
      // ignore
    }
  };

  const onPointerMove = (e) => {
    try {
      if (!e || e.pointerType === 'touch') return;
      const a = quickProductsReorderState.active;
      if (a) {
        e.preventDefault();
        const x = e.clientX;
        const y = e.clientY;
        a.cardEl.style.left = `${Math.round(x - a.offsetX)}px`;
        a.cardEl.style.top = `${Math.round(y - a.offsetY)}px`;

        const el = document.elementFromPoint(x, y);
        const targetCard = el?.closest?.('.quick-product-card');
        if (targetCard && targetCard !== a.cardEl && !targetCard.classList.contains('quick-product-dragging')) {
          const r = targetCard.getBoundingClientRect();
          const before = y < (r.top + r.height / 2);
          if (before) container.insertBefore(a.placeholderEl, targetCard);
          else container.insertBefore(a.placeholderEl, targetCard.nextSibling);
        }
        return;
      }

      const p = quickProductsReorderState.pending;
      if (!p) return;
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (Math.hypot(dx, dy) > QUICK_PRODUCTS_REORDER_MOVE_CANCEL_PX) {
        clearPending();
      }
    } catch {
      // ignore
    }
  };

  const onPointerUpOrCancel = async (e) => {
    try {
      if (e && e.pointerType === 'touch') return;
      clearPending();
      const a = quickProductsReorderState.active;
      if (!a) return;

      const dropIndex = computeDropIndexFromPlaceholder(a.placeholderEl, a.cardEl);
      const draggedId = a.productId;
      cleanupActive();
      quickProductsReorderState.suppressClickUntil = Date.now() + 500;

      if (typeof dropIndex === 'number') {
        const visibleIds = Array.from(container.querySelectorAll('.quick-product-card'))
          .map(el => parseInt(el.dataset.productId, 10))
          .filter(v => Number.isFinite(v) && v > 0);

        const fromIndex = visibleIds.indexOf(draggedId);
        if (fromIndex >= 0) visibleIds.splice(fromIndex, 1);
        const safeTo = Math.max(0, Math.min(dropIndex, visibleIds.length));
        visibleIds.splice(safeTo, 0, draggedId);

        await persistQuickProductsSortOrder(selectedCategory, selectedSubcategory, visibleIds);
        await displayQuickProducts('', selectedCategory, selectedSubcategory);
      }
    } catch {
      cleanupActive();
    } finally {
      if (e && typeof e.pointerId !== 'undefined' && quickProductsReorderState.pointerId === e.pointerId) {
        quickProductsReorderState.pointerId = null;
        try { container.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    }
  };

  container.addEventListener('touchstart', onTouchStart, { passive: false });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEndOrCancel, { passive: true });
  container.addEventListener('touchcancel', onTouchEndOrCancel, { passive: true });

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUpOrCancel);
  container.addEventListener('pointercancel', onPointerUpOrCancel);
}

function setupCheckoutScanEditToggle() {
  const btn = document.getElementById('toggleEditScanBtn');
  if (!btn || btn.dataset.listenerAttached === '1') return;
  btn.dataset.listenerAttached = '1';

  const searchInput = document.querySelector('#checkoutView #productSearch');

  const render = () => {
    if (checkoutScanEditMode) {
      btn.classList.add('active');
      btn.textContent = 'EDIT: ON';
      if (searchInput) searchInput.placeholder = 'Scan barcode to EDIT product...';
    } else {
      btn.classList.remove('active');
      btn.textContent = 'EDIT';
      if (searchInput) searchInput.placeholder = 'Search Product...';
    }
  };

  btn.addEventListener('click', () => {
    if (!hasPermission('products')) {
      showAlert('Access Denied: You do not have permission to edit products', 'error', 'Access Denied');
      return;
    }
    checkoutScanEditMode = !checkoutScanEditMode;
    render();
  });

  render();
}

function setupQuickProductsReorderToggle() {
  const btn = document.getElementById('toggleReorderBtn');
  if (!btn || btn.dataset.listenerAttached === '1') return;
  btn.dataset.listenerAttached = '1';

  const render = () => {
    if (quickProductsReorderMode) {
      btn.classList.add('active');
      btn.textContent = 'REORDER: ON';
    } else {
      btn.classList.remove('active');
      btn.textContent = 'REORDER';
    }
  };

  btn.addEventListener('click', () => {
    quickProductsReorderMode = !quickProductsReorderMode;
    // Cancel any pending drag when toggling
    try {
      if (quickProductsReorderState?.pending?.timerId) clearTimeout(quickProductsReorderState.pending.timerId);
      quickProductsReorderState.pending = null;
    } catch {
      // ignore
    }
    // Avoid accidental add-to-cart clicks right after toggling
    quickProductsReorderState.suppressClickUntil = Date.now() + 350;
    render();
  });

  render();
}

// ============== PRODUCT CARD CLICK HANDLERS ==============
function setupProductCardListeners() {
  const container = document.getElementById('quickProductsList');
  if (!container) return;

  // displayQuickProducts() calls this often; avoid adding duplicate listeners.
  if (container.dataset.listenerAttached === '1') return;
  container.dataset.listenerAttached = '1';
  
  let clickTimer = null;
  let clickedProductId = null;
  const SINGLE_CLICK_DELAY_MS = 260;

  // Touch double-tap support (more reliable than delayed click on some touchscreens)
  let lastTapAt = 0;
  let lastTapProductId = null;
  const DOUBLE_TAP_MS = 420;

  container.addEventListener('pointerup', (e) => {
    try {
      if (!e || e.pointerType !== 'touch') return;
      if (isQuickProductsReordering() || quickProductsReorderMode) return;
      const card = e.target?.closest?.('.quick-product-card');
      if (!card) return;
      const productId = parseInt(card.dataset.productId, 10);
      if (!productId) return;

      const now = Date.now();
      if (lastTapProductId === productId && (now - lastTapAt) <= DOUBLE_TAP_MS) {
        lastTapAt = 0;
        lastTapProductId = null;
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          clickedProductId = null;
        }
        quickProductsReorderState.suppressClickUntil = now + 650;
        handleDoubleClick(productId);
        return;
      }

      lastTapAt = now;
      lastTapProductId = productId;
    } catch {
      // ignore
    }
  }, { passive: true });

  // Mouse double-click support
  container.addEventListener('dblclick', (e) => {
    if (isQuickProductsReordering() || quickProductsReorderMode) return;
    const card = e.target?.closest?.('.quick-product-card');
    if (!card) return;
    const productId = parseInt(card.dataset.productId, 10);
    if (!productId) return;
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      clickedProductId = null;
    }
    quickProductsReorderState.suppressClickUntil = Date.now() + 650;
    handleDoubleClick(productId);
  });

  container.addEventListener('click', (e) => {
    if (isQuickProductsReordering()) return;
    if (quickProductsReorderState.suppressClickUntil && Date.now() < quickProductsReorderState.suppressClickUntil) return;
    if (quickProductsReorderMode) return;

    const card = e.target.closest('.quick-product-card');
    if (!card) return;

    const productId = parseInt(card.dataset.productId, 10);
    if (!productId) return;

    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      clickedProductId = null;
    }

    clickedProductId = productId;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      const id = clickedProductId;
      clickedProductId = null;
      if (!id) return;
      if (quickProductsReorderMode) return;
      if (isQuickProductsReordering()) return;
      try {
        const activeEl = document.activeElement;
        if (activeEl && typeof activeEl.blur === 'function' && isTextInputElement(activeEl)) {
          activeEl.blur();
        }
        currentKeyboardInput = null;
        const keyboard = document.getElementById('virtualKeyboard');
        if (keyboard) keyboard.classList.remove('active');
      } catch {
        // ignore
      }
      // Clicking product tiles should NOT pop the on-screen keyboard.
      // Avoid refocusing the search/scanner input on tap.
      openProductWeightFlow(id, { refocusScannerTarget: false });
    }, SINGLE_CLICK_DELAY_MS);
  });
}

function handleDoubleClick(productId) {
  // Check if user has permission to edit products
  if (!hasPermission('products')) {
    showAlert('Access Denied: You do not have permission to edit products', 'error', 'Access Denied');
    return;
  }
  
  // Checkout: only the price can be edited here
  editProduct(productId, { priceOnly: true });
}

// ============== WEIGHT PROMPT ==============
function promptForWeight(productId) {
  // Prevent opening multiple modals
  if (isWeightModalOpen) {
    console.log('Weight modal already open, ignoring duplicate call');
    return;
  }
  
  console.log('promptForWeight called with productId:', productId);
  const product = getCachedProductById(productId);
  console.log('Product found:', product);
  if (!product) {
    console.log('Product not found!');
    return;
  }
  
  // Set flag to prevent duplicate opens
  isWeightModalOpen = true;
  
  const currencySymbol = systemSettings?.currency_symbol || '€';
  let isWeightBased = product.unit_type === 'weight' || !product.unit_type; // Default to weight if not set
  
  // Show custom modal
  const modal = document.getElementById('weightModal');
  const modalTitle = document.getElementById('weightModalTitle');
  const productNameEl = document.getElementById('weightProductName');
  const productPriceEl = document.getElementById('weightProductPrice');
  const weightInput = document.getElementById('weightInput');
  const weightInputLabel = document.getElementById('weightInputLabel');
  const priceInput = document.getElementById('weightPriceInput');
  const priceInputLabel = document.getElementById('priceInputLabel');
  const okBtn = document.getElementById('weightOkBtn');
  const cancelBtn = document.getElementById('weightCancelBtn');
  const scaleBtn = document.getElementById('readScaleBtn');
  const scaleButtonContainer = document.getElementById('scaleButtonContainer');
  const weightModeBtn = document.getElementById('weightModeBtn');
  const quantityModeBtn = document.getElementById('quantityModeBtn');

  // Auto-read loop state (keeps weight updated while modal is open)
  let autoReadTimer = null;
  let autoReadInFlight = false;

  // Some scales briefly output 0.000 between real readings.
  // Hold the last non-zero weight and only show 0.000 when zero persists long enough.
  // This prevents looping: real weight -> 0.000 -> real weight -> 0.000.
  // Keep this small so removing all items shows 0 quickly.
  // Still non-zero to avoid flicker when the scale momentarily outputs 0 between frames.
  const ZERO_DEBOUNCE_MS = 400;
  let lastNonZeroScaleAt = 0;
  let zeroCandidateSinceAt = null;

  // Some devices intermittently emit max-capacity values (10/20/30kg) while empty.
  // Treat these as invalid while the scale is empty (prevents 10/20/30kg showing before adding).
  let hasSeenNonSpikeNonZeroSinceOpen = false;

  // Display unit for weight mode (always grams for this POS)
  let weightUnit = 'kg';

  // Live mode: always mirror the scale output (no "stable hold" gating).
  // We still avoid showing stale cached values from a previous modal.
  let lastDisplayedScaleGrams = null;

  // Prevent showing a previous item's cached weight when reopening the modal.
  // The main process may return a recently cached value (source: 'stream') for up to ~1500ms.
  const modalOpenedAt = Date.now();

  // Unit price used to derive totals when weight/qty changes.
  // When the user edits the total price field, we update this.
  let lockedUnitPrice = product.price;

  // Zero-price products (e.g. "Varios peso"): the cashier types the unit price
  // on a dial keypad while the item is on the scale. Total = unit price x weight.
  const isZeroPriceProduct = !(Number(product.price) > 0);
  const unitPriceGroup = document.getElementById('weightUnitPriceGroup');
  const unitPriceInput = document.getElementById('weightUnitPriceInput');
  const unitPriceLabel = document.getElementById('weightUnitPriceLabel');
  const unitPriceBackspace = document.getElementById('weightUnitPriceBackspace');
  const unitPriceDialpad = document.getElementById('weightUnitPriceDialpad');

  function getTypedUnitPrice() {
    const n = parseFloat(String(unitPriceInput?.value || '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Unit price to use when (re)entering a mode: the typed one for zero-price products.
  function getBaseUnitPrice() {
    return isZeroPriceProduct ? getTypedUnitPrice() : product.price;
  }

  function applyUnitPriceKey(key) {
    if (!unitPriceInput) return;
    let v = String(unitPriceInput.value || '');
    if (key === 'clear') v = '';
    else if (key === 'backspace') v = v.slice(0, -1);
    else if (key === 'dot') {
      if (v.includes('.')) return;
      v = v ? v + '.' : '0.';
    } else if (/^\d$/.test(key)) {
      const dot = v.indexOf('.');
      if (dot >= 0 && v.length - dot > 2) return; // max 2 decimals
      v = (v === '0') ? key : v + key;
    } else {
      return;
    }
    unitPriceInput.value = v;
    lockedUnitPrice = getTypedUnitPrice();
    // Let the total follow the new unit price even if the total field had focus.
    try { if (document.activeElement === priceInput) priceInput.blur(); } catch { /* ignore */ }
    updateDisplayedTotal();
  }

  if (unitPriceGroup) unitPriceGroup.style.display = isZeroPriceProduct ? 'block' : 'none';
  modal.classList.toggle('zero-price', isZeroPriceProduct);
  if (unitPriceInput) unitPriceInput.value = '';
  // Assign (not addEventListener): these elements are static and this function runs on every open.
  if (unitPriceDialpad) {
    unitPriceDialpad.onclick = (e) => {
      const btn = e.target?.closest?.('.dial-btn');
      if (btn) applyUnitPriceKey(String(btn.dataset.key || ''));
    };
  }
  if (unitPriceBackspace) unitPriceBackspace.onclick = () => applyUnitPriceKey('backspace');

  function getEnteredUnitPrice() {
    const rawText = (priceInput.value || '').toString().trim();
    if (!rawText) return NaN;
    const normalized = rawText.replace(',', '.');
    const priceNum = parseFloat(normalized);
    return Number.isFinite(priceNum) ? priceNum : NaN;
  }

  function getEnteredTotalPrice() {
    const rawText = (priceInput.value || '').toString().trim();
    if (!rawText) return NaN;
    const normalized = rawText.replace(',', '.');
    const totalNum = parseFloat(normalized);
    return Number.isFinite(totalNum) ? totalNum : NaN;
  }

  function setTotalPriceInput(total) {
    if (!Number.isFinite(total) || total <= 0) return;
    if (document.activeElement === priceInput) return; // don't fight typing
    priceInput.value = total.toFixed(2);
  }

  function updateDisplayedTotal() {
    if (isWeightBased) {
      const weightKg = getEnteredWeightKg();
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        if (document.activeElement !== priceInput) {
          priceInput.value = '0.00';
        }
        productPriceEl.innerHTML = `${currencySymbol}${lockedUnitPrice.toFixed(2)}/kg<br><strong style="color: #10b981; font-size: 18px;">Total: ${currencySymbol}0.00</strong>`;
        return;
      }
      const derivedTotal = lockedUnitPrice * weightKg;

      // Keep total price input synced when weight changes (unless user is typing)
      setTotalPriceInput(derivedTotal);

      productPriceEl.innerHTML = `${currencySymbol}${lockedUnitPrice.toFixed(2)}/kg<br><strong style="color: #10b981; font-size: 18px;">Total: ${currencySymbol}${derivedTotal.toFixed(2)}</strong>`;
      return;
    }

    const rawQtyText = (weightInput.value || '').toString().trim();
    const qty = parseFloat(rawQtyText.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      productPriceEl.textContent = `${currencySymbol}${lockedUnitPrice.toFixed(2)}/piece`;
      return;
    }
    const derivedTotal = lockedUnitPrice * qty;

    // Keep total price input synced when quantity changes (unless user is typing)
    setTotalPriceInput(derivedTotal);

    productPriceEl.innerHTML = `${currencySymbol}${lockedUnitPrice.toFixed(2)}/piece<br><strong style="color: #10b981; font-size: 18px;">Total: ${currencySymbol}${derivedTotal.toFixed(2)}</strong>`;
  }

  function getEnteredWeightKg() {
    const rawText = (weightInput.value || '').toString().trim();
    if (!rawText) return NaN;

    const normalizedText = rawText.replace(/\s+/g, '');
    const unitMatch = normalizedText.match(/(kg|g)$/i);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : null;

    const numericPart = unit ? normalizedText.slice(0, -unit.length) : normalizedText;
    const rawValue = parseFloat(numericPart.replace(',', '.'));
    if (!Number.isFinite(rawValue)) return NaN;

    // If the user explicitly typed a unit, honor it.
    if (unit === 'kg') return rawValue;
    if (unit === 'g') return rawValue / 1000;

    // Default to kilograms to match the physical scale display.
    return rawValue;
  }
  
  productNameEl.textContent = product.name;
  modal.style.display = 'flex';
  
  // Function to update UI based on mode
  function updateModeUI() {
    if (isWeightBased) {
      lockedUnitPrice = getBaseUnitPrice();
      if (unitPriceLabel) unitPriceLabel.textContent = `Price per kg (${currencySymbol})`;
      modalTitle.textContent = 'Enter Weight';
      weightUnit = 'kg';
      weightInputLabel.textContent = 'Weight (kg)';
      weightInput.placeholder = '0.000 kg';
      priceInputLabel.textContent = `Total Price (${currencySymbol})`;
      priceInput.placeholder = 'Total price';
      if (document.activeElement !== priceInput) {
        priceInput.value = '0.00';
      }
      productPriceEl.innerHTML = `${currencySymbol}${lockedUnitPrice.toFixed(2)}/kg<br><strong style="color: #10b981; font-size: 18px;">Total: ${currencySymbol}0.00</strong>`;
      // Live scale reading: hide the manual re-read button.
      scaleButtonContainer.style.display = 'none';
      weightModeBtn.style.background = '#6E8FAF';
      quantityModeBtn.style.background = '#94a3b8';
      weightInput.value = '0.000 kg';
    } else {
      lockedUnitPrice = getBaseUnitPrice();
      if (unitPriceLabel) unitPriceLabel.textContent = `Price per piece (${currencySymbol})`;
      modalTitle.textContent = 'Enter Quantity';
      weightInputLabel.textContent = 'Quantity (pieces)';
      weightInput.placeholder = 'Enter quantity';
      priceInputLabel.textContent = `Total Price (${currencySymbol})`;
      priceInput.placeholder = 'Total price';
      productPriceEl.textContent = `${currencySymbol}${lockedUnitPrice.toFixed(2)}/piece`;
      scaleButtonContainer.style.display = 'none';
      weightModeBtn.style.background = '#94a3b8';
      quantityModeBtn.style.background = '#6E8FAF';
      weightInput.value = '1';
    }
    // Don't auto-focus - let user click when ready

    // Refresh total display (quantity mode defaults to 1)
    updateDisplayedTotal();
  }

  function setWeightDisplayFromKg(weightKg) {
    if (!Number.isFinite(weightKg) || weightKg < 0) return;
    // Display exactly like the physical scale: kilograms with 3 decimals.
    const grams = Math.round(weightKg * 1000);
    if (typeof lastDisplayedScaleGrams === 'number' && grams === lastDisplayedScaleGrams) return;
    lastDisplayedScaleGrams = grams;

    const kgText = (grams / 1000).toFixed(3);
    weightUnit = 'kg';
    weightInputLabel.textContent = 'Weight (kg)';
    weightInput.value = '';
    weightInput.value = `${kgText} kg`;
    weightInput.placeholder = `${kgText} kg`;

    updateDisplayedTotal();
  }

  function handleManualWeightInput() {
    if (!isWeightBased) return;
    // Default to kilograms to match the physical scale.
    weightUnit = 'kg';
    weightInputLabel.textContent = 'Weight (kg)';
    updateDisplayedTotal();
  }

  function handleManualQuantityInput() {
    if (isWeightBased) return;
    updateDisplayedTotal();
  }

  function handleManualPriceInput() {
    if (isWeightBased) {
      const weightKg = getEnteredWeightKg();
      if (!Number.isFinite(weightKg) || weightKg <= 0) return;
      const total = getEnteredTotalPrice();
      if (!Number.isFinite(total) || total <= 0) return;
      lockedUnitPrice = total / weightKg;
      updateDisplayedTotal();
      return;
    }

    const rawQtyText = (weightInput.value || '').toString().trim();
    const qty = parseFloat(rawQtyText.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) return;
    const total = getEnteredTotalPrice();
    if (!Number.isFinite(total) || total <= 0) return;
    lockedUnitPrice = total / qty;
    updateDisplayedTotal();
  }

  function stopScaleAutoRead() {
    if (autoReadTimer) {
      clearInterval(autoReadTimer);
      autoReadTimer = null;
    }
  }

  function startScaleAutoRead() {
    if (!isWeightBased) return;
    if (autoReadTimer) return;

    // Poll the scale periodically to keep the field updated.
    autoReadTimer = setInterval(async () => {
      if (!isWeightModalOpen || !isWeightBased) return;
      if (autoReadInFlight) return;
      if (document.activeElement === weightInput) return; // don't fight manual typing

      autoReadInFlight = true;
      try {
        const weightResult = await window.api.readScaleWeight();
        if (!weightResult || !weightResult.success) return;

        const now = Date.now();

        // Ignore ANY weights from before the modal opened.
        // This fixes: open product -> add/close -> open again -> old weight flashes.
        if (
          typeof weightResult.lastUpdatedAt === 'number' &&
          weightResult.lastUpdatedAt > 0 &&
          weightResult.lastUpdatedAt < modalOpenedAt
        ) {
          return;
        }

        if (typeof weightResult.weight === 'number') {
          if (weightResult.weight > 0) {
            const grams = Math.round(weightResult.weight * 1000);
            const lastDisplayedGrams = typeof lastDisplayedScaleGrams === 'number' ? lastDisplayedScaleGrams : null;

            // If we're currently showing 0.000 and we suddenly get exactly 10/20/30kg,
            // treat it as a capacity spike and ignore it (empty-scale glitch).
            if (
              (lastDisplayedGrams === null || lastDisplayedGrams === 0) &&
              (grams === 10000 || grams === 20000 || grams === 30000)
            ) {
              // If you truly need to sell 10/20/30kg exact items, remove this guard.
              return;
            }

            // Mark that we've seen a real non-zero value (not a spike).
            if (!(grams === 10000 || grams === 20000 || grams === 30000)) {
              hasSeenNonSpikeNonZeroSinceOpen = true;
            }

            lastNonZeroScaleAt = now;
            zeroCandidateSinceAt = null;
            // Mirror the scale continuously.
            setWeightDisplayFromKg(weightResult.weight);
            return;
          }

          // If item removed from the scale, reflect that.
          // But debounce zero so we don't flicker when the scale glitches.
          if (weightResult.weight === 0 || weightResult.isZero) {
            // Don't reset hasSeenNonSpikeNonZeroSinceOpen here; keep it sticky for the modal.
            const lastDisplayedWasNonZero =
              typeof lastDisplayedScaleGrams === 'number' && lastDisplayedScaleGrams > 0;

            // If we've shown a non-zero recently, treat zero as a glitch until it persists.
            if (lastDisplayedWasNonZero) {
              if (zeroCandidateSinceAt === null) zeroCandidateSinceAt = now;

              // Require zero to be continuous for long enough, AND no non-zero seen recently.
              if (now - zeroCandidateSinceAt < ZERO_DEBOUNCE_MS) return;
              if (lastNonZeroScaleAt && now - lastNonZeroScaleAt < ZERO_DEBOUNCE_MS) return;
            }

            // Otherwise show 0 (or after debounce completes).
            setWeightDisplayFromKg(0);
            return;
          }
        }
      } catch (e) {
        // Silent during auto-read; manual entry remains available
      } finally {
        autoReadInFlight = false;
      }
    }, 100);
  }
  
  // Initial UI setup
  updateModeUI();

  // Ensure the modal never shows a previous item's value.
  lastDisplayedScaleGrams = null;
  
  // Toggle button handlers
  weightModeBtn.onclick = () => {
    isWeightBased = true;
    weightUnit = 'kg';
    updateModeUI();

    weightInput.removeEventListener('input', handleManualQuantityInput);
    weightInput.addEventListener('input', handleManualWeightInput);
    startScaleAutoRead();
  };
  
  quantityModeBtn.onclick = () => {
    isWeightBased = false;
    updateModeUI();
    weightInput.removeEventListener('input', handleManualWeightInput);
    weightInput.addEventListener('input', handleManualQuantityInput);
    stopScaleAutoRead();
  };
  
  // Automatically read from scale when modal opens (only for weight-based products)
  if (isWeightBased) {
    startScaleAutoRead();
    weightInput.addEventListener('input', handleManualWeightInput);
    priceInput.addEventListener('input', handleManualPriceInput);
  } else {
    weightInput.addEventListener('input', handleManualQuantityInput);
    priceInput.addEventListener('input', handleManualPriceInput);
  }
  // Don't auto-focus for quantity products - let user click when ready
  
  // Function to read weight from scale
  async function readWeightFromScale() {
    weightInput.placeholder = 'Reading from scale...';
    
    try {
      // Backend auto-connects to scale, we just read
      scaleConnected = true; // Assume scale is available
      
      // Read weight from scale
      addScaleDebugLog('🔄 Attempting to read weight from scale...', 'info');
      console.log('Reading weight from scale...');
      const weightResult = await window.api.readScaleWeight();
      console.log('Weight result:', weightResult);
      addScaleDebugLog(`📊 Result: ${JSON.stringify(weightResult)}`, weightResult.success ? 'success' : 'error');
      
      if (weightResult.success) {
        if (weightResult.isZero || (typeof weightResult.weight === 'number' && weightResult.weight === 0)) {
          // Connected, but no weight on the scale. Don't show a blocking popup.
          weightInput.value = '';
          weightInput.placeholder = 'Place item on scale';
          addScaleDebugLog('ℹ️ Scale connected but shows 0. Waiting for item...', 'warning');
        } else {
          setWeightDisplayFromKg(weightResult.weight);
          console.log('Weight read successfully:', weightResult.weight, 'kg');
          addScaleDebugLog(`✅ Weight: ${weightResult.weight} kg from ${weightResult.portPath || 'unknown port'}`, 'success');
        }
        if (weightResult.config) {
          addScaleDebugLog(`⚙️ Config: ${weightResult.config.baudRate} baud, ${weightResult.config.dataBits}${weightResult.config.parity.charAt(0).toUpperCase()}${weightResult.config.stopBits}`, 'info');
        }
        // Avoid stealing focus while the cashier adjusts items on the scale.
      } else {
        console.error('Failed to read weight:', weightResult.message);
        const msg = (weightResult && weightResult.message) ? String(weightResult.message) : '';
        weightInput.placeholder = msg ? msg : 'Enter weight manually';
        addScaleDebugLog(`❌ Error: ${msg}`, 'error');

        // If SerialPort failed to load, show the real underlying error details.
        if (weightResult && weightResult.serialportAvailable === false) {
          try {
            const status = await window.api.getScaleModuleStatus();
            addScaleDebugLog(`🧩 SerialPort available: ${status.serialportAvailable}`, status.serialportAvailable ? 'success' : 'error');
            addScaleDebugLog(`🖥️ Runtime: ${status.platform}/${status.arch} | Electron ${status.versions?.electron} | Node ${status.versions?.node}`, 'info');
            if (status.serialportError?.message) {
              addScaleDebugLog(`⚠️ SerialPort load error: ${status.serialportError.message}`, 'warning');
            }
          } catch (e) {
            addScaleDebugLog(`⚠️ Failed to fetch module status: ${e.message}`, 'warning');
          }
        }
        if (weightResult.portPath) {
          addScaleDebugLog(`📍 Port: ${weightResult.portPath}`, 'info');
        }
        if (weightResult.portsScanned && weightResult.portsScanned.length > 0) {
          addScaleDebugLog(`🔍 Scanned ports: ${weightResult.portsScanned.join(', ')}`, 'info');
        }
        if (weightResult.totalPorts !== undefined) {
          addScaleDebugLog(`📊 Total ports found: ${weightResult.totalPorts}`, 'info');
        }
        if (weightResult.allPorts) {
          addScaleDebugLog(`📋 All ports: ${weightResult.allPorts}`, 'info');
        }
        if (weightResult.diagnostics) {
          addScaleDebugLog(`🔧 Diagnostics: ${weightResult.diagnostics}`, 'warning');
        }
        if (weightResult.rawSample) {
          addScaleDebugLog(`📄 Raw data: ${weightResult.rawSample}`, 'warning');
        }
        if (weightResult.bytesReceived !== undefined) {
          addScaleDebugLog(`📦 Bytes received: ${weightResult.bytesReceived}`, 'info');
        }
        
        // Connected-but-silent case: avoid a scary "not connected" popup.
        if (weightResult.connected === true) {
          showAlert(msg || 'Scale connected, waiting for data...', 'info', 'Scale');
          return;
        }
        // Show connection-related errors with helpful instructions
        if (/no scale found|not connected|failed to connect|connect usb scale/i.test(msg)) {
          const helpfulMsg = msg + '\n\nTroubleshooting:\n' +
            '1. Check USB cable is firmly connected\n' +
            '2. Ensure scale is powered ON\n' +
            '3. Check Device Manager (Windows) for COM port\n' +
            '4. Install CH340/CH341 USB driver if needed\n' +
            '5. Try a different USB port';
          showAlert(helpfulMsg, 'warning', 'Scale');
        }
        // Timeout and other errors - no popup, just set placeholder
      }
    } catch (error) {
      console.error('Scale reading error:', error);
      weightInput.placeholder = 'Error - Enter weight manually';
      addScaleDebugLog(`💥 Exception: ${error.message}`, 'error');
      showAlert('Error reading from scale: ' + error.message + '. Please enter weight manually.', 'error', 'Scale Error');
    }
    
  }
  
  // Prevent multiple submissions
  let isSubmitting = false;
  
  // Handle OK button
  const handleOk = () => {
    if (isSubmitting) {
      console.log('Already submitting, ignoring duplicate call');
      return;
    }
    
    console.log('Setting isSubmitting to true');
    isSubmitting = true;
    
    const weight = weightInput.value.trim(); // Trim whitespace
    const customPrice = priceInput.value.trim(); // Trim whitespace (TOTAL price)
    console.log('=== HANDLE OK CLICKED ===');
    console.log('weightInput element:', weightInput);
    console.log('weightInput.value (raw):', weight, 'type:', typeof weight, 'length:', weight.length);
    console.log('priceInput.value (raw):', customPrice);
    console.log('isWeightBased:', isWeightBased);
    
    if (!weight) {
      console.log('No value entered');
      const fieldName = isWeightBased ? 'weight' : 'quantity';
      showAlert(`Please enter a ${fieldName}`, 'error', `Invalid ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`);
      isSubmitting = false;
      return;
    }
    
    const amountNum = isWeightBased ? getEnteredWeightKg() : parseFloat(weight);
    debugLog('>>> PARSED amountNum:', amountNum, 'type:', typeof amountNum);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.log('Invalid value');
      const fieldName = isWeightBased ? 'weight' : 'quantity';
      showAlert(`Please enter a valid ${fieldName}`, 'error', `Invalid ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`);
      isSubmitting = false;
      return;
    }


    
    // Validate total price and derive unit price
    const totalPriceNum = parseFloat(customPrice.replace(',', '.'));
    if (isNaN(totalPriceNum) || totalPriceNum <= 0) {
      showAlert('Please enter a valid total price', 'error', 'Invalid Price');
      isSubmitting = false;
      return;
    }

    const unitPriceNum = totalPriceNum / amountNum;
    if (!Number.isFinite(unitPriceNum) || unitPriceNum <= 0) {
      showAlert('Please enter a valid total price', 'error', 'Invalid Price');
      isSubmitting = false;
      return;
    }
    
    debugLog('>>> CALLING addToCart with amount:', amountNum, 'unit price:', unitPriceNum, 'isWeightBased:', isWeightBased);
    debugLog('isSubmitting flag:', isSubmitting);
    
    // Close modal first
    modal.style.display = 'none';
    
    // Call addToCart
    addToCart(productId, amountNum, unitPriceNum, isWeightBased);
    
    // Cleanup immediately
    cleanup();
    
    debugLog('handleOk completed - item should be added once');
  };
  
  // Handle Cancel button
  const handleCancel = () => {
    if (isSubmitting) return; // Prevent action if already submitting
    console.log('User cancelled');
    modal.style.display = 'none';
    isWeightModalOpen = false; // Reset flag
    cleanup();
  };
  
  // Cleanup function to remove event listeners
  const cleanup = () => {
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    weightInput.removeEventListener('keypress', handleEnter);
    weightInput.removeEventListener('input', handleManualWeightInput);
    weightInput.removeEventListener('input', handleManualQuantityInput);
    priceInput.removeEventListener('input', handleManualPriceInput);
    scaleBtn.removeEventListener('click', handleScaleRead);
    stopScaleAutoRead();
    isWeightModalOpen = false; // Reset flag on cleanup
  };
  
  // Handle Enter key
  const handleEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent any default behavior
      handleOk();
    }
  };
  
  // Handle scale button click (for manual re-read)
  const handleScaleRead = () => {
    if (isSubmitting) return; // Prevent if already submitting
    readWeightFromScale();
  };
  
  // Remove any existing listeners before adding new ones
  okBtn.removeEventListener('click', handleOk);
  cancelBtn.removeEventListener('click', handleCancel);
  weightInput.removeEventListener('keypress', handleEnter);
  scaleBtn.removeEventListener('click', handleScaleRead);
  
  // Add event listeners with { once: true } to prevent double submission
  okBtn.addEventListener('click', handleOk, { once: true });
  cancelBtn.addEventListener('click', handleCancel, { once: true });
  weightInput.addEventListener('keypress', handleEnter);
  scaleBtn.addEventListener('click', handleScaleRead);
}

// ============== EDIT CART WEIGHT ==============
function editCartWeight(productId) {
  const cartItem = cart.find(item => item.productId === productId);
  if (!cartItem) return;
  
  const product = getCachedProductById(productId);
  if (!product) return;
  
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  // Show custom modal
  const modal = document.getElementById('weightModal');
  const productNameEl = document.getElementById('weightProductName');
  const productPriceEl = document.getElementById('weightProductPrice');
  const weightInput = document.getElementById('weightInput');
  const okBtn = document.getElementById('weightOkBtn');
  const cancelBtn = document.getElementById('weightCancelBtn');
  const modalTitle = document.getElementById('weightModalTitle');
  
  modalTitle.textContent = 'Edit Weight';
  productNameEl.textContent = product.name;
  productPriceEl.textContent = `${currencySymbol}${product.price.toFixed(2)}/kg (Current: ${cartItem.quantity.toFixed(2)} kg)`;
  weightInput.value = cartItem.quantity.toFixed(2);
  modal.style.display = 'flex';
  
  // Focus and select all text
  setTimeout(() => {
    weightInput.focus();
    weightInput.select();
  }, 100);
  
  // Handle OK button
  const handleOk = () => {
    const newWeight = weightInput.value;
    
    if (!newWeight) {
      modal.style.display = 'none';
      cleanup();
      return;
    }
    
    const weightNum = parseFloat(newWeight);
    if (isNaN(weightNum) || weightNum <= 0) {
      showAlert('Please enter a valid weight', 'error', 'Invalid Weight');
      return;
    }
    
    // Update the cart item weight
    cartItem.quantity = weightNum;
    cartItem.subtotal = weightNum * cartItem.unitPrice;
    modal.style.display = 'none';
    modalTitle.textContent = 'Enter Weight'; // Reset title
    cleanup();
    updateCartDisplay();
  };
  
  // Handle Cancel button
  const handleCancel = () => {
    modal.style.display = 'none';
    modalTitle.textContent = 'Enter Weight'; // Reset title
    cleanup();
  };
  
  // Cleanup function
  const cleanup = () => {
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    weightInput.removeEventListener('keypress', handleEnter);
  };
  
  // Handle Enter key
  const handleEnter = (e) => {
    if (e.key === 'Enter') {
      handleOk();
    }
  };
  
  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
  weightInput.addEventListener('keypress', handleEnter);
}

async function searchAndAddProduct(query) {
  if (!query) return;

  const raw = String(query || '').trim();
  if (!raw) return;

  // Barcode scanners usually emit digits + Enter.
  // Prefer exact barcode match first to avoid ambiguous partial matches.
  const digitsOnly = raw.replace(/\s+/g, '');
  const looksLikeBarcode = /^\d{6,}$/.test(digitsOnly);

  const openNewProductWithBarcode = async (barcode, sourceLabel = 'Checkout') => {
    const bc = String(barcode || '').replace(/\s+/g, '').trim();
    if (!bc) return;

    const ok = await showConfirmDialog({
      title: 'Product not found',
      message: `Barcode: ${bc}\n\nCreate a new product with this barcode?`,
      confirmText: 'Create Product',
      cancelText: 'Cancel'
    });
    if (!ok) return;

    // Fast path: open the quick-add form (optimized for scanners).
    // Default VAT % comes from system settings.
    try {
      if (!systemSettings) {
        systemSettings = await window.api.getSystemSettings();
      }
    } catch {
      // ignore
    }

    const defaultVatPct = Number.isFinite(Number(systemSettings?.tax_rate))
      ? Number(systemSettings.tax_rate) * 100
      : 19;

    const res = await showQuickAddProductDialog({
      barcode: bc,
      defaults: {
        salesVatPercent: defaultVatPct,
        purchaseVatPercent: defaultVatPct,
        stock: ''
      }
    });

    if (!res || !res.ok) return;

    // Refresh product caches so cart lookup can find the new product.
    try {
      await loadAllProducts();
      displayQuickProducts('');
    } catch {
      // ignore
    }

    const createdId = Number(res.productId);
    if (Number.isFinite(createdId) && createdId > 0) {
      openProductWeightFlow(createdId);
      return;
    }

    // Fallback: fetch by barcode if API didn't return an id
    try {
      const p = await window.api.getProductByBarcode(bc);
      if (p && p.id) {
        openProductWeightFlow(p.id);
      }
    } catch {
      // ignore
    }
  };
  if (looksLikeBarcode && typeof window.api.getProductByBarcode === 'function') {
    try {
      const product = await window.api.getProductByBarcode(digitsOnly);
      if (product && product.id) {
        // Ensure cache has this product (scan can happen before loadAllProducts finishes)
        cacheProductRecord(product);

        if (checkoutScanEditMode) {
          if (!hasPermission('products')) {
            showAlert('Access Denied: You do not have permission to edit products', 'error', 'Access Denied');
            return;
          }
          await editProduct(product.id, { priceOnly: true });
          return;
        }

        openProductWeightFlow(product.id);
        return;
      }

      // Barcode scan, but unknown barcode → offer to create product.
      await openNewProductWithBarcode(digitsOnly, 'Checkout');
      return;
    } catch {
      // Fall back to search below
    }
  }

  // Fallback: search by product name/barcode/category
  const results = await window.api.searchProducts(raw);
  
  if (results.length === 0) {
    // If this looks like a barcode scan, offer to create the product.
    if (looksLikeBarcode) {
      await openNewProductWithBarcode(digitsOnly, 'Checkout');
      return;
    }
    showAlert('Product not found', 'error', 'Not Found');
    return;
  }
  
  if (results.length === 1) {
    cacheProductRecord(results[0]);
    openProductWeightFlow(results[0].id);
  } else {
    // Multiple results - show alert to select from products grid
    showAlert('Multiple products found. Please select from the product grid below.', 'info', 'Multiple Results');
  }
}

// Barcode-only POS entry flow.
// For zero-price (variable-price) products: ask for unit price first, then add 1 piece.
function openProductWeightFlow(productId, options = {}) {
  const product = getCachedProductById(productId);
  if (!product) return;

  const refocusAfterAdd = options?.refocusScannerTarget !== false;

  const refocusScannerTarget = () => {
    try {
      const el = document.getElementById('productSearch');
      if (!el) return;
      try { window.__virtualKeyboardSuppressOnce = true; } catch { /* ignore */ }
      el.focus();
      el.select?.();
    } catch {
      // ignore
    }
  };

  // Weight products: open the weight/scale modal (live scale reading, editable total price).
  if (!POS_DISABLE_SCALE_AND_WEIGHT && product.unit_type === 'weight') {
    promptForWeight(productId);
    return;
  }

  // Normal products: each scan/click adds 1 piece.
  if (!(Number(product.price) <= 0)) {
    addToCart(productId, 1, null, false);
    if (refocusAfterAdd) refocusScannerTarget();
    return;
  }

  // Zero-price items: prompt for unit price per piece, then add 1.
  const currencySymbol = systemSettings?.currency_symbol || '€';
  const unitLabel = '/piece';

  const existing = document.getElementById('unitPriceEntryOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'unitPriceEntryOverlay';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,0.55)',
    'padding:18px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    // Keep below the on-screen keyboard (z-index: 10002) so it stays usable.
    'z-index:10001'
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(520px, 92vw)',
    'background:#fff',
    'border-radius:22px',
    'box-shadow:0 18px 60px rgba(0,0,0,0.35)',
    'padding:22px 20px'
  ].join(';');

  card.innerHTML = `
    <div style="text-align:center; font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;">
      <div style="font-size:26px; font-weight:900; color:#0f172a; margin-bottom:4px;">Enter Price</div>
      <div style="font-size:14px; color:#64748b; margin-bottom:14px;">${product.name}</div>
      <div style="font-size:14px; font-weight:800; color:#334155; margin-bottom:10px;">Unit Price (${unitLabel})</div>
      <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:14px;">
        <div style="font-size:22px; font-weight:900; color:#334155;">${currencySymbol}</div>
        <input id="unitPriceEntryInput" type="text" inputmode="none" placeholder="0.00" autocomplete="off" readonly
          style="width:206px; font-size:24px; text-align:center; padding:12px 12px; border-radius:14px; border:2px solid #cbd5e1; outline:none;" />
        <button type="button" id="unitPriceEntryBackspaceBtn" class="unit-price-input-backspace" aria-label="Backspace">⌫</button>
      </div>

      <div class="unit-price-dialpad" id="unitPriceDialpad" role="group" aria-label="Number keypad">
        <button type="button" class="dial-btn" data-key="1">1</button>
        <button type="button" class="dial-btn" data-key="2">2</button>
        <button type="button" class="dial-btn" data-key="3">3</button>
        <button type="button" class="dial-btn" data-key="4">4</button>
        <button type="button" class="dial-btn" data-key="5">5</button>
        <button type="button" class="dial-btn" data-key="6">6</button>
        <button type="button" class="dial-btn" data-key="7">7</button>
        <button type="button" class="dial-btn" data-key="8">8</button>
        <button type="button" class="dial-btn" data-key="9">9</button>
        <button type="button" class="dial-btn dial-btn-secondary" data-key="clear">C</button>
        <button type="button" class="dial-btn" data-key="0">0</button>
        <button type="button" class="dial-btn dial-btn-secondary" data-key="dot">.</button>
      </div>

      <div style="display:flex; gap:14px; justify-content:center;">
        <button id="unitPriceEntryCancel" style="flex:1; max-width:220px; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:#94a3b8; color:#fff;">Cancel</button>
        <button id="unitPriceEntryOk" style="flex:1; max-width:220px; border:none; border-radius:16px; padding:14px 12px; font-size:18px; font-weight:900; background:#0ea5e9; color:#fff;">Submit</button>
      </div>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const input = document.getElementById('unitPriceEntryInput');
  const inputBackspaceBtn = document.getElementById('unitPriceEntryBackspaceBtn');
  const okBtn = document.getElementById('unitPriceEntryOk');
  const cancelBtn = document.getElementById('unitPriceEntryCancel');
  const dialpad = document.getElementById('unitPriceDialpad');

  const normalizeValue = (raw) => {
    let v = String(raw || '').replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot >= 0) {
      const before = v.slice(0, firstDot);
      const after = v.slice(firstDot + 1).replace(/\./g, '');
      v = before + '.' + after;
    }
    // Prevent crazy leading zeros like 0002 (but keep 0.x)
    if (v.length > 1 && v.startsWith('0') && v[1] !== '.') {
      v = v.replace(/^0+/, '');
      if (!v) v = '0';
    }
    return v;
  };

  const setInputValue = (next) => {
    if (!input) return;
    input.value = normalizeValue(next);
  };

  const appendKey = (key) => {
    if (!input) return;
    const cur = String(input.value || '');
    if (key === 'clear') return setInputValue('');
    if (key === 'backspace') return setInputValue(cur.slice(0, -1));
    if (key === 'dot') {
      if (!cur) return setInputValue('0.');
      if (cur.includes('.')) return;
      return setInputValue(cur + '.');
    }
    // digits
    if (/^\d$/.test(key)) {
      return setInputValue(cur + key);
    }
  };

  const cleanup = () => {
    try { document.removeEventListener('keydown', keydownHandler, true); } catch { /* ignore */ }
    overlay.remove();
  };

  const submit = () => {
    const raw = (input?.value ?? '').toString().trim();
    const unitPrice = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      showAlert('Please enter a valid unit price', 'error', 'Invalid Price');
      return;
    }

    cleanup();

    // Add 1 piece at the entered unit price.
    addToCart(productId, 1, unitPrice, false);
    if (refocusAfterAdd) refocusScannerTarget();
  };

  const keydownHandler = (e) => {
    try {
      if (!document.getElementById('unitPriceEntryOverlay')) return;
      const k = String(e.key || '');
      if (k === 'Escape') {
        e.preventDefault();
        cleanup();
        return;
      }
      if (k === 'Enter') {
        e.preventDefault();
        submit();
        return;
      }
      if (k === 'Backspace') {
        e.preventDefault();
        appendKey('backspace');
        return;
      }
      if (k === '.' || k === ',') {
        e.preventDefault();
        appendKey('dot');
        return;
      }
      if (/^\d$/.test(k)) {
        e.preventDefault();
        appendKey(k);
      }
    } catch {
      // ignore
    }
  };

  // Dialpad taps
  if (dialpad) {
    dialpad.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button[data-key]');
      if (!btn) return;
      const key = String(btn.dataset.key || '');
      appendKey(key);
    });
  }

  // Dedicated backspace button next to the input
  if (inputBackspaceBtn) {
    inputBackspaceBtn.addEventListener('click', () => appendKey('backspace'));
  }

  // Allow physical keyboard input while overlay is open
  document.addEventListener('keydown', keydownHandler, true);

  if (cancelBtn) cancelBtn.addEventListener('click', cleanup, { once: true });
  if (okBtn) okBtn.addEventListener('click', submit);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  // Keep focus off the readonly field on touch Windows PCs so the OS/app keyboard
  // does not pop up when this price-entry overlay opens.
  setTimeout(() => {
    try {
      try { input?.blur?.(); } catch { /* ignore */ }
      okBtn?.focus?.();
    } catch {
      // ignore
    }
  }, 0);
}

// Prompt the cashier for the Varios price. Returns a positive number or null.
function promptForVariosPrice() {
  return new Promise((res) => {
    const existingPrompt = document.getElementById('variosPromptOverlay');
    if (existingPrompt) existingPrompt.remove();

    const currencySymbol = systemSettings?.currency_symbol || '€';

    const o = document.createElement('div');
    o.id = 'variosPromptOverlay';
    o.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(15, 23, 42, 0.55)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'z-index:10070'
    ].join(';');

    const c = document.createElement('div');
    c.style.cssText = [
      'width:min(460px, 94vw)',
      'background:#fff',
      'border-radius:20px',
      'box-shadow:0 22px 70px rgba(0,0,0,0.35)',
      'border:1px solid rgba(148,163,184,0.55)',
      'padding:18px 18px 16px 18px',
      'font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial'
    ].join(';');

    c.innerHTML = `
      <div style="font-size:18px; font-weight:950; color:#0f172a;">Varios</div>
      <div style="font-size:14px; color:#64748b; margin-top:4px;">Introduzca el importe</div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:12px;">
        <div style="font-weight:950; color:#334155; font-size:20px;">${currencySymbol}</div>
        <input id="variosPromptInput" type="text" inputmode="decimal" readonly placeholder="0.00" style="flex:1; padding:14px 14px; border-radius:14px; border:2px solid #cbd5e1; font-size:24px; font-weight:900; color:#0f172a; text-align:right; background:#f8fafc;" />
      </div>
      <div class="modal-numpad-grid" id="variosNumpad" style="margin-top:12px;">
        <button type="button" class="modal-numpad-btn" data-value="1">1</button>
        <button type="button" class="modal-numpad-btn" data-value="2">2</button>
        <button type="button" class="modal-numpad-btn" data-value="3">3</button>
        <button type="button" class="modal-numpad-btn modal-numpad-back" data-value="back">⌫</button>
        <button type="button" class="modal-numpad-btn" data-value="4">4</button>
        <button type="button" class="modal-numpad-btn" data-value="5">5</button>
        <button type="button" class="modal-numpad-btn" data-value="6">6</button>
        <button type="button" class="modal-numpad-btn modal-numpad-clear" data-value="clear">CLEAR</button>
        <button type="button" class="modal-numpad-btn" data-value="7">7</button>
        <button type="button" class="modal-numpad-btn" data-value="8">8</button>
        <button type="button" class="modal-numpad-btn" data-value="9">9</button>
        <button type="button" class="modal-numpad-btn modal-numpad-dot" data-value=".">.</button>
        <button type="button" class="modal-numpad-btn" data-value="00">00</button>
        <button type="button" class="modal-numpad-btn" data-value="0">0</button>
        <button type="button" class="modal-numpad-btn" data-value="000">000</button>
      </div>
      <div style="display:flex; gap:12px; margin-top:14px;">
        <button id="variosPromptCancel" style="flex:1; border:none; border-radius:16px; padding:12px 10px; font-size:16px; font-weight:900; background:#e2e8f0; color:#0f172a;">Cancelar</button>
        <button id="variosPromptOk" style="flex:1; border:none; border-radius:16px; padding:12px 10px; font-size:16px; font-weight:900; background:linear-gradient(135deg,#0891b2,#06b6d4); color:#fff;">Añadir</button>
      </div>
    `;

    o.appendChild(c);
    document.body.appendChild(o);

    const inp = document.getElementById('variosPromptInput');

    const closePrompt = (val = null) => {
      try { o.remove(); } catch { /* ignore */ }
      res(val);
    };

    const parsePrice = (value) => {
      const v = String(value || '').trim().replace(',', '.');
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n;
    };

    const submit = () => closePrompt(parsePrice(inp?.value));

    // On-screen keypad input.
    const applyKey = (val) => {
      let cur = String(inp?.value || '');
      if (val === 'clear') {
        cur = '';
      } else if (val === 'back') {
        cur = cur.slice(0, -1);
      } else if (val === '.') {
        if (!cur.includes('.')) cur = cur === '' ? '0.' : cur + '.';
      } else {
        // digit groups: 0-9, 00, 000
        cur += val;
      }
      if (inp) inp.value = cur;
    };

    document.getElementById('variosNumpad')?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.modal-numpad-btn');
      if (!btn) return;
      applyKey(btn.dataset.value);
    });

    o.addEventListener('click', (e) => {
      if (e.target === o) closePrompt(null);
    });
    document.getElementById('variosPromptCancel')?.addEventListener('click', () => closePrompt(null), { once: true });
    document.getElementById('variosPromptOk')?.addEventListener('click', submit, { once: true });

    // Allow a physical keyboard / numeric keypad too.
    document.addEventListener('keydown', function variosKeyHandler(e) {
      if (!document.getElementById('variosPromptOverlay')) {
        document.removeEventListener('keydown', variosKeyHandler);
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); closePrompt(null); }
      else if (e.key === 'Backspace') { e.preventDefault(); applyKey('back'); }
      else if (e.key === '.' || e.key === ',') { e.preventDefault(); applyKey('.'); }
      else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); applyKey(e.key); }
    });
  });
}

// Cached id of the hidden internal "Varios" placeholder product row (see
// database.js ensureVariosProduct). sale_items.product_id is NOT NULL with a
// FOREIGN KEY to products(id), so Varios lines must point at a real row.
let variosProductId = null;
async function getVariosProductId() {
  if (Number.isFinite(variosProductId) && variosProductId > 0) return variosProductId;
  try {
    const id = Number(await window.api.getVariosProductId());
    if (Number.isFinite(id) && id > 0) variosProductId = id;
  } catch {
    // ignore
  }
  return variosProductId;
}

// Add a generic "Varios" (miscellaneous) line to the cart at the given price.
// There is no real product behind it beyond the hidden internal placeholder
// row (see getVariosProductId above); the receipt / sale records show the
// name "Varios" regardless of the underlying product row's own name.
async function addVariosLine(price) {
  const variosId = await getVariosProductId();
  if (!variosId) {
    showAlert('Could not add Varios line (internal product missing)', 'error', 'Error');
    return;
  }

  const unitPriceCents = moneyToCents(price);
  const cartItem = {
    productId: variosId,
    productName: 'Varios',
    unitPriceCents,
    unitPrice: centsToMoney(unitPriceCents),
    taxRate: 0,
    quantity: 1,
    quantityGrams: null,
    subtotalCents: unitPriceCents,
    subtotal: centsToMoney(unitPriceCents),
    isWeightBased: false,
    cartItemId: Date.now(),
    discountPercent: 0
  };
  cart.unshift(cartItem); // Add to beginning (most recent first)

  // Track undo action so DESHACER removes the Varios line just added.
  setLastScanUndoAction({ type: 'add', cartItemId: cartItem.cartItemId });

  updateCartDisplay();
  updateCustomerDisplayData();
}

// VARIOS button: use the amount already typed on the numpad if there is one,
// otherwise ask for the price. Either way a "Varios" line is added to the cart.
async function addVariosToCart() {
  hideCashierPaymentSummaryOverlay();

  const paymentInput = document.getElementById('paymentInput');
  const raw = paymentInput ? String(paymentInput.value || '').trim() : '';
  const typed = parseFloat(raw);

  if (raw && Number.isFinite(typed) && typed > 0) {
    // Clear the numpad amount (and pending buffer) now that it's been consumed.
    if (typeof setupCheckoutHandlers._clearNumpadPending === 'function') {
      setupCheckoutHandlers._clearNumpadPending();
    } else if (paymentInput) {
      paymentInput.value = '';
    }
    await addVariosLine(typed);
    return;
  }

  // Nothing usable typed: prompt for the price.
  const price = await promptForVariosPrice();
  if (price === null) return; // cancelled
  await addVariosLine(price);
}

function addToCart(productId, weight = null, customPrice = null, isWeightBased = false) {
  hideCashierPaymentSummaryOverlay();
  debugLog('=== addToCart START ===');
  debugLog('productId:', productId);
  debugLog('weight parameter:', weight, 'type:', typeof weight);
  debugLog('customPrice:', customPrice);
  debugLog('isWeightBased:', isWeightBased);

  const product = getCachedProductById(productId);
  debugLog('Product found:', product);
  if (!product) {
    debugLog('Product not found in addToCart');
    return;
  }
  
  // Default quantity is 1 (kg or pc) if not provided
  const finalQuantity = weight !== null ? weight : 1.0;
  // Use custom price if provided, otherwise use product price
  const finalPrice = customPrice !== null ? customPrice : product.price;
  debugLog('>>> CALCULATED: Final quantity:', finalQuantity, 'Final price:', finalPrice);

  // Calculate exact line subtotal in cents (avoid float drift)
  const unitPriceCents = moneyToCents(finalPrice);
  const quantityGrams = isWeightBased ? kgToGrams(finalQuantity) : null;
  const normalizedQty = isWeightBased ? gramsToKg(quantityGrams) : Number(finalQuantity);
  const lineSubtotalCents = isWeightBased
    ? Math.round((unitPriceCents * quantityGrams) / 1000)
    : (Number.isFinite(normalizedQty) ? Math.round(unitPriceCents * normalizedQty) : 0);
  debugLog('Line subtotal cents:', lineSubtotalCents);

  // Barcode-only behavior: repeated scans should increase quantity (not add duplicate lines).
  // Keep this disabled while editing existing PARKING/loan sales to avoid DB inconsistencies.
  const parkingCtx = getParkingPaymentContext();
  const canMerge = !parkingCtx
    && !isWeightBased
    && Number.isFinite(normalizedQty)
    && normalizedQty > 0;

  if (canMerge) {
    const targetIndex = cart.findIndex(i =>
      i
      && i.productId === product.id
      && i.isWeightBased === false
      && typeof i.unitPriceCents === 'number'
      && i.unitPriceCents === unitPriceCents
      && !i.saleItemId
      && !i.loanId
      && Number(i.discountPercent || 0) === 0
    );

    if (targetIndex >= 0) {
      const target = cart[targetIndex];
      const currentQty = Number(target.quantity || 0);
      const nextQty = currentQty + normalizedQty;

      if (!Number.isFinite(nextQty) || nextQty <= 0) {
        showAlert('Invalid quantity', 'error', 'Error');
        return;
      }
      target.quantity = nextQty;
      target.quantityGrams = null;
      try { recalcCartItemMoney(target); } catch { /* ignore */ }

      // Track undo action for the last scan.
      setLastScanUndoAction({
        type: 'merge',
        cartItemId: target.cartItemId,
        prevQty: currentQty
      });

      // Move updated line to the top (most recently scanned).
      if (targetIndex > 0) {
        cart.splice(targetIndex, 1);
        cart.unshift(target);
      }

      updateCartDisplay();
      updateCustomerDisplayData();
      return;
    }
  }
  
  // VAT is product-level (category VAT is not used)
  const productTaxRate = Number(product.tax_rate);
  const category = allCategories.find(c => c.name === product.category);
  const fallbackTaxRate = category ? Number(category.tax_rate) : 0;
  const finalTaxRate = Number.isFinite(productTaxRate) ? productTaxRate : (Number.isFinite(fallbackTaxRate) ? fallbackTaxRate : 0);
  
  // Add as new item (first scan of this barcode/price)
  const cartItem = {
    productId: product.id,
    productName: product.name,
    unitPriceCents,
    unitPrice: centsToMoney(unitPriceCents), // Derived from cents
    taxRate: finalTaxRate,
    quantity: isWeightBased ? normalizedQty : normalizedQty,
    quantityGrams: quantityGrams,
    subtotalCents: lineSubtotalCents,
    subtotal: centsToMoney(lineSubtotalCents),
    isWeightBased: isWeightBased, // Track whether it's weight or quantity based
    cartItemId: Date.now(), // Unique ID for each cart item to allow duplicates
    discountPercent: 0 // Discount as percentage (0%, 10%, 20%, etc.)
  };
  cart.unshift(cartItem); // Add to beginning (most recent first)

  // Track undo action for the last scan.
  setLastScanUndoAction({
    type: 'add',
    cartItemId: cartItem.cartItemId
  });
  
  updateCartDisplay();

  // Update customer display (centralized behavior: last item like the reference POS)
  updateCustomerDisplayData();
}

function updateCartQuantity(productId, change) {
  const item = cart.find(i => i.productId === productId);
  const product = getCachedProductById(productId);
  
  if (!item || !product) return;
  
  const newQuantity = item.quantity + change;
  
  if (newQuantity <= 0) {
    removeFromCart(item.cartItemId);
  } else {
    item.quantity = newQuantity;
    if (item.isWeightBased) {
      item.quantityGrams = kgToGrams(item.quantity);
      item.quantity = gramsToKg(item.quantityGrams);
    }
    recalcCartItemMoney(item);
    updateCartDisplay();
  }
}

function removeFromCart(cartItemId) {
  const parkingPaymentInfo = sessionStorage.getItem('parkingPayment');
  if (parkingPaymentInfo) {
    // Paying an existing PARKING from the PARKING screen. Removal must update the DB.
    (async () => {
      try {
        const ctx = JSON.parse(parkingPaymentInfo);
        const receiptNumber = String(ctx?.receiptNumber || '').trim();
        if (!receiptNumber) throw new Error('Missing PARKING receipt number');

        const cartItem = cart.find(i => i.cartItemId === cartItemId);
        const saleItemId = Number(cartItem?.saleItemId);
        const loanId = Number(cartItem?.loanId);
        if (!Number.isFinite(loanId) || !Number.isFinite(saleItemId)) {
          throw new Error('This item cannot be removed from PARKING');
        }

        await window.api.removeLoanSaleItem(loanId, saleItemId);

        // Reload the parking items from DB so cart + totals match.
        const loan = await window.api.getLoanByReceipt(receiptNumber);
        const status = (loan?.status || '').toString().toLowerCase();
        if (loan && loan.sale && Array.isArray(loan.sale.items)) {
          cart = loan.sale.items.map(item => ({
            productId: item.product_id || `parking_item_${Date.now()}_${Math.random()}`,
            productName: item.product_name || 'Parking Item',
            saleItemId: item.id,
            loanId: loan.id,
            unitPrice: item.unit_price || item.price || (item.subtotal / item.quantity),
            taxRate: item.tax_rate || 0,
            quantity: item.quantity || 1,
            subtotal: item.subtotal || item.price || 0,
            isWeightBased: POS_DISABLE_SCALE_AND_WEIGHT ? false : (item.unit_type === 'weight'),
            cartItemId: Date.now() + Math.random(),
            discountPercent: Number(item.discount_percent || 0)
          }));
        }

        // If all items are removed (or the tab is already settled), exit PARKING edit mode
        // so the next customer sale is not affected.
        if (!cart.length || status === 'paid' || Number(loan?.remaining_amount || 0) <= 0) {
          sessionStorage.removeItem('parkingPayment');
          selectedPaymentMethod = null;
          paymentMode = 'single';
          updateCartDisplay();
          try {
            const paymentModal = document.getElementById('paymentModal');
            if (paymentModal && paymentModal.classList.contains('active')) {
              closePaymentModalFunc();
            }
          } catch {
            // ignore
          }
          showAlert('PARKING updated', 'success');
          return;
        }

        setParkingPaymentContext({
          receiptNumber,
          amount: Number(loan?.remaining_amount || 0),
          remainingAmount: Number(loan?.remaining_amount || 0),
          status: (loan?.status || '').toString().toLowerCase(),
          customerType: (loan?.customer_type || '').toString().toLowerCase(),
          restaurantName: loan?.restaurant_name || null,
          customerName: loan?.customer_name || null,
          customerPhone: loan?.customer_phone || null,
          timestamp: Date.now()
        });

        // Keep cart open for further edits/payment; only clear cart when selecting PARKING.
        updateCartDisplay();

        // If payment inputs were previously filled, they can keep showing an old amount.
        // Reset/sync so totals update on the spot.
        try {
          const paymentModal = document.getElementById('paymentModal');
          const paymentInput = document.getElementById('paymentInput');
          const cashPaidInput = document.getElementById('cashPaidInput');
          const isPaymentModalOpen = !!(paymentModal && paymentModal.classList.contains('active'));
          const total = calculateTotal();

          if (paymentInput) {
            if (isPaymentModalOpen && selectedPaymentMethod && selectedPaymentMethod !== 'cash') {
              paymentInput.value = String(total.toFixed(2));
            } else {
              // Default to total in the summary tiles
              paymentInput.value = '';
            }
          }

          // Don't wipe cashier-entered cash if they are actively paying cash
          if (!isPaymentModalOpen || selectedPaymentMethod !== 'cash') {
            if (cashPaidInput) cashPaidInput.value = '';
          }
        } catch {
          // ignore
        }

        // Re-render summary tiles with the synced payment inputs
        updateCartSummary();
      } catch (e) {
        showAlert('Failed to remove item from PARKING: ' + (e?.message || e), 'error');
      }
    })();
    return;
  }

  const removedItem = cart.find(item => item.cartItemId === cartItemId);
  cart = cart.filter(item => item.cartItemId !== cartItemId);
  updateCartDisplay();
  flashCustomerDisplayRemovedItem(removedItem);
}

function setupInlineCartEditing() {
  const cartTableBody = document.getElementById('cartTableBody');
  if (!cartTableBody) return;

  if (setupInlineCartEditing._handlersAttached) return;
  setupInlineCartEditing._handlersAttached = true;

  const isVirtualKeyboardClick = () => {
    const activeEl = document.activeElement;
    return !!(activeEl && (activeEl.closest('#virtualKeyboard') || activeEl.closest('.key-btn') || activeEl.closest('.numpad-btn')));
  };

  const placeInputAndFocus = (containerEl, inputEl) => {
    containerEl.textContent = '';
    containerEl.appendChild(inputEl);
    if (inputEl.dataset.noVk !== '1') {
      try { window.__virtualKeyboardForceOpen = true; } catch { /* ignore */ }
    } else {
      try { window.__virtualKeyboardSuppressOnce = true; } catch { /* ignore */ }
    }
    inputEl.focus();
    const length = inputEl.value.length;
    try {
      inputEl.setSelectionRange(length, length);
    } catch {
      // ignore
    }
  };

  const attachCommonInputHandlers = (inputEl, { onSave, onCancel }) => {
    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (!isVirtualKeyboardClick()) onSave();
        else inputEl.focus();
      }, 100);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSave();
      if (e.key === 'Escape') onCancel();
    });
  };

  const beginEditQuantity = (cellEl, cartItem) => {
    const unit = cartItem.isWeightBased ? 'kg' : 'pc';
    // For piece/count items, treat quantity as an integer to avoid confusing decimals.
    const isCountBased = !cartItem.isWeightBased;
    const currentValue = isCountBased
      ? String(Math.max(1, Math.round(Number(cartItem.quantity) || 1)))
      : cartItem.quantity.toFixed(3);

    const input = document.createElement('input');
    input.type = 'text';
    // Use attribute + property so Electron/Chromium consistently exposes it.
    input.setAttribute('inputmode', isCountBased ? 'numeric' : 'decimal');
    input.inputMode = isCountBased ? 'numeric' : 'decimal';
    input.setAttribute('enterkeyhint', 'done');
    input.autocomplete = 'off';
    input.value = currentValue;
    // Hint to the virtual keyboard: first key press should replace the whole value.
    input.dataset.replaceOnNextKey = '1';
    input.dataset.noVk = '1';
    input.style.cssText = 'width: 80px; text-align: center; font-weight: 800; font-size: 14px; padding: 4px; border: 2px solid #6EAFAF; border-radius: 4px;';

    // On focus, select all so typing replaces (touch friendly)
    input.addEventListener('focus', () => {
      try { input.select(); } catch { /* ignore */ }
    });

    const saveValue = () => {
      let valueStr = input.value.trim().replace(',', '.');
      if (valueStr.startsWith('.')) valueStr = '0' + valueStr;

      if (isCountBased) {
        // Pieces must be whole numbers
        const digits = valueStr.replace(/[^0-9]/g, '');
        const newQty = parseInt(digits, 10);
        if (Number.isFinite(newQty) && newQty > 0) {
          cartItem.quantityGrams = null;
          cartItem.quantity = newQty;
          recalcCartItemMoney(cartItem);
        }
      } else {
        const newValue = parseFloat(valueStr);
        if (!isNaN(newValue) && newValue > 0 && /^\d*\.?\d*$/.test(valueStr)) {
          cartItem.quantityGrams = kgToGrams(newValue);
          cartItem.quantity = gramsToKg(cartItem.quantityGrams);
          recalcCartItemMoney(cartItem);
        }
      }
      updateCartDisplay();
      flashCustomerDisplayCartItem(cartItem.cartItemId);
    };

    placeInputAndFocus(cellEl, input);
    // Ensure full replace behavior even if focus happens before listeners attach.
    setTimeout(() => {
      try { input.focus(); input.select(); } catch { /* ignore */ }
    }, 0);
    attachCommonInputHandlers(input, { onSave: saveValue, onCancel: updateCartDisplay });
  };

  const beginEditPrice = (cellEl, cartItem) => {
    const currentValue = centsToMoney(cartItem.unitPriceCents ?? moneyToCents(cartItem.unitPrice)).toFixed(2);

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('inputmode', 'decimal');
    input.inputMode = 'decimal';
    input.setAttribute('enterkeyhint', 'done');
    input.autocomplete = 'off';
    input.value = currentValue;
    input.dataset.noVk = '1';
    input.style.cssText = 'width: 100px; text-align: center; font-size: 14px; padding: 4px; border: 2px solid #6EAFAF; border-radius: 4px;';

    const saveValue = () => {
      let valueStr = input.value.trim().replace(',', '.');
      if (valueStr.startsWith('.')) valueStr = '0' + valueStr;
      const newValue = parseFloat(valueStr);
      if (!isNaN(newValue) && valueStr !== '' && /^\d*\.?\d*$/.test(valueStr)) {
        cartItem.unitPriceCents = moneyToCents(newValue);
        cartItem.unitPrice = centsToMoney(cartItem.unitPriceCents);
        recalcCartItemMoney(cartItem);
      }
      updateCartDisplay();
      flashCustomerDisplayCartItem(cartItem.cartItemId);
    };

    placeInputAndFocus(cellEl, input);
    attachCommonInputHandlers(input, { onSave: saveValue, onCancel: updateCartDisplay });
  };

  const beginEditName = (cellEl, cartItem) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = cartItem.productName;
    input.style.cssText = 'width: 100%; font-size: 14px; padding: 4px; border: 2px solid #6EAFAF; border-radius: 4px;';

    const saveValue = () => {
      const newValue = input.value.trim();
      if (newValue.length > 0) cartItem.productName = newValue;
      updateCartDisplay();
      flashCustomerDisplayCartItem(cartItem.cartItemId);
    };

    placeInputAndFocus(cellEl, input);
    attachCommonInputHandlers(input, { onSave: saveValue, onCancel: updateCartDisplay });
  };

  const beginEditDiscount = (cellEl, cartItem) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('inputmode', 'decimal');
    input.inputMode = 'decimal';
    input.setAttribute('enterkeyhint', 'done');
    input.autocomplete = 'off';
    input.value = (cartItem.discountPercent || 0).toFixed(0);
    input.dataset.noVk = '1';
    input.style.cssText = 'width: 80px; text-align: center; font-size: 14px; padding: 4px; border: 2px solid #6EAFAF; border-radius: 4px;';

    const saveValue = () => {
      let valueStr = input.value.trim().replace(',', '.').replace('%', '');
      if (valueStr.startsWith('.')) valueStr = '0' + valueStr;
      const newValue = parseFloat(valueStr);
      if (!isNaN(newValue) && newValue >= 0 && newValue <= 100 && /^\d*\.?\d*$/.test(valueStr)) {
        cartItem.discountPercent = newValue;
      } else if (newValue > 100) {
        alert('Discount cannot be greater than 100%');
      }
      updateCartDisplay();
      flashCustomerDisplayCartItem(cartItem.cartItemId);
    };

    placeInputAndFocus(cellEl, input);
    attachCommonInputHandlers(input, { onSave: saveValue, onCancel: updateCartDisplay });
  };

  cartTableBody.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || target.tagName === 'INPUT') return;
    if (cartTableBody.querySelector('.cart-row-dragging')) return;

    const editableEl = target.closest?.('.editable-quantity, .editable-price, .editable-name, .editable-discount');
    if (!editableEl || !cartTableBody.contains(editableEl)) return;
    if (editableEl.querySelector('input')) return;

    const cartItemId = parseInt(editableEl.dataset.cartItemId, 10);
    if (!Number.isFinite(cartItemId)) return;
    const cartItem = cart.find(item => item.cartItemId === cartItemId);
    if (!cartItem) return;

    e.stopPropagation();

    // Type-first-then-tap-cell: if user typed a number on the numpad first, apply it directly
    const getPending  = setupCheckoutHandlers._getNumpadPending;
    const clearPending = setupCheckoutHandlers._clearNumpadPending;
    const pendingVal = getPending ? getPending() : '';

    if (pendingVal && (editableEl.classList.contains('editable-quantity') || editableEl.classList.contains('editable-price') || editableEl.classList.contains('editable-discount'))) {
      clearPending && clearPending();
      const numStr = pendingVal.replace(',', '.');
      const numVal = parseFloat(numStr);
      if (!isNaN(numVal)) {
        if (editableEl.classList.contains('editable-quantity')) {
          const isCountBased = !cartItem.isWeightBased;
          if (isCountBased) {
            const qty = Math.round(numVal);
            if (qty > 0) { cartItem.quantity = qty; cartItem.quantityGrams = null; recalcCartItemMoney(cartItem); }
          } else {
            if (numVal > 0) { cartItem.quantityGrams = kgToGrams(numVal); cartItem.quantity = gramsToKg(cartItem.quantityGrams); recalcCartItemMoney(cartItem); }
          }
        } else if (editableEl.classList.contains('editable-price')) {
          if (numVal >= 0) { cartItem.unitPriceCents = moneyToCents(numVal); cartItem.unitPrice = centsToMoney(cartItem.unitPriceCents); recalcCartItemMoney(cartItem); }
        } else if (editableEl.classList.contains('editable-discount')) {
          if (numVal >= 0 && numVal <= 100) { cartItem.discountPercent = numVal; recalcCartItemMoney(cartItem); }
        }
        updateCartDisplay();
        flashCustomerDisplayCartItem(cartItem.cartItemId);
      }
      return;
    }

    if (editableEl.classList.contains('editable-quantity')) beginEditQuantity(editableEl, cartItem);
    else if (editableEl.classList.contains('editable-price')) beginEditPrice(editableEl, cartItem);
    else if (editableEl.classList.contains('editable-name')) beginEditName(editableEl, cartItem);
    else if (editableEl.classList.contains('editable-discount')) beginEditDiscount(editableEl, cartItem);
  });
}

let cartDisplayRafPending = false;
let cachedCartTotals = null; // { totalBaseCents, totalTaxCents, totalDiscountCents, totalCents }
function updateCartDisplay() {
  if (cartDisplayRafPending) return;
  cartDisplayRafPending = true;
  requestAnimationFrame(() => {
    cartDisplayRafPending = false;
    updateCartDisplayNow();
  });
}

function updateCartDisplayNow() {
  const cartTableBody = document.getElementById('cartTableBody');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const ticketBtn = document.getElementById('ticketBtn');
  const paymentBtn = document.getElementById('paymentBtn');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  // Reset payment method selection and button highlighting
  selectedPaymentMethod = null;
  document.querySelectorAll('.numpad-btn').forEach(b => {
    if (['cash', 'card', 'loan'].includes(b.dataset.value)) {
      b.style.opacity = '0.8';
      b.style.transform = 'scale(1)';
    }
  });
  
  if (cart.length === 0) {
    debugLog('Cart is empty, showing empty message');
    cartTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: #a0aec0;">Cart is empty</td></tr>';
    checkoutBtn.disabled = true;

    cachedCartTotals = {
      totalBaseCents: 0,
      totalTaxCents: 0,
      totalDiscountCents: 0,
      totalCents: 0
    };

    // Ensure payment summary resets when the cart is cleared.
    const paymentInput = document.getElementById('paymentInput');
    if (paymentInput) paymentInput.value = '';

    // Disable TICKET and PAYMENT buttons when cart is empty
    if (ticketBtn) {
      ticketBtn.disabled = true;
      ticketBtn.style.opacity = '0.5';
      ticketBtn.style.cursor = 'not-allowed';
    }
    if (paymentBtn) {
      paymentBtn.disabled = true;
      paymentBtn.style.opacity = '0.5';
      paymentBtn.style.cursor = 'not-allowed';
    }

    // No cart = nothing to undo
    setLastScanUndoAction(null);
  } else {
    debugLog('Cart has items, rendering...');

    let totalBaseCents = 0;
    let totalTaxCents = 0;
    let totalDiscountCents = 0;
    let totalCents = 0;

    // Enable TICKET and PAYMENT buttons when cart has items
    if (ticketBtn) {
      ticketBtn.disabled = false;
      ticketBtn.style.opacity = '1';
      ticketBtn.style.cursor = 'pointer';
    }
    if (paymentBtn) {
      paymentBtn.disabled = false;
      paymentBtn.style.opacity = '1';
      paymentBtn.style.cursor = 'pointer';
    }
    cartTableBody.innerHTML = cart.map(item => {
      // Barcode-only mode: never show weight units in the cart.
      if (POS_DISABLE_SCALE_AND_WEIGHT) item.isWeightBased = false;
      recalcCartItemMoney(item);
      const originalProduct = getCachedProductById(item.productId);
      const qtyUnit = item.isWeightBased
        ? 'kg'
        : String(originalProduct?.quantity_unit || 'pc');
      const unit = item.isWeightBased ? 'kg' : qtyUnit;
      const unitLabel = item.isWeightBased ? '/kg' : `/${qtyUnit}`;
      const discountPercent = item.discountPercent || 0;
      const lineSubtotalCents = item.subtotalCents ?? moneyToCents(item.subtotal);
      const discountCents = calcDiscountCents(lineSubtotalCents, discountPercent);
      const finalTotalCents = lineSubtotalCents - discountCents;

      const taxRate = item.taxRate || 0;
      const baseCents = Math.round(finalTotalCents / (1 + taxRate));
      const lineTaxCents = finalTotalCents - baseCents;
      totalBaseCents += baseCents;
      totalTaxCents += lineTaxCents;
      totalDiscountCents += discountCents;
      totalCents += finalTotalCents;

      const qtyText = item.isWeightBased ? item.quantity.toFixed(3) : item.quantity.toFixed(2);
      // Display the cart item's current (possibly edited) unit price.
      // Fall back to product price only if the cart item doesn't have a unitPrice.
      const displayUnitPrice = Number.isFinite(Number(item.unitPrice))
        ? Number(item.unitPrice)
        : Number(originalProduct ? originalProduct.price : 0);
      return `
      <tr class="cart-row" data-cart-item-id="${item.cartItemId}">
        <td class="editable-name" data-cart-item-id="${item.cartItemId}" style="cursor: pointer; user-select: none;">${item.productName}</td>
        <td class="editable-price" data-cart-item-id="${item.cartItemId}" style="cursor: pointer; user-select: none;">${currencySymbol}${Number(displayUnitPrice).toFixed(2)}${unitLabel}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
            <span class="editable-quantity" data-cart-item-id="${item.cartItemId}" style="min-width: 50px; text-align: center; font-weight: 800; cursor: pointer; user-select: none;">${qtyText} ${unit}</span>
            <button onclick="removeFromCart(${item.cartItemId})" style="background: #fc8181; color: white; border: none; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 18px; font-weight: 800;">×</button>
          </div>
        </td>
        <td class="editable-discount" data-cart-item-id="${item.cartItemId}" style="cursor: pointer; user-select: none;">${discountPercent.toFixed(0)}%</td>
        <td style="font-weight: 800; color: #6E8FAF;">${currencySymbol}${centsToMoney(finalTotalCents).toFixed(2)}</td>
      </tr>
    `;
    }).join('');

    cachedCartTotals = {
      totalBaseCents,
      totalTaxCents,
      totalDiscountCents,
      totalCents
    };
    debugLog('Cart HTML updated');
    
    // Add click handlers for inline editing
    setupInlineCartEditing();

    // Enable touch drag-reorder for cart rows (two-finger hold)
    ensureCartRowReorderHandlers();
    
    checkoutBtn.disabled = true; // Disabled until payment method selected
  }
  
  updateCartSummary();

  // Show/hide the active PARKING customer/restaurant banner (if any)
  try {
    updateParkingContextBanner();
  } catch {
    // ignore
  }

  // Modern monitor customer display (15.6" HDMI/USB screen): update whenever cart changes.
  // This does NOT write to the serial VFD/pole display.
  pushMonitorCustomerDisplay();

  // Update undo button enabled state
  try { updateUndoScanButton(); } catch { /* ignore */ }
  try { updateDeleteAllButton(); } catch { /* ignore */ }
}

// ============== CART ROW REORDER (TOUCH DRAG) ==============
// Gesture: two-finger long-press (default 280ms) on a row, then drag up/down to reorder.
// This avoids interfering with normal single-finger taps for editing/removing.
const CART_REORDER_HOLD_MS = 280;
const CART_REORDER_MOVE_CANCEL_PX = 10;

let cartRowReorderState = {
  handlersAttached: false,
  pending: null, // { cartItemId, rowEl, startX, startY, startedAt, timerId }
  active: null // { cartItemId, rowEl, placeholderEl, offsetY, fixedLeft, fixedWidth, fixedHeight }
};

function getTouchesCentroid(touches) {
  if (!touches || touches.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < touches.length; i++) {
    sumX += touches[i].clientX;
    sumY += touches[i].clientY;
  }
  return { x: sumX / touches.length, y: sumY / touches.length };
}

function moveCartItemToIndex(cartItemId, toIndex) {
  const fromIndex = cart.findIndex(i => String(i?.cartItemId) === String(cartItemId));
  if (fromIndex < 0) return;
  const safeTo = Math.max(0, Math.min(toIndex, cart.length - 1));
  if (safeTo === fromIndex) return;
  const [moved] = cart.splice(fromIndex, 1);
  cart.splice(safeTo, 0, moved);
}

function ensureCartRowReorderHandlers() {
  if (cartRowReorderState.handlersAttached) return;
  const cartTableBody = document.getElementById('cartTableBody');
  if (!cartTableBody) return;

  cartRowReorderState.handlersAttached = true;

  const clearPending = () => {
    const p = cartRowReorderState.pending;
    if (p?.timerId) clearTimeout(p.timerId);
    cartRowReorderState.pending = null;
  };

  const cleanupActive = () => {
    const a = cartRowReorderState.active;
    if (!a) return;
    try {
      a.rowEl?.classList?.remove('cart-row-dragging');
      if (a.rowEl) {
        a.rowEl.style.position = '';
        a.rowEl.style.left = '';
        a.rowEl.style.top = '';
        a.rowEl.style.width = '';
        a.rowEl.style.zIndex = '';
        a.rowEl.style.pointerEvents = '';
        a.rowEl.style.boxShadow = '';
        a.rowEl.style.transform = '';
      }
      a.placeholderEl?.remove?.();
    } catch {
      // ignore
    }
    cartRowReorderState.active = null;
  };

  const computeDropIndexFromPlaceholder = (placeholderEl, draggingRowEl) => {
    if (!placeholderEl?.parentElement) return null;
    const children = Array.from(placeholderEl.parentElement.children);
    let index = 0;
    for (const child of children) {
      if (child === draggingRowEl) continue;
      if (child === placeholderEl) return index;
      if (child?.dataset?.cartItemId) index++;
    }
    return index;
  };

  const startDrag = (rowEl, cartItemId, startClientY) => {
    if (!rowEl || !rowEl.isConnected) return;
    if (cartRowReorderState.active) return;

    const rect = rowEl.getBoundingClientRect();
    const placeholderEl = document.createElement('tr');
    placeholderEl.className = 'cart-row-placeholder';
    placeholderEl.innerHTML = `<td colspan="5" style="height:${Math.max(10, Math.round(rect.height))}px;"></td>`;

    // Insert placeholder where the row was, then float the row
    rowEl.parentElement?.insertBefore(placeholderEl, rowEl.nextSibling);

    rowEl.classList.add('cart-row-dragging');
    rowEl.style.position = 'fixed';
    rowEl.style.left = `${Math.round(rect.left)}px`;
    rowEl.style.top = `${Math.round(rect.top)}px`;
    rowEl.style.width = `${Math.round(rect.width)}px`;
    rowEl.style.zIndex = '10020';
    rowEl.style.pointerEvents = 'none';
    rowEl.style.boxShadow = '0 18px 40px rgba(15, 23, 42, 0.25)';

    const offsetY = startClientY - rect.top;
    cartRowReorderState.active = {
      cartItemId,
      rowEl,
      placeholderEl,
      offsetY,
      fixedLeft: rect.left,
      fixedWidth: rect.width,
      fixedHeight: rect.height
    };
  };

  const onTouchStart = (e) => {
    try {
      if (!e.touches || e.touches.length !== 2) return;
      if (cartRowReorderState.active) return;

      const rowEl = e.target?.closest?.('tr[data-cart-item-id]');
      if (!rowEl) return;
      const cartItemId = rowEl.dataset.cartItemId;
      if (!cartItemId) return;

      const { x, y } = getTouchesCentroid(e.touches);
      clearPending();

      const timerId = setTimeout(() => {
        const p = cartRowReorderState.pending;
        if (!p) return;
        if (!p.rowEl?.isConnected) { clearPending(); return; }
        startDrag(p.rowEl, p.cartItemId, p.startY);
        clearPending();
      }, CART_REORDER_HOLD_MS);

      cartRowReorderState.pending = {
        cartItemId,
        rowEl,
        startX: x,
        startY: y,
        startedAt: Date.now(),
        timerId
      };
    } catch {
      // ignore
    }
  };

  const onTouchMove = (e) => {
    try {
      const a = cartRowReorderState.active;
      if (a) {
        // During active drag, prevent scrolling
        e.preventDefault();
        if (!e.touches || e.touches.length === 0) return;

        const { y } = getTouchesCentroid(e.touches);
        const nextTop = y - a.offsetY;
        a.rowEl.style.top = `${Math.round(nextTop)}px`;

        const tbody = document.getElementById('cartTableBody');
        if (!tbody) return;

        const otherRows = Array.from(tbody.querySelectorAll('tr[data-cart-item-id]:not(.cart-row-dragging)'));
        let inserted = false;
        for (const row of otherRows) {
          const r = row.getBoundingClientRect();
          const midY = r.top + r.height / 2;
          if (y < midY) {
            tbody.insertBefore(a.placeholderEl, row);
            inserted = true;
            break;
          }
        }
        if (!inserted) {
          tbody.appendChild(a.placeholderEl);
        }
        return;
      }

      const p = cartRowReorderState.pending;
      if (!p) return;
      if (!e.touches || e.touches.length !== 2) {
        clearPending();
        return;
      }
      const { x, y } = getTouchesCentroid(e.touches);
      const dx = x - p.startX;
      const dy = y - p.startY;
      if (Math.hypot(dx, dy) > CART_REORDER_MOVE_CANCEL_PX) {
        clearPending();
      }
    } catch {
      // ignore
    }
  };

  const onTouchEndOrCancel = (e) => {
    try {
      clearPending();
      const a = cartRowReorderState.active;
      if (!a) return;

      const dropIndex = computeDropIndexFromPlaceholder(a.placeholderEl, a.rowEl);
      cleanupActive();

      if (typeof dropIndex === 'number') {
        moveCartItemToIndex(a.cartItemId, dropIndex);
        updateCartDisplay();
      }
    } catch {
      cleanupActive();
    }
  };

  cartTableBody.addEventListener('touchstart', onTouchStart, { passive: true });
  cartTableBody.addEventListener('touchmove', onTouchMove, { passive: false });
  cartTableBody.addEventListener('touchend', onTouchEndOrCancel, { passive: true });
  cartTableBody.addEventListener('touchcancel', onTouchEndOrCancel, { passive: true });
}

function calculateTotal() {
  const subtotalBeforeDiscountCents = cart.reduce((sum, item) => {
    recalcCartItemMoney(item);
    return sum + (item.subtotalCents || 0);
  }, 0);
  const totalDiscountCents = cart.reduce((sum, item) => {
    const lineSubtotalCents = item.subtotalCents || 0;
    return sum + calcDiscountCents(lineSubtotalCents, item.discountPercent);
  }, 0);
  return centsToMoney(subtotalBeforeDiscountCents - totalDiscountCents);
}

function updateCartSummary() {
  // Update summary
  const currencySymbol = systemSettings?.currency_symbol || '€';

  let totalBaseCents;
  let totalTaxCents;
  let totalDiscountCents;
  let totalCents;

  if (cachedCartTotals &&
      Number.isFinite(cachedCartTotals.totalBaseCents) &&
      Number.isFinite(cachedCartTotals.totalTaxCents) &&
      Number.isFinite(cachedCartTotals.totalDiscountCents) &&
      Number.isFinite(cachedCartTotals.totalCents)) {
    ({ totalBaseCents, totalTaxCents, totalDiscountCents, totalCents } = cachedCartTotals);
  } else {
    // Fallback (should be rare): recompute from cart
    const subtotalBeforeDiscountCents = cart.reduce((sum, item) => {
      recalcCartItemMoney(item);
      return sum + (item.subtotalCents || 0);
    }, 0);

    totalDiscountCents = cart.reduce((sum, item) => {
      const lineSubtotalCents = item.subtotalCents || 0;
      return sum + calcDiscountCents(lineSubtotalCents, item.discountPercent);
    }, 0);

    totalCents = subtotalBeforeDiscountCents - totalDiscountCents;
    totalBaseCents = 0;
    totalTaxCents = 0;

    cart.forEach(item => {
      const taxRate = item.taxRate || 0;
      const discountPercent = item.discountPercent || 0;
      const lineSubtotalCents = item.subtotalCents || 0;
      const discountCents = calcDiscountCents(lineSubtotalCents, discountPercent);
      const itemFinalCents = lineSubtotalCents - discountCents;
      const baseCents = Math.round(itemFinalCents / (1 + taxRate));
      const taxCents = itemFinalCents - baseCents;
      totalBaseCents += baseCents;
      totalTaxCents += taxCents;
    });
  }

  // Do NOT update the physical customer display from here.
  // updateCartSummary() is triggered very frequently (e.g. typing paid amount),
  // and frequent serial writes cause buffering/flicker on the pole display.
  
  // Get payment amount from payment input field (ONLY when the payment modal is open)
  // Otherwise stale values can remain visible in the summary tiles.
  const paymentModal = document.getElementById('paymentModal');
  const isPaymentModalOpen = !!(paymentModal && paymentModal.classList.contains('active'));
  const paymentInput = document.getElementById('paymentInput');
  const paymentAmountText = (isPaymentModalOpen && paymentInput) ? paymentInput.value : '';
  const paymentParsed = paymentAmountText ? parseFloat(paymentAmountText) : NaN;
  const paymentCents = Number.isFinite(paymentParsed) ? moneyToCents(paymentParsed) : totalCents;
  const changeCents = Math.max(0, paymentCents - totalCents);

  document.getElementById('cartSubtotal').textContent = `${currencySymbol}${centsToMoney(totalBaseCents).toFixed(2)}`;
  document.getElementById('cartTax').textContent = `${currencySymbol}${centsToMoney(totalTaxCents).toFixed(2)}`;
  document.getElementById('cartDiscount').textContent = `${currencySymbol}${centsToMoney(totalDiscountCents).toFixed(2)}`;
  document.getElementById('cartTotal').textContent = `${currencySymbol}${centsToMoney(totalCents).toFixed(2)}`;
  document.getElementById('paymentAmount').textContent = `${currencySymbol}${centsToMoney(paymentCents).toFixed(2)}`;
  document.getElementById('changeAmount').textContent = `${currencySymbol}${centsToMoney(changeCents).toFixed(2)}`;
}

// Print ticket without payment (for quotation/estimation purposes)
async function printTicket() {
  if (cart.length === 0) {
    showAlert('Cart is empty. Add items before printing a ticket.', 'warning', 'Empty Cart');
    return;
  }

  // Load system settings if not loaded
  if (!systemSettings) {
    systemSettings = await window.api.getSystemSettings();
  }

  const currencySymbol = systemSettings?.currency_symbol || '€';
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
  const ownerName = systemSettings?.owner_name || '';
  const nieNumber = systemSettings?.nie_number || '';
  const companyAddress = systemSettings?.company_address || '';
  const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';

  const inferTicketLineWidth = (printer) => {
    const name = String(printer || '').toLowerCase();
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
      || name.includes('tm-t20')
      || name.includes('tm t20')
      || name.includes('tm-t88')
      || name.includes('tm t88');
    return looks80mm ? 48 : 32;
  };

  const LINE_WIDTH = inferTicketLineWidth(systemSettings?.printer_name);

  // Calculate totals from cart (apply discountPercent if present)
  let subtotalCents = 0;
  let taxCents = 0;
  let totalCents = 0;

  const taxBreakdown = {};

  cart.forEach(item => {
    const taxRate = item.taxRate || 0;
    const discountPercent = item.discountPercent || 0;
    recalcCartItemMoney(item);
    const lineSubtotalCents = item.subtotalCents || 0;
    const discountCents = calcDiscountCents(lineSubtotalCents, discountPercent);
    const finalCents = lineSubtotalCents - discountCents;

    const baseCents = Math.round(finalCents / (1 + taxRate));
    const lineTaxCents = finalCents - baseCents;

    subtotalCents += baseCents;
    taxCents += lineTaxCents;
    totalCents += finalCents;

    // Track tax breakdown
    const taxRatePercent = Math.round(taxRate * 100);
    if (!taxBreakdown[taxRatePercent]) {
      taxBreakdown[taxRatePercent] = {
        baseCents: 0,
        taxCents: 0,
        totalCents: 0
      };
    }
    taxBreakdown[taxRatePercent].baseCents += baseCents;
    taxBreakdown[taxRatePercent].taxCents += lineTaxCents;
    taxBreakdown[taxRatePercent].totalCents += finalCents;
  });

  // Generate tax breakdown HTML
  const taxBreakdownHtml = Object.keys(taxBreakdown).sort().map(rate => `
    <div class="receipt-item" style="font-size: 12px; padding: 2px 0;">
      <span>IVA ${rate}%</span>
      <span>Base: ${currencySymbol}${centsToMoney(taxBreakdown[rate].baseCents).toFixed(2)}</span>
      <span>Cuota: ${currencySymbol}${centsToMoney(taxBreakdown[rate].taxCents).toFixed(2)}</span>
      <span>Total: ${currencySymbol}${centsToMoney(taxBreakdown[rate].totalCents).toFixed(2)}</span>
    </div>
  `).join('');

  // Create ticket data for thermal printer
  const taxBreakdownRows = Object.keys(taxBreakdown)
    .map(r => parseInt(r, 10))
    .filter(r => Number.isFinite(r))
    .sort((a, b) => a - b)
    .map(rate => ({
      rate,
      base: centsToMoney(taxBreakdown[rate].baseCents),
      tax: centsToMoney(taxBreakdown[rate].taxCents),
      total: centsToMoney(taxBreakdown[rate].totalCents)
    }));

  // Generate a unique ticket/receipt number
  const now = new Date();
  const dateStr = formatDateWithDisplayTimeZone(now, 'es-ES');
  const timeStr = formatTimeWithDisplayTimeZone(now, 'es-ES');
  const receiptNumber = `T101_1/${String(now.getFullYear()).slice(-2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;

  const ticketData = {
    isTicket: true,
    storeName,
    ownerName,
    nieNumber,
    companyAddress,
    lineWidth: LINE_WIDTH === 48 ? 48 : undefined,
    receiptId: receiptNumber,
    date: `${dateStr} ${timeStr}`,
    items: cart.map(item => {
      recalcCartItemMoney(item);
      const discountPercent = item.discountPercent || 0;
      const lineSubtotalCents = item.subtotalCents || 0;
      const discountCents = calcDiscountCents(lineSubtotalCents, discountPercent);
      const finalSubtotal = centsToMoney(lineSubtotalCents - discountCents);
      return {
        name: item.productName || item.name || 'PRODUCTO',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: finalSubtotal,
        discountPercent
      };
    }),
    subtotal: centsToMoney(subtotalCents),
    tax: centsToMoney(taxCents),
    total: centsToMoney(totalCents),
    taxBreakdown: taxBreakdownRows,
    paymentMethod: 'cash',
    paymentAmount: centsToMoney(totalCents),
    changeAmount: 0,
    currency: currencySymbol,
    footer: receiptFooter,
    cashier: currentUser?.full_name || ''
  };

  try {
    console.log('Printing ticket to thermal printer...');
    const result = await window.api.printReceipt(ticketData);
    
    if (result.success) {
      showAlert('Ticket printed successfully!', 'success', 'Ticket Printed');
    } else {
      console.error('Thermal print error:', result.error);
      showAlert('Failed to print ticket: ' + result.error, 'error', 'Print Error');
    }
  } catch (error) {
    console.error('Error printing ticket:', error);
    showAlert('Error printing ticket: ' + error.message, 'error', 'Print Error');
  }
}

async function completeSale() {
  if (cart.length === 0) return;
  
  // Validate payment based on mode
  if (paymentMode === 'single') {
    if (!selectedPaymentMethod) {
      alert('Please select a payment method: CASH, CARD, or PARKING');
      return;
    }
  }
  
  // Load system settings if not loaded
  if (!systemSettings) {
    systemSettings = await window.api.getSystemSettings();
  }
  
  // Product prices already include tax - extract tax from total
  const subtotalBeforeDiscountCents = cart.reduce((sum, item) => {
    recalcCartItemMoney(item);
    return sum + (item.subtotalCents || 0);
  }, 0);
  
  // Calculate total discount from percentage-based discounts
  const totalDiscountCents = cart.reduce((sum, item) => {
    const lineSubtotalCents = item.subtotalCents || 0;
    return sum + calcDiscountCents(lineSubtotalCents, item.discountPercent);
  }, 0);
  
  const totalCents = subtotalBeforeDiscountCents - totalDiscountCents;
  const total = centsToMoney(totalCents);
  
  // Calculate base price (before tax) and tax amount
  let subtotalCents = 0;
  let taxCents = 0;
  
  cart.forEach(item => {
    const taxRate = item.taxRate || 0;
    const discountPercent = item.discountPercent || 0;
    const lineSubtotalCents = item.subtotalCents || 0;
    const discountCents = calcDiscountCents(lineSubtotalCents, discountPercent);
    const finalCents = lineSubtotalCents - discountCents;
    const baseCents = Math.round(finalCents / (1 + taxRate));
    const lineTaxCents = finalCents - baseCents;
    subtotalCents += baseCents;
    taxCents += lineTaxCents;
  });
  
  const subtotal = centsToMoney(subtotalCents);
  const tax = centsToMoney(taxCents);
  const discount = centsToMoney(totalDiscountCents);
  
  // Determine payment method and amounts
  let paymentMethod = selectedPaymentMethod;
  let paymentAmount = total;
  let changeAmount = 0;
  let splitPayments = null;
  
  if (paymentMode === 'split') {
    // Get split payment amounts
    const splitCashAmount = document.getElementById('splitCashAmount');
    const splitCardAmount = document.getElementById('splitCardAmount');
    
    const cashAmount = parseFloat(splitCashAmount.value) || 0;
    const cardAmount = parseFloat(splitCardAmount.value) || 0;
    const cashCents = moneyToCents(cashAmount);
    const cardCents = moneyToCents(cardAmount);
    
    if (cashCents === 0 && cardCents === 0) {
      alert('Please enter payment amounts');
      return;
    }
    
    const totalPaidCents = cashCents + cardCents;
    if (totalPaidCents !== totalCents) {
      alert('Payment amounts must equal the total');
      return;
    }
    
    // Store split payment details
    splitPayments = {
      cash: centsToMoney(cashCents),
      card: centsToMoney(cardCents)
    };
    
    // Set payment method as 'split' for database
    paymentMethod = 'split';
    paymentAmount = centsToMoney(totalPaidCents);
    changeAmount = 0; // No change in split payments
  } else {
    // Single payment mode
    // Calculate payment amount and change
    const paymentInput = document.getElementById('paymentInput');
    const paymentAmountText = paymentInput ? paymentInput.value : '';
    const parsed = paymentAmountText ? parseFloat(paymentAmountText) : NaN;
    const paymentCents = Number.isFinite(parsed) ? moneyToCents(parsed) : totalCents;
    const changeCents = paymentMethod === 'cash' ? Math.max(0, paymentCents - totalCents) : 0;
    paymentAmount = centsToMoney(paymentCents);
    changeAmount = centsToMoney(changeCents);
  }

  // If this is the "Pay" flow (existing PARKING -> Checkout), allow selecting PARKING to
  // append ONLY newly scanned items into the same PARKING (no duplicates).
  let parkingPaymentInfo = sessionStorage.getItem('parkingPayment');
  // If a stale PARKING payment session is left over, it can break the next normal sale.
  // Only treat this as an active PARKING session if the cart contains loan-linked items.
  if (parkingPaymentInfo) {
    const cartHasLoanItems = (Array.isArray(cart) ? cart : []).some(i =>
      Number.isFinite(Number(i?.saleItemId)) ||
      Number.isFinite(Number(i?.loanId)) ||
      String(i?.productId || '') === 'parking_payment'
    );
    if (!cartHasLoanItems) {
      try { sessionStorage.removeItem('parkingPayment'); } catch { /* ignore */ }
      parkingPaymentInfo = null;
    }
  }
  if (parkingPaymentInfo && paymentMethod === 'loan') {
    try {
      const ctx = JSON.parse(parkingPaymentInfo);
      const receiptNumber = String(ctx?.receiptNumber || '').trim();
      if (!receiptNumber) throw new Error('Missing PARKING receipt number');

      const loan = await window.api.getLoanByReceipt(receiptNumber);
      if (!loan) throw new Error('PARKING not found');
      if ((loan.status || '').toString().toLowerCase() === 'paid') {
        throw new Error('This PARKING is already paid');
      }

      const newItems = (Array.isArray(cart) ? cart : []).filter(i => !Number.isFinite(Number(i?.saleItemId)));
      if (newItems.length === 0) {
        // No new scanned items. Still allow using PARKING as a "Done" action
        // after removals/edits: exit the Pay->Checkout session and return to an empty cart.
        cart = [];
        updateCartDisplay();
        sessionStorage.removeItem('parkingPayment');
        closePaymentModalFunc();
        showAlert('PARKING updated', 'success');
        return;
      }

      // Compute totals for only the new items (prices include tax).
      let subtotalCentsNew = 0;
      let taxCentsNew = 0;
      let discountCentsNew = 0;
      let totalCentsNew = 0;

      for (const item of newItems) {
        try { recalcCartItemMoney(item); } catch { /* ignore */ }
        const lineSubtotalCents = moneyToCents(Number(item.subtotal || 0));
        const discountPercent = Number(item.discountPercent || 0);
        const lineDiscountCents = Math.round(lineSubtotalCents * (discountPercent / 100));
        const finalCents = lineSubtotalCents - lineDiscountCents;
        const taxRate = Number(item.taxRate || 0);
        const baseCents = Math.round(finalCents / (1 + taxRate));
        const lineTaxCents = finalCents - baseCents;
        subtotalCentsNew += baseCents;
        taxCentsNew += lineTaxCents;
        discountCentsNew += lineDiscountCents;
        totalCentsNew += finalCents;
      }

      await window.api.createLoan({
        receiptNumber: String(Date.now()),
        customerType: loan.customer_type || 'restaurant',
        customerName: loan.customer_name || null,
        customerPhone: loan.customer_phone || null,
        restaurantName: loan.restaurant_name || null,
        restaurantNie: loan.restaurant_nie || null,
        cashierId: currentUser.id,
        notes: null,
        mergeMode: 'append',
        targetLoanId: loan.id,
        sale: {
          subtotal: centsToMoney(subtotalCentsNew),
          tax: centsToMoney(taxCentsNew),
          discount: centsToMoney(discountCentsNew),
          total: centsToMoney(totalCentsNew),
          paymentMethod: 'loan',
          paymentAmount: 0,
          changeAmount: 0,
          cashierId: currentUser.id,
          notes: null
        },
        items: newItems
      });

      const refreshed = await window.api.getLoanByReceipt(receiptNumber);
      if (refreshed && refreshed.sale && Array.isArray(refreshed.sale.items)) {
        cart = refreshed.sale.items.map(item => ({
          productId: item.product_id || `parking_item_${Date.now()}_${Math.random()}`,
          productName: item.product_name || 'Parking Item',
          saleItemId: item.id,
          loanId: refreshed.id,
          unitPrice: item.unit_price || item.price || (item.subtotal / item.quantity),
          taxRate: item.tax_rate || 0,
          quantity: item.quantity || 1,
          subtotal: item.subtotal || item.price || 0,
          isWeightBased: POS_DISABLE_SCALE_AND_WEIGHT ? false : (item.unit_type === 'weight'),
          cartItemId: Date.now() + Math.random(),
          discountPercent: item.discount_percent || 0
        }));
      }

      sessionStorage.setItem('parkingPayment', JSON.stringify({
        receiptNumber,
        amount: Number(refreshed?.remaining_amount || 0),
        timestamp: Date.now()
      }));

      // Option B: after saving to PARKING, return to an empty checkout cart.
      cart = [];
      updateCartDisplay();
      sessionStorage.removeItem('parkingPayment');
      closePaymentModalFunc();
      showAlert('Added new items to existing PARKING', 'success');
      return;
    } catch (error) {
      showAlert('Failed to add items to PARKING: ' + (error?.message || error), 'error');
      return;
    }
  }
  
  // If loan is selected, open loan customer info modal
  if (paymentMethod === 'loan') {
    // Close payment modal first
    closePaymentModalFunc();
    openLoanModal(total, subtotal, tax);
    return;
  }
  
  // Check if this is a parking payment
  if (parkingPaymentInfo) {
    console.log('Found parking payment info:', parkingPaymentInfo);
    console.log('Current cart:', cart);
    try {
      const paymentData = JSON.parse(parkingPaymentInfo);

      // If the cashier scanned extra items while paying a PARKING tab, those items
      // must be appended to the underlying loan sale BEFORE we settle the payment.
      // Otherwise the newly added products won't be part of the final PARKING bill.
      {
        const receiptNumber = String(paymentData?.receiptNumber || '').trim();
        const newItems = (Array.isArray(cart) ? cart : []).filter(i => {
          if (!i) return false;
          if (String(i.productId || '') === 'parking_payment') return false;
          return !Number.isFinite(Number(i.saleItemId));
        });

        if (receiptNumber && newItems.length > 0) {
          let loan = null;
          try {
            loan = await window.api.getLoanByReceipt(receiptNumber);
          } catch {
            loan = null;
          }

          const loanStatus = (loan?.status || '').toString().toLowerCase();
          if (!loan || loanStatus === 'paid') {
            showAlert('Cannot add new items: PARKING tab not available', 'error', 'PARKING');
            return;
          }

          try {
            let subtotalCentsNew = 0;
            let taxCentsNew = 0;
            let discountCentsNew = 0;
            let totalCentsNew = 0;

            for (const item of newItems) {
              try { recalcCartItemMoney(item); } catch { /* ignore */ }
              const lineSubtotalCents = Number.isFinite(Number(item?.subtotalCents))
                ? Number(item.subtotalCents)
                : moneyToCents(Number(item?.subtotal || 0));
              const discountPercent = Number(item?.discountPercent || 0);
              const lineDiscountCents = Math.round(lineSubtotalCents * (discountPercent / 100));
              const finalCents = lineSubtotalCents - lineDiscountCents;
              const taxRate = Number(item?.taxRate || 0);
              const baseCents = Math.round(finalCents / (1 + taxRate));
              const lineTaxCents = finalCents - baseCents;
              subtotalCentsNew += baseCents;
              taxCentsNew += lineTaxCents;
              discountCentsNew += lineDiscountCents;
              totalCentsNew += finalCents;
            }

            await window.api.createLoan({
              receiptNumber: String(Date.now()),
              customerType: loan.customer_type || 'regular',
              customerName: loan.customer_name || null,
              customerPhone: loan.customer_phone || null,
              restaurantName: loan.restaurant_name || null,
              restaurantNie: loan.restaurant_nie || null,
              cashierId: currentUser.id,
              notes: null,
              mergeMode: 'append',
              targetLoanId: loan.id,
              sale: {
                subtotal: centsToMoney(subtotalCentsNew),
                tax: centsToMoney(taxCentsNew),
                discount: centsToMoney(discountCentsNew),
                total: centsToMoney(totalCentsNew),
                paymentMethod: 'loan',
                paymentAmount: 0,
                changeAmount: 0,
                cashierId: currentUser.id,
                notes: null
              },
              items: newItems
            });

            const refreshed = await window.api.getLoanByReceipt(receiptNumber);
            paymentData.amount = Number(refreshed?.remaining_amount || 0);
          } catch (e) {
            showAlert('Failed to add new items to PARKING: ' + (e?.message || e), 'error', 'PARKING');
            return;
          }
        }
      }

      // If the PARKING is already paid, clear the session and continue as a normal sale.
      try {
        const loan = await window.api.getLoanByReceipt(paymentData.receiptNumber);
        const status = (loan?.status || '').toString().toLowerCase();
        if (status === 'paid') {
          sessionStorage.removeItem('parkingPayment');
          parkingPaymentInfo = null;
          showAlert('This PARKING has already been paid in full. Starting a new sale.', 'info');
        }
      } catch {
        // ignore
      }

      if (!parkingPaymentInfo) {
        // Proceed with normal sale
      } else {
      
      // Process parking payment (include cash tendered + change for receipt)
      let payAmount = Number(paymentData.amount);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        try {
          const loanNow = await window.api.getLoanByReceipt(paymentData.receiptNumber);
          payAmount = Number(loanNow?.remaining_amount || 0);
        } catch {
          payAmount = 0;
        }
      }
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        showAlert('Invalid PARKING amount to pay', 'error', 'PARKING');
        return;
      }

      await completeLoanPaymentFromCheckout(paymentData.receiptNumber, payAmount, paymentMethod, {
        paymentAmount,
        changeAmount
      });
      
      // Clear parking payment data
      sessionStorage.removeItem('parkingPayment');
      
      // Close payment modal
      closePaymentModalFunc();
      
      // Clear cart
      cart = [];
      updateCartDisplay();
      
      // Navigate back to parking view and show only pending transactions
      setTimeout(() => {
        // Update active nav button
        const navBtns = document.querySelectorAll('.tab-btn');
        navBtns.forEach(b => b.classList.remove('active'));
        const targetBtn = document.querySelector('[data-view="loans"]');
        if (targetBtn) {
          targetBtn.classList.add('active');
        }
        
        // Show loans view
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('loansView').classList.add('active');
        
        // Toggle navbar visibility
        toggleNavbarForView('loans');
        
        // Switch to "All PARKING" tab to show clean active transactions (no paid)
        document.querySelectorAll('.loan-filter-tab').forEach(t => t.classList.remove('active'));
        const allTab = document.querySelector('[data-status="all"]');
        if (allTab) {
          allTab.classList.add('active');
        }
        
        // Load only active loans (pending + partial, excluding paid)
        setTimeout(() => {
          loadLoansView('active');
        }, 500);
      }, 1000);
      
      return;
      }
    } catch (error) {
      console.error('Error processing parking payment:', error);
      showAlert('Error processing parking payment: ' + error.message, 'error');
      return;
    }
  }
  
  const saleData = {
    subtotal,
    tax,
    discount,
    total,
    paymentMethod,
    paymentAmount,
    changeAmount,
    cashierId: currentUser.id,
    items: cart,
    splitPayments: splitPayments, // Include split payment details
    notes: currentInvoiceNote || null // Include invoice note
  };

  let sale = null;
  try {
    // Show payment processing on customer display (non-critical)
    try {
      updateCustomerDisplayPayment(paymentMethod.toUpperCase());
    } catch (e) {
      console.warn('Customer display payment update failed:', e);
    }

    // Open drawer only on COMPLETE SALE (not on payment method selection).
    // Open for CASH and SPLIT that includes a cash component.
    const splitCash = Number(splitPayments?.cash || 0) || 0;
    const shouldOpenDrawer = (paymentMethod === 'cash') || (paymentMethod === 'split' && splitCash > 0);

    if (shouldOpenDrawer && !cashDrawerOpenedInPaymentFlow) {
      cashDrawerOpenedInPaymentFlow = true;
      openCashDrawer().catch(e => console.warn('Cash drawer open failed:', e));
    }

    // This is the critical step. If this fails, we should NOT clear the cart.
    sale = await window.api.createSale(saleData);
  } catch (error) {
    alert('Error completing sale: ' + (error?.message || error));
    return;
  }

  // From here on, the sale is created. Always clear cart/UI even if hardware/display fails.
  lastSalePaymentMethod = paymentMethod;
  // End of payment flow
  cashDrawerOpenedInPaymentFlow = false;

  // Close payment modal (non-critical)
  try {
    closePaymentModalFunc();
  } catch {
    // ignore
  }

  // Show receipt (non-critical)
  try {
    showReceipt(sale);
  } catch (e) {
    console.warn('Failed to show receipt modal:', e);
  }

  // Cash drawer open is triggered above in parallel with DB work.

  // Customer display summary updates (non-critical)
  try {
    if (paymentMethod === 'cash') {
      // Show Total / Paid / Change in the cart section after receipt closes,
      // but only when cash actually returns change.
      try {
        if (Number(changeAmount) > 0) {
          const currencySymbol = systemSettings?.currency_symbol || '€';
          queueCashierPaymentSummaryOverlay({
            total,
            paid: paymentAmount,
            change: changeAmount,
            currencySymbol,
            autoHideMs: 60000
          });

          const receiptModal = document.getElementById('receiptModal');
          const receiptOpen = !!(receiptModal && receiptModal.classList.contains('active'));
          if (!receiptOpen) {
            showCashierPaymentSummaryOverlay(pendingCashierPaySummary);
            pendingCashierPaySummary = null;
          }
        }
      } catch {
        // ignore
      }

      await updateCustomerDisplayPaymentSummary(total, paymentAmount, changeAmount);
      // Do not show 'Thank You' after payment summary; keep summary on display
    } else if (changeAmount > 0) {
      const currencySymbol = systemSettings?.currency_symbol || '€';
      await updateCustomerDisplayChange(changeAmount, currencySymbol);
      setTimeout(() => {
        try {
          updateCustomerDisplayThankYou(changeAmount);
        } catch {
          // ignore
        }
      }, 3000);
    } else {
      updateCustomerDisplayThankYou(changeAmount);
    }
  } catch (e) {
    console.warn('Customer display post-payment update failed:', e);
  }

  // Clear cart and related UI state
  cart = [];
  currentInvoiceNote = '';

  const paymentInput = document.getElementById('paymentInput');
  if (paymentInput) paymentInput.value = '';

  selectedPaymentMethod = null;
  paymentMode = 'single';
  document.querySelectorAll('.numpad-btn').forEach(b => {
    if (['cash', 'card', 'loan'].includes(b.dataset.value)) {
      b.style.opacity = '0.8';
      b.style.transform = 'scale(1)';
    }
  });

  updateCartDisplay();

  // Reload products to update stock (non-critical)
  try {
    await loadAllProducts();
    displayQuickProducts();
  } catch (e) {
    console.warn('Reload products after sale failed:', e);
  }
}

function showReceipt(sale) {
  const modal = document.getElementById('receiptModal');
  const content = document.getElementById('receiptContent');
  
  const date = parseAppDateTimeLoose(sale.sale_date);
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
  const ownerName = systemSettings?.owner_name || '';
  const nieNumber = systemSettings?.nie_number || '';
  const companyAddress = systemSettings?.company_address || '';
  const currencySymbol = systemSettings?.currency_symbol || '€';
  const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';

  const resolveSaleItemTaxRate = (item) => {
    let taxRate = Number(item?.tax_rate ?? item?.taxRate);
    if (Number.isFinite(taxRate) && taxRate >= 0) return taxRate;

    const product = getCachedProductById(item?.product_id ?? item?.productId);
    const productTaxRate = Number(product?.tax_rate);
    if (Number.isFinite(productTaxRate) && productTaxRate >= 0) return productTaxRate;

    const category = product ? getCachedCategoryByName(product.category) : null;
    const categoryTaxRate = Number(category?.tax_rate);
    return Number.isFinite(categoryTaxRate) && categoryTaxRate >= 0 ? categoryTaxRate : 0;
  };
  
  // Calculate tax breakdown by rate
  const taxBreakdown = {};
  sale.items.forEach(item => {
    const subtotal = Number(item?.subtotal || 0);
    if (!Number.isFinite(subtotal) || subtotal <= 0) return;

    const taxRate = resolveSaleItemTaxRate(item);
    const taxRatePercent = Math.round(taxRate * 100);
    const basePrice = subtotal / (1 + taxRate);
    const taxAmount = subtotal - basePrice;

    if (!taxBreakdown[taxRatePercent]) {
      taxBreakdown[taxRatePercent] = {
        base: 0,
        tax: 0,
        total: 0
      };
    }

    taxBreakdown[taxRatePercent].base += basePrice;
    taxBreakdown[taxRatePercent].tax += taxAmount;
    taxBreakdown[taxRatePercent].total += subtotal;
  });
  
  // Generate tax breakdown HTML
  const taxBreakdownHtml = Object.keys(taxBreakdown).sort().map(rate => `
    <div class="receipt-item" style="font-size: 12px; padding: 2px 0;">
      <span>IVA ${rate}%</span>
      <span>Base: ${currencySymbol}${taxBreakdown[rate].base.toFixed(2)}</span>
      <span>Cuota: ${currencySymbol}${taxBreakdown[rate].tax.toFixed(2)}</span>
      <span>Total: ${currencySymbol}${taxBreakdown[rate].total.toFixed(2)}</span>
    </div>
  `).join('');
  
  content.innerHTML = `
    <div class="receipt-header">
      <h2>${storeName}</h2>
      ${ownerName ? `<p>${ownerName}</p>` : ''}
      ${nieNumber ? `<p>${nieNumber}</p>` : ''}
      ${companyAddress ? `<p style="white-space: pre-line;">${companyAddress}</p>` : ''}
      <h3 style="margin-top: 10px;">FACTURA SIMPLIFICADA</h3>
      <p>Receipt #${sale.id}</p>
      <p>${formatDateTimeWithDisplayTimeZone(date, 'en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })}</p>
    </div>
    
    <div class="receipt-items">
      ${sale.items.map(item => `
        <div class="receipt-item">
          <span>${item.product_name} x${item.quantity}</span>
          <span>${currencySymbol}${item.subtotal.toFixed(2)}</span>
        </div>
      `).join('')}
    </div>
    
    <div class="receipt-summary">
      <div class="receipt-item" style="border-top: 1px dashed #ccc; padding-top: 8px; margin-top: 8px;">
        <span>Subtotal (Base):</span>
        <span>${currencySymbol}${sale.subtotal.toFixed(2)}</span>
      </div>
      ${taxBreakdownHtml}
      <div class="receipt-item" style="border-top: 1px dashed #ccc; padding-top: 8px; margin-top: 8px;">
        <span>Total Tax:</span>
        <span>${currencySymbol}${sale.tax.toFixed(2)}</span>
      </div>
      <div class="receipt-item" style="font-weight: bold; font-size: 16px;">
        <span>TOTAL:</span>
        <span>${currencySymbol}${sale.total.toFixed(2)}</span>
      </div>
      ${sale.payment_method === 'split' && sale.split_payments ? `
        <div class="receipt-item" style="border-top: 1px solid #000; padding-top: 8px; margin-top: 8px;">
          <span>Payment Method:</span>
          <span>SPLIT</span>
        </div>
        ${sale.split_payments.cash > 0 ? `
          <div class="receipt-item">
            <span>💵 Cash:</span>
            <span>${currencySymbol}${sale.split_payments.cash.toFixed(2)}</span>
          </div>
        ` : ''}
        ${sale.split_payments.card > 0 ? `
          <div class="receipt-item">
            <span>💳 Card:</span>
            <span>${currencySymbol}${sale.split_payments.card.toFixed(2)}</span>
          </div>
        ` : ''}
      ` : `
        <div class="receipt-item">
          <span>Payment Method:</span>
          <span>${sale.payment_method.toUpperCase()}</span>
        </div>
        ${sale.payment_method === 'cash' && sale.payment_amount ? `
          <div class="receipt-item">
            <span>Payment:</span>
            <span>${currencySymbol}${(sale.payment_amount || 0).toFixed(2)}</span>
          </div>
          <div class="receipt-item" style="font-weight: bold;">
            <span>Change:</span>
            <span>${currencySymbol}${(sale.change_amount || 0).toFixed(2)}</span>
          </div>
        ` : ''}
      `}
    </div>
    
    ${sale.notes ? `
      <div class="receipt-note" style="border-top: 2px dashed #ccc; padding-top: 12px; margin-top: 12px;">
        <div style="font-weight: bold; font-size: 14px; margin-bottom: 5px;">NOTE:</div>
        <div style="font-size: 13px; white-space: pre-wrap;">${sale.notes}</div>
      </div>
    ` : ''}
    
    <div class="receipt-footer">
      <p>${receiptFooter}</p>
      <p>Cashier: ${currentUser.full_name}</p>
    </div>
  `;
  
  modal.classList.add('active');
  
  // Store sale for manual reprint
  lastSale = sale;
}

// ============== LOAN FUNCTIONS ==============
function openLoanModal(total, subtotal, tax) {
  const modal = document.getElementById('loanModal');
  modal.classList.add('active');
  
  // Store the sale details for later use
  modal.dataset.total = total;
  modal.dataset.subtotal = subtotal;
  modal.dataset.tax = tax;

  // Ensure restaurant-only fields (including Parking Mode) are shown/hidden
  // based on the current selection, even if the user previously selected it.
  setTimeout(() => {
    const typeSelect = document.getElementById('loanCustomerType');
    if (typeSelect) {
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, 0);
}

// ============== NOTE FUNCTIONS ==============
function openNoteModal() {
  const modal = document.getElementById('noteModal');
  const noteInput = document.getElementById('invoiceNote');
  
  // Load current note if exists
  if (noteInput) {
    noteInput.value = currentInvoiceNote || '';
  }
  
  modal.classList.add('active');
  
  // Focus on textarea
  setTimeout(() => {
    if (noteInput) noteInput.focus();
  }, 100);
}

async function completeLoanSale(customerType, customerName, customerPhone, restaurantName, restaurantNie, notes, parkingMode = 'append', targetLoanId = null) {
  const modal = document.getElementById('loanModal');
  const total = parseFloat(modal.dataset.total);
  const subtotal = parseFloat(modal.dataset.subtotal);
  const tax = parseFloat(modal.dataset.tax);

  const parkingModeNormalized = (parkingMode || document.querySelector('input[name="loanParkingMode"]:checked')?.value || 'append')
    .toString()
    .toLowerCase();
  
  // Generate unique receipt number
  const receiptNumber = generateReceiptNumber();
  
  // Calculate total discount from percentage-based discounts
  const totalDiscountAmount = cart.reduce((sum, item) => {
    const discountPercent = item.discountPercent || 0;
    const discountAmount = item.subtotal * (discountPercent / 100);
    return sum + discountAmount;
  }, 0);
  
  // Create the sale first
  const saleData = {
    subtotal,
    tax,
    discount: totalDiscountAmount,
    total,
    paymentMethod: 'loan',
    paymentAmount: 0,
    changeAmount: 0,
    cashierId: currentUser.id,
    notes: null
  };
  
  try {
    // Create or append to an existing restaurant parking tab in the backend.
    // (If a matching active restaurant loan exists, the backend will merge items into it.)
    const loanData = {
      receiptNumber,
      customerType,
      customerName,
      customerPhone: customerPhone || null,
      restaurantName: restaurantName || null,
      restaurantNie: restaurantNie || null,
      cashierId: currentUser.id,
      notes: notes || null,
      mergeMode: parkingModeNormalized,
      targetLoanId: Number.isFinite(targetLoanId) ? targetLoanId : null,
      sale: saleData,
      items: cart
    };

    const loan = await window.api.createLoan(loanData);

    if (loan?.merged) {
      showAlert(`Added to existing PARKING for ${restaurantName || customerName}`, 'success');
    } else {
      showAlert('PARKING created successfully', 'success');
    }
    
    // Show loan receipt - DISABLED to prevent automatic printing for parking
    // showLoanReceipt(sale, loan);
    
    // Clear cart
    cart = [];

    // Reset any leftover payment inputs so the summary doesn't keep showing
    // a previous amount (e.g., after creating PARKING, total becomes 0 but
    // payment input might still display the last value).
    const paymentInput = document.getElementById('paymentInput');
    if (paymentInput) paymentInput.value = '';
    const cashPaidInput = document.getElementById('cashPaidInput');
    if (cashPaidInput) cashPaidInput.value = '';
    const splitCashAmount = document.getElementById('splitCashAmount');
    if (splitCashAmount) splitCashAmount.value = '';
    const splitCardAmount = document.getElementById('splitCardAmount');
    if (splitCardAmount) splitCardAmount.value = '';
    selectedPaymentMethod = null;
    paymentMode = 'single';

    updateCartDisplay();
    
    // Close loan modal
    modal.classList.remove('active');
    
    // Reload products
    await loadAllProducts();
    displayQuickProducts();
  } catch (error) {
    showAlert('Error creating Parking order: ' + error.message, 'error');
  }
}

function generateReceiptNumber() {
  // Generate a unique receipt number: timestamp + random
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${timestamp}${random}`;
}

function showLoanReceipt(sale, loan) {
  const modal = document.getElementById('receiptModal');
  const content = document.getElementById('receiptContent');
  
  const date = parseAppDateTimeLoose(sale.sale_date);
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
  const ownerName = systemSettings?.owner_name || '';
  const nieNumber = systemSettings?.nie_number || '';
  const companyAddress = systemSettings?.company_address || '';
  const currencySymbol = systemSettings?.currency_symbol || '€';
  const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';
  const taxRate = (systemSettings?.tax_rate || 0.10) * 100;
  
  const customerType = loan.customer_type === 'restaurant' ? 'Restaurant' : 'Regular Customer';
  const restaurantInfo = loan.customer_type === 'restaurant' ? `
    <p><strong>Restaurant:</strong> ${loan.restaurant_name || 'N/A'}</p>
    ${loan.restaurant_nie ? `<p><strong>NIE Number:</strong> ${loan.restaurant_nie}</p>` : ''}
  ` : '';
  
  content.innerHTML = `
    <div class="receipt-header">
      <h2>${storeName}</h2>
      ${ownerName ? `<p>${ownerName}</p>` : ''}
      ${nieNumber ? `<p>${nieNumber}</p>` : ''}
      ${companyAddress ? `<p style="white-space: pre-line;">${companyAddress}</p>` : ''}
      <h3 style="margin-top: 10px;">FACTURA SIMPLIFICADA</h3>
      <h3 style="color: #6E8FAF;">PARKING RECEIPT</h3>
      <p>Receipt #${loan.receipt_number}</p>
      <p>${formatDateTimeWithDisplayTimeZone(date, 'en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })}</p>
    </div>
    
    <div class="receipt-items">
      ${sale.items.map(item => `
        <div class="receipt-item">
          <span>${item.product_name} x${item.quantity}</span>
          <span>${currencySymbol}${item.subtotal.toFixed(2)}</span>
        </div>
      `).join('')}
    </div>
    
    <div class="receipt-summary">
      <div class="receipt-item">
        <span>Subtotal:</span>
        <span>${currencySymbol}${sale.subtotal.toFixed(2)}</span>
      </div>
      <div class="receipt-item">
        <span>Tax (${taxRate}%):</span>
        <span>${currencySymbol}${sale.tax.toFixed(2)}</span>
      </div>
      <div class="receipt-item" style="font-weight: bold; font-size: 16px;">
        <span>TOTAL AMOUNT:</span>
        <span>${currencySymbol}${sale.total.toFixed(2)}</span>
      </div>
    </div>
    
    <div class="loan-info" style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 8px;">
      <p><strong>Customer Type:</strong> ${customerType}</p>
      ${restaurantInfo}
      <p><strong>Customer Name:</strong> ${loan.customer_name}</p>
      ${loan.customer_phone ? `<p><strong>Phone:</strong> ${loan.customer_phone}</p>` : ''}
      <p style="margin-top: 10px; color: #6E8FAF;"><strong>Status:</strong> Pending Payment</p>
    </div>
    
    <div class="receipt-footer">
      <p style="font-weight: bold; color: #d9534f;">⚠️ PAYMENT REQUIRED</p>
      <p>${receiptFooter}</p>
      <p>Receipt #: <strong>${loan.receipt_number}</strong></p>
    </div>
  `;
  
  modal.classList.add('active');
}

// Function to complete parking payment from checkout page
async function completeLoanPaymentFromCheckout(receiptNumber, amount, paymentMethod, options = {}) {
  try {
    // Get the loan by receipt number
    const loan = await window.api.getLoanByReceipt(receiptNumber);
    
    if (!loan) {
      throw new Error('PARKING not found with this receipt number');
    }
    
    if (loan.status === 'paid') {
      throw new Error('This PARKING has already been paid in full');
    }
    
    // Process the payment
    const paymentData = {
      amount: parseFloat(amount.toFixed(2)), // Ensure proper precision
      paymentMethod,
      cashierId: currentUser.id
    };
    
    console.log('Processing loan payment:', {
      loanId: loan.id,
      remainingAmount: loan.remaining_amount,
      paymentAmount: paymentData.amount,
      willBePaid: loan.remaining_amount <= paymentData.amount
    });
    
    const result = await window.api.payLoan(loan.id, paymentData);
    
    console.log('Loan payment result:', result);

    // If cash payment, open cash drawer ASAP (do not wait for printing)
    if (paymentMethod === 'cash') {
      openCashDrawer().catch(e => console.warn('Cash drawer open failed:', e));
    }
    
    // Print receipt immediately at payment time
    await printLoanPaymentReceipt({
      loanBefore: loan,
      loanAfter: result,
      amount,
      paymentMethod,
      paymentAmount: options?.paymentAmount,
      changeAmount: options?.changeAmount
    });

    const currencySymbol = systemSettings?.currency_symbol || '€';
    
    // Show success message
    if (result.status === 'paid') {
      showAlert('PARKING payment completed successfully!', 'success');
    } else if (result.status === 'partial') {
      showAlert(`Partial payment completed. Remaining: ${currencySymbol}${result.remaining_amount.toFixed(2)}`, 'success');
    }
    
    return result;
  } catch (error) {
    console.error('Error completing loan payment from checkout:', error);
    throw error;
  }
}

// Function to handle parking payment in checkout page
async function payParkingInCheckout(receiptNumber, remainingAmount) {
  try {
    // Store parking payment info for checkout (include party details for banner)
    let loanForCtx = null;
    try {
      loanForCtx = await window.api.getLoanByReceipt(receiptNumber);
    } catch {
      loanForCtx = null;
    }

    setParkingPaymentContext({
      receiptNumber: receiptNumber,
      amount: remainingAmount,
      remainingAmount: Number(loanForCtx?.remaining_amount ?? remainingAmount ?? 0),
      status: (loanForCtx?.status || '').toString().toLowerCase(),
      customerType: (loanForCtx?.customer_type || '').toString().toLowerCase(),
      restaurantName: loanForCtx?.restaurant_name || null,
      customerName: loanForCtx?.customer_name || null,
      customerPhone: loanForCtx?.customer_phone || null,
      timestamp: Date.now()
    });

    try { updateParkingContextBanner(); } catch { /* ignore */ }
    
    // Navigate to checkout page using the correct method
    // Update active nav button
    const navBtns = document.querySelectorAll('.tab-btn');
    navBtns.forEach(b => b.classList.remove('active'));
    const targetBtn = document.querySelector('[data-view="checkout"]');
    if (targetBtn) {
      targetBtn.classList.add('active');
    }
    
    // Show checkout view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('checkoutView').classList.add('active');
    
    // Toggle navbar visibility for checkout
    toggleNavbarForView('checkout');
    
    // Load checkout view data (kept as a promise so we can wait for it below;
    // otherwise its late cart refresh can reset the auto-selected payment).
    const checkoutReady = loadCheckoutView().catch(() => {});
    
    // Load the parking items into the cart once Checkout is ready
    setTimeout(async () => {
      await checkoutReady;
      try {
        // Get the original parking/loan details to show individual items
        const loan = loanForCtx || await window.api.getLoanByReceipt(receiptNumber);
        if (loan && loan.sale && loan.sale.items) {
          // Use the original sale items from the parking transaction
          cart = loan.sale.items.map(item => ({
            productId: item.product_id || `parking_item_${Date.now()}_${Math.random()}`,
            productName: item.product_name || 'Parking Item',
            saleItemId: item.id,
            loanId: loan.id,
            unitPrice: item.unit_price || item.price || (item.subtotal / item.quantity),
            taxRate: item.tax_rate || 0,
            quantity: item.quantity || 1,
            subtotal: item.subtotal || item.price || 0,
            isWeightBased: POS_DISABLE_SCALE_AND_WEIGHT ? false : (item.unit_type === 'weight'),
            cartItemId: Date.now() + Math.random(), // Unique ID for each item
            discountPercent: Number(item.discount_percent || 0)
          }));
        } else {
          // Fallback to single parking payment item if we can't get original items
          cart = [{
            productId: 'parking_payment',
            productName: `PARKING Payment #${receiptNumber}`,
            unitPrice: remainingAmount,
            taxRate: 0,
            quantity: 1,
            subtotal: remainingAmount,
            isWeightBased: false,
            cartItemId: Date.now(),
            discountPercent: 0
          }];
        }
      } catch (error) {
        console.error('Error fetching parking details:', error);
        // Fallback to single parking payment item
        cart = [{
          productId: 'parking_payment',
          productName: `PARKING Payment #${receiptNumber}`,
          unitPrice: remainingAmount,
          taxRate: 0,
          quantity: 1,
          subtotal: remainingAmount,
          isWeightBased: false,
          cartItemId: Date.now(),
          discountPercent: 0
        }];
      }
      
      // Stay on Checkout with the parking items in the cart so more items can be
      // added; the cashier opens PAYMENT when ready (new items are appended to the
      // parking before it is settled).
      updateCartDisplayNow();
    }, 200);
    
  } catch (error) {
    console.error('Error redirecting to parking payment:', error);
    showAlert('Error processing parking payment: ' + error.message, 'error');
  }
}

async function searchLoanByReceipt(receiptNumber) {
  if (!receiptNumber || receiptNumber.trim() === '') {
    alert('Please enter a receipt number');
    return;
  }
  
  try {
    const loan = await window.api.getLoanByReceipt(receiptNumber);
    
    if (!loan) {
      alert('PARKING not found with this receipt number');
      return;
    }
    
    if (loan.status === 'paid') {
      alert('This PARKING has already been paid in full');
      return;
    }
    
    // Show loan payment modal
    showLoanPaymentModal(loan);
  } catch (error) {
    alert('Error searching for PARKING: ' + error.message);
  }
}

async function handleLoanSearchSubmit(rawQuery) {
  const query = String(rawQuery || '').trim();

  // Empty search = reset back to default list for current tab.
  if (!query) {
    currentLoansSearchQuery = '';
    await loadLoansView(currentLoansStatus || 'active');
    return;
  }

  // 1) Quick path: exact receipt number match -> open Pay modal.
  // 2) Otherwise: filter the PARKING list by receipt/customer/restaurant/phone.
  try {
    const loan = await window.api.getLoanByReceipt(query);
    if (loan) {
      if (String(loan.status || '').toLowerCase() === 'paid') {
        showAlert('This PARKING has already been paid in full', 'info');
      } else {
        showLoanPaymentModal(loan);
        return;
      }
    }
  } catch {
    // ignore; fall back to list search
  }

  currentLoansSearchQuery = query;
  await loadLoansView(currentLoansStatus || 'active');
}

function showLoanPaymentModal(loan) {
  const modal = document.getElementById('loanPaymentModal');
  const content = document.getElementById('loanPaymentContent');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  const loanDate = new Date(loan.loan_date);
  
  const customerTypeLabel = loan.customer_type === 'restaurant' ? '🍽️ Restaurant' : '👤 Regular Customer';
  const restaurantInfo = loan.customer_type === 'restaurant' && loan.restaurant_name ? `
    <div class="loan-detail-row">
      <span>Restaurant:</span>
      <span><strong>${loan.restaurant_name}</strong></span>
    </div>
    ${loan.restaurant_nie ? `
    <div class="loan-detail-row">
      <span>NIE:</span>
      <span>${loan.restaurant_nie}</span>
    </div>` : ''}
  ` : '';
  
  content.innerHTML = `
    <div class="loan-payment-info">
      <h3>Parking Details</h3>
      <div class="loan-detail-row">
        <span>Receipt #:</span>
        <span><strong>${loan.receipt_number}</strong></span>
      </div>
      <div class="loan-detail-row">
        <span>Type:</span>
        <span>${customerTypeLabel}</span>
      </div>
      ${restaurantInfo}
      <div class="loan-detail-row">
        <span>Customer:</span>
        <span>${loan.customer_name}</span>
      </div>
      ${loan.customer_phone ? `
      <div class="loan-detail-row">
        <span>Phone:</span>
        <span>${loan.customer_phone}</span>
      </div>` : ''}
      <div class="loan-detail-row">
        <span>Date:</span>
        <span>${formatDateWithDisplayTimeZone(loanDate, 'en-GB')}</span>
      </div>
      <div class="loan-detail-row" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #ddd;">
        <span>Total Amount:</span>
        <span><strong>${currencySymbol}${loan.loan_amount.toFixed(2)}</strong></span>
      </div>
      <div class="loan-detail-row">
        <span>Paid Amount:</span>
        <span>${currencySymbol}${loan.paid_amount.toFixed(2)}</span>
      </div>
      <div class="loan-detail-row" style="font-size: 18px; color: #d9534f;">
        <span><strong>Remaining:</strong></span>
        <span><strong>${currencySymbol}${loan.remaining_amount.toFixed(2)}</strong></span>
      </div>
    </div>
    
    <div class="loan-payment-form">
      <h3>Make Payment</h3>
      <div class="form-group">
        <label>Payment Amount *</label>
        <input type="number" id="paymentAmount" step="0.01" min="0.01" max="${loan.remaining_amount.toFixed(2)}" value="${loan.remaining_amount.toFixed(2)}" required autocomplete="off">
      </div>
      <div class="form-group">
        <label>Payment Method *</label>
        <div class="payment-method-buttons">
          <button type="button" class="payment-method-btn" data-method="cash">💵 CASH</button>
          <button type="button" class="payment-method-btn" data-method="card">💳 CARD</button>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary cancel-btn">Cancel</button>
        <button type="button" class="btn-primary" id="completeLoanPaymentBtn" disabled>Complete Payment</button>
      </div>
    </div>
  `;
  
  // Store loan ID for payment
  modal.dataset.loanId = loan.id;
  
  // Setup payment method buttons
  const methodButtons = content.querySelectorAll('.payment-method-btn');
  methodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      methodButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      modal.dataset.paymentMethod = btn.dataset.method;
      document.getElementById('completeLoanPaymentBtn').disabled = false;
    });
  });
  
  // Setup complete payment button (remove old listeners first)
  const completeBtn = document.getElementById('completeLoanPaymentBtn');
  const newCompleteBtn = completeBtn.cloneNode(true);
  completeBtn.parentNode.replaceChild(newCompleteBtn, completeBtn);
  
  newCompleteBtn.addEventListener('click', async () => {
    const method = modal.dataset.paymentMethod;
    
    if (!method) {
      alert('Please select a payment method (Cash or Card)');
      return;
    }
    
    // Get the payment amount input from inside the modal
    const amountInput = content.querySelector('#paymentAmount');
    if (!amountInput) {
      alert('Error: Payment amount field not found');
      return;
    }
    
    const amount = parseFloat(amountInput.value);
    const remainingAmount = parseFloat(loan.remaining_amount);
    
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }
    
    // Round to 2 decimal places for comparison to avoid floating point issues
    if (Math.round(amount * 100) > Math.round(remainingAmount * 100)) {
      alert('Payment amount cannot exceed remaining balance');
      return;
    }
    
    await completeLoanPayment(loan, amount, method);
  });
  
  modal.classList.add('active');
}

async function printLoanPaymentReceipt({ loanBefore, loanAfter, amount, paymentMethod, paymentAmount, changeAmount }) {
  try {
    if (!systemSettings) {
      systemSettings = await window.api.getSystemSettings();
    }

    // Ensure tax/category info is available for the standard receipt format.
    try {
      if (!Array.isArray(allProducts) || allProducts.length === 0) {
        allProducts = await window.api.getAllProducts();
      }
      if (!Array.isArray(allCategories) || allCategories.length === 0) {
        allCategories = await window.api.getAllCategories();
      }
    } catch {
      // If this fails, we still print a receipt (taxBreakdown may be empty).
    }

    const currencySymbol = systemSettings?.currency_symbol || '€';
    const printerName = (systemSettings?.printer_name || '').toString().toLowerCase();
    const looks80mm = printerName.includes('80mm')
      || printerName.includes('80 mm')
      || printerName.includes('posprinter')
      || printerName.includes('pos-80')
      || printerName.includes('pos 80')
      || printerName.includes('easy 80')
      || printerName.includes('tp easy 80')
      || printerName.includes('tp7001')
      || printerName.includes('tp 7001')
      || printerName.includes('iggual');

    const before = loanBefore || {};
    const after = loanAfter || {};

    // STANDARD RECEIPT FORMAT (same as cash/card)
    const loanReceiptNumber = after.receipt_number ?? before.receipt_number ?? '';
    const amountPaid = Number(amount ?? 0);
    const tendered = Number(paymentAmount);
    const change = Number(changeAmount);
    const remainingAfter = Number(after.remaining_amount ?? 0);
    const loanTotal = Number(after.loan_amount ?? before.loan_amount ?? 0);
    const status = (after.status ?? before.status ?? '').toString().toLowerCase();
    const isPartial = status === 'partial' || (Number.isFinite(remainingAfter) && remainingAfter > 0.009);

    const sale = after.sale || before.sale || null;
    const saleItems = Array.isArray(sale?.items) ? sale.items : [];

    // If it's a partial payment, print a simple standard receipt for the amount paid.
    // (A full-item invoice would be confusing if only part of the total was paid.)
    const itemsForReceipt = isPartial
      ? [{ name: `PARKING Payment #${loanReceiptNumber}`, quantity: 1, unitPrice: amountPaid, discountPercent: 0, subtotal: amountPaid }]
      : (saleItems.length
        ? saleItems.map((it) => ({
            name: it.product_name ?? it.name ?? 'Item',
            quantity: Number(it.quantity ?? 1),
            unitPrice: Number(it.unit_price ?? it.unitPrice),
            discountPercent: Number(it.discount_percent ?? it.discountPercent ?? 0),
            subtotal: Number(it.subtotal ?? 0),
            productId: it.product_id ?? it.productId,
            taxRate: it.tax_rate ?? it.taxRate
          }))
        : [{ name: `PARKING Payment #${loanReceiptNumber}`, quantity: 1, unitPrice: loanTotal || amountPaid, discountPercent: 0, subtotal: loanTotal || amountPaid }]);

    const total = isPartial ? amountPaid : (Number(sale?.total ?? 0) || itemsForReceipt.reduce((sum, i) => sum + Number(i.subtotal || 0), 0));

    // Build tax breakdown similar to standard receipts.
    const taxBreakdown = {};
    if (!isPartial) {
      for (const item of itemsForReceipt) {
        const subtotal = Number(item.subtotal || 0);
        if (!Number.isFinite(subtotal) || subtotal <= 0) continue;

        let taxRate = Number(item.taxRate);
        if (!Number.isFinite(taxRate)) {
          const pid = item.productId;
          const product = getCachedProductById(pid);
          const category = product ? getCachedCategoryByName(product.category) : null;
          taxRate = category ? Number(category.tax_rate) : 0;
        }
        if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = 0;

        const taxRatePercent = Math.round(taxRate * 100);
        const basePrice = subtotal / (1 + taxRate);
        const taxAmount = subtotal - basePrice;

        if (!taxBreakdown[taxRatePercent]) taxBreakdown[taxRatePercent] = { base: 0, tax: 0, total: 0 };
        taxBreakdown[taxRatePercent].base += basePrice;
        taxBreakdown[taxRatePercent].tax += taxAmount;
        taxBreakdown[taxRatePercent].total += subtotal;
      }
    }

    const taxBreakdownRows = Object.keys(taxBreakdown)
      .map(r => parseInt(r, 10))
      .filter(r => Number.isFinite(r))
      .sort((a, b) => a - b)
      .map(rate => ({
        rate,
        base: taxBreakdown[rate].base,
        tax: taxBreakdown[rate].tax,
        total: taxBreakdown[rate].total
      }));

    // Standard receipt payload: DO NOT send type='loanPayment' (that triggers the special Parking-only format).
    const receiptData = {
      storeName: systemSettings?.store_name || 'SUPERMARKET POS',
      ownerName: systemSettings?.owner_name || '',
      nieNumber: systemSettings?.nie_number || '',
      companyAddress: systemSettings?.company_address || '',
      lineWidth: looks80mm ? 48 : undefined,

      customerType: after.customer_type ?? before.customer_type ?? null,
      customerName: after.customer_name ?? before.customer_name ?? null,
      customerPhone: after.customer_phone ?? before.customer_phone ?? null,
      restaurantName: after.restaurant_name ?? before.restaurant_name ?? null,
      restaurantNie: after.restaurant_nie ?? before.restaurant_nie ?? null,

      receiptId: loanReceiptNumber,
      // Use ISO timestamp and let the main process format it in the correct timezone.
      dateIso: new Date().toISOString(),
      items: itemsForReceipt,
      taxBreakdown: taxBreakdownRows,
      total,
      paymentMethod,
      paymentAmount: (Number.isFinite(tendered) ? tendered : (amountPaid || total)),
      changeAmount: (Number.isFinite(change) ? change : 0),
      currency: currencySymbol,
      footer: systemSettings?.receipt_footer || 'Thank you for shopping with us!',
      cashier: currentUser?.full_name || ''
    };

    const result = await window.api.printReceipt(receiptData);
    if (!result?.success) {
      showAlert('Failed to print PARKING payment receipt: ' + (result?.error || 'Printer not configured'), 'error', 'Print Error');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error printing loan payment receipt:', error);
    showAlert('Failed to print PARKING payment receipt: ' + error.message, 'error', 'Print Error');
    return false;
  }
}

async function completeLoanPayment(loanOrId, amount, paymentMethod) {
  try {
    const loanBefore = (loanOrId && typeof loanOrId === 'object') ? loanOrId : null;
    const loanId = loanBefore ? loanBefore.id : loanOrId;

    const paymentData = {
      amount,
      paymentMethod,
      cashierId: currentUser.id
    };
    
    const result = await window.api.payLoan(loanId, paymentData);

    // If cash payment, open cash drawer ASAP (do not wait for printing)
    if (paymentMethod === 'cash') {
      openCashDrawer().catch(e => console.warn('Cash drawer open failed:', e));
    }

    // Print receipt immediately at payment time
    await printLoanPaymentReceipt({ loanBefore, loanAfter: result, amount, paymentMethod });
    
    // Close payment modal
    document.getElementById('loanPaymentModal').classList.remove('active');
    
    // Show success message
    if (result.status === 'paid') {
      // Success message removed
    } else if (result.status === 'partial') {
      // Success message removed
    }
    
    // Reload loans view if it's active
    if (document.getElementById('loansView').classList.contains('active')) {
      await loadLoansView();
    }
  } catch (error) {
    alert('Error processing payment: ' + error.message);
  }
}

function renderLoansTable(loans) {
  const tbody = document.querySelector('#loansTable tbody');
  const currencySymbol = systemSettings?.currency_symbol || '€';

  if (!Array.isArray(loans) || loans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="icon">💳</div><p>No Parking orders found</p></td></tr>';
    return;
  }

  tbody.innerHTML = loans.map(loan => {
    const loanDate = (loan.status === 'paid' && loan.paid_date)
      ? new Date(loan.paid_date)
      : new Date(loan.loan_date);
    let statusClass = 'status-pending';
    if (loan.status === 'paid') statusClass = 'status-paid';
    else if (loan.status === 'partial') statusClass = 'status-partial';

    const customerType = loan.customer_type === 'restaurant' ? '🍽️ Restaurant' : '👤 Regular';
    const displayName = loan.customer_type === 'restaurant' && loan.restaurant_name
      ? `${loan.restaurant_name}<br><small>${loan.customer_name}</small>`
      : loan.customer_name;

    // Show only the last 6 digits; full number stays in the tooltip and search matches partials.
    const fullReceipt = String(loan.receipt_number || '');
    const shortReceipt = fullReceipt.length > 6 ? fullReceipt.slice(-6) : fullReceipt;

    const loanAmount = Number(loan.loan_amount || 0);
    const paidAmount = Number(loan.paid_amount || 0);
    const remainingAmount = Number(loan.remaining_amount || 0);

    return `
      <tr>
        <td title="${fullReceipt}">#${shortReceipt}</td>
        <td>${customerType}</td>
        <td>${displayName}</td>
        <td>${currencySymbol}${loanAmount.toFixed(2)}</td>
        <td>${currencySymbol}${paidAmount.toFixed(2)}</td>
        <td>${currencySymbol}${remainingAmount.toFixed(2)}</td>
        <td><span class="status-badge ${statusClass}">${String(loan.status || '').toUpperCase()}</span></td>
        <td>${formatDateWithDisplayTimeZone(loanDate, 'en-GB')}</td>
        <td>
          ${String(loan.status || '').toLowerCase() !== 'paid'
            ? `<button type="button" class="btn-action" data-loan-action="pay" data-receipt="${loan.receipt_number}" data-remaining="${remainingAmount}">Pay</button>
               ${paidAmount > 0.009 ? '' : `<button type="button" class="btn-action btn-action-danger" data-loan-action="delete" data-loan-id="${loan.id}" title="Delete">🗑️</button>`}`
            : (loan.sale_id
              ? `
                <button class="btn-action" onclick="viewParkingBillForLoan(${loan.sale_id})" title="View">👁️</button>
                <button class="btn-action" onclick="printParkingBillForLoan(${loan.sale_id})" title="Print">🖨️</button>
              `
              : '-')}
        </td>
      </tr>
    `;
  }).join('');
}

async function loadLoansView(status = null) {
  const effectiveStatus = status || currentLoansStatus || 'active';
  currentLoansStatus = effectiveStatus;

  const q = String(currentLoansSearchQuery || '').trim();
  const loans = q
    ? await window.api.searchLoans(q, effectiveStatus)
    : await window.api.getAllLoans(effectiveStatus);

  renderLoansTable(loans);
}

function normalizePaidParkingSaleForReceipt(sale) {
  if (!sale) return sale;
  const normalized = { ...sale };
  const paymentMethod = (normalized.payment_method || '').toString().toLowerCase();
  const loanStatus = (normalized.loan_status || '').toString().toLowerCase();
  const loanPaymentMethod = (normalized.loan_payment_method || '').toString().toLowerCase();

  // Paid PARKING: show the settlement method (cash/card) instead of "loan".
  if (paymentMethod === 'loan' && loanStatus === 'paid' && (loanPaymentMethod === 'cash' || loanPaymentMethod === 'card')) {
    normalized.payment_method = loanPaymentMethod;
    normalized.payment_amount = Number(normalized.total || 0);
    normalized.change_amount = 0;
    if (normalized.loan_paid_date) {
      normalized.sale_date = normalized.loan_paid_date;
    }
  }

  return normalized;
}

async function deleteParking(loanId) {
  try {
    const loan = await window.api.getLoanById(loanId);
    if (!loan) {
      showAlert('PARKING not found', 'error');
      return;
    }
    const currencySymbol = systemSettings?.currency_symbol || '€';
    const name = loan.customer_type === 'restaurant' && loan.restaurant_name
      ? loan.restaurant_name
      : (loan.customer_name || '');
    const ok = await showConfirmDialog({
      title: 'Delete PARKING?',
      message: `${name} — ${currencySymbol}${Number(loan.remaining_amount || 0).toFixed(2)}\nThe items will be returned to stock. This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      tone: 'danger'
    });
    if (!ok) return;

    await window.api.deleteLoan(loanId);
    showAlert('PARKING deleted', 'success');
    await loadLoansView(currentLoansStatus || 'active');
    try { await loadAllProducts(); } catch { /* ignore */ }
  } catch (error) {
    const msg = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    showAlert('Error deleting PARKING: ' + msg, 'error');
  }
}

async function viewParkingBillForLoan(saleId) {
  try {
    const fullSale = await window.api.getSaleById(Number(saleId));
    if (!fullSale) {
      showAlert('Sale not found', 'error');
      return;
    }
    showReceipt(normalizePaidParkingSaleForReceipt(fullSale));
  } catch (error) {
    showAlert('Failed to load bill: ' + error.message, 'error');
  }
}

async function printParkingBillForLoan(saleId) {
  try {
    const fullSale = await window.api.getSaleById(Number(saleId));
    if (!fullSale) {
      showAlert('Sale not found', 'error');
      return;
    }
    await printReceiptToThermalPrinter(normalizePaidParkingSaleForReceipt(fullSale));
  } catch (error) {
    showAlert('Failed to print bill: ' + error.message, 'error');
  }
}

// ============== OPEN FOOD FACTS / GS1 BARCODE AUTO-LOOKUP ==============
let _offLookupCache = {};

async function lookupBarcodeOpenFoodFacts(barcode) {
  const bc = String(barcode || '').replace(/\s+/g, '').trim();
  if (!bc || bc.length < 6) return null;
  if (_offLookupCache[bc] !== undefined) return _offLookupCache[bc];
  try {
    const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(bc)}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) { _offLookupCache[bc] = null; return null; }
    const data = await res.json();
    if (data.status !== 1 || !data.product) { _offLookupCache[bc] = null; return null; }
    const p = data.product;
    const result = {
      name: p.product_name_en || p.product_name || p.product_name_fr || p.product_name_es || '',
      category: p.categories_tags?.[0]?.replace(/^en:/, '').replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase()) || '',
      brand: p.brands || '',
      image: p.image_small_url || p.image_url || '',
    };
    _offLookupCache[bc] = result;
    return result;
  } catch {
    _offLookupCache[bc] = null;
    return null;
  }
}

function attachBarcodeLookupToProductModal() {
  const barcodeEl = document.getElementById('productBarcode');
  if (!barcodeEl || barcodeEl.dataset.offLookupAttached) return;
  barcodeEl.dataset.offLookupAttached = '1';

  // Create a status badge below the barcode input
  let badge = document.getElementById('barcodeLookupBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'barcodeLookupBadge';
    badge.style.cssText = 'display:none; margin-top:6px; padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; align-items:center; gap:8px; flex-wrap:wrap;';
    barcodeEl.parentElement?.appendChild(badge);
  }

  let lookupTimer = null;

  const doLookup = async (bc) => {
    if (!bc || bc.length < 8) { badge.style.display = 'none'; return; }
    badge.style.background = '#f0f9ff';
    badge.style.border = '1.5px solid #bae6fd';
    badge.style.color = '#0369a1';
    badge.style.display = 'flex';
    badge.innerHTML = '<span style="display:inline-block;">&#8987;</span>&nbsp; Looking up barcode on Open Food Facts&hellip;';

    const result = await lookupBarcodeOpenFoodFacts(bc);

    if (!result || !result.name) {
      badge.style.background = '#fef9c3';
      badge.style.border = '1.5px solid #fde047';
      badge.style.color = '#713f12';
      badge.innerHTML = '&#9888;&#65039; Not found in Open Food Facts. Enter details manually.';
      return;
    }

    const nameEl = document.getElementById('productName');
    const catEl  = document.getElementById('productCategory');
    badge.style.background = '#f0fdf4';
    badge.style.border = '1.5px solid #bbf7d0';
    badge.style.color = '#14532d';
    badge.innerHTML = `
      <span>&#9989; Found: <b>${result.name}</b>${result.brand ? ` &mdash; ${result.brand}` : ''}${result.category ? ` (${result.category})` : ''}</span>
      <button id="barcodeApplyLookup" style="margin-left:auto; background:#16a34a; color:#fff; border:none; border-radius:6px; padding:4px 14px; font-size:11px; font-weight:800; cursor:pointer; white-space:nowrap;">&#8598; Apply</button>
    `;
    document.getElementById('barcodeApplyLookup')?.addEventListener('click', () => {
      if (nameEl) {
        if (!nameEl.value.trim() || confirm(`Replace current name "${nameEl.value}" with "${result.name}"?`)) {
          nameEl.value = result.name;
        }
      }
      if (catEl && result.category) {
        const opts = Array.from(catEl.options || []);
        const key = result.category.toLowerCase().substring(0, 5);
        const match = opts.find(o => o.text.toLowerCase().includes(key));
        if (match) catEl.value = match.value;
      }
      const btn = document.getElementById('barcodeApplyLookup');
      if (btn) btn.outerHTML = '<span style="color:#16a34a; margin-left:auto;">&#10003; Applied</span>';
    });
  };

  barcodeEl.addEventListener('input', () => {
    clearTimeout(lookupTimer);
    const bc = barcodeEl.value.replace(/\s+/g, '').trim();
    if (bc.length < 8) { badge.style.display = 'none'; return; }
    lookupTimer = setTimeout(() => doLookup(bc), 700);
  });

  barcodeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(lookupTimer);
      const bc = barcodeEl.value.replace(/\s+/g, '').trim();
      doLookup(bc);
    }
  });
}

// ============== BULK BARCODE UPLOAD ==============
function clearBulkCsv() {
  window._bulkUploadRows = null;
  const fileInput = document.getElementById('bulkUploadFileInput');
  if (fileInput) fileInput.value = '';
  const previewWrap = document.getElementById('bulkUploadPreviewWrap');
  if (previewWrap) previewWrap.style.display = 'none';
  const importBtn = document.getElementById('bulkUploadImportBtn');
  if (importBtn) { importBtn.disabled = true; importBtn.style.opacity = '0.5'; }
}

function openBulkUploadOverlay() {
  const overlay = document.getElementById('bulkUploadOverlay');
  if (!overlay) return;
  // Reset state
  window._bulkUploadRows = null;
  window._bulkImgRows = [];
  window._bulkActiveTab = 'csv';
  clearBulkCsv();
  clearBulkImages();
  switchBulkTab('csv');
  const progress = document.getElementById('bulkUploadProgress');
  if (progress) progress.style.display = 'none';
  overlay.style.display = 'flex';

  // Drag & drop — CSV dropzone
  const dropzone = document.getElementById('bulkUploadDropzone');
  if (dropzone && !dropzone.dataset.dndAttached) {
    dropzone.dataset.dndAttached = '1';
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#2563eb'; dropzone.style.background = '#eff6ff'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#93c5fd'; dropzone.style.background = '#f8faff'; });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#93c5fd';
      dropzone.style.background = '#f8faff';
      const file = e.dataTransfer?.files?.[0];
      if (file) handleBulkUploadFile(file);
    });
  }
  // Drag & drop — Image dropzone
  const imgDz = document.getElementById('imgDropzone');
  if (imgDz && !imgDz.dataset.dndAttached) {
    imgDz.dataset.dndAttached = '1';
    imgDz.addEventListener('dragover', (e) => { e.preventDefault(); imgDz.style.background = '#ede9fe'; });
    imgDz.addEventListener('dragleave', () => { imgDz.style.background = '#faf5ff'; });
    imgDz.addEventListener('drop', (e) => {
      e.preventDefault(); imgDz.style.background = '#faf5ff';
      const dropped = e.dataTransfer.files;
      if (dropped && dropped.length) handleBulkImageFiles(dropped);
    });
  }
}
function closeBulkUploadOverlay() {
  const overlay = document.getElementById('bulkUploadOverlay');
  if (overlay) overlay.style.display = 'none';
}

function downloadBulkUploadTemplate() {
  const header = 'barcode,name,price,category,tax,stock,cost,unit_type';
  const example = '5901234123457,Coca Cola 330ml,1.99,Drinks,21,100,0.80,quantity\n4006381333931,Banana 1kg,0.99,Fruits,10,50,0.40,weight';
  const blob = new Blob([header + '\n' + example], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bulk_upload_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function handleBulkUploadFile(file) {
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel';

  const onRows = (rows) => {
    if (!rows || rows.length === 0) {
      showAlert('No valid rows found. Make sure you have a "barcode" column.', 'error', 'Parse Error');
      return;
    }
    window._bulkUploadRows = rows;
    renderBulkUploadPreview(rows);
    const importBtn = document.getElementById('bulkUploadImportBtn');
    if (importBtn) { importBtn.disabled = false; importBtn.style.opacity = '1'; }
  };

  if (isXlsx) {
    _loadSheetJS().then(() => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          onRows(parseRowObjects(jsonRows));
        } catch (err) {
          showAlert('Failed to parse Excel file: ' + err.message, 'error', 'Parse Error');
        }
      };
      reader.readAsArrayBuffer(file);
    }).catch(() => showAlert('Could not load Excel parser. Please use CSV format.', 'error'));
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { onRows(parseBulkUploadCSV(e.target.result)); }
      catch (err) { showAlert('Failed to parse CSV: ' + err.message, 'error', 'Parse Error'); }
    };
    reader.readAsText(file, 'UTF-8');
  }
}

let _sheetJSLoaded = false;
function _loadSheetJS() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => { _sheetJSLoaded = true; resolve(); };
    s.onerror = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s2.onload = () => { _sheetJSLoaded = true; resolve(); };
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  });
}

function parseRowObjects(jsonRows) {
  return jsonRows.map(row => {
    const r = {};
    for (const k of Object.keys(row)) r[k.toString().trim().toLowerCase()] = row[k];
    const barcode = String(r['barcode'] || '').replace(/\s+/g, '').trim();
    if (!barcode) return null;
    const price  = parseFloat(String(r['price']  || '0').replace(',', '.'));
    const taxPct = parseFloat(String(r['tax']    || '21').replace(',', '.'));
    const stock  = parseFloat(String(r['stock']  || '0').replace(',', '.'));
    const cost   = parseFloat(String(r['cost']   || '0').replace(',', '.'));
    const unitType = ['quantity','weight'].includes(String(r['unit_type'] || '').toLowerCase().trim())
      ? String(r['unit_type']).toLowerCase().trim() : 'quantity';
    return {
      barcode,
      name: String(r['name'] || barcode).trim(),
      price:    isNaN(price)  ? 0 : price,
      category: String(r['category'] || '').trim() || null,
      tax_rate: (isNaN(taxPct) ? 21 : taxPct) / 100,
      purchase_tax_rate: (isNaN(taxPct) ? 21 : taxPct) / 100,
      stock: isNaN(stock) ? 0 : stock,
      cost:  isNaN(cost)  ? 0 : cost,
      unit_type: unitType,
      regular_price: isNaN(price) ? 0 : price,
      show_in_checkout: 1,
      weight_unit: 'kg',
      quantity_unit: 'piece',
    };
  }).filter(Boolean);
}

function parseBulkUploadCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  function splitCSVLine(line) {
    const result = []; let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  }

  const header = splitCSVLine(lines[0]).map(h => h.toLowerCase());
  if (!header.includes('barcode')) throw new Error('CSV must have a "barcode" column header in the first row.');
  const jsonRows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    const cols = splitCSVLine(line);
    const obj = {};
    header.forEach((h, idx) => { obj[h] = cols[idx] ?? ''; });
    jsonRows.push(obj);
  }
  return parseRowObjects(jsonRows);
}

function renderBulkUploadPreview(rows) {
  const previewWrap = document.getElementById('bulkUploadPreviewWrap');
  const title       = document.getElementById('bulkUploadPreviewTitle');
  const thead       = document.getElementById('bulkUploadPreviewHead');
  const tbody       = document.getElementById('bulkUploadPreviewBody');
  if (!previewWrap || !thead || !tbody) return;

  title.textContent = `Preview: ${rows.length} product(s) to import`;

  thead.innerHTML = `<tr>${['Barcode','Name','Price','Category','Tax%','Stock','Unit Type'].map(h =>
    `<th style="padding:8px 10px; font-size:11px; font-weight:800; letter-spacing:.5px;">${h}</th>`).join('')}</tr>`;

  const currencySymbol = systemSettings?.currency_symbol || '€';
  tbody.innerHTML = rows.slice(0, 200).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#fff'};">
      <td style="padding:6px 10px; font-family:monospace; font-size:11px;">${r.barcode}</td>
      <td style="padding:6px 10px; font-size:12px;">${r.name}</td>
      <td style="padding:6px 10px; font-size:12px;">${currencySymbol}${Number(r.price).toFixed(2)}</td>
      <td style="padding:6px 10px; font-size:12px;">${r.category || '—'}</td>
      <td style="padding:6px 10px; font-size:12px;">${Math.round(Number(r.tax_rate) * 100)}%</td>
      <td style="padding:6px 10px; font-size:12px;">${r.stock}</td>
      <td style="padding:6px 10px; font-size:12px;">${r.unit_type}</td>
    </tr>`).join('');

  if (rows.length > 200) {
    tbody.innerHTML += `<tr><td colspan="7" style="padding:8px 10px; color:#64748b; font-size:11px; text-align:center;">… and ${rows.length - 200} more rows</td></tr>`;
  }

  previewWrap.style.display = 'block';
}

async function startBulkUpload() {
  const rows = window._bulkUploadRows;
  if (!rows || rows.length === 0) return;

  const importBtn = document.getElementById('bulkUploadImportBtn');
  if (importBtn) { importBtn.disabled = true; importBtn.style.opacity = '0.5'; }

  const progress     = document.getElementById('bulkUploadProgress');
  const progressBar  = document.getElementById('bulkUploadProgressBar');
  const progressLabel = document.getElementById('bulkUploadProgressLabel');
  const progressCount = document.getElementById('bulkUploadProgressCount');
  const progressResults = document.getElementById('bulkUploadProgressResults');
  if (progress) progress.style.display = 'block';
  if (progressResults) progressResults.innerHTML = '';

  const BATCH = 20;
  let created = 0, skipped = 0, errors = [];
  const total = rows.length;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const res = await window.api.bulkAddProducts(batch);
      created += res.created || 0;
      skipped += res.skipped || 0;
      errors = errors.concat(res.errors || []);
    } catch (e) {
      errors.push({ barcode: '(batch)', error: String(e?.message || e) });
    }
    const done = Math.min(i + BATCH, total);
    const pct = Math.round((done / total) * 100);
    if (progressBar)  progressBar.style.width  = pct + '%';
    if (progressCount) progressCount.textContent = `${done} / ${total}`;
    if (progressLabel) progressLabel.textContent = `Importing… (${pct}%)`;
  }

  if (progressLabel) progressLabel.textContent = `✅ Done!`;
  if (progressBar)   progressBar.style.background = 'linear-gradient(90deg,#16a34a,#22c55e)';

  let summary = `<div style="padding:8px 12px; background:#f0fdf4; border:1.5px solid #bbf7d0; border-radius:8px; margin-bottom:8px;">
    <b style="color:#15803d;">✅ Created: ${created}</b> &nbsp;|&nbsp;
    <span style="color:#64748b;">⏭ Skipped (already exist): ${skipped}</span>
    ${errors.length ? ` &nbsp;|&nbsp; <span style="color:#dc2626;">❌ Errors: ${errors.length}</span>` : ''}
  </div>`;
  if (errors.length) {
    summary += errors.slice(0, 10).map(e =>
      `<div style="color:#dc2626; font-size:11px; padding:2px 4px;">❌ ${e.barcode}: ${e.error}</div>`
    ).join('');
    if (errors.length > 10) summary += `<div style="color:#64748b; font-size:11px;">… and ${errors.length - 10} more errors</div>`;
  }
  if (progressResults) progressResults.innerHTML = summary;

  // Refresh products list
  try { await loadProductsView(); } catch { /* ignore */ }

  if (importBtn) { importBtn.disabled = false; importBtn.style.opacity = '1'; importBtn.textContent = '✅ Done — Upload More'; }
}

// ============== BULK IMAGE TAB ==============

function switchBulkTab(tab) {
  const csvTab = document.getElementById('bulkTabCsv');
  const imgTab = document.getElementById('bulkTabImg');
  const csvPanel = document.getElementById('bulkPanelCsv');
  const imgPanel = document.getElementById('bulkPanelImg');
  if (!csvTab || !imgTab) return;
  if (tab === 'csv') {
    csvTab.style.borderBottomColor = '#2563eb'; csvTab.style.color = '#2563eb';
    imgTab.style.borderBottomColor = 'transparent'; imgTab.style.color = '#64748b';
    if (csvPanel) csvPanel.style.display = '';
    if (imgPanel) imgPanel.style.display = 'none';
    // enable import btn only if csv rows loaded
    const importBtn = document.getElementById('bulkUploadImportBtn');
    if (importBtn) {
      const hasRows = window._bulkUploadRows && window._bulkUploadRows.length > 0;
      importBtn.disabled = !hasRows;
      importBtn.style.opacity = hasRows ? '1' : '0.5';
    }
  } else {
    imgTab.style.borderBottomColor = '#7c3aed'; imgTab.style.color = '#7c3aed';
    csvTab.style.borderBottomColor = 'transparent'; csvTab.style.color = '#64748b';
    if (imgPanel) imgPanel.style.display = '';
    if (csvPanel) csvPanel.style.display = 'none';
    // enable import btn only if image scan rows loaded
    const importBtn = document.getElementById('bulkUploadImportBtn');
    if (importBtn) {
      const hasRows = window._bulkImgRows && window._bulkImgRows.length > 0;
      importBtn.disabled = !hasRows;
      importBtn.style.opacity = hasRows ? '1' : '0.5';
    }
  }
  window._bulkActiveTab = tab;
}

function clearBulkImages() {
  window._bulkImgRows = [];
  const body = document.getElementById('imgScanBody');
  if (body) body.innerHTML = '';
  const results = document.getElementById('imgScanResults');
  if (results) results.style.display = 'none';
  const progress = document.getElementById('imgScanProgress');
  if (progress) progress.style.display = 'none';
  const fileInput = document.getElementById('bulkImgFileInput');
  if (fileInput) fileInput.value = '';
  const importBtn = document.getElementById('bulkUploadImportBtn');
  if (importBtn) { importBtn.disabled = true; importBtn.style.opacity = '0.5'; }
}

async function _loadQuagga() {
  if (window.Quagga) return window.Quagga;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/lib/quagga.min.js';
    s.onload = () => resolve(window.Quagga);
    s.onerror = () => reject(new Error('Quagga2 load failed'));
    document.head.appendChild(s);
  });
}

function _quaggaDecode(src) {
  return new Promise((resolve) => {
    window.Quagga.decodeSingle({
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader', 'code_128_reader', 'code_39_reader']
      },
      locate: true,
      src: src
    }, function(result) {
      if (result && result.codeResult && result.codeResult.code) {
        resolve(result.codeResult.code);
      } else {
        resolve(null);
      }
    });
  });
}

async function handleBulkImageFiles(files) {
  if (!files || !files.length) return;
  window._bulkImgRows = [];
  const resultsDiv = document.getElementById('imgScanResults');
  const progressDiv = document.getElementById('imgScanProgress');
  const progressLabel = document.getElementById('imgScanProgressLabel');
  const progressCount = document.getElementById('imgScanProgressCount');
  const progressBar = document.getElementById('imgScanProgressBar');
  const body = document.getElementById('imgScanBody');
  const title = document.getElementById('imgScanTitle');
  const importBtn = document.getElementById('bulkUploadImportBtn');

  if (body) body.innerHTML = '';
  if (resultsDiv) resultsDiv.style.display = 'none';
  if (progressDiv) progressDiv.style.display = '';
  if (progressLabel) progressLabel.textContent = 'Loading barcode scanner\u2026';
  if (progressCount) progressCount.textContent = `0 / ${files.length}`;
  if (progressBar) progressBar.style.width = '0%';

  try {
    await _loadQuagga();
  } catch {
    alert('Could not load barcode scanner library. Check your internet connection.');
    if (progressDiv) progressDiv.style.display = 'none';
    return;
  }

  let done = 0;
  const rows = [];

  for (const file of Array.from(files)) {
    done++;
    if (progressLabel) progressLabel.textContent = `Scanning ${file.name}\u2026`;
    if (progressCount) progressCount.textContent = `${done} / ${files.length}`;
    if (progressBar) progressBar.style.width = `${Math.round(done / files.length * 100)}%`;

    let barcode = null;
    let statusHtml = '';
    let nameHtml = '<span style="color:#94a3b8">\u2014</span>';
    let thumbUrl = '';

    try {
      thumbUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = e => res(e.target.result);
        fr.readAsDataURL(file);
      });

      // Try decode with Quagga2
      barcode = await _quaggaDecode(thumbUrl);

      // If Quagga fails, try on a sharpened/contrast-boosted canvas version
      if (!barcode) {
        const imgEl = await new Promise((res, rej) => {
          const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = thumbUrl;
        });
        for (const scale of [2, 1.5, 0.75]) {
          const c = document.createElement('canvas');
          c.width = Math.round(imgEl.naturalWidth * scale);
          c.height = Math.round(imgEl.naturalHeight * scale);
          const ctx = c.getContext('2d');
          ctx.filter = 'contrast(1.4) brightness(1.1)';
          ctx.drawImage(imgEl, 0, 0, c.width, c.height);
          barcode = await _quaggaDecode(c.toDataURL('image/png'));
          if (barcode) break;
        }
      }

      if (barcode) {
        statusHtml = '<span style="color:#16a34a; font-weight:700;">\u2705 Detected</span>';
      } else {
        statusHtml = '<span style="color:#dc2626; font-weight:700;">\u274c No barcode</span>';
      }
    } catch {
      statusHtml = '<span style="color:#dc2626; font-weight:700;">\u274c No barcode</span>';
    }

    // Lookup name
    let productName = '';
    let category = '';
    if (barcode) {
      try {
        const info = await lookupBarcodeOpenFoodFacts(barcode);
        if (info && info.name) {
          productName = info.name;
          category = info.category || '';
          nameHtml = `<span style="color:#0f172a; font-weight:600;">${info.name}</span>`;
        } else {
          nameHtml = '<span style="color:#94a3b8;">Not found</span>';
        }
      } catch {
        nameHtml = '<span style="color:#94a3b8;">Lookup failed</span>';
      }
    }

    const row = { barcode, name: productName, category, price: 0, tax: 0, stock: 0, cost: 0, unit_type: 'unit', _file: file.name, _ok: !!barcode };
    rows.push(row);

    if (body) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #f1f5f9';
      tr.innerHTML = `
        <td style="padding:7px 10px; width:52px;"><img src="${thumbUrl}" style="width:44px; height:36px; object-fit:contain; border-radius:4px; border:1px solid #e2e8f0;"></td>
        <td style="padding:7px 10px; font-family:monospace; font-weight:700; color:#1e40af;">${barcode || '<span style="color:#94a3b8;">\u2014</span>'}</td>
        <td style="padding:7px 10px;">${nameHtml}</td>
        <td style="padding:7px 10px;">${statusHtml}</td>`;
      body.appendChild(tr);
    }
  }

  if (progressDiv) progressDiv.style.display = 'none';
  if (resultsDiv) resultsDiv.style.display = '';

  const good = rows.filter(r => r._ok);
  if (title) title.textContent = `${files.length} image${files.length > 1 ? 's' : ''} scanned \u2014 ${good.length} barcode${good.length !== 1 ? 's' : ''} found`;

  window._bulkImgRows = good;
  if (window._bulkActiveTab === 'img') {
    window._bulkUploadRows = good.map(r => ({
      barcode: r.barcode, name: r.name || r.barcode, price: 0, category: r.category || '',
      tax: 0, stock: 0, cost: 0, unit_type: 'unit'
    }));
  }

  if (importBtn) {
    importBtn.disabled = good.length === 0;
    importBtn.style.opacity = good.length > 0 ? '1' : '0.5';
  }
}


function switchBulkTab(tab) {
  const csvTab = document.getElementById('bulkTabCsv');
  const imgTab = document.getElementById('bulkTabImg');
  const csvPanel = document.getElementById('bulkPanelCsv');
  const imgPanel = document.getElementById('bulkPanelImg');
  if (!csvTab || !imgTab) return;
  if (tab === 'csv') {
    csvTab.style.borderBottomColor = '#2563eb'; csvTab.style.color = '#2563eb';
    imgTab.style.borderBottomColor = 'transparent'; imgTab.style.color = '#64748b';
    if (csvPanel) csvPanel.style.display = '';
    if (imgPanel) imgPanel.style.display = 'none';
    // enable import btn only if csv rows loaded
    const importBtn = document.getElementById('bulkUploadImportBtn');
    if (importBtn) {
      const hasRows = window._bulkUploadRows && window._bulkUploadRows.length > 0;
      importBtn.disabled = !hasRows;
      importBtn.style.opacity = hasRows ? '1' : '0.5';
    }
  } else {
    imgTab.style.borderBottomColor = '#7c3aed'; imgTab.style.color = '#7c3aed';
    csvTab.style.borderBottomColor = 'transparent'; csvTab.style.color = '#64748b';
    if (imgPanel) imgPanel.style.display = '';
    if (csvPanel) csvPanel.style.display = 'none';
    // enable import btn only if image scan rows loaded
    const importBtn = document.getElementById('bulkUploadImportBtn');
    if (importBtn) {
      const hasRows = window._bulkImgRows && window._bulkImgRows.length > 0;
      importBtn.disabled = !hasRows;
      importBtn.style.opacity = hasRows ? '1' : '0.5';
    }
  }
  window._bulkActiveTab = tab;
}

function clearBulkImages() {
  window._bulkImgRows = [];
  const body = document.getElementById('imgScanBody');
  if (body) body.innerHTML = '';
  const results = document.getElementById('imgScanResults');
  if (results) results.style.display = 'none';
  const progress = document.getElementById('imgScanProgress');
  if (progress) progress.style.display = 'none';
  const fileInput = document.getElementById('bulkImgFileInput');
  if (fileInput) fileInput.value = '';
  const importBtn = document.getElementById('bulkUploadImportBtn');
  if (importBtn) { importBtn.disabled = true; importBtn.style.opacity = '0.5'; }
}

async function _loadZXing() {
  if (window.ZXing) return window.ZXing;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function handleBulkImageFiles(files) {
  if (!files || !files.length) return;
  window._bulkImgRows = [];
  const resultsDiv = document.getElementById('imgScanResults');
  const progressDiv = document.getElementById('imgScanProgress');
  const progressLabel = document.getElementById('imgScanProgressLabel');
  const progressCount = document.getElementById('imgScanProgressCount');
  const progressBar = document.getElementById('imgScanProgressBar');
  const body = document.getElementById('imgScanBody');
  const title = document.getElementById('imgScanTitle');
  const importBtn = document.getElementById('bulkUploadImportBtn');

  if (body) body.innerHTML = '';
  if (resultsDiv) resultsDiv.style.display = 'none';
  if (progressDiv) progressDiv.style.display = '';
  if (progressLabel) progressLabel.textContent = 'Loading barcode scanner…';
  if (progressCount) progressCount.textContent = `0 / ${files.length}`;
  if (progressBar) progressBar.style.width = '0%';

  let ZXing;
  try {
    ZXing = await _loadZXing();
  } catch {
    alert('Could not load barcode scanner library. Check your internet connection.');
    if (progressDiv) progressDiv.style.display = 'none';
    return;
  }

  const codeReader = new ZXing.BrowserMultiFormatReader();

  let done = 0;
  const rows = [];

  for (const file of Array.from(files)) {
    done++;
    if (progressLabel) progressLabel.textContent = `Scanning ${file.name}…`;
    if (progressCount) progressCount.textContent = `${done} / ${files.length}`;
    if (progressBar) progressBar.style.width = `${Math.round(done / files.length * 100)}%`;

    let barcode = null;
    let statusHtml = '';
    let nameHtml = '<span style="color:#94a3b8">—</span>';
    let thumbUrl = '';

    try {
      thumbUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = e => res(e.target.result);
        fr.readAsDataURL(file);
      });

      // Draw to canvas at multiple scales to improve decode reliability
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = thumbUrl;
      });

      // Try decoding at 100%, 200% and 50% scale until one succeeds
      let result = null;
      for (const scale of [1, 2, 0.5]) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const lum = new ZXing.RGBLuminanceSource(imageData.data, canvas.width, canvas.height);
          const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
          const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
          const fmt = new ZXing.MultiFormatReader();
          fmt.setHints(hints);
          result = fmt.decode(bitmap);
          if (result) break;
        } catch { /* try next scale */ }
      }

      if (!result) {
        // Fallback: also try via BrowserMultiFormatReader on a temp img element
        try {
          const tmpImg = document.createElement('img');
          tmpImg.src = thumbUrl;
          await new Promise(r => { tmpImg.onload = r; tmpImg.onerror = r; });
          result = await codeReader.decodeFromImageElement(tmpImg);
        } catch { /* still nothing */ }
      }

      if (result) {
        barcode = result.getText();
        statusHtml = '<span style="color:#16a34a; font-weight:700;">✅ Detected</span>';
      } else {
        throw new Error('no result');
      }
    } catch {
      statusHtml = '<span style="color:#dc2626; font-weight:700;">❌ No barcode</span>';
    }

    // Lookup name
    let productName = '';
    let category = '';
    if (barcode) {
      try {
        const info = await lookupBarcodeOpenFoodFacts(barcode);
        if (info && info.name) {
          productName = info.name;
          category = info.category || '';
          nameHtml = `<span style="color:#0f172a; font-weight:600;">${info.name}</span>`;
        } else {
          nameHtml = '<span style="color:#94a3b8;">Not found</span>';
        }
      } catch {
        nameHtml = '<span style="color:#94a3b8;">Lookup failed</span>';
      }
    }

    const row = { barcode, name: productName, category, price: 0, tax: 0, stock: 0, cost: 0, unit_type: 'unit', _file: file.name, _ok: !!barcode };
    rows.push(row);

    if (body) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #f1f5f9';
      tr.innerHTML = `
        <td style="padding:7px 10px; width:52px;"><img src="${thumbUrl}" style="width:44px; height:36px; object-fit:contain; border-radius:4px; border:1px solid #e2e8f0;"></td>
        <td style="padding:7px 10px; font-family:monospace; font-weight:700; color:#1e40af;">${barcode || '<span style="color:#94a3b8;">—</span>'}</td>
        <td style="padding:7px 10px;">${nameHtml}</td>
        <td style="padding:7px 10px;">${statusHtml}</td>`;
      body.appendChild(tr);
    }
  }

  if (progressDiv) progressDiv.style.display = 'none';
  if (resultsDiv) resultsDiv.style.display = '';

  const good = rows.filter(r => r._ok);
  if (title) title.textContent = `${files.length} image${files.length > 1 ? 's' : ''} scanned — ${good.length} barcode${good.length !== 1 ? 's' : ''} found`;

  // Store only valid rows for import; map to bulkUploadRows format
  window._bulkImgRows = good;
  // Also populate _bulkUploadRows so startBulkUpload() can use them
  if (window._bulkActiveTab === 'img') {
    window._bulkUploadRows = good.map(r => ({
      barcode: r.barcode, name: r.name || r.barcode, price: 0, category: r.category || '',
      tax: 0, stock: 0, cost: 0, unit_type: 'unit'
    }));
  }

  if (importBtn) {
    importBtn.disabled = good.length === 0;
    importBtn.style.opacity = good.length > 0 ? '1' : '0.5';
  }

  // wire image dropzone drag-and-drop
  const dz = document.getElementById('imgDropzone');
  if (dz && !dz._dzWired) {
    dz._dzWired = true;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.background = '#ede9fe'; });
    dz.addEventListener('dragleave', () => { dz.style.background = '#faf5ff'; });
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.style.background = '#faf5ff';
      const dropped = e.dataTransfer.files;
      if (dropped && dropped.length) handleBulkImageFiles(dropped);
    });
  }
}

// ============== PRODUCTS VIEW ==============
const productsPager = { page: 1, perPage: 50, query: '' };
const selectedProductIds = new Set();

function setupProductHandlers() {
  document.getElementById('addProductBtn')?.addEventListener('click', () => {
    openProductModal();
  });

  document.getElementById('bulkUploadBarcodesBtn')?.addEventListener('click', () => {
    openBulkUploadOverlay();
  });

  document.getElementById('addCategoryBtnHeader')?.addEventListener('click', () => {
    if (hasPermission('categories')) {
      openCategoryModal();
    }
  });

  // Open barcode list section
  const openBarcodeBtn = document.getElementById('openBarcodeListBtn');
  if (openBarcodeBtn && !openBarcodeBtn.dataset.listenerAttached) {
    openBarcodeBtn.dataset.listenerAttached = '1';
    openBarcodeBtn.addEventListener('click', () => {
      navigateToView('barcodes');
    });
  }
  
  // Debounce search to avoid re-rendering on every keystroke (helps on low-end Windows PCs)
  // Note: productSearch ID exists in more than one view; scope to Products view.
  let productSearchTimer = null;
  const productSearchInput = document.querySelector('#productsView #productsSearch');
  productSearchInput?.addEventListener('input', (e) => {
    const value = e.target.value;
    if (productSearchTimer) clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(() => filterProducts(value), 120);
  });

  // Scan-to-add in Products view:
  // If cashier scans a barcode into the Products search field and presses Enter (scanner sends Enter),
  // open Edit Product if it exists; otherwise offer to create a new product with that barcode.
  productSearchInput?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const raw = String(productSearchInput.value || '').trim();
    const digitsOnly = raw.replace(/\s+/g, '');
    const looksLikeBarcode = /^\d{6,}$/.test(digitsOnly);
    if (!looksLikeBarcode) return;

    e.preventDefault();

    try {
      const existing = await window.api.getProductByBarcode(digitsOnly);
      if (existing && existing.id) {
        // Open edit modal directly
        await editProduct(existing.id);
        return;
      }
    } catch {
      // ignore
    }

    const ok = await showConfirmDialog({
      title: 'Product not found',
      message: `Barcode: ${digitsOnly}\n\nCreate a new product with this barcode?`,
      confirmText: 'Create Product',
      cancelText: 'Cancel'
    });
    if (!ok) return;

    await openProductModal(null, null, null);
    try {
      const barcodeEl = document.getElementById('productBarcode');
      if (barcodeEl) barcodeEl.value = digitsOnly;
      const nameEl = document.getElementById('productName');
      if (nameEl) {
        nameEl.focus();
        nameEl.select?.();
      }
    } catch {
      // ignore
    }
  });
  
  document.getElementById('productForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProduct();
  });

  // Print barcode label from the Product modal
  const printBtn = document.getElementById('productPrintLabelBtn');
  if (printBtn && !printBtn.dataset.listenerAttached) {
    printBtn.dataset.listenerAttached = '1';
    printBtn.addEventListener('click', async () => {
      try {
        if (!window.api.printBarcodeLabel) {
          showAlert('Barcode label printing is not available in this build', 'error', 'Print');
          return;
        }

        const barcodeRaw = (document.getElementById('productBarcode')?.value || '').toString();
        const barcode = barcodeRaw.replace(/\s+/g, '').trim();
        const name = (document.getElementById('productName')?.value || '').toString().trim();
        const currencySymbol = systemSettings?.currency_symbol || '€';
        const priceText = (document.getElementById('productSalePrice')?.value || '').toString().trim() || (document.getElementById('productRegularPrice')?.value || '').toString().trim();
        const price = parseFloat(String(priceText).replace(',', '.'));

        if (!barcode) {
          showAlert('Please enter a barcode first', 'warning', 'Print');
          return;
        }
        if (!name) {
          showAlert('Please enter a product name first', 'warning', 'Print');
          return;
        }
        if (!Number.isFinite(price) || price < 0) {
          showAlert('Please enter a valid price first', 'warning', 'Print');
          return;
        }

        const qty = await promptForBarcodeLabelQuantity({ title: 'Print Barcode Labels', defaultQty: 1, maxQty: 50 });
        if (!qty) return;

        await printBarcodeLabelMultipleTimes({ barcode, name, price, currencySymbol, quantity: qty });
        showAlert('Barcode label(s) sent to printer', 'success', 'Print');
      } catch (e) {
        showAlert(String(e?.message || e || 'Failed to print label'), 'error', 'Print');
      }
    });
  }

  // Bulk delete (Products)
  const bulkBtn = document.getElementById('bulkDeleteProductsBtn');
  if (bulkBtn && !bulkBtn.dataset.listenerAttached) {
    bulkBtn.dataset.listenerAttached = '1';
    bulkBtn.addEventListener('click', async () => {
      if (selectedProductIds.size === 0) return;
      const ok = await showConfirmDialog({
        title: 'Delete Selected Products?',
        message: `You selected ${selectedProductIds.size} product(s).\n\nProducts already used in sales will be removed from the Products list but kept in reports.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger'
      });
      if (!ok) return;

      let archivedCount = 0;
      let deletedCount = 0;
      const ids = Array.from(selectedProductIds);

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
          const res = await window.api.deleteProduct(id);
          if (res?.archived) archivedCount++;
          else deletedCount++;
        } catch {
          // ignore per-item failure
        }

        // Yield occasionally to keep UI responsive
        if (i % 25 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      selectedProductIds.clear();
      await loadProductsView();
      showAlert(`Deleted: ${deletedCount}. Removed/Archived: ${archivedCount}.`, 'success');
    });
  }

  // Selection handlers (Products) - event delegation
  const productsTable = document.getElementById('productsTable');
  if (productsTable && !productsTable.dataset.selectionAttached) {
    productsTable.dataset.selectionAttached = '1';
    productsTable.addEventListener('change', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.id === 'productsSelectAll') {
        const visible = Array.from(document.querySelectorAll('#productsTable tbody input.product-row-select'));
        for (const cb of visible) {
          cb.checked = t.checked;
          const id = parseInt(cb.dataset.productId, 10);
          if (!Number.isFinite(id)) continue;
          if (t.checked) selectedProductIds.add(id);
          else selectedProductIds.delete(id);
        }
        updateProductsBulkUi();
        return;
      }

      if (t.classList.contains('product-checkout-toggle')) {
        const id = parseInt(t.dataset.productId, 10);
        if (!Number.isFinite(id)) return;
        try {
          if (window.api?.setProductShowInCheckout) {
            await window.api.setProductShowInCheckout(id, t.checked);
          }
          const p = allProducts?.find?.(x => x?.id === id);
          if (p) p.show_in_checkout = t.checked ? 1 : 0;
          // If Checkout is currently active, refresh tabs + grid.
          if (isCheckoutViewActive()) {
            try { await loadCategoryTabs(); } catch { /* ignore */ }
            try { await displayQuickProducts('', selectedCategory, selectedSubcategory); } catch { /* ignore */ }
          }
        } catch {
          // Revert toggle on failure
          t.checked = !t.checked;
          showAlert('Failed to update checkout visibility', 'error');
        }
        return;
      }

      if (t.classList.contains('product-row-select')) {
        const id = parseInt(t.dataset.productId, 10);
        if (!Number.isFinite(id)) return;
        if (t.checked) selectedProductIds.add(id);
        else selectedProductIds.delete(id);
        updateProductsBulkUi();
      }
    });
  }

  // Attach unit type toggle listener once (openProductModal is called many times)
  const unitTypeSelect = document.getElementById('productUnitType');
  if (unitTypeSelect && !unitTypeSelect.dataset.listenerAttached) {
    unitTypeSelect.dataset.listenerAttached = '1';
    unitTypeSelect.addEventListener('change', (e) => {
      toggleUnitFields(e.target.value);
    });
  }
}

async function loadProductsView() {
  // Products view doesn't need images; base64 image data can make it slow.
  allProducts = await (window.api.getAllProductsLite ? window.api.getAllProductsLite() : window.api.getAllProducts());

  // Cache lowercase fields for faster filtering
  for (const p of allProducts) {
    if (!p) continue;
    if (typeof p._lcName !== 'string') p._lcName = String(p.name || '').toLowerCase();
    if (typeof p._lcCategory !== 'string') p._lcCategory = String(p.category || '').toLowerCase();
    if (typeof p._lcBarcode !== 'string') p._lcBarcode = String(p.barcode || '').toLowerCase();
  }

  // Reset pagination when loading the view
  productsPager.page = 1;
  productsPager.query = String(document.querySelector('#productsView #productsSearch')?.value || '').trim();
  selectedProductIds.clear();
  displayProducts(allProducts);
}

function isInternalBarcode(barcode) {
  const bc = String(barcode || '').trim();
  // Internal codes are generated by database.js as POS-<...>.
  return bc.startsWith('POS-');
}

function formatBarcodeForDisplay(barcode) {
  const bc = String(barcode || '').trim();
  if (!bc) return '';
  return isInternalBarcode(bc) ? '' : bc;
}

function displayProducts(products) {
  const tbody = document.querySelector('#productsTable tbody');
  const currencySymbol = systemSettings?.currency_symbol || '€';

  // Pagination UI
  ensurePaginationBar({
    containerSelector: '#productsView .table-container',
    barId: 'productsPagination',
    onPrev: () => {
      productsPager.page = Math.max(1, productsPager.page - 1);
      displayProducts(allProducts);
    },
    onNext: () => {
      productsPager.page = productsPager.page + 1;
      displayProducts(allProducts);
    },
    onPerPage: (v) => {
      productsPager.perPage = v;
      productsPager.page = 1;
      displayProducts(allProducts);
    }
  });

  const q = String(productsPager.query || '').trim().toLowerCase();
  let filtered = q
    ? products.filter(p => (p._lcName || '').includes(q) || (p._lcCategory || '').includes(q) || (p._lcBarcode || '').includes(q))
    : products;

  // Sort newest first (created_at desc, then id desc)
  try {
    filtered = filtered.slice().sort((a, b) => {
      const aTime = Date.parse(a?.created_at || '') || 0;
      const bTime = Date.parse(b?.created_at || '') || 0;
      if (aTime !== bTime) return bTime - aTime;
      const aId = Number(a?.id) || 0;
      const bId = Number(b?.id) || 0;
      return bId - aId;
    });
  } catch {
    // ignore
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / productsPager.perPage));
  productsPager.page = Math.min(Math.max(1, productsPager.page), totalPages);
  const startIndex = (productsPager.page - 1) * productsPager.perPage;
  const limited = filtered.slice(startIndex, startIndex + productsPager.perPage);
  
  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><div class="icon">📦</div><p>No products found</p></td></tr>';
    updatePaginationBar('productsPagination', { page: 1, perPage: productsPager.perPage, total: 0 });
    updateProductsBulkUi([]);
    return;
  }
  
  tbody.innerHTML = limited.map(product => {
    let statusClass = 'status-in-stock';
    let statusText = 'In Stock';
    
    if (product.stock === 0) {
      statusClass = 'status-out-of-stock';
      statusText = 'Out of Stock';
    } else if (product.stock <= product.min_stock) {
      statusClass = 'status-low-stock';
      statusText = 'Low Stock';
    }
    
    // Determine unit type
    const isWeightBased = product.unit_type === 'weight' || !product.unit_type;
    
    // Get specific unit
    let unitLabel = '';
    let unitTypeDisplay = '';
    if (isWeightBased) {
      const weightUnit = product.weight_unit || 'kg';
      unitLabel = `/${weightUnit}`;
      unitTypeDisplay = `<span style="color: #3b82f6; font-weight: 600;">⚖️ Weight (${weightUnit})</span>`;
    } else {
      const quantityUnit = product.quantity_unit || 'piece';
      unitLabel = `/${quantityUnit}`;
      unitTypeDisplay = `<span style="color: #10b981; font-weight: 600;">🔢 ${quantityUnit.charAt(0).toUpperCase() + quantityUnit.slice(1)}</span>`;
    }
    
    const hasDiscount = product.sale_price || product.discount_percent > 0;
    const priceDisplay = hasDiscount 
      ? `<span style="text-decoration: line-through; color: #999;">${currencySymbol}${(product.regular_price || product.price).toFixed(2)}</span> <span style="color: #e53e3e; font-weight: 700;">${currencySymbol}${product.price.toFixed(2)}${unitLabel}</span>`
      : `${currencySymbol}${product.price.toFixed(2)}${unitLabel}`;
    
    // VAT is product-level
    const pTax = Number(product.tax_rate);
    const taxDisplay = `${(Number.isFinite(pTax) ? (pTax * 100) : 0).toFixed(0)}%`;
    
    return `
      <tr>
        <td>
          <div class="name-select-cell">
            <input class="product-row-select table-select" type="checkbox" data-product-id="${product.id}" ${selectedProductIds.has(product.id) ? 'checked' : ''} aria-label="Select product">
            <span>${product.name}</span>
          </div>
        </td>
        <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; color: #334155;">${formatBarcodeForDisplay(product.barcode)}</td>
        <td>${(product.category && String(product.category).trim()) ? product.category : '—'}</td>
        <td>${unitTypeDisplay}</td>
        <td>${priceDisplay}</td>
        <td>${taxDisplay}</td>
        <td>${product.stock}</td>
        <td style="text-align:center;">
          <input class="product-checkout-toggle" type="checkbox" data-product-id="${product.id}" ${isProductEnabledForCheckout(product) ? 'checked' : ''} aria-label="Show in checkout">
        </td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>
          <button class="action-btn" onclick="editProduct(${product.id})" title="Edit">✏️</button>
          <button class="action-btn" onclick="showProductBarcode(${product.id})" title="Show Barcode">▦</button>
          <button class="action-btn" onclick="printProductLabel(${product.id})" title="Print Label">🏷️</button>
          <button class="action-btn delete-btn" onclick="deleteProduct(${product.id})" title="Delete">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  updatePaginationBar('productsPagination', { page: productsPager.page, perPage: productsPager.perPage, total });
  updateProductsBulkUi(limited);
}

function promptForBarcodeLabelQuantity({ title = 'Print Labels', defaultQty = 1, maxQty = 50 } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('barcodeLabelQtyOverlay');
    if (existing) {
      try { existing.remove(); } catch { /* ignore */ }
    }

    const overlay = document.createElement('div');
    overlay.id = 'barcodeLabelQtyOverlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.55)',
      'padding:24px 0 330px 0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'z-index:10001'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(520px, 92vw)',
      'background:#fff',
      'border-radius:22px',
      'box-shadow:0 18px 60px rgba(0,0,0,0.35)',
      'padding:26px 22px',
      'font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial'
    ].join(';');

    const safeMax = Number.isFinite(Number(maxQty)) ? Math.max(1, Math.min(999, Math.floor(Number(maxQty)))) : 50;
    const safeDefault = Number.isFinite(Number(defaultQty)) ? Math.max(1, Math.min(safeMax, Math.floor(Number(defaultQty)))) : 1;

    card.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:26px; font-weight:900; color:#0f172a; margin-bottom:6px;">${String(title || 'Print Labels')}</div>
        <div style="font-size:14px; color:#64748b; margin-bottom:16px;">How many labels do you want to print?</div>

        <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:18px;">
          <input id="barcodeLabelQtyInput" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done"
            value="${safeDefault}" placeholder="1"
            style="width:160px; font-size:26px; text-align:center; padding:14px 12px; border-radius:14px; border:2px solid #cbd5e1; outline:none; font-weight:900;" />
          <div style="font-size:13px; font-weight:900; color:#64748b;">max ${safeMax}</div>
        </div>

        <div style="display:flex; gap:14px; justify-content:center;">
          <button id="barcodeLabelQtyCancel" style="flex:1; max-width:220px; border:none; border-radius:16px; padding:16px 14px; font-size:18px; font-weight:900; background:#94a3b8; color:#fff;">Cancel</button>
          <button id="barcodeLabelQtyOk" style="flex:1; max-width:220px; border:none; border-radius:16px; padding:16px 14px; font-size:18px; font-weight:900; background:#0ea5e9; color:#fff;">Print</button>
        </div>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const input = card.querySelector('#barcodeLabelQtyInput');
    const okBtn = card.querySelector('#barcodeLabelQtyOk');
    const cancelBtn = card.querySelector('#barcodeLabelQtyCancel');

    const cleanup = () => {
      try { overlay.remove(); } catch { /* ignore */ }
    };

    const close = (value) => {
      cleanup();
      resolve(value);
    };

    const parseQty = () => {
      const raw = String(input?.value || '').trim();
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      return Math.max(1, Math.min(safeMax, n));
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    cancelBtn?.addEventListener('click', () => close(null), { once: true });
    okBtn?.addEventListener('click', () => {
      const qty = parseQty();
      if (!qty) {
        try { input?.focus?.(); } catch { /* ignore */ }
        return;
      }
      close(qty);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        okBtn?.click?.();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    });

    // Force on-screen keyboard to open (focus is programmatic)
    try { window.__virtualKeyboardForceOpen = true; } catch { /* ignore */ }
    setTimeout(() => {
      try {
        window.__virtualKeyboardForceOpen = true;
        input?.focus?.();
        input?.select?.();
      } catch {
        // ignore
      }
    }, 0);
  });
}

async function printBarcodeLabelMultipleTimes({ barcode, name, price, currencySymbol, quantity }) {
  const qty = Math.max(1, Math.min(999, parseInt(quantity, 10) || 1));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < qty; i++) {
    const res = await window.api.printBarcodeLabel({
      barcode,
      name,
      price,
      currencySymbol,
      // Force HTML so the printer uses the compact label page size/layout.
      labelPrintMode: 'html',
      labelLayout: 'pvp-right',
      labelMmWidth: 57,
      labelMmHeight: 32
    });
    if (res && res.success === false) {
      throw new Error(res.error || res.message || 'Failed to print label');
    }
    await sleep(180);
  }
}

// Print label from Products table action
async function printProductLabel(productId) {
  try {
    if (!window.api.printBarcodeLabel) {
      showAlert('Barcode label printing is not available in this build', 'error', 'Print');
      return;
    }
    const id = Number(productId);
    if (!Number.isFinite(id)) return;

    // Prefer full record to ensure we get barcode
    let product = allProducts.find(p => p && p.id === id) || null;
    if (window.api.getProductById) {
      try {
        const full = await window.api.getProductById(id);
        if (full) product = full;
      } catch {
        // ignore
      }
    }

    const barcode = String(product?.barcode || '').replace(/\s+/g, '').trim();
    if (!barcode) {
      showAlert('This product has no barcode', 'warning', 'Print');
      return;
    }

    const name = String(product?.name || '').trim();
    const price = Number(product?.price);
    const currencySymbol = systemSettings?.currency_symbol || '€';

    const qty = await promptForBarcodeLabelQuantity({ title: 'Print Barcode Labels', defaultQty: 1, maxQty: 50 });
    if (!qty) return;

    await printBarcodeLabelMultipleTimes({ barcode, name, price, currencySymbol, quantity: qty });
    showAlert('Barcode label(s) sent to printer', 'success', 'Print');
  } catch (e) {
    showAlert(String(e?.message || e || 'Failed to print label'), 'error', 'Print');
  }
}

async function showProductBarcode(productId) {
  try {
    const id = Number(productId);
    if (!Number.isFinite(id)) return;

    // Prefer full record to ensure we get barcode
    let product = allProducts.find(p => p && p.id === id) || null;
    if (window.api.getProductById) {
      try {
        const full = await window.api.getProductById(id);
        if (full) product = full;
      } catch {
        // ignore
      }
    }

    const barcode = String(product?.barcode || '').replace(/\s+/g, '').trim();
    if (!barcode) {
      showAlert('This product has no barcode', 'warning');
      return;
    }

    showBarcodeOverlay({ barcode, name: product?.name || '' });
  } catch (e) {
    showAlert(String(e?.message || e || 'Failed to show barcode'), 'error');
  }
}

function updateProductsBulkUi(visibleRows = null) {
  const bulkBtn = document.getElementById('bulkDeleteProductsBtn');
  if (bulkBtn) bulkBtn.disabled = selectedProductIds.size === 0;

  const selectAll = document.getElementById('productsSelectAll');
  if (!selectAll) return;
  const visible = visibleRows
    ? visibleRows.map(p => p.id)
    : Array.from(document.querySelectorAll('#productsTable tbody input.product-row-select')).map(cb => parseInt(cb.dataset.productId, 10)).filter(Number.isFinite);

  if (visible.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  const selectedVisible = visible.filter(id => selectedProductIds.has(id)).length;
  selectAll.checked = selectedVisible === visible.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
}
function filterProducts(query) {
  productsPager.query = String(query || '').trim();
  productsPager.page = 1;
  displayProducts(allProducts);
}

// ============== CATEGORIES PAGINATION (Admin) ==============
const categoriesPager = { page: 1, perPage: 50 };
let categoriesManagementList = [];
const selectedCategoryIds = new Set();

async function openProductModal(product = null, categoryId = null, categoryName = null, options = {}) {
  const modal = document.getElementById('productModal');
  const form = document.getElementById('productForm');
  const title = document.getElementById('productModalTitle');

  // Price-only mode (used from Checkout): hide every field except the prices.
  // Hidden fields keep the product's current values, so saving leaves them unchanged.
  const priceOnly = !!(options && options.priceOnly && product);
  modal.classList.toggle('price-only-mode', priceOnly);
  form.noValidate = priceOnly;
  
  // Load categories first
  await loadCategoriesForProductForm();
  
  if (product) {
    title.textContent = priceOnly ? `Edit Price - ${product.name}` : 'Edit Product';
    document.getElementById('productId').value = product.id;
    {
      const bc = String(product.barcode || '').trim();
      document.getElementById('productBarcode').value = isInternalBarcode(bc) ? '' : bc;
    }
    document.getElementById('productName').value = product.name;
    document.getElementById('productCategory').value = product.category || '';
    document.getElementById('productShowInCheckout').checked = isProductEnabledForCheckout(product);
    document.getElementById('productUnitType').value = product.unit_type || 'quantity';
    document.getElementById('productWeightUnit').value = product.weight_unit || 'kg';
    document.getElementById('productQuantityUnit').value = product.quantity_unit || 'piece';
    document.getElementById('productWeightAmount').value = product.weight_amount || '';
    document.getElementById('productQuantityAmount').value = product.quantity_amount || '';
    document.getElementById('productRegularPrice').value = product.regular_price || product.price;
    document.getElementById('productSalePrice').value = product.sale_price || '';
    document.getElementById('productStock').value = product.stock;

    // VAT is product-level (not category-level)
    try {
      const vatOpts = await getVatPercentOptions();
      const salesPct = Math.round(Number(product.tax_rate || 0) * 100);
      const purchasePct = Math.round(Number(product.purchase_tax_rate ?? product.tax_rate ?? 0) * 100);
      fillVatSelect(document.getElementById('productSalesVat'), vatOpts, salesPct);
      fillVatSelect(document.getElementById('productPurchaseVat'), vatOpts, purchasePct);
      attachVatAddHandler(document.getElementById('productSalesVat'), {
        onAdded: async (createdPct) => {
          const nextOpts = await getVatPercentOptions();
          fillVatSelect(document.getElementById('productSalesVat'), nextOpts, createdPct);
          fillVatSelect(document.getElementById('productPurchaseVat'), nextOpts, document.getElementById('productPurchaseVat')?.value);
        }
      });
      attachVatAddHandler(document.getElementById('productPurchaseVat'), {
        onAdded: async (createdPct) => {
          const nextOpts = await getVatPercentOptions();
          fillVatSelect(document.getElementById('productSalesVat'), nextOpts, document.getElementById('productSalesVat')?.value);
          fillVatSelect(document.getElementById('productPurchaseVat'), nextOpts, createdPct);
        }
      });
    } catch {
      // ignore
    }
    
    // Show appropriate unit field
    toggleUnitFields(product.unit_type || 'quantity');
    
    // Load product image if exists
    if (product.image) {
      document.getElementById('productImageName').textContent = 'Image loaded';
      document.getElementById('productImagePreview').style.display = 'block';
      document.getElementById('productImagePreviewImg').src = product.image;
    } else {
      document.getElementById('productImageName').textContent = 'No image selected';
      document.getElementById('productImagePreview').style.display = 'none';
    }
    
    // Load subcategories for the product's category
    if (product.category) {
      const categories = await window.api.getAllCategories();
      const category = categories.find(c => c.name === product.category);
      if (category) {
        const subcategories = await window.api.getSubcategoriesByCategoryId(category.id);
        const subcategorySelect = document.getElementById('productSubcategory');
        const subcategoryGroup = document.getElementById('productSubcategoryGroup');
        
        if (subcategories && subcategories.length > 0) {
          subcategorySelect.innerHTML = '<option value="">-- No Subcategory --</option>' +
            subcategories.map(sub => `<option value="${sub.name}">${sub.name}</option>`).join('');
          subcategoryGroup.style.display = 'block';
          subcategorySelect.value = product.subcategory || '';
        } else {
          subcategoryGroup.style.display = 'none';
        }
      }
    }
  } else {
    title.textContent = 'Add Product';
    form.reset();
    document.getElementById('productId').value = '';
    document.getElementById('productUnitType').value = 'quantity';
    document.getElementById('productShowInCheckout').checked = false;
    document.getElementById('productWeightUnit').value = 'kg';
    document.getElementById('productQuantityUnit').value = 'piece';
    document.getElementById('productWeightAmount').value = '';
    document.getElementById('productQuantityAmount').value = '';
    document.getElementById('productSubcategoryGroup').style.display = 'none';
    document.getElementById('productImageName').textContent = 'No image selected';
    document.getElementById('productImagePreview').style.display = 'none';
    
    // Pre-select category if provided
    if (categoryName) {
      document.getElementById('productCategory').value = categoryName;
      
      // Load subcategories for the pre-selected category
      if (categoryId) {
        const subcategories = await window.api.getSubcategoriesByCategoryId(categoryId);
        const subcategorySelect = document.getElementById('productSubcategory');
        const subcategoryGroup = document.getElementById('productSubcategoryGroup');
        
        if (subcategories && subcategories.length > 0) {
          subcategorySelect.innerHTML = '<option value="">-- No Subcategory --</option>' +
            subcategories.map(sub => `<option value="${sub.name}">${sub.name}</option>`).join('');
          subcategoryGroup.style.display = 'block';
        } else {
          subcategoryGroup.style.display = 'none';
        }
      }
    }
    if (!categoryName) {
      document.getElementById('productCategory').value = '';
    }
    
    // Barcode-only POS: default to quantity fields.
    toggleUnitFields('quantity');

    // Default VAT presets for new products
    try {
      const vatOpts = await getVatPercentOptions();
      fillVatSelect(document.getElementById('productSalesVat'), vatOpts, 21);
      fillVatSelect(document.getElementById('productPurchaseVat'), vatOpts, 21);
      attachVatAddHandler(document.getElementById('productSalesVat'), {
        onAdded: async (createdPct) => {
          const nextOpts = await getVatPercentOptions();
          fillVatSelect(document.getElementById('productSalesVat'), nextOpts, createdPct);
          fillVatSelect(document.getElementById('productPurchaseVat'), nextOpts, document.getElementById('productPurchaseVat')?.value);
        }
      });
      attachVatAddHandler(document.getElementById('productPurchaseVat'), {
        onAdded: async (createdPct) => {
          const nextOpts = await getVatPercentOptions();
          fillVatSelect(document.getElementById('productSalesVat'), nextOpts, document.getElementById('productSalesVat')?.value);
          fillVatSelect(document.getElementById('productPurchaseVat'), nextOpts, createdPct);
        }
      });
    } catch {
      // ignore
    }
  }
  
  // Unit type change listener is attached once in setupProductHandlers().
  
  modal.classList.add('active');

  // Attach Open Food Facts barcode auto-lookup (safe to call multiple times)
  try { attachBarcodeLookupToProductModal(); } catch { /* ignore */ }

  // Focus barcode first for fast scanning/data entry.
  try {
    const bc = document.getElementById('productBarcode');
    if (bc) {
      setTimeout(() => {
        try {
          bc.focus();
          bc.select?.();
        } catch {
          // ignore
        }
      }, 0);
    }
  } catch {
    // ignore
  }
}

function toggleUnitFields(unitType) {
  const weightUnitGroup = document.getElementById('productWeightUnitGroup');
  const quantityUnitGroup = document.getElementById('productQuantityUnitGroup');
  const weightAmountGroup = document.getElementById('productWeightAmountGroup');
  const quantityAmountGroup = document.getElementById('productQuantityAmountGroup');
  
  if (unitType === 'weight') {
    weightUnitGroup.style.display = 'block';
    weightAmountGroup.style.display = 'block';
    quantityUnitGroup.style.display = 'none';
    quantityAmountGroup.style.display = 'none';
  } else {
    weightUnitGroup.style.display = 'none';
    weightAmountGroup.style.display = 'none';
    quantityUnitGroup.style.display = 'block';
    quantityAmountGroup.style.display = 'block';
  }
}

async function editProduct(id, options = {}) {
  let product = allProducts.find(p => p.id === id);
  if (!product) return;

  // Fetch full record (includes image) only when needed
  if (window.api.getProductById) {
    try {
      const full = await window.api.getProductById(id);
      if (full) product = full;
    } catch {
      // ignore and fall back to cached record
    }
  }

  await openProductModal(product, null, null, options);

  if (options && options.priceOnly) {
    const priceInput = document.getElementById('productRegularPrice');
    try { priceInput?.focus(); priceInput?.select?.(); } catch { /* ignore */ }
  }
}

async function deleteProduct(id) {
  const ok = await showConfirmDialog({
    title: 'Remove Product?',
    message: 'This will remove the product from the Products list.\nSales/Reports history will stay.',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger'
  });

  if (ok) {
    try {
      const res = await window.api.deleteProduct(id);
      if (res && res.archived) {
        showAlert('Product removed from Products list (kept in reports).', 'success');
      }
      await loadProductsView();
    } catch (error) {
      const msg = String(error?.message || error || 'Unknown error');
      showAlert('Failed to delete product: ' + msg, 'error');
    }
  }
}

async function saveProduct() {
  const id = document.getElementById('productId').value;
  const normalizeDecimal = (value) => String(value ?? '').trim().replace(',', '.');
  const parseOptionalMoneyZero = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const n = parseFloat(normalizeDecimal(raw));
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };
  const parseOptionalMoneyNull = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const n = parseFloat(normalizeDecimal(raw));
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  const regularPriceRaw = document.getElementById('productRegularPrice')?.value;
  const salePriceRaw = document.getElementById('productSalePrice')?.value;

  let regularPrice = parseOptionalMoneyZero(regularPriceRaw);
  const salePrice = parseOptionalMoneyNull(salePriceRaw);

  if (regularPrice === null) {
    showAlert('Please enter a valid regular price (0 or more)', 'error', 'Invalid Price');
    return;
  }
  if (salePriceRaw && salePrice === null) {
    showAlert('Please enter a valid sale price (0 or more)', 'error', 'Invalid Price');
    return;
  }
  const selectedCategory = (document.getElementById('productCategory').value || '').toString().trim();
  const unitType = document.getElementById('productUnitType').value;

  // Barcode is optional.
  // Normalize by stripping whitespace.
  let barcode = (document.getElementById('productBarcode').value || '').toString().trim();
  barcode = barcode.replace(/\s+/g, '');
  if (barcode) {
    if (barcode.length < 4 || barcode.length > 64) {
      showAlert('Please enter a valid barcode', 'error', 'Invalid Barcode');
      return;
    }
  }

  // Prevent duplicate barcodes (DB has a UNIQUE constraint, but this gives a nicer message).
  try {
    if (barcode && typeof window.api.getProductByBarcode === 'function') {
      const existing = await window.api.getProductByBarcode(barcode);
      const currentId = id ? parseInt(id, 10) : null;
      if (existing && existing.id && (!currentId || existing.id !== currentId)) {
        showAlert(`Barcode already exists for: ${existing.name || 'another product'}`, 'error', 'Duplicate Barcode');
        return;
      }
    }
  } catch {
    // ignore duplicate check failure; DB will still enforce uniqueness
  }
  
  // Calculate final price
  // - If sale price is provided (including 0), use it.
  // - If regular price is empty, it becomes 0.
  let finalPrice = regularPrice;
  if (salePrice !== null) {
    finalPrice = salePrice;
    // If user only filled sale price and left regular empty, keep regular aligned.
    if (!String(regularPriceRaw ?? '').trim()) {
      regularPrice = salePrice;
    }
  }
  
  // VAT is product-level
  const salesVatPctRaw = Number(document.getElementById('productSalesVat')?.value);
  const purchaseVatPctRaw = Number(document.getElementById('productPurchaseVat')?.value);
  if (!Number.isFinite(salesVatPctRaw) || salesVatPctRaw < 0 || salesVatPctRaw > 100) {
    showAlert('Please select a valid IVA de venta', 'error', 'VAT');
    return;
  }
  if (!Number.isFinite(purchaseVatPctRaw) || purchaseVatPctRaw < 0 || purchaseVatPctRaw > 100) {
    showAlert('Please select a valid IVA de compra', 'error', 'VAT');
    return;
  }
  const taxRate = salesVatPctRaw / 100;
  const purchaseTaxRate = purchaseVatPctRaw / 100;
  
  // Get image if selected
  const imageFile = document.getElementById('productImage').files[0];
  let imageData = null;
  let existingProduct = null;
  
  if (imageFile) {
    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const compressToThumbnail = async (file) => {
      const originalDataUrl = await readFileAsDataUrl(file);
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = originalDataUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const maxDim = 256;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return originalDataUrl;

        // Fill background to avoid black transparency when converting PNG -> JPEG
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.78);
        return (typeof jpegDataUrl === 'string' && jpegDataUrl.startsWith('data:image/')) ? jpegDataUrl : originalDataUrl;
      } catch {
        return originalDataUrl;
      }
    };

    imageData = await compressToThumbnail(imageFile);
  } else if (id) {
    // Keep existing image if editing and no new image selected
    try {
      existingProduct = await (window.api.getProductById ? window.api.getProductById(parseInt(id)) : null);
      if (existingProduct && existingProduct.image) {
        imageData = existingProduct.image;
      }
    } catch {
      // ignore; image stays null
    }
  }
  
  const product = {
    barcode: barcode,
    name: document.getElementById('productName').value,
    description: '',
    category: selectedCategory ? selectedCategory : null,
    subcategory: selectedCategory ? (document.getElementById('productSubcategory').value || null) : null,
    show_in_checkout: document.getElementById('productShowInCheckout')?.checked ? 1 : 0,
    unit_type: unitType,
    weight_unit: document.getElementById('productWeightUnit').value,
    quantity_unit: document.getElementById('productQuantityUnit').value,
    weight_amount: document.getElementById('productWeightAmount').value || null,
    quantity_amount: document.getElementById('productQuantityAmount').value || null,
    regular_price: regularPrice,
    sale_price: salePrice,
    discount_percent: 0,
    price: finalPrice,
    tax_rate: taxRate,
    purchase_tax_rate: purchaseTaxRate,
    cost: 0,
    stock: (() => {
      const n = parseInt(document.getElementById('productStock').value, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    })(),
    min_stock: 5,
    image: imageData
  };
  
  try {
    if (id) {
      await window.api.updateProduct(parseInt(id), product);
    } else {
      await window.api.addProduct(product);
    }
    
    closeModal('productModal');
    await loadProductsView();
    await loadAllProducts();
    displayQuickProducts();
    // Product saved - no popup
  } catch (error) {
    showAlert('Error saving product: ' + error.message, 'error', 'Error');
  }
}

// ============== SALES VIEW ==============
let allSalesData = [];
let currentPaymentFilter = 'all';
let currentSalesFilter = { type: 'today', data: null };

function isPaidLoanSale(sale) {
  return (sale?.payment_method === 'loan')
    && ((sale?.loan_status || '').toString().toLowerCase() === 'paid')
    && !!sale?.loan_payment_method;
}

function getDisplayPaymentMethod(sale) {
  return isPaidLoanSale(sale) ? sale.loan_payment_method : sale.payment_method;
}

function saleMatchesPaymentFilter(sale, filter) {
  // Loan payment events are represented as normal cash/card rows in Sales History.
  // They should match filters by their payment_method.
  if (sale?.__type === 'loan_payment') {
    const pm = (sale?.payment_method || '').toString().toLowerCase();
    if (!filter || filter === 'all') return pm === 'cash' || pm === 'card';
    return pm === String(filter).toLowerCase();
  }

  // BUSINESS RULE: Do not show PARKING/loan-origin sales in Sales History.
  // They are counted/shown only when money is collected (loan payments).
  if ((sale?.payment_method || '').toString().toLowerCase() === 'loan') {
    return false;
  }

  if (!filter || filter === 'all') {
    return true;
  }

  // Cash/Card filters include paid Parking based on settlement method
  if (filter === 'cash' || filter === 'card') {
    if (sale?.payment_method === filter) return true;
    return false;
  }

  return sale?.payment_method === filter;
}

async function loadSalesView() {
  // Initialize with today's sales
  await loadSalesByDateFilter('today');
  
  // Setup date filter handlers
  setupDateFilters();
  
  // Set initial dropdown value
  const dateFilterSelect = document.getElementById('salesDateFilter');
  if (dateFilterSelect) {
    dateFilterSelect.value = 'today';
  }
  
  // Hide custom date range initially
  const customDateRange = document.getElementById('customDateRange');
  if (customDateRange) {
    customDateRange.style.display = 'none';
  }
  
  // Add filter button handlers
  setupPaymentFilters();
  
  // Add print button handler
  const printBtn = document.getElementById('printSalesBtn');
  if (printBtn) {
    printBtn.onclick = () => printFilteredSales();
  }
}

async function loadSalesByDateFilter(filterType, startDate = null, endDate = null) {
  let salesData;
  
  console.log('Loading sales for filter type:', filterType);
  
  // Helper for turning YYYY-MM-DD into an ISO datetime range in the user's locale.
  const ymdToIsoStart = (ymd) => {
    try { return new Date(`${ymd}T00:00:00`).toISOString(); } catch { return null; }
  };
  const ymdToIsoEnd = (ymd) => {
    try { return new Date(`${ymd}T23:59:59`).toISOString(); } catch { return null; }
  };

  let paymentRangeStart = null;
  let paymentRangeEnd = null;

  switch (filterType) {
    case 'today':
      salesData = await window.api.getTodaySales();
      console.log('Today sales data:', salesData);
      currentSalesFilter = { type: 'today', data: salesData };
      try {
        if (window.api?.getBusinessDayRange) {
          const biz = await window.api.getBusinessDayRange('today');
          paymentRangeStart = biz?.startDateTime || null;
          paymentRangeEnd = biz?.endDateTime || null;
        }
      } catch {
        // ignore
      }
      break;
    case 'yesterday':
      if (window.api?.getYesterdaySales) {
        salesData = await window.api.getYesterdaySales();
        currentSalesFilter = { type: 'yesterday', data: salesData };
        try {
          if (window.api?.getBusinessDayRange) {
            const biz = await window.api.getBusinessDayRange('yesterday');
            paymentRangeStart = biz?.startDateTime || null;
            paymentRangeEnd = biz?.endDateTime || null;
          }
        } catch {
          // ignore
        }
      } else {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        salesData = await window.api.getSalesByDateRange(yesterdayStr, yesterdayStr);
        currentSalesFilter = { type: 'yesterday', data: salesData, startDate: yesterdayStr, endDate: yesterdayStr };
        paymentRangeStart = ymdToIsoStart(yesterdayStr);
        paymentRangeEnd = ymdToIsoEnd(yesterdayStr);
      }
      break;
    case 'week':
      const currentDate = new Date();
      const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const weekStartDate = new Date(currentDate);
      weekStartDate.setDate(currentDate.getDate() - dayOfWeek); // Go to Sunday of this week
      const weekEndDate = new Date(currentDate);
      console.log('Week filter - Start:', weekStartDate.toISOString().split('T')[0], 'End:', weekEndDate.toISOString().split('T')[0]);
      salesData = await window.api.getSalesByDateRange(
        weekStartDate.toISOString().split('T')[0],
        weekEndDate.toISOString().split('T')[0]
      );
      console.log('Week sales data:', salesData);
      currentSalesFilter = { type: 'week', data: salesData, startDate: weekStartDate.toISOString().split('T')[0], endDate: weekEndDate.toISOString().split('T')[0] };
      paymentRangeStart = ymdToIsoStart(currentSalesFilter.startDate);
      paymentRangeEnd = ymdToIsoEnd(currentSalesFilter.endDate);
      break;
    case 'month':
      const today = new Date();
      const monthStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEndDate = new Date(today);
      salesData = await window.api.getSalesByDateRange(
        monthStartDate.toISOString().split('T')[0],
        monthEndDate.toISOString().split('T')[0]
      );
      currentSalesFilter = { type: 'month', data: salesData, startDate: monthStartDate.toISOString().split('T')[0], endDate: monthEndDate.toISOString().split('T')[0] };
      paymentRangeStart = ymdToIsoStart(currentSalesFilter.startDate);
      paymentRangeEnd = ymdToIsoEnd(currentSalesFilter.endDate);
      break;
    case 'year':
      const todayDate = new Date();
      const yearStartDate = new Date(todayDate.getFullYear(), 0, 1); // January 1st of current year
      const yearEndDate = new Date(todayDate);
      console.log('Year filter - Start:', yearStartDate.toISOString().split('T')[0], 'End:', yearEndDate.toISOString().split('T')[0]);
      salesData = await window.api.getSalesByDateRange(
        yearStartDate.toISOString().split('T')[0],
        yearEndDate.toISOString().split('T')[0]
      );
      console.log('Year sales data:', salesData);
      currentSalesFilter = { type: 'year', data: salesData, startDate: yearStartDate.toISOString().split('T')[0], endDate: yearEndDate.toISOString().split('T')[0] };
      paymentRangeStart = ymdToIsoStart(currentSalesFilter.startDate);
      paymentRangeEnd = ymdToIsoEnd(currentSalesFilter.endDate);
      break;
    case 'custom':
      if (!startDate || !endDate) return;
      salesData = await window.api.getSalesByDateRange(startDate, endDate);
      currentSalesFilter = { type: 'custom', data: salesData, startDate, endDate };
      paymentRangeStart = ymdToIsoStart(startDate);
      paymentRangeEnd = ymdToIsoEnd(endDate);
      break;
    default:
      salesData = await window.api.getTodaySales();
      currentSalesFilter = { type: 'today', data: salesData };
  }

  // Merge loan payments into Sales History so PARKING shows only when paid.
  const baseSales = salesData?.sales || [];
  let paymentEntries = [];
  try {
    if (paymentRangeStart && paymentRangeEnd && window.api?.getLoanPaymentsDetailedByDateTimeRange) {
      const paid = await window.api.getLoanPaymentsDetailedByDateTimeRange(paymentRangeStart, paymentRangeEnd, null);
      const rows = Array.isArray(paid) ? paid : [];
      paymentEntries = rows.map((p) => {
        const amt = Number(p?.amount || 0) || 0;
        const pm = (p?.payment_method || '').toString().toLowerCase();
        return {
          __type: 'loan_payment',
          id: `lp_${p?.id ?? ''}`,
          sale_id: p?.sale_id ?? null,
          sale_date: p?.payment_date || new Date().toISOString(),
          subtotal: amt,
          tax: 0,
          total: amt,
          payment_method: pm,
          items: Array.isArray(p?.items) ? p.items : []
        };
      }).filter(r => r.payment_method === 'cash' || r.payment_method === 'card');
    }
  } catch {
    paymentEntries = [];
  }

  allSalesData = [...baseSales, ...paymentEntries]
    .filter(Boolean)
    .sort((a, b) => {
      const at = Date.parse(a?.sale_date || '') || 0;
      const bt = Date.parse(b?.sale_date || '') || 0;
      return bt - at;
    });
  
  // Display filtered sales (this recalculates summary to match the table)
  displayFilteredSales();
}

function setupDateFilters() {
  const dateFilterSelect = document.getElementById('salesDateFilter');
  const customDateRange = document.getElementById('customDateRange');
  const applyBtn = document.getElementById('applySalesDateFilter');
  
  if (dateFilterSelect) {
    dateFilterSelect.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        customDateRange.style.display = 'flex';
      } else {
        customDateRange.style.display = 'none';
        loadSalesByDateFilter(e.target.value);
      }
    });
  }
  
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const startDate = document.getElementById('salesStartDate').value;
      const endDate = document.getElementById('salesEndDate').value;
      if (startDate && endDate) {
        loadSalesByDateFilter('custom', startDate, endDate);
      } else {
        alert('Please select both start and end dates');
      }
    });
  }
}

function calculateSummary(sales) {
  return {
    transaction_count: sales.length,
    total_sales: sales.reduce((sum, sale) => sum + (sale.total || 0), 0),
    subtotal: sales.reduce((sum, sale) => sum + (sale.subtotal || 0), 0),
    tax: sales.reduce((sum, sale) => sum + (sale.tax || 0), 0)
  };
}

function updateSalesSummary(summary, filterType = 'today') {
  const summaryDiv = document.getElementById('todaySummary');
  if (!summaryDiv) return;

  // Cashier (and any role without reports permission) should not see sales totals in the header.
  if (!hasPermission('reports')) {
    summaryDiv.style.display = 'none';
    summaryDiv.innerHTML = '';
    return;
  }

  summaryDiv.style.display = '';
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  let periodText = 'Today\'s';
  switch (filterType) {
    case 'yesterday': periodText = 'Yesterday\'s'; break;
    case 'week': periodText = 'This Week\'s'; break;
    case 'month': periodText = 'This Month\'s'; break;
    case 'year': periodText = 'This Year\'s'; break;
    case 'custom': periodText = 'Filtered'; break;
  }
  
  const gross = Number(summary.total_sales || 0);
  const returnsAmount = Number(summary.returns_amount || 0);
  const net = gross - returnsAmount;

  const refundedCount = Number(summary.refunded_count || 0);
  const netTxnCount = Number.isFinite(Number(summary.net_transaction_count))
    ? Number(summary.net_transaction_count)
    : (Number(summary.transaction_count || 0) - refundedCount);

  summaryDiv.innerHTML = (returnsAmount > 0 || refundedCount > 0)
    ? `${periodText} Sales: <strong>${summary.transaction_count}</strong> transactions | Refunded: <strong>${refundedCount}</strong> | Net txns: <strong>${netTxnCount}</strong> | Gross: <strong>${currencySymbol}${gross.toFixed(2)}</strong> | Returns: <strong>${currencySymbol}${returnsAmount.toFixed(2)}</strong> | Net: <strong>${currencySymbol}${net.toFixed(2)}</strong>`
    : `${periodText} Sales: <strong>${summary.transaction_count}</strong> transactions | Total: <strong>${currencySymbol}${gross.toFixed(2)}</strong>`;
}

function setupPaymentFilters() {
  const filterButtons = document.querySelectorAll('.btn-filter');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Update active state
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update filter and display
      currentPaymentFilter = btn.dataset.filter;
      displayFilteredSales();
    });
  });
}

async function displayFilteredSales() {
  const tbody = document.querySelector('#salesTable tbody');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  // Filter sales based on payment method
  let filteredSales = allSalesData;
  if (currentPaymentFilter !== 'all') {
    filteredSales = allSalesData.filter(sale => saleMatchesPaymentFilter(sale, currentPaymentFilter));
  } else {
    // Apply "All" logic too (hide unpaid loans)
    filteredSales = allSalesData.filter(sale => saleMatchesPaymentFilter(sale, 'all'));
  }

  // Keep the summary in sync with what the table shows (include returns for the same period)
  const baseSummary = calculateSummary(filteredSales);
  try {
    const now = new Date();
    let startDate;
    let endDate;

    if ((currentSalesFilter?.type || 'today') === 'today') {
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      startDate = `${yyyy}-${mm}-${dd}`;
      endDate = startDate;
    } else if (currentSalesFilter?.type === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yyyy = y.getFullYear();
      const mm = String(y.getMonth() + 1).padStart(2, '0');
      const dd = String(y.getDate()).padStart(2, '0');
      startDate = `${yyyy}-${mm}-${dd}`;
      endDate = startDate;
    } else if (currentSalesFilter?.type === 'week' || currentSalesFilter?.type === 'month' || currentSalesFilter?.type === 'year' || currentSalesFilter?.type === 'custom') {
      startDate = currentSalesFilter?.startDate || null;
      endDate = currentSalesFilter?.endDate || null;
    }

    if (startDate && endDate) {
      const returns = await window.api.getReturnsByDateRange(startDate, endDate);
      const parsedReturns = Array.isArray(returns) ? returns : (returns?.returns || []);
      parsedReturns.forEach(r => {
        if (r.items) {
          try {
            r.items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
          } catch {
            r.items = [];
          }
        }
      });

      const deduped = dedupeReturnsByOriginalSaleId(parsedReturns);
      baseSummary.returns_amount = deduped.reduce((sum, r) => sum + getReturnGrossTotal(r), 0);
    }
  } catch {
    // ignore returns summary errors
  }
  updateSalesSummary(baseSummary, currentSalesFilter?.type || 'today');
  
  if (filteredSales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="icon">💰</div><p>No sales found</p></td></tr>';
    return;
  }
  
  // Fetch items for all sales
  const salesWithItems = await Promise.all(
    filteredSales.map(async (sale) => {
      if (sale?.__type === 'loan_payment') {
        if (!Array.isArray(sale.items) || sale.items.length === 0) {
          sale.items = [{ product_name: 'Payment', quantity: 1 }];
        }
        return sale;
      }
      const fullSale = await window.api.getSaleById(sale.id);
      return fullSale;
    })
  );

  // Hide refunded receipts from Sales History
  const visibleSales = salesWithItems.filter(s => !s?.return);
  const refundedCount = salesWithItems.length - visibleSales.length;

  // Update summary counts to match what the table shows
  baseSummary.refunded_count = refundedCount;
  baseSummary.net_transaction_count = visibleSales.length;
  updateSalesSummary(baseSummary, currentSalesFilter?.type || 'today');

  if (visibleSales.length === 0 && salesWithItems.length > 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="icon">↩️</div><p>All sales in this period were refunded</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = visibleSales.map(sale => {
    const date = parseAppDateTimeLoose(sale.sale_date);
    const saleDateTime = formatDateTimeWithDisplayTimeZone(date, 'en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const itemsList = sale.items.map(item => `${item.product_name} (${item.quantity})`).join(', ');
    const itemsShort = itemsList.length > 50 ? itemsList.substring(0, 50) + '...' : itemsList;

    const refundedBadge = sale?.return
      ? ' <span class="status-badge status-refunded">Refunded</span>'
      : '';

    const displayMethod = getDisplayPaymentMethod(sale);

    const loanType = (sale?.loan_customer_type || '').toString().toLowerCase();
    const restaurantName = (sale?.loan_restaurant_name || '').toString().trim();
    const customerName = (sale?.loan_customer_name || '').toString().trim();
    const partyLabel = (loanType === 'restaurant' && restaurantName)
      ? `🍽️ ${restaurantName}`
      : (customerName ? `👤 ${customerName}` : '');

     const titleText = partyLabel ? `${partyLabel} — ${itemsList}` : itemsList;
     const itemsCellHtml = partyLabel
      ? `<div style="font-weight: 800; color: #0f172a;">${partyLabel}${refundedBadge}</div>
        <div style="font-size: 12px; color: #64748b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${itemsShort}</div>`
      : `${itemsShort}${refundedBadge}`;
    
    return `
      <tr>
        <td>${saleDateTime}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${titleText}">
          ${itemsCellHtml}
        </td>
        <td>${currencySymbol}${sale.subtotal.toFixed(2)}</td>
        <td>${currencySymbol}${sale.tax.toFixed(2)}</td>
        <td style="font-weight: 700;">${currencySymbol}${sale.total.toFixed(2)}</td>
        <td><span class="payment-badge payment-${displayMethod}">${String(displayMethod || '').toUpperCase()}</span></td>
        <td>
          ${sale?.__type === 'loan_payment'
            ? (sale?.sale_id ? `<button class="action-btn" onclick="viewSale(${sale.sale_id})" title="View">👁️</button>` : '')
            : `<button class="action-btn" onclick="viewSale(${sale.id})" title="View">👁️</button>`}
        </td>
      </tr>
    `;
  }).join('');
}

async function viewSale(id) {
  const sale = await window.api.getSaleById(id);
  showReceipt(sale);
}

function printFilteredSales() {
  if (!currentSalesFilter?.data) {
    alert('No sales data to print. Please load sales data first.');
    return;
  }

  // Print in Z-report style (thermal/raw)
  printSalesHistoryThermal();
}

function getFilteredSales() {
  return allSalesData.filter(sale => saleMatchesPaymentFilter(sale, currentPaymentFilter));
}

async function printSalesHistoryThermal() {
  try {
    if (!systemSettings) {
      systemSettings = await window.api.getSystemSettings();
    }

    const settings = systemSettings;
    const currencySymbol = settings?.currency_symbol || '€';
    const timeZone = getDisplayTimeZone();
    const printerName = (settings?.printer_name || '').toString().toLowerCase();

    const inferLineWidth = (printer) => {
      const name = String(printer || '').toLowerCase();
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
        || name.includes('tm-t20')
        || name.includes('tm t20')
        || name.includes('tm-t88')
        || name.includes('tm t88');
      return looks80mm ? 48 : 32;
    };

    const LINE_WIDTH = inferLineWidth(printerName);

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

    const formatMoney = (amount) => {
      const num = Number(amount || 0);
      return num.toFixed(2).replace('.', ',') + currencySymbol;
    };

    const parseDateTimeLoose = (value) => {
      if (!value) return new Date();
      const s = String(value).trim();
      // SQLite CURRENT_TIMESTAMP often returns: "YYYY-MM-DD HH:MM:SS" (UTC)
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        return new Date(s.replace(' ', 'T') + 'Z');
      }
      return new Date(s);
    };

    const fmtDateTz = (d) => {
      const dt = (d instanceof Date) ? d : new Date(d);
      try {
        return new Intl.DateTimeFormat('es-ES', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(dt);
      } catch {
        return formatDateWithDisplayTimeZone(dt, 'es-ES');
      }
    };

    const fmtTimeTz = (d, { withSeconds = true } = {}) => {
      const dt = (d instanceof Date) ? d : new Date(d);
      try {
        return new Intl.DateTimeFormat('es-ES', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          second: withSeconds ? '2-digit' : undefined,
          hour12: false
        }).format(dt);
      } catch {
        return formatTimeWithDisplayTimeZone(dt, 'es-ES');
      }
    };

    const parseYmdLocal = (ymd) => {
      const s = String(ymd || '').trim();
      // Treat as local wall time at 00:00 (avoid UTC parsing of YYYY-MM-DD)
      return s ? new Date(`${s}T00:00:00`) : new Date();
    };

    const now = new Date();
    const time = fmtTimeTz(now, { withSeconds: true });

    // Determine title + date range
    let reportTitle = 'VENTAS';
    let dateRange = '';
    switch (currentSalesFilter?.type) {
      case 'today':
        reportTitle = 'VENTAS (HOY)';
        dateRange = fmtDateTz(now);
        break;
      case 'yesterday': {
        reportTitle = 'VENTAS (AYER)';
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        dateRange = fmtDateTz(d);
        break;
      }
      case 'week':
        reportTitle = 'VENTAS (SEMANA)';
        dateRange = `${fmtDateTz(parseYmdLocal(currentSalesFilter.startDate))} - ${fmtDateTz(parseYmdLocal(currentSalesFilter.endDate))}`;
        break;
      case 'month':
        reportTitle = 'VENTAS (MES)';
        dateRange = `${fmtDateTz(parseYmdLocal(currentSalesFilter.startDate))} - ${fmtDateTz(parseYmdLocal(currentSalesFilter.endDate))}`;
        break;
      case 'year':
        reportTitle = 'VENTAS (ANO)';
        dateRange = `${fmtDateTz(parseYmdLocal(currentSalesFilter.startDate))} - ${fmtDateTz(parseYmdLocal(currentSalesFilter.endDate))}`;
        break;
      case 'custom':
        reportTitle = 'VENTAS (RANGO)';
        dateRange = `${fmtDateTz(parseYmdLocal(currentSalesFilter.startDate))} - ${fmtDateTz(parseYmdLocal(currentSalesFilter.endDate))}`;
        break;
      default:
        reportTitle = 'VENTAS';
        dateRange = fmtDateTz(now);
    }

    if (currentPaymentFilter && currentPaymentFilter !== 'all') {
      const suffix = currentPaymentFilter.toUpperCase();
      reportTitle += ` (${suffix})`;
    }

    const filteredSales = getFilteredSales();
    const totals = {
      total: 0,
      subtotal: 0,
      tax: 0,
      cash: 0,
      card: 0,
      split: 0,
      count: filteredSales.length
    };

    for (const sale of filteredSales) {
      const total = Number(sale?.total || 0);
      const subtotal = Number(sale?.subtotal || 0);
      const tax = Number(sale?.tax || 0);
      totals.total += total;
      totals.subtotal += subtotal;
      totals.tax += tax;
      const method = (getDisplayPaymentMethod(sale) || '').toString().toLowerCase();

      if (method === 'cash') totals.cash += total;
      else if (method === 'card') totals.card += total;
      else if ((sale?.payment_method || '').toString().toLowerCase() === 'split') totals.split += total;
    }

    const ESC = '\x1B';
    const GS = '\x1D';
    let receipt = '';
    receipt += ESC + '@';

    receipt += center((settings?.store_name || 'SUPERMARKET POS').toString().toUpperCase()) + '\n';
    receipt += center(reportTitle) + '\n';
    receipt += '='.repeat(LINE_WIDTH) + '\n';
    receipt += `FECHA.....: ${dateRange}\n`;
    receipt += `HORA......: ${time}\n`;
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    receipt += rightLabelValue('TRANSACCIONES', String(totals.count)) + '\n';
    receipt += rightLabelValue('TOTAL', formatMoney(totals.total)) + '\n';
    receipt += rightLabelValue('SUBTOTAL', formatMoney(totals.subtotal)) + '\n';
    receipt += rightLabelValue('IMPUESTOS', formatMoney(totals.tax)) + '\n';
    receipt += rightLabelValue('CASH', formatMoney(totals.cash)) + '\n';
    receipt += rightLabelValue('CARD', formatMoney(totals.card)) + '\n';
    if (totals.split > 0.009) {
      receipt += rightLabelValue('SPLIT', formatMoney(totals.split)) + '\n';
    }
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    receipt += center('DETALLE') + '\n';
    const timeWidth = LINE_WIDTH >= 42 ? 8 : 5; // HH:MM:SS / HH:MM
    const payWidth = LINE_WIDTH >= 42 ? 6 : 5;
    const amtWidth = LINE_WIDTH >= 42 ? 12 : 10;
    const idWidth = Math.max(6, LINE_WIDTH - timeWidth - 1 - payWidth - 1 - amtWidth);

    receipt += padRight('ID', idWidth) + ' '
      + padRight('HORA', timeWidth)
      + ' '
      + padRight('PAGO', payWidth)
      + ' '
      + padLeft('IMP', amtWidth)
      + '\n';
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    const rows = filteredSales.slice(0, 60); // keep thermal output reasonable
    for (const sale of rows) {
      const id = String(sale?.id ?? '');
      const dt = parseDateTimeLoose(sale?.sale_date);
      const t = Number.isNaN(dt.getTime())
        ? ''
        : (LINE_WIDTH >= 42
          ? fmtTimeTz(dt, { withSeconds: true })
          : fmtTimeTz(dt, { withSeconds: false }));
      const method = (getDisplayPaymentMethod(sale) || '').toString().toUpperCase();
      const amount = formatMoney(sale?.total || 0);

      receipt += padRight(id, idWidth) + ' '
        + padRight(t, timeWidth)
        + ' '
        + padRight(method.slice(0, payWidth), payWidth)
        + ' '
        + padLeft(amount, amtWidth)
        + '\n';

      // If it's a restaurant/customer PARKING sale, show the name on the next line.
      const loanType = (sale?.loan_customer_type || '').toString().toLowerCase();
      const rest = (sale?.loan_restaurant_name || '').toString().trim();
      const cust = (sale?.loan_customer_name || '').toString().trim();
      const label = (loanType === 'restaurant' && rest)
        ? ('R: ' + rest)
        : (cust ? ('C: ' + cust) : '');
      if (label) {
        const line = '  ' + label;
        receipt += padRight(line.slice(0, LINE_WIDTH), LINE_WIDTH) + '\n';
      }
    }

    if (filteredSales.length > rows.length) {
      receipt += center(`... ${filteredSales.length - rows.length} MAS`) + '\n';
    }

    receipt += '\n';
    receipt += GS + 'V' + String.fromCharCode(65) + String.fromCharCode(2);

    const result = await window.api.printReceipt({ raw: true, text: receipt });
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to print');
    }
  } catch (error) {
    console.error('Error printing sales history:', error);
    showAlert('Failed to print sales: ' + error.message, 'error', 'Print Error');
  }
}

function printTodaySalesWithTitle(salesData, title, dateRange) {
  const currency = systemSettings?.currency_symbol || '€';
  const store = systemSettings?.store_name || 'SUPERMARKET POS';
  
  // Create print window
  const printWindow = window.open('', '_blank');
  
  const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          padding: 40px;
          color: #1a202c;
        }
        .header {
          text-align: center;
          margin-bottom: 40px;
          padding-bottom: 20px;
          border-bottom: 3px solid #6E8FAF;
        }
        .header h1 {
          font-size: 32px;
          color: #6E8FAF;
          margin-bottom: 10px;
        }
        .header h2 {
          font-size: 24px;
          color: #4a5568;
          margin-bottom: 5px;
        }
        .header p {
          font-size: 16px;
          color: #718096;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }
        .summary-card {
          background: #f7fafc;
          padding: 20px;
          border-radius: 12px;
          text-align: center;
          border: 2px solid #e2e8f0;
        }
        .summary-card h3 {
          color: #4a5568;
          font-size: 14px;
          margin-bottom: 8px;
        }
        .summary-card p {
          color: #1a202c;
          font-size: 24px;
          font-weight: bold;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        th {
          background: #6E8FAF;
          color: white;
          font-weight: 600;
        }
        @media print {
          body { padding: 20px; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${store.toUpperCase()}</h1>
        <h2>${title}</h2>
        <p>${dateRange}</p>
        <p>Generated: ${formatDateTimeWithDisplayTimeZone(new Date(), 'en-GB', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}</p>
      </div>
      
      <div class="summary">
        <div class="summary-card">
          <h3>Total Sales</h3>
          <p>${currency}${(salesData.summary.total_sales || 0).toFixed(2)}</p>
        </div>
        <div class="summary-card">
          <h3>Transactions</h3>
          <p>${salesData.summary.transaction_count || 0}</p>
        </div>
        <div class="summary-card">
          <h3>Average Sale</h3>
          <p>${currency}${((salesData.summary.total_sales || 0) / (salesData.summary.transaction_count || 1)).toFixed(2)}</p>
        </div>
        <div class="summary-card">
          <h3>Tax Collected</h3>
          <p>${currency}${(salesData.summary.tax || 0).toFixed(2)}</p>
        </div>
      </div>
      
      <table>
        <thead>
          <tr>
            <th>Date/Time</th>
            <th>Items</th>
            <th>Subtotal</th>
            <th>Tax</th>
            <th>Total</th>
            <th>Payment</th>
          </tr>
        </thead>
        <tbody>
          ${salesData.sales.map(sale => `
            <tr>
              <td>${formatDateTimeWithDisplayTimeZone(parseAppDateTimeLoose(sale.sale_date), 'en-GB', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })}</td>
              <td>${sale.items?.map(item => item.product_name + ' (' + item.quantity + ')').join(', ') || 'N/A'}</td>
              <td>${currency}${(sale.subtotal || 0).toFixed(2)}</td>
              <td>${currency}${(sale.tax || 0).toFixed(2)}</td>
              <td><strong>${currency}${(sale.total || 0).toFixed(2)}</strong></td>
              <td>${(sale.payment_method || 'unknown').toUpperCase()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <script>
        window.onload = function() {
          window.print();
        }
      </script>
    </body>
    </html>
  `;
  
  printWindow.document.write(printContent);
  printWindow.document.close();
}

function printTodaySales(todayData) {
  const currencySymbol = systemSettings?.currency_symbol || '€';
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
  const today = new Date();
  
  // Create print window
  const printWindow = window.open('', '_blank');
  
  const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Today's Sales Report - ${formatDateWithDisplayTimeZone(today, 'en-GB')}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          padding: 40px;
          color: #1a202c;
        }
        .header {
          text-align: center;
          margin-bottom: 40px;
          padding-bottom: 20px;
          border-bottom: 3px solid #6E8FAF;
        }
        .header h1 {
          font-size: 32px;
          color: #6E8FAF;
          margin-bottom: 10px;
        }
        .header h2 {
          font-size: 24px;
          color: #4a5568;
          margin-bottom: 5px;
        }
        .header p {
          font-size: 16px;
          color: #718096;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 40px;
        }
        .summary-card {
          background: linear-gradient(135deg, #6E8FAF 0%, #6EAFAF 100%);
          color: white;
          padding: 24px;
          border-radius: 12px;
          text-align: center;
        }
        .summary-card label {
          font-size: 14px;
          opacity: 0.9;
          display: block;
          margin-bottom: 8px;
        }
        .summary-card value {
          font-size: 32px;
          font-weight: 800;
          display: block;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 40px;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        th {
          background: #f7fafc;
          font-weight: 700;
          color: #2d3748;
          text-transform: uppercase;
          font-size: 12px;
          letter-spacing: 0.5px;
        }
        tr:hover {
          background: #f7fafc;
        }
        .total-row {
          background: #6E8FAF !important;
          color: white;
          font-weight: 800;
          font-size: 16px;
        }
        .footer {
          text-align: center;
          margin-top: 60px;
          padding-top: 20px;
          border-top: 2px solid #e2e8f0;
          color: #718096;
        }
        @media print {
          body { padding: 20px; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${storeName}</h1>
        <h2>Daily Sales Report</h2>
        <p>${formatDateTimeWithDisplayTimeZone(today, 'en-GB', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}</p>
      </div>
      
      <div class="summary">
        <div class="summary-card">
          <label>Total Transactions</label>
          <value>${todayData.summary.transaction_count}</value>
        </div>
        <div class="summary-card">
          <label>Total Sales</label>
          <value>${currencySymbol}${(todayData.summary.total_sales || 0).toFixed(2)}</value>
        </div>
        <div class="summary-card">
          <label>Average Sale</label>
          <value>${currencySymbol}${(todayData.summary.total_sales / todayData.summary.transaction_count || 0).toFixed(2)}</value>
        </div>
      </div>
      
      <h3 style="margin-bottom: 20px; color: #2d3748; font-size: 20px;">Transaction Details</h3>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Receipt #</th>
            <th>Subtotal</th>
            <th>Tax</th>
            <th>Total</th>
            <th>Payment Method</th>
          </tr>
        </thead>
        <tbody>
          ${todayData.sales.map(sale => {
            const date = parseAppDateTimeLoose(sale.sale_date);
            const saleTime = formatDateTimeWithDisplayTimeZone(date, 'en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            });
            return `
              <tr>
                <td>${saleTime}</td>
                <td>#${sale.id}</td>
                <td>${currencySymbol}${sale.subtotal.toFixed(2)}</td>
                <td>${currencySymbol}${sale.tax.toFixed(2)}</td>
                <td style="font-weight: 700;">${currencySymbol}${sale.total.toFixed(2)}</td>
                <td>${sale.payment_method.toUpperCase()}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="2">TOTAL</td>
            <td>${currencySymbol}${todayData.sales.reduce((sum, s) => sum + s.subtotal, 0).toFixed(2)}</td>
            <td>${currencySymbol}${todayData.sales.reduce((sum, s) => sum + s.tax, 0).toFixed(2)}</td>
            <td>${currencySymbol}${(todayData.summary.total_sales || 0).toFixed(2)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      
      <div class="footer">
        <p>Generated by ${storeName} POS System</p>
        <p>${formatDateTimeWithDisplayTimeZone(today, 'en-GB', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}</p>
      </div>
      
      <script>
        window.onload = () => {
          setTimeout(() => {
            window.print();
          }, 500);
        };
      </script>
    </body>
    </html>
  `;
  
  printWindow.document.write(printContent);
  printWindow.document.close();
}

// ============== REPORTS VIEW ==============
function loadReportsView() {
  // Load Z-Reports by default
  loadZReportsView();
  
  // Initialize year dropdowns
  const currentYear = new Date().getFullYear();
  const reportYearSelect = document.getElementById('reportYear');
  if (reportYearSelect) {
    reportYearSelect.innerHTML = '';
    for (let year = currentYear; year >= currentYear - 5; year--) {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      reportYearSelect.appendChild(option);
    }
  }
  
  // Set current month
  const reportMonthSelect = document.getElementById('reportMonth');
  if (reportMonthSelect) {
    reportMonthSelect.value = new Date().getMonth() + 1;
  }
  
  // Handle report period type change
  const reportPeriodType = document.getElementById('reportPeriodType');
  if (reportPeriodType) {
    reportPeriodType.addEventListener('change', (e) => {
      const type = e.target.value;
      const customDateGroup = document.getElementById('customDateGroup');
      const customDateGroup2 = document.getElementById('customDateGroup2');
      const monthYearGroup = document.getElementById('monthYearGroup');
      const yearGroup = document.getElementById('yearGroup');
      
      // Hide all optional groups
      customDateGroup.style.display = 'none';
      customDateGroup2.style.display = 'none';
      monthYearGroup.style.display = 'none';
      
      if (type === 'custom') {
        customDateGroup.style.display = 'flex';
        customDateGroup2.style.display = 'flex';
        yearGroup.style.display = 'none';
      } else if (type === 'monthly') {
        monthYearGroup.style.display = 'flex';
        yearGroup.style.display = 'flex';
      } else if (type === 'yearly') {
        yearGroup.style.display = 'flex';
      } else if (type === 'weekly' || type === 'daily') {
        yearGroup.style.display = 'flex';
      }
    });
  }
  
  // Set default dates for custom reports
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  
  const reportStartDate = document.getElementById('reportStartDate');
  const reportEndDate = document.getElementById('reportEndDate');
  if (reportStartDate) reportStartDate.value = startDate.toISOString().split('T')[0];
  if (reportEndDate) reportEndDate.value = endDate.toISOString().split('T')[0];
  
  const generateSalesReportBtn = document.getElementById('generateSalesReportBtn');
  if (generateSalesReportBtn) {
    generateSalesReportBtn.onclick = async () => {
      try {
        generateSalesReportBtn.disabled = true;

        const periodType = document.getElementById('reportPeriodType').value;

        let startDate, endDate;

        if (periodType === 'custom') {
          startDate = document.getElementById('reportStartDate').value;
          endDate = document.getElementById('reportEndDate').value;

          if (!startDate || !endDate) {
            showAlert('Please select date range', 'warning', 'Missing Information');
            return;
          }
        } else if (periodType === 'daily') {
          const year = parseInt(document.getElementById('reportYear').value);
          startDate = `${year}-01-01`;
          endDate = `${year}-12-31`;
        } else if (periodType === 'weekly') {
          const year = parseInt(document.getElementById('reportYear').value);
          startDate = `${year}-01-01`;
          endDate = `${year}-12-31`;
        } else if (periodType === 'monthly') {
          const year = parseInt(document.getElementById('reportYear').value);
          const month = parseInt(document.getElementById('reportMonth').value);
          startDate = `${year}-${String(month).padStart(2, '0')}-01`;
          const lastDay = new Date(year, month, 0).getDate();
          endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
        } else if (periodType === 'yearly') {
          const year = parseInt(document.getElementById('reportYear').value);
          startDate = `${year}-01-01`;
          endDate = `${year}-12-31`;
        }

        const report = await window.api.getSalesReport(startDate, endDate);
        currentSalesReportPrintContext = { report, periodType, startDate, endDate };
        displayReport(report, periodType);
      } catch (e) {
        console.error('Sales report error:', e);
        showAlert('Error generating report: ' + String(e?.message || e || 'Unknown error'), 'error', 'Report');
      } finally {
        generateSalesReportBtn.disabled = false;
      }
    };
  }

  // Initialize restaurant report year dropdown
  const yearSelect = document.getElementById('restaurantReportYear');
  if (yearSelect) {
    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= currentYear - 5; year--) {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      yearSelect.appendChild(option);
    }
  }

  // Set current month
  const monthSelect = document.getElementById('restaurantReportMonth');
  if (monthSelect) {
    monthSelect.value = new Date().getMonth() + 1;
  }

  // Restaurant report handler
  const generateRestaurantReportBtn = document.getElementById('generateRestaurantReportBtn');
  if (generateRestaurantReportBtn) {
    generateRestaurantReportBtn.onclick = async () => {
      const month = parseInt(document.getElementById('restaurantReportMonth').value);
      const year = parseInt(document.getElementById('restaurantReportYear').value);
      
      const restaurants = await window.api.getMonthlyRestaurantReport(month, year);
      displayRestaurantReport(restaurants, month, year);
    };
  }
}

function displayReport(report, periodType = 'custom') {
  const container = document.getElementById('reportResults');
  const currencySymbol = systemSettings?.currency_symbol || '€';

  const salesRows = Array.isArray(report?.sales) ? report.sales : [];
  const topProductsRows = Array.isArray(report?.topProducts) ? report.topProducts : [];

  const totalNetSales = salesRows.reduce((sum, day) => sum + (day.total_sales || 0), 0);
  const totalGrossSales = salesRows.reduce((sum, day) => sum + (day.gross_sales || 0), 0);
  const totalReturnsAmount = salesRows.reduce((sum, day) => sum + (day.returns_amount || 0), 0);

  const totalGrossTransactions = salesRows.reduce((sum, day) => sum + (day.gross_transactions || 0), 0);
  const totalReturnsCount = salesRows.reduce((sum, day) => sum + (day.return_count || 0), 0);
  const totalTransactions = Math.max(0, totalGrossTransactions - totalReturnsCount);

  const totalTax = salesRows.reduce((sum, day) => sum + (day.tax || 0), 0);
  const totalSubtotal = salesRows.reduce((sum, day) => sum + (day.subtotal || 0), 0);
  
  let periodTitle = 'Sales Report';
  if (periodType === 'daily') periodTitle = 'Daily Sales Report';
  else if (periodType === 'weekly') periodTitle = 'Weekly Sales Report';
  else if (periodType === 'monthly') periodTitle = 'Monthly Sales Report';
  else if (periodType === 'yearly') periodTitle = 'Yearly Sales Report';
  
  // Group by week for weekly reports
  let groupedData = salesRows;
  if (periodType === 'weekly') {
    const weekMap = {};
    salesRows.forEach(day => {
      const date = new Date(day.date);
      const weekNum = getWeekNumber(date);
      const weekKey = `Week ${weekNum} (${date.getFullYear()})`;
      
      if (!weekMap[weekKey]) {
        weekMap[weekKey] = {
          week: weekKey,
          transaction_count: 0,
          total_sales: 0,
          tax: 0,
          subtotal: 0
        };
      }
      
      weekMap[weekKey].transaction_count += day.transaction_count;
      weekMap[weekKey].total_sales += day.total_sales || 0;
      weekMap[weekKey].tax += day.tax || 0;
      weekMap[weekKey].subtotal += day.subtotal || 0;
    });
    groupedData = Object.values(weekMap);
  }
  
  // Group by month for yearly reports
  if (periodType === 'yearly') {
    const monthMap = {};
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    salesRows.forEach(day => {
      const date = new Date(day.date);
      const monthKey = monthNames[date.getMonth()];
      
      if (!monthMap[monthKey]) {
        monthMap[monthKey] = {
          month: monthKey,
          transaction_count: 0,
          total_sales: 0,
          tax: 0,
          subtotal: 0
        };
      }
      
      monthMap[monthKey].transaction_count += day.transaction_count;
      monthMap[monthKey].total_sales += day.total_sales || 0;
      monthMap[monthKey].tax += day.tax || 0;
      monthMap[monthKey].subtotal += day.subtotal || 0;
    });
    groupedData = Object.values(monthMap);
  }
  
  container.innerHTML = `
    <div class="report-section">
      <h3>${periodTitle}</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Total Sales (Net)</div>
          <div style="font-size: 32px; font-weight: 800;">${currencySymbol}${totalNetSales.toFixed(2)}</div>
          ${totalReturnsAmount > 0 ? `<div style="margin-top: 6px; font-size: 12px; opacity: 0.95;">Gross: ${currencySymbol}${totalGrossSales.toFixed(2)} | Returns: ${currencySymbol}${totalReturnsAmount.toFixed(2)}</div>` : ''}
        </div>
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Transactions (Net)</div>
          <div style="font-size: 32px; font-weight: 800;">${totalTransactions}</div>
          ${totalReturnsCount > 0 ? `<div style="margin-top: 6px; font-size: 12px; opacity: 0.95;">Sales: ${totalGrossTransactions} | Returns: ${totalReturnsCount}</div>` : ''}
        </div>
        <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Avg Transaction</div>
          <div style="font-size: 32px; font-weight: 800;">${currencySymbol}${(totalNetSales / totalTransactions || 0).toFixed(2)}</div>
        </div>
        <div style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Total Tax</div>
          <div style="font-size: 32px; font-weight: 800;">${currencySymbol}${totalTax.toFixed(2)}</div>
        </div>
      </div>
    </div>
    
    <div class="report-section">
      <h3>${periodType === 'weekly' ? 'Weekly' : periodType === 'yearly' ? 'Monthly' : 'Daily'} Breakdown</h3>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>${periodType === 'weekly' ? 'Week' : periodType === 'yearly' ? 'Month' : 'Date'}</th>
              <th>Transactions</th>
              <th>Subtotal</th>
              <th>Tax</th>
              <th>Total Sales</th>
            </tr>
          </thead>
          <tbody>
            ${groupedData.map(item => `
              <tr>
                <td style="font-weight: 600;">${item.date || item.week || item.month}</td>
                <td>${item.transaction_count}</td>
                <td>${currencySymbol}${(item.subtotal || 0).toFixed(2)}</td>
                <td>${currencySymbol}${(item.tax || 0).toFixed(2)}</td>
                <td style="font-weight: 700; color: #6E8FAF;">${currencySymbol}${(item.total_sales || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background: #f7fafc; font-weight: 800;">
              <td>TOTAL</td>
              <td>${totalTransactions}</td>
              <td>${currencySymbol}${totalSubtotal.toFixed(2)}</td>
              <td>${currencySymbol}${totalTax.toFixed(2)}</td>
              <td style="color: #6E8FAF;">${currencySymbol}${totalNetSales.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    
    <div class="report-section">
      <h3>Top Products</h3>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Quantity Sold</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            ${topProductsRows.map((product, index) => `
              <tr>
                <td style="font-weight: 700; color: #6E8FAF;">${index + 1}</td>
                <td style="font-weight: 600;">${product.product_name}</td>
                <td>${product.total_quantity}</td>
                <td style="font-weight: 700;">${currencySymbol}${product.total_revenue.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    
    <div style="margin-top: 30px; text-align: right;">
      <button class="btn-primary" onclick="window.printSalesReportThermal()">🖨️ Print Report</button>
    </div>
  `;
}

async function printSalesReportThermal() {
  try {
    if (!currentSalesReportPrintContext?.report) {
      showAlert('No sales report data to print. Generate the report first.', 'warning', 'Missing Report');
      return;
    }

    const { report, startDate, endDate, periodType } = currentSalesReportPrintContext;
    const settings = await window.api.getSystemSettings();
    const currencySymbol = settings?.currency_symbol || '€';
    const printerName = (settings?.printer_name || '').toString().toLowerCase();
    const timeZone = getDisplayTimeZone();

    const inferLineWidth = (printer) => {
      const name = String(printer || '').toLowerCase();
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
        || name.includes('tm-t20')
        || name.includes('tm t20')
        || name.includes('tm-t88')
        || name.includes('tm t88');
      return looks80mm ? 48 : 32;
    };

    const LINE_WIDTH = inferLineWidth(printerName);

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

    const formatMoney = (amount) => {
      const num = Number(amount || 0);
      return num.toFixed(2).replace('.', ',') + currencySymbol;
    };

    const fmtDateTz = (dt) => {
      try {
        return new Intl.DateTimeFormat('es-ES', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(dt);
      } catch {
        return formatDateWithDisplayTimeZone(dt, 'es-ES');
      }
    };

    const fmtTimeTz = (dt) => {
      try {
        return new Intl.DateTimeFormat('es-ES', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(dt);
      } catch {
        return formatTimeWithDisplayTimeZone(dt, 'es-ES');
      }
    };

    const fmtDate = (d) => {
      if (!d) return '';
      // Accept YYYY-MM-DD or ISO
      const dt = String(d).includes('T') ? new Date(d) : new Date(`${d}T00:00:00`);
      return fmtDateTz(dt);
    };

    const totalSales = (report.sales || []).reduce((sum, day) => sum + (day.total_sales || 0), 0);
    const totalTransactions = (report.sales || []).reduce((sum, day) => sum + (day.transaction_count || 0), 0);
    const totalTax = (report.sales || []).reduce((sum, day) => sum + (day.tax || 0), 0);
    const totalSubtotal = (report.sales || []).reduce((sum, day) => sum + (day.subtotal || 0), 0);

    const now = new Date();
    const time = fmtTimeTz(now);
    const title = periodType === 'daily' ? 'INFORME DE VENTAS (DIARIO)'
      : periodType === 'weekly' ? 'INFORME DE VENTAS (SEMANAL)'
      : periodType === 'monthly' ? 'INFORME DE VENTAS (MENSUAL)'
      : periodType === 'yearly' ? 'INFORME DE VENTAS (ANUAL)'
      : 'INFORME DE VENTAS';

    const ESC = '\x1B';
    const GS = '\x1D';
    let receipt = '';
    receipt += ESC + '@';

    receipt += center((settings?.store_name || 'SUPERMARKET POS').toString().toUpperCase()) + '\n';
    receipt += center(title) + '\n';
    receipt += '='.repeat(LINE_WIDTH) + '\n';
    receipt += `FECHAS....: ${fmtDate(startDate)} ${fmtDate(endDate)}\n`;
    receipt += `HORA......: ${time}\n`;
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    receipt += rightLabelValue('VENTA BRUTA', formatMoney(totalSales)) + '\n';
    receipt += rightLabelValue('SUBTOTAL', formatMoney(totalSubtotal)) + '\n';
    receipt += rightLabelValue('IMPUESTOS', formatMoney(totalTax)) + '\n';
    receipt += rightLabelValue('TRANSACCIONES', String(totalTransactions)) + '\n';
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    receipt += center('TOP PRODUCTOS') + '\n';

    const idxWidth = 2;
    const qtyWidth = LINE_WIDTH >= 42 ? 7 : 5;
    const revenueWidth = LINE_WIDTH >= 42 ? 10 : 8;
    const nameWidth = Math.max(10, LINE_WIDTH - idxWidth - 1 - qtyWidth - revenueWidth);

    receipt += padRight('#', idxWidth) + ' '
      + padRight('PRODUCTO', nameWidth)
      + padLeft('CANT', qtyWidth)
      + padLeft('IMP', revenueWidth)
      + '\n';
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    const top = Array.isArray(report.topProducts) ? report.topProducts : [];
    if (top.length === 0) {
      receipt += center('SIN DATOS') + '\n';
    } else {
      top.forEach((p, i) => {
        const qty = p.total_quantity;
        const rev = p.total_revenue;
        const name = (p.product_name || '').toString();
        receipt += padRight(String(i + 1), idxWidth) + ' '
          + padRight(name, nameWidth)
          + padLeft(String(qty ?? ''), qtyWidth)
          + padLeft(formatMoney(rev), revenueWidth)
          + '\n';
      });
    }

    receipt += '\n';
    receipt += GS + 'V' + String.fromCharCode(65) + String.fromCharCode(2);

    const result = await window.api.printReceipt({ raw: true, text: receipt });
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to print');
    }
  } catch (error) {
    console.error('Error printing sales report:', error);
    showAlert('Failed to print report: ' + error.message, 'error', 'Print Error');
  }
}

// Helper function to get week number
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function displayRestaurantReport(restaurants, month, year) {
  const container = document.getElementById('restaurantReportResults');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  if (restaurants.length === 0) {
    container.innerHTML = '<div class="report-section"><p>No restaurant orders found for this period.</p></div>';
    return;
  }

  const totalAmount = restaurants.reduce((sum, r) => sum + r.totalAmount, 0);
  const totalOrders = restaurants.reduce((sum, r) => sum + r.orderCount, 0);
  
  container.innerHTML = `
    <div class="report-section">
      <h3>Restaurant Report - ${monthNames[month - 1]} ${year}</h3>
      <p><strong>Total Restaurants:</strong> ${restaurants.length}</p>
      <p><strong>Total Orders:</strong> ${totalOrders}</p>
      <p><strong>Total Amount:</strong> €${totalAmount.toFixed(2)}</p>
      <p><strong>Total Paid:</strong> €${restaurants.reduce((sum, r) => sum + r.paidAmount, 0).toFixed(2)}</p>
      <p><strong>Total Outstanding:</strong> €${restaurants.reduce((sum, r) => sum + r.remainingAmount, 0).toFixed(2)}</p>
    </div>
    
    ${restaurants.map(restaurant => `
      <div class="report-section" style="page-break-inside: avoid;">
        <h4>🍽️ ${restaurant.name}</h4>
        ${restaurant.nie ? `<p><strong>NIE:</strong> ${restaurant.nie}</p>` : ''}
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0;">
          <div>
            <strong>Orders:</strong> ${restaurant.orderCount}
          </div>
          <div>
            <strong>Total:</strong> €${restaurant.totalAmount.toFixed(2)}
          </div>
          <div>
            <strong>Paid:</strong> €${restaurant.paidAmount.toFixed(2)}
          </div>
          <div>
            <strong>Outstanding:</strong> €${restaurant.remainingAmount.toFixed(2)}
          </div>
        </div>

        <h5>Products Ordered:</h5>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Total Quantity</th>
              <th>Unit Price</th>
              <th>Total Amount</th>
            </tr>
          </thead>
          <tbody>
            ${Object.values(restaurant.products).map(product => `
              <tr>
                <td>${product.name}</td>
                <td>${product.totalQuantity}</td>
                <td>€${product.unitPrice.toFixed(2)}</td>
                <td>€${product.totalAmount.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="font-weight: bold;">
              <td>TOTAL</td>
              <td>${Object.values(restaurant.products).reduce((sum, p) => sum + p.totalQuantity, 0)}</td>
              <td>-</td>
              <td>€${Object.values(restaurant.products).reduce((sum, p) => sum + p.totalAmount, 0).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <details style="margin-top: 10px;">
          <summary style="cursor: pointer; font-weight: bold;">📋 View Orders (${restaurant.orderCount})</summary>
          <table style="margin-top: 10px;">
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${restaurant.orders.map(order => `
                <tr>
                  <td>${order.receiptNumber}</td>
                  <td>${formatDateWithDisplayTimeZone(new Date(order.date), 'en-GB')}</td>
                  <td>€${order.amount.toFixed(2)}</td>
                  <td><span class="status-badge status-${order.status}">${order.status.toUpperCase()}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </details>
      </div>
    `).join('')}
    
    <div style="margin-top: 20px; text-align: right;">
      <button class="btn-primary" onclick="window.print()">🖨️ Print Report</button>
    </div>
  `;
}

// ============== INVENTORY VIEW ==============
async function loadInventoryView() {
  const inventory = await window.api.getInventoryReport();
  const tbody = document.querySelector('#inventoryTable tbody');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  if (inventory.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="icon">📋</div><p>No inventory</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = inventory.map(item => {
    let statusClass = 'status-in-stock';
    if (item.status === 'Out of Stock') statusClass = 'status-out-of-stock';
    else if (item.status === 'Low Stock') statusClass = 'status-low-stock';
    
    return `
      <tr>
        <td>${item.name}</td>
        <td>${item.category || '-'}</td>
        <td>${item.stock}</td>
        <td>${item.min_stock}</td>
        <td><span class="status-badge ${statusClass}">${item.status}</span></td>
        <td>${currencySymbol}${Number(item.inventory_value || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');
  
  // Calculate total inventory value
  const totalValue = inventory.reduce((sum, item) => sum + item.inventory_value, 0);
  const row = tbody.insertRow();
  row.innerHTML = `
    <td colspan="5" style="text-align: right; font-weight: bold;">Total Inventory Value:</td>
    <td style="font-weight: bold;">${currencySymbol}${Number(totalValue || 0).toFixed(2)}</td>
  `;
}

// ============== USERS VIEW (Admin Only) ==============
function setupUserHandlers() {
  document.getElementById('addUserBtn')?.addEventListener('click', () => {
    if (hasPermission('users')) {
      openUserModal();
    }
  });
  
  document.getElementById('userForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveUser();
  });
  
  document.getElementById('passwordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await changePassword();
  });
}

async function loadUsersView() {
  if (!hasPermission('users')) {
    alert('Access Denied: Admin privileges required');
    return;
  }
  
  const users = await window.api.getAllUsers();
  const tbody = document.querySelector('#usersTable tbody');
  
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="icon">👥</div><p>No users found</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = users.map(user => {
    const date = new Date(user.created_at);
    const otherAdminExists = users.some(u => u.role === 'admin' && u.id !== currentUser.id);
    const isSelf = user.id === currentUser.id;
    const canDelete = !isSelf || (currentUser.role === 'admin' && otherAdminExists);
    
    return `
      <tr>
        <td>${user.username}</td>
        <td>${user.full_name}</td>
        <td><span class="role-badge ${user.role}">${user.role}</span></td>
        <td>${formatDateWithDisplayTimeZone(date, 'en-GB')}</td>
        <td>
          <button class="action-btn" onclick="editUser(${user.id})" title="Edit">✏️</button>
          <button class="action-btn" onclick="changeUserPassword(${user.id})" title="Change Password">🔑</button>
          ${canDelete ? `<button class="action-btn" onclick="deleteUser(${user.id})" title="Delete">🗑️</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function openUserModal(user = null) {
  const modal = document.getElementById('userModal');
  const form = document.getElementById('userForm');
  const title = document.getElementById('userModalTitle');
  const passwordGroup = document.getElementById('passwordGroup');
  const passwordInput = document.getElementById('userPassword');
  const usernameInput = document.getElementById('userUsername');
  const fullNameInput = document.getElementById('userFullName');
  
  if (user) {
    title.textContent = 'Edit User';
    document.getElementById('userId').value = user.id;
    document.getElementById('userUsername').value = user.username;
    document.getElementById('userFullName').value = user.full_name;
    document.getElementById('userRole').value = user.role;
    
    // Hide password field when editing
    passwordGroup.style.display = 'none';
    passwordInput.required = false;
  } else {
    title.textContent = 'Add User';
    form.reset();
    document.getElementById('userId').value = '';
    
    // Show password field when adding
    passwordGroup.style.display = 'block';
    passwordInput.required = true;
  }
  
  modal.classList.add('active');

  // Touchscreen UX: focus the first editable field and force-open the
  // on-screen keyboard. Without this, some Windows touch devices show the
  // caret but skip opening the custom keyboard for edit-user flows.
  try {
    setTimeout(() => {
      const field = usernameInput || fullNameInput || passwordInput;
      if (!field || field.disabled || field.readOnly) return;
      try { window.__virtualKeyboardForceOpen = true; } catch { /* ignore */ }
      try {
        field.focus();
        field.select?.();
        field.dispatchEvent(new Event('focusin', { bubbles: true }));
      } catch {
        // ignore
      }
    }, 50);
  } catch {
    // ignore
  }
}

async function editUser(id) {
  const user = await window.api.getUserById(id);
  if (user) {
    openUserModal(user);
  }
}

async function deleteUser(id) {
  const isSelf = id === currentUser.id;

  // Self-delete is allowed only if another admin exists.
  if (isSelf) {
    if (currentUser.role !== 'admin') {
      showAlert('You cannot delete your own account', 'warning', 'Not Allowed');
      return;
    }
    try {
      const users = await window.api.getAllUsers();
      const otherAdminExists = Array.isArray(users) && users.some(u => u.role === 'admin' && u.id !== currentUser.id);
      if (!otherAdminExists) {
        showAlert('You cannot delete the last admin user. Create another admin first.', 'error', 'Not Allowed');
        return;
      }
    } catch {
      // If we can’t verify, DB will still protect the last admin.
    }
  }

  const msg = isSelf
    ? 'Are you sure you want to delete your own account?\n\nYou will be logged out immediately.'
    : 'Are you sure you want to delete this user?';

  if (!confirm(msg)) return;

  const res = await window.api.deleteUser(id);
  if (res && res.success === false) {
    if (res.errorCode === 'LAST_ADMIN') {
      showAlert('You cannot delete the last admin user. Create another admin first.', 'error', 'Not Allowed');
      return;
    }
    if (res.errorCode === 'NOT_FOUND') {
      showAlert('User not found (maybe already deleted).', 'warning', 'Not Found');
      await loadUsersView();
      return;
    }
    showAlert(res.message || 'Failed to delete user', 'error', 'Error');
    return;
  }

  if (isSelf) {
    showAlert('Account deleted. Logging out...', 'info');
    logoutToLoginScreen();
    return;
  }

  await loadUsersView();
}

async function saveUser() {
  const id = document.getElementById('userId').value;
  const user = {
    username: document.getElementById('userUsername').value,
    fullName: document.getElementById('userFullName').value,
    role: document.getElementById('userRole').value
  };
  
  try {
    if (id) {
      // Update existing user
      const res = await window.api.updateUser(parseInt(id), user);
      if (res && res.success === false) {
        const code = res.errorCode || 'UNKNOWN';
        if (code === 'USERNAME_EXISTS') {
          showAlert('This username already exists. Please choose a different username.', 'error', 'Duplicate Username');
          return;
        }
        showAlert(res.message || 'Failed to update user', 'error', 'Error');
        return;
      }
    } else {
      // Add new user
      user.password = document.getElementById('userPassword').value;
      const res = await window.api.addUser(user);
      if (res && res.success === false) {
        const code = res.errorCode || 'UNKNOWN';
        if (code === 'USERNAME_EXISTS') {
          showAlert('This username already exists. Please choose a different username.', 'error', 'Duplicate Username');
          return;
        }
        showAlert(res.message || 'Failed to create user', 'error', 'Error');
        return;
      }
    }
    
    closeModal('userModal');
    await loadUsersView();
  } catch (error) {
    const msg = String(error?.message || error || 'Error saving user');
    if (msg.includes('USERNAME_EXISTS') || msg.includes('UNIQUE constraint failed: users.username')) {
      showAlert('This username already exists. Please choose a different username.', 'error', 'Duplicate Username');
      return;
    }
    showAlert('Error saving user: ' + msg, 'error', 'Error');
  }
}

function changeUserPassword(id) {
  const modal = document.getElementById('passwordModal');
  document.getElementById('passwordUserId').value = id;
  document.getElementById('passwordForm').reset();
  modal.classList.add('active');

  // The modal opens programmatically; on touch devices the virtual keyboard
  // only auto-opens after an actual tap. Force it open for password entry.
  try { window.__virtualKeyboardForceOpen = true; } catch { /* ignore */ }
  setTimeout(() => {
    try {
      const first = document.getElementById('newPassword');
      if (!first) return;
      window.__virtualKeyboardForceOpen = true;
      first.focus();
      first.select?.();
    } catch {
      // ignore
    }
  }, 0);
}

async function changePassword() {
  const id = document.getElementById('passwordUserId').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  if (newPassword !== confirmPassword) {
    showAlert('Passwords do not match', 'error', 'Invalid Password');
    return;
  }
  
  if (newPassword.length < 6) {
    showAlert('Password must be at least 6 characters', 'error', 'Invalid Password');
    return;
  }
  
  try {
    await window.api.updateUserPassword(parseInt(id), newPassword);
    closeModal('passwordModal');
    showAlert('Password updated successfully', 'success');
  } catch (error) {
    showAlert('Error updating password: ' + String(error?.message || error), 'error', 'Error');
  }
}

// ============== CATEGORIES VIEW (Admin Only) ==============
function setupCategoryHandlers() {
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => {
    if (hasPermission('categories')) {
      openCategoryModal();
    }
  });
  
  document.getElementById('categoryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveCategory();
  });

  // Bulk delete (Categories)
  const bulkBtn = document.getElementById('bulkDeleteCategoriesBtn');
  if (bulkBtn && !bulkBtn.dataset.listenerAttached) {
    bulkBtn.dataset.listenerAttached = '1';
    bulkBtn.addEventListener('click', async () => {
      if (selectedCategoryIds.size === 0) return;
      const ok = await showConfirmDialog({
        title: 'Delete Selected Categories?',
        message: `You selected ${selectedCategoryIds.size} category(s).\n\nThis will delete the category and its subcategories. Products keep their old category text in reports/history.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger'
      });
      if (!ok) return;

      const ids = Array.from(selectedCategoryIds);
      let deleted = 0;
      for (let i = 0; i < ids.length; i++) {
        try {
          await window.api.deleteCategory(ids[i]);
          deleted++;
        } catch {
          // ignore per-item failures
        }
        if (i % 25 === 0) await new Promise(r => setTimeout(r, 0));
      }

      selectedCategoryIds.clear();
      await loadCategoriesView();
      await loadCategoryTabs();
      showAlert(`Deleted ${deleted} category(s).`, 'success');
    });
  }

  // Selection handlers (Categories) - event delegation
  const categoriesTable = document.getElementById('categoriesTable');
  if (categoriesTable && !categoriesTable.dataset.selectionAttached) {
    categoriesTable.dataset.selectionAttached = '1';
    categoriesTable.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.id === 'categoriesSelectAll') {
        const visible = Array.from(document.querySelectorAll('#categoriesTable tbody input.category-row-select'));
        for (const cb of visible) {
          cb.checked = t.checked;
          const id = parseInt(cb.dataset.categoryId, 10);
          if (!Number.isFinite(id)) continue;
          if (t.checked) selectedCategoryIds.add(id);
          else selectedCategoryIds.delete(id);
        }
        updateCategoriesBulkUi();
        return;
      }

      if (t.classList.contains('category-row-select')) {
        const id = parseInt(t.dataset.categoryId, 10);
        if (!Number.isFinite(id)) return;
        if (t.checked) selectedCategoryIds.add(id);
        else selectedCategoryIds.delete(id);
        updateCategoriesBulkUi();
      }
    });
  }

  // Auto-update tax rate when category is selected in product form
  document.getElementById('productCategory')?.addEventListener('change', async (e) => {
    const categoryName = e.target.value;
    if (!categoryName) {
      const subcategorySelect = document.getElementById('productSubcategory');
      const subcategoryGroup = document.getElementById('productSubcategoryGroup');
      if (subcategoryGroup) subcategoryGroup.style.display = 'none';
      if (subcategorySelect) subcategorySelect.innerHTML = '<option value="">-- No Subcategory --</option>';
      return;
    }
    const categories = await window.api.getAllCategories();
    const category = categories.find(c => c.name === categoryName);
    if (category) {
      // Load subcategories for this category
      const subcategories = await window.api.getSubcategoriesByCategoryId(category.id);
      const subcategorySelect = document.getElementById('productSubcategory');
      const subcategoryGroup = document.getElementById('productSubcategoryGroup');
      
      if (subcategories && subcategories.length > 0) {
        subcategorySelect.innerHTML = '<option value="">-- No Subcategory --</option>' +
          subcategories.map(sub => `<option value="${sub.name}">${sub.name}</option>`).join('');
        subcategoryGroup.style.display = 'block';
      } else {
        subcategoryGroup.style.display = 'none';
        subcategorySelect.innerHTML = '<option value="">-- No Subcategory --</option>';
      }
    }
  });
}

async function loadCategoriesView() {
  if (!hasPermission('categories')) {
    showAlert('Access Denied: You do not have permission to view categories', 'error');
    return;
  }
  
  const categories = await window.api.getAllCategories();
  categoriesManagementList = Array.isArray(categories) ? categories : [];
  categoriesPager.page = 1;
  selectedCategoryIds.clear();
  const tbody = document.querySelector('#categoriesTable tbody');
  
  if (categoriesManagementList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="icon">🏷️</div><p>No categories found. Add your first category!</p></td></tr>';
    return;
  }

  ensurePaginationBar({
    containerSelector: '#categoriesView .table-container',
    barId: 'categoriesPagination',
    onPrev: () => {
      categoriesPager.page = Math.max(1, categoriesPager.page - 1);
      renderCategoriesTable();
    },
    onNext: () => {
      categoriesPager.page = categoriesPager.page + 1;
      renderCategoriesTable();
    },
    onPerPage: (v) => {
      categoriesPager.perPage = v;
      categoriesPager.page = 1;
      renderCategoriesTable();
    }
  });

  renderCategoriesTable();
}

function renderCategoriesTable() {
  const tbody = document.querySelector('#categoriesTable tbody');
  if (!tbody) return;

  const categories = categoriesManagementList || [];
  const total = categories.length;
  const totalPages = Math.max(1, Math.ceil(total / categoriesPager.perPage));
  categoriesPager.page = Math.min(Math.max(1, categoriesPager.page), totalPages);
  const startIndex = (categoriesPager.page - 1) * categoriesPager.perPage;
  const pageRows = categories.slice(startIndex, startIndex + categoriesPager.perPage);

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="icon">🏷️</div><p>No categories found. Add your first category!</p></td></tr>';
    updatePaginationBar('categoriesPagination', { page: 1, perPage: categoriesPager.perPage, total: 0 });
    return;
  }
  
  tbody.innerHTML = pageRows.map(category => {
    const date = new Date(category.created_at);
    const isFavorite = category.is_favorite === 1;
    const starIcon = isFavorite ? '⭐' : '☆';
    
    return `
      <tr>
        <td style="text-align:center;">
          <input class="category-row-select table-select" type="checkbox" data-category-id="${category.id}" ${selectedCategoryIds.has(category.id) ? 'checked' : ''} aria-label="Select category">
        </td>
        <td>
          <button class="star-btn" onclick="toggleCategoryFavorite(${category.id}, ${!isFavorite})" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
            ${starIcon}
          </button>
        </td>
        <td>${category.name}</td>
        <td>${formatDateWithDisplayTimeZone(date, 'en-GB')}</td>
        <td>
          <button class="action-btn" onclick="editCategory(${category.id})" title="Edit">✏️</button>
          <button class="action-btn delete-btn" onclick="deleteCategory(${category.id})" title="Delete">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  updatePaginationBar('categoriesPagination', { page: categoriesPager.page, perPage: categoriesPager.perPage, total });

  updateCategoriesBulkUi(pageRows);
}

function updateCategoriesBulkUi(visibleRows = null) {
  const bulkBtn = document.getElementById('bulkDeleteCategoriesBtn');
  if (bulkBtn) bulkBtn.disabled = selectedCategoryIds.size === 0;

  const selectAll = document.getElementById('categoriesSelectAll');
  if (!selectAll) return;
  const visible = visibleRows
    ? visibleRows.map(c => c.id)
    : Array.from(document.querySelectorAll('#categoriesTable tbody input.category-row-select')).map(cb => parseInt(cb.dataset.categoryId, 10)).filter(Number.isFinite);

  if (visible.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  const selectedVisible = visible.filter(id => selectedCategoryIds.has(id)).length;
  selectAll.checked = selectedVisible === visible.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
}

async function toggleCategoryFavorite(id, isFavorite) {
  try {
    // Check if trying to add a favorite
    if (isFavorite) {
      const favoriteCategories = await window.api.getFavoriteCategories();
      if (favoriteCategories.length >= 10) {
        showAlert('Maximum 10 categories can be displayed on front screen. Please remove one first.', 'error');
        return;
      }
    }
    
    await window.api.toggleCategoryFavorite(id, isFavorite);
    await loadCategoriesView();
    await loadCategoryTabs(); // Refresh category tabs in checkout
    // Category favorite toggled - no popup
  } catch (error) {
    console.error('Error toggling favorite:', error);
    showAlert('Failed to update favorite status', 'error');
  }
}

async function openCategoryModal(category = null) {
  const modal = document.getElementById('categoryModal');
  const form = document.getElementById('categoryForm');
  const title = document.getElementById('categoryModalTitle');
  const subcategoriesSection = document.getElementById('subcategoriesSection');
  
  if (category) {
    title.textContent = 'Edit Category';
    document.getElementById('categoryId').value = category.id;
    document.getElementById('categoryName').value = category.name;
    
    // Show subcategories section when editing
    subcategoriesSection.style.display = 'block';
    await loadSubcategoriesForCategory(category.id);
  } else {
    title.textContent = 'Add Category';
    form.reset();
    document.getElementById('categoryId').value = '';
    // Show subcategories section even for new categories (will be empty until saved)
    subcategoriesSection.style.display = 'block';
    document.getElementById('subcategoriesList').innerHTML = '<p style="color: #718096; font-size: 14px;">Save category first, then add subcategories</p>';
  }
  
  modal.classList.add('active');

  // Touchscreen UX: auto-focus name field and force-open the on-screen keyboard.
  // Without this, focus may be set programmatically and the keyboard won't open.
  try {
    const nameEl = document.getElementById('categoryName');
    if (nameEl) {
      setTimeout(() => {
        try {
          window.__virtualKeyboardForceOpen = true;
          nameEl.focus();
          nameEl.select?.();
          // Nudge focusin listeners in older Chromium builds.
          nameEl.dispatchEvent(new Event('focusin', { bubbles: true }));
        } catch {
          // ignore
        }
      }, 30);
    }
  } catch {
    // ignore
  }
}

async function loadSubcategoriesForCategory(categoryId) {
  const subcategories = await window.api.getSubcategoriesByCategoryId(categoryId);
  const listContainer = document.getElementById('subcategoriesList');
  
  if (subcategories.length === 0) {
    listContainer.innerHTML = '<p style="color: #718096; font-size: 14px;">No subcategories yet</p>';
    return;
  }
  
  // Build nested structure
  const buildSubcategoryTree = async (parentSubcategories, level = 0) => {
    let html = '';
    for (const sub of parentSubcategories) {
      const indent = level * 20;
      html += `
        <div class="subcategory-item" style="margin-left: ${indent}px; border-left: ${level > 0 ? '2px solid #e2e8f0' : 'none'}; padding-left: ${level > 0 ? '10px' : '0'};">
          <span>${'└─ '.repeat(level)}${sub.name}</span>
          <div>
            <button type="button" class="action-btn" onclick="addChildSubcategory(${sub.id}, ${categoryId})" title="Add Child">➕</button>
            <button type="button" class="action-btn" onclick="editSubcategory(${sub.id})" title="Edit">✏️</button>
            <button type="button" class="action-btn" onclick="deleteSubcategory(${sub.id})" title="Delete">🗑️</button>
          </div>
        </div>
      `;
      
      // Load children
      const children = await window.api.getSubcategoriesByParentId(sub.id);
      if (children && children.length > 0) {
        html += await buildSubcategoryTree(children, level + 1);
      }
    }
    return html;
  };
  
  listContainer.innerHTML = await buildSubcategoryTree(subcategories);
}

function openCategoryModalFromProduct() {
  // Remember that we're opening from product modal
  const categoryModal = document.getElementById('categoryModal');
  categoryModal.dataset.openedFrom = 'product';
  openCategoryModal();
}

async function editCategory(id) {
  const category = await window.api.getCategoryById(id);
  if (category) {
    openCategoryModal(category);
  }
}

async function deleteCategory(id) {
  if (!confirm('Are you sure you want to delete this category?')) {
    return;
  }
  
  try {
    await window.api.deleteCategory(id);
    // Category deleted - no popup
    await loadCategoriesView();
  } catch (error) {
    showAlert('Error deleting category: ' + error.message, 'error');
  }
}

async function saveCategory() {
  const id = document.getElementById('categoryId').value;
  const category = {
    name: document.getElementById('categoryName').value.trim(),
    // VAT is product-level; keep category tax rate at 0 for backwards compatibility.
    taxRate: 0
  };
  
  if (!category.name) {
    showAlert('Please enter a category name', 'warning');
    return;
  }
  
  try {
    const categoryModal = document.getElementById('categoryModal');
    const openedFrom = categoryModal.dataset.openedFrom;
    const isNew = !id;
    
    let result;
    if (id) {
      await window.api.updateCategory(parseInt(id), category);
      // Category updated - no popup
      result = { id: parseInt(id) };
    } else {
      result = await window.api.addCategory(category);
      // Category added - no popup
    }
    
    closeModal('categoryModal');
    
    // Reload categories in product form if it was opened from there
    if (openedFrom === 'product') {
      await loadCategoriesForProductForm();
      // Select the newly added category if we just created one
      if (result && result.id) {
        const categorySelect = document.getElementById('productCategory');
        const categories = await window.api.getAllCategories();
        const newCategory = categories.find(c => c.id === result.id);
        if (newCategory) {
          categorySelect.value = newCategory.name;
          // Trigger change event to update tax rate
          categorySelect.dispatchEvent(new Event('change'));
        }
      }
      // Clear the flag
      delete categoryModal.dataset.openedFrom;
    } else {
      await loadCategoriesView();
      
      // If this was a new category, automatically open edit mode to add subcategories
      if (isNew && result && result.id) {
        // Small delay to let the list reload
        setTimeout(async () => {
          const newCategory = await window.api.getCategoryById(result.id);
          if (newCategory) {
            await openCategoryModal(newCategory);
          }
        }, 300);
      }
    }
  } catch (error) {
    showAlert('Error saving category: ' + error.message, 'error');
  }
}

// ============== SUBCATEGORIES ==============
function setupSubcategoryHandlers() {
  document.getElementById('addSubcategoryBtn')?.addEventListener('click', async () => {
    const categoryId = document.getElementById('categoryId').value;
    if (categoryId) {
      await openSubcategoryModal(null, categoryId);
    } else {
      // Need to save category first
      showAlert('Please save the category first before adding subcategories', 'warning');
    }
  });
  
  document.getElementById('subcategoryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSubcategory();
  });
}

async function openSubcategoryModal(subcategory = null, categoryId = null, parentId = null) {
  const modal = document.getElementById('subcategoryModal');
  const form = document.getElementById('subcategoryForm');
  const title = document.getElementById('subcategoryModalTitle');
  const parentSelect = document.getElementById('subcategoryParentId');
  
  // Load all subcategories for this category to populate parent dropdown
  if (categoryId) {
    const allSubcategories = await loadAllSubcategoriesFlat(categoryId);
    parentSelect.innerHTML = '<option value="">None (Top Level)</option>';
    
    allSubcategories.forEach(sub => {
      // Don't allow selecting itself as parent when editing
      if (!subcategory || sub.id !== subcategory.id) {
        const level = sub.level || 0;
        const indent = '&nbsp;&nbsp;'.repeat(level);
        parentSelect.innerHTML += `<option value="${sub.id}">${indent}${sub.name}</option>`;
      }
    });
  }
  
  if (subcategory) {
    title.textContent = 'Edit Subcategory';
    document.getElementById('subcategoryId').value = subcategory.id;
    document.getElementById('subcategoryCategoryId').value = subcategory.category_id;
    document.getElementById('subcategoryParentId').value = subcategory.parent_id || '';
    document.getElementById('subcategoryName').value = subcategory.name;
  } else {
    title.textContent = 'Add Subcategory';
    form.reset();
    document.getElementById('subcategoryId').value = '';
    document.getElementById('subcategoryCategoryId').value = categoryId;
    document.getElementById('subcategoryParentId').value = parentId || '';
  }
  
  modal.classList.add('active');
}

// Helper function to get all subcategories in flat structure with levels
async function loadAllSubcategoriesFlat(categoryId, parentId = null, level = 0) {
  let result = [];
  const subcategories = parentId 
    ? await window.api.getSubcategoriesByParentId(parentId)
    : await window.api.getSubcategoriesByCategoryId(categoryId);
  
  for (const sub of subcategories) {
    result.push({ ...sub, level });
    const children = await loadAllSubcategoriesFlat(categoryId, sub.id, level + 1);
    result = result.concat(children);
  }
  
  return result;
}

// New function to add a child subcategory
async function addChildSubcategory(parentId, categoryId) {
  await openSubcategoryModal(null, categoryId, parentId);
}

async function editSubcategory(id) {
  const subcategory = await window.api.getSubcategoryById(id);
  if (subcategory) {
    await openSubcategoryModal(subcategory, subcategory.category_id);
  }
}

async function deleteSubcategory(id) {
  if (!confirm('Are you sure you want to delete this subcategory?')) {
    return;
  }
  
  try {
    await window.api.deleteSubcategory(id);
    // Subcategory deleted - no popup
    const categoryId = document.getElementById('categoryId').value;
    await loadSubcategoriesForCategory(categoryId);
  } catch (error) {
    showAlert('Error deleting subcategory: ' + error.message, 'error');
  }
}

async function saveSubcategory() {
  const id = document.getElementById('subcategoryId').value;
  const parentIdValue = document.getElementById('subcategoryParentId').value;
  const subcategory = {
    categoryId: parseInt(document.getElementById('subcategoryCategoryId').value),
    parentId: parentIdValue ? parseInt(parentIdValue) : null,
    name: document.getElementById('subcategoryName').value.trim()
  };
  
  if (!subcategory.name) {
    showAlert('Please enter a subcategory name', 'warning');
    return;
  }
  
  try {
    if (id) {
      await window.api.updateSubcategory(parseInt(id), subcategory);
      // Subcategory updated - no popup
    } else {
      await window.api.addSubcategory(subcategory);
      // Subcategory added - no popup
    }
    
    closeModal('subcategoryModal');
    await loadSubcategoriesForCategory(subcategory.categoryId);
  } catch (error) {
    showAlert('Error saving subcategory: ' + error.message, 'error');
  }
}


async function loadCategoriesForProductForm() {
  const categories = await window.api.getAllCategories();
  const categorySelect = document.getElementById('productCategory');
  const currentValue = categorySelect.value;

  const opts = [
    '<option value="">-- No Category --</option>',
    ...categories.map(cat => `<option value="${cat.name}">${cat.name} (${(cat.tax_rate * 100).toFixed(2)}% tax)</option>`)
  ];
  categorySelect.innerHTML = opts.join('');

  // Restore previous selection if it still exists; otherwise keep empty.
  if (currentValue && categories.some(c => c.name === currentValue)) {
    categorySelect.value = currentValue;
  } else {
    categorySelect.value = '';
  }
}

// ============== SYSTEM SETTINGS ==============
async function loadSystemSettingsView() {
  if (!hasPermission('system')) {
    alert('Access Denied: Admin privileges required');
    return;
  }
  
  try {
    systemSettings = await window.api.getSystemSettings();
    
    // Store current logo in global variable
    currentLogoData = systemSettings.store_logo || '';
    
    // Populate form
    document.getElementById('storeName').value = systemSettings.store_name || '';
    document.getElementById('storeLogo').value = systemSettings.store_logo || '';
    document.getElementById('ownerName').value = systemSettings.owner_name || '';
    document.getElementById('nieNumber').value = systemSettings.nie_number || '';
    document.getElementById('companyAddress').value = systemSettings.company_address || '';
    
    // Update logo preview
    const logoPreviewText = document.getElementById('logoPreviewText');
    if (systemSettings.store_logo && systemSettings.store_logo.startsWith('data:image')) {
      // Image
      logoPreviewText.innerHTML = `<img src=\"${systemSettings.store_logo}\" style=\"width: 80px; height: 80px; object-fit: contain;\" />`;
    } else {
      // Emoji or text
      logoPreviewText.textContent = systemSettings.store_logo || '\ud83d\uded2';
    }
    
    document.getElementById('currencySymbol').value = systemSettings.currency_symbol || '€';
    document.getElementById('currencyCode').value = systemSettings.currency_code || 'EUR';
    try {
      const taxEl = document.getElementById('taxRate');
      if (taxEl) taxEl.value = (Number(systemSettings.tax_rate || 0) * 100) || 0;
    } catch {
      // ignore
    }
    document.getElementById('receiptFooter').value = systemSettings.receipt_footer || '';
    document.getElementById('printerName').value = systemSettings.printer_name || '';
    // Customer display COM port (persisted)
    await refreshCustomerDisplayPortOptions(systemSettings.customer_display_port || '');
  } catch (error) {
    alert('Error loading settings: ' + error.message);
  }
}

async function refreshCustomerDisplayPortOptions(selectedPort = '') {
  try {
    const el = document.getElementById('customerDisplayPort');
    if (!el) return;

    // If the UI uses a text input (no dropdown), just set the value.
    // Keep the old select-based behavior for backward compatibility.
    const tag = (el.tagName || '').toUpperCase();
    if (tag !== 'SELECT') {
      el.value = (selectedPort || '').toString().trim().toUpperCase();
      return;
    }

    const select = el;

    // Preserve AUTO option
    const current = (selectedPort || select.value || '').toString().trim().toUpperCase();
    select.innerHTML = '';
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = 'AUTO (recommended)';
    select.appendChild(autoOpt);

    if (!window.api || typeof window.api.listScalePorts !== 'function') {
      select.value = '';
      return;
    }

    const ports = await window.api.listScalePorts();
    const comPorts = (ports || [])
      .map(p => ({
        path: (p?.path || '').toString().trim().toUpperCase(),
        manufacturer: (p?.manufacturer || '').toString().trim()
      }))
      .filter(p => /^COM\d+$/.test(p.path))
      .filter(p => !/^COM[12]$/.test(p.path));

    comPorts.sort((a, b) => {
      const na = Number(a.path.replace('COM', ''));
      const nb = Number(b.path.replace('COM', ''));
      return (na || 0) - (nb || 0);
    });

    for (const p of comPorts) {
      const opt = document.createElement('option');
      opt.value = p.path;
      const hint = p.manufacturer ? ` (${p.manufacturer})` : '';
      opt.textContent = `${p.path}${hint}`;
      select.appendChild(opt);
    }

    // Select the saved/current value if present
    if (current && Array.from(select.options).some(o => o.value === current)) {
      select.value = current;
    } else {
      select.value = '';
    }
  } catch {
    // ignore
  }
}

function setupSystemSettingsHandlers() {
  const promptForDangerousText = ({ title, message, expectedText, placeholder = '', confirmText = 'Confirm', cancelText = 'Cancel' } = {}) => {
    return new Promise((resolve) => {
      const expected = String(expectedText || '').trim();
      const expectedUpper = expected.toUpperCase();

      const existing = document.getElementById('dangerTextConfirmOverlay');
      if (existing) {
        try { existing.remove(); } catch { /* ignore */ }
      }

      const overlay = document.createElement('div');
      overlay.id = 'dangerTextConfirmOverlay';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:rgba(0,0,0,0.62)',
        'padding:24px 0 330px 0',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'z-index:10050'
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'width:min(560px, 92vw)',
        'background:#fff',
        'border-radius:22px',
        'box-shadow:0 18px 60px rgba(0,0,0,0.35)',
        'padding:26px 22px',
        'font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial'
      ].join(';');

      const safeTitle = String(title || 'Confirm');
      const safeMsg = String(message || '');
      const safePlaceholder = String(placeholder || expected || '');

      card.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:26px; font-weight:900; color:#991b1b; margin-bottom:6px;">${safeTitle}</div>
          <div style="font-size:14px; color:#475569; margin-bottom:16px; white-space:pre-line; font-weight:800;">${safeMsg}</div>

          <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:18px;">
            <input id="dangerTextConfirmInput" type="text" autocomplete="off" enterkeyhint="done"
              placeholder="${safePlaceholder}"
              style="width:min(360px, 86vw); font-size:22px; text-align:center; padding:14px 12px; border-radius:14px; border:2px solid #fecaca; outline:none; font-weight:900;" />
          </div>

          <div style="display:flex; gap:14px; justify-content:center;">
            <button id="dangerTextConfirmCancel" style="flex:1; max-width:220px; border:none; border-radius:16px; padding:16px 14px; font-size:18px; font-weight:900; background:#94a3b8; color:#fff;">${cancelText}</button>
            <button id="dangerTextConfirmOk" style="flex:1; max-width:220px; border:none; border-radius:16px; padding:16px 14px; font-size:18px; font-weight:900; background:#ef4444; color:#fff;">${confirmText}</button>
          </div>
          <div style="margin-top:10px; font-size:12px; color:#64748b; font-weight:800;">Type <span style="color:#0f172a;">${expectedUpper}</span> to confirm.</div>
        </div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const input = card.querySelector('#dangerTextConfirmInput');
      const okBtn = card.querySelector('#dangerTextConfirmOk');
      const cancelBtn = card.querySelector('#dangerTextConfirmCancel');

      const cleanup = () => {
        try { overlay.remove(); } catch { /* ignore */ }
      };

      const close = (value) => {
        cleanup();
        resolve(value);
      };

      const isMatch = () => {
        const v = String(input?.value || '').trim().toUpperCase();
        return v === expectedUpper;
      };

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
      cancelBtn?.addEventListener('click', () => close(false), { once: true });
      okBtn?.addEventListener('click', () => close(isMatch()), { once: true });
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          close(isMatch());
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          close(false);
        }
      });

      try { window.__virtualKeyboardForceOpen = true; } catch { /* ignore */ }
      setTimeout(() => {
        try {
          window.__virtualKeyboardForceOpen = true;
          input?.focus?.();
          input?.select?.();
        } catch {
          // ignore
        }
      }, 0);
    });
  };

  document.getElementById('systemSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSystemSettings();
  });

  document.getElementById('backupDatabaseBtn')?.addEventListener('click', async () => {
    try {
      if (!window.api || typeof window.api.backupDatabase !== 'function') {
        showAlert('Backup feature is not available in this build.', 'error');
        return;
      }
      const result = await window.api.backupDatabase();
      if (result?.success) {
        showAlert('Backup saved successfully.', 'success');
      } else if (!result?.canceled) {
        showAlert('Backup failed: ' + (result?.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      showAlert('Backup failed: ' + error.message, 'error');
    }
  });

  document.getElementById('restoreDatabaseBtn')?.addEventListener('click', async () => {
    try {
      if (!window.api || typeof window.api.restoreDatabase !== 'function') {
        showAlert('Restore feature is not available in this build.', 'error');
        return;
      }

      const ok = confirm('Restore will REPLACE the current database and restart the app. Continue?');
      if (!ok) return;

      const result = await window.api.restoreDatabase();
      if (result?.success) {
        showAlert('Restoring... the app will restart.', 'info');
      } else if (!result?.canceled) {
        showAlert('Restore failed: ' + (result?.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      showAlert('Restore failed: ' + error.message, 'error');
    }
  });

  document.getElementById('refreshCustomerDisplayPortsBtn')?.addEventListener('click', async () => {
    const current = (document.getElementById('customerDisplayPort')?.value || '').toString();
    await refreshCustomerDisplayPortOptions(current);
  });
  
  // Setup logo upload handlers
  setupLogoUpload();
}

function setupLogoUpload() {
  const fileInput = document.getElementById('storeLogoFile');
  const uploadBtn = document.getElementById('uploadLogoBtn');
  const useEmojiBtn = document.getElementById('useEmojiBtn');
  const clearBtn = document.getElementById('clearLogoBtn');
  const logoInput = document.getElementById('storeLogo');
  const logoPreview = document.getElementById('logoPreview');
  const logoPreviewText = document.getElementById('logoPreviewText');
  
  if (!fileInput || !uploadBtn) return;
  
  // Upload button clicked
  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });
  
  // File selected
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Check file size (limit to 500KB)
    if (file.size > 500000) {
      showAlert('Image file is too large. Please use an image smaller than 500KB.', 'error', 'File Too Large');
      return;
    }
    
    // Read file as base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result;
      currentLogoData = base64;
      logoInput.value = base64;
      logoPreviewText.innerHTML = `<img src="${base64}" style="width: 80px; height: 80px; object-fit: contain;" />`;
      console.log('Logo updated:', base64.substring(0, 50));
    };
    reader.readAsDataURL(file);
  });
  
  // Use emoji button
  useEmojiBtn.addEventListener('click', () => {
    const emoji = prompt('Enter an emoji or text for your logo (max 10 characters):', '🛒');
    if (emoji) {
      const logoText = emoji.substring(0, 10);
      currentLogoData = logoText;
      logoInput.value = logoText;
      logoPreviewText.textContent = logoText;
      console.log('Logo updated to emoji:', logoText);
    }
  });
  
  // Clear button
  clearBtn.addEventListener('click', () => {
    currentLogoData = '';
    logoInput.value = '';
    fileInput.value = '';
    logoPreviewText.textContent = '🛒';
    console.log('Logo cleared');
  });
}

async function saveSystemSettings() {
  try {
    const logoValue = currentLogoData || document.getElementById('storeLogo').value;
    console.log('Saving logo:', logoValue.substring(0, 50));

    // Tax Rate field was removed from the UI (VAT is product-level).
    // Keep the existing stored value for backward compatibility.
    const taxEl = document.getElementById('taxRate');
    const taxRate = taxEl
      ? (parseFloat(taxEl.value) / 100)
      : Number(systemSettings?.tax_rate ?? 0);
    
    const settings = {
      storeName: document.getElementById('storeName').value,
      storeLogo: logoValue,
      ownerName: document.getElementById('ownerName').value,
      nieNumber: document.getElementById('nieNumber').value,
      companyAddress: document.getElementById('companyAddress').value,
      currencySymbol: document.getElementById('currencySymbol').value,
      currencyCode: document.getElementById('currencyCode').value,
      taxRate: Number.isFinite(taxRate) ? taxRate : 0,
      receiptFooter: document.getElementById('receiptFooter').value,
      printerName: document.getElementById('printerName').value,
      customerDisplayPort: (document.getElementById('customerDisplayPort')?.value || '').toString().trim().toUpperCase() || null
    };
    
    systemSettings = await window.api.updateSystemSettings(settings);

    // Apply customer display port immediately so the COM is correct after restart.
    try {
      if (window.api && typeof window.api.setCustomerDisplayPreferredPort === 'function') {
        await window.api.setCustomerDisplayPreferredPort(settings.customerDisplayPort || '');
      }
    } catch {
      // ignore
    }
    // Settings saved - no popup
    
    // Update logo in the app
    await updateSystemUI();
  } catch (error) {
    alert('Error saving settings: ' + error.message);
  }
}

async function updateSystemUI() {
  // Reload settings
  systemSettings = await window.api.getSystemSettings();
  
  // Update branding (logo/name)
  await updateBrandingUI();
  
  // Update cart display with new currency
  updateCartDisplay();
  
  // Update any displayed prices
  if (allProducts.length > 0) {
    displayQuickProducts();
  }
}

// ============== LOAN HANDLERS ==============
function setupLoanHandlers() {
  // PARKING table Pay/Delete. Act on pointerdown (not just click): on touch screens
  // the first tap closes the virtual keyboard and shifts the layout, so the tap
  // never became a click and Pay seemed to do nothing. Click stays as a fallback
  // (keyboard/mouse), deduped so one tap never fires twice.
  let lastLoanActionAt = 0;
  const runLoanAction = (e) => {
    const btn = e.target?.closest?.('[data-loan-action]');
    if (!btn) return;
    if (e.type === 'pointerdown' && e.button !== 0) return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastLoanActionAt < 700) return;
    lastLoanActionAt = now;
    if (e.type === 'pointerdown') {
      // Swallow the click that follows this tap: otherwise it lands on whatever
      // just opened (e.g. the Delete confirm backdrop) and cancels it.
      const swallowNextClick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
      };
      document.addEventListener('click', swallowNextClick, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallowNextClick, true), 700);
    }
    if (btn.dataset.loanAction === 'pay') {
      payParkingInCheckout(btn.dataset.receipt, Number(btn.dataset.remaining || 0));
    } else if (btn.dataset.loanAction === 'delete') {
      deleteParking(Number(btn.dataset.loanId));
    }
  };
  const loansTbody = document.querySelector('#loansTable tbody');
  loansTbody?.addEventListener('pointerdown', runLoanAction);
  loansTbody?.addEventListener('click', runLoanAction);

  // Remember the currently chosen Quick Select party, so list reloads don't reset selection.
  let selectedLoanPartyKey = '';

  const loadExistingRestaurantParkings = async () => {
    const selectEl = document.getElementById('loanExistingRestaurant');
    const helpEl = document.getElementById('existingRestaurantHelp');
    if (!selectEl) return;

    selectEl.innerHTML = '';
    if (helpEl) helpEl.textContent = 'Loading...';

    try {
      const loans = await window.api.getAllLoans('active');
      const restaurants = (Array.isArray(loans) ? loans : [])
        .filter(l => (l.customer_type || '').toString().toLowerCase() === 'restaurant')
        .filter(l => (l.status || '').toString().toLowerCase() !== 'paid');

      // Deduplicate by (restaurant_name + restaurant_nie)
      const byKey = new Map();
      for (const l of restaurants) {
        const name = (l.restaurant_name || '').toString().trim();
        if (!name) continue;
        const nie = (l.restaurant_nie || '').toString().trim();
        const key = (name.toLowerCase() + '|' + nie);
        if (!byKey.has(key)) byKey.set(key, l);
      }

      const list = Array.from(byKey.values()).sort((a, b) => {
        const an = (a.restaurant_name || '').toString().toLowerCase();
        const bn = (b.restaurant_name || '').toString().toLowerCase();
        return an.localeCompare(bn);
      });

      if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No active restaurant parkings found';
        selectEl.appendChild(opt);
        if (helpEl) helpEl.textContent = 'Choose “Create new parking” to start a new tab.';
        return;
      }

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a restaurant...';
      selectEl.appendChild(placeholder);

      for (const l of list) {
        const name = (l.restaurant_name || '').toString().trim();
        const nie = (l.restaurant_nie || '').toString().trim();
        const remaining = Number(l.remaining_amount || 0);
        const currencySymbol = systemSettings?.currency_symbol || '€';
        const label = `${name}${nie ? ' (' + nie + ')' : ''} — Remaining: ${currencySymbol}${remaining.toFixed(2)}`;
        const opt = document.createElement('option');
        opt.value = String(l.id);
        opt.textContent = label;
        opt.dataset.restaurantName = name;
        opt.dataset.restaurantNie = nie;
        opt.dataset.customerName = (l.customer_name || '').toString();
        opt.dataset.customerPhone = (l.customer_phone || '').toString();
        selectEl.appendChild(opt);
      }

      if (helpEl) helpEl.textContent = 'This will add the new purchase into the selected restaurant parking tab.';
    } catch (e) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Failed to load restaurants';
      selectEl.appendChild(opt);
      if (helpEl) helpEl.textContent = e?.message ? String(e.message) : 'Error loading restaurants';
    }
  };

  const loadLoanParties = async (query = '') => {
    const selectEl = document.getElementById('loanPartySelect');
    const helpEl = document.getElementById('loanPartyHelp');
    if (!selectEl) return;

    const selectedType = (document.getElementById('loanCustomerType')?.value || '').toString().toLowerCase();
    const typeFilter = (selectedType === 'restaurant' || selectedType === 'regular') ? selectedType : '';

    selectEl.innerHTML = '';
    try {
      const list = await window.api.listLoanParties(query, 80);

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = typeFilter === 'restaurant'
        ? 'Select a restaurant (optional)...'
        : typeFilter === 'regular'
          ? 'Select a customer (optional)...'
          : 'Select a customer/restaurant (optional)...';
      selectEl.appendChild(placeholder);

      for (const p of (list || [])) {
        const type = (p.customer_type || 'regular').toString().toLowerCase();
        const isRestaurant = type === 'restaurant';

        if (typeFilter && type !== typeFilter) continue;
        // Regular customers park by numbered slot, not by name.
        if (type === 'regular') continue;

        const restName = (p.restaurant_name || '').toString().trim();
        const restNie = (p.restaurant_nie || '').toString().trim();
        const custName = (p.customer_name || '').toString().trim();
        const phone = (p.customer_phone || '').toString().trim();

        const activeId = Number(p.active_loan_id || 0) || null;
        const activeReceipt = (p.active_receipt_number || '').toString().trim();

        const labelCore = isRestaurant
          ? `${restName}${restNie ? ' (' + restNie + ')' : ''}`
          : `${custName}`;

        const sub = isRestaurant
          ? (custName ? ` — ${custName}` : '')
          : (phone ? ` — ${phone}` : '');

        const badge = activeId ? `  [UNPAID: ${activeReceipt || activeId}]` : '';
        const label = `${isRestaurant ? '🍽️ ' : '👤 '}${labelCore}${sub}${badge}`.trim();

        // Skip empty options
        if (!labelCore) continue;

        const opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = label;
        opt.dataset.customerType = type;
        opt.dataset.customerName = custName;
        opt.dataset.customerPhone = phone;
        opt.dataset.restaurantName = restName;
        opt.dataset.restaurantNie = restNie;
        opt.dataset.activeLoanId = activeId ? String(activeId) : '';
        opt.dataset.activeReceiptNumber = activeReceipt;
        selectEl.appendChild(opt);
      }

      // Re-apply selection after reload (if still present under the current filter).
      if (selectedLoanPartyKey) {
        const has = Array.from(selectEl.options).some(o => o.value === selectedLoanPartyKey);
        selectEl.value = has ? selectedLoanPartyKey : '';
        if (!has) selectedLoanPartyKey = '';
      }

      if (helpEl) {
        helpEl.textContent = typeFilter === 'restaurant'
          ? 'Pick a restaurant to auto-fill. If an unpaid tab exists, the sale will be added to it.'
          : typeFilter === 'regular'
            ? 'Pick a customer to auto-fill.'
            : 'Pick an existing customer/restaurant to auto-fill. If an unpaid tab exists, the sale will be added to it.';
      }
    } catch (e) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Failed to load list';
      selectEl.appendChild(opt);
      if (helpEl) helpEl.textContent = e?.message ? String(e.message) : 'Error loading list';
    }
  };

  const syncRestaurantParkingModeUi = async () => {
    const type = document.getElementById('loanCustomerType')?.value;
    const mode = document.querySelector('input[name="loanParkingMode"]:checked')?.value || 'append';

    const existingField = document.getElementById('existingRestaurantSelectField');
    const restaurantNameInput = document.getElementById('loanRestaurantName');
    const restaurantNieInput = document.getElementById('loanRestaurantNie');
    const customerNameInput = document.getElementById('loanCustomerName');
    const customerPhoneInput = document.getElementById('loanCustomerPhone');

    if (type !== 'restaurant') {
      if (existingField) existingField.style.display = 'none';
      return;
    }

    if (mode === 'append') {
      if (existingField) existingField.style.display = 'block';
      await loadExistingRestaurantParkings();

      // In existing mode, restaurant fields are auto-filled from selection.
      if (restaurantNameInput) {
        restaurantNameInput.required = false;
        restaurantNameInput.readOnly = true;
      }
      if (restaurantNieInput) restaurantNieInput.readOnly = true;
      if (customerNameInput) customerNameInput.readOnly = true;
      if (customerPhoneInput) customerPhoneInput.readOnly = true;
    } else {
      if (existingField) existingField.style.display = 'none';

      if (restaurantNameInput) {
        restaurantNameInput.required = true;
        restaurantNameInput.readOnly = false;
      }
      if (restaurantNieInput) {
        restaurantNieInput.readOnly = false;
      }
      if (customerNameInput) {
        customerNameInput.readOnly = false;
      }
      if (customerPhoneInput) {
        customerPhoneInput.readOnly = false;
      }
    }
  };

  const syncLoanQuickSelectVisibility = () => {
    const field = document.getElementById('loanQuickSelectField');
    if (!field) return;
    // Regular customers use numbered slots instead of names.
    const type = (document.getElementById('loanCustomerType')?.value || '').toString().toLowerCase();
    field.style.display = type === 'regular' ? 'none' : 'block';
  };

  // ---- Regular customer parking slots (Slot 1, Slot 2, ...) ----
  const PARKING_SLOT_PAGE = 20;
  let parkingSlotBusy = false;

  const parseSlotNumber = (name) => {
    const m = /^slot\s+(\d+)$/i.exec((name || '').toString().trim());
    return m ? parseInt(m[1], 10) : null;
  };

  const loadParkingSlots = async () => {
    const grid = document.getElementById('parkingSlotGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const used = new Map();
    try {
      const loans = await window.api.getAllLoans('active');
      for (const l of (Array.isArray(loans) ? loans : [])) {
        if ((l.customer_type || 'regular').toString().toLowerCase() !== 'regular') continue;
        if ((l.status || '').toString().toLowerCase() === 'paid') continue;
        const n = parseSlotNumber(l.customer_name);
        if (n && !used.has(n)) used.set(n, l);
      }
    } catch (e) {
      showAlert('Failed to load parking slots: ' + (e?.message || e), 'error');
    }

    // Show slots in blocks of 20; add another 20 once every visible slot is taken.
    const maxUsed = used.size ? Math.max(...used.keys()) : 0;
    let count = Math.max(PARKING_SLOT_PAGE, Math.ceil(maxUsed / PARKING_SLOT_PAGE) * PARKING_SLOT_PAGE);
    while (Array.from({ length: count }, (_, i) => i + 1).every(n => used.has(n))) {
      count += PARKING_SLOT_PAGE;
    }

    const currencySymbol = systemSettings?.currency_symbol || '€';
    for (let n = 1; n <= count; n++) {
      const loan = used.get(n);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'parking-slot' + (loan ? ' used' : '');
      btn.dataset.slot = String(n);
      if (loan) btn.dataset.loanId = String(loan.id);
      const sub = loan
        ? `${currencySymbol}${Number(loan.remaining_amount || 0).toFixed(2)}`
        : 'Free';
      btn.innerHTML = `<span class="ps-num">${n}</span><span class="ps-sub">${sub}</span>`;
      grid.appendChild(btn);
    }
  };

  document.getElementById('parkingSlotGrid')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.parking-slot');
    if (!btn || parkingSlotBusy) return;
    const slot = parseInt(btn.dataset.slot, 10);
    const loanId = parseInt(btn.dataset.loanId || '', 10);
    const hasLoan = Number.isFinite(loanId) && loanId > 0;
    const notesInput = document.getElementById('loanNotes');

    parkingSlotBusy = true;
    document.querySelectorAll('#parkingSlotGrid .parking-slot').forEach(b => { b.disabled = true; });
    try {
      await completeLoanSale(
        'regular',
        `Slot ${slot}`,
        '',
        '',
        '',
        '',
        hasLoan ? 'append' : 'new',
        hasLoan ? loanId : null
      );
      if (notesInput) notesInput.value = '';
    } finally {
      parkingSlotBusy = false;
      // Refresh occupancy (also re-enables buttons if the save failed).
      await loadParkingSlots();
    }
  });

  const syncRegularSlotsUi = () => {
    const type = (document.getElementById('loanCustomerType')?.value || '').toString().toLowerCase();
    const isRegular = type === 'regular';
    const slotsField = document.getElementById('regularSlotsField');
    const nameField = document.getElementById('loanCustomerNameField');
    const phoneField = document.getElementById('loanCustomerPhoneField');
    const nameInput = document.getElementById('loanCustomerName');
    const submitBtn = document.getElementById('loanSubmitBtn');

    if (slotsField) slotsField.style.display = isRegular ? 'block' : 'none';
    if (nameField) nameField.style.display = isRegular ? 'none' : 'block';
    if (phoneField) phoneField.style.display = isRegular ? 'none' : 'block';
    const notesField = document.getElementById('loanNotesField');
    if (notesField) notesField.style.display = isRegular ? 'none' : 'block';
    if (nameInput) nameInput.required = !isRegular;
    if (submitBtn) submitBtn.style.display = isRegular ? 'none' : '';

    if (isRegular) loadParkingSlots();
  };

  // Show Quick Select by default
  syncLoanQuickSelectVisibility();

  // Customer type cards -> drive the hidden select
  document.querySelectorAll('.customer-type-card').forEach((card) => {
    card.addEventListener('click', () => {
      const typeSelect = document.getElementById('loanCustomerType');
      if (!typeSelect) return;
      typeSelect.value = card.dataset.type || '';
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  // Customer type change handler
  document.getElementById('loanCustomerType')?.addEventListener('change', (e) => {
    const type = e.target.value;
    document.querySelectorAll('.customer-type-card').forEach((card) => {
      const on = card.dataset.type === type;
      card.classList.toggle('active', on);
      card.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const restaurantFields = document.getElementById('restaurantFields');
    const restaurantNieField = document.getElementById('restaurantNieField');
    const restaurantParkingModeField = document.getElementById('restaurantParkingModeField');
    const existingField = document.getElementById('existingRestaurantSelectField');
    const restaurantNameInput = document.getElementById('loanRestaurantName');
    
    if (type === 'restaurant') {
      restaurantFields.style.display = 'block';
      restaurantNieField.style.display = 'block';
      if (restaurantParkingModeField) restaurantParkingModeField.style.display = 'block';
      restaurantNameInput.required = true;
      // Default to append mode and sync UI
      const defaultMode = document.querySelector('input[name="loanParkingMode"][value="append"]');
      if (defaultMode) defaultMode.checked = true;
      syncRestaurantParkingModeUi();
      syncLoanQuickSelectVisibility();
    } else {
      restaurantFields.style.display = 'none';
      restaurantNieField.style.display = 'none';
      if (restaurantParkingModeField) restaurantParkingModeField.style.display = 'none';
      if (existingField) existingField.style.display = 'none';
      restaurantNameInput.required = false;
      restaurantNameInput.value = '';
      document.getElementById('loanRestaurantNie').value = '';

      // Reset parking mode choice to default
      const defaultMode = document.querySelector('input[name="loanParkingMode"][value="append"]');
      if (defaultMode) defaultMode.checked = true;

      syncLoanQuickSelectVisibility();
    }

    syncRegularSlotsUi();

    // Refresh quick select list to match the selected type filter
    const q = (document.getElementById('loanPartySearch')?.value || '').toString();
    loadLoanParties(q).catch(() => {
      // ignore
    });
  });

  // Quick select: initial load + actions
  const quickSearchInput = document.getElementById('loanPartySearch');
  const quickSelect = document.getElementById('loanPartySelect');

  const runQuickSearch = async () => {
    const q = String(quickSearchInput?.value || '').trim();
    await loadLoanParties(q);
  };

  document.getElementById('loanPartySearchBtn')?.addEventListener('click', runQuickSearch);
  document.getElementById('loanPartyRefreshBtn')?.addEventListener('click', async () => {
    if (quickSearchInput) quickSearchInput.value = '';
    await loadLoanParties('');
  });

  quickSearchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runQuickSearch();
    }
  });

  quickSelect?.addEventListener('change', async (e) => {
    const opt = e.target.selectedOptions?.[0];
    if (!opt || !opt.value) return;

    // Persist selection so a customer type change (triggered below) won't reset the dropdown.
    selectedLoanPartyKey = opt.value;

    const type = (opt.dataset.customerType || 'regular').toString().toLowerCase();
    const customerTypeSelect = document.getElementById('loanCustomerType');
    const restaurantNameInput = document.getElementById('loanRestaurantName');
    const restaurantNieInput = document.getElementById('loanRestaurantNie');
    const customerNameInput = document.getElementById('loanCustomerName');
    const customerPhoneInput = document.getElementById('loanCustomerPhone');

    // Switch the modal to the selected type
    if (customerTypeSelect) {
      customerTypeSelect.value = type;
      customerTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Restaurants: if an unpaid tab exists, auto-select append + that tab.
    // Otherwise, switch to "new" and then fill fields (so sync doesn't wipe them).
    if (type === 'restaurant') {
      const activeLoanId = parseInt(opt.dataset.activeLoanId || '', 10);
      const hasActive = Number.isFinite(activeLoanId) && activeLoanId > 0;

      const appendRadio = document.querySelector('input[name="loanParkingMode"][value="append"]');
      const newRadio = document.querySelector('input[name="loanParkingMode"][value="new"]');

      if (hasActive && appendRadio) {
        appendRadio.checked = true;
      } else if (newRadio) {
        newRadio.checked = true;
      }

      await syncRestaurantParkingModeUi();

      if (hasActive) {
        const selectEl = document.getElementById('loanExistingRestaurant');
        if (selectEl) {
          // Ensure options are loaded, then pick the active one.
          if (!selectEl.options || selectEl.options.length <= 1) {
            await loadExistingRestaurantParkings();
          }
          selectEl.value = String(activeLoanId);
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        // New tab but with prefilled info
        if (restaurantNameInput) restaurantNameInput.value = opt.dataset.restaurantName || '';
        if (restaurantNieInput) restaurantNieInput.value = opt.dataset.restaurantNie || '';
        if (customerNameInput) customerNameInput.value = opt.dataset.customerName || '';
        if (customerPhoneInput) customerPhoneInput.value = opt.dataset.customerPhone || '';
      }

      return;
    }

    // Regular customers: always prefill for a new tab
    if (customerNameInput) customerNameInput.value = opt.dataset.customerName || '';
    if (customerPhoneInput) customerPhoneInput.value = opt.dataset.customerPhone || '';
  });

  // Parking mode change (append/new)
  document.querySelectorAll('input[name="loanParkingMode"]').forEach((r) => {
    r.addEventListener('change', () => {
      syncRestaurantParkingModeUi();
    });
  });

  // Existing restaurant selection -> auto-fill fields
  document.getElementById('loanExistingRestaurant')?.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions?.[0];
    if (!opt) return;
    const restaurantNameInput = document.getElementById('loanRestaurantName');
    const restaurantNieInput = document.getElementById('loanRestaurantNie');
    const customerNameInput = document.getElementById('loanCustomerName');
    const customerPhoneInput = document.getElementById('loanCustomerPhone');

    if (restaurantNameInput) restaurantNameInput.value = opt.dataset.restaurantName || '';
    if (restaurantNieInput) restaurantNieInput.value = opt.dataset.restaurantNie || '';
    if (customerNameInput) customerNameInput.value = opt.dataset.customerName || '';
    if (customerPhoneInput) customerPhoneInput.value = opt.dataset.customerPhone || '';
  });

  // Refresh button
  document.getElementById('refreshExistingRestaurantBtn')?.addEventListener('click', async () => {
    await loadExistingRestaurantParkings();
  });

  // Load quick select list on first open
  // (loanModal opens before handlers run in some flows; keep this best-effort)
  loadLoanParties('').catch(() => {
    // ignore
  });

  // Loan form submit
  document.getElementById('loanForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const customerType = document.getElementById('loanCustomerType').value;
    const customerName = document.getElementById('loanCustomerName').value;
    const customerPhone = document.getElementById('loanCustomerPhone').value;
    const restaurantName = document.getElementById('loanRestaurantName').value;
    const restaurantNie = document.getElementById('loanRestaurantNie').value;
    const notes = document.getElementById('loanNotes').value;

    if (!customerType) {
      showAlert('Please choose Regular Customer or Restaurant', 'warning');
      return;
    }
    if (customerType === 'regular') {
      showAlert('Tap a parking slot number to save', 'warning');
      return;
    }

    const parkingMode = document.querySelector('input[name="loanParkingMode"]:checked')?.value || 'append';

    // If restaurant + existing mode, require selecting an existing loan id
    let targetLoanId = null;
    if (customerType === 'restaurant' && parkingMode === 'append') {
      const selected = document.getElementById('loanExistingRestaurant')?.value;
      if (!selected) {
        showAlert('Please select an existing restaurant parking', 'warning');
        return;
      }
      targetLoanId = parseInt(selected, 10);
      if (!Number.isFinite(targetLoanId)) {
        showAlert('Please select an existing restaurant parking', 'warning');
        return;
      }
    }
    
    await completeLoanSale(customerType, customerName, customerPhone, restaurantName, restaurantNie, notes, parkingMode, targetLoanId);
    
    // Reset form
    e.target.reset();
    document.getElementById('restaurantFields').style.display = 'none';
    document.getElementById('restaurantNieField').style.display = 'none';
    const pm = document.getElementById('restaurantParkingModeField');
    if (pm) pm.style.display = 'none';

    const defaultMode = document.querySelector('input[name="loanParkingMode"][value="append"]');
    if (defaultMode) defaultMode.checked = true;
  });

  // Note form submit
  document.getElementById('noteForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const noteInput = document.getElementById('invoiceNote');
    
    // Save the note
    currentInvoiceNote = noteInput.value.trim();
    
    // Close modal
    closeModal('noteModal');
    
    // Show confirmation if note was added
    if (currentInvoiceNote) {
      showAlert('Note added to invoice', 'success');
    }
  });
  
  // Search loan button
  document.getElementById('searchLoanBtn')?.addEventListener('click', () => {
    const receiptNumber = document.getElementById('loanReceiptSearch').value;
    handleLoanSearchSubmit(receiptNumber);
  });

  // Clear search
  document.getElementById('clearLoanSearchBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('loanReceiptSearch');
    if (input) input.value = '';
    currentLoansSearchQuery = '';
    await loadLoansView(currentLoansStatus || 'active');
    try { input?.focus?.(); } catch { /* ignore */ }
  });
  
  // Loan receipt search - allow Enter key
  document.getElementById('loanReceiptSearch')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const receiptNumber = e.target.value;
      handleLoanSearchSubmit(receiptNumber);
    }
  });
  
  // Loan filter tabs
  document.querySelectorAll('.loan-filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.loan-filter-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      
      const status = e.target.dataset.status;
      // For 'all' status, exclude paid transactions to keep the list clean
      loadLoansView(status === 'all' ? 'active' : status);
    });
  });
}

// ============== MODALS ==============
function setupModalHandlers() {
  // Close buttons
  document.querySelectorAll('.close, .modal-close, .cancel-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const modal = e.target.closest('.modal');
      if (modal) {
        closeModal(modal.id);
      }
    });
  });
  
  // Close on outside click
  document.querySelectorAll('.modal').forEach(modal => {
    // Only a press that *starts* on the backdrop may close the modal. Tapping an
    // input opens the virtual keyboard, which moves the dialog up; the release then
    // lands on the backdrop and the resulting click used to close the modal.
    let pressStartedOnBackdrop = false;
    modal.addEventListener('pointerdown', (e) => {
      pressStartedOnBackdrop = e.target === modal;
    }, true);
    modal.addEventListener('click', (e) => {
      if (!pressStartedOnBackdrop) return;
      pressStartedOnBackdrop = false;
      // Guard against touch devices generating a delayed click after pressing
      // the on-screen keyboard buttons ("click-through" onto the backdrop).
      const vkLast = Number(window.__virtualKeyboardLastPressAt || 0);
      if (vkLast && (Date.now() - vkLast) < 600) {
        return;
      }
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
  });
  
  // Print receipt - with debounce to prevent multiple prints
  let isPrinting = false;
  const printBtn = document.getElementById('printReceiptBtn');
  if (printBtn) {
    // Remove any existing listeners by cloning the button
    const newPrintBtn = printBtn.cloneNode(true);
    printBtn.parentNode.replaceChild(newPrintBtn, printBtn);

    newPrintBtn.addEventListener('click', async () => {
      if (isPrinting) {
        console.log('Print already in progress, ignoring duplicate request');
        return;
      }

      if (!lastSale) {
        console.log('No sale to print');
        return;
      }

      isPrinting = true;
      const saleId = Number(lastSale?.id);
      const prev = Number(printedReceiptCounts.get(saleId) || 0);
      const next = prev + 1;
      printedReceiptCounts.set(saleId, next);

      const duplicateNumber = next > 1 ? (next - 1) : 0;
      console.log(duplicateNumber ? `Printing receipt (DUPLICATE ${duplicateNumber})...` : 'Printing receipt...');
      await printReceiptToThermalPrinter(lastSale, { duplicateNumber, kickDrawer: false });

      // Do NOT open cash drawer here; it is only opened on complete sale

      // Close receipt modal after print action
      closeModal('receiptModal');

      // Reset flag after 2 seconds
      setTimeout(() => {
        isPrinting = false;
      }, 2000);
    });
  }
  
  // Virtual keyboard removed
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');

  // If a CASH sale just finished, show the cashier summary after the receipt is closed.
  if (modalId === 'receiptModal' && pendingCashierPaySummary) {
    try {
      showCashierPaymentSummaryOverlay(pendingCashierPaySummary);
    } catch {
      // ignore
    } finally {
      pendingCashierPaySummary = null;
    }
  }
}

// ============== PRODUCT IMAGE HANDLING ==============
function clearProductImage() {
  document.getElementById('productImage').value = '';
  document.getElementById('productImagePreview').style.display = 'none';
  document.getElementById('productImageName').textContent = 'No image selected';
}

// Setup image preview handler
document.addEventListener('DOMContentLoaded', () => {
  const imageInput = document.getElementById('productImage');
  if (imageInput) {
    imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          document.getElementById('productImagePreviewImg').src = e.target.result;
          document.getElementById('productImagePreview').style.display = 'block';
          document.getElementById('productImageName').textContent = file.name;
        };
        reader.readAsDataURL(file);
      }
    });
  }
});

// ============== VIRTUAL KEYBOARD ==============
let currentKeyboardInput = null;
let virtualKeyboardInitialized = false;
let lastPointerInteractionAt = 0;
let lastVirtualKeyboardOpenAt = 0;

function markPointerInteraction(e) {
  // Only treat taps/clicks on real input fields as "intent to type".
  // This prevents the keyboard from popping up when the user taps elsewhere
  // (e.g., product cards) and the app focuses an input programmatically.
  try {
    const target = e?.target;
    if (!target) return;

    // In modals/overlays, users often tap near/around the field first.
    // Treat ANY tap inside an active modal as intent-to-type so the keyboard
    // reliably opens when an input inside that modal receives focus.
    const inModal = typeof target.closest === 'function'
      ? target.closest('.modal.active, #unitPriceEntryOverlay, #rolePasswordOverlay, #copilotConfirmOverlay, #quickAddProductOverlay, #quickVatPromptOverlay')
      : null;
    if (inModal) {
      lastPointerInteractionAt = Date.now();
      return;
    }

    const field = typeof target.closest === 'function'
      ? target.closest('input, textarea, select')
      : null;
    if (!field) return;

    // Ignore hidden/readonly/disabled fields
    const tag = (field.tagName || '').toUpperCase();
    if (tag === 'INPUT') {
      const type = (field.getAttribute('type') || 'text').toLowerCase();
      const excluded = new Set(['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'color', 'date', 'datetime-local', 'month', 'week', 'time']);
      if (excluded.has(type)) return;
      if (field.readOnly || field.disabled) return;
    } else if (tag === 'TEXTAREA') {
      if (field.readOnly || field.disabled) return;
    } else if (tag === 'SELECT') {
      if (field.disabled) return;
    } else {
      return;
    }

    lastPointerInteractionAt = Date.now();
  } catch {
    // ignore
  }
}

function shouldAutoOpenVirtualKeyboard() {
  // Only auto-open the on-screen keyboard after an actual tap/click.
  // This prevents the keyboard from popping up at app launch when we programmatically focus inputs.
  const now = Date.now();
  // Allow code paths to programmatically focus fields (e.g. refocusing the
  // scanner/search target) without triggering the on-screen keyboard.
  // One-shot: callers should set window.__virtualKeyboardSuppressOnce = true
  // immediately before calling .focus().
  const suppressed = window.__virtualKeyboardSuppressOnce === true;
  const forced = window.__virtualKeyboardForceOpen === true;
  if (forced) {
    window.__virtualKeyboardForceOpen = false;
    return true;
  }
  if (suppressed) {
    window.__virtualKeyboardSuppressOnce = false;
    return false;
  }
  return (now - lastPointerInteractionAt) < 1500;
}

function setupVirtualKeyboard() {
  if (virtualKeyboardInitialized) return;
  const keyboard = document.getElementById('virtualKeyboard');
  if (!keyboard) return;

  // Expose keyboard height so modals can avoid being covered.
  // We keep it on :root so CSS can use it anywhere.
  const syncVirtualKeyboardInset = () => {
    try {
      const isActive = keyboard.classList.contains('active');
      const rect = keyboard.getBoundingClientRect();
      const height = isActive ? Math.max(0, Math.round(rect.height || 0)) : 0;
      document.documentElement.style.setProperty('--vk-height', `${height}px`);
      document.body.classList.toggle('vk-open', isActive && height > 0);
    } catch {
      // ignore
    }
  };

  const closeVirtualKeyboard = ({ blurInput = false } = {}) => {
    try {
      if (currentKeyboardInput) {
        currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch {
      // ignore
    }

    if (blurInput) {
      try {
        const activeEl = document.activeElement;
        const fieldToBlur = currentKeyboardInput || activeEl;
        const tag = (fieldToBlur?.tagName || '').toUpperCase();
        if (fieldToBlur && typeof fieldToBlur.blur === 'function' && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
          fieldToBlur.blur();
        }
      } catch {
        // ignore
      }
    }

    keyboard.classList.remove('active');
    currentKeyboardInput = null;
    isShiftActive = false;
    isCapsLocked = false;
    updateKeyboardCase();
    syncVirtualKeyboardInset();
  };

  // Close button (optional)
  try {
    const closeBtn = document.getElementById('virtualKeyboardClose');
    if (closeBtn && !closeBtn.dataset.listenerAttached) {
      closeBtn.dataset.listenerAttached = '1';
      closeBtn.addEventListener('click', () => {
        closeVirtualKeyboard({ blurInput: true });
      });
    }
  } catch {
    // ignore
  }

  // Mark initialized early to avoid double-binding in case setupVirtualKeyboard()
  // is invoked more than once during startup.
  virtualKeyboardInitialized = true;

  // Hard reset: if any handlers were accidentally bound multiple times in previous
  // runs/versions, replace the keyboard button subtree to strip all listeners.
  // We then attach ONE delegated handler below.
  try {
    const btnRoot = keyboard.querySelector('.keyboard-buttons');
    if (btnRoot && keyboard.dataset.vkButtonsReset !== '1') {
      keyboard.dataset.vkButtonsReset = '1';
      const clone = btnRoot.cloneNode(true);
      btnRoot.parentNode.replaceChild(clone, btnRoot);
    }
  } catch {
    // ignore
  }

  // Track pointer/touch interactions so we only auto-open on real user taps.
  try {
    if (!setupVirtualKeyboard._pointerTrackingAttached) {
      setupVirtualKeyboard._pointerTrackingAttached = true;
      document.addEventListener('pointerdown', markPointerInteraction, true);
      document.addEventListener('touchstart', markPointerInteraction, { capture: true, passive: true });
      document.addEventListener('mousedown', markPointerInteraction, true);
    }
  } catch {
    // ignore
  }

  // Keep inset synced while opening/closing and on resize.
  try {
    if (!setupVirtualKeyboard._vkInsetAttached) {
      setupVirtualKeyboard._vkInsetAttached = true;
      syncVirtualKeyboardInset();
      if (typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(() => syncVirtualKeyboardInset());
        obs.observe(keyboard, { attributes: true, attributeFilter: ['class', 'style'] });
        setupVirtualKeyboard._vkInsetObserver = obs;
      }
      window.addEventListener('resize', () => syncVirtualKeyboardInset(), true);
    }
  } catch {
    // ignore
  }
  const keyButtons = keyboard.querySelectorAll('.key-btn');
  let isShiftActive = false;
  let isCapsLocked = false;
  let keyboardMode = 'text'; // 'text' | 'numeric'
  
  // Initialize keyboard in lowercase mode
  function updateKeyboardCase() {
    keyButtons.forEach(btn => {
      const key = btn.dataset.key;
      if (key && key.length === 1 && /[A-Z]/.test(key)) {
        btn.textContent = isShiftActive ? key.toUpperCase() : key.toLowerCase();
      }
    });
    
    // Update shift key appearance
    const shiftBtn = document.querySelector('.key-shift');
    if (shiftBtn) {
      if (isShiftActive) {
        shiftBtn.style.background = 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
        shiftBtn.style.color = 'white';
        shiftBtn.style.boxShadow = isCapsLocked ? 'inset 0 0 0 3px rgba(0,0,0,0.18)' : 'none';
      } else {
        shiftBtn.style.background = 'white';
        shiftBtn.style.color = '#1e293b';
        shiftBtn.style.boxShadow = 'none';
      }
    }
  }
  
  updateKeyboardCase();

  function isNumericKeyboardTarget(el) {
    if (!el || el.tagName !== 'INPUT') return false;

    const attrInputMode = (el.getAttribute('inputmode') || '').toLowerCase();
    const propInputMode = (el.inputMode || '').toLowerCase();
    const inputMode = attrInputMode || propInputMode;
    const type = ((el.getAttribute('type') || el.type) || '').toLowerCase();

    if (inputMode === 'numeric' || inputMode === 'decimal' || inputMode === 'tel') return true;
    if (type === 'number' || type === 'tel') return true;

    // Known numeric fields
    if (el.id === 'weightInput' || el.id === 'weightPriceInput') return true;

    return false;
  }

  function setKeyboardMode(mode) {
    keyboardMode = mode === 'numeric' ? 'numeric' : 'text';

    // Reset shift when switching modes
    if (keyboardMode === 'numeric' && (isShiftActive || isCapsLocked)) {
      isShiftActive = false;
      isCapsLocked = false;
      updateKeyboardCase();
    }

    keyButtons.forEach(btn => {
      const key = btn.dataset.key;
      const modeSwitch = btn.dataset.mode;
      const isNumberKey = btn.classList.contains('key-number');
      const isBackspaceNumeric = btn.classList.contains('key-backspace-numeric');
      const isBackspaceText = btn.classList.contains('key-backspace-text');
      const isDone = btn.classList.contains('key-done') || key === 'Done';
      const isSpace = btn.classList.contains('key-space') || key === ' ';
      const isShift = btn.classList.contains('key-shift') || key === 'Shift';
      const isSpecial = btn.classList.contains('key-special');
      const isDecimal = key === '.';

      // Letter keys are defined with uppercase A-Z in data-key.
      const isLetterKey = !!(key && key.length === 1 && /[A-Z]/.test(key) && !isNumberKey);

      // Mode switch buttons: show 123 in text mode, show ABC in numeric mode
      const is123Button = modeSwitch === 'numeric';
      const isABCButton = modeSwitch === 'text';

      const shouldShow = (keyboardMode === 'numeric')
        ? (isNumberKey || isDecimal || isBackspaceNumeric || isDone || isSpecial || isABCButton)
        : (isLetterKey || isSpace || isShift || isBackspaceText || isDone || is123Button);

      btn.style.display = shouldShow ? '' : 'none';
    });

    // Hide empty rows to avoid big gaps
    document.querySelectorAll('#virtualKeyboard .keyboard-row').forEach(row => {
      const hasVisibleButton = Array.from(row.querySelectorAll('.key-btn')).some(b => b.style.display !== 'none');
      row.style.display = hasVisibleButton ? '' : 'none';
    });
  }

  function isVisibleFocusable(el) {
    if (!el || el.disabled) return false;
    const tag = (el.tagName || '').toUpperCase();
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;

    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const excluded = new Set(['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'color', 'date', 'datetime-local', 'month', 'week', 'time']);
      if (excluded.has(type)) return false;
      if (el.readOnly) return false;
      return true;
    }
    if (tag === 'TEXTAREA') {
      if (el.readOnly) return false;
      return true;
    }
    if (tag === 'SELECT') return true;
    return false;
  }

  function isKeyboardEligibleField(el) {
    if (!isVisibleFocusable(el)) return false;
    if ((el?.tagName || '').toUpperCase() === 'INPUT' && el.id === 'barcodeInput') return false;
    if (el?.dataset?.noVk === '1' || el?.dataset?.noVk === 'true') return false;
    return true;
  }

  function activateVirtualKeyboardForField(target, { ensureFocus = false } = {}) {
    if (!isKeyboardEligibleField(target)) return false;

    currentKeyboardInput = target;
    setKeyboardMode(isNumericKeyboardTarget(target) ? 'numeric' : 'text');
    keyboard.classList.add('active');
    lastVirtualKeyboardOpenAt = Date.now();
    syncVirtualKeyboardInset();

    if (ensureFocus) {
      try {
        target.focus();
      } catch {
        // ignore
      }
    }

    try {
      const len = String(target.value || '').length;
      if (typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(len, len);
      }
    } catch {
      // ignore selection errors for some input types
    }

    return true;
  }

  function focusNextFieldInModal(modalEl, currentEl) {
    if (!modalEl) return false;
    const fields = Array.from(modalEl.querySelectorAll('input, select, textarea')).filter(isVisibleFocusable);
    if (fields.length === 0) return false;

    const currentIndex = fields.indexOf(currentEl);
    const nextEl = (currentIndex >= 0) ? fields[currentIndex + 1] : fields[0];
    if (!nextEl) return false;

    try {
      nextEl.focus();
      const len = (nextEl.value || '').length;
      if (typeof nextEl.setSelectionRange === 'function') {
        nextEl.setSelectionRange(len, len);
      }
    } catch {
      // ignore
    }

    return activateVirtualKeyboardForField(nextEl);
  }
  
  // Show keyboard when inputs are focused (except barcode input)
  document.addEventListener('focusin', (e) => {
    const target = e.target;

    // Do not pop up automatically unless user actually tapped/clicked,
    // or the app explicitly requested it via __virtualKeyboardForceOpen.
    if (!shouldAutoOpenVirtualKeyboard()) return;

    activateVirtualKeyboardForField(target);
  });
  
  // Handle key presses (delegated). This avoids double-binding issues and prevents
  // touchscreen environments from inserting duplicate characters.
  const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
  let lastTouchLikeAt = 0;
  let lastActivationAt = 0;
  let lastActivationSig = '';

  const handleKeyPressForButton = (btn) => {
    const key = btn?.dataset?.key;
    const mode = btn?.dataset?.mode;
      
    // Handle mode switch (123 / ABC buttons)
    if (mode) {
      setKeyboardMode(mode);
      return;
    }
      
    if (key === 'Shift') {
      // Sticky caps lock: stays on until Shift is tapped again.
      isShiftActive = !isShiftActive;
      isCapsLocked = isShiftActive;
      updateKeyboardCase();
      return;
    }

    if (key === 'Backspace') {
      if (currentKeyboardInput) {
        try {
          const v = String(currentKeyboardInput.value || '');
          const start = Number.isFinite(currentKeyboardInput.selectionStart) ? currentKeyboardInput.selectionStart : v.length;
          const end = Number.isFinite(currentKeyboardInput.selectionEnd) ? currentKeyboardInput.selectionEnd : start;

          if (start !== end) {
            // Delete selected range
            currentKeyboardInput.value = v.substring(0, start) + v.substring(end);
            currentKeyboardInput.setSelectionRange(start, start);
          } else if (start > 0) {
            // Delete one char before cursor
            currentKeyboardInput.value = v.substring(0, start - 1) + v.substring(end);
            const newPos = Math.max(0, start - 1);
            currentKeyboardInput.setSelectionRange(newPos, newPos);
          }
        } catch {
          // Fallback
          currentKeyboardInput.value = String(currentKeyboardInput.value || '').slice(0, -1);
        }
        currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    if (key === 'Done') {
      if (currentKeyboardInput) {
        currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));

          // In Product + Category modals, "Done" should act like "Next": jump to next field.
          // This avoids implicit form submit and speeds up data entry on touchscreens.
          const modal = currentKeyboardInput.closest('#productModal, #categoryModal');
          if (modal) {
            currentKeyboardInput.dispatchEvent(new Event('change', { bubbles: true }));
            const moved = focusNextFieldInModal(modal, currentKeyboardInput);
            if (moved) {
              isShiftActive = false;
              isCapsLocked = false;
              updateKeyboardCase();
              return;
            }
          }

          // Touchscreen keyboards commonly map "Done" to Enter.
          // For inputs inside a <form>, synthesizing Enter triggers an implicit submit,
          // which closes modals like "Add Product" unexpectedly.
          const isInsideForm = !!currentKeyboardInput.closest('form');
          if (!isInsideForm) {
            // Trigger Enter key event to save edits for non-form inline editors/search fields.
            const enterEvent = new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            });
            currentKeyboardInput.dispatchEvent(enterEvent);
          }

          // Commit value and release focus
          currentKeyboardInput.dispatchEvent(new Event('change', { bubbles: true }));
          try {
            currentKeyboardInput.blur();
          } catch {
            // ignore
          }
      }
      keyboard.classList.remove('active');
      currentKeyboardInput = null;
      isShiftActive = false;
      isCapsLocked = false;
      updateKeyboardCase();
      syncVirtualKeyboardInset();
      return;
    }

    // Normal character key
    const actualKey = btn.textContent === 'SPACE' ? ' ' : btn.textContent;
    if (currentKeyboardInput) {
      // Extra guard: never inject letters into numeric mode.
      if (keyboardMode === 'numeric' && /[a-zA-Z]/.test(actualKey)) return;

      // Insert at cursor position (works for both text + numeric), and respect selection.
      try {
        let v = String(currentKeyboardInput.value || '');
        let start = Number.isFinite(currentKeyboardInput.selectionStart) ? currentKeyboardInput.selectionStart : v.length;
        let end = Number.isFinite(currentKeyboardInput.selectionEnd) ? currentKeyboardInput.selectionEnd : start;

        // Some inline editors want the first key to replace the entire value.
        const replaceAllOnNextKey = currentKeyboardInput.dataset?.replaceOnNextKey === '1';
        if (replaceAllOnNextKey) {
          start = 0;
          end = v.length;
          try { currentKeyboardInput.dataset.replaceOnNextKey = '0'; } catch { /* ignore */ }
        }

        v = v.substring(0, start) + actualKey + v.substring(end);
        currentKeyboardInput.value = v;

        const newCursorPos = start + actualKey.length;
        if (typeof currentKeyboardInput.setSelectionRange === 'function') {
          currentKeyboardInput.setSelectionRange(newCursorPos, newCursorPos);
        }
      } catch {
        // Fallback: append
        currentKeyboardInput.value = String(currentKeyboardInput.value || '') + actualKey;
      }

      currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const delegatedPressHandler = (e) => {
    try {
      // Allow the keyboard close button to work normally
      if (e?.target?.closest?.('.keyboard-close')) return;

      const btn = e?.target?.closest?.('.key-btn');
      if (!btn) return;
      if (btn.disabled) return;

      const now = Date.now();

      // Mark touch-like interactions.
      try {
        const pt = e?.pointerType;
        if (e?.type === 'touchstart' || pt === 'touch' || pt === 'pen') {
          lastTouchLikeAt = now;
        }
      } catch {
        // ignore
      }

      // Some touchscreens emit events twice: once as touch, then as mouse.
      try {
        const pt = e?.pointerType;
        if ((e?.type === 'pointerdown' || e?.type === 'mousedown') && pt === 'mouse' && (now - lastTouchLikeAt) < 1200) return;
        if (e?.type === 'mousedown' && (now - lastTouchLikeAt) < 1200) return;
      } catch {
        // ignore
      }

      // One-tap == one activation: de-dupe by key signature within a short window.
      const sig = String(btn.dataset.key || btn.textContent || '').trim();
      if (sig && sig === lastActivationSig && (now - lastActivationAt) < 250) return;
      lastActivationSig = sig;
      lastActivationAt = now;

      // Stop the event before it reaches button-level handlers (capture).
      try {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
      } catch {
        // ignore
      }

      window.__virtualKeyboardLastPressAt = now;
      handleKeyPressForButton(btn);
    } catch {
      // ignore
    }
  };

  // Attach delegated handler once
  if (keyboard.dataset.vkDelegatedAttached !== '1') {
    keyboard.dataset.vkDelegatedAttached = '1';
    if (supportsPointerEvents) {
      keyboard.addEventListener('pointerdown', delegatedPressHandler, true);
    } else {
      keyboard.addEventListener('touchstart', delegatedPressHandler, { capture: true, passive: false });
      keyboard.addEventListener('mousedown', delegatedPressHandler, true);
    }
  }
  
  // Use pointerdown instead of click so long-press gestures don't generate a
  // delayed "outside click" that immediately hides the keyboard after opening.
  document.addEventListener('pointerdown', (e) => {
    if (keyboard.contains(e.target)) return;

    const tappedField = typeof e?.target?.closest === 'function'
      ? e.target.closest('input, textarea, select')
      : null;
    const fieldContainer = !tappedField && typeof e?.target?.closest === 'function'
      ? e.target.closest('label, .form-group, .input-group')
      : null;
    const containerField = fieldContainer && typeof fieldContainer.querySelector === 'function'
      ? fieldContainer.querySelector('input, textarea, select')
      : null;
    const targetField = isKeyboardEligibleField(tappedField)
      ? tappedField
      : (isKeyboardEligibleField(containerField) ? containerField : null);

    if (targetField) {
      try { window.__virtualKeyboardForceOpen = true; } catch { /* ignore */ }
      activateVirtualKeyboardForField(targetField, { ensureFocus: document.activeElement !== targetField });
      return;
    }

    if (!keyboard.classList.contains('active')) return;

    // Ignore the same gesture window that just opened the keyboard.
    if ((Date.now() - lastVirtualKeyboardOpenAt) < 250) return;

    closeVirtualKeyboard({ blurInput: true });
  }, true);
}

// ============== RETURNS HANDLERS ==============
function setupReturnsHandlers() {
  document.getElementById('processReturnBtn')?.addEventListener('click', () => {
    openReturnModal();
  });
  
  document.getElementById('lookupReceiptBtn')?.addEventListener('click', async () => {
    await lookupSaleForReturn();
  });
  
  document.getElementById('returnForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await completeReturn();
  });
}

async function loadReturnsView() {
  if (!hasPermission('sales')) {
    showAlert('Access Denied: You do not have permission to view returns', 'error', 'Access Denied');
    return;
  }
  
  const returns = await window.api.getAllReturns();
  displayReturns(returns);
}

function displayReturns(returns) {
  const tbody = document.querySelector('#returnsTable tbody');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  if (returns.length === 0) {
    tbody.innerHTML = '<tr><td colspan=\"7\" class=\"empty-state\"><div class=\"icon\">↩️</div><p>No returns processed</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = returns.map(ret => {
    const date = parseAppDateTimeLoose(ret.return_date);
    const items = ret.items ? JSON.parse(ret.items) : [];
    const itemCount = items.length;
    const computedTotal = Array.isArray(items)
      ? items.reduce((sum, it) => sum + (Number(it?.subtotal) || 0), 0)
      : (Number(ret.total) || 0);
    
    return `
      <tr>
        <td>${formatDateTimeWithDisplayTimeZone(date, 'en-GB', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}</td>
        <td>#${ret.original_sale_id}</td>
        <td>${itemCount} item(s)</td>
        <td>${currencySymbol}${computedTotal.toFixed(2)}</td>
        <td><span class=\"status-badge\">${ret.refund_method.toUpperCase()}</span></td>
        <td>${ret.reason || '-'}</td>
        <td>
          <button class=\"action-btn\" onclick=\"viewReturnDetails(${ret.id})\" title=\"View Details\">👁️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function openReturnModal() {
  const modal = document.getElementById('returnModal');
  const form = document.getElementById('returnForm');
  form.reset();
  document.getElementById('returnSaleDetails').style.display = 'none';
  document.getElementById('completeReturnBtn').disabled = true;
  modal.classList.add('active');
}

let currentReturnSale = null;
let selectedReturnItems = [];

async function getExistingReturnForSaleId(originalSaleId) {
  // Preferred fast path (requires new IPC handler)
  try {
    if (window.api?.getReturnBySaleId) {
      const r = await window.api.getReturnBySaleId(originalSaleId);
      if (r) return r;
    }
  } catch (e) {
    // Fallback for older running main process (no handler registered)
  }

  try {
    const all = await window.api.getAllReturns();
    const returns = Array.isArray(all) ? all : (all?.returns || []);
    let latest = null;
    returns.forEach(r => {
      if (Number(r?.original_sale_id) !== Number(originalSaleId)) return;
      if (!latest) {
        latest = r;
        return;
      }
      const a = new Date(latest?.return_date || 0).getTime();
      const b = new Date(r?.return_date || 0).getTime();
      if (b >= a) latest = r;
    });
    return latest;
  } catch {
    return null;
  }
}

async function lookupSaleForReturn() {
  const receiptNumber = document.getElementById('returnReceiptNumber').value.trim();
  
  if (!receiptNumber) {
    showAlert('Please enter a receipt number', 'warning', 'Receipt Required');
    return;
  }
  
  try {
    // Try to find sale by ID
    const sale = await window.api.getSaleById(parseInt(receiptNumber));
    
    if (!sale) {
      showAlert('Sale not found with receipt #' + receiptNumber, 'error', 'Not Found');
      return;
    }

    // An unpaid/partly paid PARKING was never (fully) collected, so refunding it
    // would pay out money that was not received. It is removed from PARKING instead.
    const loanStatus = String(sale.loan_status || '').toLowerCase();
    if (loanStatus && loanStatus !== 'paid') {
      showAlert(`Receipt #${sale.id} is a PARKING that is not paid yet.\nIt cannot be refunded. Delete or edit it in PARKING instead.`, 'warning', 'Unpaid PARKING');
      return;
    }

    // Only allow one return per receipt
    const existingReturn = await getExistingReturnForSaleId(sale.id);
    if (existingReturn) {
      const when = existingReturn.return_date
        ? formatDateTimeWithDisplayTimeZone(parseAppDateTimeLoose(existingReturn.return_date), 'en-GB', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
        : 'unknown date';
      showAlert(`Receipt #${sale.id} was already refunded.\nReturn ID: ${existingReturn.id}\nDate: ${when}`, 'warning', 'Already Refunded');
      return;
    }
    
    currentReturnSale = sale;
    selectedReturnItems = [];
    
    // Display sale items
    const itemsList = document.getElementById('returnItemsList');
    const currencySymbol = systemSettings?.currency_symbol || '€';
    
    itemsList.innerHTML = sale.items.map((item, index) => `
      <div class=\"return-item\">
        <input type=\"checkbox\" class=\"return-item-checkbox\" data-index=\"${index}\" checked>
        <div class=\"return-item-info\">
          <div class=\"return-item-name\">${item.product_name}</div>
          <div class=\"return-item-details\">Qty: ${item.quantity} × ${currencySymbol}${item.unit_price.toFixed(2)} = ${currencySymbol}${item.subtotal.toFixed(2)}</div>
        </div>
      </div>
    `).join('');
    
    // Add change listeners to checkboxes
    document.querySelectorAll('.return-item-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', calculateReturnTotal);
    });
    
    document.getElementById('returnSaleDetails').style.display = 'block';
    document.getElementById('completeReturnBtn').disabled = false;
    
    calculateReturnTotal();
  } catch (error) {
    showAlert('Error loading sale: ' + error.message, 'error', 'Error');
  }
}

function calculateReturnTotal() {
  const checkboxes = document.querySelectorAll('.return-item-checkbox:checked');
  selectedReturnItems = [];
  let subtotalCents = 0;
  let taxCents = 0;
  let totalCents = 0;
  
  checkboxes.forEach(checkbox => {
    const index = parseInt(checkbox.dataset.index);
    const item = currentReturnSale.items[index];
    selectedReturnItems.push(item);
    
    // Sale item subtotals are tax-inclusive. Extract base + tax from the gross.
    const product = allProducts.find(p => p.id === item.product_id);
    const taxRateRaw = Number(product?.tax_rate);
    const taxRate = Number.isFinite(taxRateRaw) ? taxRateRaw : 0;

    const lineTotalCents = moneyToCents(item.subtotal || 0);
    const baseCents = taxRate > 0 ? Math.round(lineTotalCents / (1 + taxRate)) : lineTotalCents;
    const lineTaxCents = lineTotalCents - baseCents;

    totalCents += lineTotalCents;
    subtotalCents += baseCents;
    taxCents += lineTaxCents;
  });

  const total = centsToMoney(totalCents);
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  document.getElementById('returnTotalDisplay').value = `${currencySymbol}${total.toFixed(2)}`;
}

async function completeReturn() {
  if (selectedReturnItems.length === 0) {
    showAlert('Please select at least one item to return', 'warning', 'No Items Selected');
    return;
  }

  // Sale item subtotals are tax-inclusive. Extract base + tax from the gross.
  let subtotalCents = 0;
  let taxCents = 0;
  let totalCents = 0;

  selectedReturnItems.forEach(item => {
    const product = allProducts.find(p => p.id === item.product_id);
    const taxRateRaw = Number(product?.tax_rate);
    const taxRate = Number.isFinite(taxRateRaw) ? taxRateRaw : 0;

    const lineTotalCents = moneyToCents(item.subtotal || 0);
    const baseCents = taxRate > 0 ? Math.round(lineTotalCents / (1 + taxRate)) : lineTotalCents;
    const lineTaxCents = lineTotalCents - baseCents;

    totalCents += lineTotalCents;
    subtotalCents += baseCents;
    taxCents += lineTaxCents;
  });

  const subtotal = centsToMoney(subtotalCents);
  const tax = centsToMoney(taxCents);
  const total = centsToMoney(totalCents);
  
  const returnData = {
    originalSaleId: currentReturnSale.id,
    subtotal: subtotal,
    tax: tax,
    total: total,
    refundMethod: document.getElementById('returnRefundMethod').value,
    cashierId: currentUser.id,
    reason: document.getElementById('returnReason').value,
    notes: document.getElementById('returnNotes').value || '',
    items: selectedReturnItems.map(item => ({
      productId: item.product_id,
      productName: item.product_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      subtotal: item.subtotal
    }))
  };
  
  try {
    const result = await window.api.createReturn(returnData);
    closeModal('returnModal');
    // Return processed - no popup
    await loadReturnsView();
  } catch (error) {
    const msg = String(error?.message || error || 'Unknown error');
    if (msg.includes('RETURN_ALREADY_EXISTS')) {
      showAlert('This receipt was already refunded.', 'warning', 'Already Refunded');
    } else {
      showAlert('Error processing return: ' + msg, 'error', 'Error');
    }
  }
}

async function viewReturnDetails(returnId) {
  const returnRecord = await window.api.getReturnById(returnId);
  if (returnRecord) {
    const computedTotal = Array.isArray(returnRecord.items)
      ? returnRecord.items.reduce((sum, it) => sum + (Number(it?.subtotal) || 0), 0)
      : (Number(returnRecord.total) || 0);
    // Could show a detailed modal here
    showAlert(`Return Details:\nDate: ${formatDateTimeWithDisplayTimeZone(parseAppDateTimeLoose(returnRecord.return_date), 'en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })}\nAmount: ${systemSettings?.currency_symbol || '€'}${computedTotal.toFixed(2)}\nReason: ${returnRecord.reason}`, 'info', 'Return Information');
  }
}

function getReturnGrossTotal(ret) {
  const items = ret?.items;
  if (Array.isArray(items)) {
    return items.reduce((sum, it) => sum + (Number(it?.subtotal) || 0), 0);
  }
  return Number(ret?.total) || 0;
}

function dedupeReturnsByOriginalSaleId(returns) {
  const bySaleId = new Map();
  (returns || []).forEach(r => {
    const saleId = Number(r?.original_sale_id);
    if (!Number.isFinite(saleId)) return;
    const prev = bySaleId.get(saleId);
    if (!prev) {
      bySaleId.set(saleId, r);
      return;
    }
    const prevTime = new Date(prev?.return_date || 0).getTime();
    const nextTime = new Date(r?.return_date || 0).getTime();
    if (nextTime >= prevTime) bySaleId.set(saleId, r);
  });
  return Array.from(bySaleId.values());
}

// ============== Z-REPORT HANDLERS ==============
let currentZReportData = null;

function setZReportRangeUiVisibility() {
  try {
    const typeEl = document.getElementById('zReportRangeType');
    const monthGroup = document.getElementById('zReportMonthGroup');
    const yearGroup = document.getElementById('zReportYearGroup');
    const customRow = document.getElementById('zReportCustomRangeRow');
    const type = (typeEl?.value || 'today').toString();

    if (monthGroup) monthGroup.style.display = type === 'month' ? '' : 'none';
    if (yearGroup) yearGroup.style.display = type === 'year' ? '' : 'none';
    if (customRow) customRow.style.display = type === 'custom' ? '' : 'none';
  } catch {
    // ignore
  }
}

function getZReportRangeSelection() {
  const typeEl = document.getElementById('zReportRangeType');
  const monthEl = document.getElementById('zReportRangeMonth');
  const yearEl = document.getElementById('zReportRangeYear');
  const startEl = document.getElementById('zReportRangeStart');
  const endEl = document.getElementById('zReportRangeEnd');

  const type = (typeEl?.value || 'today').toString();
  const now = new Date();

  const atStartOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
  const atEndOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  const toYmd = (d) => d.toISOString().split('T')[0];

  if (type === 'month') {
    const monthValue = (monthEl?.value || '').toString().trim();
    const [yStr, mStr] = monthValue.split('-');
    const year = Number(yStr) || now.getFullYear();
    const monthIndex = (Number(mStr) ? Number(mStr) - 1 : now.getMonth());
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0);
    return {
      type,
      startDate: toYmd(start),
      endDate: toYmd(end),
      startDateTime: atStartOfDay(start).toISOString(),
      endDateTime: atEndOfDay(end).toISOString(),
      label: `${formatDateWithDisplayTimeZone(start, 'en-GB')} - ${formatDateWithDisplayTimeZone(end, 'en-GB')}`,
      monthKey: `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    };
  }

  if (type === 'year') {
    const yearValue = (yearEl?.value || '').toString().trim();
    const year = Number(yearValue) || now.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    return {
      type,
      startDate: toYmd(start),
      endDate: toYmd(end),
      startDateTime: atStartOfDay(start).toISOString(),
      endDateTime: atEndOfDay(end).toISOString(),
      label: `${formatDateWithDisplayTimeZone(start, 'en-GB')} - ${formatDateWithDisplayTimeZone(end, 'en-GB')}`,
      monthKey: `${year}`
    };
  }

  if (type === 'custom') {
    const startStr = (startEl?.value || '').toString();
    const endStr = (endEl?.value || '').toString();
    const start = startStr ? new Date(startStr + 'T00:00:00') : atStartOfDay(now);
    const end = endStr ? new Date(endStr + 'T00:00:00') : atStartOfDay(now);
    const s = atStartOfDay(start);
    const e = atEndOfDay(end);
    // If user swapped dates, normalize
    const s2 = (s.getTime() <= e.getTime()) ? s : atStartOfDay(end);
    const e2 = (s.getTime() <= e.getTime()) ? e : atEndOfDay(start);
    return {
      type,
      startDate: toYmd(s2),
      endDate: toYmd(e2),
      startDateTime: s2.toISOString(),
      endDateTime: e2.toISOString(),
      label: `${formatDateWithDisplayTimeZone(new Date(s2), 'en-GB')} - ${formatDateWithDisplayTimeZone(new Date(e2), 'en-GB')}`,
      monthKey: null
    };
  }

  // today
  const start = atStartOfDay(now);
  const end = now;
  return {
    type: 'today',
    startDate: toYmd(start),
    endDate: toYmd(start),
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    label: `${formatDateWithDisplayTimeZone(start, 'en-GB')} - ${formatTimeWithDisplayTimeZone(end, 'en-GB')}`,
    monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  };
}

function updateZReportBalanceUi({ currencySymbol }) {
  try {
    const balanceEl = document.getElementById('zReportBalance');
    if (!balanceEl) return;
    const netSales = Number(currentZReportData?.net_sales || 0) || 0;
    const autoAmount = Number(currentZReportData?._auto_expenses_total || 0) || 0;
    const manualAmount = parseFloat(document.getElementById('zReportExpenseAmount')?.value || '') || 0;
    const balance = netSales - (autoAmount + manualAmount);
    balanceEl.textContent = `${currencySymbol}${balance.toFixed(2)}`;
    balanceEl.style.color = balance >= 0 ? '#059669' : '#dc2626';
  } catch {
    // ignore
  }
}

function updateZReportExpectedCashUi({ currencySymbol }) {
  try {
    if (!currentZReportData) return;
    const expectedEl = document.getElementById('zReportExpectedCash');
    if (!expectedEl) return;

    // Base expected cash already accounts for net cash collected and auto cash expenses.
    const baseExpected = Number(currentZReportData._expected_cash_base ?? currentZReportData.expected_cash ?? 0) || 0;
    const manualExpense = parseFloat(document.getElementById('zReportExpenseAmount')?.value || '') || 0;

    // Manual expense is treated as CASH paid-out.
    const expected = baseExpected - manualExpense;
    expectedEl.value = `${currencySymbol}${expected.toFixed(2)}`;

    // Keep runtime data updated for save.
    currentZReportData.expected_cash = expected;

    // If actual cash is already entered, update the difference display.
    try { calculateCashDifference(); } catch { /* ignore */ }
  } catch {
    // ignore
  }
}

function getTaxRateForSaleItem(item, { productById, categoryByName, defaultTaxRate }) {
  try {
    const product = productById?.get?.(item?.product_id);
    const productTaxRate = Number(product?.tax_rate);
    if (Number.isFinite(productTaxRate)) return productTaxRate;

    // Category tax is legacy (many deployments keep it at 0). Only use if product has none.
    const category = product ? categoryByName?.get?.(product.category) : null;
    const categoryTaxRate = Number(category?.tax_rate);
    if (Number.isFinite(categoryTaxRate)) return categoryTaxRate;

    const fallback = Number(defaultTaxRate);
    return Number.isFinite(fallback) ? fallback : 0;
  } catch {
    return 0;
  }
}

function safeParseRecordItems(record) {
  if (!record) return [];
  const items = record.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  try {
    return JSON.parse(items);
  } catch {
    return [];
  }
}

async function computeVatBreakdownRowsForPeriod({ startDateTime, endDateTime, cashierId, settings }) {
  const defaultTaxRate = Number(settings?.tax_rate ?? 0);

  const [salesData, returnsData, loanPaymentsDetailed] = await Promise.all([
    (window.api?.getSalesByDateTimeRange
      ? window.api.getSalesByDateTimeRange(startDateTime, endDateTime, cashierId)
      : window.api.getSalesByDateRange(startDateTime, endDateTime, cashierId)),
    (window.api?.getReturnsByDateTimeRange
      ? window.api.getReturnsByDateTimeRange(startDateTime, endDateTime, cashierId)
      : window.api.getReturnsByDateRange(startDateTime, endDateTime, cashierId)),
    (window.api?.getLoanPaymentsDetailedByDateTimeRange
      ? window.api.getLoanPaymentsDetailedByDateTimeRange(startDateTime, endDateTime, cashierId)
      : Promise.resolve([]))
  ]);

  // IMPORTANT BUSINESS RULE:
  // - PARKING/loan sales are NOT counted for VAT on the day they are created.
  // - VAT is counted on the day money is collected (loan_payments), allocated proportionally.
  const salesAll = Array.isArray(salesData) ? salesData : (salesData?.sales || []);
  const sales = (salesAll || []).filter(s => (String(s?.payment_method || '').toLowerCase() !== 'loan'));
  const returns = Array.isArray(returnsData) ? returnsData : (returnsData?.returns || []);
  const dedupedReturns = dedupeReturnsByOriginalSaleId(returns);

  // Ensure product/category caches exist for tax lookup
  if (!allProducts || allProducts.length === 0) {
    try { allProducts = await window.api.getAllProducts(); } catch { allProducts = []; }
  }
  if (!allCategories || allCategories.length === 0) {
    try { allCategories = await window.api.getAllCategories(); } catch { allCategories = []; }
  }

  const productById = new Map((allProducts || []).map(p => [p.id, p]));
  const categoryByName = new Map((allCategories || []).map(c => [c.name, c]));

  const rowsByRatePct = new Map();
  const addLine = (ratePct, lineTotal, direction) => {
    const total = Number(lineTotal);
    if (!Number.isFinite(total) || total === 0) return;
    const r = Math.max(0, Number(ratePct) || 0);
    const taxRate = r / 100;
    const base = taxRate > 0 ? (total / (1 + taxRate)) : total;
    const cuota = total - base;

    const existing = rowsByRatePct.get(r) || { rate: r, base: 0, cuota: 0, total: 0 };
    existing.base += base * direction;
    existing.cuota += cuota * direction;
    existing.total += total * direction;
    rowsByRatePct.set(r, existing);
  };

  // Sales add
  for (const sale of (sales || [])) {
    for (const item of safeParseRecordItems(sale)) {
      const taxRate = getTaxRateForSaleItem(item, { productById, categoryByName, defaultTaxRate });
      const ratePct = Math.round((Number.isFinite(taxRate) ? taxRate : 0) * 100);
      const lineTotal = Number(item.subtotal) || (Number(item.quantity) * Number(item.unit_price)) || 0;
      addLine(ratePct, lineTotal, +1);
    }
  }

  // Loan/PARKING payments add (allocate VAT from original sale items proportionally)
  for (const p of (loanPaymentsDetailed || [])) {
    const payAmt = Number(p?.amount || 0);
    if (!Number.isFinite(payAmt) || payAmt <= 0) continue;
    const saleTotal = Number(p?.sale_total || 0);
    const denom = (Number.isFinite(saleTotal) && saleTotal > 0) ? saleTotal : null;
    if (!denom) continue;
    const factor = Math.max(0, Math.min(1, payAmt / denom));
    if (factor <= 0) continue;

    const items = Array.isArray(p?.items) ? p.items : safeParseRecordItems(p);
    for (const item of (items || [])) {
      const taxRate = getTaxRateForSaleItem(item, { productById, categoryByName, defaultTaxRate });
      const ratePct = Math.round((Number.isFinite(taxRate) ? taxRate : 0) * 100);
      const lineTotal = Number(item.subtotal) || (Number(item.quantity) * Number(item.unit_price)) || 0;
      addLine(ratePct, lineTotal * factor, +1);
    }
  }

  // Returns subtract (net VAT)
  for (const ret of (dedupedReturns || [])) {
    for (const item of safeParseRecordItems(ret)) {
      const taxRate = getTaxRateForSaleItem(item, { productById, categoryByName, defaultTaxRate });
      const ratePct = Math.round((Number.isFinite(taxRate) ? taxRate : 0) * 100);
      const lineTotal = Number(item.subtotal) || (Number(item.quantity) * Number(item.unit_price)) || 0;
      addLine(ratePct, lineTotal, -1);
    }
  }

  return Array.from(rowsByRatePct.values())
    .filter(r => Number.isFinite(r.rate))
    .sort((a, b) => a.rate - b.rate);
}

function renderVatBreakdownGridHtml(vatRows, currencySymbol) {
  const safeMoney = (n) => {
    const num = Number(n || 0);
    return `${currencySymbol}${(Number.isFinite(num) ? num : 0).toFixed(2)}`;
  };

  const rows = Array.isArray(vatRows) ? vatRows : [];
  const totalTax = rows.reduce((sum, r) => sum + (Number(r?.cuota) || 0), 0);

  const parts = [];
  for (const r of rows) {
    const pct = Number(r?.rate) || 0;
    parts.push(`
      <div class="summary-item">
        <span class="summary-label">IVA ${pct}% Base:</span>
        <span class="summary-value">${safeMoney(r.base)}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">IVA ${pct}% Amount:</span>
        <span class="summary-value">${safeMoney(r.cuota)}</span>
      </div>
    `);
  }

  parts.push(`
    <div class="summary-item" style="grid-column: span 3; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 10px;">
      <span class="summary-label" style="font-weight: bold;">Total Tax:</span>
      <span class="summary-value" style="font-weight: bold;" id="zReportTotalTax">${safeMoney(totalTax)}</span>
    </div>
  `);

  return { html: parts.join(''), totalTax };
}

function setupZReportHandlers() {
  const generateZReportBtn = document.getElementById('generateZReportBtn');
  const zReportForm = document.getElementById('zReportForm');
  const actualCashInput = document.getElementById('zReportActualCash');
  
  // Report tabs switching
  const reportTabs = document.querySelectorAll('.report-tab');
  reportTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      
      // Update tabs
      reportTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update content
      document.querySelectorAll('.report-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(tabName).classList.add('active');
    });
  });
  
  if (generateZReportBtn) {
    generateZReportBtn.addEventListener('click', async () => {
      await openArqueoOverlay();
    });
  }
  
  if (zReportForm) {
    zReportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await completeZReport();
    });
  }
  
  if (actualCashInput) {
    actualCashInput.addEventListener('input', () => {
      calculateCashDifference();
    });
  }
  
  // Add expense amount listener to update display
  const expenseAmountInput = document.getElementById('zReportExpenseAmount');
  if (expenseAmountInput) {
    expenseAmountInput.addEventListener('input', () => {
      updateExpenseDisplay();
      updateZReportBalanceUi({ currencySymbol: systemSettings?.currency_symbol || '€' });
      updateZReportExpectedCashUi({ currencySymbol: systemSettings?.currency_symbol || '€' });
    });
  }

  // Range selector (Today / Month / Custom)
  const rangeType = document.getElementById('zReportRangeType');
  const rangeMonth = document.getElementById('zReportRangeMonth');
  const rangeYear = document.getElementById('zReportRangeYear');
  const rangeStart = document.getElementById('zReportRangeStart');
  const rangeEnd = document.getElementById('zReportRangeEnd');

  // Populate year dropdown once
  try {
    if (rangeYear && !rangeYear.dataset.optionsLoaded) {
      const currentYear = new Date().getFullYear();
      rangeYear.innerHTML = '';
      for (let y = currentYear; y >= currentYear - 5; y--) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        rangeYear.appendChild(opt);
      }
      rangeYear.value = String(currentYear);
      rangeYear.dataset.optionsLoaded = '1';
    }
  } catch {
    // ignore
  }

  const attachOnce = (el, handler) => {
    if (!el || el.dataset.listenerAttached) return;
    el.dataset.listenerAttached = '1';
    el.addEventListener('change', handler);
  };

  const refresh = () => {
    setZReportRangeUiVisibility();
    openZReportModal().catch(() => { /* ignore */ });
  };

  attachOnce(rangeType, refresh);
  attachOnce(rangeMonth, refresh);
  attachOnce(rangeYear, refresh);
  attachOnce(rangeStart, refresh);
  attachOnce(rangeEnd, refresh);
}

async function loadZReportsView() {
  try {
    const zReports = await window.api.getAllZReports();
    displayZReports(zReports);
  } catch (error) {
    console.error('Error loading Z-reports:', error);
    showAlert('Error loading Z-reports: ' + error.message, 'error', 'Error');
  }
}

function displayZReports(zReports) {
  const tbody = document.getElementById('zReportsTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (!zReports || zReports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px; color: #94a3b8;">No Z-reports found</td></tr>';
    return;
  }
  
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  zReports.forEach(report => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${report.report_number}</td>
      <td>${formatDateWithDisplayTimeZone(new Date(report.report_date), 'en-GB')}</td>
      <td>${report.cashier_name}</td>
      <td>${report.total_sales}</td>
      <td>${report.total_returns}</td>
      <td>${currencySymbol}${report.net_sales.toFixed(2)}</td>
      <td>${currencySymbol}${report.cash_sales.toFixed(2)}</td>
      <td>${currencySymbol}${report.card_sales.toFixed(2)}</td>
      <td style="font-weight: bold; color: #059669;">${currencySymbol}${(report.total_sales_amount || 0).toFixed(2)}</td>
      <td style="color: #dc2626;">${currencySymbol}${(report.total_expenses || 0).toFixed(2)}</td>
      <td>${currencySymbol}${report.total_tax.toFixed(2)}</td>
      <td>
        <button class="btn-action" onclick="arqueoViewSaved(${report.id})" title="View Details">👁️</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function openZReportModal() {
  try {
    // Calculate report data for the selected range
    setZReportRangeUiVisibility();
    let range = getZReportRangeSelection();

    // For "today", use the business-day window (resets on Z-report close)
    // so creating a Z report truly closes the day/shift.
    try {
      if (range?.type === 'today' && window.api?.getBusinessDayRange) {
        const biz = await window.api.getBusinessDayRange('today');
        if (biz?.startDateTime && biz?.endDateTime) {
          const toYmdMadrid = (iso) => {
            try {
              return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Europe/Madrid',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
              }).format(new Date(iso));
            } catch {
              return (new Date(iso)).toISOString().slice(0, 10);
            }
          };

          range = {
            ...range,
            startDateTime: biz.startDateTime,
            endDateTime: biz.endDateTime,
            startDate: toYmdMadrid(biz.startDateTime),
            endDate: toYmdMadrid(biz.endDateTime),
            label: `${toYmdMadrid(biz.startDateTime)} - ${toYmdMadrid(biz.endDateTime)}`
          };
        }
      }
    } catch {
      // ignore and fall back to UI selection
    }

    const startDateTime = range.startDateTime;
    const endDateTime = range.endDateTime;
    
    // Get sales/returns/payments for the selected range (store-wide)
    const salesData = await (window.api?.getSalesByDateTimeRange
      ? window.api.getSalesByDateTimeRange(startDateTime, endDateTime, null)
      : window.api.getSalesByDateRange(startDateTime, endDateTime, null));
    const returnsData = await (window.api?.getReturnsByDateTimeRange
      ? window.api.getReturnsByDateTimeRange(startDateTime, endDateTime, null)
      : window.api.getReturnsByDateRange(startDateTime, endDateTime, null));
    const loanPayments = await (window.api?.getLoanPaymentsByDateTimeRange
      ? window.api.getLoanPaymentsByDateTimeRange(startDateTime, endDateTime, null)
      : window.api.getLoanPaymentsByDateRange(startDateTime, endDateTime, null));
    
    // Extract the actual arrays from the response objects
    const sales = Array.isArray(salesData) ? salesData : (salesData?.sales || []);
    const returns = Array.isArray(returnsData) ? returnsData : (returnsData?.returns || []);
    
    // Parse items for each sale and return
    sales.forEach(sale => {
      if (sale.items) {
        try {
          sale.items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;
        } catch (e) {
          sale.items = [];
        }
      }
    });
    
    returns.forEach(ret => {
      if (ret.items) {
        try {
          ret.items = typeof ret.items === 'string' ? JSON.parse(ret.items) : ret.items;
        } catch (e) {
          ret.items = [];
        }
      }
    });
    
    // BUSINESS RULE: PARKING/loan sales are not counted until paid.
    const nonLoanSales = (sales || []).filter(s => (String(s?.payment_method || '').toLowerCase() !== 'loan'));


    // Count PARKING payments as documents on the paid day.
    // Use unique loan_id to avoid double-counting if multiple partial payments happen.
    const loanPaymentDocCount = (() => {
      try {
        const ids = new Set((loanPayments || []).map(p => String(p?.loan_id ?? p?.loanId ?? '')).filter(Boolean));
        return ids.size;
      } catch {
        return 0;
      }
    })();

    // Calculate totals (paid sales + paid PARKING documents)
    const totalSales = nonLoanSales.length + loanPaymentDocCount;
    const dedupedReturns = dedupeReturnsByOriginalSaleId(returns);
    const totalReturns = dedupedReturns.length;
    const saleIds = new Set(nonLoanSales.map(s => Number(s?.id)).filter(Number.isFinite));
    const refundedSalesCount = dedupedReturns.filter(r => saleIds.has(Number(r?.original_sale_id))).length;
    const netSalesCount = Math.max(0, (nonLoanSales.length - refundedSalesCount) + loanPaymentDocCount);
    
    const totalReturnsAmount = dedupedReturns.reduce((sum, ret) => sum + getReturnGrossTotal(ret), 0);
    
    // Calculate payment methods (paid sales)
    const cashSalesFromSales = nonLoanSales
      .filter(s => (s.payment_method || '').toString().toLowerCase() === 'cash')
      .reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const cardSalesFromSales = nonLoanSales
      .filter(s => (s.payment_method || '').toString().toLowerCase() === 'card')
      .reduce((sum, s) => sum + (Number(s.total) || 0), 0);

    // PARKING payments: count the money on the day it is paid
    const loanCashPayments = (loanPayments || [])
      .filter(p => (p.payment_method || '').toLowerCase() === 'cash')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    const loanCardPayments = (loanPayments || [])
      .filter(p => (p.payment_method || '').toLowerCase() === 'card')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const cashSales = cashSalesFromSales + loanCashPayments;
    const cardSales = cardSalesFromSales + loanCardPayments;
    // Store PARKING payments separately for visibility (they are already included in cash/card totals)
    const loanSales = loanCashPayments + loanCardPayments;

    
    // VAT breakdown (dynamic, same as products) - computed on NET (sales - returns)
    const vatRows = await computeVatBreakdownRowsForPeriod({
      startDateTime,
      endDateTime,
      cashierId: null,
      settings: systemSettings
    });
    const totalTax = vatRows.reduce((sum, r) => sum + (Number(r?.cuota) || 0), 0);
    
    // Returns by method so cash/card match what was actually collected
    const cashReturns = dedupedReturns
      .filter(r => (r.refund_method || '').toString().toLowerCase() === 'cash')
      .reduce((sum, r) => sum + getReturnGrossTotal(r), 0);
    const cardReturns = dedupedReturns
      .filter(r => (r.refund_method || '').toString().toLowerCase() === 'card')
      .reduce((sum, r) => sum + getReturnGrossTotal(r), 0);

    // Financial summary based on money movement (not including unpaid PARKING)
    const grossSales = cashSales + cardSales;
    const netSales = (cashSales - cashReturns) + (cardSales - cardReturns);

    // Expenses: auto-fetch from Expenses table for the selected range.
    // total_expenses = ALL expenses (cash + card) for reporting.
    // expected_cash should only be reduced by CASH-paid expenses.
    const startYmd = range.startDate;
    const endYmd = range.endDate;
    let autoExpensesTotal = 0;
    let autoCashExpensesTotal = 0;
    let autoExpensesCount = 0;
    let autoExpensesList = [];
    try {
      if (window.api?.getExpenses) {
        const expenses = await (window.api?.getExpensesByDateTimeRange
          ? window.api.getExpensesByDateTimeRange(startDateTime, endDateTime)
          : window.api.getExpenses(startYmd, endYmd));
        const list = Array.isArray(expenses) ? expenses : (expenses?.expenses || []);
        autoExpensesCount = Array.isArray(list) ? list.length : 0;
        autoExpensesList = Array.isArray(list) ? list : [];
        (list || []).forEach((e) => {
          const amt = Number(e?.amount || 0);
          if (!Number.isFinite(amt)) return;
          autoExpensesTotal += amt;
          const pm = String(e?.payment_method || '').toLowerCase();
          if (pm === 'cash') autoCashExpensesTotal += amt;
        });
      } else if (window.api?.getExpenseSummary) {
        const sum = await window.api.getExpenseSummary(startYmd, endYmd);
        autoExpensesTotal = Number(sum?.total_amount || 0) || 0;
      }
    } catch {
      // ignore expense auto-fetch errors; fall back to 0
      autoExpensesTotal = 0;
      autoCashExpensesTotal = 0;
      autoExpensesCount = 0;
      autoExpensesList = [];
    }

    const netCashCollected = cashSales - cashReturns;
    const netCardCollected = cardSales - cardReturns;

    // Cash in register reduced by cash-paid expenses
    const expectedCashBase = netCashCollected - autoCashExpensesTotal;
    
    // Ensure currentUser is properly set
    if (!currentUser || !currentUser.id || !currentUser.full_name) {
      showAlert('User information is missing. Please log in again.', 'error', 'Error');
      return;
    }
    
    // Store report data
    currentZReportData = {
      start_datetime: startDateTime,
      end_datetime: endDateTime,
      cashier_id: currentUser.id,
      cashier_name: currentUser.full_name || 'Unknown',
      total_sales: totalSales,
      total_returns: totalReturns,
      net_sales_count: netSalesCount,
      gross_sales: grossSales,
      total_returns_amount: totalReturnsAmount,
      net_sales: netSales,
      cash_sales: netCashCollected,
      card_sales: netCardCollected,
      loan_sales: loanSales,
      loan_cash_payments: loanCashPayments,
      loan_card_payments: loanCardPayments,
      // Legacy columns (kept for backwards compatibility)
      tax_7_base: (vatRows.find(r => Number(r?.rate) === 7)?.base) || 0,
      tax_7_amount: (vatRows.find(r => Number(r?.rate) === 7)?.cuota) || 0,
      tax_19_base: (vatRows.find(r => Number(r?.rate) === 19)?.base) || 0,
      tax_19_amount: (vatRows.find(r => Number(r?.rate) === 19)?.cuota) || 0,
      total_tax: totalTax,
      tax_breakdown_json: (() => {
        try { return JSON.stringify(vatRows); } catch { return null; }
      })(),
      expected_cash: expectedCashBase,

      // For live UI recalculation when manual expense changes
      _expected_cash_base: expectedCashBase,
      _net_cash_collected: netCashCollected,
      _net_card_collected: netCardCollected,

      // Runtime-only helpers (not stored directly unless merged into reportData)
      _auto_expenses_total: autoExpensesTotal,
      _auto_cash_expenses_total: autoCashExpensesTotal,
      _auto_expenses_count: autoExpensesCount,
      _auto_expenses_list: autoExpensesList
    };
    
    const currencySymbol = systemSettings?.currency_symbol || '€';
    
    // Populate modal
    document.getElementById('zReportPeriod').textContent = range.label;
    document.getElementById('zReportTotalSales').textContent = totalSales;
    document.getElementById('zReportTotalReturns').textContent = totalReturns;
    document.getElementById('zReportNetCount').textContent = netSalesCount;
    
    document.getElementById('zReportGrossSales').textContent = `${currencySymbol}${grossSales.toFixed(2)}`;
    document.getElementById('zReportReturnsAmount').textContent = `${currencySymbol}${totalReturnsAmount.toFixed(2)}`;
    document.getElementById('zReportNetSales').textContent = `${currencySymbol}${netSales.toFixed(2)}`;
    
    document.getElementById('zReportCash').textContent = `${currencySymbol}${netCashCollected.toFixed(2)}`;
    document.getElementById('zReportCard').textContent = `${currencySymbol}${netCardCollected.toFixed(2)}`;

    // (No separate PARKING lines in Z-report; PARKING payments are included in cash/card totals.)
    
    // Calculate and display total collected amount (net)
    const totalSalesAmount = netCashCollected + netCardCollected;
    document.getElementById('zReportTotalAmount').textContent = `${currencySymbol}${totalSalesAmount.toFixed(2)}`;
    
    // Initialize expenses with auto-fetched total
    document.getElementById('zReportTotalExpenses').textContent = `${currencySymbol}${(Number(autoExpensesTotal) || 0).toFixed(2)}`;
    document.getElementById('zReportExpenseAmount').value = '';
    document.getElementById('zReportExpenseDescription').value = '';
    
    const taxGrid = document.getElementById('zReportTaxBreakdownGrid');
    if (taxGrid) {
      const rendered = renderVatBreakdownGridHtml(vatRows, currencySymbol);
      taxGrid.innerHTML = rendered.html;
    }
    
    document.getElementById('zReportExpectedCash').value = `${currencySymbol}${expectedCashBase.toFixed(2)}`;
    document.getElementById('zReportActualCash').value = '';
    document.getElementById('zReportDifference').value = '';
    document.getElementById('zReportNotes').value = '';

    updateZReportBalanceUi({ currencySymbol });
    updateZReportExpectedCashUi({ currencySymbol });
    
    if (!_skipZReportModalOpen) openModal('zReportModal');
  } catch (error) {
    console.error('Error generating Z-report:', error);
    showAlert('Error generating Z-report: ' + error.message, 'error', 'Error');
  }
}

function calculateCashDifference() {
  const actualCashInput = document.getElementById('zReportActualCash');
  const differenceInput = document.getElementById('zReportDifference');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  if (!actualCashInput.value || !currentZReportData) {
    differenceInput.value = '';
    return;
  }
  
  const actualCash = parseFloat(actualCashInput.value) || 0;
  const expectedCash = currentZReportData.expected_cash;
  const difference = actualCash - expectedCash;
  
  differenceInput.value = `${currencySymbol}${difference.toFixed(2)}`;
  differenceInput.style.color = difference < 0 ? 'red' : (difference > 0 ? 'green' : 'black');
}

function updateExpenseDisplay() {
  const expenseInput = document.getElementById('zReportExpenseAmount');
  const expenseDisplay = document.getElementById('zReportTotalExpenses');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  if (!expenseInput || !expenseDisplay) return;
  
  const manualAmount = parseFloat(expenseInput.value) || 0;
  const autoAmount = Number(currentZReportData?._auto_expenses_total || 0) || 0;
  const total = autoAmount + manualAmount;

  expenseDisplay.textContent = `${currencySymbol}${total.toFixed(2)}`;
  expenseDisplay.style.color = total > 0 ? '#dc2626' : '#94a3b8';
}

async function completeZReport() {
  if (!currentZReportData) {
    showAlert('No report data available', 'error', 'Error');
    return;
  }
  
  // Ensure expected cash is updated based on any manual expense entry
  const manualExpenseAmount = parseFloat(document.getElementById('zReportExpenseAmount').value) || 0;
  const baseExpectedCash = Number(currentZReportData._expected_cash_base ?? currentZReportData.expected_cash ?? 0) || 0;
  const finalExpectedCash = baseExpectedCash - manualExpenseAmount;

  const actualCashRaw = (document.getElementById('zReportActualCash').value || '').toString().trim();
  const actualCash = actualCashRaw ? (parseFloat(actualCashRaw) || 0) : null;
  const cashDifference = (actualCash === null) ? null : (actualCash - finalExpectedCash);
  
  // Get expense information
  // - Auto: from Expenses table (today)
  // - Manual: optional extra cash-out not recorded in Expenses
  const autoExpenseAmount = Number(currentZReportData?._auto_expenses_total || 0) || 0;
  const totalExpenseAmount = autoExpenseAmount + manualExpenseAmount;
  const manualExpenseDescription = (document.getElementById('zReportExpenseDescription').value || '').toString().trim();

  // Build a structured expense payload so the printed Z report can show a detailed list.
  const autoList = Array.isArray(currentZReportData?._auto_expenses_list) ? currentZReportData._auto_expenses_list : [];
  const normalizedAuto = autoList.map(e => ({
    id: e?.id ?? null,
    expense_date: e?.expense_date ?? null,
    category: e?.category ?? null,
    description: e?.description ?? null,
    amount: Number(e?.amount ?? 0) || 0,
    payment_method: e?.payment_method ?? null,
    user_name: e?.user_name ?? e?.cashier_name ?? null
  }));

  const normalizedManual = (manualExpenseAmount > 0)
    ? [{
      id: null,
      expense_date: null,
      category: 'Manual',
      description: manualExpenseDescription || 'Manual expense',
      amount: manualExpenseAmount,
      payment_method: 'cash',
      user_name: (currentUser?.full_name || currentUser?.name || currentUser?.username || null)
    }]
    : [];

  const expensesJson = (() => {
    try {
      return JSON.stringify({
        auto: normalizedAuto,
        manual: normalizedManual
      });
    } catch {
      return null;
    }
  })();

  const autoCount = Number(currentZReportData?._auto_expenses_count || 0) || 0;
  const autoCash = Number(currentZReportData?._auto_cash_expenses_total || 0) || 0;
  const autoCard = Math.max(0, autoExpenseAmount - autoCash);
  const autoNote = autoExpenseAmount > 0
    ? `Auto expenses (today): ${autoCount} item(s), cash ${autoCash.toFixed(2)}, card ${autoCard.toFixed(2)}`
    : '';
  const expenseDescription = [autoNote, manualExpenseDescription].filter(Boolean).join(' | ');
  
  // Calculate total sales amount (cash/card already include PARKING payments)
  const totalSalesAmount = currentZReportData.cash_sales + currentZReportData.card_sales;
  
  const range = getZReportRangeSelection();
  // Keep Z-report numbering consistent across Today/Month/Year/Custom.
  // (Some users expect the same "ARQUEO" number format regardless of range.)
  const reportNumber = `Z${Date.now()}`;

  const reportData = {
    ...currentZReportData,
    report_number: reportNumber,
    expected_cash: finalExpectedCash,
    actual_cash: actualCash,
    cash_difference: cashDifference,
    total_sales_amount: totalSalesAmount,
    total_expenses: totalExpenseAmount,
    expense_description: expenseDescription || null,
    expenses_json: expensesJson,
    notes: document.getElementById('zReportNotes').value || null
  };
  
  try {
    const result = await window.api.createZReport(reportData);
    closeModal('zReportModal');
    // Z-Report completed - no popup
    await loadZReportsView();
    currentZReportData = null;
  } catch (error) {
    console.error('Error creating Z-report:', error);
    showAlert('Error creating Z-report: ' + error.message, 'error', 'Error');
  }
}

async function viewZReportDetails(reportId) {
  try {
    const report = await window.api.getZReportById(reportId);
    if (!report) {
      showAlert('Report not found', 'error', 'Error');
      return;
    }
    
    const currencySymbol = systemSettings?.currency_symbol || '€';
    const content = document.getElementById('zReportDetailsContent');

    // VAT breakdown: prefer stored JSON if available; otherwise fall back to legacy 7%/19% fields.
    let vatRows = null;
    try {
      if (report.tax_breakdown_json) {
        const parsed = typeof report.tax_breakdown_json === 'string' ? JSON.parse(report.tax_breakdown_json) : report.tax_breakdown_json;
        if (Array.isArray(parsed)) vatRows = parsed;
      }
    } catch {
      vatRows = null;
    }

    if (!vatRows) {
      vatRows = [
        { rate: 7, base: Number(report.tax_7_base || 0), cuota: Number(report.tax_7_amount || 0), total: Number(report.tax_7_base || 0) + Number(report.tax_7_amount || 0) },
        { rate: 19, base: Number(report.tax_19_base || 0), cuota: Number(report.tax_19_amount || 0), total: Number(report.tax_19_base || 0) + Number(report.tax_19_amount || 0) }
      ].filter(r => (Number(r.base) !== 0) || (Number(r.cuota) !== 0));
    }

    const vatRendered = renderVatBreakdownGridHtml(vatRows, currencySymbol);
    
    // Expenses detail (optional)
    let expenseDetailHtml = '';
    try {
      if (report.expenses_json) {
        const parsed = typeof report.expenses_json === 'string' ? JSON.parse(report.expenses_json) : report.expenses_json;
        const auto = Array.isArray(parsed?.auto) ? parsed.auto : [];
        const manual = Array.isArray(parsed?.manual) ? parsed.manual : [];
        const all = [...auto, ...manual].filter(e => Number(e?.amount) > 0);

        if (all.length) {
          const rows = all.map(e => {
            const pm = String(e?.payment_method || '').toUpperCase() || '-';
            const desc = (e?.description || e?.category || '-').toString();
            const amt = Number(e?.amount || 0);
            return `
              <tr>
                <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; color:#334155; font-weight:700;">${desc}</td>
                <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; color:#64748b; font-weight:800; text-align:center;">${pm}</td>
                <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; color:#dc2626; font-weight:900; text-align:right;">${currencySymbol}${amt.toFixed(2)}</td>
              </tr>
            `;
          }).join('');

          expenseDetailHtml = `
            <div style="grid-column: span 3; margin-top: 10px;">
              <div style="border:2px solid #e2e8f0; border-radius: 12px; overflow:hidden;">
                <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 12px; background:#f8fafc; font-weight:900; color:#0f172a;">
                  <div style="flex:1;">Reason</div>
                  <div style="width:90px; text-align:center;">Pay</div>
                  <div style="width:120px; text-align:right;">Amount</div>
                </div>
                <table style="width:100%; border-collapse:collapse;">
                  <tbody>
                    ${rows}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        }
      }
    } catch {
      // ignore
    }

    // Recompute counts using the same business rule as Z-report generation:
    // - Exclude loan-origin sales documents
    // - Include PARKING payments as documents on the paid day
    let computedTotalSales = Number(report.total_sales || 0) || 0;
    let computedNetSalesCount = Number(report.net_sales_count || 0) || 0;
    try {
      const start = report.start_datetime;
      const end = report.end_datetime;
      const cashierId = null;
      const salesData = await (window.api?.getSalesByDateTimeRange
        ? window.api.getSalesByDateTimeRange(start, end, cashierId)
        : window.api.getSalesByDateRange(start, end, cashierId));
      const sales = Array.isArray(salesData) ? salesData : (salesData?.sales || []);
      const nonLoanSales = (sales || []).filter(s => String(s?.payment_method || '').toLowerCase() !== 'loan');

      const loanPayments = await (window.api?.getLoanPaymentsByDateTimeRange
        ? window.api.getLoanPaymentsByDateTimeRange(start, end, cashierId)
        : window.api.getLoanPaymentsByDateRange(start, end, cashierId));
      const loanPaymentDocCount = (() => {
        try {
          const ids = new Set((loanPayments || []).map(p => String(p?.loan_id ?? p?.loanId ?? '')).filter(Boolean));
          return ids.size;
        } catch {
          return 0;
        }
      })();

      computedTotalSales = nonLoanSales.length + loanPaymentDocCount;

      // Net = exclude refunded non-loan receipts, but keep loan payment docs
      const returnsData = await (window.api?.getReturnsByDateTimeRange
        ? window.api.getReturnsByDateTimeRange(start, end, cashierId)
        : window.api.getReturnsByDateRange(start, end, cashierId));
      const returns = Array.isArray(returnsData) ? returnsData : (returnsData?.returns || []);
      const dedupedReturns = dedupeReturnsByOriginalSaleId(returns);
      const saleIds = new Set(nonLoanSales.map(s => Number(s?.id)).filter(Number.isFinite));
      const refundedSalesCount = dedupedReturns.filter(r => saleIds.has(Number(r?.original_sale_id))).length;
      computedNetSalesCount = Math.max(0, (nonLoanSales.length - refundedSalesCount) + loanPaymentDocCount);
    } catch {
      // ignore
    }

    // No separate PARKING lines in Z-report details.

    content.innerHTML = `
      <div class="z-report-summary">
        <h4>Report Information</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Report Number:</span>
            <span class="summary-value">${report.report_number}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Report Date:</span>
            <span class="summary-value">${(() => {
              try {
                return new Intl.DateTimeFormat('en-GB', {
                  timeZone: 'Europe/Madrid',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                }).format(new Date(report.report_date));
              } catch {
                return formatDateTimeWithDisplayTimeZone(new Date(report.report_date), 'en-GB', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                });
              }
            })()}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Cashier:</span>
            <span class="summary-value">${report.cashier_name}</span>
          </div>
        </div>
      </div>

      <div class="z-report-section">
        <h4>Sales Summary</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Total Sales:</span>
            <span class="summary-value">${computedTotalSales}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Total Returns:</span>
            <span class="summary-value">${report.total_returns}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Net Sales Count:</span>
            <span class="summary-value">${computedNetSalesCount}</span>
          </div>
        </div>
      </div>

      <div class="z-report-section">
        <h4>Financial Summary</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Gross Sales:</span>
            <span class="summary-value">${currencySymbol}${report.gross_sales.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Returns Amount:</span>
            <span class="summary-value">${currencySymbol}${report.total_returns_amount.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Net Sales:</span>
            <span class="summary-value">${currencySymbol}${report.net_sales.toFixed(2)}</span>
          </div>
          <div class="summary-item" style="grid-column: span 3; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 10px;">
            <span class="summary-label" style="font-weight: bold; font-size: 16px;">Balance (Net Sales - Expenses):</span>
            <span class="summary-value" style="font-weight: bold; font-size: 16px; color: ${(Number(report.net_sales || 0) - Number(report.total_expenses || 0)) >= 0 ? '#059669' : '#dc2626'};">${currencySymbol}${(Number(report.net_sales || 0) - Number(report.total_expenses || 0)).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div class="z-report-section">
        <h4>Payment Methods</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">💵 Cash:</span>
            <span class="summary-value">${currencySymbol}${report.cash_sales.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">💳 Card:</span>
            <span class="summary-value">${currencySymbol}${report.card_sales.toFixed(2)}</span>
          </div>
          <div class="summary-item" style="grid-column: span 3; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 10px;">
            <span class="summary-label" style="font-weight: bold; font-size: 16px;">💰 TOTAL COLLECTED (Cash + Card):</span>
            <span class="summary-value" style="font-weight: bold; font-size: 16px; color: #059669;">${currencySymbol}${(report.total_sales_amount || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div class="z-report-section">
        <h4>💸 Expenses (Money Spent)</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Total Expenses:</span>
            <span class="summary-value" style="color: #dc2626;">${currencySymbol}${(report.total_expenses || 0).toFixed(2)}</span>
          </div>
          ${report.expense_description ? `
            <div class="summary-item" style="grid-column: span 3;">
              <span class="summary-label">Description:</span>
              <span class="summary-value">${report.expense_description}</span>
            </div>
          ` : ''}
          ${expenseDetailHtml}
        </div>
      </div>

      <div class="z-report-section">
        <h4>Tax Breakdown</h4>
        <div class="summary-grid">
          ${vatRendered.html}
        </div>
      </div>

      <div class="z-report-section">
        <h4>Cash Reconciliation</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Expected Cash:</span>
            <span class="summary-value">${currencySymbol}${report.expected_cash.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Actual Cash:</span>
            <span class="summary-value">${currencySymbol}${(report.actual_cash === null || report.actual_cash === undefined) ? 'N/A' : Number(report.actual_cash).toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Difference:</span>
            <span class="summary-value" style="color: ${(report.cash_difference === null || report.cash_difference === undefined) ? 'black' : (Number(report.cash_difference) < 0 ? 'red' : (Number(report.cash_difference) > 0 ? 'green' : 'black'))}">${currencySymbol}${(report.cash_difference === null || report.cash_difference === undefined) ? 'N/A' : Number(report.cash_difference).toFixed(2)}</span>
          </div>
        </div>
      </div>

      ${report.notes ? `
      <div class="z-report-section">
        <h4>Notes</h4>
        <p style="margin: 0; color: #64748b;">${report.notes}</p>
      </div>
      ` : ''}
    `;
    
    openModal('zReportDetailsModal');
    
    // Setup print button handler
    const printBtn = document.getElementById('printZReportBtn');
    if (printBtn) {
      // Remove old event listeners
      const newPrintBtn = printBtn.cloneNode(true);
      printBtn.parentNode.replaceChild(newPrintBtn, printBtn);
      
      newPrintBtn.addEventListener('click', () => {
        printZReport(report);
      });
    }
  } catch (error) {
    console.error('Error loading Z-report details:', error);
    showAlert('Error loading report details: ' + error.message, 'error', 'Error');
  }
}

async function printZReport(report) {
  try {
    const settings = await window.api.getSystemSettings();
    const currencySymbol = settings?.currency_symbol || '€';
    const printerName = (settings?.printer_name || '').toString().toLowerCase();
    const timeZone = getDisplayTimeZone();

    const inferLineWidth = (printer) => {
      const name = String(printer || '').toLowerCase();
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
        || name.includes('tm-t20')
        || name.includes('tm t20')
        || name.includes('tm-t88')
        || name.includes('tm t88');
      return looks80mm ? 48 : 32;
    };

    const LINE_WIDTH = inferLineWidth(printerName);

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

    const formatMoney = (amount) => {
      const num = Number(amount || 0);
      return num.toFixed(2).replace('.', ',') + currencySymbol;
    };

    const parseDateTimeLoose = (value) => {
      if (!value) return new Date();
      const s = String(value).trim();
      // SQLite CURRENT_TIMESTAMP is often like: "YYYY-MM-DD HH:MM:SS" (UTC).
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        return new Date(s.replace(' ', 'T') + 'Z');
      }
      // If already ISO-like, let Date parse it.
      return new Date(s);
    };

    const formatDateTime = (isoString) => {
      const dt = parseDateTimeLoose(isoString);
      try {
        const date = new Intl.DateTimeFormat('es-ES', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(dt);
        const time = new Intl.DateTimeFormat('es-ES', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(dt);
        return { date, time };
      } catch {
        const date = formatDateWithDisplayTimeZone(dt, 'es-ES');
        const time = formatTimeWithDisplayTimeZone(dt, 'es-ES');
        return { date, time };
      }
    };

    const getYmdPartsInTimeZone = (dateObj) => {
      const dt = dateObj instanceof Date ? dateObj : new Date(dateObj);
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(dt);
        const get = (t) => parts.find(p => p.type === t)?.value;
        return {
          year: Number(get('year')),
          month: Number(get('month')),
          day: Number(get('day'))
        };
      } catch {
        return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() };
      }
    };

    const inferRangeLabel = ({ startIso, endIso }) => {
      try {
        const startDt = parseDateTimeLoose(startIso);
        const endDt = parseDateTimeLoose(endIso);
        const s = getYmdPartsInTimeZone(startDt);
        const e = getYmdPartsInTimeZone(endDt);

        const sameDay = s.year === e.year && s.month === e.month && s.day === e.day;
        const lastDayOfMonth = (year, month1to12) => {
          // day count doesn't depend on timezone
          return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
        };

        const isFullMonth = (
          s.year === e.year &&
          s.month === e.month &&
          s.day === 1 &&
          e.day === lastDayOfMonth(s.year, s.month)
        );

        const isFullYear = (
          s.year === e.year &&
          s.month === 1 && s.day === 1 &&
          e.month === 12 && e.day === 31
        );

        if (isFullYear) {
          return { kind: 'year', label: String(s.year) };
        }

        if (isFullMonth) {
          const monthName = new Intl.DateTimeFormat('es-ES', { timeZone, month: 'long' }).format(startDt);
          return { kind: 'month', label: `${String(monthName || '').toUpperCase()} ${s.year}`.trim() };
        }

        if (sameDay) {
          const weekday = new Intl.DateTimeFormat('es-ES', { timeZone, weekday: 'long' }).format(startDt);
          return { kind: 'day', label: String(weekday || '').toUpperCase() };
        }

        // custom / other
        const sd = formatDateTime(startIso).date;
        const ed = formatDateTime(endIso).date;
        return { kind: 'custom', label: `${sd} - ${ed}` };
      } catch {
        return null;
      }
    };

    // VAT breakdown (dynamic) - must follow business rule:
    // Don't include PARKING/loan sales until paid; include loan payments on paid day.
    const start = report.start_datetime;
    const end = report.end_datetime;
    const vatRows = await computeVatBreakdownRowsForPeriod({
      startDateTime: start,
      endDateTime: end,
      cashierId: null,
      settings
    });

    const cashSales = Number(report.cash_sales || 0);
    const cardSales = Number(report.card_sales || 0);
    const totalSalesAmount = Number(report.total_sales_amount ?? (cashSales + cardSales) ?? 0);
    const totalExpenses = Number(report.total_expenses || 0);
    const expectedCash = Number(report.expected_cash || 0);
    const hasActualCash = !(report.actual_cash === null || report.actual_cash === undefined);
    const actualCash = hasActualCash ? (Number(report.actual_cash) || 0) : null;
    const hasDifference = !(report.cash_difference === null || report.cash_difference === undefined);
    const difference = hasDifference
      ? (Number(report.cash_difference) || 0)
      : (hasActualCash ? ((Number(actualCash) || 0) - expectedCash) : null);

    // Expense detail (for printing): prefer stored JSON, else fetch for the date.
    const parseExpenseJson = (payload) => {
      try {
        if (!payload) return null;
        const obj = (typeof payload === 'string') ? JSON.parse(payload) : payload;
        const auto = Array.isArray(obj?.auto) ? obj.auto : [];
        const manual = Array.isArray(obj?.manual) ? obj.manual : [];
        return [...auto, ...manual].filter(e => Number(e?.amount) > 0);
      } catch {
        return null;
      }
    };

    let expensesList = parseExpenseJson(report.expenses_json);
    if (!expensesList) {
      try {
        const startDate = start ? new Date(start).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        const endDate = end ? new Date(end).toISOString().split('T')[0] : startDate;
        const fetched = await window.api.getExpenses(startDate, endDate);
        const list = Array.isArray(fetched) ? fetched : (fetched?.expenses || []);
        expensesList = Array.isArray(list) ? list : [];
      } catch {
        expensesList = [];
      }
    }

    const cashExpensesList = (expensesList || []).filter(e => String(e?.payment_method || '').toLowerCase() === 'cash');
    const cashExpensesTotal = cashExpensesList.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
    
    // Format Z report for thermal printer
    const ESC = '\x1B';
    const GS = '\x1D';
    
    let receipt = '';
    
    // Initialize printer (the main process raw-print path will also apply
    // the configured ESC/POS code table so symbols like € render correctly).
    receipt += ESC + '@';

    // Prefer end_datetime as the "close time"; fall back to report_date.
    const printedAt = report?.end_datetime || report?.report_date;
    const { date: reportDate, time: reportTime } = formatDateTime(printedAt);

    const startFmt = start ? formatDateTime(start) : null;
    const endFmt = end ? formatDateTime(end) : null;

    // Header
    receipt += center((settings?.store_name || 'SUPERMARKET POS').toString().toUpperCase()) + '\n';
    receipt += center('ARQUEO DE CAJA') + '\n';
    receipt += '='.repeat(LINE_WIDTH) + '\n';
    receipt += `CAJA.......: PRINCIPAL\n`;
    receipt += `ARQUEO.....: ${report.report_number || ''}\n`;
    receipt += `FECHA......: ${reportDate}\n`;
    receipt += `HORA.......: ${reportTime}\n`;

    // Range name line (requested):
    // - Daily: weekday name
    // - Monthly: month name
    // - Yearly: year
    const inferred = inferRangeLabel({ startIso: start, endIso: end });
    if (inferred?.kind === 'day' && inferred.label) {
      receipt += `DIA........: ${inferred.label}\n`;
    } else if (inferred?.kind === 'month' && inferred.label) {
      receipt += `MES........: ${inferred.label}\n`;
    } else if (inferred?.kind === 'year' && inferred.label) {
      receipt += `ANO........: ${inferred.label}\n`;
    }

    if (startFmt?.date && endFmt?.date) {
      // Keep range in the same compact style as the daily Z report.
      receipt += `DESDE ARQ..: ${startFmt.date}\n`;
      receipt += `HASTA ARQ..: ${endFmt.date}\n`;
    }
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    // Sales summary
    receipt += rightLabelValue('VENTA BRUTA', formatMoney(report.gross_sales || 0)) + '\n';
    receipt += rightLabelValue('DEVOLUCIONES', formatMoney(report.total_returns_amount || 0)) + '\n';
    receipt += rightLabelValue('VENTA NETA', formatMoney(report.net_sales || 0)) + '\n';
    receipt += '\n';

    receipt += rightLabelValue('DOCUMENTOS', String(report.total_sales || 0).padStart(1, ' ')) + '\n';
    receipt += rightLabelValue('NUMERO DE VENTAS', String(report.total_sales || 0)) + '\n';
    receipt += rightLabelValue('NUMERO DEVOL.', String(report.total_returns || 0)) + '\n';
    receipt += rightLabelValue('VENTAS NETAS', String(report.net_sales_count || 0)) + '\n';
    receipt += '-'.repeat(LINE_WIDTH) + '\n';

    // Payment methods
    receipt += center('FORMAS PAGO') + '\n';
    receipt += rightLabelValue('CONTADO', formatMoney(cashSales)) + '\n';
    receipt += rightLabelValue('TARJETA', formatMoney(cardSales)) + '\n';
    receipt += '-'.repeat(LINE_WIDTH) + '\n';
    receipt += rightLabelValue('TOTAL COBRADO', formatMoney(totalSalesAmount)) + '\n';
    receipt += rightLabelValue('GASTOS', formatMoney(totalExpenses)) + '\n';
    receipt += rightLabelValue('BALANCE', formatMoney((Number(report.net_sales || 0) - totalExpenses) || 0)) + '\n';
    receipt += '\n';

    // Cash movements
    receipt += center('MOVIMIENTOS DE EFECTIVO') + '\n';
    receipt += rightLabelValue('ENTREGAS AL CONTADO', formatMoney(cashSales)) + '\n';
    receipt += rightLabelValue('SALIDAS DE CAJA', formatMoney(cashExpensesTotal)) + '\n';

    // Detailed cash expense lines (similar to the reference printer output)
    if (cashExpensesList.length) {
      receipt += '-'.repeat(LINE_WIDTH) + '\n';
      receipt += padRight('MOTIVO', Math.max(8, LINE_WIDTH - 12)) + padLeft('TOTAL', 12) + '\n';
      for (const e of cashExpensesList) {
        const label = String(e?.description || e?.category || 'Gasto').trim();
        const amt = Number(e?.amount || 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const leftWidth = Math.max(8, LINE_WIDTH - 12);
        const left = label.length > leftWidth ? label.slice(0, leftWidth) : label;
        receipt += padRight(left, leftWidth) + padLeft(formatMoney(amt), 12) + '\n';
      }
    }

    receipt += '-'.repeat(LINE_WIDTH) + '\n';
    receipt += rightLabelValue('EFECTIVO ESPERADO', formatMoney(expectedCash)) + '\n';
    if (hasActualCash && Number.isFinite(Number(actualCash))) {
      receipt += rightLabelValue('EFECTIVO REAL', formatMoney(actualCash)) + '\n';
      if (difference !== null && difference !== undefined && Number.isFinite(Number(difference))) {
        const diffNum = Number(difference) || 0;
        const diffText = (diffNum < 0 ? '-' : '') + formatMoney(Math.abs(diffNum));
        receipt += rightLabelValue('DIFERENCIA', diffText) + '\n';
      }
    }
    receipt += '\n';

    // Card movements
    receipt += center('MOVIMIENTOS DE TARJETA') + '\n';
    receipt += rightLabelValue('COBROS CON TARJETA', formatMoney(cardSales)) + '\n';
    receipt += rightLabelValue('PAGOS EN TARJETA', formatMoney(cardSales)) + '\n';
    receipt += '\n';

    // VAT breakdown
    receipt += center('DESGLOSE DEL IVA') + '\n';
    const ivaWidth = 5;
    const remaining = LINE_WIDTH - ivaWidth;
    const colWidth = Math.floor(remaining / 3);
    const rem = remaining - (colWidth * 3);
    const baseWidth = colWidth;
    const cuotaWidth = colWidth;
    const totalWidth = colWidth + rem;

    receipt += padRight('Iva', ivaWidth)
      + padLeft('Base', baseWidth)
      + padLeft('Cuota', cuotaWidth)
      + padLeft('Total', totalWidth)
      + '\n';

    let sumBase = 0;
    let sumCuota = 0;
    let sumTotal = 0;
    vatRows.forEach(r => {
      sumBase += r.base;
      sumCuota += r.cuota;
      sumTotal += r.total;
      receipt += padRight(`${r.rate}%`, ivaWidth)
        + padLeft(formatMoney(r.base), baseWidth)
        + padLeft(formatMoney(r.cuota), cuotaWidth)
        + padLeft(formatMoney(r.total), totalWidth)
        + '\n';
    });

    receipt += '-'.repeat(LINE_WIDTH) + '\n';
    receipt += padRight('TOTAL', ivaWidth)
      + padLeft(formatMoney(sumBase), baseWidth)
      + padLeft(formatMoney(sumCuota), cuotaWidth)
      + padLeft(formatMoney(sumTotal), totalWidth)
      + '\n';

    // Footer
    receipt += '\n';
    receipt += `LE ATENDIO.: ${(report.cashier_name || '').toString().slice(0, LINE_WIDTH - 12)}\n`;
    receipt += '='.repeat(LINE_WIDTH) + '\n';

    // Cut
    receipt += GS + 'V' + String.fromCharCode(65) + String.fromCharCode(2);
    receipt += '\n';
    
    // Print using thermal printer
    const result = await window.api.printReceipt({ raw: true, text: receipt });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to print');
    }
    
    showAlert('Z-Report printed successfully', 'success');
  } catch (error) {
    console.error('Error printing Z report:', error);
    showAlert('Failed to print Z-Report: ' + error.message, 'error', 'Print Error');
  }
}

// ============== EXPENSES MANAGEMENT ==============
let currentExpensePeriod = 'today';
let currentExpenseStartDate = null;
let currentExpenseEndDate = null;

async function loadExpensesView() {
  // Set today as default
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('expenseStartDate').value = today;
  document.getElementById('expenseEndDate').value = today;
  
  // Setup event listeners
  document.getElementById('addExpenseBtn').addEventListener('click', () => openExpenseModal());
  
  // Filter buttons
  document.querySelectorAll('.filter-controls .filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-controls .filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      const period = e.target.dataset.period;
      currentExpensePeriod = period;
      
      if (period === 'custom') {
        document.getElementById('expenseCustomDateRange').style.display = 'flex';
      } else {
        document.getElementById('expenseCustomDateRange').style.display = 'none';
        loadExpensesByPeriod(period);
      }
    });
  });
  
  document.getElementById('applyDateFilter').addEventListener('click', () => {
    const startDate = document.getElementById('expenseStartDate').value;
    const endDate = document.getElementById('expenseEndDate').value;
    if (startDate && endDate) {
      currentExpenseStartDate = startDate;
      currentExpenseEndDate = endDate;
      loadExpenses(startDate, endDate);
    }
  });
  
  // Setup expense form
  const expenseForm = document.getElementById('expenseForm');
  if (expenseForm) {
    expenseForm.removeEventListener('submit', handleExpenseSubmit);
    expenseForm.addEventListener('submit', handleExpenseSubmit);
  }
  
  // Load today's expenses by default
  loadExpensesByPeriod('today');
}

async function loadExpensesByPeriod(period) {
  const APP_TIME_ZONE = 'Europe/Madrid';
  const ymdInTz = (date, timeZone = APP_TIME_ZONE) => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    } catch {
      // Fallback: local date (best-effort)
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  };

  const madridAnchorNoonUtc = () => {
    const now = new Date();
    // Build a stable anchor representing the current Madrid date.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);
    const get = (t) => parts.find(p => p.type === t)?.value;
    const year = Number(get('year'));
    const month = Number(get('month'));
    const day = Number(get('day'));
    // Noon UTC avoids DST edge cases when subtracting days.
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  };

  const weekdayIndexInMadrid = (date) => {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, weekday: 'short' }).format(date);
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wd] ?? 0;
  };

  const anchor = madridAnchorNoonUtc();
  let startDate, endDate;
  
  switch(period) {
    case 'today':
      // Use business-day boundary (resets on Z-report close)
      try {
        if (window.api?.getBusinessDayRange && window.api?.getExpensesByDateTimeRange) {
          const biz = await window.api.getBusinessDayRange('today');
          if (biz?.startDateTime && biz?.endDateTime) {
            currentExpenseStartDate = null;
            currentExpenseEndDate = null;
            await loadExpensesByDateTimeRange(biz.startDateTime, biz.endDateTime);
            return;
          }
        }
      } catch {
        // fall back to calendar day
      }

      startDate = endDate = ymdInTz(anchor);
      break;
    case 'yesterday': {
      const y = new Date(anchor);
      y.setUTCDate(y.getUTCDate() - 1);
      startDate = endDate = ymdInTz(y);
      break;
    }
    case 'week':
      {
        const idx = weekdayIndexInMadrid(anchor);
        const weekStart = new Date(anchor);
        weekStart.setUTCDate(weekStart.getUTCDate() - idx);
        startDate = ymdInTz(weekStart);
        endDate = ymdInTz(anchor);
      }
      break;
    case 'month':
      {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: APP_TIME_ZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(anchor);
        const get = (t) => parts.find(p => p.type === t)?.value;
        const year = Number(get('year'));
        const month = Number(get('month'));
        const monthStart = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
        startDate = ymdInTz(monthStart);
        endDate = ymdInTz(anchor);
      }
      break;
    case 'year':
      {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: APP_TIME_ZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(anchor);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const yearStart = new Date(Date.UTC(year, 0, 1, 12, 0, 0));
        startDate = ymdInTz(yearStart);
        endDate = ymdInTz(anchor);
      }
      break;
  }
  
  currentExpenseStartDate = startDate;
  currentExpenseEndDate = endDate;
  await loadExpenses(startDate, endDate);
}

async function loadExpensesByDateTimeRange(startDateTime, endDateTime) {
  try {
    const expenses = await window.api.getExpensesByDateTimeRange(startDateTime, endDateTime);
    const summary = await window.api.getExpenseSummaryByDateTimeRange(startDateTime, endDateTime);

    // Compute "sales" for net profit as money collected in this window:
    // - Non-loan sales totals (cash/card/split)
    // - Plus loan payments (paid PARKING)
    // - Minus returns (refunds) by return_date
    let totalSales = 0;
    try {
      const salesData = await (window.api?.getSalesByDateTimeRange
        ? window.api.getSalesByDateTimeRange(startDateTime, endDateTime, null)
        : window.api.getSalesByDateRange(startDateTime, endDateTime, null));
      const sales = Array.isArray(salesData) ? salesData : (salesData?.sales || []);
      const nonLoanSales = (sales || []).filter(s => String(s?.payment_method || '').toLowerCase() !== 'loan');
      totalSales += nonLoanSales.reduce((sum, s) => sum + (Number(s?.total) || 0), 0);

      const loanPays = await (window.api?.getLoanPaymentsByDateTimeRange
        ? window.api.getLoanPaymentsByDateTimeRange(startDateTime, endDateTime, null)
        : window.api.getLoanPaymentsByDateRange(startDateTime, endDateTime, null));
      totalSales += (loanPays || []).reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);

      const returnsData = await (window.api?.getReturnsByDateTimeRange
        ? window.api.getReturnsByDateTimeRange(startDateTime, endDateTime, null)
        : window.api.getReturnsByDateRange(startDateTime, endDateTime, null));
      const returns = Array.isArray(returnsData) ? returnsData : (returnsData?.returns || []);
      (returns || []).forEach(r => {
        if (r.items) {
          try { r.items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items; } catch { r.items = []; }
        }
      });
      const deduped = dedupeReturnsByOriginalSaleId(returns);
      totalSales -= deduped.reduce((sum, r) => sum + getReturnGrossTotal(r), 0);
    } catch {
      // ignore sales calc errors
    }

    const totalExpenses = summary?.total_amount || 0;
    const netProfit = totalSales - totalExpenses;

    const currencySymbol = systemSettings?.currency_symbol || '€';
    document.getElementById('netProfit').textContent = `${currencySymbol}${netProfit.toFixed(2)}`;
    document.getElementById('netProfit').style.color = netProfit >= 0 ? 'white' : '#ffeb3b';

    document.getElementById('totalExpenseAmount').textContent = `${currencySymbol}${(Number(totalExpenses) || 0).toFixed(2)}`;
    document.getElementById('totalExpenseCount').textContent = summary?.total_count || 0;
    document.getElementById('avgExpenseAmount').textContent = `${currencySymbol}${(summary?.avg_amount || 0).toFixed(2)}`;

    const tbody = document.getElementById('expensesTableBody');
    tbody.innerHTML = '';
    const list = Array.isArray(expenses) ? expenses : [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No expenses found for this period</td></tr>';
      return;
    }

    list.forEach(expense => {
      const row = document.createElement('tr');
      const who = expense.user_name || expense.cashier_name || 'Unknown';
      row.innerHTML = `
        <td>${formatDateWithDisplayTimeZone(new Date(expense.expense_date), 'en-GB')}</td>
        <td>${expense.category}</td>
        <td>${expense.description}</td>
        <td>${currencySymbol}${parseFloat(expense.amount).toFixed(2)}</td>
        <td>${expense.payment_method}</td>
        <td>${who}</td>
        <td>
          <button class="btn-icon" onclick="editExpense(${expense.id})" title="Edit">✏️</button>
          <button class="btn-icon" onclick="deleteExpense(${expense.id})" title="Delete">🗑️</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading expenses (datetime range):', error);
    showAlert('Error loading expenses: ' + error.message, 'error');
  }
}

async function loadExpenses(startDate, endDate) {
  try {
    const expenses = await window.api.getExpenses(startDate, endDate);
    const summary = await window.api.getExpenseSummary(startDate, endDate);
    
    // Get sales data for net profit calculation
    const salesReport = await window.api.getSalesReport(startDate, endDate);
    const totalSales = salesReport.sales.reduce((sum, day) => sum + (day.total_sales || 0), 0);
    
    // Calculate Net Profit = Sales - Expenses
    const totalExpenses = summary.total_amount || 0;
    const netProfit = totalSales - totalExpenses;
    
    // Update summary cards
    const currencySymbol = systemSettings?.currency_symbol || '€';
    document.getElementById('netProfit').textContent = `${currencySymbol}${netProfit.toFixed(2)}`;
    document.getElementById('netProfit').style.color = netProfit >= 0 ? 'white' : '#ffeb3b';
    
    document.getElementById('totalExpenseAmount').textContent = `${currencySymbol}${totalExpenses.toFixed(2)}`;
    document.getElementById('totalExpenseCount').textContent = summary.total_count || 0;
    document.getElementById('avgExpenseAmount').textContent = `${currencySymbol}${(summary.avg_amount || 0).toFixed(2)}`;
    
    // Display expenses table
    const tbody = document.getElementById('expensesTableBody');
    tbody.innerHTML = '';
    
    if (expenses.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No expenses found for this period</td></tr>';
      return;
    }
    
    expenses.forEach(expense => {
      const row = document.createElement('tr');
      const who = expense.user_name || expense.cashier_name || 'Unknown';
      row.innerHTML = `
        <td>${formatDateWithDisplayTimeZone(new Date(expense.expense_date), 'en-GB')}</td>
        <td>${expense.category}</td>
        <td>${expense.description}</td>
        <td>${currencySymbol}${parseFloat(expense.amount).toFixed(2)}</td>
        <td>${expense.payment_method}</td>
        <td>${who}</td>
        <td>
          <button class="btn-icon" onclick="editExpense(${expense.id})" title="Edit">✏️</button>
          <button class="btn-icon" onclick="deleteExpense(${expense.id})" title="Delete">🗑️</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading expenses:', error);
    showAlert('Error loading expenses: ' + error.message, 'error');
  }
}

// Expense modal no longer asks for description.
// Keep a cached description for edit-mode so we don't wipe it.
let expenseEditCachedDescription = '';

function openExpenseModal(expenseId = null) {
  const modal = document.getElementById('expenseModal');
  const form = document.getElementById('expenseForm');
  const title = document.getElementById('expenseModalTitle');
  
  // Reset form
  form.reset();
  document.getElementById('expenseId').value = '';
  expenseEditCachedDescription = '';
  
  if (expenseId) {
    title.textContent = 'Edit Expense';
    // Load expense data
    loadExpenseData(expenseId);
  } else {
    title.textContent = 'Add Expense';
    // Set today's date
    try {
      document.getElementById('expenseDate').value = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch {
      document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
    }
  }
  
  modal.classList.add('active');

  // Touchscreen UX: focus the first field and force-open the on-screen keyboard.
  try {
    setTimeout(() => {
      const field = document.getElementById('expenseCategory') || document.getElementById('expenseAmount');
      if (!field) return;
      try { window.__virtualKeyboardForceOpen = true; } catch { /* ignore */ }
      try {
        field.focus();
        field.dispatchEvent(new Event('focusin', { bubbles: true }));
      } catch {
        // ignore
      }
    }, 50);
  } catch {
    // ignore
  }
}

async function loadExpenseData(id) {
  try {
    const expense = await window.api.getExpenseById(id);
    if (expense) {
      document.getElementById('expenseId').value = expense.id;
      document.getElementById('expenseDate').value = expense.expense_date;
      document.getElementById('expenseCategory').value = expense.category;
      expenseEditCachedDescription = (expense.description || '').toString();
      document.getElementById('expenseAmount').value = expense.amount;
      document.getElementById('expensePaymentMethod').value = expense.payment_method;
    }
  } catch (error) {
    console.error('Error loading expense:', error);
    showAlert('Error loading expense data', 'error');
  }
}

async function handleExpenseSubmit(e) {
  e.preventDefault();
  
  const expenseId = document.getElementById('expenseId').value;
  const cashierName = (currentUser?.full_name || currentUser?.name || currentUser?.username || '').toString().trim();

  const category = (document.getElementById('expenseCategory')?.value || '').toString().trim();
  // DB requires description NOT NULL. Since UI no longer collects it:
  // - On edit: preserve existing description
  // - On create: use category as description (or a safe fallback)
  const description = expenseId
    ? (expenseEditCachedDescription || category || 'Expense')
    : (category || 'Expense');

  // Accept "12,50", "€ 12.50" etc.; parseFloat alone gave NaN, which SQLite
  // stores as NULL -> "NOT NULL constraint failed: expenses.amount".
  const amountRaw = String(document.getElementById('expenseAmount')?.value || '')
    .replace(/[€\s]/g, '')
    .replace(',', '.');
  const amount = parseFloat(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    showAlert('Please enter a valid amount (e.g. 12.50)', 'warning');
    return;
  }

  const expenseData = {
    expenseDate: document.getElementById('expenseDate').value,
    category,
    description,
    amount,
    paymentMethod: document.getElementById('expensePaymentMethod').value,
    userId: currentUser?.id,
    cashierName: cashierName
  };
  
  try {
    if (expenseId) {
      await window.api.updateExpense(parseInt(expenseId), expenseData);
      showAlert('Expense updated successfully', 'success');
    } else {
      await window.api.createExpense(expenseData);
      showAlert('Expense added successfully', 'success');
    }
    
    closeModal('expenseModal');
    
    // Reload expenses
    if (currentExpensePeriod === 'custom') {
      await loadExpenses(currentExpenseStartDate, currentExpenseEndDate);
    } else {
      await loadExpensesByPeriod(currentExpensePeriod);
    }
  } catch (error) {
    console.error('Error saving expense:', error);
    showAlert('Error saving expense: ' + error.message, 'error');
  }
}

window.editExpense = function(id) {
  openExpenseModal(id);
};

window.deleteExpense = async function(id) {
  if (!confirm('Are you sure you want to delete this expense?')) return;
  
  try {
    await window.api.deleteExpense(id);
    showAlert('Expense deleted successfully', 'success');
    
    // Reload expenses
    if (currentExpensePeriod === 'custom') {
      await loadExpenses(currentExpenseStartDate, currentExpenseEndDate);
    } else {
      await loadExpensesByPeriod(currentExpensePeriod);
    }
  } catch (error) {
    console.error('Error deleting expense:', error);
    showAlert('Error deleting expense: ' + error.message, 'error');
  }
};

// ============== UTILITIES ==============
function getDisplayTimeZone() {
  return 'Europe/Madrid';
}

function formatDateTimeInAppTimeZone(date) {
  const timeZone = getDisplayTimeZone();
  try {
    return new Intl.DateTimeFormat('en-US', {
      ...(timeZone ? { timeZone } : {}),
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  } catch {
    // Fallback to local time if Intl timeZone isn't available for some reason.
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}

function formatReceiptStyleDateTime(date) {
  return formatDateTimeWithDisplayTimeZone(date, 'es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDateTimeWithDisplayTimeZone(date, locale = 'en-GB', options = {}) {
  const dt = (date instanceof Date) ? date : new Date(date);
  const timeZone = getDisplayTimeZone();
  try {
    return new Intl.DateTimeFormat(locale, {
      ...(timeZone ? { timeZone } : {}),
      ...options,
    }).format(dt);
  } catch {
    return dt.toLocaleString(locale, options);
  }
}

function parseAppDateTimeLoose(value) {
  if (!value) return new Date();
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    const dt = new Date(s.replace(' ', 'T') + 'Z');
    return Number.isNaN(dt.getTime()) ? new Date(s) : dt;
  }
  return new Date(s);
}

function formatDateWithDisplayTimeZone(date, locale = 'en-GB') {
  return formatDateTimeWithDisplayTimeZone(date, locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatTimeWithDisplayTimeZone(date, locale = 'en-GB') {
  return formatDateTimeWithDisplayTimeZone(date, locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function updateDateTime() {
  const now = new Date();
  const dateTimeStr = formatReceiptStyleDateTime(now);
  const elem = document.getElementById('currentDateTime');
  if (elem) elem.textContent = dateTimeStr;
}

// ============== CUSTOM ALERT ==============
function showAlert(message, type = 'success', title = null) {
  const overlay = document.getElementById('customAlert');
  const icon = document.getElementById('customAlertIcon');
  const iconText = document.getElementById('customAlertIconText');
  const titleEl = document.getElementById('customAlertTitle');
  const messageEl = document.getElementById('customAlertMessage');
  const btn = document.getElementById('customAlertBtn');
  
  // Set icon and type
  icon.className = 'custom-alert-icon ' + type;
  
  // Set icon based on type
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  iconText.textContent = icons[type] || icons.success;
  
  // Set title based on type or custom title
  const titles = {
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Information'
  };
  titleEl.textContent = title || titles[type] || titles.success;
  
  // Set message
  messageEl.textContent = message;
  
  // Show overlay
  overlay.classList.add('active');
  
  // Setup close button
  const closeAlert = () => {
    overlay.classList.remove('active');
    btn.removeEventListener('click', closeAlert);
  };
  
  btn.addEventListener('click', closeAlert);
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeAlert();
    }
  });
}

// Customer Display Functions
async function updateCustomerDisplayData() {
  if (cart.length === 0) {
    // Show welcome message if cart is empty
    await showCustomerDisplayWelcome();
    return;
  }

  // Match common pole-display behavior (like the reference photo):
  // while scanning, show the last item name on line 1 and the calculation on line 2.
  const lastItem = cart[0];
  if (!lastItem) {
    await showCustomerDisplayWelcome();
    return;
  }

  const discountPercent = lastItem.discountPercent || 0;
  const discountAmount = lastItem.subtotal * (discountPercent / 100);
  const finalTotal = lastItem.subtotal - discountAmount;

  const unit = lastItem.isWeightBased ? 'kg' : 'pc';
  await updateCustomerDisplayItem(lastItem.productName, finalTotal, {
    quantity: lastItem.quantity,
    unitPrice: lastItem.unitPrice,
    unit
  });
}

async function toggleCustomerDisplay() {
  try {
    await window.api.openCustomerDisplay();
    // Customer display opened - no popup
    updateCustomerDisplayData();
    pushMonitorCustomerDisplay();
  } catch (error) {
    showAlert('Failed to open customer display', 'error');
  }
}

async function openCashDrawer() {
  try {
    const result = await window.api.openCashDrawer();
    if (!result.success) {
      console.error('Cash drawer error:', result.error);
      showAlert(result.error || 'Failed to open cash drawer. Please check printer settings.', 'error');
    } else {
      console.log('Cash drawer opened successfully');
      // Success - optionally show brief success message
      // showAlert('Cash drawer opened', 'success');
    }
  } catch (error) {
    console.error('Error opening cash drawer:', error);
    showAlert('Error opening cash drawer: ' + error.message, 'error');
  }
}

async function printReceiptToThermalPrinter(sale, options = {}) {
  try {
    if (!systemSettings) {
      systemSettings = await window.api.getSystemSettings();
    }
    
    const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
    const ownerName = systemSettings?.owner_name || '';
    const nieNumber = systemSettings?.nie_number || '';
    const companyAddress = systemSettings?.company_address || '';
    const currencySymbol = systemSettings?.currency_symbol || '€';
    const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';

    const printerName = (systemSettings?.printer_name || '').toString().toLowerCase();
    const looks80mm = printerName.includes('80mm')
      || printerName.includes('80 mm')
      || printerName.includes('posprinter')
      || printerName.includes('pos-80')
      || printerName.includes('pos 80')
      || printerName.includes('easy 80')
      || printerName.includes('tp easy 80')
      || printerName.includes('tp7001')
      || printerName.includes('tp 7001')
      || printerName.includes('iggual');

    // Calculate tax breakdown by rate (to match the on-screen receipt)
    const taxBreakdown = {};
    (sale.items || []).forEach(item => {
      let taxRate = Number(item?.tax_rate ?? item?.taxRate);
      if (!Number.isFinite(taxRate)) {
        const product = allProducts.find(p => p.id === item.product_id);
        const productTaxRate = Number(product?.tax_rate);
        if (Number.isFinite(productTaxRate)) {
          taxRate = productTaxRate;
        } else {
          const category = product ? allCategories.find(c => c.name === product.category) : null;
          taxRate = Number(category?.tax_rate || 0);
        }
      }
      if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = 0;

      const taxRatePercent = Math.round(taxRate * 100);

      const basePrice = item.subtotal / (1 + taxRate);
      const taxAmount = item.subtotal - basePrice;

      if (!taxBreakdown[taxRatePercent]) {
        taxBreakdown[taxRatePercent] = { base: 0, tax: 0, total: 0 };
      }

      taxBreakdown[taxRatePercent].base += basePrice;
      taxBreakdown[taxRatePercent].tax += taxAmount;
      taxBreakdown[taxRatePercent].total += item.subtotal;
    });

    const taxBreakdownRows = Object.keys(taxBreakdown)
      .map(r => parseInt(r, 10))
      .filter(r => Number.isFinite(r))
      .sort((a, b) => a - b)
      .map(rate => ({
        rate,
        base: taxBreakdown[rate].base,
        tax: taxBreakdown[rate].tax,
        total: taxBreakdown[rate].total
      }));
    
    const duplicateNumber = Number(options?.duplicateNumber || 0);
    const shouldKickDrawerInReceipt = options?.kickDrawer === true
      && String(sale?.payment_method || '').toLowerCase() === 'cash'
      && !(duplicateNumber > 0);

    const receiptData = {
      storeName: storeName,
      ownerName: ownerName,
      nieNumber: nieNumber,
      companyAddress: companyAddress,
      lineWidth: looks80mm ? 48 : undefined,
      restaurantName: sale?.loan_restaurant_name || null,
      restaurantNie: sale?.loan_restaurant_nie || null,
      customerName: sale?.loan_customer_name || null,
      customerPhone: sale?.loan_customer_phone || null,
      receiptId: sale.id,
      duplicateNumber: duplicateNumber > 0 ? Math.floor(duplicateNumber) : 0,
      // Use ISO/DB timestamp and let the main process format it in the correct timezone.
      dateIso: sale?.sale_date || new Date().toISOString(),
      items: sale.items.map(item => ({
        name: item.product_name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        taxRate: item.tax_rate,
        discountPercent: item.discount_percent,
        subtotal: item.subtotal
      })),
      subtotal: sale.subtotal,
      tax: sale.tax,
      total: sale.total,
      taxBreakdown: taxBreakdownRows,
      paymentMethod: sale.payment_method,
      paymentAmount: sale.payment_amount || sale.total,
      changeAmount: sale.change_amount || 0,
      kickDrawer: shouldKickDrawerInReceipt,
      currency: currencySymbol,
      footer: receiptFooter,
      cashier: currentUser.full_name
    };
    
    console.log('Printing receipt to thermal printer...');
    const result = await window.api.printReceipt(receiptData);
    
    if (!result.success) {
      console.error('Thermal print error:', result.error);
      showAlert('Failed to print receipt: ' + (result.error || 'Printer not configured'), 'error', 'Print Error');
      return false;
    } else {
      console.log('Receipt printed successfully to thermal printer');
      return true;
    }
  } catch (error) {
    console.error('Error printing receipt:', error);
    showAlert('Failed to print receipt: ' + error.message, 'error', 'Print Error');
    return false;
  }
}



// Override native alert: default to non-success (prevents green "Success" for errors)
window.alert = (message) => showAlert(String(message ?? ''), 'info');

// Make functions globally available
window.addToCart = addToCart;
window.updateCartQuantity = updateCartQuantity;
window.removeFromCart = removeFromCart;
window.promptForWeight = promptForWeight;
window.editCartWeight = editCartWeight;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.viewSale = viewSale;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.changeUserPassword = changeUserPassword;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.toggleCategoryFavorite = toggleCategoryFavorite;
window.editSubcategory = editSubcategory;
window.deleteSubcategory = deleteSubcategory;
window.openCategoryModalFromProduct = openCategoryModalFromProduct;
window.toggleCustomerDisplay = toggleCustomerDisplay;
window.openCashDrawer = openCashDrawer;
window.showAlert = showAlert;
window.viewZReportDetails = viewZReportDetails;
window.printSalesReportThermal = printSalesReportThermal;
window.viewParkingBillForLoan = viewParkingBillForLoan;
window.printParkingBillForLoan = printParkingBillForLoan;

// Detect available printers
async function detectPrinters() {
  const printerListDiv = document.getElementById('printerList');
  printerListDiv.innerHTML = '<p style="color: #667eea;">🔍 Detecting printers...</p>';
  
  try {
    const result = await window.api.getPrinterList();
    
    if (result.success && result.printers.length > 0) {
      printerListDiv.innerHTML = '<p style="font-weight: bold; margin-top: 10px;">Available Printers:</p>';
      const ul = document.createElement('ul');
      ul.style.marginLeft = '20px';

      // Prefer real printer drivers over virtual printers
      const printers = result.printers.filter(p => !/pdf|xps|onenote|fax/i.test(p));

      // Auto-select a best match to help customers (still shows the list below)
      if (printers.length > 0) {
        const best =
          printers.find(p => /TM|Epson|iggual|thermal|POS|receipt|80/i.test(p)) ||
          printers[0];
        selectPrinter(best);
      }

      (printers.length ? printers : result.printers).forEach((printer) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#';
        a.style.color = '#667eea';
        a.style.textDecoration = 'underline';
        a.textContent = printer;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          selectPrinter(printer);
        });
        li.appendChild(a);
        ul.appendChild(li);
      });

      printerListDiv.appendChild(ul);
    } else {
      printerListDiv.innerHTML = '<p style="color: #e74c3c;">No printers detected. Enter printer name manually.</p>';
    }
  } catch (error) {
    printerListDiv.innerHTML = '<p style="color: #e74c3c;">Error detecting printers. Enter printer name manually.</p>';
  }
}

function selectPrinter(printerName) {
  document.getElementById('printerName').value = printerName;
  document.getElementById('printerList').innerHTML = '<p style="color: #27ae60;">✓ Selected: ' + printerName + '</p>';
}

// ============== ANALYTICS DASHBOARD ==============
let analyticsCharts = {};

async function loadAnalyticsView() {
  // Set default dates (last 30 days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  
  document.getElementById('analyticsStartDate').valueAsDate = startDate;
  document.getElementById('analyticsEndDate').valueAsDate = endDate;
  
  // Setup event listeners
  document.getElementById('loadAnalyticsBtn').onclick = loadAnalyticsData;
}

async function loadAnalyticsData() {
  const startDate = document.getElementById('analyticsStartDate').value;
  const endDate = document.getElementById('analyticsEndDate').value;
  
  if (!startDate || !endDate) {
    showAlert('Please select both start and end dates', 'warning', 'Invalid Dates');
    return;
  }
  
  try {
    const data = await window.api.getAnalyticsData(startDate, endDate);
    displayAnalytics(data);
  } catch (error) {
    console.error('Error loading analytics:', error);
    showAlert('Error loading analytics data: ' + String(error?.message || error || 'Unknown error'), 'error');
  }
}

function displayAnalytics(data) {
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  // Show analytics sections
  document.getElementById('analyticsSummary').style.display = 'grid';
  document.getElementById('analyticsCharts').style.display = 'block';
  
  // Update summary cards
  document.getElementById('totalRevenue').textContent = 
    currencySymbol + (data.summary.total_revenue || 0).toFixed(2);
  document.getElementById('totalProfit').textContent = 
    currencySymbol + (data.summary.total_profit || 0).toFixed(2);
  document.getElementById('profitMargin').textContent = 
    (data.summary.profit_margin || 0) + '%';
  document.getElementById('totalTransactions').textContent = 
    (data.summary.total_transactions || 0).toLocaleString();
  document.getElementById('avgTransaction').textContent = 
    currencySymbol + (data.summary.avg_transaction || 0).toFixed(2);
  
  // Destroy existing charts
  Object.values(analyticsCharts).forEach(chart => chart?.destroy());
  analyticsCharts = {};
  
  // Sales Trends Chart
  const salesTrendsCtx = document.getElementById('salesTrendsChart').getContext('2d');
  analyticsCharts.salesTrends = new Chart(salesTrendsCtx, {
    type: 'line',
    data: {
      labels: data.salesTrends.map(d => formatDateWithDisplayTimeZone(new Date(d.date), 'en-GB')),
      datasets: [{
        label: 'Total Sales',
        data: data.salesTrends.map(d => d.total_sales),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4
      }, {
        label: 'Transactions',
        data: data.salesTrends.map(d => d.transaction_count),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4,
        yAxisID: 'y1'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Sales (' + currencySymbol + ')'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Transactions'
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
  
  // Peak Hours Chart
  const peakHoursCtx = document.getElementById('peakHoursChart').getContext('2d');
  analyticsCharts.peakHours = new Chart(peakHoursCtx, {
    type: 'bar',
    data: {
      labels: data.peakHours.map(h => h.hour + ':00'),
      datasets: [{
        label: 'Total Sales',
        data: data.peakHours.map(h => h.total_sales),
        backgroundColor: 'rgba(168, 85, 247, 0.6)',
        borderColor: '#a855f7',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const hour = data.peakHours[context.dataIndex];
              return [
                'Sales: ' + currencySymbol + hour.total_sales.toFixed(2),
                'Transactions: ' + hour.transaction_count,
                'Avg: ' + currencySymbol + hour.avg_transaction
              ];
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Sales (' + currencySymbol + ')'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Hour of Day'
          }
        }
      }
    }
  });
  
  // Top Products Chart
  const topProductsCtx = document.getElementById('topProductsChart').getContext('2d');
  const topProducts = data.topProducts.slice(0, 10);
  analyticsCharts.topProducts = new Chart(topProductsCtx, {
    type: 'bar',
    data: {
      labels: topProducts.map(p => p.product_name.length > 20 ? p.product_name.substring(0, 20) + '...' : p.product_name),
      datasets: [{
        label: 'Revenue',
        data: topProducts.map(p => p.total_revenue),
        backgroundColor: 'rgba(34, 197, 94, 0.6)',
        borderColor: '#22c55e',
        borderWidth: 1
      }, {
        label: 'Profit',
        data: topProducts.map(p => p.total_profit),
        backgroundColor: 'rgba(249, 115, 22, 0.6)',
        borderColor: '#f97316',
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Amount (' + currencySymbol + ')'
          }
        }
      }
    }
  });
  
  // Category Profit Chart
  const categoryProfitCtx = document.getElementById('categoryProfitChart').getContext('2d');
  analyticsCharts.categoryProfit = new Chart(categoryProfitCtx, {
    type: 'doughnut',
    data: {
      labels: data.categoryProfit.map(c => c.category),
      datasets: [{
        label: 'Profit',
        data: data.categoryProfit.map(c => c.total_profit),
        backgroundColor: [
          '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
          '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right'
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const category = data.categoryProfit[context.dataIndex];
              return [
                category.category + ':',
                'Revenue: ' + currencySymbol + category.total_revenue.toFixed(2),
                'Profit: ' + currencySymbol + category.total_profit.toFixed(2),
                'Margin: ' + category.profit_margin_percent + '%'
              ];
            }
          }
        }
      }
    }
  });
  
  // Payment Methods Chart
  const paymentMethodsCtx = document.getElementById('paymentMethodsChart').getContext('2d');
  analyticsCharts.paymentMethods = new Chart(paymentMethodsCtx, {
    type: 'pie',
    data: {
      labels: data.paymentMethods.map(pm => pm.payment_method || 'Unknown'),
      datasets: [{
        data: data.paymentMethods.map(pm => pm.total_sales),
        backgroundColor: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const pm = data.paymentMethods[context.dataIndex];
              return [
                pm.payment_method + ':',
                'Sales: ' + currencySymbol + pm.total_sales.toFixed(2),
                'Transactions: ' + pm.transaction_count,
                'Avg: ' + currencySymbol + pm.avg_transaction
              ];
            }
          }
        }
      }
    }
  });
  
  // Profit Margins Table
  const tbody = document.querySelector('#profitMarginsTable tbody');
  tbody.innerHTML = topProducts.map(product => `
    <tr>
      <td style="font-weight: 500;">${product.product_name}</td>
      <td style="color: #10b981;">${currencySymbol}${product.total_revenue.toFixed(2)}</td>
      <td style="color: #f59e0b;">${currencySymbol}${product.total_profit.toFixed(2)}</td>
      <td>
        <span style="padding: 4px 8px; border-radius: 4px; font-weight: 600; 
          background: ${product.profit_margin_percent > 30 ? '#d1fae5' : product.profit_margin_percent > 15 ? '#fef3c7' : '#fee2e2'};
          color: ${product.profit_margin_percent > 30 ? '#065f46' : product.profit_margin_percent > 15 ? '#92400e' : '#991b1b'};">
          ${product.profit_margin_percent}%
        </span>
      </td>
    </tr>
  `).join('');
}

window.detectPrinters = detectPrinters;
window.selectPrinter = selectPrinter;

// ============== CUSTOMER DISPLAY FUNCTIONS ==============

function buildMonitorCustomerDisplayPayload(extra = {}) {
  const currencySymbol = systemSettings?.currency_symbol || '€';
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';

  // Prices in this POS are tax-included; derive base/tax via reverse calc.
  let totalCents = 0;
  let subtotalBaseCents = 0;
  let taxCents = 0;

  const items = (cart || []).slice(0, 10).map(item => {
    recalcCartItemMoney(item);

    const taxRate = item.taxRate || 0;
    const discountPercent = item.discountPercent || 0;
    const lineSubtotalCents = item.subtotalCents ?? moneyToCents(item.subtotal);
    const discountCents = calcDiscountCents(lineSubtotalCents, discountPercent);
    const finalCents = lineSubtotalCents - discountCents;

    const baseCents = Math.round(finalCents / (1 + taxRate));
    const lineTaxCents = finalCents - baseCents;

    subtotalBaseCents += baseCents;
    taxCents += lineTaxCents;
    totalCents += finalCents;

    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    return {
      productName: String(item.productName || 'ITEM'),
      quantity: Number.isFinite(quantity) ? quantity : 1,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      subtotal: centsToMoney(finalCents)
    };
  });

  return {
    storeName,
    currencySymbol,
    items,
    subtotal: centsToMoney(subtotalBaseCents),
    tax: centsToMoney(taxCents),
    total: centsToMoney(totalCents),
    ...extra
  };
}

let monitorDisplayPushTimer = null;
let monitorDisplayHold = null;

function holdMonitorCustomerDisplay(extra = {}, holdMs = 8000) {
  const ms = Number(holdMs);
  const duration = Number.isFinite(ms) ? Math.max(0, ms) : 8000;
  monitorDisplayHold = {
    extra: extra || {},
    expiresAt: Date.now() + duration
  };
}

function clearMonitorCustomerDisplayHold() {
  monitorDisplayHold = null;
}

function pushMonitorCustomerDisplay(extra = {}) {
  try {
    if (!window?.api?.updateCustomerDisplay) return;
    if (monitorDisplayPushTimer) clearTimeout(monitorDisplayPushTimer);
    monitorDisplayPushTimer = setTimeout(async () => {
      try {
        const now = Date.now();
        const holdActive = monitorDisplayHold && now < (monitorDisplayHold.expiresAt || 0);
        if (monitorDisplayHold && !holdActive) {
          clearMonitorCustomerDisplayHold();
        }

        // If a hold is active (e.g. payment summary), keep those fields even if
        // the cart clears or welcome screen updates.
        const mergedExtra = holdActive
          ? { ...(extra || {}), ...(monitorDisplayHold.extra || {}) }
          : (extra || {});

        const payload = buildMonitorCustomerDisplayPayload(mergedExtra);
        await window.api.updateCustomerDisplay(payload);
      } catch {
        // ignore
      }
    }, 60);
  } catch {
    // ignore
  }
}

// Update customer display when item is added to cart
async function updateCustomerDisplayItem(itemName, price, meta = null) {
  try {
    const currencySymbol = systemSettings?.currency_symbol || '€';
    const quantity = meta?.quantity ?? null;
    const unitPrice = meta?.unitPrice ?? null;
    const unit = meta?.unit ?? null;
    await window.api.showCurrentItem(itemName, price, currencySymbol, quantity, unitPrice, unit);

    // If the modern monitor window is open, show a quick banner with the last item.
    pushMonitorCustomerDisplay({ bannerText: String(itemName || '').trim().slice(0, 120), paid: null, change: null });
  } catch (error) {
    console.warn('Customer display error:', error);
  }
}

// Update customer display with total amount
async function updateCustomerDisplayTotal(total) {
  try {
    const currencySymbol = systemSettings?.currency_symbol || '€';
    await window.api.showTotal(total, currencySymbol);
    pushMonitorCustomerDisplay({ bannerText: 'TOTAL', paid: null, change: null });
  } catch (error) {
    console.warn('Customer display error:', error);
  }
}

let customerDisplayFlashTimer = null;

async function flashCustomerDisplayCartItem(cartItemId, returnToTotalDelayMs = 1200) {
  try {
    const item = cart.find(i => i.cartItemId === cartItemId);
    if (!item) {
      await updateCustomerDisplayData();
      return;
    }

    const discountPercent = item.discountPercent || 0;
    const discountAmount = item.subtotal * (discountPercent / 100);
    const finalTotal = item.subtotal - discountAmount;

    const unit = item.isWeightBased ? 'kg' : 'pc';
    await updateCustomerDisplayItem(item.productName, finalTotal, { quantity: item.quantity, unitPrice: item.unitPrice, unit });

    if (customerDisplayFlashTimer) clearTimeout(customerDisplayFlashTimer);
    customerDisplayFlashTimer = setTimeout(() => {
      updateCustomerDisplayData();
    }, returnToTotalDelayMs);
  } catch (error) {
    console.warn('Customer display flash error:', error);
  }
}

async function flashCustomerDisplayRemovedItem(removedItem, returnToTotalDelayMs = 1500) {
  try {
    if (!removedItem) {
      await updateCustomerDisplayData();
      return;
    }

    const discountPercent = removedItem.discountPercent || 0;
    const discountAmount = removedItem.subtotal * (discountPercent / 100);
    const finalTotal = removedItem.subtotal - discountAmount;
    const negativeTotal = -Math.abs(finalTotal);
    const unit = removedItem.isWeightBased ? 'kg' : 'pc';

    await updateCustomerDisplayItem(`!BORRAR! ${removedItem.productName}`, negativeTotal, {
      quantity: removedItem.quantity,
      unitPrice: removedItem.unitPrice,
      unit
    });

    if (customerDisplayFlashTimer) clearTimeout(customerDisplayFlashTimer);
    customerDisplayFlashTimer = setTimeout(() => {
      updateCustomerDisplayData();
    }, returnToTotalDelayMs);
  } catch (error) {
    console.warn('Customer display remove flash error:', error);
  }
}

// Update customer display with payment processing
async function updateCustomerDisplayPayment(paymentMethod) {
  try {
    await window.api.showPaymentProcessing(paymentMethod);
    pushMonitorCustomerDisplay({ bannerText: `PAYMENT: ${String(paymentMethod || '').toUpperCase()}` });
  } catch (error) {
    console.warn('Customer display error:', error);
  }
}

// Update customer display with change amount
async function updateCustomerDisplayChange(changeAmount, currencySymbol = '€') {
  try {
    await window.api.showChange(changeAmount, currencySymbol);
    const c = Number(changeAmount);
    pushMonitorCustomerDisplay({
      bannerText: 'CHANGE',
      paid: null,
      change: Number.isFinite(c) ? c : null
    });
  } catch (error) {
    console.warn('Customer display change error:', error);
  }
}

// Update customer display with TOTAL / ENTREGA / CAMBIO summary (cash)
async function updateCustomerDisplayPaymentSummary(total, paid, changeAmount) {
  try {
    const currencySymbol = systemSettings?.currency_symbol || '€';
    await window.api.showPaymentSummary(total, paid, changeAmount, currencySymbol);
    const p = Number(paid);
    const c = Number(changeAmount);

    const totalNum = Number(total);
    const paymentSummary = {
      total: Number.isFinite(totalNum) ? totalNum : null,
      paid: Number.isFinite(p) ? p : null,
      change: Number.isFinite(c) ? c : null
    };

    // Keep the payment summary visible for a few seconds even after the cart clears.
    holdMonitorCustomerDisplay({
      bannerText: 'PAYMENT SUMMARY',
      paymentSummary,
      paid: paymentSummary.paid,
      change: paymentSummary.change,
      showPaymentOverlay: true
    }, 9000);

    pushMonitorCustomerDisplay({
      bannerText: 'PAYMENT SUMMARY',
      paymentSummary,
      paid: paymentSummary.paid,
      change: paymentSummary.change,
      showPaymentOverlay: true
    });
  } catch (error) {
    console.warn('Customer display payment summary error:', error);
  }
}

// Update customer display with thank you message
async function updateCustomerDisplayThankYou(changeAmount = null) {
  try {
    const currencySymbol = systemSettings?.currency_symbol || '€';
    await window.api.showThankYou(changeAmount, currencySymbol);
    const c = Number(changeAmount);
    pushMonitorCustomerDisplay({
      bannerText: 'THANK YOU',
      paid: null,
      change: Number.isFinite(c) ? c : null
    });
  } catch (error) {
    console.warn('Customer display error:', error);
  }
}

// Initialize customer display
async function initializeCustomerDisplay() {
  try {
    const result = await window.api.initializeCustomerDisplay();
    return result;
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// Show welcome message on customer display
async function showCustomerDisplayWelcome() {
  try {
    await window.api.showWelcomeMessage();
    pushMonitorCustomerDisplay({ bannerText: 'WELCOME', paid: null, change: null });
  } catch (error) {
    console.warn('Customer display error:', error);
  }
}

// Clear customer display
async function clearCustomerDisplay() {
  try {
    await window.api.clearCustomerDisplay();
  } catch (error) {
    console.warn('Customer display error:', error);
  }
}

// Initialize customer display when app loads
document.addEventListener('DOMContentLoaded', () => {
  // Initialize customer display after a short delay
  setTimeout(() => {
    initializeCustomerDisplay();
  }, 3000);

  // ============ TRANSLATION SYSTEM ============
  const translations = {
    en: {
      item: 'ITEM', price: 'PRICE', qty: 'QTY', discount: 'DISCOUNT', total: 'TOTAL',
      subtotal: 'Subtotal', tax: 'Tax', payment: 'PAYMENT',
      drawer: 'DRAWER', deleteAll: 'DELETE ALL', undo: 'UNDO', note: 'NOTE', varios: 'VARIOS',
      clear: 'CLEAR', ticket: 'TICKET',
      searchProduct: 'Search Product...',
      products: 'Products', barcodes: 'Barcodes', sales: 'Sales', returns: 'Returns',
      parking: 'Parking', expenses: 'Expenses', reports: 'Reports', inventory: 'Inventory',
      categories: 'Categories', users: 'Users', system: 'System', display: 'Display',
      logout: 'Logout', all: 'ALL'
    },
    es: {
      item: 'ARTÍCULO', price: 'PRECIO', qty: 'CANT.', discount: 'DESCUENTO', total: 'TOTAL',
      subtotal: 'Subtotal', tax: 'IVA', payment: 'PAGO',
      drawer: 'CAJÓN', deleteAll: 'BORRAR TODO', undo: 'DESHACER', note: 'NOTA', varios: 'VARIOS',
      clear: 'BORRAR', ticket: 'TICKET',
      searchProduct: 'Buscar Producto...',
      products: 'Productos', barcodes: 'Códigos', sales: 'Ventas', returns: 'Devoluciones',
      parking: 'Parking', expenses: 'Gastos', reports: 'Informes', inventory: 'Inventario',
      categories: 'Categorías', users: 'Usuarios', system: 'Sistema', display: 'Pantalla',
      logout: 'Salir', all: 'TODOS'
    }
  };

  let currentLang = 'es';

  function applyTranslations(lang) {
    currentLang = lang;
    const t = translations[lang];
    // Text elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });
    // Placeholder elements
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (t[key]) el.placeholder = t[key];
    });
    // ALL category tab
    const allTab = document.querySelector('.category-tab[data-category="all"]');
    if (allTab) allTab.textContent = t.all;
  }

  // Language toggle
  const langEN = document.getElementById('langEN');
  const langES = document.getElementById('langES');
  if (langEN && langES) {
    langEN.addEventListener('click', () => {
      langEN.classList.add('lang-btn--active');
      langES.classList.remove('lang-btn--active');
      applyTranslations('en');
    });
    langES.addEventListener('click', () => {
      langES.classList.add('lang-btn--active');
      langEN.classList.remove('lang-btn--active');
      applyTranslations('es');
    });
  }

  // Apply Spanish by default on load
  applyTranslations('es');
});

// ============================================================
// ARQUEO DE CAJA OVERLAY
// ============================================================

let _arqueoAllReports = [];       // all saved Z-reports (newest first)
let _arqueoCurrentIdx = -1;       // index into _arqueoAllReports (-1 = new/pending)
let _arqueoNewData = null;        // freshly computed data (for new report)
let _arqueoContarValue = null;    // confirmed cash count from CONTAR panel
let _skipZReportModalOpen = false; // prevents old modal from flashing
let _arqueoPeriod = 'today';      // current period selection

// ── Pagination state ────────────────────────────────────────────────────────
const _ARQUEO_PAGE_SIZE = 20;     // rows per page
let _arqueoPageData    = [];      // full dataset for current list view
let _arqueoPageCurrent = 1;       // current page (1-based)
let _arqueoPageRenderer = null;   // function(rows) that renders one page of rows
let _arqueoPageSummaryFn = null;  // function() that renders the summary footer

/** Navigate pages: dir = +1 (next) or -1 (prev) */
function arqueoPageNav(dir) {
  const totalPages = Math.ceil(_arqueoPageData.length / _ARQUEO_PAGE_SIZE) || 1;
  _arqueoPageCurrent = Math.min(Math.max(1, _arqueoPageCurrent + dir), totalPages);
  _arqueoRenderPage();
}

/** Render the current page of _arqueoPageData using _arqueoPageRenderer */
function _arqueoRenderPage() {
  const totalPages = Math.ceil(_arqueoPageData.length / _ARQUEO_PAGE_SIZE) || 1;
  const start = (_arqueoPageCurrent - 1) * _ARQUEO_PAGE_SIZE;
  const slice = _arqueoPageData.slice(start, start + _ARQUEO_PAGE_SIZE);

  const bodyEl   = document.getElementById('arqueoListBody');
  const infoEl   = document.getElementById('arqueoPageInfo');
  const prevBtn  = document.getElementById('arqueoPagePrev');
  const nextBtn  = document.getElementById('arqueoPageNext');
  const pagerEl  = document.getElementById('arqueoListPager');

  if (bodyEl) bodyEl.innerHTML = '';
  if (_arqueoPageRenderer) _arqueoPageRenderer(slice);

  const from = start + 1;
  const to   = Math.min(start + _ARQUEO_PAGE_SIZE, _arqueoPageData.length);
  if (infoEl) infoEl.textContent = _arqueoPageData.length > 0
    ? `Página ${_arqueoPageCurrent} / ${totalPages}   (${from}–${to} de ${_arqueoPageData.length})`
    : 'Sin registros';

  if (prevBtn) prevBtn.style.opacity = _arqueoPageCurrent > 1 ? '1' : '0.3';
  if (nextBtn) nextBtn.style.opacity = _arqueoPageCurrent < totalPages ? '1' : '0.3';
  // Hide pager if everything fits on one page
  if (pagerEl) pagerEl.style.display = _arqueoPageData.length > _ARQUEO_PAGE_SIZE ? 'flex' : 'none';

  if (_arqueoPageSummaryFn) _arqueoPageSummaryFn();
}

/** Open the Arqueo overlay — computes today's data immediately, no old modal */
async function openArqueoOverlay() {
  const overlay = document.getElementById('arqueoOverlay');
  if (!overlay) return;

  // Show overlay immediately (show loading state)
  overlay.style.display = 'flex';
  const paper = document.getElementById('arqueoReceiptPaper');
  if (paper) paper.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:60px;font-family:sans-serif;">⏳ Loading today\'s data...</div>';

  _arqueoContarValue = null;
  _arqueoCurrentIdx = -1;
  _arqueoPeriod = 'today';

  // Init year picker
  try {
    const yearSel = document.getElementById('arqueoYearInput');
    if (yearSel && !yearSel.dataset.loaded) {
      yearSel.dataset.loaded = '1';
      const cy = new Date().getFullYear();
      yearSel.innerHTML = '';
      for (let y = cy; y >= cy - 5; y--) {
        const o = document.createElement('option');
        o.value = String(y); o.textContent = String(y);
        yearSel.appendChild(o);
      }
    }
    // Init month picker default
    const monthInp = document.getElementById('arqueoMonthInput');
    if (monthInp && !monthInp.value) {
      const now = new Date();
      monthInp.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    }
    // Init custom date defaults
    const today = new Date().toISOString().split('T')[0];
    const cs = document.getElementById('arqueoCustomStart');
    const ce = document.getElementById('arqueoCustomEnd');
    if (cs && !cs.value) cs.value = today;
    if (ce && !ce.value) ce.value = today;
  } catch { /* ignore */ }

  // Load all saved reports for navigation + refresh table in background
  try {
    const all = await window.api.getAllZReports();
    _arqueoAllReports = Array.isArray(all) ? all : [];
    displayZReports(_arqueoAllReports);
  } catch {
    _arqueoAllReports = [];
  }

  // Highlight default period button
  _arqueoHighlightPeriod('today');

  // Compute today's Z-report data WITHOUT opening the old modal
  await _arqueoComputeAndRender();
}

/** Show receipt panel, hide list panel */
function _arqueoShowReceiptPanel() {
  const lv = document.getElementById('arqueoListView');
  const rv = document.getElementById('arqueoReceiptView');
  if (lv) lv.style.display = 'none';
  if (rv) rv.style.display = 'flex';
}

/** Show list panel, hide receipt panel */
function _arqueoShowListPanel() {
  const lv = document.getElementById('arqueoListView');
  const rv = document.getElementById('arqueoReceiptView');
  if (lv) lv.style.display = 'flex';
  if (rv) rv.style.display = 'none';
}

/** Render quarter-grouped list (one row per quarter) */
function _arqueoShowQuarterList(rows, titleLabel, cs) {
  _arqueoShowListPanel();
  const titleEl   = document.getElementById('arqueoListTitle');
  const totalEl   = document.getElementById('arqueoListTotal');
  const summaryEl = document.getElementById('arqueoListSummary');
  if (titleEl) titleEl.textContent = titleLabel;

  const qColors     = { 1:'#0ea5e9', 2:'#10b981', 3:'#f59e0b', 4:'#ef4444' };
  const qStartMonth = { 1:'01', 2:'04', 3:'07', 4:'10' };
  const qEndMonth   = { 1:'03', 2:'06', 3:'09', 4:'12' };
  const qLastDay    = { 1:31,   2:30,   3:30,   4:31 };
  const fmtD = (y,m,d) => `${String(d).padStart(2,'0')}/${m}/${y}`;

  const grandTotal = rows.reduce((s,r) => s + r.total, 0);
  const grandCash  = rows.reduce((s,r) => s + r.cash,  0);
  const grandCard  = rows.reduce((s,r) => s + r.card,  0);

  if (totalEl) totalEl.textContent = rows.length ? `TOTAL: ${cs}${grandTotal.toFixed(2)}` : '';

  _arqueoPageData     = rows;
  _arqueoPageCurrent  = 1;
  _arqueoPageRenderer = (slice) => {
    const bodyEl = document.getElementById('arqueoListBody');
    if (!bodyEl) return;
    if (!slice.length) {
      bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#64748b;">No hay trimestres</td></tr>`;
      return;
    }
    slice.forEach((row, i) => {
      const hasData     = row.count > 0 || row.total > 0;
      const bg          = i % 2 === 0 ? '#ffffff' : '#f0f6fb';
      const color       = qColors[row.q] || '#2a4a5e';
      const desdeStr    = fmtD(row.year, qStartMonth[row.q], '01');
      const hastaStr    = fmtD(row.year, qEndMonth[row.q], qLastDay[row.q]);
      const totalColor  = hasData ? '#059669' : '#94a3b8';
      const totalStr    = hasData ? `${cs}${row.total.toFixed(2)}` : '—';
      const opacity     = hasData ? '1' : '0.55';
      const tr = document.createElement('tr');
      tr.style.cssText  = `background:${bg}; cursor:${hasData?'pointer':'default'}; transition:background .15s; opacity:${opacity};`;
      if (hasData) {
        tr.onmouseenter = () => { tr.style.background='#d0f0e0'; tr.style.opacity='1'; };
        tr.onmouseleave = () => { tr.style.background=bg; tr.style.opacity=opacity; };
      }
      tr.innerHTML = `
        <td style="padding:12px 10px; border-bottom:1px solid #cdd9e5;">
          <span style="background:${color};color:white;font-weight:900;font-size:11px;padding:3px 8px;border-radius:4px;margin-right:8px;">T${row.q}</span>
          <span style="color:#0f2130;font-weight:800;font-size:14px;">${row.label}</span>
        </td>
        <td style="padding:12px 8px;text-align:center;color:#475569;border-bottom:1px solid #cdd9e5;">${row.count}</td>
        <td style="padding:12px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">${desdeStr}</td>
        <td style="padding:12px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">${hastaStr}</td>
        <td style="padding:12px 8px;text-align:right;color:${totalColor};font-weight:900;border-bottom:1px solid #cdd9e5;">${totalStr}</td>
      `;
      if (hasData) tr.onclick = () => _arqueoDrillQuarter(row);
      bodyEl.appendChild(tr);
    });
  };
  _arqueoPageSummaryFn = () => {
    if (summaryEl) summaryEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:2px 0;">
        <span style="font-weight:700;color:#fff;">TRIMESTRES: ${rows.length}</span>
        <span style="font-weight:700;color:#fff;">CONTADO: ${cs}${grandCash.toFixed(2)}</span>
        <span style="font-weight:700;color:#fff;">TARJETA: ${cs}${grandCard.toFixed(2)}</span>
        <span style="font-weight:900;color:#2ecc71;">TOTAL: ${cs}${grandTotal.toFixed(2)}</span>
      </div>`;
  };
  _arqueoRenderPage();
}

/** Click a quarter row → show full consolidated receipt for those 3 months */
async function _arqueoDrillQuarter(row) {
  const qStartMonth = { 1:'01', 2:'04', 3:'07', 4:'10' };
  const qEndDay     = { 1:'31', 2:'30', 3:'30', 4:'31' };
  const qEndMonth   = { 1:'03', 2:'06', 3:'09', 4:'12' };
  const qNames      = { 1:'1er TRIMESTRE', 2:'2º TRIMESTRE', 3:'3er TRIMESTRE', 4:'4º TRIMESTRE' };
  const start = `${row.year}-${qStartMonth[row.q]}-01`;
  const end   = `${row.year}-${qEndMonth[row.q]}-${qEndDay[row.q]}`;
  await _arqueoLoadRangeReceipt(start, end, `${qNames[row.q]}  ${row.year}`);
}

/** Render year-grouped list (one row per year) */
function _arqueoShowYearList(rows, titleLabel, cs) {
  _arqueoShowListPanel();
  const titleEl   = document.getElementById('arqueoListTitle');
  const totalEl   = document.getElementById('arqueoListTotal');
  const summaryEl = document.getElementById('arqueoListSummary');
  if (titleEl) titleEl.textContent = titleLabel;

  const grandTotal = rows.reduce((s,r) => s + r.total, 0);
  const grandCash  = rows.reduce((s,r) => s + r.cash,  0);
  const grandCard  = rows.reduce((s,r) => s + r.card,  0);
  if (totalEl) totalEl.textContent = rows.length ? `TOTAL: ${cs}${grandTotal.toFixed(2)}` : '';

  _arqueoPageData     = rows;
  _arqueoPageCurrent  = 1;
  _arqueoPageRenderer = (slice) => {
    const bodyEl = document.getElementById('arqueoListBody');
    if (!bodyEl) return;
    if (!slice.length) {
      bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#64748b;">No hay años</td></tr>`;
      return;
    }
    slice.forEach((row, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f0f6fb';
      const tr = document.createElement('tr');
      tr.style.cssText = `background:${bg}; cursor:pointer; transition:background .15s;`;
      tr.onmouseenter = () => { tr.style.background = '#d0f0e0'; };
      tr.onmouseleave = () => { tr.style.background = bg; };
      tr.innerHTML = `
        <td style="padding:12px 10px;color:#0f2130;font-weight:900;font-size:15px;border-bottom:1px solid #cdd9e5;">📅 ${row.label}</td>
        <td style="padding:12px 8px;text-align:center;color:#475569;border-bottom:1px solid #cdd9e5;">${row.count}</td>
        <td style="padding:12px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">01/01/${row.key}</td>
        <td style="padding:12px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">31/12/${row.key}</td>
        <td style="padding:12px 8px;text-align:right;color:#059669;font-weight:900;border-bottom:1px solid #cdd9e5;">${cs}${row.total.toFixed(2)}</td>
      `;
      tr.onclick = () => _arqueoDrillYear(row, cs);
      bodyEl.appendChild(tr);
    });
  };
  _arqueoPageSummaryFn = () => {
    if (summaryEl) summaryEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:2px 0;">
        <span style="font-weight:700;color:#fff;">AÑOS: ${rows.length}</span>
        <span style="font-weight:700;color:#fff;">CONTADO: ${cs}${grandCash.toFixed(2)}</span>
        <span style="font-weight:700;color:#fff;">TARJETA: ${cs}${grandCard.toFixed(2)}</span>
        <span style="font-weight:900;color:#2ecc71;">TOTAL: ${cs}${grandTotal.toFixed(2)}</span>
      </div>`;
  };
  _arqueoRenderPage();
}

/** Render month-grouped list (one row per month) */
function _arqueoShowMonthList(rows, titleLabel, cs) {
  _arqueoShowListPanel();
  const titleEl   = document.getElementById('arqueoListTitle');
  const totalEl   = document.getElementById('arqueoListTotal');
  const summaryEl = document.getElementById('arqueoListSummary');
  if (titleEl) titleEl.textContent = titleLabel;

  const grandTotal = rows.reduce((s,r) => s + r.total, 0);
  const grandCash  = rows.reduce((s,r) => s + r.cash,  0);
  const grandCard  = rows.reduce((s,r) => s + r.card,  0);
  if (totalEl) totalEl.textContent = rows.length ? `TOTAL: ${cs}${grandTotal.toFixed(2)}` : '';

  _arqueoPageData     = rows;
  _arqueoPageCurrent  = 1;
  _arqueoPageRenderer = (slice) => {
    const bodyEl = document.getElementById('arqueoListBody');
    if (!bodyEl) return;
    if (!slice.length) {
      bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#64748b;">No hay meses</td></tr>`;
      return;
    }
    slice.forEach((row, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f0f6fb';
      const [ky, km] = row.key.split('-').map(Number);
      const lastDay   = new Date(ky, km, 0).getDate();
      const mm        = String(km).padStart(2,'0');
      const tr = document.createElement('tr');
      tr.style.cssText = `background:${bg}; cursor:pointer; transition:background .15s;`;
      tr.onmouseenter = () => { tr.style.background = '#d0f0e0'; };
      tr.onmouseleave = () => { tr.style.background = bg; };
      tr.innerHTML = `
        <td style="padding:12px 10px;color:#0f2130;font-weight:900;font-size:14px;border-bottom:1px solid #cdd9e5;">📅 ${row.label}</td>
        <td style="padding:12px 8px;text-align:center;color:#475569;border-bottom:1px solid #cdd9e5;">${row.count}</td>
        <td style="padding:12px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">01/${mm}/${ky}</td>
        <td style="padding:12px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">${lastDay}/${mm}/${ky}</td>
        <td style="padding:12px 8px;text-align:right;color:#059669;font-weight:900;border-bottom:1px solid #cdd9e5;">${cs}${row.total.toFixed(2)}</td>
      `;
      tr.onclick = () => _arqueoDrillMonth(row, cs);
      bodyEl.appendChild(tr);
    });
  };
  _arqueoPageSummaryFn = () => {
    if (summaryEl) summaryEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:2px 0;">
        <span style="font-weight:700;color:#fff;">MESES: ${rows.length}</span>
        <span style="font-weight:700;color:#fff;">CONTADO: ${cs}${grandCash.toFixed(2)}</span>
        <span style="font-weight:700;color:#fff;">TARJETA: ${cs}${grandCard.toFixed(2)}</span>
        <span style="font-weight:900;color:#2ecc71;">TOTAL: ${cs}${grandTotal.toFixed(2)}</span>
      </div>`;
  };
  _arqueoRenderPage();
}

/** Render day list (one row per day of selected month) */
function _arqueoShowDayList(rows, titleLabel, cs) {
  _arqueoShowListPanel();
  const titleEl   = document.getElementById('arqueoListTitle');
  const totalEl   = document.getElementById('arqueoListTotal');
  const summaryEl = document.getElementById('arqueoListSummary');
  if (titleEl) titleEl.textContent = titleLabel;

  const grandTotal = rows.reduce((s,r) => s + r.total, 0);
  const grandCash  = rows.reduce((s,r) => s + r.cash,  0);
  const grandCard  = rows.reduce((s,r) => s + r.card,  0);
  if (totalEl) totalEl.textContent = `TOTAL: ${cs}${grandTotal.toFixed(2)}`;

  _arqueoPageData     = rows;
  _arqueoPageCurrent  = 1;
  _arqueoPageRenderer = (slice) => {
    const bodyEl = document.getElementById('arqueoListBody');
    if (!bodyEl) return;
    if (!slice.length) {
      bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#64748b;">No hay días</td></tr>`;
      return;
    }
    slice.forEach((row, i) => {
      const hasSales = row.total > 0;
      const bg = i % 2 === 0 ? '#ffffff' : '#f0f6fb';
      const totalColor = hasSales ? '#059669' : '#94a3b8';
      const tr = document.createElement('tr');
      tr.style.cssText = `background:${bg}; cursor:pointer; transition:background .15s;`;
      tr.onmouseenter = () => { tr.style.background = '#d0f0e0'; };
      tr.onmouseleave = () => { tr.style.background = bg; };
      tr.innerHTML = `
        <td style="padding:10px 10px;color:#0f2130;font-weight:${hasSales?'800':'400'};font-size:13px;border-bottom:1px solid #cdd9e5;">📅 ${row.label}</td>
        <td style="padding:10px 8px;text-align:center;color:#475569;border-bottom:1px solid #cdd9e5;">${row.count}</td>
        <td style="padding:10px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">${row.label.substring(0,10)}</td>
        <td style="padding:10px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">${row.label.substring(0,10)}</td>
        <td style="padding:10px 8px;text-align:right;color:${totalColor};font-weight:${hasSales?'900':'400'};border-bottom:1px solid #cdd9e5;">${cs}${row.total.toFixed(2)}</td>
      `;
      tr.onclick = () => _arqueoDrillDay(row, cs);
      bodyEl.appendChild(tr);
    });
  };
  _arqueoPageSummaryFn = () => {
    if (summaryEl) summaryEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:2px 0;">
        <span style="font-weight:700;color:#fff;">DÍAS CON VENTAS: ${rows.filter(r=>r.total>0).length}</span>
        <span style="font-weight:700;color:#fff;">CONTADO: ${cs}${grandCash.toFixed(2)}</span>
        <span style="font-weight:700;color:#fff;">TARJETA: ${cs}${grandCard.toFixed(2)}</span>
        <span style="font-weight:900;color:#2ecc71;">TOTAL: ${cs}${grandTotal.toFixed(2)}</span>
      </div>`;
  };
  _arqueoRenderPage();
}

function arqueoLoadDayRange() { _arqueoComputeAndRender(); }

/** Click a day row → show full consolidated receipt for that day */
async function _arqueoDrillDay(dayRow, cs) {
  const start = dayRow.key;
  const end   = dayRow.key;
  const label = dayRow.label;
  await _arqueoLoadRangeReceipt(start, end, label);
}

/** Drill from year row → show all months in that year */
/** Click a year row → show full consolidated receipt for that year */
async function _arqueoDrillYear(yearRow, cs) {
  const year  = yearRow.key;
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;
  await _arqueoLoadRangeReceipt(start, end, `AÑO ${year}`);
}

/** Click a month row → show full consolidated receipt for that month */
async function _arqueoDrillMonth(monthRow, cs) {
  const [y, m] = monthRow.key.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const start  = `${monthRow.key}-01`;
  const end    = `${monthRow.key}-${String(lastDay).padStart(2,'0')}`;
  const label  = new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(new Date(y,m-1,1)).toUpperCase();
  await _arqueoLoadRangeReceipt(start, end, label);
}

/** Compute and show a Z-report receipt for an arbitrary date range */
async function _arqueoLoadRangeReceipt(startYmd, endYmd, label) {
  _arqueoShowReceiptPanel();
  const paper = document.getElementById('arqueoReceiptPaper');
  if (paper) paper.innerHTML = `<div style="color:#94a3b8;text-align:center;padding:60px;font-family:sans-serif;">⏳ Cargando ${label}...</div>`;

  _arqueoContarValue = null;
  _arqueoCurrentIdx = -1;

  // Set the hidden Z-report range inputs and trigger compute
  const rangeTypeEl = document.getElementById('zReportRangeType');
  const startEl     = document.getElementById('zReportRangeStart');
  const endEl       = document.getElementById('zReportRangeEnd');
  if (rangeTypeEl) rangeTypeEl.value = 'custom';
  if (startEl)     startEl.value     = startYmd;
  if (endEl)       endEl.value       = endYmd;

  try {
    _skipZReportModalOpen = true;
    await openZReportModal();
    _arqueoNewData = currentZReportData ? { ...currentZReportData } : null;
  } catch(e) {
    console.error('Arqueo range receipt error:', e);
  } finally {
    _skipZReportModalOpen = false;
  }

  // Update nav label to show the period
  const numEl  = document.getElementById('arqueoNavNumber');
  const dateEl = document.getElementById('arqueoNavDate');
  const idxEl  = document.getElementById('arqueoNavIndex');

  // Format dates as dd/mm/yyyy Spanish style
  const fmtNavDate = (ymd) => {
    const [y,m,d] = ymd.split('-');
    return `${d}/${m}/${y}`;
  };

  if (numEl)  numEl.textContent  = label;
  if (dateEl) dateEl.textContent = `${fmtNavDate(startYmd)}  →  ${fmtNavDate(endYmd)}`;
  if (idxEl)  idxEl.textContent  = '';

  // Hide Done/Cerrar for period reports
  const doneBtn  = document.getElementById('arqueoNewDone');
  const closeBtn = document.getElementById('arqueoCloseBtn');
  if (doneBtn)  doneBtn.style.display  = 'none';
  if (closeBtn) closeBtn.style.display = 'none';

  _arqueoRenderReceipt(_arqueoNewData, false);
}

/** Render the individual Z-reports list (one row per Z-report) */
function _arqueoShowList(reports, titleLabel, cs) {
  _arqueoShowListPanel();

  const titleEl   = document.getElementById('arqueoListTitle');
  const totalEl   = document.getElementById('arqueoListTotal');
  const summaryEl = document.getElementById('arqueoListSummary');
  if (titleEl) titleEl.textContent = titleLabel;

  const tz = getDisplayTimeZone();
  const fmtD = (iso) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
      return new Intl.DateTimeFormat('es-ES', { timeZone: tz, day:'2-digit', month:'2-digit', year:'numeric' }).format(d);
    } catch { return iso.slice(0,10); }
  };

  const grandTotal = (reports||[]).reduce((s,r) => s + Number(r.total_sales_amount ?? (Number(r.cash_sales||0)+Number(r.card_sales||0))), 0);
  const grandCash  = (reports||[]).reduce((s,r) => s + Number(r.cash_sales||0), 0);
  const grandCard  = (reports||[]).reduce((s,r) => s + Number(r.card_sales||0), 0);
  if (totalEl) totalEl.textContent = reports?.length ? `TOTAL: ${cs}${grandTotal.toFixed(2)}` : '';

  _arqueoPageData     = reports || [];
  _arqueoPageCurrent  = 1;
  _arqueoPageRenderer = (slice) => {
    const bodyEl = document.getElementById('arqueoListBody');
    if (!bodyEl) return;
    if (!slice.length) {
      bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#64748b;">No hay arqueos para este período</td></tr>`;
      return;
    }
    slice.forEach((r, i) => {
      const total    = Number(r.total_sales_amount ?? (Number(r.cash_sales||0)+Number(r.card_sales||0)));
      const bg       = i % 2 === 0 ? '#ffffff' : '#f0f6fb';
      const rNum     = String(r.report_number || r.id || '-');
      const shortNum = rNum.length > 14 ? rNum.slice(-14) : rNum;
      const tr = document.createElement('tr');
      tr.style.cssText = `background:${bg}; cursor:pointer; transition:background .15s;`;
      tr.onmouseenter = () => { tr.style.background = '#d0f0e0'; };
      tr.onmouseleave = () => { tr.style.background = bg; };
      tr.innerHTML = `
        <td style="padding:11px 8px;color:#0f2130;font-weight:800;border-bottom:1px solid #cdd9e5;">${shortNum}</td>
        <td style="padding:11px 8px;text-align:center;color:#475569;border-bottom:1px solid #cdd9e5;">2</td>
        <td style="padding:11px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">${fmtD(r.start_datetime || r.report_date)}</td>
        <td style="padding:11px 8px;color:#334155;border-bottom:1px solid #cdd9e5;">${fmtD(r.end_datetime || r.report_date)}</td>
        <td style="padding:11px 8px;text-align:right;color:#059669;font-weight:900;border-bottom:1px solid #cdd9e5;">${cs}${total.toFixed(2)}</td>
      `;
      tr.onclick = () => _arqueoOpenListReport(r);
      bodyEl.appendChild(tr);
    });
  };
  _arqueoPageSummaryFn = () => {
    if (summaryEl) summaryEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:2px 0;">
        <span style="font-weight:700;color:#fff;">ARQUEOS: ${(reports||[]).length}</span>
        <span style="font-weight:700;color:#fff;">CONTADO: ${cs}${grandCash.toFixed(2)}</span>
        <span style="font-weight:700;color:#fff;">TARJETA: ${cs}${grandCard.toFixed(2)}</span>
        <span style="font-weight:900;color:#2ecc71;">TOTAL: ${cs}${grandTotal.toFixed(2)}</span>
      </div>`;
  };
  _arqueoRenderPage();
}

/** Open a single saved report from the list (show its receipt) */
function _arqueoOpenListReport(report) {
  const idx = _arqueoAllReports.findIndex(r => r.id === report.id);
  _arqueoCurrentIdx = idx >= 0 ? idx : 0;
  _arqueoShowReceiptPanel();
  _arqueoRenderCurrent();
}

/** Back button inside list view */
function arqueoListBack() {
  // Always re-run the top-level period view
  _arqueoComputeAndRender();
}

/**
 * Roll up the actual monthly sales totals (authoritative `sales` table) into
 * arbitrary buckets. `keyFn` maps a 'YYYY-MM' month to a bucket key (or null to skip).
 * Returns { [bucketKey]: { total, cash, card } }.
 */
async function _arqueoActualTotalsBy(keyFn) {
  const map = {};
  try {
    const actualRows = await window.api.getMonthlySalesActualTotals();
    (actualRows || []).forEach(r => {
      const month = String(r.month || '');
      if (month.length < 7) return;
      const key = keyFn(month);
      if (!key) return;
      if (!map[key]) map[key] = { total: 0, cash: 0, card: 0 };
      map[key].total += Number(r.total) || 0;
      map[key].cash  += Number(r.cash)  || 0;
      map[key].card  += Number(r.card)  || 0;
    });
  } catch (e) {
    console.warn('Could not fetch actual monthly sales totals:', e);
  }
  return map;
}

/** Compute data for the current period and render */
async function _arqueoComputeAndRender() {
  const paper = document.getElementById('arqueoReceiptPaper');
  if (paper) paper.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:60px;font-family:sans-serif;">⏳ Cargando...</div>';
  _arqueoShowReceiptPanel();

  _arqueoContarValue = null;
  _arqueoCurrentIdx = -1;

  const cs  = systemSettings?.currency_symbol || '€';
  const tz  = getDisplayTimeZone();
  const toYmd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

  // ── DÍA: one row per day for the selected month ──────────────────────────
  if (_arqueoPeriod === 'day') {
    const dayMonthInp = document.getElementById('arqueoDayMonthInput');
    const ym = dayMonthInp?.value || (() => {
      const tz = getDisplayTimeZone();
      const now = new Date();
      const yyyy = new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric'}).format(now);
      const mm   = new Intl.DateTimeFormat('en-CA',{timeZone:tz,month:'2-digit'}).format(now);
      return `${yyyy}-${mm}`;
    })();

    const [y, m] = ym.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();

    // Fetch actual daily sales totals
    let actualDayMap = {};
    try {
      const actualRows = await window.api.getDailySalesActualTotals(ym);
      (actualRows || []).forEach(r => { actualDayMap[r.day] = r; });
    } catch (e) {
      console.warn('Could not fetch daily sales totals:', e);
    }

    // Group saved Z-reports by day
    const zGroups = {};
    _arqueoAllReports.forEach(r => {
      try {
        const raw = r.end_datetime || r.report_date || '';
        const d   = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
        const ymd = toYmd(d);
        if (ymd.slice(0,7) !== ym) return;
        if (!zGroups[ymd]) zGroups[ymd] = [];
        zGroups[ymd].push(r);
      } catch {}
    });

    // Build one row per day of the month
    const rows = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dd  = String(d).padStart(2,'0');
      const mm  = String(m).padStart(2,'0');
      const key = `${y}-${mm}-${dd}`;
      const actual = actualDayMap[key];
      const reps   = zGroups[key] || [];
      const total  = actual ? Number(actual.total) || 0 : reps.reduce((s,r) => s + (Number(r.total_sales_amount)||0), 0);
      const cash   = actual ? Number(actual.cash)  || 0 : reps.reduce((s,r) => s + (Number(r.cash_sales)||0), 0);
      const card   = actual ? Number(actual.card)  || 0 : reps.reduce((s,r) => s + (Number(r.card_sales)||0), 0);
      rows.push({ key, label: `${dd}/${mm}/${y}`, count: reps.length, total, cash, card, reports: reps });
    }

    const monthLabel = new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(new Date(y,m-1,1)).toUpperCase();
    _arqueoShowDayList(rows, `CAJA PRINCIPAL  —  ${monthLabel}`, cs);
    return;
  }

  // ── MENSUAL: one row per month that has Z-reports or actual sales ────────
  if (_arqueoPeriod === 'month') {
    // Group all reports by YYYY-MM
    const groups = {}; // key: 'YYYY-MM'
    _arqueoAllReports.forEach(r => {
      try {
        const raw = r.end_datetime || r.report_date || '';
        const d   = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
        const ymd = toYmd(d); // 'YYYY-MM-DD'
        const key = ymd.slice(0, 7); // 'YYYY-MM'
        if (!groups[key]) groups[key] = { reports: [], key };
        groups[key].reports.push(r);
      } catch {}
    });

    // Fetch actual monthly totals from sales table (authoritative source)
    let actualMonthMap = {};
    try {
      const actualRows = await window.api.getMonthlySalesActualTotals();
      (actualRows || []).forEach(r => { actualMonthMap[r.month] = r; });
    } catch (e) {
      console.warn('Could not fetch actual monthly sales totals:', e);
    }

    // Build rows: include months from Z-reports AND from actual sales
    const allKeys = new Set([
      ...Object.keys(groups),
      ...Object.keys(actualMonthMap)
    ]);
    const monthKeys = Array.from(allKeys).sort().reverse();

    const rows = monthKeys.map(key => {
      const [y, m] = key.split('-').map(Number);
      const reps   = (groups[key] || { reports: [] }).reports;
      const actual = actualMonthMap[key];
      // Prefer actual sales totals over stored Z-report sums
      const total  = actual ? Number(actual.total) || 0
                            : reps.reduce((s, r) => s + (Number(r.total_sales_amount) || (Number(r.cash_sales||0)+Number(r.card_sales||0))), 0);
      const cash   = actual ? Number(actual.cash) || 0
                            : reps.reduce((s, r) => s + Number(r.cash_sales||0), 0);
      const card   = actual ? Number(actual.card) || 0
                            : reps.reduce((s, r) => s + Number(r.card_sales||0), 0);
      const label  = new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(new Date(y,m-1,1)).toUpperCase();
      return { key, label, count: reps.length, total, cash, card, reports: reps };
    });

    _arqueoShowMonthList(rows, 'CAJA PRINCIPAL  —  TODOS LOS MESES', cs);
    return;
  }

  // ── ANUAL: one row per year that has Z-reports or actual sales ───────────
  if (_arqueoPeriod === 'year') {
    const groups = {}; // key: 'YYYY'
    _arqueoAllReports.forEach(r => {
      try {
        const raw = r.end_datetime || r.report_date || '';
        const d   = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
        const key = toYmd(d).slice(0, 4); // 'YYYY'
        if (!groups[key]) groups[key] = { reports: [], key };
        groups[key].reports.push(r);
      } catch {}
    });

    // Roll up actual monthly sales totals per year (same authoritative source as MENSUAL)
    const actualYearMap = await _arqueoActualTotalsBy(m => m.slice(0, 4));

    const yearKeys = Array.from(new Set([
      ...Object.keys(groups),
      ...Object.keys(actualYearMap)
    ])).sort().reverse();

    const rows = yearKeys.map(key => {
      const reps   = (groups[key] || { reports: [] }).reports;
      const actual = actualYearMap[key];
      // Prefer actual sales totals over stored Z-report sums
      const total = actual ? actual.total
                           : reps.reduce((s, r) => s + Number(r.total_sales_amount ?? (Number(r.cash_sales||0)+Number(r.card_sales||0))), 0);
      const cash  = actual ? actual.cash
                           : reps.reduce((s, r) => s + Number(r.cash_sales||0), 0);
      const card  = actual ? actual.card
                           : reps.reduce((s, r) => s + Number(r.card_sales||0), 0);
      return { key, label: key, count: reps.length, total, cash, card, reports: reps };
    });

    _arqueoShowYearList(rows, 'CAJA PRINCIPAL  —  TODOS LOS AÑOS', cs);
    return;
  }

  // ── TRIMESTRE: every completed quarter from earliest data year to now ────
  if (_arqueoPeriod === 'quarter') {
    const quarterOf  = (m) => Math.ceil(m / 3);
    const qNames     = ['', '1er Trimestre (Ene-Mar)', '2º Trimestre (Abr-Jun)', '3er Trimestre (Jul-Sep)', '4º Trimestre (Oct-Dic)'];
    const qEndMonth  = { 1:3,  2:6,  3:9,  4:12 }; // last month of quarter (1-based)
    const qEndDay    = { 1:31, 2:30, 3:30, 4:31 };

    // Find earliest year in saved reports (fallback to current year)
    const tz = getDisplayTimeZone();
    const todayYmd  = toYmd(new Date());
    const todayYear = Number(todayYmd.slice(0,4));
    const todayMon  = Number(todayYmd.slice(5,7));
    const todayQ    = quarterOf(todayMon);

    let earliestYear = todayYear;
    _arqueoAllReports.forEach(r => {
      try {
        const raw = r.end_datetime || r.report_date || '';
        const d   = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
        const yr  = Number(toYmd(d).slice(0,4));
        if (yr < earliestYear) earliestYear = yr;
      } catch {}
    });

    // Index reports by 'YYYY-QN'
    const groups = {};
    _arqueoAllReports.forEach(r => {
      try {
        const raw = r.end_datetime || r.report_date || '';
        const d   = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
        const ymd = toYmd(d);
        const yr  = Number(ymd.slice(0,4));
        const mo  = Number(ymd.slice(5,7));
        const q   = quarterOf(mo);
        const key = `${yr}-Q${q}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      } catch {}
    });

    // Roll up actual monthly sales totals per quarter (same authoritative source as MENSUAL)
    const actualQuarterMap = await _arqueoActualTotalsBy(m => {
      const yr = Number(m.slice(0,4));
      const mo = Number(m.slice(5,7));
      if (!yr || !mo) return null;
      return `${yr}-Q${quarterOf(mo)}`;
    });
    // Quarters with real sales may predate the oldest saved Z-report
    Object.keys(actualQuarterMap).forEach(key => {
      const yr = Number(key.slice(0,4));
      if (yr && yr < earliestYear) earliestYear = yr;
    });

    // Generate ALL completed quarters from earliestYear up to (but not including current quarter)
    const rows = [];
    for (let yr = todayYear; yr >= earliestYear; yr--) {
      // For current year only include quarters that have fully ended
      const maxQ = (yr === todayYear) ? todayQ - 1 : 4;
      for (let q = maxQ; q >= 1; q--) {
        const key    = `${yr}-Q${q}`;
        const reps   = groups[key] || [];
        const actual = actualQuarterMap[key];
        // Prefer actual sales totals over stored Z-report sums
        const total = actual ? actual.total
                             : reps.reduce((s,r) => s + Number(r.total_sales_amount ?? (Number(r.cash_sales||0)+Number(r.card_sales||0))), 0);
        const cash  = actual ? actual.cash
                             : reps.reduce((s,r) => s + Number(r.cash_sales||0), 0);
        const card  = actual ? actual.card
                             : reps.reduce((s,r) => s + Number(r.card_sales||0), 0);
        rows.push({ key, label:`${qNames[q]}  ${yr}`, count:reps.length, total, cash, card, year:yr, q, reports:reps });
      }
    }

    _arqueoShowQuarterList(rows, 'CAJA PRINCIPAL  —  TRIMESTRES', cs);
    return;
  }

  // ── All other periods: compute live report and show receipt ───────────────
  try {
    const rangeTypeEl = document.getElementById('zReportRangeType');
    if (rangeTypeEl) {
      rangeTypeEl.value = (_arqueoPeriod === 'yesterday' || _arqueoPeriod === 'custom') ? 'custom' : 'today';
    }

    if (_arqueoPeriod === 'yesterday') {
      const yesterday = new Date(Date.now() - 86400000);
      const yd = toYmd(yesterday);
      const startEl = document.getElementById('zReportRangeStart');
      const endEl   = document.getElementById('zReportRangeEnd');
      if (startEl) startEl.value = yd;
      if (endEl)   endEl.value   = yd;
    }

    if (_arqueoPeriod === 'custom') {
      const cs2 = document.getElementById('arqueoCustomStart');
      const ce  = document.getElementById('arqueoCustomEnd');
      const zs  = document.getElementById('zReportRangeStart');
      const ze  = document.getElementById('zReportRangeEnd');
      if (cs2 && zs) zs.value = cs2.value;
      if (ce  && ze) ze.value = ce.value;
    }

    _skipZReportModalOpen = true;
    await openZReportModal();
    _arqueoNewData = currentZReportData ? { ...currentZReportData } : null;
  } catch (e) {
    console.error('Arqueo compute error:', e);
  } finally {
    _skipZReportModalOpen = false;
  }

  _arqueoRenderCurrent();
}

/** Switch period and reload */
async function arqueoSetPeriod(period) {
  _arqueoPeriod = period;
  _arqueoHighlightPeriod(period);

  // Show/hide pickers
  const customDiv    = document.getElementById('arqueoCustomRange');
  const monthDiv     = document.getElementById('arqueoMonthPicker');
  const yearDiv      = document.getElementById('arqueoYearPicker');
  const dayMonthDiv  = document.getElementById('arqueoDayMonthPicker');
  if (customDiv)   customDiv.style.display   = period === 'custom' ? 'flex'  : 'none';
  if (monthDiv)    monthDiv.style.display    = period === 'month'  ? 'block' : 'none';
  if (yearDiv)     yearDiv.style.display     = period === 'year'   ? 'block' : 'none';
  if (dayMonthDiv) dayMonthDiv.style.display = period === 'day'    ? 'block' : 'none';

  // For month/year: auto-load immediately with current picker value
  if (period === 'month') {
    const monthInp = document.getElementById('arqueoMonthInput');
    if (!monthInp?.value) {
      // Default to current month
      const tz = getDisplayTimeZone();
      const now = new Date();
      const yyyy = new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric'}).format(now);
      const mm   = new Intl.DateTimeFormat('en-CA',{timeZone:tz,month:'2-digit'}).format(now);
      if (monthInp) monthInp.value = `${yyyy}-${mm}`;
    }
    await _arqueoComputeAndRender();
    return;
  }
  if (period === 'year') {
    const yearInp = document.getElementById('arqueoYearInput');
    if (!yearInp?.value) {
      const tz = getDisplayTimeZone();
      const yyyy = new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric'}).format(new Date());
      if (yearInp) yearInp.value = yyyy;
    }
    await _arqueoComputeAndRender();
    return;
  }
  if (period === 'quarter') {
    await _arqueoComputeAndRender();
    return;
  }
  if (period === 'day') {
    const dayMonthInp = document.getElementById('arqueoDayMonthInput');
    if (!dayMonthInp?.value) {
      const tz = getDisplayTimeZone();
      const now = new Date();
      const yyyy = new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric'}).format(now);
      const mm   = new Intl.DateTimeFormat('en-CA',{timeZone:tz,month:'2-digit'}).format(now);
      if (dayMonthInp) dayMonthInp.value = `${yyyy}-${mm}`;
    }
    await _arqueoComputeAndRender();
    return;
  }
  if (period === 'custom') return; // wait for user

  await _arqueoComputeAndRender();
}

function arqueoLoadCustomRange() { _arqueoComputeAndRender(); }
function arqueoLoadMonthRange()  { _arqueoComputeAndRender(); }
function arqueoLoadYearRange()   { _arqueoComputeAndRender(); }

function _arqueoHighlightPeriod(period) {
  const ids = ['arqueoPeriodHoy','arqueoPeriodAyer','arqueoPeriodDia','arqueoPeriodMensual','arqueoPeriodTrimestre','arqueoPeriodAnual','arqueoPeriodCustom'];
  const map  = { today:'arqueoPeriodHoy', yesterday:'arqueoPeriodAyer', day:'arqueoPeriodDia', month:'arqueoPeriodMensual', quarter:'arqueoPeriodTrimestre', year:'arqueoPeriodAnual', custom:'arqueoPeriodCustom' };
  ids.forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const active = (map[period] === id);
    btn.style.background = active ? '#2ecc71' : '#2a4a5e';
    btn.style.color      = active ? 'white'   : '#94a3b8';
    btn.style.fontWeight = active ? '800'     : '700';
  });
}

/** Render whichever report is currently selected */
function _arqueoRenderCurrent() {
  _arqueoShowReceiptPanel();
  const isPending = (_arqueoCurrentIdx === -1);
  const data = isPending ? _arqueoNewData : _arqueoAllReports[_arqueoCurrentIdx];

  const numEl  = document.getElementById('arqueoNavNumber');
  const dateEl = document.getElementById('arqueoNavDate');
  const idxEl  = document.getElementById('arqueoNavIndex');
  const userEl = document.getElementById('arqueoSideUser');
  const timeEl = document.getElementById('arqueoSideTime');

  const total = _arqueoAllReports.length;

  if (isPending) {
    if (numEl)  numEl.textContent  = 'NUEVO';
    if (dateEl) dateEl.textContent = _arqueoRelativeLabel(new Date());
    if (idxEl)  idxEl.textContent  = `HOY  /  ${total} guardados`;
  } else {
    const r = data;
    const rDate = r?.report_date ? new Date(r.report_date) : null;
    const rNum = String(r?.report_number || '-');
    if (numEl)  numEl.textContent  = rNum.length > 16 ? rNum.slice(-16) : rNum;
    if (dateEl) dateEl.textContent = rDate ? _arqueoRelativeLabel(rDate) : '-';
    if (idxEl)  idxEl.textContent  = `${_arqueoCurrentIdx + 1} / ${total} guardados`;
  }

  if (userEl) userEl.innerHTML = `<span style="color:#94a3b8;">USUARIO:</span> ${data?.cashier_name || (currentUser?.full_name) || '-'}`;
  if (timeEl) timeEl.innerHTML = `<span style="color:#94a3b8;">HORA X:</span> ${_fmtTime(new Date())}`;

  // Done / Cerrar buttons visible only for new pending report
  const doneBtn  = document.getElementById('arqueoNewDone');
  const closeBtn = document.getElementById('arqueoCloseBtn');
  if (doneBtn)  doneBtn.style.display  = isPending ? '' : 'none';
  if (closeBtn) closeBtn.style.display = isPending ? '' : 'none';

  // Prev/Next button states
  const prevBtn = document.getElementById('arqueoNavPrev');
  const nextBtn = document.getElementById('arqueoNavNext');
  // ◄ goes to older (higher index); can't go past last saved
  if (prevBtn) prevBtn.style.opacity = (_arqueoCurrentIdx < total - 1) ? '1' : '0.3';
  // ► goes to newer (lower index); can't go past pending (-1)
  if (nextBtn) nextBtn.style.opacity = (_arqueoCurrentIdx > -1) ? '1' : '0.3';

  _arqueoRenderReceipt(data, isPending);
}

/** Returns "HOY", "AYER", "HACE 2 DÍAS", or a date string */
function _arqueoRelativeLabel(date) {
  try {
    const tz = getDisplayTimeZone();
    const toYmd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    const today = toYmd(new Date());
    const target = toYmd(date);
    const diffMs = new Date(today).getTime() - new Date(target).getTime();
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays === 0) return `HOY  ${_fmtDate(date)}`;
    if (diffDays === 1) return `AYER  ${_fmtDate(date)}`;
    if (diffDays > 1)   return `HACE ${diffDays} DÍAS  ${_fmtDate(date)}`;
    return _fmtDate(date);
  } catch {
    return _fmtDate(date);
  }
}

/** Navigate +1 (older) / -1 (newer) through saved reports.
 *  ◄ = older (idx increases),  ► = newer (idx decreases toward -1) */
function arqueoNavigate(dir) {
  const newIdx = _arqueoCurrentIdx + dir;
  if (newIdx < -1) return;
  if (newIdx >= _arqueoAllReports.length) return;
  _arqueoCurrentIdx = newIdx;
  _arqueoRenderCurrent();
}

/** Render the receipt paper for a given data object */
function _arqueoRenderReceipt(data, isPending) {
  const paper = document.getElementById('arqueoReceiptPaper');
  if (!paper) return;
  if (!data) {
    paper.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:40px;font-family:sans-serif;">Sin datos</div>';
    return;
  }

  const cs  = systemSettings?.currency_symbol || '€';
  const tz  = getDisplayTimeZone();

  // ── helpers (same logic as printZReport) ─────────────────────────────────
  const fmt = (n) => Number(n || 0).toFixed(2).replace('.', ',') + cs;

  const parseDT = (value) => {
    if (!value) return new Date();
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
    return new Date(s);
  };

  const fmtDateTime = (iso) => {
    const dt = parseDT(iso);
    try {
      const date = new Intl.DateTimeFormat('es-ES', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(dt);
      const time = new Intl.DateTimeFormat('es-ES', { timeZone: tz, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(dt);
      return { date, time };
    } catch {
      return { date: _fmtDate(dt), time: _fmtTime(dt) };
    }
  };

  const inferRangeLabel = (startIso, endIso) => {
    try {
      const s = parseDT(startIso); const e = parseDT(endIso);
      const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
      const [sy,sm,sd] = ymd(s).split('-').map(Number);
      const [ey,em,ed] = ymd(e).split('-').map(Number);
      const lastDay = (y,m) => new Date(Date.UTC(y,m,0)).getUTCDate();
      if (sy===ey && sm===em && sd===ed) {
        return { kind:'day', label: new Intl.DateTimeFormat('es-ES',{timeZone:tz,weekday:'long'}).format(s).toUpperCase() };
      }
      if (sy===ey && sm===em && sd===1 && ed===lastDay(ey,em)) {
        return { kind:'month', label: new Intl.DateTimeFormat('es-ES',{timeZone:tz,month:'long'}).format(s).toUpperCase()+' '+sy };
      }
      if (sy===ey && sm===1 && sd===1 && em===12 && ed===31) {
        return { kind:'year', label: String(sy) };
      }
      return { kind:'custom', label: `${ymd(s)} - ${ymd(e)}` };
    } catch { return null; }
  };

  // ── data ──────────────────────────────────────────────────────────────────
  const storeName  = (systemSettings?.store_name    || 'SUPERMARKET POS').toUpperCase();
  const storeAddr  = systemSettings?.store_address || '';
  const storeCif   = systemSettings?.store_cif     || systemSettings?.tax_id || '';
  const storeCity  = systemSettings?.store_city    || '';
  const storePhone = systemSettings?.store_phone   || '';

  const cashSales      = Number(data.cash_sales     || data._net_cash_collected || 0);
  const cardSales      = Number(data.card_sales     || data._net_card_collected || 0);
  const grossSales     = Number(data.gross_sales    || 0);
  const netSales       = Number(data.net_sales      || 0);
  const returnsAmt     = Number(data.total_returns_amount || 0);
  const totalSalesAmt  = cashSales + cardSales;
  const totalExpenses  = Number(data.total_expenses || data._auto_expenses_total || 0);
  const balance        = netSales - totalExpenses;
  const totalSales     = Number(data.total_sales    || 0);
  const totalReturns   = Number(data.total_returns  || 0);
  const netSalesCount  = Number(data.net_sales_count || Math.max(0, totalSales - totalReturns) || 0);
  const totalTax       = Number(data.total_tax      || 0);
  const reportNum      = data.report_number || (isPending ? 'BORRADOR' : '-');
  const cashierName    = data.cashier_name  || (currentUser?.full_name) || '-';

  const expectedCash = Number(data.expected_cash || data._expected_cash_base || 0);
  const actualCash   = (_arqueoCurrentIdx === -1 && _arqueoContarValue !== null)
                       ? _arqueoContarValue
                       : (data.actual_cash !== null && data.actual_cash !== undefined ? Number(data.actual_cash) : null);
  const diff         = actualCash !== null ? (actualCash - expectedCash) : null;

  // Expenses list (for cash-movements detail)
  let expensesList = [];
  try {
    if (data.expenses_json) {
      const parsed = typeof data.expenses_json === 'string' ? JSON.parse(data.expenses_json) : data.expenses_json;
      const auto   = Array.isArray(parsed?.auto)   ? parsed.auto   : [];
      const manual = Array.isArray(parsed?.manual) ? parsed.manual : [];
      expensesList = [...auto, ...manual].filter(e => Number(e?.amount) > 0);
    } else if (Array.isArray(data._auto_expenses_list)) {
      expensesList = data._auto_expenses_list.filter(e => Number(e?.amount) > 0);
    }
  } catch { expensesList = []; }

  const cashExpensesList  = expensesList.filter(e => String(e?.payment_method||'').toLowerCase() === 'cash');
  const cashExpensesTotal = cashExpensesList.reduce((s, e) => s + (Number(e?.amount)||0), 0);

  // VAT rows from stored JSON
  let vatRows = [];
  try {
    if (data.tax_breakdown_json) {
      const parsed = typeof data.tax_breakdown_json === 'string' ? JSON.parse(data.tax_breakdown_json) : data.tax_breakdown_json;
      if (Array.isArray(parsed)) vatRows = parsed;
    }
  } catch { vatRows = []; }

  // Dates
  const printedAt = data.end_datetime || data.report_date || new Date().toISOString();
  const { date: reportDate, time: reportTime } = fmtDateTime(printedAt);
  const startFmt = data.start_datetime ? fmtDateTime(data.start_datetime) : null;
  const endFmt   = data.end_datetime   ? fmtDateTime(data.end_datetime)   : null;
  const inferred = (data.start_datetime && data.end_datetime)
    ? inferRangeLabel(data.start_datetime, data.end_datetime) : null;

  // ── HTML builder helpers ──────────────────────────────────────────────────
  // Each section is built as a <table> row or block.
  // We use a single full-width table for alignment.

  const R = []; // array of HTML strings

  const ctr = (html, bold) =>
    `<tr><td colspan="2" style="text-align:center;padding:2px 0;${bold?'font-weight:900;':''}">${html}</td></tr>`;

  const lv = (label, value, opts = {}) => {
    const lStyle = `padding:1px 0;white-space:nowrap;${opts.indent?'padding-left:14px;':''}${opts.bold?'font-weight:900;':''}`;
    const vStyle = `padding:1px 0;text-align:right;white-space:nowrap;${opts.bold?'font-weight:900;':''}${opts.color?'color:'+opts.color+';':''}`;
    return `<tr><td style="${lStyle}">${label}</td><td style="${vStyle}">${value}</td></tr>`;
  };

  const sep = (double) => `<tr><td colspan="2"><div style="border-top:${double?'3px double':'1px solid'} #444;margin:5px 0;"></div></td></tr>`;
  const gap = () => `<tr><td colspan="2" style="height:7px;"></td></tr>`;
  const hdr = (text) => `<tr><td colspan="2" style="font-weight:700;padding:3px 0 1px 0;letter-spacing:.3px;">${text}</td></tr>`;

  // ── Header ────────────────────────────────────────────────────────────────
  R.push(ctr(`<b>${storeName}</b>`, true));
  R.push(ctr('<b>ARQUEO DE CAJA</b>', true));
  if (storeAddr)  R.push(ctr(storeAddr));
  if (storeCif)   R.push(ctr(storeCif));
  if (storeCity)  R.push(ctr(storeCity));
  if (storePhone) R.push(ctr(storePhone));
  R.push(sep(true));
  R.push(lv('CAJA.......:', 'PRINCIPAL'));
  R.push(lv('ARQUEO.....:', reportNum));
  R.push(lv('FECHA......:', reportDate));
  R.push(lv('HORA.......:', reportTime));
  if (inferred?.kind === 'day')   R.push(lv('DIA........:', inferred.label));
  if (inferred?.kind === 'month') R.push(lv('MES........:', inferred.label));
  if (inferred?.kind === 'year')  R.push(lv('ANO........:', inferred.label));
  if (startFmt?.date && endFmt?.date) {
    R.push(lv('DESDE ARQ..:', startFmt.date));
    R.push(lv('HASTA ARQ..:', endFmt.date));
  }
  R.push(sep());

  // ── Sales summary ─────────────────────────────────────────────────────────
  R.push(lv('VENTA BRUTA',   fmt(grossSales)));
  R.push(lv('DEVOLUCIONES',  fmt(returnsAmt)));
  R.push(lv('VENTA NETA',    fmt(netSales),  { bold: true }));
  R.push(gap());
  R.push(lv('DOCUMENTOS',    String(totalSales)));
  R.push(lv('NUMERO DE VENTAS', String(totalSales)));
  R.push(lv('NUMERO DEVOL.', String(totalReturns)));
  R.push(lv('VENTAS NETAS',  String(netSalesCount)));
  R.push(sep());

  // ── Payment methods ───────────────────────────────────────────────────────
  R.push(ctr('FORMAS PAGO', true));
  R.push(lv('CONTADO',  fmt(cashSales)));
  R.push(lv('TARJETA',  fmt(cardSales)));
  R.push(sep());
  R.push(lv('TOTAL COBRADO', fmt(totalSalesAmt), { bold: true }));
  R.push(lv('GASTOS',   fmt(totalExpenses), { color: '#dc2626' }));
  R.push(lv('BALANCE',  fmt(balance), { bold: true, color: balance >= 0 ? '#059669' : '#dc2626' }));
  R.push(gap());

  // ── Cash movements ────────────────────────────────────────────────────────
  R.push(ctr('MOVIMIENTOS DE EFECTIVO', true));
  R.push(lv('ENTREGAS AL CONTADO', fmt(cashSales)));
  R.push(lv('SALIDAS DE CAJA',     fmt(cashExpensesTotal)));
  if (cashExpensesList.length) {
    R.push(sep());
    R.push(`<tr>
      <td style="padding:1px 0;font-weight:700;">MOTIVO</td>
      <td style="padding:1px 0;text-align:right;font-weight:700;">TOTAL</td>
    </tr>`);
    for (const e of cashExpensesList) {
      const amt = Number(e?.amount || 0);
      if (!amt) continue;
      R.push(lv(String(e?.description || e?.category || 'Gasto').slice(0, 28), fmt(amt), { indent: true }));
    }
  }
  R.push(sep());
  R.push(lv('EFECTIVO ESPERADO', fmt(expectedCash)));
  if (actualCash !== null) {
    R.push(lv('EFECTIVO REAL', fmt(actualCash)));
    if (diff !== null) {
      const dColor = diff >= 0 ? '#059669' : '#dc2626';
      const dSign  = diff < 0 ? '-' : '';
      R.push(lv('DIFERENCIA', `<span style="color:${dColor};font-weight:900;">${dSign}${fmt(Math.abs(diff))}</span>`));
    }
  } else {
    R.push(lv('EFECTIVO REAL', '<span style="color:#aaa;font-style:italic;">pulsar CONTAR</span>'));
  }
  R.push(gap());

  // ── Card movements ────────────────────────────────────────────────────────
  R.push(ctr('MOVIMIENTOS DE TARJETA', true));
  R.push(lv('COBROS CON TARJETA', fmt(cardSales)));
  R.push(lv('PAGOS EN TARJETA',   fmt(cardSales)));
  R.push(gap());

  // ── VAT breakdown ─────────────────────────────────────────────────────────
  R.push(ctr('DESGLOSE DEL IVA', true));
  if (vatRows.length) {
    R.push(`<tr>
      <td style="padding:1px 0;font-weight:700;">IVA%</td>
      <td style="padding:1px 0;text-align:right;font-weight:700;">BASE &nbsp;&nbsp; CUOTA &nbsp;&nbsp; TOTAL</td>
    </tr>`);
    R.push(sep());
    let sumBase=0, sumCuota=0, sumTotal=0;
    for (const r of vatRows) {
      sumBase  += Number(r.base  || 0);
      sumCuota += Number(r.cuota || 0);
      sumTotal += Number(r.total || 0);
      R.push(`<tr>
        <td style="padding:1px 0;">${r.rate}%</td>
        <td style="padding:1px 0;text-align:right;">${fmt(r.base)} &nbsp; ${fmt(r.cuota)} &nbsp; ${fmt(r.total)}</td>
      </tr>`);
    }
    R.push(sep());
    R.push(`<tr>
      <td style="padding:1px 0;font-weight:900;">TOTAL</td>
      <td style="padding:1px 0;text-align:right;font-weight:900;">${fmt(sumBase)} &nbsp; ${fmt(sumCuota)} &nbsp; ${fmt(sumTotal)}</td>
    </tr>`);
  } else {
    R.push(lv('TOTAL IVA', fmt(totalTax)));
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  R.push(gap());
  R.push(lv('LE ATENDIO.:', cashierName));
  R.push(sep(true));
  R.push(gap());
  if (isPending) {
    R.push(ctr('<span style="color:#d97706;font-weight:900;">*** BORRADOR — NO CONFIRMADO ***</span>'));
    R.push(ctr('<span style="color:#aaa;font-size:11px;">Pulse DONE para cerrar el arqueo</span>'));
  } else {
    R.push(ctr('<span style="color:#059669;font-weight:900;">✓ ARQUEO CERRADO</span>'));
  }
  R.push(gap());

  paper.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-family:'Courier New',Courier,monospace;font-size:13px;line-height:1.6;color:#111;">
      <tbody>${R.join('')}</tbody>
    </table>`;
}

  const storeName  = systemSettings?.store_name    || '';
  const storeAddr  = systemSettings?.store_address || '';
  const storeCif   = systemSettings?.store_cif     || systemSettings?.tax_id || '';
  const storeCity  = systemSettings?.store_city    || '';
  const storePhone = systemSettings?.store_phone   || '';

  const totalSales   = Number(data.total_sales   || 0);
  const totalReturns = Number(data.total_returns  || 0);
  const grossSales   = Number(data.gross_sales    || 0);
  const netSales     = Number(data.net_sales      || 0);
  const cashSales    = Number(data.cash_sales     || data._net_cash_collected || 0);
  const cardSales    = Number(data.card_sales     || data._net_card_collected || 0);
  const totalAmt     = cashSales + cardSales;
  const totalExp     = Number(data.total_expenses || data._auto_expenses_total || 0);
  const totalTax     = Number(data.total_tax      || 0);
  const reportNum    = data.report_number || 'BORRADOR';
  const cashierName  = data.cashier_name  || (currentUser?.full_name) || '-';
  const netCount     = Number(data.net_sales_count || Math.max(0, totalSales - totalReturns) || 0);
  const ticketMedio  = totalSales > 0 ? totalAmt / totalSales : 0;

  const expectedCash = Number(data.expected_cash || data._expected_cash_base || 0);
  const actualCash   = (_arqueoCurrentIdx === -1 && _arqueoContarValue !== null)
                       ? _arqueoContarValue
                       : (data.actual_cash !== null && data.actual_cash !== undefined ? Number(data.actual_cash) : null);
  const diff         = actualCash !== null ? (actualCash - expectedCash) : null;

  const rDate    = data.report_date ? new Date(data.report_date) : new Date();
  const rDateStr = _fmtDate(rDate);
  const rTimeStr = _fmtTime(rDate);
  const startDate = data.start_datetime ? _fmtDate(new Date(data.start_datetime)) : rDateStr;
  const endDate   = data.end_datetime   ? _fmtDate(new Date(data.end_datetime))   : rDateStr;

  // Build rows as HTML with proper left-label / right-value layout
  const row = (label, value, opts = {}) => {
    const bold   = opts.bold   ? 'font-weight:900;' : '';
    const sep    = opts.sep    ? `<tr><td colspan="2" style="padding:2px 0;"><div style="border-top:1px solid #ccc;margin:4px 0;"></div></td></tr>` : '';
    const dsep   = opts.dsep   ? `<tr><td colspan="2" style="padding:2px 0;"><div style="border-top:3px double #333;margin:4px 0;"></div></td></tr>` : '';
    const color  = opts.color  ? `color:${opts.color};` : '';
    const indent = opts.indent ? 'padding-left:16px;' : '';
    return `${sep}${dsep}<tr>
      <td style="padding:1px 0;${indent}${bold}white-space:nowrap;">${label}</td>
      <td style="padding:1px 0;text-align:right;${bold}${color}white-space:nowrap;">${value}</td>
    </tr>`;
  };

  const blank = () => `<tr><td colspan="2" style="height:8px;"></td></tr>`;
  const head  = (text) => `<tr><td colspan="2" style="padding:3px 0 1px 0;font-weight:700;letter-spacing:0.5px;">${text}</td></tr>`;
  const center = (text, opts = {}) => {
    const bold = opts.bold ? 'font-weight:900;font-size:14px;' : '';
    return `<tr><td colspan="2" style="text-align:center;padding:2px 0;${bold}">${text}</td></tr>`;
  };
  const dline = () => `<tr><td colspan="2"><div style="border-top:2px solid #222;margin:5px 0;"></div></td></tr>`;
  const sline = () => `<tr><td colspan="2"><div style="border-top:1px solid #aaa;margin:4px 0;"></div></td></tr>`;

  const balance = netSales - totalExp;
  const balColor = balance >= 0 ? '#059669' : '#dc2626';
  const diffColor = diff !== null ? (diff >= 0 ? '#059669' : '#dc2626') : '#0f172a';

  let rows = '';
  rows += center('ARQUEO DE CAJA', { bold: true });
  if (storeName)  rows += center(`<b>${storeName}</b>`);
  if (storeAddr)  rows += center(storeAddr);
  if (storeCif)   rows += center(storeCif);
  if (storeCity)  rows += center(storeCity);
  if (storePhone) rows += center(storePhone);
  rows += blank();
  rows += row('CAJA',    'CAJA PRINCIPAL');
  rows += row('ARQUEO',  reportNum);
  rows += row('FECHA',   rDateStr);
  rows += row('FECHAS',  `${startDate}  ${endDate}`);
  rows += row('HORA X',  rTimeStr);
  rows += row('USUARIO', cashierName);
  rows += blank();
  rows += dline();
  rows += `<tr>
    <td style="padding:4px 0;font-weight:900;font-size:15px;">&nbsp;&nbsp;${totalSales} CUENTAS</td>
    <td style="text-align:right;font-weight:900;font-size:15px;">${fmt(totalAmt)}</td>
  </tr>`;
  rows += dline();
  rows += blank();
  rows += row('VENTA BRUTA',   fmt(grossSales));
  rows += row('DESCUENTOS',    fmt(0),  { indent: true });
  rows += sline();
  rows += row('INVITACIONES',  fmt(0));
  rows += row('PERSONAL',      fmt(0));
  rows += blank();
  rows += row('VENTA NETA',    fmt(netSales),  { bold: true });
  rows += row(`${totalSales > 0 ? totalSales - (totalSales - Math.round(cashSales / (totalAmt || 1) * totalSales)) : 0} CONTADO`, fmt(cashSales), { indent: true });
  rows += row(`${Math.round(cardSales / (totalAmt || 1) * totalSales) || 0} TARJETA`,  fmt(cardSales), { indent: true });
  rows += blank();
  rows += sline();
  rows += head('DOCUMENTOS.');
  rows += row('NUMERO DE VENTAS',  String(totalSales));
  rows += row('ARTICULOS VENDIDOS', '-');
  rows += row('TICKET MEDIO',       fmt(ticketMedio));
  rows += row('ARTICULOS/TICKET',   '-');
  rows += row('VENTA REAL', `${netCount}  ${fmt(netSales)}`);
  rows += blank();
  rows += sline();
  rows += head('IVA / IMPUESTOS');
  rows += row('TOTAL IVA', fmt(totalTax));
  rows += blank();
  rows += sline();
  rows += head('GASTOS');
  rows += row('TOTAL GASTOS', `<span style="color:#dc2626;">${fmt(totalExp)}</span>`);
function _fmtDate(d) {
  try {
    return new Intl.DateTimeFormat('es-ES', { timeZone: getDisplayTimeZone(), day:'2-digit', month:'2-digit', year:'numeric' }).format(d);
  } catch { return d.toLocaleDateString(); }
}
function _fmtTime(d) {
  try {
    return new Intl.DateTimeFormat('es-ES', { timeZone: getDisplayTimeZone(), hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(d);
  } catch { return d.toLocaleTimeString(); }
}

/** Show the CONTAR panel */
function arqueoShowContar() {
  const overlay = document.getElementById('arqueoContarOverlay');
  if (!overlay) return;
  const cs = systemSettings?.currency_symbol || '€';
  const data = _arqueoCurrentIdx === -1 ? _arqueoNewData : _arqueoAllReports[_arqueoCurrentIdx];
  const expected = Number(data?.expected_cash || data?._expected_cash_base || 0);
  const expEl = document.getElementById('arqueoContarExpected');
  if (expEl) expEl.textContent = `${cs}${expected.toFixed(2)}`;
  // Reset display and hidden input
  const dispEl = document.getElementById('arqueoContarDisplay');
  const actEl  = document.getElementById('arqueoContarActual');
  if (dispEl) dispEl.textContent = '0';
  if (actEl)  actEl.value = '';
  const diffEl = document.getElementById('arqueoContarDiff');
  if (diffEl) { diffEl.textContent = '-'; diffEl.style.color = '#0f172a'; }
  overlay.style.display = 'flex';
}

/** Handle numpad key press */
function arqueoContarKey(key) {
  const dispEl = document.getElementById('arqueoContarDisplay');
  const actEl  = document.getElementById('arqueoContarActual');
  if (!dispEl) return;

  let cur = dispEl.textContent === '0' ? '' : dispEl.textContent;

  if (key === 'back') {
    cur = cur.slice(0, -1);
    if (!cur) cur = '';
  } else if (key === '.') {
    if (cur.includes('.')) return; // only one decimal
    cur = (cur || '0') + '.';
  } else {
    // Limit to 2 decimal places
    const parts = cur.split('.');
    if (parts[1] !== undefined && parts[1].length >= 2) return;
    cur += key;
  }

  dispEl.textContent = cur || '0';
  if (actEl) actEl.value = cur;
  arqueoContarCalcDiff();
}

function arqueoContarCalcDiff() {
  const cs = systemSettings?.currency_symbol || '€';
  const data = _arqueoCurrentIdx === -1 ? _arqueoNewData : _arqueoAllReports[_arqueoCurrentIdx];
  const expected = Number(data?.expected_cash || data?._expected_cash_base || 0);
  const dispEl = document.getElementById('arqueoContarDisplay');
  const raw = dispEl ? dispEl.textContent : '0';
  const actual = parseFloat(raw) || 0;
  const diff   = actual - expected;
  const diffEl = document.getElementById('arqueoContarDiff');
  if (diffEl) {
    const cs2 = systemSettings?.currency_symbol || '€';
    diffEl.textContent = `${cs2}${diff.toFixed(2)}`;
    diffEl.style.color = diff < 0 ? '#dc2626' : diff > 0 ? '#059669' : '#0f172a';
  }
}

function arqueoContarConfirm() {
  const dispEl = document.getElementById('arqueoContarDisplay');
  const raw    = dispEl ? dispEl.textContent : '0';
  const actual = parseFloat(raw);
  if (isNaN(actual) || raw === '0' || raw === '') {
    showAlert('Please enter the actual cash amount.', 'error', 'Error');
    return;
  }
  _arqueoContarValue = actual;
  document.getElementById('arqueoContarOverlay').style.display = 'none';
  _arqueoRenderCurrent();
  const actEl = document.getElementById('zReportActualCash');
  if (actEl) actEl.value = String(actual);
}

/** Done — complete/save the Z-report */
async function arqueoActionDone() {
  if (_arqueoCurrentIdx !== -1) { showAlert('This report is already saved.', 'info', 'Info'); return; }
  if (!_arqueoNewData) { showAlert('No pending report data.', 'error', 'Error'); return; }

  if (_arqueoContarValue !== null) {
    const actEl = document.getElementById('zReportActualCash');
    if (actEl) actEl.value = String(_arqueoContarValue);
  }

  currentZReportData = _arqueoNewData;
  await completeZReport();

  try {
    const all = await window.api.getAllZReports();
    _arqueoAllReports = Array.isArray(all) ? all : [];
  } catch { _arqueoAllReports = []; }

  _arqueoCurrentIdx = 0;
  _arqueoNewData    = null;
  _arqueoContarValue = null;
  _arqueoRenderCurrent();
}

/** Print the currently displayed report */
async function arqueoActionPrint() {
  const isPending = (_arqueoCurrentIdx === -1);
  if (isPending) {
    if (_arqueoNewData) {
      const temp = {
        ..._arqueoNewData,
        report_number: _arqueoNewData.report_number || ('DRAFT-' + Date.now()),
        report_date: new Date().toISOString(),
        total_sales_amount: (_arqueoNewData.cash_sales || 0) + (_arqueoNewData.card_sales || 0),
        actual_cash: _arqueoContarValue,
        cash_difference: _arqueoContarValue !== null
          ? _arqueoContarValue - (_arqueoNewData.expected_cash || 0)
          : null,
      };
      await printZReport(temp);
    }
  } else {
    const report = _arqueoAllReports[_arqueoCurrentIdx];
    if (report) await printZReport(report);
  }
}

/** Close the overlay */
function arqueoClose() {
  try {
    const overlay = document.getElementById('arqueoOverlay');
    if (overlay) overlay.style.display = 'none';
  } catch { /* ignore */ }
  // Also close the coPanel if it was used to open Z Reports
  try { closeCoPanel(); } catch { /* ignore */ }
  _arqueoNewData    = null;
  _arqueoContarValue = null;
  currentZReportData = null;
  // Return to checkout (POS) screen — bypass permission check, always safe
  try {
    // Hide all views, show checkout directly
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const cv = document.getElementById('checkoutView');
    if (cv) cv.classList.add('active');
    // Update nav active state
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const nb = document.querySelector('.tab-btn[data-view="checkout"]');
    if (nb) nb.classList.add('active');
    // Hide navbar for checkout
    const topNavbar = document.getElementById('topNavbar');
    if (topNavbar) topNavbar.style.display = 'none';
    const mw = document.querySelector('.main-content-wrapper');
    if (mw) mw.style.height = '100vh';
    // Reload checkout data
    loadCheckoutView();
  } catch(e) {
    navigateToView('checkout');
  }
}

function arqueoActionCancel() { arqueoClose(); }

/** Open arqueo overlay directly on a saved report (from the table eye button) */
async function arqueoViewSaved(reportId) {
  try {
    const overlay = document.getElementById('arqueoOverlay');
    if (!overlay) return;
    const all = await window.api.getAllZReports();
    _arqueoAllReports = Array.isArray(all) ? all : [];
    _arqueoNewData    = null;
    _arqueoContarValue = null;
    const idx = _arqueoAllReports.findIndex(r => r.id === reportId);
    _arqueoCurrentIdx = idx >= 0 ? idx : 0;
    _arqueoRenderCurrent();
    overlay.style.display = 'flex';
  } catch (e) {
    showAlert('Error opening report: ' + e.message, 'error', 'Error');
  }
}