const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // App
  getProductById: (id) => ipcRenderer.invoke('products:getById', id),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Activation
  archiveProduct: (id) => ipcRenderer.invoke('products:archive', id),
  getActivationStatus: () => ipcRenderer.invoke('activation:getStatus'),
  activateApp: (key) => ipcRenderer.invoke('activation:activate', key),

  // Products
  getAllProducts: () => ipcRenderer.invoke('products:getAll'),
  getAllProductsLite: () => ipcRenderer.invoke('products:getAllLite'),
  searchProducts: (query) => ipcRenderer.invoke('products:search', query),
  getProductByBarcode: (barcode) => ipcRenderer.invoke('products:getByBarcode', barcode),
  addProduct: (product) => ipcRenderer.invoke('products:add', product),
  bulkAddProducts: (products) => ipcRenderer.invoke('products:bulkAdd', products),
  updateProduct: (id, product) => ipcRenderer.invoke('products:update', id, product),
  setProductShowInCheckout: (id, showInCheckout) => ipcRenderer.invoke('products:setShowInCheckout', id, showInCheckout),
  deleteProduct: (id) => ipcRenderer.invoke('products:delete', id),
  // VAT (IVA) presets
  getVatRates: (activeOnly = true) => ipcRenderer.invoke('vatRates:getAll', activeOnly),
  addVatRate: (percent, label = null) => ipcRenderer.invoke('vatRates:add', percent, label),
  getProductSortOrder: (scopeCategory, scopeSubcategory) => ipcRenderer.invoke('products:getSortOrder', scopeCategory, scopeSubcategory),
  setProductSortOrder: (scopeCategory, scopeSubcategory, productIds) => ipcRenderer.invoke('products:setSortOrder', scopeCategory, scopeSubcategory, productIds),
  
  // Sales
  createSale: (sale) => ipcRenderer.invoke('sales:create', sale),
  getAllSales: (filters) => ipcRenderer.invoke('sales:getAll', filters),
  getSaleById: (id) => ipcRenderer.invoke('sales:getById', id),
  getTodaySales: () => ipcRenderer.invoke('sales:getToday'),
  getYesterdaySales: () => ipcRenderer.invoke('sales:getYesterday'),

  // Business day (Z-report closes day)
  getBusinessDayRange: (which) => ipcRenderer.invoke('business:getRange', which),
  
  // Reports
  getSalesReport: (startDate, endDate) => ipcRenderer.invoke('reports:sales', startDate, endDate),
  getInventoryReport: () => ipcRenderer.invoke('reports:inventory'),
  getAnalyticsData: (startDate, endDate) => ipcRenderer.invoke('reports:analytics', startDate, endDate),
  
  // Users
  isSetupRequired: () => ipcRenderer.invoke('users:isSetupRequired'),
  createFirstAdmin: (userData) => ipcRenderer.invoke('users:createFirstAdmin', userData),
  authenticateUser: (username, password) => ipcRenderer.invoke('users:authenticate', username, password),
  getAllUsers: () => ipcRenderer.invoke('users:getAll'),
  addUser: (user) => ipcRenderer.invoke('users:add', user),
  updateUser: (id, user) => ipcRenderer.invoke('users:update', id, user),
  updateUserPassword: (id, password) => ipcRenderer.invoke('users:updatePassword', id, password),
  deleteUser: (id) => ipcRenderer.invoke('users:delete', id),
  getUserById: (id) => ipcRenderer.invoke('users:getById', id),
  
  // Loans
  createLoan: (loanData) => ipcRenderer.invoke('loans:create', loanData),
  getAllLoans: (status) => ipcRenderer.invoke('loans:getAll', status),
  searchLoans: (query, status) => ipcRenderer.invoke('loans:search', query, status),
  listLoanParties: (query, limit) => ipcRenderer.invoke('loans:listParties', query, limit),
  getLoanByReceipt: (receiptNumber) => ipcRenderer.invoke('loans:getByReceipt', receiptNumber),
  payLoan: (loanId, paymentData) => ipcRenderer.invoke('loans:pay', loanId, paymentData),
  getLoanById: (id) => ipcRenderer.invoke('loans:getById', id),
  getMonthlyRestaurantReport: (month, year) => ipcRenderer.invoke('loans:getMonthlyRestaurantReport', month, year),
  removeLoanSaleItem: (loanId, saleItemId) => ipcRenderer.invoke('loans:removeSaleItem', loanId, saleItemId),
  
  // Returns
  createReturn: (returnData) => ipcRenderer.invoke('returns:create', returnData),
  getAllReturns: () => ipcRenderer.invoke('returns:getAll'),
  getReturnById: (id) => ipcRenderer.invoke('returns:getById', id),
  getReturnBySaleId: (originalSaleId) => ipcRenderer.invoke('returns:getBySaleId', originalSaleId),
  
  // Z-Reports
  createZReport: (reportData) => ipcRenderer.invoke('zreport:create', reportData),
  getAllZReports: () => ipcRenderer.invoke('zreport:getAll'),
  getZReportById: (id) => ipcRenderer.invoke('zreport:getById', id),
  getZReportByNumber: (reportNumber) => ipcRenderer.invoke('zreport:getByNumber', reportNumber),
  getSalesByDateRange: (startDate, endDate, cashierId) => ipcRenderer.invoke('zreport:getSalesByDateRange', startDate, endDate, cashierId),
  getSalesByDateTimeRange: (startDateTime, endDateTime, cashierId) => ipcRenderer.invoke('zreport:getSalesByDateTimeRange', startDateTime, endDateTime, cashierId),
  getReturnsByDateRange: (startDate, endDate, cashierId) => ipcRenderer.invoke('zreport:getReturnsByDateRange', startDate, endDate, cashierId),
  getReturnsByDateTimeRange: (startDateTime, endDateTime, cashierId) => ipcRenderer.invoke('zreport:getReturnsByDateTimeRange', startDateTime, endDateTime, cashierId),
  getLoanPaymentsByDateRange: (startDate, endDate, cashierId) => ipcRenderer.invoke('zreport:getLoanPaymentsByDateRange', startDate, endDate, cashierId),
  getLoanPaymentsByDateTimeRange: (startDateTime, endDateTime, cashierId) => ipcRenderer.invoke('zreport:getLoanPaymentsByDateTimeRange', startDateTime, endDateTime, cashierId),
  getLoanPaymentsDetailedByDateTimeRange: (startDateTime, endDateTime, cashierId) => ipcRenderer.invoke('zreport:getLoanPaymentsDetailedByDateTimeRange', startDateTime, endDateTime, cashierId),
  getMonthlySalesActualTotals: () => ipcRenderer.invoke('zreport:getMonthlySalesActualTotals'),

  // System Settings
  getSystemSettings: () => ipcRenderer.invoke('settings:get'),
  updateSystemSettings: (settings) => ipcRenderer.invoke('settings:update', settings),

  // Printing
  printBarcodeLabel: (barcodeData) => ipcRenderer.invoke('printer:printBarcode', barcodeData),

  // Database
  backupDatabase: () => ipcRenderer.invoke('db:backup'),
  restoreDatabase: () => ipcRenderer.invoke('db:restore'),
  clearTestData: () => ipcRenderer.invoke('db:clearTestData'),
  
  // Categories
  getAllCategories: () => ipcRenderer.invoke('categories:getAll'),
  getCategoryById: (id) => ipcRenderer.invoke('categories:getById', id),
  addCategory: (category) => ipcRenderer.invoke('categories:add', category),
  updateCategory: (id, category) => ipcRenderer.invoke('categories:update', id, category),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),
  toggleCategoryFavorite: (id, isFavorite) => ipcRenderer.invoke('categories:toggleFavorite', id, isFavorite),
  getFavoriteCategories: () => ipcRenderer.invoke('categories:getFavorites'),
  
  // Subcategories
  getAllSubcategories: () => ipcRenderer.invoke('subcategories:getAll'),
  getSubcategoriesByCategoryId: (categoryId) => ipcRenderer.invoke('subcategories:getByCategoryId', categoryId),
  getSubcategoriesByParentId: (parentId) => ipcRenderer.invoke('subcategories:getByParentId', parentId),
  getSubcategoryById: (id) => ipcRenderer.invoke('subcategories:getById', id),
  addSubcategory: (subcategory) => ipcRenderer.invoke('subcategories:add', subcategory),
  updateSubcategory: (id, subcategory) => ipcRenderer.invoke('subcategories:update', id, subcategory),
  deleteSubcategory: (id) => ipcRenderer.invoke('subcategories:delete', id),
  
  // Customer Display
  openCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:open'),
  updateCustomerDisplay: (data) => ipcRenderer.invoke('customerDisplay:update', data),
  closeCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:close'),
  
  // Printer
  openCashDrawer: () => ipcRenderer.invoke('printer:openDrawer'),
  printReceipt: (receiptData) => ipcRenderer.invoke('printer:printReceipt', receiptData),
  getPrinterList: () => ipcRenderer.invoke('printer:getList'),
  
  // Expenses
  createExpense: (expenseData) => ipcRenderer.invoke('expenses:create', expenseData),
  getExpenses: (startDate, endDate) => ipcRenderer.invoke('expenses:getAll', startDate, endDate),
  getExpensesByDateTimeRange: (startDateTime, endDateTime) => ipcRenderer.invoke('expenses:getAllByDateTimeRange', startDateTime, endDateTime),
  getExpenseById: (id) => ipcRenderer.invoke('expenses:getById', id),
  updateExpense: (id, expenseData) => ipcRenderer.invoke('expenses:update', id, expenseData),
  deleteExpense: (id) => ipcRenderer.invoke('expenses:delete', id),
  getExpenseSummary: (startDate, endDate) => ipcRenderer.invoke('expenses:getSummary', startDate, endDate),
  getExpenseSummaryByDateTimeRange: (startDateTime, endDateTime) => ipcRenderer.invoke('expenses:getSummaryByDateTimeRange', startDateTime, endDateTime),
  
  // Scale
  listScalePorts: () => ipcRenderer.invoke('scale:listPorts'),
  connectScale: (portPath) => ipcRenderer.invoke('scale:connect', portPath),
  readScaleWeight: () => ipcRenderer.invoke('scale:readWeight'),
  getScaleModuleStatus: () => ipcRenderer.invoke('scale:moduleStatus'),
  disconnectScale: () => ipcRenderer.invoke('scale:disconnect'),
  
  // Customer Display
  initializeCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:initialize'),
  showWelcomeMessage: () => ipcRenderer.invoke('customerDisplay:showWelcome'),
  // showCurrentItem(itemName, totalPrice, currencySymbol, quantity?, unitPrice?, unit?)
  showCurrentItem: (itemName, price, currencySymbol, quantity = null, unitPrice = null, unit = null) => ipcRenderer.invoke('customerDisplay:showItem', { itemName, price, currencySymbol, quantity, unitPrice, unit }),
  showTotal: (total, currencySymbol) => ipcRenderer.invoke('customerDisplay:showTotal', { total, currencySymbol }),
  showChange: (changeAmount, currencySymbol) => ipcRenderer.invoke('customerDisplay:showChange', { changeAmount, currencySymbol }),
  showPaymentSummary: (total, paid, change, currencySymbol) => ipcRenderer.invoke('customerDisplay:showPaymentSummary', { total, paid, change, currencySymbol }),
  showPaymentProcessing: (paymentMethod) => ipcRenderer.invoke('customerDisplay:showPayment', { paymentMethod }),
  showThankYou: (changeAmount, currencySymbol) => ipcRenderer.invoke('customerDisplay:showThankYou', { changeAmount, currencySymbol }),
  clearCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:clear'),
  getCustomerDisplayStatus: () => ipcRenderer.invoke('customerDisplay:getStatus'),
  getCustomerDisplayConnectionStatus: () => ipcRenderer.invoke('customerDisplay:getConnectionStatus'),
  disconnectCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:disconnect')

  ,

  reconnectCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:reconnect')

  ,

  setCustomerDisplayPreferredPort: (portPath) => ipcRenderer.invoke('customerDisplay:setPreferredPort', { portPath })

  ,

  resetCustomerDisplayDevice: () => ipcRenderer.invoke('customerDisplay:resetDevice')

  ,

  // Customer Display (Preview/Inspect)
  // Subscribe to preview lines pushed from main process.
  // Returns an unsubscribe function.
  onCustomerDisplayPreview: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const channel = 'customerDisplay:previewLines';
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
