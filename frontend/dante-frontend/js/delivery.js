/**
 * Delivery Module - Handle stock delivery/transfer from Main warehouse to branches
 */

const API_BASE = window.location.origin + '/api';

class DeliveryManager {
  constructor() {
    this.branches = [];
    this.products = [];
    this.selectedProduct = null;
    this.selectedDestinationBranch = null;
    this.isLoading = false;
    this.init();
  }

  async init() {
    this.renderLayout();
    this.attachEventListeners();
    await this.loadBranches();
    await this.loadProducts();
  }

  renderLayout() {
    const app = document.getElementById('app');
    app.innerHTML = `
      ${window.sharedNavMarkup}
      
      <main class="flex-1 p-md md:ml-64 md:pt-16">
        <div class="max-w-4xl mx-auto">
          <!-- Header -->
          <div class="mb-lg">
            <h1 class="font-headline-lg text-headline-lg font-bold text-on-surface mb-sm">Stock Delivery</h1>
            <p class="text-body-md text-on-surface-variant">Transfer stock from Main Warehouse to branch locations</p>
          </div>

          <!-- Main Form Card -->
          <div class="bg-surface-container rounded-lg border border-outline-variant p-lg shadow-sm mb-lg">
            
            <!-- Product Selection -->
            <div class="mb-lg">
              <label class="block font-title-md text-title-md text-on-surface mb-sm">Product</label>
              <div class="flex gap-sm">
                <div class="flex-1">
                  <input 
                    type="text" 
                    id="barcodeInput" 
                    placeholder="Scan or enter barcode" 
                    class="w-full px-md py-sm border border-outline rounded-md focus:outline-none focus:border-primary transition-colors bg-surface text-on-surface"
                  >
                </div>
                <button 
                  id="scanButton" 
                  class="bg-secondary text-on-secondary px-md py-sm rounded-md hover:bg-opacity-90 transition-colors font-label-md text-label-md flex items-center gap-xs"
                >
                  <span class="material-symbols-outlined text-xl">qr_code_scanner</span>
                </button>
              </div>
              <div id="barcodeError" class="text-error text-body-sm mt-xs hidden"></div>
            </div>

            <!-- Product Display -->
            <div id="productInfo" class="bg-surface-container-low rounded-md p-md mb-lg hidden">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
                <div>
                  <p class="text-body-sm text-on-surface-variant mb-xs">Product Name</p>
                  <p id="productName" class="font-title-md text-title-md text-on-surface"></p>
                </div>
                <div>
                  <p class="text-body-sm text-on-surface-variant mb-xs">Barcode</p>
                  <p id="productBarcode" class="font-title-md text-title-md text-on-surface font-mono"></p>
                </div>
                <div>
                  <p class="text-body-sm text-on-surface-variant mb-xs">Category</p>
                  <p id="productCategory" class="font-body-md text-body-md text-on-surface"></p>
                </div>
                <div>
                  <p class="text-body-sm text-on-surface-variant mb-xs">Main Warehouse Stock</p>
                  <p id="sourceStock" class="font-headline-sm text-headline-sm text-primary font-bold"></p>
                </div>
              </div>
            </div>

            <!-- Quantity Input -->
            <div class="mb-lg">
              <label class="block font-title-md text-title-md text-on-surface mb-sm">Quantity to Deliver</label>
              <input 
                type="number" 
                id="quantityInput" 
                placeholder="0" 
                min="1" 
                class="w-full px-md py-sm border border-outline rounded-md focus:outline-none focus:border-primary transition-colors bg-surface text-on-surface"
                disabled
              >
              <div id="quantityError" class="text-error text-body-sm mt-xs hidden"></div>
            </div>

            <!-- Destination Branch -->
            <div class="mb-lg">
              <label class="block font-title-md text-title-md text-on-surface mb-sm">Destination Branch</label>
              <select 
                id="destinationBranchSelect" 
                class="w-full px-md py-sm border border-outline rounded-md focus:outline-none focus:border-primary transition-colors bg-surface text-on-surface"
                disabled
              >
                <option value="">-- Select a branch --</option>
              </select>
              <div id="branchError" class="text-error text-body-sm mt-xs hidden"></div>
            </div>

            <!-- Summary -->
            <div id="deliverySummary" class="bg-primary-container rounded-md p-md mb-lg hidden">
              <p class="font-title-md text-title-md text-on-surface mb-md">Delivery Summary</p>
              <div class="space-y-sm text-body-md">
                <div class="flex justify-between">
                  <span class="text-on-surface-variant">Product:</span>
                  <span id="summaryProduct" class="font-bold text-on-surface"></span>
                </div>
                <div class="flex justify-between">
                  <span class="text-on-surface-variant">Quantity:</span>
                  <span id="summaryQty" class="font-bold text-on-surface"></span>
                </div>
                <div class="flex justify-between">
                  <span class="text-on-surface-variant">From:</span>
                  <span id="summarySource" class="font-bold text-on-surface">Main Warehouse</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-on-surface-variant">To:</span>
                  <span id="summaryDest" class="font-bold text-on-surface"></span>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex gap-md">
              <button 
                id="deliverButton" 
                class="flex-1 bg-primary text-on-primary px-md py-sm rounded-md hover:bg-opacity-90 transition-colors font-label-lg text-label-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <span id="deliverButtonText">Confirm Delivery</span>
              </button>
              <button 
                id="resetButton" 
                class="flex-1 bg-surface-container border border-outline text-on-surface px-md py-sm rounded-md hover:bg-surface-container-high transition-colors font-label-lg text-label-lg"
              >
                Clear
              </button>
            </div>
          </div>

          <!-- Status Messages -->
          <div id="statusMessage" class="rounded-md p-md hidden mb-lg"></div>

          <!-- Recent Deliveries Table -->
          <div class="bg-surface-container rounded-lg border border-outline-variant p-lg">
            <h2 class="font-title-lg text-title-lg text-on-surface mb-md">Recent Deliveries</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-body-sm">
                <thead class="border-b border-outline-variant">
                  <tr>
                    <th class="text-left py-sm px-sm text-on-surface-variant font-label-md">Product</th>
                    <th class="text-left py-sm px-sm text-on-surface-variant font-label-md">Qty</th>
                    <th class="text-left py-sm px-sm text-on-surface-variant font-label-md">Destination</th>
                    <th class="text-left py-sm px-sm text-on-surface-variant font-label-md">Date</th>
                    <th class="text-left py-sm px-sm text-on-surface-variant font-label-md">Status</th>
                  </tr>
                </thead>
                <tbody id="deliveryTableBody">
                  <tr>
                    <td colspan="5" class="text-center py-md text-on-surface-variant">Loading deliveries...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    `;
  }

  attachEventListeners() {
    document.getElementById('barcodeInput').addEventListener('change', (e) => this.handleBarcodeInput(e));
    document.getElementById('quantityInput').addEventListener('input', (e) => this.handleQuantityInput(e));
    document.getElementById('destinationBranchSelect').addEventListener('change', (e) => this.handleBranchSelection(e));
    document.getElementById('deliverButton').addEventListener('click', () => this.submitDelivery());
    document.getElementById('resetButton').addEventListener('click', () => this.resetForm());
    document.getElementById('scanButton').addEventListener('click', () => this.focusBarcodeInput());
  }

  async loadBranches() {
    try {
      const response = await fetch(`${API_BASE}/branches`);
      const data = await response.json();
      this.branches = Array.isArray(data) ? data : [];
      this.populateBranchDropdown();
    } catch (error) {
      console.error('Failed to load branches:', error);
      this.showMessage('Failed to load branches', 'error');
    }
  }

  async loadProducts() {
    try {
      const response = await fetch(`${API_BASE}/products`);
      const data = await response.json();
      this.products = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Failed to load products:', error);
      this.showMessage('Failed to load products', 'error');
    }
  }

  populateBranchDropdown() {
    const select = document.getElementById('destinationBranchSelect');
    select.innerHTML = '<option value="">-- Select a branch --</option>';
    
    // Filter out Main warehouse from destination (you can't deliver to yourself)
    const branchesToShow = this.branches.filter(b => 
      b.name && b.name.toLowerCase() !== 'main' && b.status === 'active'
    );
    
    branchesToShow.forEach(branch => {
      const option = document.createElement('option');
      option.value = branch.id;
      option.textContent = branch.name || branch.branch_name;
      select.appendChild(option);
    });
  }

  async handleBarcodeInput(e) {
    const barcode = e.target.value.trim();
    this.clearError('barcodeError');

    if (!barcode) {
      this.selectedProduct = null;
      document.getElementById('productInfo').classList.add('hidden');
      return;
    }

    // Find product locally first
    const product = this.products.find(p => p.barcode === barcode);
    
    if (!product) {
      this.showError('barcodeError', 'Product not found');
      this.selectedProduct = null;
      document.getElementById('productInfo').classList.add('hidden');
      return;
    }

    this.selectedProduct = product;
    await this.displayProductInfo(product);
  }

  async displayProductInfo(product) {
    try {
      const response = await fetch(`${API_BASE}/inventory?branch=Main`);
      const inventoryData = await response.json();
      const sourceInventory = inventoryData.find(inv => inv.barcode === product.barcode);

      document.getElementById('productName').textContent = product.product_name || 'Unknown';
      document.getElementById('productBarcode').textContent = product.barcode || 'N/A';
      document.getElementById('productCategory').textContent = product.category || 'General';
      document.getElementById('sourceStock').textContent = sourceInventory ? sourceInventory.quantity : '0';

      document.getElementById('productInfo').classList.remove('hidden');
      document.getElementById('quantityInput').disabled = false;
      document.getElementById('destinationBranchSelect').disabled = false;

    } catch (error) {
      console.error('Failed to display product info:', error);
      this.showError('barcodeError', 'Failed to load product details');
    }
  }

  handleQuantityInput(e) {
    this.clearError('quantityError');
    this.updateSummary();
  }

  handleBranchSelection(e) {
    this.clearError('branchError');
    this.selectedDestinationBranch = e.target.value;
    this.updateSummary();
  }

  updateSummary() {
    const qty = Number(document.getElementById('quantityInput').value);
    const branchId = document.getElementById('destinationBranchSelect').value;
    const branch = this.branches.find(b => b.id == branchId);

    if (this.selectedProduct && qty > 0 && branch) {
      document.getElementById('summaryProduct').textContent = this.selectedProduct.product_name;
      document.getElementById('summaryQty').textContent = qty;
      document.getElementById('summaryDest').textContent = branch.name || branch.branch_name;
      document.getElementById('deliverySummary').classList.remove('hidden');
      document.getElementById('deliverButton').disabled = false;
    } else {
      document.getElementById('deliverySummary').classList.add('hidden');
      document.getElementById('deliverButton').disabled = true;
    }
  }

  getSourceBranchId() {
    const mainBranch = this.branches.find((branch) => {
      const name = (branch.branch_name || branch.name || '').toLowerCase();
      const code = (branch.branch_code || '').toLowerCase();
      return name === 'main' || name.includes('main') || code === 'main' || code.includes('main');
    });

    return mainBranch ? mainBranch.id : null;
  }

  async submitDelivery() {
    const qty = Number(document.getElementById('quantityInput').value);
    const branchId = document.getElementById('destinationBranchSelect').value;
    const fromBranchId = this.getSourceBranchId();

    // Validation
    if (!this.selectedProduct) {
      this.showError('barcodeError', 'Please select a product');
      return;
    }
    if (qty <= 0) {
      this.showError('quantityError', 'Quantity must be greater than 0');
      return;
    }
    if (!branchId) {
      this.showError('branchError', 'Please select a destination branch');
      return;
    }
    if (!fromBranchId) {
      this.showMessage('No valid Main Warehouse branch exists in the current database.', 'error');
      return;
    }

    this.isLoading = true;
    document.getElementById('deliverButton').disabled = true;
    document.getElementById('deliverButtonText').textContent = 'Processing...';

    try {
      const response = await fetch(`${API_BASE}/deliver/multi-product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          source_branch_id: fromBranchId,
          destination_branch_id: branchId,
          items: [
            {
              product_uuid: this.selectedProduct.uuid,
              quantity: qty
            }
          ]
        })
      });

      const data = await response.json();

      if (!response.ok) {
        this.showMessage(data.message || 'Delivery failed', 'error');
      } else {
        this.showMessage(`Delivered ${qty} units successfully!`, 'success');
        this.resetForm();
        await this.loadDeliveryHistory();
      }
    } catch (error) {
      console.error('Delivery error:', error);
      this.showMessage('Failed to process delivery: ' + error.message, 'error');
    } finally {
      this.isLoading = false;
      document.getElementById('deliverButton').disabled = false;
      document.getElementById('deliverButtonText').textContent = 'Confirm Delivery';
    }
  }

  resetForm() {
    document.getElementById('barcodeInput').value = '';
    document.getElementById('quantityInput').value = '';
    document.getElementById('destinationBranchSelect').value = '';
    document.getElementById('productInfo').classList.add('hidden');
    document.getElementById('deliverySummary').classList.add('hidden');
    document.getElementById('deliverButton').disabled = true;
    document.getElementById('quantityInput').disabled = true;
    document.getElementById('destinationBranchSelect').disabled = true;
    this.selectedProduct = null;
    this.selectedDestinationBranch = null;
    this.clearError('barcodeError');
    this.clearError('quantityError');
    this.clearError('branchError');
    document.getElementById('barcodeInput').focus();
  }

  focusBarcodeInput() {
    document.getElementById('barcodeInput').focus();
  }

  async loadDeliveryHistory() {
    try {
      const response = await fetch(`${API_BASE}/reports`);
      const data = await response.json();
      
      // Filter for DELIVERY type or recent transactions
      const deliveries = Array.isArray(data) ? data.slice(0, 10) : [];
      
      const tbody = document.getElementById('deliveryTableBody');
      if (deliveries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-md text-on-surface-variant">No deliveries yet</td></tr>';
        return;
      }

      tbody.innerHTML = deliveries.map(d => `
        <tr class="border-b border-outline-variant hover:bg-surface-container-low transition-colors">
          <td class="py-sm px-sm">${d.product_name || d.barcode || 'Unknown'}</td>
          <td class="py-sm px-sm">${d.quantity || '-'}</td>
          <td class="py-sm px-sm">${d.branch || 'N/A'}</td>
          <td class="py-sm px-sm text-on-surface-variant">${new Date(d.date || d.created_at).toLocaleDateString()}</td>
          <td class="py-sm px-sm">
            <span class="px-sm py-xs rounded-full text-body-sm font-label-md ${
              d.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
              d.status === 'completed' ? 'bg-green-100 text-green-800' :
              'bg-gray-100 text-gray-800'
            }">${d.status || 'PENDING'}</span>
          </td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('Failed to load delivery history:', error);
    }
  }

  showMessage(message, type = 'info') {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `rounded-md p-md ${
      type === 'error' ? 'bg-error text-on-primary' :
      type === 'success' ? 'bg-green-500 text-white' :
      'bg-primary text-on-primary'
    }`;
    statusEl.classList.remove('hidden');
    
    setTimeout(() => {
      statusEl.classList.add('hidden');
    }, 5000);
  }

  showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.remove('hidden');
  }

  clearError(elementId) {
    const el = document.getElementById(elementId);
    el.textContent = '';
    el.classList.add('hidden');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new DeliveryManager();
});
