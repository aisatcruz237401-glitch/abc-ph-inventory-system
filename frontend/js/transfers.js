/**
 * Serialized-Item Transfer Workflow
 * 
 * Manages:
 * - Pasong Buaya Main Source as fixed source branch
 * - Scanned serialized unit barcode validation
 * - Individual serialized item management
 * - Transfer creation by grouping items by product
 * - Transfer history display
 */

const SOURCE_BRANCH_NAME = 'Pasong Buaya';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class SerializedTransferManager {
  constructor() {
    this.scannedItems = []; // Array of { productUuid, productName, barcode, id }
    this.sourceBranchId = null;
    this.sourceBranchName = SOURCE_BRANCH_NAME;
    
    this.initializeElements();
    this.attachEventListeners();
    this.loadBranches();
    this.loadTransferHistory();
  }

  initializeElements() {
    // Modal
    this.modal = document.getElementById('modal-overlay');
    this.openBtn = document.getElementById('btn-new-transfer');
    this.closeBtn = document.getElementById('close-modal');
    this.cancelBtn = document.getElementById('cancel-modal');

    // Form inputs
    this.sourceBranchSelect = document.getElementById('sourceBranch');
    this.destBranchSelect = document.getElementById('destBranch');
    this.serializedBarcodeInput = document.getElementById('serializedItemBarcodeInput');
    this.addItemBtn = document.getElementById('addSerializedItemBtn');
    this.confirmTransferBtn = document.getElementById('confirmTransferBtn');

    // Transfer items list
    this.transferItemsList = document.getElementById('transferItemsList');

    // Transfer history
    this.transferHistoryBody = document.getElementById('transfer-history-body');
  }

  attachEventListeners() {
    this.openBtn?.addEventListener('click', () => this.openModal());
    this.closeBtn?.addEventListener('click', () => this.closeModal());
    this.cancelBtn?.addEventListener('click', () => this.closeModal());

    this.addItemBtn?.addEventListener('click', () => this.addScannedItem());
    this.serializedBarcodeInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addScannedItem();
      }
    });

    this.confirmTransferBtn?.addEventListener('click', () => this.submitTransfer());
  }

  // =============================
  // Modal Management
  // =============================

  openModal() {
    this.resetForm();
    this.modal?.classList.remove('hidden');
  }

  closeModal() {
    this.modal?.classList.add('hidden');
  }

  resetForm() {
    this.scannedItems = [];
    this.destBranchSelect.value = '';
    if (this.serializedBarcodeInput) {
      this.serializedBarcodeInput.value = '';
      this.serializedBarcodeInput.focus();
    }
    this.renderTransferItems();
  }

  // =============================
  // Branch Management
  // =============================

  async loadBranches() {
    try {
      const response = await fetch('/api/branches');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const branches = await response.json();
      if (!Array.isArray(branches)) throw new Error('Invalid response format');

      // Populate destination branch select
      this.destBranchSelect.innerHTML = '<option value="">Select Destination</option>';

      // Find and set Pasong Buaya as source
      const sourceBranch = branches.find(branch => 
        String(branch.branch_name || '').trim().toLowerCase() === SOURCE_BRANCH_NAME.toLowerCase()
      );

      if (sourceBranch) {
        this.sourceBranchId = sourceBranch.id;
        this.sourceBranchName = sourceBranch.branch_name;
        if (this.sourceBranchSelect) {
          this.sourceBranchSelect.value = sourceBranch.id;
          this.sourceBranchSelect.disabled = true;
        }
      } else {
        console.warn(`Source branch "${SOURCE_BRANCH_NAME}" not found`);
      }

      // Populate destination options (all branches except source)
      branches.forEach(branch => {
        if (branch.id !== this.sourceBranchId) {
          const option = document.createElement('option');
          option.value = branch.id;
          option.textContent = branch.branch_name;
          this.destBranchSelect.appendChild(option);
        }
      });

      console.log('✓ Source branch locked to:', this.sourceBranchName);
      console.log('✓ Destination branches loaded:', branches.length - 1);
    } catch (error) {
      console.error('Failed to load branches:', error);
      this.destBranchSelect.innerHTML = '<option value="">Failed to load branches</option>';
    }
  }

  // =============================
  // Serialized Item Scanning
  // =============================

  async addScannedItem() {
    if (!this.serializedBarcodeInput) return;

    const barcode = String(this.serializedBarcodeInput.value || '').trim();
    if (!barcode) {
      alert('Please scan or enter a serialized unit barcode.');
      return;
    }

    try {
      // Validate the barcode via the status endpoint
      const response = await fetch(`/api/intake/status/${encodeURIComponent(barcode)}`);
      const statusBody = await response.json();

      if (!response.ok || !statusBody?.success) {
        alert(statusBody?.message || 'Serialized unit barcode is not valid or not found.');
        this.serializedBarcodeInput.value = '';
        this.serializedBarcodeInput.focus();
        return;
      }

      const productUuid = statusBody.product_uuid;
      const productName = statusBody.product_name || 'Unknown product';
      const itemStatus = String(statusBody.status || '').toUpperCase();
      const serializedUnitId = statusBody.serialized_unit_id;

      if (!serializedUnitId) {
        alert('The serialized unit record is missing its database ID.');
        this.serializedBarcodeInput.value = '';
        this.serializedBarcodeInput.focus();
        return;
      }

      // Only AVAILABLE items can be transferred
      if (itemStatus !== 'AVAILABLE') {
        alert(`This serialized unit is currently ${itemStatus.toLowerCase()} and cannot be transferred.`);
        this.serializedBarcodeInput.value = '';
        this.serializedBarcodeInput.focus();
        return;
      }

      // Check for duplicates
      if (this.scannedItems.some(item => item.barcode === barcode)) {
        alert('This serialized unit is already in the transfer list.');
        this.serializedBarcodeInput.value = '';
        this.serializedBarcodeInput.focus();
        return;
      }

      // Add to scanned items
      this.scannedItems.push({
        productUuid,
        productName,
        barcode,
        serializedUnitId,
        id: `${productUuid}-${barcode}`
      });

      console.log('✓ Serialized item added:', barcode, productName);

      // Clear input and re-focus
      this.serializedBarcodeInput.value = '';
      this.serializedBarcodeInput.focus();

      this.renderTransferItems();
    } catch (error) {
      console.error('Error adding serialized item:', error);
      alert('Failed to validate serialized unit. Please try again.');
      this.serializedBarcodeInput.value = '';
      this.serializedBarcodeInput.focus();
    }
  }

  removeScannedItem(barcode) {
    this.scannedItems = this.scannedItems.filter(item => item.barcode !== barcode);
    console.log('✓ Serialized item removed:', barcode);
    this.renderTransferItems();
  }

  renderTransferItems() {
    if (!this.transferItemsList) return;

    if (this.scannedItems.length === 0) {
      this.transferItemsList.innerHTML = '<div class="text-center text-secondary p-4">No serialized items scanned yet</div>';
      return;
    }

    // Group items by product for display
    const groups = new Map();
    this.scannedItems.forEach(item => {
      if (!groups.has(item.productUuid)) {
        groups.set(item.productUuid, {
          productUuid: item.productUuid,
          productName: item.productName,
          barcodes: [],
          count: 0
        });
      }
      const group = groups.get(item.productUuid);
      group.barcodes.push(item.barcode);
      group.count += 1;
    });

    this.transferItemsList.innerHTML = Array.from(groups.values()).map(group => `
      <div class="flex items-center justify-between gap-4 p-4 border border-outline-variant rounded-lg bg-surface-container-low">
        <div class="flex-1 min-w-0">
          <div class="font-body-md text-on-surface font-medium">${escapeHtml(group.productName)}</div>
          <div class="font-label-md text-label-md text-secondary">
            ${group.barcodes.slice(0, 2).map(b => `<div class="font-data-mono text-xs">${escapeHtml(b)}</div>`).join('')}
            ${group.barcodes.length > 2 ? `<div class="font-data-mono text-xs text-outline">+${group.barcodes.length - 2} more</div>` : ''}
          </div>
        </div>
        <div class="text-right whitespace-nowrap">
          <div class="font-headline-md text-headline-md font-data-mono text-on-surface">${group.count}</div>
          <div class="font-label-md text-label-md text-secondary">item(s)</div>
        </div>
        <button
          type="button"
          class="text-error hover:bg-error/10 px-2 py-1 rounded transition-colors"
          onclick="window.transferManager.removeProductGroup('${escapeHtml(group.productUuid)}')"
          title="Remove all items of this product"
        >
          <span class="material-symbols-outlined text-[20px]">delete</span>
        </button>
      </div>
    `).join('');
  }

  removeProductGroup(productUuid) {
    this.scannedItems = this.scannedItems.filter(item => item.productUuid !== productUuid);
    console.log('✓ Product group removed:', productUuid);
    this.renderTransferItems();
  }

  // =============================
  // Transfer Submission
  // =============================

  async submitTransfer() {
    const destBranchId = this.destBranchSelect?.value;

    if (!this.sourceBranchId) {
      alert('Source branch (Pasong Buaya Main Source) is not available.');
      return;
    }

    if (!destBranchId) {
      alert('Please select a destination branch.');
      return;
    }

    if (this.sourceBranchId === destBranchId) {
      alert('Source and destination branches must be different.');
      return;
    }

    if (this.scannedItems.length === 0) {
      alert('Please scan at least one serialized item to transfer.');
      return;
    }

    try {
      this.confirmTransferBtn.disabled = true;
      this.confirmTransferBtn.textContent = 'Creating transfer...';

      // Group scanned items by product to calculate quantities
      const groups = new Map();
      this.scannedItems.forEach(item => {
        if (!groups.has(item.productUuid)) {
          groups.set(item.productUuid, {
            product_uuid: item.productUuid,
            serialized_unit_ids: [],
            productName: item.productName
          });
        }
          groups.get(item.productUuid).serialized_unit_ids.push(item.serializedUnitId);
      });

      const payload = {
        from_branch_id: this.sourceBranchId,
        to_branch_id: destBranchId,
        items: Array.from(groups.values()).map(g => ({
          product_uuid: g.product_uuid,
          serialized_unit_ids: g.serialized_unit_ids
        }))
      };

      console.log('Submitting serialized transfer:', payload);
      console.log('Scanned item barcodes:', this.scannedItems.map(i => i.barcode).join(', '));

      const response = await fetch('/api/deliver/multi-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Transfer failed');
      }

      if (!result.success) {
        throw new Error(result.message || 'Transfer failed');
      }

      // Success
      const trackingCode = result.transfer?.tracking_code || 'N/A';
      console.log('✓ Transfer created:', trackingCode);
      console.log('✓ Items moved to IN_TRANSIT');

      this.showSuccessMessage(`Transfer created successfully!\nTracking Code: ${trackingCode}\n${this.scannedItems.length} serialized item(s) in transit.`);

      // Close modal
      this.closeModal();
      this.resetForm();

      // Reload transfer history
      setTimeout(() => {
        this.loadTransferHistory();
      }, 500);

    } catch (error) {
      console.error('Transfer submission failed:', error);
      alert(`Transfer failed: ${error.message}`);
    } finally {
      this.confirmTransferBtn.disabled = false;
      this.confirmTransferBtn.textContent = 'Confirm Transfer';
    }
  }

  showSuccessMessage(message) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'fixed top-6 right-6 z-[100] px-5 py-3 rounded-lg bg-secondary-container text-primary border border-primary/20 shadow-lg font-label-md whitespace-pre-line';
    msgDiv.textContent = message;
    document.body.appendChild(msgDiv);

    setTimeout(() => msgDiv.remove(), 4000);
  }

  // =============================
  // Transfer History
  // =============================

  async loadTransferHistory() {
    try {
      const response = await fetch('/api/transfers');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const history = await response.json();
      if (!Array.isArray(history)) throw new Error('Invalid response format');

      this.renderTransferHistory(history);
      console.log('✓ Transfer history loaded:', history.length);

    } catch (error) {
      console.error('Failed to load transfer history:', error);
      this.transferHistoryBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-secondary">Failed to load history</td></tr>';
    }
  }

  renderTransferHistory(history) {
    if (!this.transferHistoryBody) return;

    if (history.length === 0) {
      this.transferHistoryBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-secondary">No transfers found</td></tr>';
      return;
    }

    this.transferHistoryBody.innerHTML = history.slice(0, 10).map(item => {
      const status = item.status || 'UNKNOWN';
      const statusColor = status === 'RECEIVED' ? 'text-green-700' : status === 'IN_TRANSIT' ? 'text-blue-700' : 'text-orange-700';
      const date = new Date(item.date || item.delivery_created_at).toLocaleDateString();

      return `
        <tr class="border-b border-outline-variant hover:bg-surface-container-low transition-colors">
          <td class="px-6 py-4 font-data-mono text-body-sm text-primary">${this.escapeHtml(item.tracking_code || 'N/A')}</td>
          <td class="px-6 py-4 text-body-sm text-on-surface">${this.escapeHtml(item.source_branch || item.branch || 'N/A')}</td>
          <td class="px-6 py-4 text-body-sm text-on-surface">${this.escapeHtml(item.destination_branch || 'N/A')}</td>
          <td class="px-6 py-4 text-body-sm text-on-surface">${this.escapeHtml(item.products?.[0]?.product_name || 'Multiple' || 'N/A')}</td>
          <td class="px-6 py-4 text-body-sm text-right font-data-mono text-on-surface">${item.quantity || 0}</td>
          <td class="px-6 py-4 text-body-sm text-secondary">${date}</td>
          <td class="px-6 py-4 text-body-sm">
            <span class="px-2 py-1 rounded-full font-label-md text-label-md ${statusColor} bg-opacity-10" style="background-color: currentColor; opacity: 0.1;">
              ${status}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // =============================
  // Utility Functions
  // =============================

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.transferManager = new SerializedTransferManager();
  console.log('✓ Serialized transfer manager initialized');
});
