/* eslint-disable no-console */

// Barcode label preview server (no printer required)
// Serves the same HTML/SVG layouts used by main.js barcode label printing.
//
// Usage:
//   node tools/preview-label.js --port=5055
// Then open:
//   http://127.0.0.1:5055/?layout=pvp-right&name=GUINDILLAS&barcode=8412666344008&price=1.45&currency=%E2%82%AC
//
// Layouts:
//   - pvp-right (matches your sample photo #2)
//   - centered
//   - compact

const http = require('http');
const bwipjs = require('bwip-js');

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return fallback;
  return arg.slice(prefix.length);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(amount, currencySymbol) {
  const n = Number(amount);
  const p = (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',');
  if (currencySymbol === '€') return `${p}€`;
  return `${currencySymbol}${p}`;
}

function detectBcid(barcode) {
  const b = String(barcode || '').trim();
  const isEAN13 = /^\d{13}$/.test(b);
  const isUPCA = /^\d{12}$/.test(b);
  const isEAN8 = /^\d{8}$/.test(b);
  return isEAN13 ? 'ean13' : (isUPCA ? 'upca' : (isEAN8 ? 'ean8' : 'code128'));
}

function buildLabelHtml({
  layout,
  name,
  barcode,
  price,
  currencySymbol,
  mmW,
  mmH
}) {
  const safeLayout = String(layout || 'pvp-right').toLowerCase().replace(/[_\s]/g, '-');
  const bcid = detectBcid(barcode);

  let barcodeSvg = '';
  try {
    barcodeSvg = bwipjs.toSVG({
      bcid,
      text: String(barcode || ''),
      // Allow "internal" barcodes that don't have a valid EAN/UPC check digit.
      validatecheck: false,
      scale: 2,
      height: 9,
      includetext: true,
      textxalign: 'center',
      textsize: 9,
      paddingwidth: 0,
      paddingheight: 0,
    });
  } catch {
    // Never hard-fail the preview page. Fall back to Code128.
    barcodeSvg = bwipjs.toSVG({
      bcid: 'code128',
      text: String(barcode || ''),
      scale: 2,
      height: 9,
      includetext: true,
      textxalign: 'center',
      textsize: 9,
      paddingwidth: 0,
      paddingheight: 0,
    });
  }

  const titleText = escapeHtml(String(name || '').toUpperCase());
  const hasPrice = Number.isFinite(Number(price));
  const priceText = escapeHtml(hasPrice ? formatPrice(price, currencySymbol) : '');

  if (safeLayout === 'centered') {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Label Preview</title>
  <style>
    @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
    html, body { width: ${mmW}mm; height: ${mmH}mm; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; background:#f5f5f5; }
    .sheet { min-height: 100vh; display:flex; align-items:center; justify-content:center; padding: 24px; box-sizing: border-box; }
    .label { width: ${mmW}mm; height: ${mmH}mm; background:#fff; box-shadow: 0 10px 35px rgba(0,0,0,0.18); }

    .wrap { box-sizing: border-box; width: 100%; height: 100%; padding: 3mm; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; }
    .title { font-weight: 900; font-size: 26px; line-height: 1.05; letter-spacing: 0.5px; margin: 0 0 2mm 0; text-align:center; width:100%; }
    .price { font-weight: 900; font-size: 26px; line-height: 1.0; margin: 0 0 2mm 0; text-align:center; width:100%; }
    .pvp { font-weight: 900; font-size: 14px; margin-right: 6px; }
    .barcode { width: 100%; flex: 1 1 auto; display:flex; align-items:flex-end; justify-content:center; }
    svg { width: 92%; height: auto; }

    .note { margin-top: 12px; font-size: 12px; color:#475569; text-align:center; }
  </style>
</head>
<body>
  <div class="sheet">
    <div>
      <div class="label">
        <div class="wrap">
          <div class="title">${titleText}</div>
          <div class="price"><span class="pvp">P.V.P.</span>${priceText}</div>
          <div class="barcode">${barcodeSvg}</div>
        </div>
      </div>
      <div class="note">layout=centered • ${mmW}×${mmH}mm</div>
    </div>
  </div>
</body>
</html>`;
  }

  if (safeLayout === 'compact') {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Label Preview</title>
  <style>
    @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
    html, body { width: ${mmW}mm; height: ${mmH}mm; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; background:#f5f5f5; }
    .sheet { min-height: 100vh; display:flex; align-items:center; justify-content:center; padding: 24px; box-sizing: border-box; }
    .label { width: ${mmW}mm; height: ${mmH}mm; background:#fff; box-shadow: 0 10px 35px rgba(0,0,0,0.18); }

    .wrap { box-sizing: border-box; width: 90%; height: 84%; margin: 1.5mm auto 0; border: 1px solid #111; padding: 1.4mm 1.6mm; }
    .title { font-weight: 900; font-size: 10px; letter-spacing: 0.25px; margin: 0 0 0.8mm 0; }
    .row { display: flex; gap: 1.5mm; align-items: center; height: calc(100% - 6mm); }
    .left { flex: 1 1 52%; display: flex; align-items: center; justify-content: center; overflow:hidden; }
    .right { flex: 1 1 48%; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; }
    .pvp { font-weight: 900; font-size: 8px; margin-bottom: 0.35mm; }
    .price { font-weight: 900; font-size: 22px; line-height: 0.92; }
    .ref { font-weight: 800; font-size: 8.5px; margin-top: 0.8mm; }
    svg { width: 82%; height: auto; max-height: 100%; }

    .note { margin-top: 12px; font-size: 12px; color:#475569; text-align:center; }
  </style>
</head>
<body>
  <div class="sheet">
    <div>
      <div class="label">
        <div class="wrap">
          <div class="title">${titleText}</div>
          <div class="row">
            <div class="left">${barcodeSvg}</div>
            <div class="right">
              <div class="pvp">P.V.P.</div>
              <div class="price">${priceText}</div>
              <div class="ref">Ref: ${escapeHtml(String(barcode))}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="note">layout=compact • ${mmW}×${mmH}mm</div>
    </div>
  </div>
</body>
</html>`;
  }

  // Default: pvp-right (matches photo #2)
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Label Preview</title>
  <style>
    @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
    html, body { width: ${mmW}mm; height: ${mmH}mm; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; background:#f5f5f5; }
    .sheet { min-height: 100vh; display:flex; align-items:center; justify-content:center; padding: 24px; box-sizing: border-box; }
    .label { width: ${mmW}mm; height: ${mmH}mm; background:#fff; box-shadow: 0 10px 35px rgba(0,0,0,0.18); }

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
    .barcode { width: 100%; height: 100%; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    svg { width: 88%; height: auto; max-height: 100%; }
    .priceRow { display:flex; flex-direction:column; align-items:center; justify-content:center; padding-bottom: 1mm; }
    .pvp { font-weight: 700; font-size: 10px; line-height: 1.0; margin: 0 0 0.3mm 0; }
    .price { font-weight: 900; font-size: 16px; line-height: 1.0; margin: 0; }

    .note { margin-top: 12px; font-size: 12px; color:#475569; text-align:center; }
  </style>
</head>
<body>
  <div class="sheet">
    <div>
      <div class="label">
        <div class="wrap">
          <div class="title">${titleText}</div>
          <div class="barcode">${barcodeSvg}</div>
          <div class="priceRow">
            <div class="pvp">P.V.P.</div>
            <div class="price">${priceText}</div>
          </div>
        </div>
      </div>
      <div class="note">layout=pvp-right • ${mmW}×${mmH}mm</div>
    </div>
  </div>
</body>
</html>`;
}

function readRequestParams(reqUrl) {
  const url = new URL(reqUrl, 'http://127.0.0.1');
  const layout = url.searchParams.get('layout') || 'pvp-right';
  const name = url.searchParams.get('name') || 'GUINDILLAS';
  const barcode = url.searchParams.get('barcode') || '8412666344008';
  const price = toNumber(url.searchParams.get('price') ?? '1.45', 1.45);
  const currencySymbol = url.searchParams.get('currency') || '€';
  const mmW = toNumber(url.searchParams.get('w') ?? url.searchParams.get('width') ?? '57', 57);
  const mmH = toNumber(url.searchParams.get('h') ?? url.searchParams.get('height') ?? '32', 32);

  return { layout, name, barcode, price, currencySymbol, mmW, mmH, url };
}

const port = Math.max(0, Math.min(65535, parseInt(parseArg('port', '5055'), 10) || 5055));

const server = http.createServer((req, res) => {
  try {
    const { layout, name, barcode, price, currencySymbol, mmW, mmH, url } = readRequestParams(req.url);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    if (url.pathname === '/help') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        'Label preview server\n\n' +
        'Open / in a browser with query params:\n' +
        '  layout=pvp-right|centered|compact\n' +
        '  name=...\n' +
        '  barcode=...\n' +
        '  price=1.45\n' +
        '  currency=%E2%82%AC\n' +
        '  w=57&h=32 (mm)\n'
      );
      return;
    }

    const html = buildLabelHtml({ layout, name, barcode, price, currencySymbol, mmW, mmH });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(e?.message || e));
  }
});

server.listen(port, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${port}/`;
  console.log('Label preview server running');
  console.log('Open:', base);
  console.log('Example (matches photo #2):');
  console.log(base + '?layout=pvp-right&name=GUINDILLAS&barcode=8412666344008&price=1.45&currency=%E2%82%AC');
  console.log('');
  console.log('Tip: add &layout=centered or &layout=compact to compare.');
});
