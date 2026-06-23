with open('renderer/app.js', 'r') as f:
    content = f.read()

# Find start of _loadZXing
start = content.index('async function _loadZXing()')
# Find end of handleBulkImageFiles (just before the next top-level function)
end = content.index('\nfunction switchBulkTab(')

old_block = content[start:end]

new_block = r"""async function _loadQuagga() {
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

"""

content = content[:start] + new_block + content[end:]

with open('renderer/app.js', 'w') as f:
    f.write(content)

print('Done — replaced with Quagga2')
