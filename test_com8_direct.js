// Direct COM8 Scale Test - Run this with: node test_com8_direct.js
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

console.log('='.repeat(60));
console.log('ZFOC Scale Direct Test - COM8');
console.log('='.repeat(60));
console.log('');

const portPath = 'COM8'; // Windows COM8
const configs = [
  { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
  { baudRate: 4800, dataBits: 8, stopBits: 1, parity: 'none' },
  { baudRate: 2400, dataBits: 8, stopBits: 1, parity: 'none' },
  { baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none' },
];

async function testPort(config) {
  console.log(`\nTesting ${portPath} with:`, config);
  console.log('-'.repeat(60));

  return new Promise((resolve) => {
    let dataReceived = false;
    const chunks = [];

    const port = new SerialPort({
      path: portPath,
      ...config,
      autoOpen: false
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.on('error', (err) => {
      console.log('❌ Error:', err.message);
      resolve(false);
    });

    port.open((err) => {
      if (err) {
        console.log('❌ Failed to open:', err.message);
        resolve(false);
        return;
      }

      console.log('✅ Port opened successfully');

      // Listen for any data
      port.on('data', (data) => {
        dataReceived = true;
        chunks.push(data);
        const str = Buffer.concat(chunks).toString('utf8');
        console.log('📥 Raw data:', data.toString('hex'));
        console.log('📝 As text:', str.replace(/[\r\n\t\0]/g, ' ').trim());
        console.log('');
      });

      parser.on('data', (line) => {
        console.log('📄 Line:', line.trim());
      });

      // Send common scale commands
      setTimeout(() => {
        console.log('📤 Sending: P\\r\\n');
        port.write('P\r\n');
      }, 500);

      setTimeout(() => {
        console.log('📤 Sending: W\\r\\n');
        port.write('W\r\n');
      }, 1000);

      setTimeout(() => {
        console.log('📤 Sending: S\\r\\n');
        port.write('S\r\n');
      }, 1500);

      setTimeout(() => {
        console.log('📤 Sending: ENQ (0x05)');
        port.write(Buffer.from([0x05]));
      }, 2000);

      // Wait 6 seconds for response
      setTimeout(() => {
        port.close((err) => {
          if (err) console.log('Error closing:', err.message);
        });

        if (dataReceived) {
          console.log('✅ SUCCESS! Scale responded with data');
          const allData = Buffer.concat(chunks).toString('utf8');
          console.log('\n📊 Complete data received:');
          console.log(allData);
          console.log('\n📊 As hex:');
          console.log(Buffer.concat(chunks).toString('hex'));
          resolve(true);
        } else {
          console.log('❌ No data received from scale');
          console.log('');
          console.log('Possible issues:');
          console.log('- Scale is not sending data (some scales need button press)');
          console.log('- Wrong baud rate (trying next config...)');
          console.log('- Scale needs different command protocol');
          console.log('- Hardware connection issue');
          resolve(false);
        }
      }, 6000);
    });
  });
}

async function runTests() {
  console.log('Testing scale on COM8...');
  console.log('Make sure:');
  console.log('1. Scale is powered ON');
  console.log('2. Weight is on scale (not zero)');
  console.log('3. No other program is using COM8');
  console.log('');
  console.log('Starting tests in 3 seconds...');
  
  await new Promise(resolve => setTimeout(resolve, 3000));

  for (const config of configs) {
    const success = await testPort(config);
    if (success) {
      console.log('\n' + '='.repeat(60));
      console.log('✅ FOUND WORKING CONFIGURATION!');
      console.log('='.repeat(60));
      console.log('\nUse these settings:');
      console.log(JSON.stringify(config, null, 2));
      console.log('\nThe POS application should now work with the scale!');
      process.exit(0);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(60));
  console.log('❌ SCALE NOT RESPONDING');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('1. Check scale power and display');
  console.log('2. Try placing different weights on scale');
  console.log('3. Check COM8 port settings in Device Manager');
  console.log('4. Try different USB port');
  console.log('5. Contact scale manufacturer for protocol documentation');
  process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
