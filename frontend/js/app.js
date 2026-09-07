const logoutBtn = document.getElementById('logoutBtn');

// Helper function to handle API calls with JWT token
async function apiFetch(url) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    headers
  });

  // If token is expired or invalid, clear token and redirect
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
    return;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

// Fallback fetch wrappers using the authenticated helper
async function fetchProducts() {
  return await apiFetch('/api/products');
}

async function fetchInventory() {
  return await apiFetch('/api/inventory');
}

async function fetchReports() {
  return await apiFetch('/api/reports');
}

// Clear token on logout
logoutBtn?.addEventListener('click', () => {
  if (typeof signOutFromApp === 'function') {
    signOutFromApp();
    return;
  }

  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
});

window.addEventListener('DOMContentLoaded', async () => {
  const authState = await ensureAuthenticatedPage();
  if (!authState.authenticated) return;

  if (document.body.contains(document.getElementById('totalProducts'))) {
    updateDashboardProfile();
    setupSidebarToggle();
    loadDashboard();
  }

  if (document.body.contains(document.getElementById('inventoryTable'))) {
    loadInventory();
  }

  if (document.body.contains(document.getElementById('productTable'))) {
    loadProducts();
  }

  if (document.body.contains(document.getElementById('reportTable'))) {
    loadReports();
  }
});

async function loadDashboard() {
  try {
    const [products, inventory, reports] = await Promise.all([
      fetchProducts(),
      fetchInventory(),
      fetchReports()
    ]);

    if (!products || !inventory || !reports) return;

    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    const currentBranch = (userData.branch || 'Bacoor Molino').toString();
    const branchInventory = inventory.filter((item) => item.branch === currentBranch || currentBranch === 'All Branches');
    const branchStatuses = [...new Set(inventory.map((item) => item.branch))];

    const totalStock = inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const availableItemCount = branchInventory.filter((item) => item.quantity > 10).length;
    const lowStockItems = branchInventory.filter((item) => item.quantity > 0 && item.quantity <= 10);
    const outOfStockItems = branchInventory.filter((item) => item.quantity <= 0);
    const expiringSoonItems = inventory.filter((item) => item.expiration_date && new Date(item.expiration_date) <= new Date(Date.now() + 1000 * 60 * 60 * 24 * 30));
    const overviewTotalCount = Math.max(1, availableItemCount + lowStockItems.length + outOfStockItems.length + expiringSoonItems.length);

    document.getElementById('totalProducts').textContent = products.length;
    document.getElementById('totalStockCount').textContent = totalStock;
    document.getElementById('lowStockCount').textContent = lowStockItems.length;
    document.getElementById('outOfStockCount').textContent = outOfStockItems.length;
    document.getElementById('totalBranchesCount').textContent = branchStatuses.length;
    document.getElementById('inventoryAvailableCount').textContent = availableItemCount;
    document.getElementById('inventoryLowCount').textContent = lowStockItems.length;
    document.getElementById('inventoryOutCount').textContent = outOfStockItems.length;
    document.getElementById('inventoryExpiringCount').textContent = expiringSoonItems.length;

    setProgressBar('inventoryAvailableBar', availableItemCount, overviewTotalCount);
    setProgressBar('inventoryLowBar', lowStockItems.length, overviewTotalCount);
    setProgressBar('inventoryOutBar', outOfStockItems.length, overviewTotalCount);
    setProgressBar('inventoryExpiringBar', expiringSoonItems.length, overviewTotalCount);

    document.getElementById('pendingDispatchCount').textContent = reports.filter((row) => row.type && row.type.toUpperCase() === 'TRANSFER').length;

    const stockAlertsList = document.getElementById('stockAlertsList');
    if (stockAlertsList) {
      const alerts = [...outOfStockItems, ...lowStockItems.filter((item) => item.quantity > 0)].slice(0, 6);
      stockAlertsList.innerHTML = alerts.map((item) => {
        const status = formatAlertStatus(item);
        return `
          <div class="alert-item">
            <div class="alert-item__header">
              <h3 class="alert-item__title">${item.product_name}</h3>
              <span class="alert-item__status ${status.className}">${status.label}</span>
            </div>
            <div class="alert-item__details">
              <div>Branch: ${item.branch}</div>
              <div>Quantity: ${item.quantity}</div>
              <div>Minimum Stock: 10</div>
            </div>
            <button class="alert-item__action" type="button">Review</button>
          </div>
        `;
      }).join('');
    }

    const recentActivityBody = document.getElementById('recentActivityBody');
    if (recentActivityBody) {
      recentActivityBody.innerHTML = reports.slice(0, 8).map((row) => `
        <tr>
          <td>${row.type || 'Update'}</td>
          <td>${row.product_name}</td>
          <td>${row.quantity}</td>
          <td>${row.branch || 'N/A'}</td>
          <td>${row.user || 'System'}</td>
          <td>${new Date(row.date).toLocaleString()}</td>
        </tr>
      `).join('');
    }

    const recentDispatchesBody = document.getElementById('recentDispatchesBody');
    if (recentDispatchesBody) {
      recentDispatchesBody.innerHTML = reports.slice(0, 6).map((row) => `
        <tr>
          <td>${row.id || '—'}</td>
          <td>${row.branch || 'N/A'}</td>
          <td>${row.product_name}</td>
          <td>${row.quantity}</td>
          <td>${new Date(row.date).toLocaleDateString()}</td>
          <td><span class="${getStatusBadge(row.type)}">${formatDispatchStatus(row)}</span></td>
        </tr>
      `).join('');
    }

    const branchInventoryList = document.getElementById('branchInventoryList');
    if (branchInventoryList) {
      const branchGroups = branchStatuses.map((branch) => {
        const items = inventory.filter((item) => item.branch === branch);
        const branchTotal = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const branchLow = items.filter((item) => item.quantity <= 10).length;
        const branchOut = items.filter((item) => item.quantity <= 0).length;
        return { branch, items, branchTotal, branchLow, branchOut };
      }).slice(0, 5);

      branchInventoryList.innerHTML = branchGroups.map((group) => `
        <div class="branch-summary-item">
          <h3>${group.branch}</h3>
          <dl>
            <div><dt>Total Products</dt><dd>${group.items.length}</dd></div>
            <div><dt>Total Stock</dt><dd>${group.branchTotal}</dd></div>
            <div><dt>Low Stock</dt><dd>${group.branchLow}</dd></div>
            <div><dt>Out of Stock</dt><dd>${group.branchOut}</dd></div>
          </dl>
        </div>
      `).join('');
    }

    if (typeof setupSocket === 'function') {
      setupSocket(() => loadDashboard());
    }
  } catch (error) {
    console.error('Dashboard load failed', error);
  }
}

function updateDashboardProfile() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const profileName = document.getElementById('profileName');
  if (profileName && user.username) {
    profileName.textContent = user.username;
  }
}

function setProgressBar(elementId, value, total) {
  const fill = document.getElementById(elementId);
  if (!fill) return;
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  fill.style.width = `${percent}%`;
}

function setupSidebarToggle() {
  const toggle = document.getElementById('sidebarToggleBtn');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
}

function getStatusBadge(type) {
  if (!type) return 'badge badge--processing';
  const normalized = type.toString().toUpperCase();
  if (normalized === 'RECEIVE') return 'badge badge--received';
  if (normalized === 'CONSUME') return 'badge badge--processing';
  if (normalized === 'TRANSFER') return 'badge badge--pending';
  return 'badge badge--processing';
}

function formatDispatchStatus(row) {
  if (!row || !row.type) return 'Pending';
  const type = row.type.toUpperCase();
  if (type === 'TRANSFER') return 'Pending';
  if (type === 'RECEIVE') return 'Received';
  if (type === 'CONSUME') return 'Processing';
  return 'Pending';
}

function formatAlertStatus(item) {
  if (item.quantity <= 0) return { label: 'Out of Stock', className: 'status-badge--critical' };
  if (item.quantity <= 10) return { label: 'Low Stock', className: 'status-badge--low' };
  return { label: 'Available', className: 'status-badge--received' };
}

async function loadInventory() {
  try {
    const inventory = await fetchInventory();
    if (!inventory) return;

    const tbody = document.querySelector('#inventoryTable tbody');
    if (tbody) {
      tbody.innerHTML = inventory.map((item) => `
        <tr>
          <td>${item.barcode}</td>
          <td>${item.product_name}</td>
          <td>${item.category || '-'}</td>
          <td>${item.branch}</td>
          <td>${item.quantity}</td>
          <td>${new Date(item.last_updated).toLocaleString()}</td>
        </tr>
      `).join('');
    }
  } catch (error) {
    console.error('Inventory load failed', error);
  }
}

async function loadProducts() {
  try {
    const products = await fetchProducts();
    if (!products) return;

    const tbody = document.querySelector('#productTable tbody');
    if (tbody) {
      tbody.innerHTML = products.map((product) => {
        const stock = Number(product.total_quantity || 0);
        const status = stock <= 0 ? 'Out of stock' : stock <= 10 ? 'Low stock' : 'Available';
        return `
          <tr>
            <td>${product.barcode}</td>
            <td>${product.product_name}</td>
            <td>${product.category || '-'}</td>
            <td>${stock}</td>
            <td>${status}</td>
            <td>${product.expiration_date || '-'}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (error) {
    console.error('Product load failed', error);
  }
}

async function loadReports() {
  try {
    const reports = await fetchReports();
    if (!reports) return;

    const branchFilter = document.getElementById('reportBranchFilter')?.value?.trim();
    const productFilter = document.getElementById('reportProductFilter')?.value?.trim();
    const typeFilter = document.getElementById('reportTypeFilter')?.value || '';

    const filteredReports = reports.filter((row) => {
      const matchesBranch = !branchFilter || `${row.branch || ''}`.toLowerCase().includes(branchFilter.toLowerCase());
      const matchesProduct = !productFilter || `${row.product_name || ''}`.toLowerCase().includes(productFilter.toLowerCase());
      const matchesType = !typeFilter || row.type === typeFilter;
      return matchesBranch && matchesProduct && matchesType;
    });

    const tbody = document.querySelector('#reportTable tbody');
    if (tbody) {
      tbody.innerHTML = filteredReports.map((row) => `
        <tr>
          <td>${row.product_name}</td>
          <td>${row.type}</td>
          <td>${row.quantity}</td>
          <td>${row.branch}</td>
          <td>${row.user}</td>
          <td>${new Date(row.date).toLocaleString()}</td>
        </tr>
      `).join('');
    }
  } catch (error) {
    console.error('Report load failed', error);
  }
}

if (document.getElementById('reportFilterBtn')) {
  document.getElementById('reportFilterBtn').addEventListener('click', loadReports);
}