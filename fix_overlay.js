const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, 'renderer', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const marker = '<!-- Bulk Barcode Upload Overlay -->';
const start = html.indexOf('  ' + marker);
if (start === -1) { console.log('NOT FOUND'); process.exit(1); }
const newOverlay = `  <!-- Bulk Barcode Upload Overlay -->
  <div id="bulkUploadOverlay" style="display:none; position:fixed; inset:0; z-index:10500; background:rgba(15,23,42,0.7); align-items:center; justify-content:center; padding:20px;">
    <div style="background:#fff; border-radius:20px; box-shadow:0 24px 80px rgba(0,0,0,0.4); width:min(860px,98vw); max-height:92vh; display:flex; flex-direction:column; overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e40af,#3b82f6); padding:18px 24px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
        <div>
          <div style="color:#fff; font-size:20px; font-weight:900; letter-spacing:.5px;">&#x2B06; Bulk Product Upload</div>
          <div style="color:#bfdbfe; font-size:12px; margin-top:2px;">Create multiple products via CSV, Excel or barcode images</div>
        </div>
        <button onclick="closeBulkUploadOverlay()" style="background:rgba(255,255,255,0.2); border:none; color:#fff; width:36px; height:36px; border-radius:50%; font-size:20px; cursor:pointer;">&#x2715;</button>
      </div>
      <div style="display:flex; border-bottom:2px solid #e2e8f0; background:#f8fafc; flex-shrink:0;">
        <button id="bulkTabCsv" onclick="switchBulkTab('csv')" style="flex:1; padding:12px; font-size:13px; font-weight:800; border:none; border-bottom:3px solid #2563eb; background:transparent; color:#2563eb; cursor:pointer;">&#x1F4C4; CSV / Excel</button>
        <button id="bulkTabImg" onclick="switchBulkTab('img')" style="flex:1; padding:12px; font-size:13px; font-weight:800; border:none; border-bottom:3px solid transparent; background:transparent; color:#64748b; cursor:pointer;">&#x1F4F7; Barcode Images</button>
      </div>
      <div style="padding:20px 24px; overflow-y:auto; flex:1;">
        <div id="bulkPanelCsv">
          <div style="background:#f0f9ff; border:1.5px solid #bae6fd; border-radius:12px; padding:14px 16px; margin-bottom:18px;">
            <div style="font-weight:800; color:#0369a1; font-size:14px; margin-bottom:8px;">&#x1F4CB; CSV / Excel Format</div>
            <div style="font-size:13px; color:#0c4a6e; line-height:1.7;"><b>Required column:</b> <code>barcode</code> &nbsp; <b>Optional:</b> <code>name</code>, <code>price</code>, <code>category</code>, <code>tax</code> (%), <code>stock</code>, <code>cost</code>, <code>unit_type</code><br>First row = header. Existing barcodes are skipped automatically.</div>
            <button onclick="downloadBulkUploadTemplate()" style="margin-top:10px; background:#0ea5e9; color:#fff; border:none; border-radius:8px; padding:7px 16px; font-size:12px; font-weight:700; cursor:pointer;">&#x2B07; Download Template</button>
          </div>
          <div id="bulkUploadDropzone" style="border:2.5px dashed #93c5fd; border-radius:14px; padding:32px 20px; text-align:center; background:#f8faff; cursor:pointer;" onclick="document.getElementById('bulkUploadFileInput').click()">
            <div style="font-size:40px; margin-bottom:8px;">&#x1F4C1;</div>
            <div style="font-size:15px; font-weight:700; color:#1e40af;">Click to choose a CSV or Excel (.xlsx) file</div>
            <div style="font-size:12px; color:#64748b; margin-top:4px;">Supports <b>.csv</b> and <b>.xlsx</b> &mdash; drag &amp; drop also works</div>
            <input id="bulkUploadFileInput" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none;" onchange="handleBulkUploadFile(this.files[0])">
          </div>
          <div id="bulkUploadPreviewWrap" style="display:none; margin-top:18px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <div id="bulkUploadPreviewTitle" style="font-weight:800; font-size:14px; color:#0f172a;"></div>
              <button onclick="clearBulkCsv()" style="background:#e2e8f0; border:none; border-radius:8px; padding:5px 12px; font-size:12px; font-weight:700; cursor:pointer;">&#x2715; Clear</button>
            </div>
            <div style="overflow-x:auto; max-height:260px; border:1.5px solid #e2e8f0; border-radius:10px;">
              <table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead id="bulkUploadPreviewHead" style="background:#1e40af; color:#fff; position:sticky; top:0;"></thead>
                <tbody id="bulkUploadPreviewBody"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div id="bulkPanelImg" style="display:none;">
          <div style="background:#fdf4ff; border:1.5px solid #e9d5ff; border-radius:12px; padding:14px 16px; margin-bottom:18px;">
            <div style="font-weight:800; color:#6b21a8; font-size:14px; margin-bottom:6px;">&#x1F4F7; How it works</div>
            <div style="font-size:13px; color:#581c87; line-height:1.7;">Upload <b>one or many barcode images</b> (JPG, PNG, WebP).<br>The system <b>reads the barcode</b> from each image automatically, looks up the product name on <b>Open Food Facts</b>, then lets you import all at once.</div>
          </div>
          <div id="imgDropzone" style="border:2.5px dashed #c4b5fd; border-radius:14px; padding:28px 20px; text-align:center; background:#faf5ff; cursor:pointer;" onclick="document.getElementById('bulkImgFileInput').click()">
            <div style="font-size:40px; margin-bottom:8px;">&#x1F5BC;</div>
            <div style="font-size:15px; font-weight:700; color:#7c3aed;">Click to choose barcode images</div>
            <div style="font-size:12px; color:#64748b; margin-top:4px;">JPG, PNG, WebP &mdash; multiple files allowed &mdash; drag &amp; drop works too</div>
            <input id="bulkImgFileInput" type="file" accept="image/*" multiple style="display:none;" onchange="handleBulkImageFiles(this.files)">
          </div>
          <div id="imgScanProgress" style="display:none; margin-top:14px;">
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; color:#334155; margin-bottom:5px;">
              <span id="imgScanProgressLabel">Scanning images...</span>
              <span id="imgScanProgressCount">0 / 0</span>
            </div>
            <div style="background:#e2e8f0; border-radius:99px; height:8px; overflow:hidden;">
              <div id="imgScanProgressBar" style="height:100%; background:linear-gradient(90deg,#7c3aed,#a855f7); width:0%; transition:width .2s;"></div>
            </div>
          </div>
          <div id="imgScanResults" style="display:none; margin-top:16px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <div id="imgScanTitle" style="font-weight:800; font-size:14px; color:#0f172a;"></div>
              <button onclick="clearBulkImages()" style="background:#e2e8f0; border:none; border-radius:8px; padding:5px 12px; font-size:12px; font-weight:700; cursor:pointer;">&#x2715; Clear</button>
            </div>
            <div style="overflow-x:auto; max-height:300px; border:1.5px solid #e2e8f0; border-radius:10px;">
              <table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead style="background:#6d28d9; color:#fff; position:sticky; top:0;">
                  <tr>
                    <th style="padding:8px 10px; text-align:left; font-weight:800;">Image</th>
                    <th style="padding:8px 10px; font-weight:800;">Barcode Detected</th>
                    <th style="padding:8px 10px; font-weight:800;">Product Name (lookup)</th>
                    <th style="padding:8px 10px; font-weight:800;">Status</th>
                  </tr>
                </thead>
                <tbody id="imgScanBody"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div id="bulkUploadProgress" style="display:none; margin-top:16px;">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; color:#334155; margin-bottom:6px;">
            <span id="bulkUploadProgressLabel">Importing...</span>
            <span id="bulkUploadProgressCount">0 / 0</span>
          </div>
          <div style="background:#e2e8f0; border-radius:99px; height:10px; overflow:hidden;">
            <div id="bulkUploadProgressBar" style="height:100%; background:linear-gradient(90deg,#2563eb,#06b6d4); width:0%; transition:width .2s;"></div>
          </div>
          <div id="bulkUploadProgressResults" style="margin-top:10px; font-size:12px; max-height:120px; overflow-y:auto;"></div>
        </div>
      </div>
      <div style="padding:14px 24px; border-top:1.5px solid #e2e8f0; display:flex; align-items:center; justify-content:flex-end; gap:10px; background:#f8fafc; flex-shrink:0;">
        <button onclick="closeBulkUploadOverlay()" style="background:#e2e8f0; color:#334155; border:none; border-radius:10px; padding:10px 22px; font-size:14px; font-weight:700; cursor:pointer;">Cancel</button>
        <button id="bulkUploadImportBtn" onclick="startBulkUpload()" disabled style="background:linear-gradient(135deg,#1e40af,#3b82f6); color:#fff; border:none; border-radius:10px; padding:10px 28px; font-size:14px; font-weight:800; cursor:pointer; opacity:0.5;">&#x2B06; Import Products</button>
      </div>
    </div>
  </div>
</body>
</html>`;

html = html.slice(0, start) + newOverlay;
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Done. HTML rewritten.');
