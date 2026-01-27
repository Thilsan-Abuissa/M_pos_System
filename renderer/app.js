// Global state
let currentUser = null;
let cart = [];
let allProducts = [];
let allCategories = [];
let selectedPaymentMethod = null; // No default - must select payment method
let systemSettings = null; // System settings
let currentLogoData = ''; // Current logo data
let scaleConnected = false; // Scale connection status
let scalePort = null; // Currently connected scale port
let scaleDebugLogs = []; // Store debug logs
let scaleDebugVisible = false; // Debug panel visibility
let lastSale = null; // Store last sale for reprinting
let lastSalePaymentMethod = null; // Track payment method for drawer-open-on-print
let isWeightModalOpen = false; // Flag to prevent multiple modal opens

// Scale Debug Functions for Touchscreen
function addScaleDebugLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
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
  cashier: ['checkout', 'products', 'sales', 'reports', 'analytics', 'returns', 'inventory', 'loans', 'categories', 'settings'],
  manager: ['checkout', 'products', 'sales', 'reports', 'analytics', 'returns', 'inventory', 'loans', 'categories', 'settings'],
  admin: ['checkout', 'products', 'sales', 'reports', 'analytics', 'returns', 'inventory', 'loans', 'users', 'system', 'categories', 'settings']
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  showLoadingScreen();
});

function showLoadingScreen() {
  // Update loading screen with branding
  updateLoadingBranding();
  
  // Show loading screen for 3 seconds
  setTimeout(() => {
    // Hide loading screen and show login screen
    document.getElementById('loadingScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.add('active');
    
    // Initialize app after loading screen
    initializeApp();
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

function initializeApp() {
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
      button.addEventListener('click', () => selectUser(user));
      
      container.appendChild(button);
    });
  } catch (error) {
    console.error('Error loading user roles:', error);
    showAlert('Failed to load users', 'error');
  }
}

// ============== USER SELECTION ==============
function selectUser(user) {
  // Set current user
  currentUser = {
    id: user.id,
    username: user.username,
    role: user.role,
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
  currentUser = null;
  cart = [];
  showScreen('loginScreen');
  // Reload user roles when returning to login screen
  loadUserRoles();
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
    case 'analytics':
      if (hasPermission('reports')) loadAnalyticsView();
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
    case 'categories':
      if (hasPermission('categories')) loadCategoriesView();
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
      // Reload user roles when returning to login screen
      loadUserRoles();
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
  const productSearch = document.getElementById('productSearch');
  const checkoutBtn = document.getElementById('checkoutBtn');

  // Virtual Numpad handlers
  const numpadBtns = document.querySelectorAll('.numpad-btn');
  numpadBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      
      // Skip if no value (hidden buttons)
      if (!value) return;
      
      if (value === 'clear') {
        const paymentInput = document.getElementById('paymentInput');
        if (paymentInput) paymentInput.value = '';
        updateCartSummary();
      } else if (value === 'enter') {
        // Enter does nothing for payment numpad
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
        // Number or decimal - add to payment input
        const paymentInput = document.getElementById('paymentInput');
        if (paymentInput) {
          paymentInput.value += value;
          updateCartSummary();
        }
      }
    });
  });

  productSearch.addEventListener('input', (e) => {
    const searchQuery = e.target.value.trim();
    displayQuickProducts(searchQuery);
  });

  productSearch.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      await searchAndAddProduct(productSearch.value.trim());
      productSearch.value = '';
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
  await loadCategoryTabs();
  displayQuickProducts();
  updateCartDisplay();
}

async function loadCategoryTabs() {
  const categoryTabsContainer = document.getElementById('categoryTabs');
  const favoriteCategories = await window.api.getFavoriteCategories();
  
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
  
  // Create ALL button
  const allButton = document.createElement('button');
  allButton.className = 'category-tab active';
  allButton.setAttribute('data-category', 'all');
  allButton.textContent = 'ALL';
  allButton.style.backgroundColor = categoryColors[0];
  categoryTabsContainer.appendChild(allButton);
  
  // Add favorite categories (max 10)
  favoriteCategories.slice(0, 10).forEach((category, index) => {
    const button = document.createElement('button');
    button.className = 'category-tab';
    button.setAttribute('data-category', category.name);
    button.setAttribute('data-category-id', category.id);
    button.textContent = category.name.toUpperCase();
    
    // Assign color from array (cycling through colors if more than 10 categories)
    const colorIndex = (index + 1) % categoryColors.length;
    button.style.backgroundColor = categoryColors[colorIndex];
    
    categoryTabsContainer.appendChild(button);
  });
  
  // Setup double-click detection using event delegation
  setupCategoryTabListeners();
}

function setupCategoryTabListeners() {
  const categoryTabsContainer = document.getElementById('categoryTabs');
  if (!categoryTabsContainer) {
    console.error('Category tabs container not found!');
    return;
  }
  
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
        } else if (categoryId) {
          await loadSubcategoryFilters(parseInt(categoryId), categoryName);
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
  allProducts = await window.api.getAllProducts();
  allCategories = await window.api.getAllCategories();
}

let selectedCategory = 'all';

function displayQuickProducts(searchQuery = '', category = null, subcategory = null) {
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
  
  // Filter by subcategory if provided
  if (subcategory) {
    filteredProducts = filteredProducts.filter(p => p.subcategory === subcategory);
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
  
  container.innerHTML = filteredProducts.map(product => {
    // Use product image if available, otherwise use emoji icon
    let imageHtml = '';
    if (product.image && product.image.trim() !== '') {
      imageHtml = `<img src="${product.image}" alt="${product.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
    } else {
      imageHtml = productIcons[product.name] || '📦';
    }
    
    // Determine unit display
    const isWeightBased = product.unit_type === 'weight' || !product.unit_type;
    let unit;
    let amountInfo = '';
    
    if (isWeightBased) {
      const weightUnit = product.weight_unit || 'kg';
      unit = `/${weightUnit}`;
      // Show weight amount if available - add unit if not already included
      if (product.weight_amount) {
        const amount = product.weight_amount.trim();
        // Check if amount already includes unit (kg, g, etc.)
        const hasUnit = /\s*(kg|g|gram|kilogram)$/i.test(amount);
        const displayAmount = hasUnit ? amount : `${amount} ${weightUnit}`;
        amountInfo = `<div class="product-unit-info">${displayAmount}</div>`;
      }
    } else {
      const quantityUnit = product.quantity_unit || 'piece';
      unit = `/${quantityUnit}`;
      // Show quantity amount if available - add unit if not already included
      if (product.quantity_amount) {
        const amount = product.quantity_amount.trim();
        // Check if amount already includes unit
        const hasUnit = /\s*(piece|pack|box|bottle|can|bag|pc|pcs)s?$/i.test(amount);
        const displayAmount = hasUnit ? amount : `${amount} ${quantityUnit}`;
        amountInfo = `<div class="product-unit-info">${displayAmount}</div>`;
      }
    }
    
    return `
      <div class="quick-product-card" data-product-id="${product.id}">
        <div class="product-image">${imageHtml}</div>
        <div class="name">${product.name}</div>
        ${amountInfo}
        <div class="price">${currencySymbol}${product.price.toFixed(2)}</div>
      </div>
    `;
  }).join('');
  
  // Add event listeners for single click and double click
  setupProductCardListeners();
}

// ============== PRODUCT CARD CLICK HANDLERS ==============
function setupProductCardListeners() {
  const container = document.getElementById('quickProductsList');
  if (!container) return;
  
  let clickTimer = null;
  let clickedProductId = null;
  
  container.addEventListener('click', (e) => {
    const card = e.target.closest('.quick-product-card');
    if (!card) return;
    
    const productId = parseInt(card.dataset.productId);
    if (!productId) return;
    
    // If there's already a timer, this is a double-click
    if (clickTimer && clickedProductId === productId) {
      clearTimeout(clickTimer);
      clickTimer = null;
      clickedProductId = null;
      // Double-click: edit product
      handleDoubleClick(productId);
    } else {
      // First click: set timer for single-click action
      clickedProductId = productId;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        clickedProductId = null;
        // Single-click: add to cart
        promptForWeight(productId);
      }, 250); // 250ms delay to detect double-click
    }
  });
}

function handleDoubleClick(productId) {
  // Check if user has permission to edit products
  if (!hasPermission('products')) {
    showAlert('Access Denied: You do not have permission to edit products', 'error', 'Access Denied');
    return;
  }
  
  // Open edit modal
  editProduct(productId);
}

// ============== WEIGHT PROMPT ==============
function promptForWeight(productId) {
  // Prevent opening multiple modals
  if (isWeightModalOpen) {
    console.log('Weight modal already open, ignoring duplicate call');
    return;
  }
  
  console.log('promptForWeight called with productId:', productId);
  const product = allProducts.find(p => p.id === productId);
  console.log('Product found:', product);
  if (!product) {
    console.log('Product not found!');
    return;
  }
  
  // Set flag to prevent duplicate opens
  isWeightModalOpen = true;
  
  const currencySymbol = systemSettings?.currency_symbol || '$';
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

  // Display unit for weight mode
  let weightUnit = 'kg'; // 'kg' | 'g'

  // Unit price used to derive totals when weight/qty changes.
  // When the user edits the total price field, we update this.
  let lockedUnitPrice = product.price;

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
    const hasDecimal = /[\.,]/.test(numericPart);
    const rawValue = parseFloat(numericPart.replace(',', '.'));
    if (!Number.isFinite(rawValue)) return NaN;

    // If the user explicitly typed a unit, honor it.
    if (unit === 'kg') return rawValue;
    if (unit === 'g') return rawValue / 1000;

    // If user typed a decimal, assume kilograms.
    if (hasDecimal) return rawValue;

    // If UI is in grams, convert grams -> kg.
    if (weightUnit === 'g') return rawValue / 1000;

    // Heuristic: large whole numbers are likely grams (e.g. 500 = 500g).
    if (rawValue >= 100) return rawValue / 1000;

    return rawValue;
  }
  
  productNameEl.textContent = product.name;
  modal.style.display = 'flex';
  
  // Function to update UI based on mode
  function updateModeUI() {
    if (isWeightBased) {
      lockedUnitPrice = product.price;
      modalTitle.textContent = 'Enter Weight';
      weightInputLabel.textContent = weightUnit === 'g' ? 'Weight (g)' : 'Weight (kg)';
      weightInput.placeholder = 'Enter weight';
      priceInputLabel.textContent = `Total Price (${currencySymbol})`;
      priceInput.placeholder = 'Total price';
      if (document.activeElement !== priceInput) {
        priceInput.value = '0.00';
      }
      productPriceEl.innerHTML = `${currencySymbol}${product.price.toFixed(2)}/kg<br><strong style="color: #10b981; font-size: 18px;">Total: ${currencySymbol}0.00</strong>`;
      scaleButtonContainer.style.display = 'flex';
      weightModeBtn.style.background = '#6E8FAF';
      quantityModeBtn.style.background = '#94a3b8';
      weightInput.value = '';
    } else {
      lockedUnitPrice = product.price;
      modalTitle.textContent = 'Enter Quantity';
      weightInputLabel.textContent = 'Quantity (pieces)';
      weightInput.placeholder = 'Enter quantity';
      priceInputLabel.textContent = `Total Price (${currencySymbol})`;
      priceInput.placeholder = 'Total price';
      productPriceEl.textContent = `${currencySymbol}${product.price.toFixed(2)}/piece`;
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
    if (!Number.isFinite(weightKg) || weightKg <= 0) return;

    if (weightKg < 1) {
      weightUnit = 'g';
      const grams = Math.round(weightKg * 1000);
      weightInputLabel.textContent = 'Weight (g)';
      weightInput.value = '';
      weightInput.value = String(grams);
      weightInput.placeholder = `${grams} g`;
    } else {
      weightUnit = 'kg';
      const kgText = weightKg.toFixed(3);
      weightInputLabel.textContent = 'Weight (kg)';
      weightInput.value = '';
      weightInput.value = kgText;
      weightInput.placeholder = `${kgText} kg`;
    }

    updateDisplayedTotal();
  }

  function handleManualWeightInput() {
    if (!isWeightBased) return;

    const rawText = (weightInput.value || '').toString().trim();
    if (!rawText) return;

    const normalizedText = rawText.replace(/\s+/g, '');
    const unitMatch = normalizedText.match(/(kg|g)$/i);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : null;
    const numericPart = unit ? normalizedText.slice(0, -unit.length) : normalizedText;

    const hasDecimal = /[\.,]/.test(numericPart);
    const rawValue = parseFloat(numericPart.replace(',', '.'));
    if (!Number.isFinite(rawValue) || rawValue <= 0) return;

    // If user explicitly types a unit, reflect it in the label.
    if (unit === 'g') {
      if (weightUnit !== 'g') {
        weightUnit = 'g';
        weightInputLabel.textContent = 'Weight (g)';
      }
    } else if (unit === 'kg') {
      if (weightUnit !== 'kg') {
        weightUnit = 'kg';
        weightInputLabel.textContent = 'Weight (kg)';
      }
    } else if (!hasDecimal && rawValue >= 100) {
      // Heuristic: big whole numbers like 500 are likely grams.
      if (weightUnit !== 'g') {
        weightUnit = 'g';
        weightInputLabel.textContent = 'Weight (g)';
      }
    } else {
      if (weightUnit !== 'kg') {
        weightUnit = 'kg';
        weightInputLabel.textContent = 'Weight (kg)';
      }
    }

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
        if (weightResult && weightResult.success && typeof weightResult.weight === 'number' && weightResult.weight > 0) {
          setWeightDisplayFromKg(weightResult.weight);
        }
      } catch (e) {
        // Silent during auto-read; manual entry remains available
      } finally {
        autoReadInFlight = false;
      }
    }, 700);
  }
  
  // Initial UI setup
  updateModeUI();
  
  // Toggle button handlers
  weightModeBtn.onclick = () => {
    isWeightBased = true;
    weightUnit = 'kg';
    updateModeUI();

    weightInput.removeEventListener('input', handleManualQuantityInput);
    weightInput.addEventListener('input', handleManualWeightInput);
    if (scaleConnected) {
      readWeightFromScale();
    }
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
    readWeightFromScale();
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
    scaleBtn.disabled = true;
    scaleBtn.textContent = '⌛ Reading...';
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
          weightInput.placeholder = 'Place item on scale, then tap Read Again';
          addScaleDebugLog('ℹ️ Scale connected but shows 0. Waiting for item...', 'warning');
        } else {
          setWeightDisplayFromKg(weightResult.weight);
          console.log('Weight read successfully:', weightResult.weight, 'kg');
          addScaleDebugLog(`✅ Weight: ${weightResult.weight} kg from ${weightResult.portPath || 'unknown port'}`, 'success');
        }
        if (weightResult.config) {
          addScaleDebugLog(`⚙️ Config: ${weightResult.config.baudRate} baud, ${weightResult.config.dataBits}${weightResult.config.parity.charAt(0).toUpperCase()}${weightResult.config.stopBits}`, 'info');
        }
        // Select the text so user can easily replace it
        if (weightInput.value) weightInput.select();
        okBtn.focus(); // Focus on Add to Cart button
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
    
    scaleBtn.disabled = false;
    scaleBtn.textContent = '🔄 Read Again';
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
    console.log('>>> PARSED amountNum:', amountNum, 'type:', typeof amountNum);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.log('Invalid value');
      const fieldName = isWeightBased ? 'weight' : 'quantity';
      showAlert(`Please enter a valid ${fieldName}`, 'error', `Invalid ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`);
      isSubmitting = false;
      return;
    }


    
    if (amountNum > product.stock) {
      console.log('Not enough stock');
      const unit = isWeightBased ? 'kg' : 'pieces';
      showAlert(`Only ${product.stock} ${unit} available in stock`, 'warning', 'Stock Limit');
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
    
    console.log('>>> CALLING addToCart with amount:', amountNum, 'unit price:', unitPriceNum, 'isWeightBased:', isWeightBased);
    console.log('isSubmitting flag:', isSubmitting);
    
    // Close modal first
    modal.style.display = 'none';
    
    // Call addToCart
    addToCart(productId, amountNum, unitPriceNum, isWeightBased);
    
    // Cleanup immediately
    cleanup();
    
    console.log('handleOk completed - item should be added once');
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
  
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
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
    
    if (weightNum > product.stock + cartItem.quantity) {
      showAlert(`Only ${(product.stock + cartItem.quantity).toFixed(2)} kg available in stock`, 'warning', 'Stock Limit');
      return;
    }
    
    // Update the cart item weight
    cartItem.quantity = weightNum;
    cartItem.subtotal = weightNum * cartItem.unitPrice;
    modal.style.display = 'none';
    modalTitle.textContent = 'Enter Weight'; // Reset title
    cleanup();
    updateCartDisplay();
    updateCartSummary();
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
  
  // Search by product name
  const results = await window.api.searchProducts(query);
  
  if (results.length === 0) {
    showAlert('Product not found', 'error', 'Not Found');
    return;
  }
  
  if (results.length === 1) {
    promptForWeight(results[0].id);
  } else {
    // Multiple results - show alert to select from products grid
    showAlert('Multiple products found. Please select from the product grid below.', 'info', 'Multiple Results');
  }
}

function addToCart(productId, weight = null, customPrice = null, isWeightBased = true) {
  console.log('=== addToCart START ===');
  console.log('productId:', productId);
  console.log('weight parameter:', weight, 'type:', typeof weight);
  console.log('customPrice:', customPrice);
  console.log('isWeightBased:', isWeightBased);
  
  const product = allProducts.find(p => p.id === productId);
  console.log('Product found:', product);
  if (!product) {
    console.log('Product not found in addToCart');
    return;
  }
  
  if (product.stock <= 0) {
    showAlert('Product out of stock', 'warning', 'Out of Stock');
    return;
  }
  
  // Default weight is 1 kg if not provided
  const finalWeight = weight !== null ? weight : 1.0;
  // Use custom price if provided, otherwise use product price
  const finalPrice = customPrice !== null ? customPrice : product.price;
  console.log('>>> CALCULATED: Final weight:', finalWeight, 'Final price:', finalPrice);
  
  // Always add as new item - don't combine with existing items
  console.log('Adding new product to cart as separate line item');
  
  if (finalWeight > product.stock) {
    showAlert(`Only ${product.stock} kg available in stock`, 'warning', 'Stock Limit');
    return;
  }
  
  // Calculate price based on weight (price per kg)
  const weightedPrice = finalPrice * finalWeight;
  console.log('Weighted price:', weightedPrice);
  
  // Get tax rate from category
  const category = allCategories.find(c => c.name === product.category);
  const categoryTaxRate = category ? category.tax_rate : 0;
  
  // Add as new item - each addition is a separate line
  const cartItem = {
    productId: product.id,
    productName: product.name,
    unitPrice: finalPrice, // Use the custom or default price
    taxRate: categoryTaxRate,
    quantity: finalWeight, // Store weight in quantity field
    subtotal: weightedPrice,
    isWeightBased: isWeightBased, // Track whether it's weight or quantity based
    cartItemId: Date.now() // Unique ID for each cart item to allow duplicates
  };
  console.log('Cart item to add:', cartItem);
  cart.push(cartItem);
  
  console.log('Cart after update:', cart);
  
  console.log('Calling updateCartDisplay');
  updateCartDisplay();
  console.log('Calling updateCartSummary');
  updateCartSummary();
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

function removeFromCart(cartItemId) {
  cart = cart.filter(item => item.cartItemId !== cartItemId);
  updateCartDisplay();
}

function setupInlineCartEditing() {
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  // Handle quantity editing - inline
  document.querySelectorAll('.editable-quantity').forEach(el => {
    el.addEventListener('click', function() {
      const cartItemId = parseInt(this.dataset.cartItemId);
      const cartItem = cart.find(item => item.cartItemId === cartItemId);
      if (!cartItem) return;
      
      const unit = cartItem.isWeightBased ? 'kg' : 'pc';
      const currentValue = cartItem.quantity.toFixed(2);
      
      // Replace with input
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0.01';
      input.value = currentValue;
      input.style.cssText = 'width: 80px; text-align: center; font-weight: 800; font-size: 14px; padding: 4px; border: 2px solid #6EAFAF; border-radius: 4px;';
      
      this.innerHTML = '';
      this.appendChild(input);
      input.focus();
      input.select();
      
      const saveValue = () => {
        const newValue = parseFloat(input.value);
        if (!isNaN(newValue) && newValue > 0) {
          const product = allProducts.find(p => p.id === cartItem.productId);
          if (product && newValue > product.stock + cartItem.quantity) {
            alert(`Only ${(product.stock + cartItem.quantity).toFixed(2)} ${unit} available in stock`);
            updateCartDisplay();
            return;
          }
          cartItem.quantity = newValue;
          cartItem.subtotal = newValue * cartItem.unitPrice;
        }
        updateCartDisplay();
        updateCartSummary();
      };
      
      input.addEventListener('blur', saveValue);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveValue();
        if (e.key === 'Escape') updateCartDisplay();
      });
    });
  });
  
  // Handle price editing - inline
  document.querySelectorAll('.editable-price').forEach(el => {
    el.addEventListener('click', function() {
      const cartItemId = parseInt(this.dataset.cartItemId);
      const cartItem = cart.find(item => item.cartItemId === cartItemId);
      if (!cartItem) return;
      
      const unitLabel = cartItem.isWeightBased ? '/kg' : '/pc';
      const currentValue = cartItem.unitPrice.toFixed(2);
      
      // Replace with input
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.value = currentValue;
      input.style.cssText = 'width: 100px; text-align: center; font-size: 14px; padding: 4px; border: 2px solid #6EAFAF; border-radius: 4px;';
      
      this.textContent = '';
      this.appendChild(input);
      input.focus();
      input.select();
      
      const saveValue = () => {
        const newValue = parseFloat(input.value);
        if (!isNaN(newValue) && newValue >= 0) {
          cartItem.unitPrice = newValue;
          cartItem.subtotal = cartItem.quantity * newValue;
        }
        updateCartDisplay();
        updateCartSummary();
      };
      
      input.addEventListener('blur', saveValue);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveValue();
        if (e.key === 'Escape') updateCartDisplay();
      });
    });
  });
}

function updateCartDisplay() {
  console.log('updateCartDisplay called, cart:', cart);
  const cartTableBody = document.getElementById('cartTableBody');
  console.log('cartTableBody element:', cartTableBody);
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
    console.log('Cart is empty, showing empty message');
    cartTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: #a0aec0;">Cart is empty</td></tr>';
    checkoutBtn.disabled = true;
  } else {
    console.log('Cart has items, rendering...');
    cartTableBody.innerHTML = cart.map(item => {
      const unit = item.isWeightBased ? 'kg' : 'pc';
      const unitLabel = item.isWeightBased ? '/kg' : '/pc';
      return `
      <tr>
        <td>${item.productName}</td>
        <td class="editable-price" data-cart-item-id="${item.cartItemId}" style="cursor: pointer; user-select: none;">${currencySymbol}${item.unitPrice.toFixed(2)}${unitLabel}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
            <span class="editable-quantity" data-cart-item-id="${item.cartItemId}" style="min-width: 50px; text-align: center; font-weight: 800; cursor: pointer; user-select: none;">${item.quantity.toFixed(2)} ${unit}</span>
            <button onclick="removeFromCart(${item.cartItemId})" style="background: #fc8181; color: white; border: none; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 18px; font-weight: 800;">×</button>
          </div>
        </td>
        <td>${currencySymbol}0.00</td>
        <td style="font-weight: 800; color: #6E8FAF;">${currencySymbol}${item.subtotal.toFixed(2)}</td>
      </tr>
    `;
    }).join('');
    console.log('Cart HTML updated');
    
    // Add click handlers for inline editing
    setupInlineCartEditing();
    
    checkoutBtn.disabled = true; // Disabled until payment method selected
  }
  
  updateCartSummary();
  updateCustomerDisplayData();
}

function updateCartSummary() {
  // Update summary
  const currencySymbol = systemSettings?.currency_symbol || '$';
  
  // Product prices already include tax - we need to extract the tax amount
  // Total = sum of all product prices (tax-included)
  const total = cart.reduce((sum, item) => sum + item.subtotal, 0);
  
  // Calculate base price (before tax) and tax amount for each product
  let totalBasePrice = 0;
  let totalTaxAmount = 0;
  
  cart.forEach(item => {
    const taxRate = item.taxRate || 0;
    // Reverse calculation: Base = Total / (1 + tax_rate)
    const basePrice = item.subtotal / (1 + taxRate);
    const taxAmount = item.subtotal - basePrice;
    
    totalBasePrice += basePrice;
    totalTaxAmount += taxAmount;
  });
  
  updateCustomerDisplayData();

  const discount = 0; // Could implement discount logic
  
  // Get payment amount from payment input field or default to total
  const paymentInput = document.getElementById('paymentInput');
  const paymentAmountText = paymentInput ? paymentInput.value : '';
  const paymentAmount = paymentAmountText ? parseFloat(paymentAmountText) : total;
  const change = Math.max(0, paymentAmount - total);
  
  document.getElementById('cartSubtotal').textContent = `${currencySymbol}${totalBasePrice.toFixed(2)}`;
  document.getElementById('cartTax').textContent = `${currencySymbol}${totalTaxAmount.toFixed(2)}`;
  document.getElementById('cartDiscount').textContent = `${currencySymbol}${discount.toFixed(2)}`;
  document.getElementById('cartTotal').textContent = `${currencySymbol}${total.toFixed(2)}`;
  document.getElementById('paymentAmount').textContent = `${currencySymbol}${paymentAmount.toFixed(2)}`;
  document.getElementById('changeAmount').textContent = `${currencySymbol}${change.toFixed(2)}`;
}

async function completeSale() {
  if (cart.length === 0) return;
  
  if (!selectedPaymentMethod) {
    alert('Please select a payment method: CASH, CARD, or PACKING');
    return;
  }
  
  // Load system settings if not loaded
  if (!systemSettings) {
    systemSettings = await window.api.getSystemSettings();
  }
  
  // Product prices already include tax - extract tax from total
  const total = cart.reduce((sum, item) => sum + item.subtotal, 0);
  
  // Calculate base price (before tax) and tax amount
  let subtotal = 0;
  let tax = 0;
  
  cart.forEach(item => {
    const taxRate = item.taxRate || 0;
    const basePrice = item.subtotal / (1 + taxRate);
    const taxAmount = item.subtotal - basePrice;
    
    subtotal += basePrice;
    tax += taxAmount;
  });
  
  const discount = 0;
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
    lastSalePaymentMethod = paymentMethod;
    
    // Show receipt
    showReceipt(sale);
    
    // Clear cart
    cart = [];
    
    // Clear payment input
    const paymentInput = document.getElementById('paymentInput');
    if (paymentInput) paymentInput.value = '';
    
    // Reset payment method selection
    selectedPaymentMethod = null;
    document.querySelectorAll('.numpad-btn').forEach(b => {
      if (['cash', 'card', 'loan'].includes(b.dataset.value)) {
        b.style.opacity = '0.8';
        b.style.transform = 'scale(1)';
      }
    });
    
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
  const ownerName = systemSettings?.owner_name || '';
  const nieNumber = systemSettings?.nie_number || '';
  const companyAddress = systemSettings?.company_address || '';
  const currencySymbol = systemSettings?.currency_symbol || '$';
  const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';
  
  // Calculate tax breakdown by rate
  const taxBreakdown = {};
  sale.items.forEach(item => {
    const product = allProducts.find(p => p.id === item.product_id);
    if (product) {
      const category = allCategories.find(c => c.name === product.category);
      const taxRate = category ? category.tax_rate : 0;
      const taxRatePercent = Math.round(taxRate * 100);
      
      // Calculate base and tax amount for this item
      const basePrice = item.subtotal / (1 + taxRate);
      const taxAmount = item.subtotal - basePrice;
      
      if (!taxBreakdown[taxRatePercent]) {
        taxBreakdown[taxRatePercent] = {
          base: 0,
          tax: 0,
          total: 0
        };
      }
      
      taxBreakdown[taxRatePercent].base += basePrice;
      taxBreakdown[taxRatePercent].tax += taxAmount;
      taxBreakdown[taxRatePercent].total += item.subtotal;
    }
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
}

async function completeLoanSale(customerType, customerName, customerPhone, restaurantName, restaurantNie, notes) {
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
      customerType,
      customerName,
      customerPhone: customerPhone || null,
      restaurantName: restaurantName || null,
      restaurantNie: restaurantNie || null,
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
    alert('Error creating Parking order: ' + error.message);
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
  const ownerName = systemSettings?.owner_name || '';
  const nieNumber = systemSettings?.nie_number || '';
  const companyAddress = systemSettings?.company_address || '';
  const currencySymbol = systemSettings?.currency_symbol || '$';
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

async function searchLoanByReceipt(receiptNumber) {
  if (!receiptNumber || receiptNumber.trim() === '') {
    alert('Please enter a receipt number');
    return;
  }
  
  try {
    const loan = await window.api.getLoanByReceipt(receiptNumber);
    
    if (!loan) {
      alert('PACKING not found with this receipt number');
      return;
    }
    
    if (loan.status === 'paid') {
      alert('This PACKING has already been paid in full');
      return;
    }
    
    // Show loan payment modal
    showLoanPaymentModal(loan);
  } catch (error) {
    alert('Error searching for PACKING: ' + error.message);
  }
}

function showLoanPaymentModal(loan) {
  const modal = document.getElementById('loanPaymentModal');
  const content = document.getElementById('loanPaymentContent');
  
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
        <span>${loanDate.toLocaleDateString()}</span>
      </div>
      <div class="loan-detail-row" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #ddd;">
        <span>Total Amount:</span>
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

async function loadLoansView(status = null) {
  const loans = await window.api.getAllLoans(status);
  const tbody = document.querySelector('#loansTable tbody');
  
  if (loans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><div class="icon">💳</div><p>No Parking orders found</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = loans.map(loan => {
    const loanDate = new Date(loan.loan_date);
    let statusClass = 'status-pending';
    if (loan.status === 'paid') statusClass = 'status-paid';
    else if (loan.status === 'partial') statusClass = 'status-partial';
    
    const customerType = loan.customer_type === 'restaurant' ? '🍽️ Restaurant' : '👤 Regular';
    const displayName = loan.customer_type === 'restaurant' && loan.restaurant_name 
      ? `${loan.restaurant_name}<br><small>${loan.customer_name}</small>` 
      : loan.customer_name;
    
    return `
      <tr>
        <td>${loan.receipt_number}</td>
        <td>${customerType}</td>
        <td>${displayName}</td>
        <td>${loan.customer_phone || '-'}</td>
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
  
  document.getElementById('addCategoryBtnHeader')?.addEventListener('click', () => {
    if (hasPermission('categories')) {
      openCategoryModal();
    }
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
    
    // Determine unit type
    const isWeightBased = product.unit_type === 'weight' || !product.unit_type;
    
    // Get specific unit
    let unitLabel = '';
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
    
    // Get tax rate from category
    const category = allCategories.find(c => c.name === product.category);
    const categoryTaxRate = category ? category.tax_rate : 0;
    const taxDisplay = `${(categoryTaxRate * 100).toFixed(0)}%`;
    
    return `
      <tr>
        <td>${product.name}</td>
        <td>${product.category || 'General'}</td>
        <td>${unitTypeDisplay}</td>
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

async function openProductModal(product = null, categoryId = null, categoryName = null) {
  const modal = document.getElementById('productModal');
  const form = document.getElementById('productForm');
  const title = document.getElementById('productModalTitle');
  
  // Load categories first
  await loadCategoriesForProductForm();
  
  if (product) {
    title.textContent = 'Edit Product';
    document.getElementById('productId').value = product.id;
    document.getElementById('productBarcode').value = product.barcode;
    document.getElementById('productName').value = product.name;
    document.getElementById('productCategory').value = product.category || 'General';
    document.getElementById('productUnitType').value = product.unit_type || 'weight';
    document.getElementById('productWeightUnit').value = product.weight_unit || 'kg';
    document.getElementById('productQuantityUnit').value = product.quantity_unit || 'piece';
    document.getElementById('productWeightAmount').value = product.weight_amount || '';
    document.getElementById('productQuantityAmount').value = product.quantity_amount || '';
    document.getElementById('productRegularPrice').value = product.regular_price || product.price;
    document.getElementById('productSalePrice').value = product.sale_price || '';
    document.getElementById('productStock').value = product.stock;
    
    // Show appropriate unit field
    toggleUnitFields(product.unit_type || 'weight');
    
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
    document.getElementById('productUnitType').value = 'weight';
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
    
    // Show weight unit by default
    toggleUnitFields('weight');
  }
  
  // Setup unit type change listener
  document.getElementById('productUnitType').addEventListener('change', (e) => {
    toggleUnitFields(e.target.value);
  });
  
  modal.classList.add('active');
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
  const selectedCategory = document.getElementById('productCategory').value;
  const unitType = document.getElementById('productUnitType').value;
  
  // Auto-generate barcode for new products
  let barcode = document.getElementById('productBarcode').value;
  if (!id && !barcode) {
    // Generate barcode: timestamp + random 4 digits
    barcode = Date.now().toString() + Math.floor(1000 + Math.random() * 9000);
  }
  
  // Calculate final price
  let finalPrice = regularPrice;
  if (salePrice) {
    finalPrice = salePrice;
  }
  
  // Get tax rate from category
  const categories = await window.api.getAllCategories();
  const category = categories.find(c => c.name === selectedCategory);
  const taxRate = category ? category.tax_rate : 0;
  
  // Get image if selected
  const imageFile = document.getElementById('productImage').files[0];
  let imageData = null;
  
  if (imageFile) {
    imageData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  } else if (id) {
    // Keep existing image if editing and no new image selected
    const products = await window.api.getAllProducts();
    const existingProduct = products.find(p => p.id === parseInt(id));
    if (existingProduct && existingProduct.image) {
      imageData = existingProduct.image;
    }
  }
  
  const product = {
    barcode: barcode,
    name: document.getElementById('productName').value,
    description: '',
    category: selectedCategory,
    subcategory: document.getElementById('productSubcategory').value || null,
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
    cost: 0,
    stock: parseInt(document.getElementById('productStock').value),
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

async function loadSalesView() {
  const today = await window.api.getTodaySales();
  allSalesData = today.sales;
  
  // Display summary
  updateSalesSummary(today.summary);
  
  // Display filtered sales
  displayFilteredSales();
  
  // Add filter button handlers
  setupPaymentFilters();
  
  // Add print button handler
  const printBtn = document.getElementById('printTodaySalesBtn');
  if (printBtn) {
    printBtn.onclick = () => printTodaySales(today);
  }
}

function updateSalesSummary(summary) {
  const summaryDiv = document.getElementById('todaySummary');
  const currencySymbol = systemSettings?.currency_symbol || '€';
  summaryDiv.innerHTML = `
    Today's Sales: <strong>${summary.transaction_count}</strong> transactions | 
    Total: <strong>${currencySymbol}${(summary.total_sales || 0).toFixed(2)}</strong>
  `;
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
    filteredSales = allSalesData.filter(sale => sale.payment_method === currentPaymentFilter);
  }
  
  if (filteredSales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="icon">💰</div><p>No sales found</p></td></tr>';
    return;
  }
  
  // Fetch items for all sales
  const salesWithItems = await Promise.all(
    filteredSales.map(async (sale) => {
      const fullSale = await window.api.getSaleById(sale.id);
      return fullSale;
    })
  );
  
  tbody.innerHTML = salesWithItems.map(sale => {
    const date = new Date(sale.sale_date);
    const itemsList = sale.items.map(item => `${item.product_name} (${item.quantity})`).join(', ');
    const itemsShort = itemsList.length > 50 ? itemsList.substring(0, 50) + '...' : itemsList;
    
    return `
      <tr>
        <td>${date.toLocaleString()}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemsList}">
          ${itemsShort}
        </td>
        <td>${currencySymbol}${sale.subtotal.toFixed(2)}</td>
        <td>${currencySymbol}${sale.tax.toFixed(2)}</td>
        <td style="font-weight: 700;">${currencySymbol}${sale.total.toFixed(2)}</td>
        <td><span class="payment-badge payment-${sale.payment_method}">${sale.payment_method.toUpperCase()}</span></td>
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
      <title>Today's Sales Report - ${today.toLocaleDateString()}</title>
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
        <p>${today.toLocaleDateString()} - ${today.toLocaleTimeString()}</p>
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
            const date = new Date(sale.sale_date);
            return `
              <tr>
                <td>${date.toLocaleTimeString()}</td>
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
        <p>${today.toLocaleString()}</p>
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
      displayReport(report, periodType);
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
  
  const totalSales = report.sales.reduce((sum, day) => sum + (day.total_sales || 0), 0);
  const totalTransactions = report.sales.reduce((sum, day) => sum + day.transaction_count, 0);
  const totalTax = report.sales.reduce((sum, day) => sum + (day.tax || 0), 0);
  const totalSubtotal = report.sales.reduce((sum, day) => sum + (day.subtotal || 0), 0);
  
  let periodTitle = 'Sales Report';
  if (periodType === 'daily') periodTitle = 'Daily Sales Report';
  else if (periodType === 'weekly') periodTitle = 'Weekly Sales Report';
  else if (periodType === 'monthly') periodTitle = 'Monthly Sales Report';
  else if (periodType === 'yearly') periodTitle = 'Yearly Sales Report';
  
  // Group by week for weekly reports
  let groupedData = report.sales;
  if (periodType === 'weekly') {
    const weekMap = {};
    report.sales.forEach(day => {
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
    
    report.sales.forEach(day => {
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
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Total Sales</div>
          <div style="font-size: 32px; font-weight: 800;">${currencySymbol}${totalSales.toFixed(2)}</div>
        </div>
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Transactions</div>
          <div style="font-size: 32px; font-weight: 800;">${totalTransactions}</div>
        </div>
        <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Avg Transaction</div>
          <div style="font-size: 32px; font-weight: 800;">${currencySymbol}${(totalSales / totalTransactions || 0).toFixed(2)}</div>
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
              <td style="color: #6E8FAF;">${currencySymbol}${totalSales.toFixed(2)}</td>
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
            ${report.topProducts.map((product, index) => `
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
      <button class="btn-primary" onclick="window.print()">🖨️ Print Report</button>
    </div>
  `;
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
                  <td>${new Date(order.date).toLocaleDateString()}</td>
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

  // Auto-update tax rate when category is selected in product form
  document.getElementById('productCategory')?.addEventListener('change', async (e) => {
    const categoryName = e.target.value;
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
  const tbody = document.querySelector('#categoriesTable tbody');
  
  if (categories.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="icon">🏷️</div><p>No categories found. Add your first category!</p></td></tr>';
    return;
  }
  
  tbody.innerHTML = categories.map(category => {
    const date = new Date(category.created_at);
    const isFavorite = category.is_favorite === 1;
    const starIcon = isFavorite ? '⭐' : '☆';
    
    return `
      <tr>
        <td>
          <button class="star-btn" onclick="toggleCategoryFavorite(${category.id}, ${!isFavorite})" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
            ${starIcon}
          </button>
        </td>
        <td>${category.name}</td>
        <td>${(category.tax_rate * 100).toFixed(2)}%</td>
        <td>${date.toLocaleDateString()}</td>
        <td>
          <button class="action-btn" onclick="editCategory(${category.id})" title="Edit">✏️</button>
          <button class="action-btn" onclick="deleteCategory(${category.id})" title="Delete">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
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
    document.getElementById('categoryTaxRate').value = (category.tax_rate * 100).toFixed(2);
    
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
    taxRate: parseFloat(document.getElementById('categoryTaxRate').value) / 100
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
  
  categorySelect.innerHTML = categories.map(cat => 
    `<option value="${cat.name}">${cat.name} (${(cat.tax_rate * 100).toFixed(2)}% tax)</option>`
  ).join('');
  
  // Restore previous selection if it still exists
  if (currentValue && categories.some(c => c.name === currentValue)) {
    categorySelect.value = currentValue;
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
    
    document.getElementById('currencySymbol').value = systemSettings.currency_symbol || '';
    document.getElementById('currencyCode').value = systemSettings.currency_code || '';
    document.getElementById('taxRate').value = (systemSettings.tax_rate * 100) || 0;
    document.getElementById('receiptFooter').value = systemSettings.receipt_footer || '';
    document.getElementById('printerName').value = systemSettings.printer_name || '';
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
      ownerName: document.getElementById('ownerName').value,
      nieNumber: document.getElementById('nieNumber').value,
      companyAddress: document.getElementById('companyAddress').value,
      currencySymbol: document.getElementById('currencySymbol').value,
      currencyCode: document.getElementById('currencyCode').value,
      taxRate: parseFloat(document.getElementById('taxRate').value) / 100,
      receiptFooter: document.getElementById('receiptFooter').value,
      printerName: document.getElementById('printerName').value
    };
    
    systemSettings = await window.api.updateSystemSettings(settings);
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
  // Customer type change handler
  document.getElementById('loanCustomerType')?.addEventListener('change', (e) => {
    const type = e.target.value;
    const restaurantFields = document.getElementById('restaurantFields');
    const restaurantNieField = document.getElementById('restaurantNieField');
    const restaurantNameInput = document.getElementById('loanRestaurantName');
    
    if (type === 'restaurant') {
      restaurantFields.style.display = 'block';
      restaurantNieField.style.display = 'block';
      restaurantNameInput.required = true;
    } else {
      restaurantFields.style.display = 'none';
      restaurantNieField.style.display = 'none';
      restaurantNameInput.required = false;
      restaurantNameInput.value = '';
      document.getElementById('loanRestaurantNie').value = '';
    }
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
    
    await completeLoanSale(customerType, customerName, customerPhone, restaurantName, restaurantNie, notes);
    
    // Reset form
    e.target.reset();
    document.getElementById('restaurantFields').style.display = 'none';
    document.getElementById('restaurantNieField').style.display = 'none';
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
      console.log('Reprinting receipt...');
      const printed = await printReceiptToThermalPrinter(lastSale);

      // Old POS behavior: open drawer when printing for cash sales
      const paymentMethod = (lastSalePaymentMethod || lastSale?.payment_method || '').toString().toLowerCase();
      if (paymentMethod === 'cash') {
        if (printed) {
          await openCashDrawer();
        } else {
          // Try drawer anyway; show error if it fails
          await openCashDrawer();
        }
      }

      // Close receipt modal after print action
      closeModal('receiptModal');
      
      // Reset flag after 2 seconds
      setTimeout(() => {
        isPrinting = false;
      }, 2000);
    });
  }
  
  // Setup virtual keyboard
  setupVirtualKeyboard();
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
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

function setupVirtualKeyboard() {
  const keyboard = document.getElementById('virtualKeyboard');
  const closeKeyboardBtn = document.getElementById('closeKeyboard');
  const keyButtons = document.querySelectorAll('.key-btn');
  let isShiftActive = false;
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
      } else {
        shiftBtn.style.background = 'white';
        shiftBtn.style.color = '#1e293b';
      }
    }
  }
  
  updateKeyboardCase();

  function isNumericKeyboardTarget(el) {
    if (!el || el.tagName !== 'INPUT') return false;

    const inputMode = (el.getAttribute('inputmode') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();

    if (inputMode === 'numeric' || inputMode === 'decimal' || inputMode === 'tel') return true;
    if (type === 'number' || type === 'tel') return true;

    // Known numeric fields
    if (el.id === 'weightInput' || el.id === 'weightPriceInput') return true;

    return false;
  }

  function setKeyboardMode(mode) {
    keyboardMode = mode === 'numeric' ? 'numeric' : 'text';

    // Reset shift when switching modes
    if (keyboardMode === 'numeric' && isShiftActive) {
      isShiftActive = false;
      updateKeyboardCase();
    }

    keyButtons.forEach(btn => {
      const key = btn.dataset.key;
      const isNumberKey = btn.classList.contains('key-number');
      const isBackspace = btn.classList.contains('key-backspace') || key === 'Backspace';
      const isDone = btn.classList.contains('key-done') || key === 'Done';
      const isSpace = btn.classList.contains('key-space') || key === ' ';
      const isShift = btn.classList.contains('key-shift') || key === 'Shift';
      const isDecimal = key === '.';

      // Letter keys are defined with uppercase A-Z in data-key.
      const isLetterKey = !!(key && key.length === 1 && /[A-Z]/.test(key) && !isNumberKey);

      const shouldShow = (keyboardMode === 'numeric')
        ? (isNumberKey || isDecimal || isBackspace || isDone)
        : (isLetterKey || isSpace || isShift || isBackspace || isDone);

      btn.style.display = shouldShow ? '' : 'none';
    });

    // Hide empty rows to avoid big gaps
    document.querySelectorAll('#virtualKeyboard .keyboard-row').forEach(row => {
      const hasVisibleButton = Array.from(row.querySelectorAll('.key-btn')).some(b => b.style.display !== 'none');
      row.style.display = hasVisibleButton ? '' : 'none';
    });
  }
  
  // Show keyboard when text inputs are focused (except barcode input)
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' && 
        (e.target.type === 'text' || e.target.type === 'tel' || e.target.type === 'number') && 
        e.target.id !== 'barcodeInput' &&
        e.target.id !== 'paymentAmount') {
      currentKeyboardInput = e.target;
      setKeyboardMode(isNumericKeyboardTarget(e.target) ? 'numeric' : 'text');
      keyboard.classList.add('active');
    }
    if (e.target.tagName === 'TEXTAREA') {
      currentKeyboardInput = e.target;
      setKeyboardMode('text');
      keyboard.classList.add('active');
    }
  });
  
  // Handle key presses
  keyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      
      if (key === 'Shift') {
        isShiftActive = !isShiftActive;
        updateKeyboardCase();
      } else if (key === 'Backspace') {
        if (currentKeyboardInput) {
          currentKeyboardInput.value = currentKeyboardInput.value.slice(0, -1);
          currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else if (key === 'Done') {
        if (currentKeyboardInput) {
          currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        keyboard.classList.remove('active');
        currentKeyboardInput = null;
        isShiftActive = false;
        updateKeyboardCase();
      } else {
        // Use the actual displayed text (respects shift state)
        const actualKey = btn.textContent === 'SPACE' ? ' ' : btn.textContent;
        if (currentKeyboardInput) {
          // Extra guard: never inject letters into numeric mode.
          if (keyboardMode === 'numeric' && /[a-zA-Z]/.test(actualKey)) return;
          currentKeyboardInput.value += actualKey;
          currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Auto-turn off shift after typing one character
        if (isShiftActive) {
          isShiftActive = false;
          updateKeyboardCase();
        }
      }
    });
  });
  
  // Close keyboard button
  closeKeyboardBtn.addEventListener('click', () => {
    if (currentKeyboardInput) {
      currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    keyboard.classList.remove('active');
    currentKeyboardInput = null;
    isShiftActive = false;
    updateKeyboardCase();
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
    // Return processed - no popup
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
    // Customer display opened - no popup
    updateCustomerDisplayData();
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

async function printReceiptToThermalPrinter(sale) {
  try {
    if (!systemSettings) {
      systemSettings = await window.api.getSystemSettings();
    }
    
    const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
    const ownerName = systemSettings?.owner_name || '';
    const nieNumber = systemSettings?.nie_number || '';
    const companyAddress = systemSettings?.company_address || '';
    const currencySymbol = systemSettings?.currency_symbol || '$';
    const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';

    // Calculate tax breakdown by rate (to match the on-screen receipt)
    const taxBreakdown = {};
    (sale.items || []).forEach(item => {
      const product = allProducts.find(p => p.id === item.product_id);
      if (!product) return;
      const category = allCategories.find(c => c.name === product.category);
      const taxRate = category ? category.tax_rate : 0;
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
    
    const receiptData = {
      storeName: storeName,
      ownerName: ownerName,
      nieNumber: nieNumber,
      companyAddress: companyAddress,
      receiptId: sale.id,
      date: new Date(sale.sale_date).toLocaleString(),
      items: sale.items.map(item => ({
        name: item.product_name,
        quantity: item.quantity,
        subtotal: item.subtotal
      })),
      subtotal: sale.subtotal,
      tax: sale.tax,
      total: sale.total,
      taxBreakdown: taxBreakdownRows,
      paymentMethod: sale.payment_method,
      currency: currencySymbol,
      footer: receiptFooter,
      cashier: currentUser.full_name
    };
    
    console.log('Printing receipt to thermal printer...');
    const result = await window.api.printReceipt(receiptData);
    
    if (!result.success) {
      console.error('Thermal print error:', result.error);
      // Fallback to standard printing
      console.log('Falling back to standard print...');
      printReceiptFallback(sale);
      return false;
    } else {
      console.log('Receipt printed successfully to thermal printer');
      return true;
    }
  } catch (error) {
    console.error('Error printing receipt:', error);
    // Fallback to standard printing
    printReceiptFallback(sale);
    return false;
  }
}

// Fallback: Print receipt using standard browser print (same as daily report)
function printReceiptFallback(sale) {
  const currencySymbol = systemSettings?.currency_symbol || '€';
  const storeName = systemSettings?.store_name || 'SUPERMARKET POS';
  const ownerName = systemSettings?.owner_name || '';
  const nieNumber = systemSettings?.nie_number || '';
  const companyAddress = systemSettings?.company_address || '';
  const receiptFooter = systemSettings?.receipt_footer || 'Thank you for shopping with us!';
  const date = new Date(sale.sale_date).toLocaleString();
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt #${sale.id}</title>
      <style>
        body {
          font-family: 'Courier New', monospace;
          max-width: 80mm;
          margin: 0 auto;
          padding: 10mm;
          font-size: 12px;
        }
        .center {
          text-align: center;
        }
        .header {
          text-align: center;
          margin-bottom: 10px;
          padding-bottom: 10px;
          border-bottom: 1px dashed #000;
        }
        .header h2 {
          margin: 5px 0;
          font-size: 16px;
        }
        .header p {
          margin: 2px 0;
          font-size: 11px;
        }
        .items {
          margin: 10px 0;
        }
        .item {
          display: flex;
          justify-content: space-between;
          margin: 5px 0;
        }
        .separator {
          border-top: 1px dashed #000;
          margin: 10px 0;
        }
        .total-line {
          display: flex;
          justify-content: space-between;
          font-weight: bold;
          font-size: 14px;
          margin: 5px 0;
        }
        .footer {
          text-align: center;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px dashed #000;
          font-size: 11px;
        }
        @media print {
          body {
            padding: 0;
            margin: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>${storeName}</h2>
        ${ownerName ? `<p>${ownerName}</p>` : ''}
        ${nieNumber ? `<p>NIE: ${nieNumber}</p>` : ''}
        ${companyAddress ? `<p>${companyAddress.replace(/\n/g, '<br>')}</p>` : ''}
        <p style="font-weight: bold; margin-top: 8px;">FACTURA SIMPLIFICADA</p>
        <p>Receipt #${sale.id}</p>
        <p>${date}</p>
      </div>
      
      <div class="items">
        ${sale.items.map(item => `
          <div class="item">
            <span>${item.product_name} x${item.quantity}</span>
            <span>${currencySymbol}${item.subtotal.toFixed(2)}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="separator"></div>
      
      <div class="item">
        <span>Subtotal:</span>
        <span>${currencySymbol}${sale.subtotal.toFixed(2)}</span>
      </div>
      <div class="item">
        <span>Tax:</span>
        <span>${currencySymbol}${sale.tax.toFixed(2)}</span>
      </div>
      <div class="total-line">
        <span>TOTAL:</span>
        <span>${currencySymbol}${sale.total.toFixed(2)}</span>
      </div>
      <div class="item">
        <span>Payment:</span>
        <span>${sale.payment_method.toUpperCase()}</span>
      </div>
      
      <div class="footer">
        <p>${receiptFooter}</p>
        <p>Cashier: ${currentUser.full_name}</p>
        <p>Generated by SUPERMARKET POS</p>
        <p>Date: ${new Date().toLocaleString()}</p>
      </div>
      
      <script>
        window.onload = function() {
          window.print();
          setTimeout(function() {
            window.close();
          }, 500);
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
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
      // Barcode sent - no popup
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
window.promptForWeight = promptForWeight;
window.editCartWeight = editCartWeight;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.generateBarcodeDisplay = generateBarcodeDisplay;
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
window.printBarcodeLabel = printBarcodeLabel;
window.printProductBarcode = printProductBarcode;
window.showAlert = showAlert;
window.viewZReportDetails = viewZReportDetails;

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
    showAlert('Error loading analytics data', 'error');
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
      labels: data.salesTrends.map(d => new Date(d.date).toLocaleDateString()),
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
