const consumeForm = document.getElementById('consumeForm');
const consumeMessage = document.getElementById('consumeMessage');
const branchContextMessage = document.getElementById('branchContextMessage');
const branchSelect = document.getElementById('branch');
const productSelect = document.getElementById('productSelect');
const barcodeInput = document.getElementById('barcode');

async function populateBranchSelect() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const selectedBranch = user.branch || 'Bacoor Molino';

  try {
    const branchOptions = Array.isArray(branches) ? branches : [];

    if (branchSelect) {
      branchSelect.innerHTML = branchOptions.map((branchItem) => `
        <option value="${branchItem.id}" ${branchItem.branch_name === selectedBranch ? 'selected' : ''}>
          ${branchItem.branch_name}
        </option>
      `).join('');
    }

    if (branchContextMessage) {
      branchContextMessage.textContent = `Branch context: ${selectedBranch}`;
    }
  } catch (error) {
    if (branchSelect) {
      branchSelect.innerHTML = `<option value="${selectedBranch}">${selectedBranch}</option>`;
    }
  }
}

async function populateProductSelect() {
  try {
    const products = await fetchProducts();
    if (!productSelect) return;

    productSelect.innerHTML = ['<option value="">Select product</option>',
      ...products.map((product) => `
        <option value="${product.barcode}">${product.product_name} (${product.category || 'Uncategorized'})</option>
      `)
    ].join('');

    productSelect.onchange = () => {
      if (barcodeInput) {
        barcodeInput.value = productSelect.value || '';
      }
    };
  } catch (error) {
    if (productSelect) {
      productSelect.innerHTML = '<option value="">Unable to load products</option>';
    }
  }
}

consumeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const barcode = barcodeInput?.value.trim();
  const quantity = Number(document.getElementById('quantity').value);
  const branch = branchSelect?.value?.trim() || document.getElementById('branch').value.trim();

  if (!barcode) {
    setConsumeMessage('Please select or scan a product before consuming.', 'error');
    return;
  }

  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const branchId = branchSelect?.value || null;
    const result = await consumeStock({
      barcode,
      quantity,
      branch_id: branchId || undefined,
      branch: branchId || undefined,
      user: user.username || 'admin',
    });
    setConsumeMessage(result.message, 'success');
    consumeForm.reset();
    await populateBranchSelect();
    await populateProductSelect();
  } catch (error) {
    setConsumeMessage(error.message, 'error');
  }
});

function setConsumeMessage(text, type = 'success') {
  if (!consumeMessage) return;
  consumeMessage.textContent = text;
  consumeMessage.classList.remove('success', 'error');
  consumeMessage.classList.add(type);
}

window.addEventListener('DOMContentLoaded', async () => {
  await populateBranchSelect();
  await populateProductSelect();
});
