#!/usr/bin/env node

// Customer Display Connection Test Script
// Run this script to test customer display connection and troubleshoot issues

const CustomerDisplay = require('./customer-display');

async function testCustomerDisplay() {
  console.log('='.repeat(60));
  console.log('CUSTOMER DISPLAY CONNECTION TEST');
  console.log('='.repeat(60));
  
  const display = new CustomerDisplay();
  
  // Get initial status
  console.log('\n1. Checking SerialPort availability...');
  const info = display.getDisplayInfo();
  console.log(`   SerialPort Available: ${info.serialPortAvailable ? '✅ YES' : '❌ NO'}`);
  
  if (!info.serialPortAvailable) {
    console.log('\n❌ SerialPort module not available!');
    console.log('\nTo fix this issue:');
    console.log('   1. Install serialport: npm install serialport');
    console.log('   2. Make sure you have build tools installed');
    console.log('   3. On Windows: npm install --global windows-build-tools');
    console.log('   4. Restart the application');
    return;
  }
  
  // Check available ports
  console.log('\n2. Checking available ports...');
  const status = await display.getConnectionStatus();
  
  if (status.availablePorts.length === 0) {
    console.log('   ❌ No serial ports found!');
    console.log('\nTroubleshooting steps:');
    console.log('   1. Make sure the customer display is plugged into a USB port');
    console.log('   2. Check if drivers are installed (CH340, FTDI, Prolific)');
    console.log('   3. Try a different USB port or cable');
    console.log('   4. Check Windows Device Manager for unknown devices');
    return;
  }
  
  console.log(`   ✅ Found ${status.availablePorts.length} serial port(s):`);
  status.availablePorts.forEach((port, index) => {
    console.log(`   ${index + 1}. ${port.path}`);
    console.log(`      Manufacturer: ${port.manufacturer || 'Unknown'}`);
    console.log(`      Product ID: ${port.productId || 'Unknown'}`);
    console.log(`      Vendor ID: ${port.vendorId || 'Unknown'}`);
    console.log('');
  });
  
  // Try to initialize
  console.log('3. Attempting to connect to customer display...');
  const success = await display.initialize();
  
  if (success) {
    console.log('   ✅ Customer display connected successfully!');
    console.log(`   Model: ${info.model}`);
    console.log(`   Display: ${info.lines} lines × ${info.characters} characters`);
    
    // Test display functionality
    console.log('\n4. Testing display functionality...');
    await display.showWelcomeMessage();
    console.log('   ✅ Welcome message sent');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await display.showCurrentItem('TEST ITEM', 12.34, '€');
    console.log('   ✅ Item display test sent');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Weight-based item example: 0.235 kg * 7.02 = 1.65
    await display.showCurrentItem('KIWI', 1.65, '€', 0.235, 7.02, 'kg');
    console.log('   ✅ Weight item display test sent');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await display.showTotal(12.34, '€');
    console.log('   ✅ Total display test sent');

    await new Promise(resolve => setTimeout(resolve, 3000));

    if (typeof display.showPaymentSummary === 'function') {
      await display.showPaymentSummary(1.20, 5.00, 3.80, '€');
      console.log('   ✅ Payment summary (TOTAL/ENTREGA/CAMBIO) sent');
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test the thank you message specifically
    await display.showThankYou();
    console.log('   ✅ Thank you message sent');
    console.log('   Expected: Line 1: "Thank You!" | Line 2: "Have a nice day!"');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test thank you with change
    await display.showThankYou(5.66, '€');
    console.log('   ✅ Thank you with change message sent');
    
    console.log('\n✅ Customer display is working correctly!');
    
    // Clean up
    await display.disconnect();
    
  } else {
    console.log('   ❌ Failed to connect to customer display');
    console.log('\nTroubleshooting steps:');
    console.log('   1. Check that the display is powered on');
    console.log('   2. Verify the USB cable is working');
    console.log('   3. Try different baud rates (9600, 19200, 38400)');
    console.log('   4. Check display manual for correct settings');
    console.log('   5. Try manually connecting to each port listed above');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Test completed');
  console.log('='.repeat(60));
}

// Run the test
testCustomerDisplay().catch(error => {
  console.error('Test failed with error:', error.message);
  console.log('\nFull error details:', error);
});