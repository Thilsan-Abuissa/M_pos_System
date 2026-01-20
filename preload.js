const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // Products
  getAllProducts: () => ipcRenderer.invoke('products:getAll'),
  searchProducts: (query) => ipcRenderer.invoke('products:search', query),
  getProductByBarcode: (barcode) => ipcRenderer.invoke('products:getByBarcode', barcode),
  addProduct: (product) => ipcRenderer.invoke('products:add', product),
  updateProduct: (id, product) => ipcRenderer.invoke('products:update', id, product),
  deleteProduct: (id) => ipcRenderer.invoke('products:delete', id),
  
  // Sales
  createSale: (sale) => ipcRenderer.invoke('sales:create', sale),
  getAllSales: (filters) => ipcRenderer.invoke('sales:getAll', filters),
  getSaleById: (id) => ipcRenderer.invoke('sales:getById', id),
  getTodaySales: () => ipcRenderer.invoke('sales:getToday'),
  
  // Reports
  getSalesReport: (startDate, endDate) => ipcRenderer.invoke('reports:sales', startDate, endDate),
  getInventoryReport: () => ipcRenderer.invoke('reports:inventory'),
  
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
  getLoanByReceipt: (receiptNumber) => ipcRenderer.invoke('loans:getByReceipt', receiptNumber),
  payLoan: (loanId, paymentData) => ipcRenderer.invoke('loans:pay', loanId, paymentData),
  getLoanById: (id) => ipcRenderer.invoke('loans:getById', id),
  
  // Returns
  createReturn: (returnData) => ipcRenderer.invoke('returns:create', returnData),
  getAllReturns: () => ipcRenderer.invoke('returns:getAll'),
  getReturnById: (id) => ipcRenderer.invoke('returns:getById', id),
  
  // Z-Reports
  createZReport: (reportData) => ipcRenderer.invoke('zreport:create', reportData),
  getAllZReports: () => ipcRenderer.invoke('zreport:getAll'),
  getZReportById: (id) => ipcRenderer.invoke('zreport:getById', id),
  getZReportByNumber: (reportNumber) => ipcRenderer.invoke('zreport:getByNumber', reportNumber),
  getSalesByDateRange: (startDate, endDate, cashierId) => ipcRenderer.invoke('zreport:getSalesByDateRange', startDate, endDate, cashierId),
  getReturnsByDateRange: (startDate, endDate, cashierId) => ipcRenderer.invoke('zreport:getReturnsByDateRange', startDate, endDate, cashierId),
  
  // System Settings
  getSystemSettings: () => ipcRenderer.invoke('settings:get'),
  updateSystemSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  
  // Customer Display
  openCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:open'),
  updateCustomerDisplay: (data) => ipcRenderer.invoke('customerDisplay:update', data),
  closeCustomerDisplay: () => ipcRenderer.invoke('customerDisplay:close'),
  
  // Printer
  openCashDrawer: () => ipcRenderer.invoke('printer:openDrawer'),
  printBarcodeLabel: (barcodeData) => ipcRenderer.invoke('printer:printBarcode', barcodeData)
});
