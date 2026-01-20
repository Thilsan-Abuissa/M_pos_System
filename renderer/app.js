// Global state
let currentUser = null;
let cart = [];
let allProducts = [];
let selectedPaymentMethod = null; // No default - must select payment method
let systemSettings = null; // System settings
let currentLogoData = ''; // Current logo data

// Role-based permissions
const PERMISSIONS = {
  cashier: ['checkout', 'sales', 'returns', 'loans'],
  manager: ['checkout', 'products', 'sales', 'reports', 'returns', 'inventory', 'loans'],
  admin: ['checkout', 'products', 'sales', 'reports', 'returns', 'inventory', 'loans', 'users', 'system']
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

function initializeApp() {
  setupLoginHandlers();
  setupNavigationHandlers();
  setupCheckoutHandlers();
  setupProductHandlers();
  setupUserHandlers();
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
  
  // Load and display branding (logo/name)
  updateBrandingUI();
}

// ============== LOGIN ==============
function setupLoginHandlers() {
  const loginBtn = document.getElementById('loginBtn');
  const username = document.getElementById('username');
  const password = document.getElementById('password');

  loginBtn.addEventListener('click', async () => {
    const user = await window.api.authenticateUser(username.value, password.value);
    if (user) {
      currentUser = user;
      showScreen('posScreen');
      
      // Display user info with role badge
      const roleBadgeClass = user.role;
      document.getElementById('currentUser').innerHTML = ``;
      
      // Setup UI based on role
      setupRoleBasedUI();
      
      // Hide navbar initially for checkout view
      toggleNavbarForView('checkout');
      
      // Load initial view
      loadAllProducts();
      loadCheckoutView();
    } else {
      showAlert('Invalid username or password.\nPlease try again.', 'error', 'Login Failed');
    }
  });

  // Allow Enter key to login
  password.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });
}

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  currentUser = null;
  cart = [];
  showScreen('loginScreen');
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
});

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
    case 'sales':
      if (hasPermission('sales')) loadSalesView();
      break;
    case 'reports':
      if (hasPermission('reports')) loadReportsView();
      break;
    case 'returns':
      if (hasPermission('sales')) loadReturnsView();
      break;
    case 'inventory':
      if (hasPermission('inventory')) loadInventoryView();
      break;
    case 'loans':
      if (hasPermission('loans')) loadLoansView();
      break;
    case 'system':
      if (hasPermission('system')) loadSystemSettingsView();
      break;
    case 'users':
      if (hasPermission('users')) loadUsersView();
      break;
  }
}

// ============== NAVIGATION ==============
function setupNavigationHandlers() {
  const navBtns = document.querySelectorAll('.tab-btn');
  const topNavbar = document.getElementById('topNavbar');
  
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      
      // Check permission
      if (!hasPermission(view)) {
        showAlert('You do not have permission to access this section.', 'warning', 'Access Denied');
        return;
      }
      
      // Update active nav button
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Show corresponding view
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(`${view}View`).classList.add('active');
      
      // Toggle navbar visibility based on view
      toggleNavbarForView(view);
      
      // Load view data
      loadViewData(view);
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
        
        // Update active nav button
        const navBtns = document.querySelectorAll('.tab-btn');
        navBtns.forEach(b => b.classList.remove('active'));
        const targetBtn = document.querySelector(`[data-view="${view}"]`);
        if (targetBtn) {
          targetBtn.classList.add('active');
        }
        
        // Show corresponding view
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`${view}View`).classList.add('active');
        
        // Toggle navbar visibility based on view
        toggleNavbarForView(view);
        
        // Load view data
        loadViewData(view);
      });
    });
  }
  
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
        
        // Show corresponding view
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`${view}View`).classList.add('active');
        
        // Toggle navbar visibility based on view
        toggleNavbarForView(view);
        
        // Load view data
        loadViewData(view);
        
        // Close menu
        settingsMenu.classList.remove('active');
      });
    });
  }
  
  // Setup logout button in right panel
  const logoutBtnRight = document.getElementById('logoutBtnRight');
  if (logoutBtnRight) {
    logoutBtnRight.addEventListener('click', () => {
      currentUser = null;
      cart = [];
      showScreen('loginScreen');
      document.getElementById('username').value = '';
      document.getElementById('password').value = '';
    });
  }
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
  const barcodeInput = document.getElementById('barcodeInput');
  const checkoutBtn = document.getElementById('checkoutBtn');

  // Virtual Numpad handlers
  const numpadBtns = document.querySelectorAll('.numpad-btn');
  numpadBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      
      // Skip if no value (hidden buttons)
      if (!value) return;
      
      if (value === 'clear') {
        barcodeInput.value = '';
      } else if (value === 'enter') {
        searchAndAddProduct(barcodeInput.value.trim());
        barcodeInput.value = '';
      } else if (['cash', 'card', 'loan'].includes(value)) {
        // Payment method selected
        selectedPaymentMethod = value;
        console.log('Payment method:', value);
        // Enable Complete Sale button
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (checkoutBtn) checkoutBtn.disabled = false;
        // Highlight selected payment button
        document.querySelectorAll('.numpad-btn').forEach(b => {
          if (b.dataset.value === value) {
            b.style.opacity = '1';
            b.style.transform = 'scale(1.05)';
          } else if (['cash', 'card', 'loan'].includes(b.dataset.value)) {
            b.style.opacity = '0.8';
            b.style.transform = 'scale(1)';
          }
        });
      } else {
        // Number or decimal
        barcodeInput.value += value;
      }
    });
  });

  barcodeInput.addEventListener('input', (e) => {
    const searchQuery = e.target.value.trim();
    displayQuickProducts(searchQuery);
  });

  barcodeInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      await searchAndAddProduct(barcodeInput.value.trim());
      barcodeInput.value = '';
    }
  });

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
}

async function loadCheckoutView() {
  // Load system settings if not already loaded
  if (!systemSettings) {
    systemSettings = await window.api.getSystemSettings();
  }
  await loadAllProducts();
  displayQuickProducts();
  updateCartDisplay();
}

async function loadAllProducts() {
  allProducts = await window.api.getAllProducts();
}

let selectedCategory = 'all';

function displayQuickProducts(searchQuery = '', category = null) {
  const container = document.getElementById('quickProductsList');
  
  // Update selected category if provided
  if (category !== null) {
    selectedCategory = category;
  }
  
  let filteredProducts;
  
  if (searchQuery) {
    // Search by barcode or name
    filteredProducts = allProducts.filter(p => 
      p.stock > 0 && 
      (p.barcode.toLowerCase().includes(searchQuery.toLowerCase()) ||
       p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  } else {
    // Show all products with stock
    filteredProducts = allProducts.filter(p => p.stock > 0);
  }
  
  // Filter by category if not 'all'
  if (selectedCategory !== 'all') {
    filteredProducts = filteredProducts.filter(p => p.category === selectedCategory);
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
  
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  container.innerHTML = filteredProducts.map(product => `
    <div class="quick-product-card" onclick="addToCart(${product.id})">
      <div class="product-image">${productIcons[product.name] || '📦'}</div>
      <div class="name">${product.name}</div>
      <div class="price">${currencySymbol}${product.price.toFixed(2)} - 1kg</div>
    </div>
  `).join('');
}

async function searchAndAddProduct(query) {
  if (!query) return;
  
  // Check if barcode is a weighable product barcode (starts with 20-29 for EAN-13)
  let weight = null;
  let productBarcode = query;
  
  if (query.length === 13 && query.startsWith('2')) {
    // EAN-13 weighable product format:
    // 2 + 5 digits (product code) + 5 digits (weight in grams) + 1 checksum
    const productCode = query.substring(1, 6);
    const weightCode = query.substring(6, 11);
    
    // Weight is encoded as grams (e.g., 00500 = 500g = 0.5kg)
    weight = parseInt(weightCode) / 1000; // Convert grams to kg
    
    // Look up product by the embedded product code
    productBarcode = '2' + productCode; // Store the base product code
  }
  
  // Try barcode first
  let product = await window.api.getProductByBarcode(productBarcode);
  
  // If weighable barcode not found, try the full barcode
  if (!product && weight !== null) {
    product = await window.api.getProductByBarcode(query);
  }
  
  // If not found, search by name
  if (!product) {
    const results = await window.api.searchProducts(query);
    if (results.length === 1) {
      product = results[0];
    } else if (results.length > 1) {
      // Show selection if multiple results
      alert(`Multiple products found. Please select from Quick Products or refine search.`);
      return;
    }
  }
  
  if (product) {
    addToCart(product.id, weight);
  } else {
    alert('Product not found');
  }
}

function addToCart(productId, weight = null) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  
  if (product.stock <= 0) {
    showAlert('Product out of stock', 'warning', 'Out of Stock');
    return;
  }
  
  // If weight is provided, add as a weighted item
  if (weight !== null && weight > 0) {
    // Calculate price based on weight
    const weightedPrice = product.price * weight;
    
    cart.push({
      productId: product.id,
      productName: `${product.name} (${weight}kg)`,
      unitPrice: product.price,
      taxRate: product.tax_rate || 0.19,
      quantity: weight,
      subtotal: weightedPrice
    });
    
    updateCartUI();
    return;
  }
  
  const existingItem = cart.find(item => item.productId === productId);
  
  if (existingItem) {
    if (existingItem.quantity < product.stock) {
      existingItem.quantity++;
      existingItem.subtotal = existingItem.quantity * existingItem.unitPrice;
    } else {
      showAlert('Not enough stock available', 'warning', 'Stock Limit');
    }
  } else {
    cart.push({
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      taxRate: product.tax_rate || 0.19,
      quantity: 1,
      subtotal: product.price
    });
  }
  
  updateCartDisplay();
}

function updateCartQuantity(productId, change) {
  const item = cart.find(i => i.productId === productId);
  const product = allProducts.find(p => p.id === productId);
  
  if (!item || !product) return;
  
  const newQuantity = item.quantity + change;
  
  if (newQuantity <= 0) {
    removeFromCart(productId);
  } else if (newQuantity <= product.stock) {
    item.quantity = newQuantity;
    item.subtotal = item.quantity * item.unitPrice;
    updateCartDisplay();
  } else {
    alert('Not enough stock available');
  }
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.productId !== productId);
  updateCartDisplay();
}

function updateCartDisplay() {
  const cartTableBody = document.getElementById('cartTableBody');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  // Reset payment method selection and button highlighting
  selectedPaymentMethod = null;
  document.querySelectorAll('.numpad-btn').forEach(b => {
    if (['cash', 'card', 'loan'].includes(b.dataset.value)) {
      b.style.opacity = '0.8';
      b.style.transform = 'scale(1)';
    }
  });
  
  if (cart.length === 0) {
    cartTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: #a0aec0;">Cart is empty</td></tr>';
    checkoutBtn.disabled = true;
  } else {
    cartTableBody.innerHTML = cart.map(item => `
      <tr>
        <td>${item.productName}</td>
        <td>${currencySymbol}${item.unitPrice.toFixed(2)}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button onclick="updateCartQuantity(${item.productId}, -1)" style="background: #fc8181; color: white; border: none; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 18px; font-weight: 800;">−</button>
            <span style="min-width: 30px; text-align: center; font-weight: 800;">${item.quantity}</span>
            <button onclick="updateCartQuantity(${item.productId}, 1)" style="background: #6EAFAF; color: white; border: none; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 18px; font-weight: 800;">+</button>
          </div>
        </td>
        <td>${currencySymbol}0.00</td>
        <td style="font-weight: 800; color: #6E8FAF;">${currencySymbol}${item.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');
    checkoutBtn.disabled = true; // Disabled until payment method selected
  }
  
  updateCartSummary();
  updateCustomerDisplayData();
}

function updateCartSummary() {
  // Update summary
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  
  // Calculate tax per product based on their tax rates
  const tax = cart.reduce((sum, item) => {
    const itemTax = item.subtotal * (item.taxRate || 0.19);
    return sum + itemTax;
  }, 0);
  
  updateCustomerDisplayData();

  const discount = 0; // Could implement discount logic
  const total = subtotal + tax - discount;
  
  document.getElementById('cartSubtotal').textContent = `${currencySymbol}${subtotal.toFixed(2)}`;
  document.getElementById('cartTax').textContent = `${currencySymbol}${tax.toFixed(2)}`;
  document.getElementById('cartDiscount').textContent = `${currencySymbol}${discount.toFixed(2)}`;
  document.getElementById('cartTotal').textContent = `${currencySymbol}${total.toFixed(2)}`;
  document.getElementById('paymentAmount').textContent = `${currencySymbol}${total.toFixed(2)}`;
}

async function completeSale() {
  if (cart.length === 0) return;
  
  if (!selectedPaymentMethod) {
    alert('Please select a payment method: CASH, CARD, or LOAN');
    return;
  }
  
  // Load system settings if not loaded
  if (!systemSettings) {
    systemSettings = await window.api.getSystemSettings();
  }
  
  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  
  // Calculate tax per product
  const tax = cart.reduce((sum, item) => {
    const itemTax = item.subtotal * (item.taxRate || 0.19);
    return sum + itemTax;
  }, 0);
  const discount = 0;
  const total = subtotal + tax - discount;
  const paymentMethod = selectedPaymentMethod;
  
  // If loan is selected, open loan customer info modal
  if (paymentMethod === 'loan') {
    openLoanModal(total, subtotal, tax);
    return;
  }
  
  const saleData = {
    subtotal,
    tax,
    discount,
    total,
    paymentMethod,
    cashierId: currentUser.id,
    items: cart
  };
  
  try {
    const sale = await window.api.createSale(saleData);
    
    // If cash payment, open cash drawer
    if (paymentMethod === 'cash') {
      await openCashDrawer();
    }
    
    // Show receipt
    showReceipt(sale);
    
    // Clear cart
    cart = [];
    updateCartDisplay();
    
    // Reload products to update stock
    await loadAllProducts();
    displayQuickProducts();
  } catch (error) {
    alert('Error completing sale: ' + error.message);
  }
}

function showReceipt(sale) {
  const modal = document.getElementById('receiptModal');
  const content = document.getElementById('receiptContent');
  
  const date = new Date(sale.sale_date);
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
  const currencySymbol = systemSettings?.currency_symbol || '$';
  const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';
  const taxRate = (systemSettings?.tax_rate || 0.10) * 100;
  
  content.innerHTML = `
    <div class="receipt-header">
      <h2>${storeName}</h2>
      <p>Receipt #${sale.id}</p>
      <p>${date.toLocaleString()}</p>
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
        <span>TOTAL:</span>
        <span>${currencySymbol}${sale.total.toFixed(2)}</span>
      </div>
      <div class="receipt-item">
        <span>Payment Method:</span>
        <span>${sale.payment_method.toUpperCase()}</span>
      </div>
    </div>
    
    <div class="receipt-footer">
      <p>${receiptFooter}</p>
      <p>Cashier: ${currentUser.full_name}</p>
    </div>
  `;
  
  modal.classList.add('active');
}

// ============== LOAN FUNCTIONS ==============
function openLoanModal(total, subtotal, tax) {
  const modal = document.getElementById('loanModal');
  modal.classList.add('active');
  
  // Store the sale details for later use
  modal.dataset.total = total;
  modal.dataset.subtotal = subtotal;
  modal.dataset.tax = tax;
}

async function completeLoanSale(customerName, customerPhone, notes) {
  const modal = document.getElementById('loanModal');
  const total = parseFloat(modal.dataset.total);
  const subtotal = parseFloat(modal.dataset.subtotal);
  const tax = parseFloat(modal.dataset.tax);
  
  // Generate unique receipt number
  const receiptNumber = generateReceiptNumber();
  
  // Create the sale first
  const saleData = {
    subtotal,
    tax,
    discount: 0,
    total,
    paymentMethod: 'loan',
    cashierId: currentUser.id,
    items: cart
  };
  
  try {
    const sale = await window.api.createSale(saleData);
    
    // Create the loan record
    const loanData = {
      receiptNumber,
      customerName,
      customerPhone,
      saleId: sale.id,
      loanAmount: total,
      cashierId: currentUser.id,
      notes: notes || null
    };
    
    const loan = await window.api.createLoan(loanData);
    
    // Show loan receipt
    showLoanReceipt(sale, loan);
    
    // Clear cart
    cart = [];
    updateCartDisplay();
    
    // Close loan modal
    modal.classList.remove('active');
    
    // Reload products
    await loadAllProducts();
    displayQuickProducts();
  } catch (error) {
    alert('Error creating loan: ' + error.message);
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
  
  const date = new Date(sale.sale_date);
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
  const currencySymbol = systemSettings?.currency_symbol || '$';
  const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';
  const taxRate = (systemSettings?.tax_rate || 0.10) * 100;
  
  content.innerHTML = `
    <div class="receipt-header">
      <h2>${storeName}</h2>
      <h3 style="color: #6E8FAF;">LOAN RECEIPT</h3>
      <p>Receipt #${loan.receipt_number}</p>
      <p>${date.toLocaleString()}</p>
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
        <span>LOAN AMOUNT:</span>
        <span>${currencySymbol}${sale.total.toFixed(2)}</span>
      </div>
    </div>
    
    <div class="loan-info" style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 8px;">
      <p><strong>Customer:</strong> ${loan.customer_name}</p>
      <p><strong>Phone:</strong> ${loan.customer_phone}</p>
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

async function searchLoanByReceipt(receiptNumber) {
  if (!receiptNumber || receiptNumber.trim() === '') {
    alert('Please enter a receipt number');
    return;
  }
  
  try {
    const loan = await window.api.getLoanByReceipt(receiptNumber);
    
    if (!loan) {
      alert('Loan not found with this receipt number');
      return;
    }
    
    if (loan.status === 'paid') {
      alert('This loan has already been paid in full');
      return;
    }
    
    // Show loan payment modal
    showLoanPaymentModal(loan);
  } catch (error) {
    alert('Error searching for loan: ' + error.message);
  }
}

function showLoanPaymentModal(loan) {
  const modal = document.getElementById('loanPaymentModal');
  const content = document.getElementById('loanPaymentContent');
  
  const loanDate = new Date(loan.loan_date);
  
  content.innerHTML = `
    <div class="loan-payment-info">
      <h3>Loan Details</h3>
      <div class="loan-detail-row">
        <span>Receipt #:</span>
        <span><strong>${loan.receipt_number}</strong></span>
      </div>
      <div class="loan-detail-row">
        <span>Customer:</span>
        <span>${loan.customer_name}</span>
      </div>
      <div class="loan-detail-row">
        <span>Phone:</span>
        <span>${loan.customer_phone}</span>
      </div>
      <div class="loan-detail-row">
        <span>Loan Date:</span>
        <span>${loanDate.toLocaleDateString()}</span>
      </div>
      <div class="loan-detail-row" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #ddd;">
        <span>Total Loan:</span>
        <span><strong>$${loan.loan_amount.toFixed(2)}</strong></span>
      </div>
      <div class="loan-detail-row">
        <span>Paid Amount:</span>
        <span>$${loan.paid_amount.toFixed(2)}</span>
      </div>
      <div class="loan-detail-row" style="font-size: 18px; color: #d9534f;">
        <span><strong>Remaining:</strong></span>
        <span><strong>$${loan.remaining_amount.toFixed(2)}</strong></span>
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
    
    await completeLoanPayment(loan.id, amount, method);
  });
  
  modal.classList.add('active');
}

async function completeLoanPayment(loanId, amount, paymentMethod) {
  try {
    const paymentData = {
      amount,
      paymentMethod,
      cashierId: currentUser.id
    };
    
    const result = await window.api.payLoan(loanId, paymentData);
    
    // If cash payment, open cash drawer
    if (paymentMethod === 'cash') {
      openCashDrawer();
    }
    
    // Close payment modal
    document.getElementById('loanPaymentModal').classList.remove('active');
    
    // Show success message
    if (result.status === 'paid') {
      showAlert('Loan has been paid in full.\nThank you for your payment!', 'success', 'Payment Successful');
    } else if (result.status === 'partial') {
      showAlert(`Amount Paid: $${amount.toFixed(2)}\nRemaining Balance: $${result.remaining_amount.toFixed(2)}\n\nThank you!`, 'success', 'Partial Payment Received');
    }
    
    // Reload loans view if it's active
    if (document.getElementById('loansView').classList.contains('active')) {
      await loadLoansView();
    }
  } catch (error) {
    alert('Error processing payment: ' + error.message);
  }
}

async function loadLoansView(status = null) {
  const loans = await window.api.getAllLoans(status);
  const tbody = document.querySelector('#loansTable tbody');
  
  if (loans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="icon">💳</div><p>No loans found</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = loans.map(loan => {
    const loanDate = new Date(loan.loan_date);
    let statusClass = 'status-pending';
    if (loan.status === 'paid') statusClass = 'status-paid';
    else if (loan.status === 'partial') statusClass = 'status-partial';
    
    return `
      <tr>
        <td>${loan.receipt_number}</td>
        <td>${loan.customer_name}</td>
        <td>${loan.customer_phone}</td>
        <td>$${loan.loan_amount.toFixed(2)}</td>
        <td>$${loan.paid_amount.toFixed(2)}</td>
        <td>$${loan.remaining_amount.toFixed(2)}</td>
        <td><span class="status-badge ${statusClass}">${loan.status.toUpperCase()}</span></td>
        <td>${loanDate.toLocaleDateString()}</td>
        <td>
          ${loan.status !== 'paid' ? `<button class="btn-action" onclick="searchLoanByReceipt('${loan.receipt_number}')">Pay</button>` : '-'}
        </td>
      </tr>
    `;
  }).join('');
}

// ============== PRODUCTS VIEW ==============
function setupProductHandlers() {
  document.getElementById('addProductBtn')?.addEventListener('click', () => {
    openProductModal();
  });
  
  document.getElementById('productSearch')?.addEventListener('input', (e) => {
    filterProducts(e.target.value);
  });
  
  document.getElementById('productForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProduct();
  });
}

async function loadProductsView() {
  allProducts = await window.api.getAllProducts();
  displayProducts(allProducts);
}

function displayProducts(products) {
  const tbody = document.querySelector('#productsTable tbody');
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="icon">📦</div><p>No products found</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = products.map(product => {
    let statusClass = 'status-in-stock';
    let statusText = 'In Stock';
    
    if (product.stock === 0) {
      statusClass = 'status-out-of-stock';
      statusText = 'Out of Stock';
    } else if (product.stock <= product.min_stock) {
      statusClass = 'status-low-stock';
      statusText = 'Low Stock';
    }
    
    const hasDiscount = product.sale_price || product.discount_percent > 0;
    const priceDisplay = hasDiscount 
      ? `<span style="text-decoration: line-through; color: #999;">${currencySymbol}${(product.regular_price || product.price).toFixed(2)}</span> <span style="color: #e53e3e; font-weight: 700;">${currencySymbol}${product.price.toFixed(2)}</span>`
      : `${currencySymbol}${product.price.toFixed(2)}`;
    
    const taxDisplay = product.tax_rate === 0.07 ? '7%' : '19%';
    
    return `
      <tr>
        <td>${product.barcode}</td>
        <td>${product.name}</td>
        <td>${product.category || 'General'}</td>
        <td>${priceDisplay}</td>
        <td>${taxDisplay}</td>
        <td>${product.stock}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>
          <button class="action-btn" onclick="editProduct(${product.id})" title="Edit">✏️</button>
          <button class="action-btn" onclick="deleteProduct(${product.id})" title="Delete">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterProducts(query) {
  if (!query) {
    displayProducts(allProducts);
  } else {
    const filtered = allProducts.filter(p => 
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.barcode.includes(query) ||
      (p.category && p.category.toLowerCase().includes(query.toLowerCase()))
    );
    displayProducts(filtered);
  }
}

function openProductModal(product = null) {
  const modal = document.getElementById('productModal');
  const form = document.getElementById('productForm');
  const title = document.getElementById('productModalTitle');
  
  if (product) {
    title.textContent = 'Edit Product';
    document.getElementById('productId').value = product.id;
    document.getElementById('productBarcode').value = product.barcode;
    document.getElementById('productName').value = product.name;
    document.getElementById('productDescription').value = product.description || '';
    document.getElementById('productCategory').value = product.category || 'General';
    document.getElementById('productTaxRate').value = product.tax_rate || 0.19;
    document.getElementById('productRegularPrice').value = product.regular_price || product.price;
    document.getElementById('productSalePrice').value = product.sale_price || '';
    document.getElementById('productDiscountPercent').value = product.discount_percent || 0;
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productCost').value = product.cost || '';
    document.getElementById('productStock').value = product.stock;
    document.getElementById('productMinStock').value = product.min_stock;
    
    // Generate and display barcode
    generateBarcodeDisplay(product.barcode);
    
    // Show print barcode button when editing
    document.getElementById('printBarcodeBtn').style.display = 'block';
  } else {
    title.textContent = 'Add Product';
    form.reset();
    document.getElementById('productId').value = '';
    document.getElementById('productTaxRate').value = 0.19;
    document.getElementById('productCategory').value = 'General';
    
    // Clear barcode display
    const barcodeDisplay = document.getElementById('barcodeDisplay');
    if (barcodeDisplay) barcodeDisplay.innerHTML = '';
    
    // Hide print barcode button when adding new product
    document.getElementById('printBarcodeBtn').style.display = 'none';
  }
  
  // Setup price calculation
  setupPriceCalculation();
  
  modal.classList.add('active');
}

function setupPriceCalculation() {
  const regularPriceInput = document.getElementById('productRegularPrice');
  const salePriceInput = document.getElementById('productSalePrice');
  const discountInput = document.getElementById('productDiscountPercent');
  const finalPriceInput = document.getElementById('productPrice');
  
  const calculateFinalPrice = () => {
    const regularPrice = parseFloat(regularPriceInput.value) || 0;
    const salePrice = parseFloat(salePriceInput.value) || null;
    const discountPercent = parseFloat(discountInput.value) || 0;
    
    let finalPrice = regularPrice;
    if (salePrice) {
      finalPrice = salePrice;
    } else if (discountPercent > 0) {
      finalPrice = regularPrice * (1 - discountPercent / 100);
    }
    
    finalPriceInput.value = finalPrice.toFixed(2);
  };
  
  regularPriceInput?.addEventListener('input', calculateFinalPrice);
  salePriceInput?.addEventListener('input', calculateFinalPrice);
  discountInput?.addEventListener('input', calculateFinalPrice);
  
  // Initial calculation
  calculateFinalPrice();
}

async function editProduct(id) {
  const product = allProducts.find(p => p.id === id);
  if (product) {
    openProductModal(product);
  }
}

async function deleteProduct(id) {
  if (confirm('Are you sure you want to delete this product?')) {
    await window.api.deleteProduct(id);
    await loadProductsView();
  }
}

async function saveProduct() {
  const id = document.getElementById('productId').value;
  const regularPrice = parseFloat(document.getElementById('productRegularPrice').value);
  const salePrice = parseFloat(document.getElementById('productSalePrice').value) || null;
  const discountPercent = parseFloat(document.getElementById('productDiscountPercent').value) || 0;
  
  // Calculate final price
  let finalPrice = regularPrice;
  if (salePrice) {
    finalPrice = salePrice;
  } else if (discountPercent > 0) {
    finalPrice = regularPrice * (1 - discountPercent / 100);
  }
  
  const product = {
    barcode: document.getElementById('productBarcode').value,
    name: document.getElementById('productName').value,
    description: document.getElementById('productDescription').value,
    category: document.getElementById('productCategory').value,
    regular_price: regularPrice,
    sale_price: salePrice,
    discount_percent: discountPercent,
    price: finalPrice,
    tax_rate: parseFloat(document.getElementById('productTaxRate').value),
    cost: parseFloat(document.getElementById('productCost').value) || 0,
    stock: parseInt(document.getElementById('productStock').value),
    min_stock: parseInt(document.getElementById('productMinStock').value) || 5
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
    showAlert('Product saved successfully!', 'success', 'Success');
  } catch (error) {
    showAlert('Error saving product: ' + error.message, 'error', 'Error');
  }
}

// ============== SALES VIEW ==============
async function loadSalesView() {
  const today = await window.api.getTodaySales();
  
  // Display summary
  const summaryDiv = document.getElementById('todaySummary');
  summaryDiv.innerHTML = `
    Today's Sales: <strong>${today.summary.transaction_count}</strong> transactions | 
    Total: <strong>$${(today.summary.total_sales || 0).toFixed(2)}</strong>
  `;
  
  // Display sales table
  const tbody = document.querySelector('#salesTable tbody');
  
  if (today.sales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="icon">💰</div><p>No sales today</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = today.sales.map(sale => {
    const date = new Date(sale.sale_date);
    const itemCount = sale.id; // Would need to query items for actual count
    
    return `
      <tr>
        <td>${date.toLocaleString()}</td>
        <td>-</td>
        <td>$${sale.subtotal.toFixed(2)}</td>
        <td>$${sale.tax.toFixed(2)}</td>
        <td>$${sale.total.toFixed(2)}</td>
        <td>${sale.payment_method}</td>
        <td>
          <button class="action-btn" onclick="viewSale(${sale.id})" title="View">👁️</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function viewSale(id) {
  const sale = await window.api.getSaleById(id);
  showReceipt(sale);
}

// ============== REPORTS VIEW ==============
function loadReportsView() {
  // Load Z-Reports by default
  loadZReportsView();
  
  // Set default dates for sales reports
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  
  document.getElementById('reportStartDate').value = startDate.toISOString().split('T')[0];
  document.getElementById('reportEndDate').value = endDate.toISOString().split('T')[0];
  
  const generateSalesReportBtn = document.getElementById('generateSalesReportBtn');
  if (generateSalesReportBtn) {
    generateSalesReportBtn.onclick = async () => {
      const start = document.getElementById('reportStartDate').value;
      const end = document.getElementById('reportEndDate').value;
      
      if (!start || !end) {
        alert('Please select date range');
        return;
      }
      
      const report = await window.api.getSalesReport(start, end);
      displayReport(report);
    };
  }
}

function displayReport(report) {
  const container = document.getElementById('reportResults');
  
  const totalSales = report.sales.reduce((sum, day) => sum + (day.total_sales || 0), 0);
  const totalTransactions = report.sales.reduce((sum, day) => sum + day.transaction_count, 0);
  
  container.innerHTML = `
    <div class="report-section">
      <h3>Summary</h3>
      <p><strong>Total Sales:</strong> $${totalSales.toFixed(2)}</p>
      <p><strong>Total Transactions:</strong> ${totalTransactions}</p>
      <p><strong>Average Transaction:</strong> $${(totalSales / totalTransactions || 0).toFixed(2)}</p>
    </div>
    
    <div class="report-section">
      <h3>Daily Breakdown</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Transactions</th>
            <th>Total Sales</th>
            <th>Tax</th>
          </tr>
        </thead>
        <tbody>
          ${report.sales.map(day => `
            <tr>
              <td>${day.date}</td>
              <td>${day.transaction_count}</td>
              <td>$${(day.total_sales || 0).toFixed(2)}</td>
              <td>$${(day.tax || 0).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div class="report-section">
      <h3>Top Products</h3>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity Sold</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${report.topProducts.map(product => `
            <tr>
              <td>${product.product_name}</td>
              <td>${product.total_quantity}</td>
              <td>$${product.total_revenue.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============== INVENTORY VIEW ==============
async function loadInventoryView() {
  const inventory = await window.api.getInventoryReport();
  const tbody = document.querySelector('#inventoryTable tbody');
  
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
        <td>$${item.inventory_value.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
  
  // Calculate total inventory value
  const totalValue = inventory.reduce((sum, item) => sum + item.inventory_value, 0);
  const row = tbody.insertRow();
  row.innerHTML = `
    <td colspan="5" style="text-align: right; font-weight: bold;">Total Inventory Value:</td>
    <td style="font-weight: bold;">$${totalValue.toFixed(2)}</td>
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
    const canDelete = user.id !== currentUser.id; // Can't delete self
    
    return `
      <tr>
        <td>${user.username}</td>
        <td>${user.full_name}</td>
        <td><span class="role-badge ${user.role}">${user.role}</span></td>
        <td>${date.toLocaleDateString()}</td>
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
}

async function editUser(id) {
  const user = await window.api.getUserById(id);
  if (user) {
    openUserModal(user);
  }
}

async function deleteUser(id) {
  if (id === currentUser.id) {
    alert('You cannot delete your own account');
    return;
  }
  
  if (confirm('Are you sure you want to delete this user?')) {
    await window.api.deleteUser(id);
    await loadUsersView();
  }
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
      await window.api.updateUser(parseInt(id), user);
    } else {
      // Add new user
      user.password = document.getElementById('userPassword').value;
      await window.api.addUser(user);
    }
    
    closeModal('userModal');
    await loadUsersView();
  } catch (error) {
    alert('Error saving user: ' + error.message);
  }
}

function changeUserPassword(id) {
  const modal = document.getElementById('passwordModal');
  document.getElementById('passwordUserId').value = id;
  document.getElementById('passwordForm').reset();
  modal.classList.add('active');
}

async function changePassword() {
  const id = document.getElementById('passwordUserId').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  if (newPassword !== confirmPassword) {
    alert('Passwords do not match');
    return;
  }
  
  if (newPassword.length < 6) {
    alert('Password must be at least 6 characters');
    return;
  }
  
  try {
    await window.api.updateUserPassword(parseInt(id), newPassword);
    closeModal('passwordModal');
    alert('Password updated successfully');
  } catch (error) {
    alert('Error updating password: ' + error.message);
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
    
    // Update logo preview
    const logoPreviewText = document.getElementById('logoPreviewText');
    if (systemSettings.store_logo && systemSettings.store_logo.startsWith('data:image')) {
      // Image
      logoPreviewText.innerHTML = `<img src=\"${systemSettings.store_logo}\" style=\"width: 80px; height: 80px; object-fit: contain;\" />`;
    } else {
      // Emoji or text
      logoPreviewText.textContent = systemSettings.store_logo || '\ud83d\uded2';
    }
    
    document.getElementById('currencySymbol').value = systemSettings.currency_symbol || '';
    document.getElementById('currencyCode').value = systemSettings.currency_code || '';
    document.getElementById('taxRate').value = (systemSettings.tax_rate * 100) || 0;
    document.getElementById('receiptFooter').value = systemSettings.receipt_footer || '';
  } catch (error) {
    alert('Error loading settings: ' + error.message);
  }
}

function setupSystemSettingsHandlers() {
  document.getElementById('systemSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSystemSettings();
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
    
    const settings = {
      storeName: document.getElementById('storeName').value,
      storeLogo: logoValue,
      currencySymbol: document.getElementById('currencySymbol').value,
      currencyCode: document.getElementById('currencyCode').value,
      taxRate: parseFloat(document.getElementById('taxRate').value) / 100,
      receiptFooter: document.getElementById('receiptFooter').value
    };
    
    systemSettings = await window.api.updateSystemSettings(settings);
    showAlert('Your system settings have been updated successfully!\n\nChanges will be applied to all receipts and the interface.', 'success', 'Settings Saved');
    
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
  // Loan form submit
  document.getElementById('loanForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const customerName = document.getElementById('loanCustomerName').value;
    const customerPhone = document.getElementById('loanCustomerPhone').value;
    const notes = document.getElementById('loanNotes').value;
    
    await completeLoanSale(customerName, customerPhone, notes);
    
    // Reset form
    e.target.reset();
  });
  
  // Search loan button
  document.getElementById('searchLoanBtn')?.addEventListener('click', () => {
    const receiptNumber = document.getElementById('loanReceiptSearch').value;
    searchLoanByReceipt(receiptNumber);
  });
  
  // Loan receipt search - allow Enter key
  document.getElementById('loanReceiptSearch')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const receiptNumber = e.target.value;
      searchLoanByReceipt(receiptNumber);
    }
  });
  
  // Loan filter tabs
  document.querySelectorAll('.loan-filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.loan-filter-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      
      const status = e.target.dataset.status;
      loadLoansView(status === 'all' ? null : status);
    });
  });
}

// ============== MODALS ==============
function setupModalHandlers() {
  // Close buttons
  document.querySelectorAll('.close, .cancel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) {
        closeModal(modal.id);
      }
    });
  });
  
  // Close on outside click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
  });
  
  // Print receipt
  document.getElementById('printReceiptBtn')?.addEventListener('click', () => {
    window.print();
  });
  
  // Setup virtual keyboard
  setupVirtualKeyboard();
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// ============== VIRTUAL KEYBOARD ==============
let currentKeyboardInput = null;

function setupVirtualKeyboard() {
  const keyboard = document.getElementById('virtualKeyboard');
  const keyboardDisplay = document.getElementById('keyboardDisplay');
  const closeKeyboardBtn = document.getElementById('closeKeyboard');
  const keyButtons = document.querySelectorAll('.key-btn');
  
  // Initialize keyboard in lowercase mode
  keyButtons.forEach(btn => {
    const key = btn.dataset.key;
    if (key && key.length === 1 && /[A-Z]/.test(key)) {
      btn.textContent = key.toLowerCase();
    }
  });
  
  // Show keyboard when text inputs are focused (except barcode input)
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' && 
        (e.target.type === 'text' || e.target.type === 'tel') && 
        e.target.id !== 'barcodeInput' &&
        e.target.id !== 'keyboardDisplay' &&
        e.target.id !== 'paymentAmount') {
      currentKeyboardInput = e.target;
      keyboardDisplay.value = e.target.value;
      keyboard.classList.add('active');
    }
    if (e.target.tagName === 'TEXTAREA') {
      currentKeyboardInput = e.target;
      keyboardDisplay.value = e.target.value;
      keyboard.classList.add('active');
    }
  });
  
  // Handle key presses
  keyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      
      if (key === 'Backspace') {
        keyboardDisplay.value = keyboardDisplay.value.slice(0, -1);
      } else if (key === 'Done') {
        if (currentKeyboardInput) {
          currentKeyboardInput.value = keyboardDisplay.value;
          currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        keyboard.classList.remove('active');
        currentKeyboardInput = null;
      } else if (key !== 'Shift') {
        // Use lowercase letters always
        const actualKey = btn.textContent === 'Space' ? ' ' : btn.textContent;
        keyboardDisplay.value += actualKey;
      }
      
      // Update the original input in real-time
      if (currentKeyboardInput) {
        currentKeyboardInput.value = keyboardDisplay.value;
      }
    });
  });
  
  // Close keyboard button
  closeKeyboardBtn.addEventListener('click', () => {
    if (currentKeyboardInput) {
      currentKeyboardInput.value = keyboardDisplay.value;
      currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    keyboard.classList.remove('active');
    currentKeyboardInput = null;
  });
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
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  if (returns.length === 0) {
    tbody.innerHTML = '<tr><td colspan=\"7\" class=\"empty-state\"><div class=\"icon\">↩️</div><p>No returns processed</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = returns.map(ret => {
    const date = new Date(ret.return_date);
    const items = ret.items ? JSON.parse(ret.items) : [];
    const itemCount = items.length;
    
    return `
      <tr>
        <td>${date.toLocaleString()}</td>
        <td>#${ret.original_sale_id}</td>
        <td>${itemCount} item(s)</td>
        <td>${currencySymbol}${ret.total.toFixed(2)}</td>
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
    
    currentReturnSale = sale;
    selectedReturnItems = [];
    
    // Display sale items
    const itemsList = document.getElementById('returnItemsList');
    const currencySymbol = systemSettings?.currency_symbol || '$';
    
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
  let subtotal = 0;
  let tax = 0;
  
  checkboxes.forEach(checkbox => {
    const index = parseInt(checkbox.dataset.index);
    const item = currentReturnSale.items[index];
    selectedReturnItems.push(item);
    subtotal += item.subtotal;
    
    // Calculate tax for this item (find product to get tax rate)
    const product = allProducts.find(p => p.id === item.product_id);
    const taxRate = product?.tax_rate || 0.19;
    tax += item.subtotal * taxRate;
  });
  
  const total = subtotal + tax;
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  document.getElementById('returnTotalDisplay').value = `${currencySymbol}${total.toFixed(2)}`;
}

async function completeReturn() {
  if (selectedReturnItems.length === 0) {
    showAlert('Please select at least one item to return', 'warning', 'No Items Selected');
    return;
  }
  
  const subtotal = selectedReturnItems.reduce((sum, item) => sum + item.subtotal, 0);
  let tax = 0;
  
  // Calculate tax for selected items
  selectedReturnItems.forEach(item => {
    const product = allProducts.find(p => p.id === item.product_id);
    const taxRate = product?.tax_rate || 0.19;
    tax += item.subtotal * taxRate;
  });
  
  const total = subtotal + tax;
  
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
    showAlert(`Return processed successfully!\\nRefund amount: ${systemSettings?.currency_symbol || '$'}${total.toFixed(2)}`, 'success', 'Return Completed');
    await loadReturnsView();
  } catch (error) {
    showAlert('Error processing return: ' + error.message, 'error', 'Error');
  }
}

async function viewReturnDetails(returnId) {
  const returnRecord = await window.api.getReturnById(returnId);
  if (returnRecord) {
    // Could show a detailed modal here
    showAlert(`Return Details:\\nDate: ${new Date(returnRecord.return_date).toLocaleString()}\\nAmount: ${systemSettings?.currency_symbol || '$'}${returnRecord.total.toFixed(2)}\\nReason: ${returnRecord.reason}`, 'info', 'Return Information');
  }
}

// ============== Z-REPORT HANDLERS ==============
let currentZReportData = null;

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
      await openZReportModal();
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
    tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #94a3b8;">No Z-reports found</td></tr>';
    return;
  }
  
  const currencySymbol = systemSettings?.currency_symbol || '€';
  
  zReports.forEach(report => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${report.report_number}</td>
      <td>${new Date(report.report_date).toLocaleDateString()}</td>
      <td>${report.cashier_name}</td>
      <td>${report.total_sales}</td>
      <td>${report.total_returns}</td>
      <td>${currencySymbol}${report.net_sales.toFixed(2)}</td>
      <td>${currencySymbol}${report.cash_sales.toFixed(2)}</td>
      <td>${currencySymbol}${report.card_sales.toFixed(2)}</td>
      <td>${currencySymbol}${report.loan_sales.toFixed(2)}</td>
      <td>${currencySymbol}${report.total_tax.toFixed(2)}</td>
      <td>
        <button class="btn-action" onclick="viewZReportDetails(${report.id})" title="View Details">👁️</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function openZReportModal() {
  try {
    // Calculate report data
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    const startDateTime = todayStart.toISOString();
    const endDateTime = todayEnd.toISOString();
    
    // Get sales and returns for today
    const sales = await window.api.getSalesByDateRange(startDateTime, endDateTime, currentUser.id);
    const returns = await window.api.getReturnsByDateRange(startDateTime, endDateTime, currentUser.id);
    
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
    
    // Calculate totals
    const totalSales = sales.length;
    const totalReturns = returns.length;
    const netSalesCount = totalSales - totalReturns;
    
    const grossSales = sales.reduce((sum, sale) => sum + sale.total, 0);
    const totalReturnsAmount = returns.reduce((sum, ret) => sum + ret.total, 0);
    const netSales = grossSales - totalReturnsAmount;
    
    // Calculate payment methods
    const cashSales = sales.filter(s => s.payment_method === 'Cash').reduce((sum, s) => sum + s.total, 0);
    const cardSales = sales.filter(s => s.payment_method === 'Card').reduce((sum, s) => sum + s.total, 0);
    const loanSales = sales.filter(s => s.payment_method === 'Loan').reduce((sum, s) => sum + s.total, 0);
    
    // Calculate tax breakdown (7% and 19%)
    let tax7Base = 0;
    let tax7Amount = 0;
    let tax19Base = 0;
    let tax19Amount = 0;
    
    sales.forEach(sale => {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const product = allProducts.find(p => p.id === item.product_id);
          const taxRate = product?.tax_rate || 0.19;
          const itemSubtotal = item.subtotal || (item.quantity * item.unit_price);
          const itemTax = itemSubtotal * taxRate;
          
          if (taxRate === 0.07) {
            tax7Base += itemSubtotal;
            tax7Amount += itemTax;
          } else {
            tax19Base += itemSubtotal;
            tax19Amount += itemTax;
          }
        });
      }
    });
    
    const totalTax = tax7Amount + tax19Amount;
    
    // Cash reconciliation - cash sales minus cash refunds
    const cashReturns = returns.filter(r => r.refund_method === 'Cash').reduce((sum, r) => sum + r.total, 0);
    const expectedCash = cashSales - cashReturns;
    
    // Store report data
    currentZReportData = {
      start_datetime: startDateTime,
      end_datetime: endDateTime,
      cashier_id: currentUser.id,
      cashier_name: currentUser.full_name,
      total_sales: totalSales,
      total_returns: totalReturns,
      net_sales_count: netSalesCount,
      gross_sales: grossSales,
      total_returns_amount: totalReturnsAmount,
      net_sales: netSales,
      cash_sales: cashSales,
      card_sales: cardSales,
      loan_sales: loanSales,
      tax_7_base: tax7Base,
      tax_7_amount: tax7Amount,
      tax_19_base: tax19Base,
      tax_19_amount: tax19Amount,
      total_tax: totalTax,
      expected_cash: expectedCash
    };
    
    const currencySymbol = systemSettings?.currency_symbol || '€';
    
    // Populate modal
    document.getElementById('zReportPeriod').textContent = `${todayStart.toLocaleDateString()} - ${todayEnd.toLocaleTimeString()}`;
    document.getElementById('zReportTotalSales').textContent = totalSales;
    document.getElementById('zReportTotalReturns').textContent = totalReturns;
    document.getElementById('zReportNetCount').textContent = netSalesCount;
    
    document.getElementById('zReportGrossSales').textContent = `${currencySymbol}${grossSales.toFixed(2)}`;
    document.getElementById('zReportReturnsAmount').textContent = `${currencySymbol}${totalReturnsAmount.toFixed(2)}`;
    document.getElementById('zReportNetSales').textContent = `${currencySymbol}${netSales.toFixed(2)}`;
    
    document.getElementById('zReportCash').textContent = `${currencySymbol}${cashSales.toFixed(2)}`;
    document.getElementById('zReportCard').textContent = `${currencySymbol}${cardSales.toFixed(2)}`;
    document.getElementById('zReportLoan').textContent = `${currencySymbol}${loanSales.toFixed(2)}`;
    
    document.getElementById('zReportTax7Base').textContent = `${currencySymbol}${tax7Base.toFixed(2)}`;
    document.getElementById('zReportTax7Amount').textContent = `${currencySymbol}${tax7Amount.toFixed(2)}`;
    document.getElementById('zReportTax19Base').textContent = `${currencySymbol}${tax19Base.toFixed(2)}`;
    document.getElementById('zReportTax19Amount').textContent = `${currencySymbol}${tax19Amount.toFixed(2)}`;
    document.getElementById('zReportTotalTax').textContent = `${currencySymbol}${totalTax.toFixed(2)}`;
    
    document.getElementById('zReportExpectedCash').value = `${currencySymbol}${expectedCash.toFixed(2)}`;
    document.getElementById('zReportActualCash').value = '';
    document.getElementById('zReportDifference').value = '';
    document.getElementById('zReportNotes').value = '';
    
    openModal('zReportModal');
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

async function completeZReport() {
  if (!currentZReportData) {
    showAlert('No report data available', 'error', 'Error');
    return;
  }
  
  const actualCash = parseFloat(document.getElementById('zReportActualCash').value);
  if (isNaN(actualCash)) {
    showAlert('Please enter the actual cash count', 'warning', 'Missing Information');
    return;
  }
  
  const cashDifference = actualCash - currentZReportData.expected_cash;
  
  const reportData = {
    ...currentZReportData,
    report_number: `Z${Date.now()}`,
    actual_cash: actualCash,
    cash_difference: cashDifference,
    notes: document.getElementById('zReportNotes').value || null
  };
  
  try {
    const result = await window.api.createZReport(reportData);
    closeModal('zReportModal');
    showAlert('Z-Report completed successfully!', 'success', 'Report Complete');
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
            <span class="summary-value">${new Date(report.report_date).toLocaleString()}</span>
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
            <span class="summary-value">${report.total_sales}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Total Returns:</span>
            <span class="summary-value">${report.total_returns}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Net Sales Count:</span>
            <span class="summary-value">${report.net_sales_count}</span>
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
        </div>
      </div>

      <div class="z-report-section">
        <h4>Payment Methods</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Cash:</span>
            <span class="summary-value">${currencySymbol}${report.cash_sales.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Card:</span>
            <span class="summary-value">${currencySymbol}${report.card_sales.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Loan:</span>
            <span class="summary-value">${currencySymbol}${report.loan_sales.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div class="z-report-section">
        <h4>Tax Breakdown (German VAT)</h4>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">7% Tax Base:</span>
            <span class="summary-value">${currencySymbol}${report.tax_7_base.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">7% Tax Amount:</span>
            <span class="summary-value">${currencySymbol}${report.tax_7_amount.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">19% Tax Base:</span>
            <span class="summary-value">${currencySymbol}${report.tax_19_base.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">19% Tax Amount:</span>
            <span class="summary-value">${currencySymbol}${report.tax_19_amount.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Total Tax:</span>
            <span class="summary-value">${currencySymbol}${report.total_tax.toFixed(2)}</span>
          </div>
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
            <span class="summary-value">${currencySymbol}${report.actual_cash ? report.actual_cash.toFixed(2) : 'N/A'}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Difference:</span>
            <span class="summary-value" style="color: ${report.cash_difference < 0 ? 'red' : (report.cash_difference > 0 ? 'green' : 'black')}">${currencySymbol}${report.cash_difference ? report.cash_difference.toFixed(2) : 'N/A'}</span>
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
  } catch (error) {
    console.error('Error loading Z-report details:', error);
    showAlert('Error loading report details: ' + error.message, 'error', 'Error');
  }
}

// ============== UTILITIES ==============
function updateDateTime() {
  const now = new Date();
  const dateTimeStr = now.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
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

// Generate barcode visual display
function generateBarcodeDisplay(barcode) {
  const barcodeDisplay = document.getElementById('barcodeDisplay');
  if (!barcodeDisplay) return;
  
  // Create simple barcode representation using bars
  const bars = [];
  for (let i = 0; i < barcode.length; i++) {
    const digit = barcode[i];
    // Alternate between thick and thin bars based on digit
    const thickness = parseInt(digit) % 2 === 0 ? 'thick' : 'thin';
    bars.push(`<div class="barcode-bar ${thickness}"></div>`);
  }
  
  barcodeDisplay.innerHTML = `
    <div class="barcode-container">
      <div class="barcode-bars">
        ${bars.join('')}
      </div>
      <div class="barcode-number">${barcode}</div>
    </div>
  `;
}

// Customer Display Functions
async function updateCustomerDisplayData() {
  const currencySymbol = systemSettings?.currency_symbol || '€';
  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const tax = cart.reduce((sum, item) => {
    const itemTax = item.subtotal * (item.taxRate || 0.19);
    return sum + itemTax;
  }, 0);
  const total = subtotal + tax;

  const displayData = {
    items: cart,
    subtotal,
    tax,
    total,
    currencySymbol
  };

  try {
    await window.api.updateCustomerDisplay(displayData);
  } catch (error) {
    console.log('Customer display not open');
  }
}

async function toggleCustomerDisplay() {
  try {
    await window.api.openCustomerDisplay();
    showAlert('Customer display opened', 'success');
    updateCustomerDisplayData();
  } catch (error) {
    showAlert('Failed to open customer display', 'error');
  }
}

async function openCashDrawer() {
  try {
    const result = await window.api.openCashDrawer();
    if (result.success) {
      showAlert('Cash drawer opened', 'success');
    } else {
      showAlert('Failed to open cash drawer', 'error');
    }
  } catch (error) {
    showAlert('Error opening cash drawer', 'error');
  }
}

async function printBarcodeLabel(product) {
  try {
    const barcodeData = {
      barcode: product.barcode,
      name: product.name,
      price: product.price
    };
    const result = await window.api.printBarcodeLabel(barcodeData);
    if (result.success) {
      showAlert('Barcode label sent to printer', 'success');
    } else {
      showAlert('Failed to print barcode label', 'error');
    }
  } catch (error) {
    showAlert('Error printing barcode label', 'error');
  }
}

function printProductBarcode() {
  const productId = document.getElementById('productId').value;
  if (!productId) {
    showAlert('Please save the product first', 'warning');
    return;
  }
  
  const product = allProducts.find(p => p.id == productId);
  if (product) {
    printBarcodeLabel(product);
  }
}

// Override native alert
window.alert = showAlert;

// Make functions globally available
window.addToCart = addToCart;
window.updateCartQuantity = updateCartQuantity;
window.removeFromCart = removeFromCart;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.generateBarcodeDisplay = generateBarcodeDisplay;
window.viewSale = viewSale;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.changeUserPassword = changeUserPassword;
window.toggleCustomerDisplay = toggleCustomerDisplay;
window.openCashDrawer = openCashDrawer;
window.printBarcodeLabel = printBarcodeLabel;
window.printProductBarcode = printProductBarcode;
window.showAlert = showAlert;
window.viewZReportDetails = viewZReportDetails;
