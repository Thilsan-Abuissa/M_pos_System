/* eslint-disable no-console */

// Receipt preview generator (no printer required)
// This mirrors the receipt layout logic used in main.js

const parseWidthArg = () => {
  const arg = process.argv.find((a) => a.startsWith('--width='));
  if (!arg) return null;
  const value = Number(arg.split('=')[1]);
  if (!Number.isFinite(value)) return null;
  if (value < 24 || value > 64) return null;
  return Math.round(value);
};

const LINE_WIDTH = parseWidthArg() ?? 32;

const getItemLayout = (lineWidth) => {
  const qtyWidth = 6;
  const isWide = lineWidth >= 42;
  const priceWidth = isWide ? 8 : 6;
  const totalWidth = isWide ? 8 : 6;
  const gapDescPrice = isWide ? 1 : 0;
  const gapPriceTotal = 1;
  const descWidth = lineWidth - qtyWidth - gapDescPrice - priceWidth - gapPriceTotal - totalWidth;
  const headerLeftWidth = qtyWidth + descWidth + gapDescPrice;
  return { qtyWidth, descWidth, priceWidth, totalWidth, gapDescPrice, gapPriceTotal, headerLeftWidth };
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

const rightLabelValue = (label, value, gap = 2) => {
  const labelText = String(label);
  const valueText = String(value);
  const spaces = Math.max(gap, LINE_WIDTH - labelText.length - valueText.length);
  return labelText + ' '.repeat(spaces) + valueText;
};

function buildReceiptPreview(receiptData) {
  const currency = receiptData.currency || '€';

  let receipt = '';

  // NOTE: This is a text preview (no ESC/POS control codes printed)
  receipt += (receiptData.storeName || '').toString().toUpperCase() + '\n';
  if (receiptData.ownerName) receipt += receiptData.ownerName + '\n';
  if (receiptData.nieNumber) receipt += receiptData.nieNumber + '\n';
  if (receiptData.companyAddress) receipt += receiptData.companyAddress + '\n';

  receipt += '\n';
  receipt += 'FACTURA SIMPLIFICADA\n\n';

  receipt += '='.repeat(LINE_WIDTH) + '\n';
  receipt += 'FECHA: ' + (receiptData.date || '') + '\n';
  receipt += 'Factura Simplificada PRINCIPAL\n';
  receipt += 'Serie/Nº: ' + (receiptData.receiptId || '') + '\n';

  const totalHeaderLabel = layout.totalWidth >= 7 ? 'Importe' : 'Import';
  receipt += padRight('Ud.Descripcion', layout.headerLeftWidth)
    + padLeft('Precio', layout.priceWidth)
    + ' '.repeat(layout.gapPriceTotal)
    + padLeft(totalHeaderLabel, layout.totalWidth)
    + '\n';
  receipt += '-'.repeat(LINE_WIDTH) + '\n';

  (receiptData.items || []).forEach((item) => {
    const qty = Number(item.quantity || 0);
    const subtotal = Number(item.subtotal || 0);
    const unitPrice = qty ? (subtotal / qty) : subtotal;

    const qtyStrRaw = Number.isFinite(qty) ? (qty % 1 === 0 ? String(qty) : qty.toFixed(3)) : '';
    const qtyStr = padRight(qtyStrRaw.replace(/0+$/, '').replace(/\.$/, ''), layout.qtyWidth);
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
  });

  receipt += '-'.repeat(LINE_WIDTH) + '\n';

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

  (receiptData.taxBreakdown || []).forEach((taxLine) => {
    const rate = Number(taxLine.rate || 0);
    const base = Number(taxLine.base || 0);
    const cuota = Number(taxLine.tax || 0);
    const total = Number(taxLine.total || 0);

    totalBase += base;
    totalCuota += cuota;
    totalAll += total;

    const ivaStr = padRight((Number.isFinite(rate) ? rate.toFixed(0) : '0') + '%', ivaWidth);
    const baseStr = padLeft(formatMoney(base, { decimal: ',', suffix: currency }), baseWidth);
    const cuotaStr = padLeft(formatMoney(cuota, { decimal: ',', suffix: currency }), cuotaWidth);
    const totalStr = padLeft(formatMoney(total, { decimal: ',', suffix: currency }), taxTotalWidth);

    receipt += ivaStr + baseStr + cuotaStr + totalStr + '\n';
  });

  receipt += '-'.repeat(LINE_WIDTH) + '\n';
  receipt += padRight('TOTAL', ivaWidth)
    + padLeft(formatMoney(totalBase, { decimal: ',', suffix: currency }), baseWidth)
    + padLeft(formatMoney(totalCuota, { decimal: ',', suffix: currency }), cuotaWidth)
    + padLeft(formatMoney(totalAll, { decimal: ',', suffix: currency }), taxTotalWidth)
    + '\n';

  receipt += '-'.repeat(LINE_WIDTH) + '\n';

  const paymentMethod = (receiptData.paymentMethod || 'CASH').toString().toUpperCase();
  const paymentLabel = paymentMethod === 'CASH' ? 'EFECTIVO'
    : paymentMethod === 'CARD' ? 'TARJETA'
      : paymentMethod === 'PARKING' ? 'CREDITO'
        : paymentMethod;

  receipt += rightLabelValue(paymentLabel, formatMoney(receiptData.total || 0, { decimal: ',', suffix: currency })) + '\n';
  receipt += '-'.repeat(LINE_WIDTH) + '\n\n';

  // Big total section (as printed: amount without currency)
  receipt += 'TOTAL        ' + formatMoney(receiptData.total || 0, { decimal: ',' }) + '\n';
  receipt += '(Impuestos Incluidos)\n\n';

  const entrega = formatMoney((receiptData.paymentAmount || receiptData.total), { decimal: ',' });
  const cambio = formatMoney((receiptData.changeAmount || 0), { decimal: ',' });
  receipt += rightLabelValue('ENTREGA', entrega) + '\n';
  receipt += rightLabelValue('CAMBIO', cambio) + '\n\n';

  receipt += 'SERVICIOS: ' + (receiptData.items?.length || 0) + '\n';
  receipt += 'CUENTAS:   / 1 )\n';
  receipt += 'LE ATENDIO: ' + (receiptData.cashier || '') + '\n\n';

  receipt += '---- ' + (receiptData.footer || 'GRACIAS POR SU VISITA') + ' ----\n';

  return receipt;
}

// Example data close to your photos
const example = {
  storeName: 'SUPERMARKET POS',
  ownerName: '',
  nieNumber: '',
  companyAddress: '',
  receiptId: 58,
  date: '23/02/2026, 11:00:33',
  currency: '€',
  items: [
    { name: 'KIWI', quantity: 0.235, subtotal: 23.48 },
    { name: 'KIWI GOLDEN', quantity: 1.81, subtotal: 16.27 },
    { name: 'CIRUELA', quantity: 1.575, subtotal: 3.15 },
  ],
  taxBreakdown: [
    { rate: 4, base: 41.25, tax: 1.65, total: 42.90 },
  ],
  total: 42.90,
  paymentMethod: 'cash',
  paymentAmount: 45.00,
  changeAmount: 2.10,
  cashier: 'shipu',
  footer: 'Vielen Dank für Ihren Einkauf!',
};

console.log(buildReceiptPreview(example));
