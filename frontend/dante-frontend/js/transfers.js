console.log('[transfers.js] File loaded');

// ==========================================
// TRANSFER HISTORY
// ==========================================
let transferHistoryData = [];
let transferHistoryPage = 1;
const transferHistoryPageSize = 10;
const SOURCE_BRANCH_NAME = 'Pasong Buaya';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadTransferHistory() {
    try {
        console.log('Loading transfer history...');

        const token = localStorage.getItem('token');
        const response = await fetch('/api/transfers/history', {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('Transfer history response:', data);

        const tableBody = document.getElementById('transfer-history-body');
        if (!tableBody) {
            console.error('transfer-history-body not found.');
            return data;
        }

        tableBody.innerHTML = '';

        if (!Array.isArray(data) || data.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="px-6 py-8 text-center text-secondary">No transfer history found.</td>
                </tr>
            `;

            transferHistoryData = [];
            transferHistoryPage = 1;
            updateTransferHistoryPagination();
            return data;
        }

        const transfers = [];
        const transferOuts = data.filter(transaction => transaction.type === 'TRANSFER_OUT');
        const transferIns = data.filter(transaction => transaction.type === 'TRANSFER_IN');

        transferOuts.forEach(out => {
            const matchingIn = transferIns.find(
                incoming => incoming.tracking_code && incoming.tracking_code === out.tracking_code
            );

            const productName =
                out.products?.product_name ||
                matchingIn?.products?.product_name ||
                out.barcode ||
                'Unknown Product';

            const date = out.date ? new Date(out.date).toLocaleString() : '—';

            transfers.push({
                id: out.id,
                source: out.branch,
                destination: matchingIn?.branch || '—',
                product: productName,
                quantity: out.quantity,
                date,
                status: out.status || matchingIn?.status || 'IN_TRANSIT'
            });
        });

        transferHistoryData = transfers;
        const startIndex = (transferHistoryPage - 1) * transferHistoryPageSize;
        const endIndex = startIndex + transferHistoryPageSize;
        const pageTransfers = transferHistoryData.slice(startIndex, endIndex);

        pageTransfers.forEach(transfer => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-surface-container-low/50 transition-colors';
            row.innerHTML = `
                <td class="px-6 py-4 font-data-mono text-data-mono text-on-surface">TRX-${transfer.id}</td>
                <td class="px-6 py-4 text-body-md text-on-surface">${escapeHtml(transfer.source)}</td>
                <td class="px-6 py-4 text-body-md text-on-surface">${escapeHtml(transfer.destination)}</td>
                <td class="px-6 py-4 text-body-md text-on-surface font-medium">${escapeHtml(transfer.product)}</td>
                <td class="px-6 py-4 font-data-mono text-data-mono text-on-surface text-right">${transfer.quantity}</td>
                <td class="px-6 py-4 text-body-sm text-secondary">${escapeHtml(transfer.date)}</td>
                <td class="px-6 py-4">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary-container/50 text-primary border border-primary/20">
                        <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
                        ${transfer.status === 'RECEIVED' ? 'Completed' : 'In Transit'}
                    </span>
                </td>
            `;
            tableBody.appendChild(row);
        });

        const countElement = document.getElementById('transfer-history-count');
        if (countElement) {
            const total = transferHistoryData.length;
            const start = total === 0 ? 0 : (transferHistoryPage - 1) * transferHistoryPageSize + 1;
            const end = Math.min(transferHistoryPage * transferHistoryPageSize, total);
            countElement.textContent = total === 0 ? 'Showing 0 entries' : `Showing ${start} to ${end} of ${total} entries`;
        }

        updateTransferHistoryPagination();
        console.log('Transfer history rendered:', data.length, 'records');
        return data;
    } catch (error) {
        console.error('Failed to load transfer history:', error);
        return [];
    }
}

function updateTransferHistoryPagination() {
    const prevButton = document.getElementById('transfer-history-prev');
    const nextButton = document.getElementById('transfer-history-next');
    if (!prevButton || !nextButton) return;

    const totalPages = Math.ceil(transferHistoryData.length / transferHistoryPageSize);
    prevButton.disabled = transferHistoryPage <= 1;
    nextButton.disabled = transferHistoryPage >= totalPages;
}

const MAIN_SOURCE_BRANCH_NAME = 'Pasong Buaya Main Source';
const intakeUiState = {
    products: [],
    product: null,
    generatedBarcode: '',
    scannedBarcode: '',
    registrationComplete: false,
    nextSequenceNumber: 1,
};

function getMainSourceIntakeDateValue() {
    const field = document.getElementById('mainSourceIntakeDate');
    const raw = field ? String(field.value || '').trim() : '';
    return raw || '';
}

function formatProductPrefix(productName) {
    const letters = String(productName || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    if (!letters) {
        return 'AB';
    }
    return letters.slice(0, 2).padEnd(2, 'X');
}

function normalizeBarcodeDateForPattern(dateValue) {
    const raw = String(dateValue || '').trim();
    if (!raw) {
        return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [year, month, day] = raw.split('-');
        return `${day}${month}${year}`;
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
        const [day, month, year] = raw.split('/');
        return `${day}${month}${year}`;
    }

    if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
        const [day, month, year] = raw.split('-');
        return `${day}${month}${year}`;
    }

    return '';
}

function buildGeneratedItemBarcode(productName, intakeDate, sequenceNumber) {
    const prefix = formatProductPrefix(productName || 'Product');
    const datePart = normalizeBarcodeDateForPattern(intakeDate);
    if (!datePart) {
        throw new Error('Select the intake date before generating the item barcode.');
    }

    const sequence = Number(sequenceNumber || 1);
    return `${prefix}${datePart}${String(sequence).padStart(3, '0')}`;
}

function getNextGeneratedBarcode() {
    const productName = intakeUiState.product?.product_name || 'Product';
    const intakeDate = getMainSourceIntakeDateValue();

    if (!intakeDate) {
        throw new Error('Select the intake date before generating the item barcode.');
    }

    const currentSequence = Number(intakeUiState.nextSequenceNumber || 1);
    return buildGeneratedItemBarcode(productName, intakeDate, currentSequence);
}

async function populateMainSourceIntakeProducts() {
    const select = document.getElementById('mainSourceProductSelect');
    if (!select) {
        console.error('Product selector element not found');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        console.log('Loading products with token:', !!token);

        const response = await fetch('/api/products', {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });

        console.log('Products API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`HTTP ${response.status}:`, errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const products = await response.json();
        console.log('Products loaded:', products?.length || 0, 'products');
        console.log('Product list:', products);

        intakeUiState.products = Array.isArray(products) ? products : [];
        select.innerHTML = '<option value="">Select Product</option>';

        if (intakeUiState.products.length === 0) {
            console.warn('No products returned from API');
            select.innerHTML += '<option disabled>No products available</option>';
            return;
        }

        intakeUiState.products.forEach((product) => {
            const option = document.createElement('option');
            option.value = product.uuid || product.id || '';
            option.textContent = `${product.product_name || 'Unknown product'} (${product.barcode || 'N/A'})`;
            console.log('Adding product option:', option.textContent);
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load Main Source intake products:', error);
        select.innerHTML = '<option value="">Error loading products</option>';
    }
}

function updateProductPrefixDisplay() {
    const prefixWrap = document.getElementById('mainSourceProductPrefixWrap');
    const prefixEl = document.getElementById('mainSourceProductPrefix');
    const selectedProduct = intakeUiState.product;

    if (!prefixWrap || !prefixEl) return;

    if (!selectedProduct) {
        prefixWrap.classList.add('hidden');
        prefixEl.textContent = 'AB';
        return;
    }

    const prefix = formatProductPrefix(selectedProduct.product_name || 'Product');
    prefixEl.textContent = prefix;
    prefixWrap.classList.remove('hidden');
}

function clearGeneratedBarcodeState() {
    intakeUiState.generatedBarcode = '';
    intakeUiState.scannedBarcode = '';
    intakeUiState.registrationComplete = false;

    const generatedDisplay = document.getElementById('generatedBarcodeDisplay');
    const labelSection = document.getElementById('labelPreviewSection');
    const verificationCard = document.getElementById('scanVerificationCard');
    const registrationStatus = document.getElementById('mainSourceRegistrationStatus');
    const generateNextBtn = document.getElementById('generateNextItemBtn');
    const verifyInput = document.getElementById('generatedItemScanInput');

    if (generatedDisplay) {
        generatedDisplay.textContent = 'Not generated';
    }

    if (labelSection) {
        labelSection.classList.add('hidden');
    }

    if (verificationCard) {
        verificationCard.classList.add('hidden');
    }

    if (registrationStatus) {
        registrationStatus.classList.add('hidden');
        registrationStatus.textContent = '';
    }

    if (generateNextBtn) {
        generateNextBtn.classList.add('hidden');
    }

    if (verifyInput) {
        verifyInput.value = '';
    }
}

function renderGeneratedBarcodePreview() {
    const generatedDisplay = document.getElementById('generatedBarcodeDisplay');
    const labelSection = document.getElementById('labelPreviewSection');
    const labelProductName = document.getElementById('labelProductName');
    const labelBarcodeValue = document.getElementById('labelBarcodeValue');
    const labelBarcodeLarge = document.getElementById('labelBarcodeLarge');
    const labelBarcodeFooter = document.getElementById('labelBarcodeFooter');

    if (!generatedDisplay || !labelSection || !labelProductName || !labelBarcodeValue || !labelBarcodeLarge || !labelBarcodeFooter) return;

    if (!intakeUiState.generatedBarcode) {
        generatedDisplay.textContent = 'Not generated';
        labelSection.classList.add('hidden');
        return;
    }

    generatedDisplay.textContent = intakeUiState.generatedBarcode;
    labelProductName.textContent = intakeUiState.product?.product_name || 'Unknown product';
    labelBarcodeValue.textContent = intakeUiState.generatedBarcode;
    labelBarcodeLarge.textContent = intakeUiState.generatedBarcode;
    labelBarcodeFooter.textContent = intakeUiState.generatedBarcode;
    labelSection.classList.remove('hidden');
}

const barcodePrintDefaults = {
    labelWidth: 40,
    labelHeight: 20,
    barcodeWidth: 36,
    barcodeHeight: 14,
    textSize: 8,
};

function clampBarcodePrintNumber(value, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return fallback;
    }
    return numericValue;
}

function getBarcodePrintSettings() {
    const labelWidth = clampBarcodePrintNumber(document.getElementById('barcodePrintLabelWidth')?.value, barcodePrintDefaults.labelWidth);
    const labelHeight = clampBarcodePrintNumber(document.getElementById('barcodePrintLabelHeight')?.value, barcodePrintDefaults.labelHeight);
    const barcodeWidth = clampBarcodePrintNumber(document.getElementById('barcodePrintBarcodeWidth')?.value, barcodePrintDefaults.barcodeWidth);
    const barcodeHeight = clampBarcodePrintNumber(document.getElementById('barcodePrintBarcodeHeight')?.value, barcodePrintDefaults.barcodeHeight);
    const textSize = clampBarcodePrintNumber(document.getElementById('barcodePrintTextSize')?.value, barcodePrintDefaults.textSize);

    return {
        labelWidth,
        labelHeight,
        barcodeWidth,
        barcodeHeight,
        textSize,
    };
}

function getBarcodePrintValidationMessage(settings = getBarcodePrintSettings()) {
    if (settings.labelWidth <= 0 || settings.labelHeight <= 0) {
        return 'Label size must be greater than zero.';
    }
    if (settings.barcodeWidth <= 0 || settings.barcodeHeight <= 0) {
        return 'Barcode size must be greater than zero.';
    }
    if (settings.textSize <= 0) {
        return 'Text size must be greater than zero.';
    }
    if (settings.barcodeWidth > settings.labelWidth) {
        return 'Barcode width cannot exceed the label width.';
    }
    if (settings.barcodeHeight > settings.labelHeight) {
        return 'Barcode height cannot exceed the label height.';
    }
    return '';
}

function renderBarcodePrintPreview() {
    const previewLabel = document.getElementById('barcodePrintPreviewLabel');
    const previewCanvas = document.getElementById('barcodePrintPreviewCanvas');
    const previewText = document.getElementById('barcodePrintPreviewText');
    const previewDimensions = document.getElementById('barcodePrintPreviewDimensions');
    const validationEl = document.getElementById('barcodePrintValidationMessage');
    const printButton = document.getElementById('barcodePrintConfirmBtn');

    if (!previewLabel || !previewCanvas || !previewText || !previewDimensions) return;

    const settings = getBarcodePrintSettings();
    const validationMessage = getBarcodePrintValidationMessage(settings);
    console.log('CODE128 PRINT SETTINGS', {
        width: 2.2,
        height: 52,
        margin: 8,
        displayValue: false,
        format: 'CODE128',
        labelWidth: settings.labelWidth,
        labelHeight: settings.labelHeight,
        barcodeWidth: settings.barcodeWidth,
        barcodeHeight: settings.barcodeHeight,
    });

    previewLabel.style.width = `${settings.labelWidth}mm`;
    previewLabel.style.height = `${settings.labelHeight}mm`;
    previewCanvas.style.width = `${settings.barcodeWidth}mm`;
    previewCanvas.style.height = `${settings.barcodeHeight}mm`;
    previewText.style.fontSize = `${settings.textSize}px`;
    previewDimensions.textContent = `${settings.labelWidth} × ${settings.labelHeight} mm label`;

    const barcodeValue = barcodePrintState.barcodes[0] || intakeUiState.generatedBarcode || '';
    if (!barcodeValue) {
        if (printButton) printButton.disabled = true;
        if (validationEl) {
            validationEl.textContent = 'Generate the item barcode before printing.';
            validationEl.classList.remove('hidden');
        }
        return;
    }
    previewText.textContent = barcodeValue;
    previewCanvas.width = Math.max(120, Math.round(settings.barcodeWidth * 3.7795275591));
    previewCanvas.height = Math.max(60, Math.round(settings.barcodeHeight * 3.7795275591));

    if (typeof JsBarcode === 'function') {
        JsBarcode(previewCanvas, barcodeValue, {
            format: 'CODE128',
            displayValue: false,
            width: 3.0,
            height: 70,
            margin: 10,
            background: '#ffffff',
            lineColor: '#111827'
        });
    }

    if (validationEl) {
        validationEl.textContent = validationMessage;
        validationEl.classList.toggle('hidden', !validationMessage);
    }

    if (printButton) {
        printButton.disabled = Boolean(validationMessage);
    }
}

function renderPrintOnlyBarcodeLabel(settings = getBarcodePrintSettings()) {
    const barcodeValues = Array.isArray(barcodePrintState?.barcodes) && barcodePrintState.barcodes.length
        ? barcodePrintState.barcodes
        : intakeUiState.generatedBarcode ? [intakeUiState.generatedBarcode] : [];
    const modal = document.getElementById('barcodePrintOnlyModal');
    const labels = document.getElementById('barcodePrintOnlyLabels');

    if (!modal || !labels) return;

    if (!barcodeValues.length) {
        modal.classList.add('hidden');
        return;
    }

    labels.innerHTML = '';
    labels.style.setProperty('--label-width-mm', `${settings.labelWidth}mm`);
    labels.style.setProperty('--label-height-mm', `${settings.labelHeight}mm`);
    labels.style.setProperty('--barcode-width-mm', `${settings.barcodeWidth}mm`);
    labels.style.setProperty('--barcode-height-mm', `${settings.barcodeHeight}mm`);
    labels.style.setProperty('--text-size-px', `${settings.textSize}px`);

    barcodeValues.forEach((barcodeValue) => {
        const label = document.createElement('div');
        label.className = 'barcode-print-label';
        label.style.width = `${settings.labelWidth}mm`;
        label.style.height = `${settings.labelHeight}mm`;

        console.log('CODE128 PRINT SETTINGS', {
            width: 2.2,
            height: 52,
            margin: 8,
            displayValue: false,
            format: 'CODE128',
            labelWidth: settings.labelWidth,
            labelHeight: settings.labelHeight,
            barcodeWidth: settings.barcodeWidth,
            barcodeHeight: settings.barcodeHeight,
        });

        // Use SVG for printing. It preserves the exact CODE128 module pattern
        // and avoids browser canvas resampling/stretching during print.
        const barcodeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        barcodeSvg.setAttribute('role', 'img');
        barcodeSvg.setAttribute('aria-label', `Barcode ${barcodeValue}`);
        barcodeSvg.style.width = `${settings.barcodeWidth}mm`;
        barcodeSvg.style.height = `${settings.barcodeHeight}mm`;
        barcodeSvg.style.maxWidth = '100%';
        barcodeSvg.style.display = 'block';
        barcodeSvg.style.margin = '0 auto';

        const text = document.createElement('div');
        text.className = 'barcode-print-text';
        text.textContent = barcodeValue;
        text.style.fontSize = `${settings.textSize}px`;

        if (typeof JsBarcode === 'function') {
            JsBarcode(barcodeSvg, barcodeValue, {
                format: 'CODE128',
                displayValue: false,
                width: 2.2,
                height: 52,
                margin: 8,
                background: '#ffffff',
                lineColor: '#111827'
            });
        } else {
            throw new Error('JsBarcode is not loaded. Cannot print barcode safely.');
        }

        label.appendChild(barcodeSvg);
        label.appendChild(text);
        labels.appendChild(label);
    });

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function openPrintOnlyBarcodeLabel() {
    if (!intakeUiState.generatedBarcode) {
        alert('Generate the item barcode before printing the label.');
        return;
    }

    barcodePrintState = { barcodes: [String(intakeUiState.generatedBarcode).trim().toUpperCase()] };
    openModalBarcodePrintView(barcodePrintState.barcodes);
}

function printConfiguredBarcodeLabels() {
    const settings = getBarcodePrintSettings();
    const validationMessage = getBarcodePrintValidationMessage(settings);
    const validationEl = document.getElementById('barcodePrintValidationMessage');

    if (validationMessage) {
        if (validationEl) {
            validationEl.textContent = validationMessage;
            validationEl.classList.remove('hidden');
        }
        return;
    }

    renderPrintOnlyBarcodeLabel(settings);
    window.setTimeout(() => {
        window.print();
    }, 150);
}

function hideBarcodePrintModal() {
    const modal = document.getElementById('barcodePrintOnlyModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

let barcodePrintState = { barcodes: [] };

function openModalBarcodePrintView(barcodes) {
    const modal = document.getElementById('barcodePrintOnlyModal');
    if (!modal) return;

    barcodePrintState = { barcodes: Array.isArray(barcodes) ? barcodes.filter(Boolean) : [] };
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderBarcodePrintPreview();
}

function bindBarcodePrintControls() {
    const inputs = [
        'barcodePrintLabelWidth',
        'barcodePrintLabelHeight',
        'barcodePrintBarcodeWidth',
        'barcodePrintBarcodeHeight',
        'barcodePrintTextSize',
    ];

    inputs.forEach((id) => {
        const input = document.getElementById(id);
        input?.addEventListener('input', renderBarcodePrintPreview);
    });

    document.getElementById('barcodePrintCancelBtn')?.addEventListener('click', hideBarcodePrintModal);
    document.getElementById('barcodePrintCancelAction')?.addEventListener('click', hideBarcodePrintModal);
    document.getElementById('barcodePrintConfirmBtn')?.addEventListener('click', printConfiguredBarcodeLabels);
}

async function requestPendingMainSourceBarcode(product, intakeDate) {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/intake/pending-item', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
            product_uuid: product.uuid || product.id,
            product_name: product.product_name,
            branch_name: MAIN_SOURCE_BRANCH_NAME,
            intake_date: intakeDate,
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success || !payload.barcode) {
        throw new Error(payload?.message || 'Failed to generate the item barcode.');
    }

    return payload.barcode;
}

async function persistPendingMainSourceBarcode(barcode, intakeDate = getMainSourceIntakeDateValue()) {
    if (!barcode || !intakeUiState.product) {
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/intake/pending-item', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
                barcode,
                product_uuid: intakeUiState.product.uuid || intakeUiState.product.id,
                product_name: intakeUiState.product.product_name,
                branch_name: MAIN_SOURCE_BRANCH_NAME,
                intake_date: intakeDate,
            }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            console.warn('Pending Main Source barcode registration failed:', payload?.message || response.statusText);
            return;
        }

        const payload = await response.json();
        if (payload?.success) {
            console.log('Pending Main Source barcode registered:', payload);
        }
    } catch (error) {
        console.warn('Could not persist pending Main Source barcode:', error);
    }
}

async function generateMainSourceBarcode() {
    if (!intakeUiState.product) {
        alert('Please select a product before generating an item barcode.');
        return;
    }

    const intakeDate = getMainSourceIntakeDateValue();
    if (!intakeDate) {
        alert('Please select the intake date before generating the item barcode.');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/intake/pending-item', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
                product_uuid: intakeUiState.product.uuid || intakeUiState.product.id,
                product_name: intakeUiState.product.product_name,
                branch_name: MAIN_SOURCE_BRANCH_NAME,
                intake_date: intakeDate,
            }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || 'Failed to generate the pending item barcode.');
        }

        intakeUiState.generatedBarcode = payload.barcode || getNextGeneratedBarcode();
        intakeUiState.scannedBarcode = '';
        intakeUiState.registrationComplete = false;
        renderGeneratedBarcodePreview();
        const verificationCard = document.getElementById('scanVerificationCard');
        const registrationStatus = document.getElementById('mainSourceRegistrationStatus');
        const generateNextBtn = document.getElementById('generateNextItemBtn');
        if (verificationCard) verificationCard.classList.add('hidden');
        if (registrationStatus) {
            registrationStatus.classList.add('hidden');
            registrationStatus.textContent = '';
        }
        if (generateNextBtn) generateNextBtn.classList.add('hidden');
    } catch (error) {
        console.error('Failed to generate Main Source barcode:', error);
        alert(error.message || 'Failed to generate the item barcode.');
    }
}

function verifyGeneratedItemScan() {
    const input = document.getElementById('generatedItemScanInput');
    const verificationCard = document.getElementById('scanVerificationCard');
    const verifiedProductName = document.getElementById('verifiedProductName');
    const verifiedBarcodeValue = document.getElementById('verifiedBarcodeValue');
    const registerButton = document.getElementById('registerMainSourceItemBtn');

    if (!input || !verificationCard || !verifiedProductName || !verifiedBarcodeValue || !registerButton) return;

    const barcode = String(input.value || '').trim().toUpperCase();
    if (!barcode) {
        alert('Scan or enter the generated item barcode before verification.');
        return;
    }

    if (!intakeUiState.generatedBarcode) {
        alert('Generate the barcode before scanning it.');
        return;
    }

    if (barcode !== intakeUiState.generatedBarcode.toUpperCase()) {
        alert('This barcode does not match the generated item barcode.');
        return;
    }

    intakeUiState.scannedBarcode = barcode;
    verifiedProductName.textContent = intakeUiState.product?.product_name || 'Unknown product';
    verifiedBarcodeValue.textContent = barcode;
    verificationCard.classList.remove('hidden');
    registerButton.disabled = false;
    registerButton.textContent = 'REGISTER ITEM';
}

async function registerMainSourceItem() {
    const product = intakeUiState.product;
    const barcode = intakeUiState.scannedBarcode || intakeUiState.generatedBarcode;
    const registerButton = document.getElementById('registerMainSourceItemBtn');
    const registrationStatus = document.getElementById('mainSourceRegistrationStatus');
    const generateNextBtn = document.getElementById('generateNextItemBtn');

    if (!product) {
        alert('Please select a product first.');
        return;
    }

    if (!barcode) {
        alert('Generate and scan the item barcode before registration.');
        return;
    }

    if (!intakeUiState.generatedBarcode) {
        alert('Generate the item barcode before registering.');
        return;
    }

    try {
        if (registerButton) {
            registerButton.disabled = true;
            registerButton.textContent = 'REGISTERING...';
        }

        const token = localStorage.getItem('token');
        const response = await fetch('/api/intake/register-pending', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
                barcode,
            }),
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
            throw new Error(result?.message || 'Main Source registration failed.');
        }

        intakeUiState.registrationComplete = true;

        if (registrationStatus) {
            registrationStatus.classList.remove('hidden');
            registrationStatus.innerHTML = `
                <div class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-[18px]">check_circle</span>
                    <div>
                        <div class="font-semibold">✓ ITEM REGISTERED</div>
                        <div class="mt-2 space-y-1">
                            <div><span class="font-semibold">Product:</span> ${product.product_name || 'Unknown product'}</div>
                            <div><span class="font-semibold">Barcode:</span> <span class="font-data-mono">${barcode}</span></div>
                            <div><span class="font-semibold">Location:</span> Pasong Buaya Main Source</div>
                            <div><span class="font-semibold">Status:</span> AVAILABLE</div>
                            <div><span class="font-semibold">Inventory updated:</span> +1</div>
                        </div>
                    </div>
                </div>
            `;
        }

        if (generateNextBtn) {
            generateNextBtn.classList.remove('hidden');
        }

        document.getElementById('generatedItemScanInput').value = barcode;
    } catch (error) {
        console.error('Main Source item registration failed:', error);
        if (registrationStatus) {
            registrationStatus.classList.remove('hidden');
            registrationStatus.textContent = error.message || 'Main Source registration failed.';
        }
    } finally {
        if (registerButton) {
            registerButton.disabled = false;
            registerButton.textContent = 'REGISTER ITEM';
        }
    }
}

function bindMainSourceIntakeEvents() {
    const productSelect = document.getElementById('mainSourceProductSelect');
    const generateBtn = document.getElementById('generateBarcodeBtn');
    const verifyBtn = document.getElementById('verifyGeneratedItemBtn');
    const registerBtn = document.getElementById('registerMainSourceItemBtn');
    const printBtn = document.getElementById('printLabelBtn');
    const generateNextBtn = document.getElementById('generateNextItemBtn');
    const closeButton = document.getElementById('close-modal');
    const cancelButton = document.getElementById('cancel-modal');
    const modal = document.getElementById('modal-overlay');

    productSelect?.addEventListener('change', () => {
        const selectedId = productSelect.value;
        intakeUiState.product = intakeUiState.products.find((product) => (product.uuid || product.id) === selectedId) || null;
        updateProductPrefixDisplay();
        clearGeneratedBarcodeState();
    });

    generateBtn?.addEventListener('click', generateMainSourceBarcode);
    verifyBtn?.addEventListener('click', verifyGeneratedItemScan);
    registerBtn?.addEventListener('click', registerMainSourceItem);
    printBtn?.addEventListener('click', openPrintOnlyBarcodeLabel);
    window.addEventListener('afterprint', hideBarcodePrintModal);
    generateNextBtn?.addEventListener('click', () => {
        clearGeneratedBarcodeState();
        if (productSelect) {
            productSelect.value = '';
            intakeUiState.product = null;
            updateProductPrefixDisplay();
        }
    });
    closeButton?.addEventListener('click', () => modal?.classList.add('hidden'));
    cancelButton?.addEventListener('click', () => modal?.classList.add('hidden'));

    const scanInput = document.getElementById('generatedItemScanInput');
    scanInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            verifyGeneratedItemScan();
        }
    });
}

const transferModalState = {
    sourceBranchName: MAIN_SOURCE_BRANCH_NAME,
    intake_date: '',
    rows: [],
    products: []
};

function resetTransferModalState() {
    transferModalState.intake_date = '';
    transferModalState.rows = [
        { id: `transfer-row-${Date.now()}`, productUuid: '', productName: '', quantity: 1 }
    ];
    const intakeDate = document.getElementById('transferIntakeDate');
    if (intakeDate) intakeDate.value = '';
    renderTransferModalRows();
}

async function loadTransferModalCatalogs() {
    const sourceBranchValue = document.getElementById('transferSourceBranchValue');

    try {
        const token = localStorage.getItem('token');
        const productsResponse = await fetch('/api/products', {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });

        if (!productsResponse.ok) throw new Error('Unable to load products');

        const products = await productsResponse.json();

        if (!Array.isArray(products)) {
            throw new Error('Product response was not a list.');
        }

        transferModalState.products = Array.isArray(products) ? products : [];
        renderTransferModalRows();
        if (sourceBranchValue) {
            sourceBranchValue.textContent = MAIN_SOURCE_BRANCH_NAME;
        }
    } catch (error) {
        console.error('Failed to load transfer modal catalog data:', error);
    }
}

function renderTransferModalRows() {
    const list = document.getElementById('transfer-product-list');
    if (!list) return;

    if (!transferModalState.rows.length) {
        list.innerHTML = '<div class="rounded-lg border border-dashed border-outline-variant bg-surface-container-lowest p-4 text-sm text-secondary">No products added yet.</div>';
        return;
    }

    const productOptions = transferModalState.products.map((product) => {
        const value = product.uuid || product.id || '';
        const label = product.product_name || 'Unknown product';
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');

    list.innerHTML = transferModalState.rows.map((row) => {
        return `
            <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
                <div class="grid grid-cols-1 md:grid-cols-[1.35fr_1fr_auto] gap-3 items-end">
                    <div>
                        <label class="mb-1.5 block font-label-md text-label-md text-secondary">Product</label>
                        <select class="transfer-product-select w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none" data-row-id="${row.id}" aria-label="Select product">
                            <option value="">Select Product</option>
                            ${productOptions}
                        </select>
                    </div>

                    <div>
                        <label class="mb-1.5 block font-label-md text-label-md text-secondary">Quantity</label>
                        <div class="flex h-10 items-center rounded border border-outline-variant bg-surface-container-lowest">
                            <button type="button" class="quantity-decrement px-3 text-lg text-secondary hover:text-primary" data-row-id="${row.id}" aria-label="Decrease quantity">&minus;</button>
                            <input type="number" min="1" step="1" class="transfer-quantity-input w-full border-0 bg-transparent p-0 text-center text-body-md text-on-surface focus:ring-0" data-row-id="${row.id}" value="${row.quantity}" aria-label="Quantity">
                            <button type="button" class="quantity-increment px-3 text-lg text-secondary hover:text-primary" data-row-id="${row.id}" aria-label="Increase quantity">+</button>
                        </div>
                    </div>

                    <div class="flex items-center justify-end">
                        <button type="button" class="remove-transfer-row rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm font-semibold text-error hover:bg-error/10 transition-colors" data-remove-transfer-row="${row.id}">
                            Remove
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    transferModalState.rows.forEach((row) => {
        const select = list.querySelector(`.transfer-product-select[data-row-id="${row.id}"]`);
        if (select) {
            select.value = row.productUuid || '';
        }
    });
}

function addTransferProductRow() {
    transferModalState.rows.push({ id: `transfer-row-${Date.now()}-${Math.random().toString(16).slice(2)}`, productUuid: '', productName: '', quantity: 1 });
    renderTransferModalRows();
}

function removeTransferProductRow(rowId) {
    if (transferModalState.rows.length <= 1) {
        transferModalState.rows = [{ id: `transfer-row-${Date.now()}`, productUuid: '', productName: '', quantity: 1 }];
        renderTransferModalRows();
        return;
    }

    transferModalState.rows = transferModalState.rows.filter((row) => row.id !== rowId);
    renderTransferModalRows();
}

async function printBarcodeModal() {
    if (!transferModalState.intake_date) {
        alert('Please select the intake date.');
        return;
    }

    if (!transferModalState.rows.length) {
        alert('Please add at least one product row.');
        return;
    }

    for (const row of transferModalState.rows) {
        if (!row.productUuid) {
            alert('Each product row must include a product selection.');
            return;
        }
        if (!Number.isInteger(row.quantity) || row.quantity < 1) {
            alert('Each product row must have a quantity of at least 1.');
            return;
        }
    }

    try {
        const confirmButton = document.getElementById('confirmTransferBtn');
        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.textContent = 'Generating...';
        }

        const barcodes = [];
        for (const row of transferModalState.rows) {
            const product = transferModalState.products.find((item) => {
                return (item.uuid || item.id) === row.productUuid;
            });
            if (!product) {
                throw new Error('Selected product could not be found.');
            }

            for (let itemNumber = 0; itemNumber < row.quantity; itemNumber += 1) {
                barcodes.push(await requestPendingMainSourceBarcode(product, transferModalState.intake_date));
            }
        }

        const modal = document.getElementById('modal-overlay');
        modal?.classList.add('hidden');
        resetTransferModalState();
        openModalBarcodePrintView(barcodes);
    } catch (error) {
        console.error('Barcode generation failed:', error);
        alert(`Barcode generation failed: ${error.message}`);
    } finally {
        const confirmButton = document.getElementById('confirmTransferBtn');
        if (confirmButton) {
            confirmButton.disabled = false;
            confirmButton.textContent = 'Print Barcode';
        }
    }
}

function openTransferModal() {
    const modal = document.getElementById('modal-overlay');
    if (!modal) return;
    resetTransferModalState();
    loadTransferModalCatalogs();
    modal.classList.remove('hidden');
}

function closeTransferModal() {
    const modal = document.getElementById('modal-overlay');
    if (!modal) return;
    modal.classList.add('hidden');
    resetTransferModalState();
}

function bindTransferModalControls() {
    const modal = document.getElementById('modal-overlay');
    const openButton = document.getElementById('btn-new-transfer');
    const closeButton = document.getElementById('close-modal');
    const cancelButton = document.getElementById('cancel-modal');
    const addProductButton = document.getElementById('add-transfer-product-btn');
    const confirmButton = document.getElementById('confirmTransferBtn');

    openButton?.addEventListener('click', () => {
        openTransferModal();
    });

    closeButton?.addEventListener('click', () => closeTransferModal());
    cancelButton?.addEventListener('click', () => closeTransferModal());
    addProductButton?.addEventListener('click', () => addTransferProductRow());
    confirmButton?.addEventListener('click', () => printBarcodeModal());

    const list = document.getElementById('transfer-product-list');
    list?.addEventListener('change', (event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.classList.contains('transfer-product-select')) {
            const rowId = target.dataset.rowId;
            const row = transferModalState.rows.find((item) => item.id === rowId);
            if (!row) return;
            row.productUuid = target.value;
            row.productName = target.options[target.selectedIndex]?.text || '';
        }
    });

    list?.addEventListener('input', (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.classList.contains('transfer-quantity-input')) {
            const rowId = target.dataset.rowId;
            const row = transferModalState.rows.find((item) => item.id === rowId);
            if (!row) return;
            row.quantity = Math.max(1, Number.parseInt(target.value, 10) || 1);
            target.value = row.quantity;
        }
    });

    list?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-transfer-row]');
        if (!removeButton) return;
        removeTransferProductRow(removeButton.dataset.removeTransferRow);
    });

    const intakeDate = document.getElementById('transferIntakeDate');
    intakeDate?.addEventListener('change', () => {
        transferModalState.intake_date = intakeDate.value;
    });

    list?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-row-id]');
        if (!button) return;
        const row = transferModalState.rows.find((item) => item.id === button.dataset.rowId);
        if (!row) return;
        if (button.classList.contains('quantity-decrement')) {
            row.quantity = Math.max(1, row.quantity - 1);
            renderTransferModalRows();
        } else if (button.classList.contains('quantity-increment')) {
            row.quantity += 1;
            renderTransferModalRows();
        }
    });

    if (modal) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeTransferModal();
            }
        });
    }
}

async function initializeMainSourceIntakeFlow() {
    console.log('Initializing Main Source intake flow...');
    intakeUiState.nextSequenceNumber = 1;
    console.log('Loading products...');
    await populateMainSourceIntakeProducts();
    console.log('Updating product prefix display...');
    updateProductPrefixDisplay();
    console.log('Clearing barcode state...');
    clearGeneratedBarcodeState();
    console.log('Binding events...');
    bindMainSourceIntakeEvents();
    bindTransferModalControls();
    bindBarcodePrintControls();
    resetTransferModalState();
    await loadTransferModalCatalogs();
    console.log('Main Source intake flow initialized');
}

// Load history when page opens
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Transfers page DOMContentLoaded');
    window.transferScannedItems = [];
    
    initializeMainSourceIntakeFlow();
    loadTransferHistory();

    const prevButton = document.getElementById('transfer-history-prev');
    const nextButton = document.getElementById('transfer-history-next');

    if (prevButton) {
        prevButton.addEventListener('click', () => {
            if (transferHistoryPage > 1) {
                transferHistoryPage--;
                loadTransferHistory();
            }
        });
    }

    if (nextButton) {
        nextButton.addEventListener('click', () => {
            const totalPages = Math.ceil(transferHistoryData.length / transferHistoryPageSize);
            if (transferHistoryPage < totalPages) {
                transferHistoryPage++;
                loadTransferHistory();
            }
        });
    }
});