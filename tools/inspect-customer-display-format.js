#!/usr/bin/env node

// Inspect what the 2x20 customer display will show, without hardware.
// Usage: node tools/inspect-customer-display-format.js

const CustomerDisplay = require('../customer-display');

function showExample(title, lines) {
  const { line1, line2 } = lines;
  const ruler = '12345678901234567890';
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('RULER:|' + ruler + '|');
  console.log('L1   :|' + line1 + '| len=' + line1.length);
  console.log('L2   :|' + line2 + '| len=' + line2.length);
}

async function main() {
  const display = new CustomerDisplay();

  showExample('Weight item (expected: name / 0.235*7.02=1.65)',
    display.formatCurrentItemLines('kiwi', 1.65, '€', 0.235, 7.02, 'kg'));

  showExample('Count item (expected: name / 2x1.99=3.98)',
    display.formatCurrentItemLines('MILK', 3.98, '€', 2, 1.99, 'pc'));

  showExample('Discounted total (still shows provided unit price)',
    display.formatCurrentItemLines('CHEESE', 4.50, '€', 0.300, 19.99, 'kg'));

  showExample('Fallback (no qty/unitPrice provided => total right-aligned)',
    display.formatCurrentItemLines('TEST ITEM', 12.34, '€'));

  console.log('\nDone. If this looks correct, the hardware display will show the same 20-char lines.');
}

main().catch((err) => {
  console.error('Inspect failed:', err);
  process.exit(1);
});
