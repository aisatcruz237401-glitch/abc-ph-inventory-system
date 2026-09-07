const scannerForm = document.getElementById('scannerForm');
const scannerStatus = document.getElementById('scannerStatus');
const productDetails = document.getElementById('productDetails');
const barcodeInput = document.getElementById('barcodeInput');
const scannerVideo = document.getElementById('scannerVideo');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const cameraViewport = document.getElementById('cameraViewport');
const cameraToggleBtn = document.getElementById('cameraToggleBtn');
const cameraStopBtn = document.getElementById('cameraStopBtn');
const hardwareStatus = document.getElementById('hardwareStatus');
const cameraStatus = document.getElementById('cameraStatus');
const scannerModeLabel = document.getElementById('scannerModeLabel');

let cameraStream = null;
let detector = null;
let scanningActive = false;
let scannerMode = 'idle';
let lastDetectedCode = '';
let lastDetectionAt = 0;
let nativeAnimationFrameId = null;
let fallbackFrameHandle = null;
let quaggaStarted = false;
let quaggaRunning = false;
let quaggaDetectedHandler = null;
let quaggaProcessedHandler = null;
let quaggaFrameLogAt = 0;
let quaggaDiagnosticAt = 0;
let scanThrottleAt = 0;
let scanInProgress = false;
let quaggaFrameCounter = 0;
let quaggaRegionCounter = 0;
let quaggaDecodeCounter = 0;
let quaggaDetectedCounter = 0;
let hardwareBuffer = '';
let hardwareBufferTimer = null;
let hardwareScannerEnabled = true;
let activeExactTransferVerification = null;
let zxingReader = null;
let zxingLoaderPromise = null;
let mainSourceProducts = [];
let pendingIntake = null;
let intakeCommitInProgress = false;
let successfullyProcessedIntakeBarcodes = new Set();
let intakeConfirmationValue = '';
let intakeConfirmationCount = 0;
let intakeConfirmationStartedAt = 0;
const intakeConfirmationWindowMs = 1500;
const serializedIntakeBarcodePattern = /^(?:[A-Z]{2}\d+|ABC\d+-\d+)$/;

function setStatus(message, type = 'info') {
  if (!scannerStatus) {
    return;
  }

  scannerStatus.textContent = message;
  scannerStatus.style.background = type === 'success' ? '#d1fae5' : type === 'error' ? '#fee2e2' : '#eff6ff';
  scannerStatus.style.color = type === 'success' ? '#065f46' : type === 'error' ? '#991b1b' : '#1d4ed8';
}

function setModeLabel(message) {
  if (scannerModeLabel) {
    scannerModeLabel.textContent = message;
  }
}

function getCurrentUserRole() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return String(user.role || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function setHardwareStatus(message, type = 'info') {
  if (!hardwareStatus) {
    return;
  }

  hardwareStatus.textContent = message;
  hardwareStatus.className = 'scanner-substatus';
  if (type === 'success') {
    hardwareStatus.classList.add('is-success');
  } else if (type === 'error') {
    hardwareStatus.classList.add('is-error');
  } else {
    hardwareStatus.classList.add('is-info');
  }
}

function setCameraStatus(message, type = 'info') {
  if (!cameraStatus) {
    return;
  }

  cameraStatus.textContent = message;
  cameraStatus.className = 'scanner-substatus';
  if (type === 'success') {
    cameraStatus.classList.add('is-success');
  } else if (type === 'error') {
    cameraStatus.classList.add('is-error');
  } else {
    cameraStatus.classList.add('is-info');
  }
}

function updateViewportState(state) {
  if (!cameraViewport) {
    return;
  }

  cameraViewport.classList.remove('is-loading', 'has-error');
  if (state === 'loading') {
    cameraViewport.classList.add('is-loading');
  } else if (state === 'error') {
    cameraViewport.classList.add('has-error');
  }
}

function resetCameraPlaceholder(message) {
  if (!cameraPlaceholder) {
    return;
  }

  cameraPlaceholder.innerHTML = `<strong>${message}</strong><span>Point the camera at a barcode or enter one manually.</span>`;
  cameraPlaceholder.style.display = 'flex';
}

function ensureQuaggaPreviewVisible() {
  if (!cameraViewport) {
    return;
  }

  const quaggaVideo = cameraViewport.querySelector('video') || scannerVideo;
  if (quaggaVideo) {
    quaggaVideo.style.display = 'block';
    quaggaVideo.style.visibility = 'visible';
    quaggaVideo.style.opacity = '1';
  }
  if (cameraPlaceholder) {
    cameraPlaceholder.style.display = 'none';
  }
}

function logActiveCameraVideoState(label) {
  const activeVideo = cameraViewport?.querySelector('video') || scannerVideo;
  if (!activeVideo) {
    console.log(label, { element: null });
    return;
  }

  console.log(label, {
    element: activeVideo,
    srcObject: !!activeVideo.srcObject,
    readyState: activeVideo.readyState,
    videoWidth: activeVideo.videoWidth,
    videoHeight: activeVideo.videoHeight,
    paused: activeVideo.paused,
  });
}

async function processDeliveryPickupScan(barcode) {
  try {
    setModeLabel('Delivery Pickup');
    setStatus('Checking assigned delivery...', 'info');
    const token = localStorage.getItem('token');
    const response = await fetch('/api/deliver/pickup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ barcode })
    });
    const result = await response.json();
    if (!response.ok || !result?.success) throw new Error(result?.message || 'Delivery pickup failed.');
    setStatus(result.message || 'Item moved to your delivery storage.', 'success');
    setModeLabel('Delivery Pickup Complete');
  } catch (error) {
    console.error('Delivery pickup scan failed:', error);
    setStatus(error.message || 'Delivery pickup failed.', 'error');
  } finally {
    scanInProgress = false;
  }
}

async function processDeliveryReceiveScan(barcode) {
  try {
    setModeLabel('Delivery Receipt');
    setStatus('Receiving item into this branch...', 'info');
    const token = localStorage.getItem('token');
    const response = await fetch('/api/receive/delivery-unit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ barcode })
    });
    const result = await response.json();
    if (!response.ok || !result?.success) throw new Error(result?.message || 'Delivery receipt failed.');
    setStatus(result.message || 'Item received into destination branch.', 'success');
    setModeLabel('Delivery Receipt Complete');
  } catch (error) {
    console.error('Delivery receive scan failed:', error);
    setStatus(error.message || 'Delivery receipt failed.', 'error');
  } finally {
    scanInProgress = false;
  }
}

function getCurrentUsername() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return String(user.username || user.name || user.email || 'system').trim() || 'system';
  } catch {
    return 'system';
  }
}

function isMainSourceIntakeBranch() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const branchName = String(user.branch || user.assigned_branch || user.branch_name || '').trim();
    return branchName.toLowerCase() === 'pasong buaya main source';
  } catch {
    return false;
  }
}

function canPrepareMainSourceIntake() {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'superadmin' || isMainSourceIntakeBranch();
}

function isLikelyValidScannerCode(value) {
  const trimmed = String(value || '').replace(/[\x00-\x1F\x7F]/g, '').trim();

  if (!trimmed || trimmed.length < 3) {
    return false;
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return false;
  }

  const upper = trimmed.toUpperCase();

  if (upper.startsWith('TRF-') || upper.startsWith('ADD-')) {
    return true;
  }

  if (serializedIntakeBarcodePattern.test(upper)) {
    return true;
  }

  if (/^\d+$/.test(trimmed)) {
    return false;
  }

  return /^[A-Za-z0-9._-]{3,64}$/.test(trimmed);
}

function isSerializedItemBarcode(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.startsWith('ADD-') || trimmed.startsWith('TRF-')) {
    return false;
  }

  return serializedIntakeBarcodePattern.test(trimmed.toUpperCase());
}

async function lookupSerializedItemStatus(code) {
  console.log("im here")
  const barcode = `${code || ''}`.replace(/[\x00-\x1F\x7F]/g, '').trim();

  if (!barcode || !isSerializedItemBarcode(barcode)) {
    setStatus('This is not a valid serialized item barcode.', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/intake/status/${encodeURIComponent(barcode)}`);
    const result = await response.json();

    if (!response.ok || !result?.success) {
      throw new Error(result?.message || 'Serialized item not found.');
    }

    productDetails.innerHTML = `
      <div class="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
        <div class="mb-2 flex items-center gap-2">
          <span class="material-symbols-outlined text-blue-700">inventory_2</span>
          <h3 class="text-base font-semibold text-blue-900">Serialized item found</h3>
        </div>
        <div class="space-y-2 text-sm">
          <div><span class="font-semibold text-blue-800">Barcode:</span> <span class="font-mono">${result.vx_barcode || barcode}</span></div>
          <div><span class="font-semibold text-blue-800">Product:</span> ${result.product_name || 'Unknown'}</div>
          <div><span class="font-semibold text-blue-800">Status:</span> ${result.status || 'UNKNOWN'}</div>
          <div><span class="font-semibold text-blue-800">Product UUID:</span> <span class="font-mono text-xs">${result.product_uuid || 'N/A'}</span></div>
        </div>
      </div>
    `;

    setStatus('Serialized item barcode confirmed.', 'success');
    setModeLabel('Item Barcode Detected');
  } catch (error) {
    productDetails.textContent = error.message;
    setStatus('Serialized item not found or invalid.', 'error');
  }
}

function formatProductPrefix(productName) {
  const letters = String(productName || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!letters) {
    return 'AA';
  }
  return letters.slice(0, 2).padEnd(2, 'X');
}

async function loadMainSourceProducts() {
  try {
    const token = localStorage.getItem('token');

    console.log('[Scanner Intake] Token exists:', !!token);
    console.log(
      '[Scanner Intake] Sending Authorization header:',
      token ? 'YES' : 'NO'
    );

    const response = await fetch('/api/intake/products', {
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : {},
    });

    if (!response.ok) {
      throw new Error('Unable to load products');
    }

    const products = await response.json();
    mainSourceProducts = Array.isArray(products) ? products : [];

    console.log(
      '[Scanner Intake] Loaded Main Source products:',
      mainSourceProducts.map((product) => ({
        productName: product.product_name,
        barcode: product.barcode,
        intakePrefix: product.intake_prefix,
      }))
    );

    if (!mainSourceProducts.length) {
      const fallbackResponse = await fetch('/api/products', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (fallbackResponse.ok) {
        const fallbackProducts = await fallbackResponse.json();
        mainSourceProducts = Array.isArray(fallbackProducts) ? fallbackProducts : [];
        console.warn('[Scanner Intake] /api/intake/products returned no products; using product master data from /api/products.');
      }
    }
  } catch (error) {
    console.error('Failed to load Main Source products:', error);
    mainSourceProducts = [];
  }
}

function isMainSourceIntakeCandidate(value) {
  return serializedIntakeBarcodePattern.test(String(value || '').trim().toUpperCase());
}

function resolveProductForIntakeBarcode(barcode) {
  const normalizedBarcode = String(barcode || '')
    .trim()
    .toUpperCase();

  if (!isMainSourceIntakeCandidate(normalizedBarcode)) {
    return null;
  }

  // Existing serialized barcode format:
  // ABC000001-00001
  // Resolve using the actual product barcode.
  if (/^ABC\d+-\d+$/.test(normalizedBarcode)) {
    const productBarcode = normalizedBarcode.split('-')[0];

    return (
      mainSourceProducts.find(
        (product) =>
          String(product.barcode || '')
            .trim()
            .toUpperCase() === productBarcode
      ) || null
    );
  }

  // Intake barcode format:
  // PPDDMMYYYYSSS
  // Example: TT04092026001
  const productPrefix = normalizedBarcode.slice(0, 2);

  // Match using the permanent intake_prefix from the database.
  const matches = mainSourceProducts.filter(
    (product) =>
      String(product.intake_prefix || '')
        .trim()
        .toUpperCase() === productPrefix
  );

  console.log('[Scanner Intake] Barcode prefix:', productPrefix);

  console.log(
    '[Scanner Intake] Candidate products:',
    matches.map((product) => ({
      uuid: product.uuid || product.id || '',
      productName: product.product_name || '',
      productBarcode: product.barcode || '',
      intakePrefix: product.intake_prefix || '',
    }))
  );

  // Safety: never guess if multiple products somehow have
  // the same intake prefix.
  const resolvedProduct =
    matches.length === 1 ? matches[0] : null;

  console.log(
    '[Scanner Intake] Resolved product:',
    resolvedProduct
      ? {
          uuid: resolvedProduct.uuid || resolvedProduct.id || '',
          productName: resolvedProduct.product_name || '',
          productBarcode: resolvedProduct.barcode || '',
          intakePrefix: resolvedProduct.intake_prefix || '',
        }
      : null
  );

  return resolvedProduct;
}

async function prepareMainSourceIntakeFromScan(barcode) {
  const normalizedBarcode = String(barcode || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .toUpperCase();

  if (!isMainSourceIntakeCandidate(normalizedBarcode)) {
    throw new Error('This is not a valid Main Source intake barcode.');
  }

  setStatus('Identifying product from barcode prefix...', 'info');

  if (!mainSourceProducts.length) {
    await loadMainSourceProducts();
  }

  const product = resolveProductForIntakeBarcode(normalizedBarcode);

  if (!product) {
    pendingIntake = null;

    if (productDetails) {
      productDetails.textContent =
        `No unique product matches prefix ${normalizedBarcode.slice(0, 2)}.`;
    }

    const message =
      `No unique product matches prefix ${normalizedBarcode.slice(0, 2)}.`;

    setStatus(message, 'error');
    throw new Error(message);
  }

  setStatus('Preparing item for Main Source inventory...', 'info');
  populatePendingMainSourceIntake(normalizedBarcode, product);

  const token = localStorage.getItem('token');
  const response = await fetch('/api/intake/pending-item', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      barcode: pendingIntake.scannedBarcode,
      product_uuid: pendingIntake.productUuid,
      product_name: pendingIntake.productName,
      branch_name: 'Pasong Buaya Main Source',
      intake_date: pendingIntake.intakeDate,
    }),
  });

  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Server returned an invalid response (${response.status}).`
    );
  }

  if (!response.ok || !payload?.success) {
    pendingIntake = null;

    throw new Error(
      payload?.message ||
      'Failed to prepare pending Main Source item.'
    );
  }

  // Backend may return the confirmed/generated barcode
  pendingIntake.scannedBarcode =
    payload.barcode || pendingIntake.scannedBarcode;

  pendingIntake.productUuid =
    payload.product_uuid || pendingIntake.productUuid;

  pendingIntake.productName =
    payload.product_name || pendingIntake.productName;

  renderPendingMainSourceDetails();

  setStatus(
    'Barcode confirmed. Review Scan Details, then add it to inventory.',
    'success'
  );

  setModeLabel('Ready to Add');
}

function populatePendingMainSourceIntake(barcode, product) {
  const normalizedBarcode = String(barcode || '').trim().toUpperCase();

  const generatedPrefix = formatProductPrefix(product.product_name);

  const dateMatch = normalizedBarcode.match(
    /^[A-Z]{2}(\d{2})(\d{2})(\d{4})\d+$/
  );

  const intakeDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    : new Date().toISOString().slice(0, 10);

  pendingIntake = {
    scannedBarcode: normalizedBarcode,
    productPrefix: normalizedBarcode.slice(0, 2),
    productUuid: product.uuid || product.id || '',
    productName: product.product_name || '',
    productBarcode: product.barcode || '',
    generatedPrefix,
    prefix: normalizedBarcode.slice(0, 2),
    intakeDate,
    date: intakeDate,
    quantity: 1,
  };
}

function renderPendingMainSourceDetails() {
  if (!productDetails || !pendingIntake) {
    return;
  }

  productDetails.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-emerald-700">inventory_2</span>
        <h3 class="font-semibold text-emerald-900">Ready to add to inventory</h3>
      </div>
      <div class="space-y-2 text-sm">
        <div><span class="font-semibold">Barcode:</span> <span class="font-mono">${pendingIntake.scannedBarcode}</span></div>
        <div><span class="font-semibold">Product:</span> ${pendingIntake.productName}</div>
        <div><span class="font-semibold">Product barcode:</span> <span class="font-mono">${pendingIntake.productBarcode || 'N/A'}</span></div>
        <div><span class="font-semibold">Product prefix:</span> <span class="font-mono">${pendingIntake.productPrefix}</span></div>
        <div><span class="font-semibold">Generated item prefix:</span> <span class="font-mono">${pendingIntake.generatedPrefix}</span></div>
        <div><span class="font-semibold">Intake date:</span> ${pendingIntake.date}</div>
      </div>
      <p class="text-xs text-on-surface-variant">Review the details. Inventory changes only after you click Add to inventory.</p>
      <button id="addPendingMainSourceItemBtn" type="button" class="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-60">
        ADD TO INVENTORY
      </button>
    </div>
  `;

  document.getElementById('addPendingMainSourceItemBtn')?.addEventListener('click', commitPendingMainSourceIntake);
}

function resetPendingMainSourceIntake() {
  pendingIntake = null;
  productDetails.textContent = 'Ready to scan the next barcode.';
  barcodeInput.value = '';
  setModeLabel('READY TO SCAN');
}

async function commitPendingMainSourceIntake() {
  if (!pendingIntake || intakeCommitInProgress) {
    return;
  }

  const item = pendingIntake;

  const button = document.getElementById('addPendingMainSourceItemBtn');

  if (successfullyProcessedIntakeBarcodes.has(item.scannedBarcode)) {
    return;
  }

  intakeCommitInProgress = true;

  if (button) {
    button.disabled = true;
    button.textContent = 'ADDING TO INVENTORY...';
  }

  try {
    setStatus(
      `Adding ${item.productName} to Pasong Buaya Main Source...`,
      'info'
    );

    const token = localStorage.getItem('token');

    // Register the item that was previously prepared by /pending-item
    const response = await fetch('/api/intake/register-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        barcode: item.scannedBarcode,
      }),
    });

    let payload;

try {
  payload = await response.json();
} catch {
  throw new Error(`Server returned an invalid response (${response.status}).`);
}

    if (!response.ok || !payload?.success) {
      throw new Error(
        payload?.message || 'Failed to add pending item to inventory.'
      );
    }

    successfullyProcessedIntakeBarcodes.add(item.scannedBarcode);

    productDetails.innerHTML = `
      <div class="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div class="font-semibold">
          Item successfully added to Pasong Buaya Main Source.
        </div>

        <div>
          <span class="font-semibold">Product:</span>
          ${payload.product_name || item.productName}
        </div>

        <div>
          <span class="font-semibold">Barcode:</span>
          <span class="font-mono">
            ${payload.barcode || item.scannedBarcode}
          </span>
        </div>

        <div>
          <span class="font-semibold">Status:</span>
          ${payload.status || 'AVAILABLE'}
        </div>

        <div>
          <span class="font-semibold">Inventory Quantity:</span>
          ${payload.inventory_quantity ?? 'Updated'}
        </div>
      </div>
    `;

    pendingIntake = null;

    setStatus(
      'Item successfully added to Pasong Buaya Main Source.',
      'success'
    );

    setModeLabel('Intake Complete');

    setTimeout(() => {
      resetPendingMainSourceIntake();
      startCamera();
    }, 1800);

  } catch (error) {
    console.error('Main Source intake failed:', error);

    setStatus(
      error.message || 'Main Source intake failed.',
      'error'
    );

    if (button) {
      button.disabled = false;
      button.textContent = 'ADD TO INVENTORY';
    }

  } finally {
    intakeCommitInProgress = false;
  }
}

function getFriendlyCameraError(error) {
  const message = error?.message || '';
  const name = error?.name || '';

  if (name === 'NotAllowedError' || message.includes('Permission') || message.includes('denied')) {
    return 'Camera access was denied.';
  }

  if (name === 'NotFoundError' || message.includes('No camera') || message.includes('found')) {
    return 'No compatible camera was found.';
  }

  if (name === 'NotReadableError' || message.includes('already in use')) {
    return 'The camera is already being used by another app.';
  }

  if (message.includes('secure context') || message.includes('HTTPS')) {
    return 'Camera access requires a secure context. Please use HTTPS or localhost.';
  }

  return 'Unable to start scanner.';
}

function clearHardwareBuffer() {
  hardwareBuffer = '';
  if (hardwareBufferTimer) {
    clearTimeout(hardwareBufferTimer);
    hardwareBufferTimer = null;
  }
}

function finalizeHardwareBarcode() {
  const barcode = hardwareBuffer.trim();
  clearHardwareBuffer();
  if (!barcode) {
    return;
  }

  if (barcode.length < 3) {
    return;
  }

  setHardwareStatus('Hardware Scanner: Ready', 'success');
  setStatus('Barcode detected.', 'success');
  handleDetectedCode(barcode);
}

function handleHardwareKeydown(event) {
  if (!hardwareScannerEnabled) {
    return;
  }

  const target = event.target;
  const isEditableField = !!target && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );

  if (isEditableField && target !== barcodeInput) {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key === 'Enter') {
    if (hardwareBuffer) {
      event.preventDefault();
      event.stopPropagation();
      finalizeHardwareBarcode();
    }
    clearHardwareBuffer();
    return;
  }

  if (event.key === 'Tab' || event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') {
    return;
  }

  if (event.key.length !== 1 || event.repeat) {
    return;
  }

  hardwareBuffer += event.key;
  setHardwareStatus('Hardware Scanner: Ready', 'success');

  if (hardwareBufferTimer) {
    clearTimeout(hardwareBufferTimer);
  }

  hardwareBufferTimer = setTimeout(() => {
    clearHardwareBuffer();
    setHardwareStatus('Hardware Scanner: Waiting', 'info');
  }, 180);
}

function cleanupAppOwnedCameraStream() {
  console.warn('cleanupAppOwnedCameraStream CALLED — STACK TRACE');
  console.trace();

  const activeTrackCount = cameraStream?.getTracks?.().length || 0;
  console.log('QUAGGA PRE-INIT: active scannerVideo stream =', !!(scannerVideo && scannerVideo.srcObject), 'active track count =', activeTrackCount, 'existing Quagga running =', !!(window.Quagga && quaggaStarted));

  if (window.Quagga && quaggaStarted) {
    try {
      window.Quagga.stop();
      quaggaStarted = false;
      quaggaRunning = false;
    } catch (error) {
      console.warn('Quagga stop failed during cleanup:', error);
    }
  }

  if (quaggaDetectedHandler) {
    try {
      window.Quagga?.offDetected?.(quaggaDetectedHandler);
    } catch (error) {
      console.warn('Quagga offDetected failed:', error);
    }
    quaggaDetectedHandler = null;
  }

  if (quaggaProcessedHandler) {
    try {
      window.Quagga?.offProcessed?.(quaggaProcessedHandler);
    } catch (error) {
      console.warn('Quagga offProcessed failed:', error);
    }
    quaggaProcessedHandler = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  if (scannerVideo) {
    try {
      scannerVideo.pause();
    } catch (error) {
      console.warn('Video pause failed:', error);
    }
    scannerVideo.srcObject = null;
    scannerVideo.style.display = 'none';
  }

  console.log('QUAGGA CAMERA CLEANUP COMPLETE: scannerVideo.srcObject = null, active tracks remaining =', 0);
}

function cleanupScannerResources() {
  console.warn('cleanupScannerResources CALLED — STACK TRACE');
  console.trace();

  if (nativeAnimationFrameId) {
    cancelAnimationFrame(nativeAnimationFrameId);
    nativeAnimationFrameId = null;
  }
  if (fallbackFrameHandle) {
    cancelAnimationFrame(fallbackFrameHandle);
    fallbackFrameHandle = null;
  }

  if (zxingReader) {
    try {
      if (typeof zxingReader.stopContinuousDecode === 'function') {
        zxingReader.stopContinuousDecode();
      }
      if (typeof zxingReader.reset === 'function') {
        zxingReader.reset();
      }
      if (typeof zxingReader.stop === 'function') {
        zxingReader.stop();
      }
    } catch (error) {
      console.warn('ZXing stop failed:', error);
    }
    zxingReader = null;
  }

  cleanupAppOwnedCameraStream();

  detector = null;
  scanningActive = false;
  scannerMode = 'idle';
  scanThrottleAt = 0;
  scanInProgress = false;
}

function stopCamera() {
  console.warn('stopCamera CALLED — STACK TRACE');
  console.trace();

  cleanupScannerResources();
  if (cameraToggleBtn) {
    cameraToggleBtn.textContent = 'Start camera';
    cameraToggleBtn.disabled = false;
  }
  if (cameraStopBtn) {
    cameraStopBtn.hidden = true;
  }
  updateViewportState('idle');
  resetCameraPlaceholder('Camera stopped.');
  setModeLabel('Ready to Scan');
  setCameraStatus('Camera Scanner: Stopped', 'info');
  setStatus('Scanner stopped.', 'info');
}

async function lookupBarcode(code) {
  const barcode = `${code || ''}`.trim();

  if (!barcode) {
    setStatus('Enter a barcode before searching.', 'error');
    return;
  }

  if (canPrepareMainSourceIntake() && isMainSourceIntakeCandidate(barcode)) {
    await prepareMainSourceIntakeFromScan(barcode);
    return;
  }

  try {
    const statusResponse = await fetch(`/api/intake/status/${encodeURIComponent(barcode)}`);
    const statusPayload = await statusResponse.json().catch(() => ({}));

    if (statusResponse.ok && statusPayload?.success && statusPayload.pending === false) {
      const productName = statusPayload.product_name || 'Unknown product';
      const status = statusPayload.status || 'AVAILABLE';
      productDetails.innerHTML = `
        <div class="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <div class="mb-2 flex items-center gap-2">
            <span class="material-symbols-outlined text-blue-700">inventory_2</span>
            <h3 class="text-base font-semibold text-blue-900">Serialized item found</h3>
          </div>
          <div class="space-y-2 text-sm">
            <div><span class="font-semibold text-blue-800">Barcode:</span> <span class="font-mono">${barcode}</span></div>
            <div><span class="font-semibold text-blue-800">Product:</span> ${productName}</div>
            <div><span class="font-semibold text-blue-800">Status:</span> ${status}</div>
          </div>
        </div>
      `;
      setStatus('Serialized item confirmed.', 'success');
      setModeLabel('Item Barcode Detected');
      return;
    }
  } catch (error) {
    console.warn('Status lookup failed before product lookup:', error);
  }

  try {
    const product = await getProductByBarcode(barcode);
    const totalQty = Number(product.total_quantity || 0);
    const status =
      totalQty <= 0
        ? 'Out of stock'
        : totalQty <= 10
          ? 'Low stock'
          : 'Available';

    const branchDetails =
      Array.isArray(product.inventory) && product.inventory.length
        ? product.inventory
            .map((row) => `${row.branch}: ${row.quantity}`)
            .join(' | ')
        : 'No inventory records';

    const productSummary = `
      <div class="space-y-2">
        <div><strong>Product found:</strong> ${product.product_name} (${product.barcode})</div>
        <div><strong>Category:</strong> ${product.category || 'N/A'}</div>
        <div><strong>Total stock:</strong> ${totalQty}</div>
        <div><strong>Status:</strong> ${status}</div>
        <div><strong>Inventory:</strong> ${branchDetails}</div>
      </div>
    `;

    productDetails.innerHTML = productSummary;

    setStatus('Product detected. Review and confirm Main Source intake.', 'success');
    setModeLabel('Product Detected');

  } catch (error) {
    productDetails.innerHTML = `
      <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <div class="font-semibold">PRODUCT / ITEM NOT FOUND</div>
        <div class="mt-1">No active product or pending Main Source item matches ${barcode}.</div>
      </div>
    `;
    setStatus('Product / item not found.', 'error');
  }
}

async function lookupTransfer(trackingCode) {
  const code = `${trackingCode || ''}`.replace(/[\x00-\x1F\x7F]/g, '').trim();

  if (!code) {
    setStatus('Enter a transfer tracking code.', 'error');
    return;
  }

  try {
    setStatus(`Looking up transfer ${code}...`, 'info');

    const response = await fetch(
      `/api/transfers/${encodeURIComponent(code)}`
    );

    const result = await response.json();

    console.log(
      'RECEIVE TRANSFER RESPONSE:',
      JSON.stringify(result, null, 2)
    );

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Transfer not found.');
    }

    const transfer = result.transfer;
    const status = String(transfer.status || 'UNKNOWN').toUpperCase();
    const transferItems = Array.isArray(transfer.items) && transfer.items.length
      ? transfer.items
      : [{
        product_name: transfer.product_name,
        barcode: transfer.barcode,
        quantity: transfer.quantity,
      }];
    const escapedTransferValue = (value) => String(value ?? 'N/A').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
    const transferProducts = Array.isArray(transfer.items) ? transfer.items : [];

    productDetails.innerHTML = transferProducts.length
      ? `
        <div class="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">local_shipping</span>
            <h3 class="text-base font-semibold text-on-surface">Transfer Products</h3>
          </div>
          <div class="space-y-2">
            ${transferProducts.map(item => `
              <div class="flex items-center justify-between gap-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-3">
                <div class="min-w-0">
                  <div class="truncate font-semibold text-on-surface">${escapedTransferValue(item.product_name || 'Product')}</div>
                  <div class="font-mono text-xs text-on-surface-variant">${escapedTransferValue(item.barcode)}</div>
                </div>
                <div class="shrink-0 text-right text-sm font-semibold text-primary">
                  ${escapedTransferValue(item.quantity)} ${escapedTransferValue(item.unit || 'unit')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `
      : `
        <div class="rounded-xl border border-[#E2E8F0] bg-white p-5 text-center shadow-sm">
          <span class="material-symbols-outlined text-secondary">inventory_2</span>
          <p class="mt-2 font-semibold text-on-surface">No transfer products found</p>
        </div>
      `;

    const exactExpectedBarcodes = Array.isArray(transfer.expected_unit_barcodes)
      ? transfer.expected_unit_barcodes.filter(Boolean).map((value) => `${value}`.trim().toUpperCase())
      : [];

    if ((Array.isArray(transfer.expected_serialized_units) && transfer.expected_serialized_units.length > 0) || exactExpectedBarcodes.length > 0) {
      const expectedBarcodes = exactExpectedBarcodes.length ? exactExpectedBarcodes : (transfer.expected_serialized_units || []).map((item) => String(item.unit_barcode || item.serialized_unit_barcode || '').trim().toUpperCase()).filter(Boolean);
      activeExactTransferVerification = {
        transfer,
        tracking_code: transfer.tracking_code,
        expectedBarcodes,
        verifiedBarcodes: [],
      };

      if (receiptModal && receiptDetails && confirmReceiptBtn) {
        receiptModal.classList.remove('hidden');
        receiptModal.classList.add('flex');
        renderExactTransferVerification(transfer, activeExactTransferVerification);
      }

      setModeLabel('Transfer Verification');
      setStatus('Transfer found. Verify each serialized unit before confirming receipt.', 'info');
      return;
    }

    const receiptModal = document.getElementById('receiptModal');
    const receiptDetails = document.getElementById('receiptDetails');
    const confirmReceiptBtn = document.getElementById('confirmReceiptBtn');

    receiptDetails.innerHTML = `
      <div class="space-y-4">

        <div class="text-center border-b border-outline-variant pb-4">
          <div class="text-lg font-bold">
            Transfer Receipt
          </div>
          <div class="text-sm text-on-surface-variant">
            Please review the transfer before confirming.
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex justify-between gap-4">
            <span class="text-on-surface-variant">
              Tracking Code
            </span>

            <span class="font-mono font-semibold text-right">
              ${transfer.tracking_code}
            </span>
          </div>

          <div class="flex justify-between gap-4">
            <span class="text-on-surface-variant">
              Status
            </span>

            <span class="font-semibold text-right">
              ${status}
            </span>
          </div>

          <div>
            <div class="text-on-surface-variant mb-2">Items</div>
            <div class="space-y-2">
              ${transferItems.map((item, index) => `
                <div class="flex justify-between gap-4 border border-outline-variant rounded-lg px-3 py-2">
                  <span>
                    <span class="text-on-surface-variant">Item ${index + 1}</span><br />
                    <span class="font-semibold">${item.product_name || 'Product'}</span>
                    <span class="block font-mono text-xs text-on-surface-variant">${item.barcode || 'N/A'}</span>
                  </span>
                  <span class="font-semibold text-right">${item.quantity ?? 'N/A'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

      </div>
    `;

    receiptModal.classList.remove('hidden');
    receiptModal.classList.add('flex');

    setModeLabel(status === 'RECEIVED' ? 'Transfer Complete' : 'Transfer Found');

    if (status === 'RECEIVED') {
      confirmReceiptBtn.disabled = false;
      confirmReceiptBtn.textContent = 'Transfer Complete';
      confirmReceiptBtn.onclick = () => {
        closeReceiptAndResumeScanner('Transfer Complete');
      };

      setStatus(
        'Transfer Complete. This transfer has already been received.',
        'success'
      );

      return;
    }

    if (status !== 'IN_TRANSIT') {
      confirmReceiptBtn.disabled = true;
      confirmReceiptBtn.textContent = 'Transfer Not Available';
      confirmReceiptBtn.onclick = null;

      setStatus(
        status === 'RECEIVED'
          ? 'Transfer has already been received.'
          : `Transfer cannot be received while its status is ${status}.`,
        'info'
      );

      return;
    }

    confirmReceiptBtn.disabled = false;
    confirmReceiptBtn.textContent = 'Confirm Receipt';

    setStatus(
      'Transfer found. Please confirm the receipt.',
      'success'
    );

    confirmReceiptBtn.onclick = async () => {
      try {
        confirmReceiptBtn.disabled = true;
        confirmReceiptBtn.textContent = 'Receiving...';

        const receiveResult = await apiRequest(
          '/receive/transfer',
          {
            method: 'POST',
            body: {
              tracking_code: transfer.tracking_code,
              user: getCurrentUsername(),
            }
          }
        );

        if (!receiveResult.success) {
          throw new Error(
            receiveResult.message ||
            'Failed to receive transfer.'
          );
        }

        console.log(
          'TRANSFER RECEIVED:',
          receiveResult
        );

        setStatus('Transfer Complete', 'success');

        if (typeof window.loadTransferHistory === 'function') {
          await window.loadTransferHistory();
        }

        window.dispatchEvent(new CustomEvent('inventoryUpdated', {
          detail: {
            tracking_code: transfer.tracking_code,
            type: 'TRANSFER_IN'
          }
        }));

        closeReceiptAndResumeScanner('Transfer Complete');

      } catch (error) {
        console.error(
          'Receive transfer failed:',
          error
        );

        confirmReceiptBtn.disabled = false;
        confirmReceiptBtn.textContent =
          'Confirm Receipt';

        setStatus(
          error.message ||
          'Failed to receive transfer.',
          'error'
        );
      }
    };

  } catch (error) {
    console.error(
      'Transfer lookup failed:',
      error
    );

    productDetails.textContent =
      error.message;

    setStatus(
      'Transfer not found.',
      'error'
    );
  }
}

async function performAddBarcodeIntake(addBarcode) {
  const barcode = `${addBarcode || ''}`.replace(/[\x00-\x1F\x7F]/g, '').trim();

  if (!barcode) {
    setStatus('Enter an ADD barcode before searching.', 'error');
    scanInProgress = false;
    return;
  }

  try {
    setStatus(`Processing product intake: ${barcode}...`, 'info');

    const result = await intakeByAddBarcode(barcode, 'scanner');

    console.log('INTAKE RESULT:', JSON.stringify(result, null, 2));

    if (!result || !result.success) {
      throw new Error(result?.message || 'Product intake failed.');
    }

    const { vx_barcode, product_name, inventory_qty } = result;

    // Display intake success details
    productDetails.innerHTML = `
      <div class="rounded-xl border border-green-300 bg-green-50 p-5 shadow-sm">
        <div class="mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-green-700">check_circle</span>
          <h3 class="text-lg font-semibold text-green-900">Intake Complete</h3>
        </div>
        <div class="space-y-3">
          <div>
            <div class="text-sm text-green-700">Product</div>
            <div class="font-semibold text-on-surface">${product_name}</div>
          </div>
          <div>
            <div class="text-sm text-green-700">VX Barcode (Unit Identity)</div>
            <div class="font-mono font-bold text-lg text-green-900">${vx_barcode}</div>
            <div class="text-xs text-green-600 mt-1">Print this label for the physical item</div>
          </div>
          <div>
            <div class="text-sm text-green-700">Inventory Updated</div>
            <div class="font-semibold text-on-surface">Now at ${inventory_qty} unit(s)</div>
          </div>
        </div>
      </div>
    `;

    setStatus('Product intake successful. VX barcode generated for label printing.', 'success');
    setModeLabel('Intake Complete');

    // Automatically resume scanning after 3 seconds
    setTimeout(() => {
      scanInProgress = false;
      productDetails.innerHTML = 'Ready to scan the next barcode.';
      barcodeInput.value = '';
      startCamera();
      setStatus('Ready to scan the next product.', 'info');
    }, 3000);

  } catch (error) {
    console.error('Product intake failed:', error);

    productDetails.textContent = error.message;
    setStatus('Product intake failed. Please try again.', 'error');
    setModeLabel('Intake Failed');

    // Resume scanning on error
    scanInProgress = false;
    setTimeout(() => {
      barcodeInput.value = '';
      startCamera();
    }, 2000);
  }
}

// Receipt modal controls
const receiptModal = document.getElementById('receiptModal');

const cancelReceiptBtn = document.getElementById(
  'cancelReceiptBtn'
);

const cancelReceiptBtnFooter = document.getElementById(
  'cancelReceiptBtnFooter'
);

function closeReceiptAndResumeScanner(completionMessage = '') {
  // Close the receipt modal
  receiptModal.classList.add('hidden');
  receiptModal.classList.remove('flex');

  // Clear previous details
  productDetails.innerHTML =
    'Ready to scan the next barcode.';
  barcodeInput.value = '';
  document.getElementById('receiptDetails').innerHTML = '';

  // Reset scanner state
  scanInProgress = false;

  // Reopen scanner
  setTimeout(async () => {
    await startCamera();
    if (completionMessage) {
      setStatus(`${completionMessage}. Ready for the next scan.`, 'success');
    }
  }, 300);
}

// Top X button
cancelReceiptBtn?.addEventListener('click', () => {
  closeReceiptAndResumeScanner();
});

// Cancel button
cancelReceiptBtnFooter?.addEventListener('click', () => {
  closeReceiptAndResumeScanner();
});

function shouldUseNativeScanner() {
  return typeof window.BarcodeDetector === 'function' && window.isSecureContext !== false;
}

function scheduleNextScanFrame(frameRunner) {
  if (!scanningActive || scannerMode === 'idle') {
    return;
  }

  const now = Date.now();
  if (now - scanThrottleAt < 140) {
    if (scannerMode === 'native') {
      nativeAnimationFrameId = requestAnimationFrame(() => frameRunner());
    } else if (scannerMode === 'fallback') {
      fallbackFrameHandle = requestAnimationFrame(() => frameRunner());
    }
    return;
  }

  scanThrottleAt = now;
  frameRunner();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    updateViewportState('error');
    setCameraStatus('Camera Scanner: Unavailable', 'error');
    setStatus('Camera access is not available in this browser.', 'error');
    resetCameraPlaceholder('Camera access is unavailable.');
    return;
  }

  if (!window.isSecureContext && location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    updateViewportState('error');
    setCameraStatus('Camera Scanner: Permission required', 'error');
    setStatus('Camera access requires a secure context. Please use HTTPS or localhost.', 'error');
    resetCameraPlaceholder('Camera access requires HTTPS.');
    return;
  }

  if (cameraStream) {
    stopCamera();
    return;
  }

  if (cameraToggleBtn) {
    cameraToggleBtn.disabled = true;
  }
  updateViewportState('loading');
  setCameraStatus('Camera Scanner: Starting', 'info');
  setStatus('Starting camera...', 'info');
  resetCameraPlaceholder('Starting camera...');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    cameraStream = stream;
    scannerVideo.srcObject = stream;
    scannerVideo.style.display = 'block';
    cameraPlaceholder.style.display = 'none';
    await scannerVideo.play();
    console.log('SCANNER VIDEO HEALTH: readyState =', scannerVideo.readyState, 'videoWidth =', scannerVideo.videoWidth, 'videoHeight =', scannerVideo.videoHeight, 'paused =', scannerVideo.paused, 'srcObject active =', !!scannerVideo.srcObject);

    scanningActive = true;
    if (cameraToggleBtn) {
      cameraToggleBtn.textContent = 'Scanning...';
    }
    if (cameraStopBtn) {
      cameraStopBtn.hidden = false;
    }
    setModeLabel('Scanning');
    setCameraStatus('Camera Scanner: Ready', 'info');

    scannerMode = 'fallback';
    setStatus('Starting Quagga Code 128 scanner...', 'info');
    await startFallbackScanner();
  } catch (error) {
    console.error('Unable to start camera scanner:', error);
    cleanupScannerResources();
    updateViewportState('error');
    if (cameraToggleBtn) {
      cameraToggleBtn.textContent = 'Start camera';
    }
    if (cameraStopBtn) {
      cameraStopBtn.hidden = true;
    }
    setCameraStatus('Camera Scanner: Permission required', 'error');
    setStatus(getFriendlyCameraError(error), 'error');
    resetCameraPlaceholder(getFriendlyCameraError(error));
  } finally {
    if (cameraToggleBtn) {
      cameraToggleBtn.disabled = false;
    }
  }
}

function resolveZxingRuntime() {
  const namespaceCandidates = [window.ZXingBrowser, window.ZXing].filter(Boolean);
  const readerCandidates = ['BrowserCodeReader', 'BrowserMultiFormatReader', 'BrowserMultiFormatOneDReader', 'BrowserQRCodeReader', 'BrowserBarcodeReader'];

  const namespace = namespaceCandidates[0] || null;
  let readerClass = null;
  let readerName = null;

  if (namespace) {
    for (const candidateName of readerCandidates) {
      const candidateReader = namespace[candidateName];
      if (typeof candidateReader === 'function') {
        readerClass = candidateReader;
        readerName = candidateName;
        break;
      }
    }
  }

  return { namespace, readerClass, readerName };
}

async function ensureZxingLoaded() {
  const runtimeBeforeLoad = resolveZxingRuntime();
  if (runtimeBeforeLoad.readerClass) {
    console.log('ZXING RUNTIME NAMESPACE', {
      typeofZXing: typeof window.ZXing,
      typeofZXingBrowser: typeof window.ZXingBrowser,
      zxingKeys: Object.keys(window).filter((key) => /zxing/i.test(key)).slice(0, 25),
      namespace: runtimeBeforeLoad.namespace ? 'resolved' : null,
      readerName: runtimeBeforeLoad.readerName,
      readerAvailable: !!runtimeBeforeLoad.readerClass,
    });
    return runtimeBeforeLoad;
  }

  if (!zxingLoaderPromise) {
    zxingLoaderPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[data-zxing-loader="true"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(resolveZxingRuntime()), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Unable to load ZXing Browser script.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
      script.async = true;
      script.setAttribute('data-zxing-loader', 'true');
      script.onload = () => {
        const runtimeAfterLoad = resolveZxingRuntime();
        console.log('ZXING RUNTIME NAMESPACE', {
          typeofZXing: typeof window.ZXing,
          typeofZXingBrowser: typeof window.ZXingBrowser,
          zxingKeys: Object.keys(window).filter((key) => /zxing/i.test(key)).slice(0, 25),
          namespaceName: runtimeAfterLoad.namespace ? Object.keys(window).find((key) => window[key] === runtimeAfterLoad.namespace) || 'resolved namespace' : null,
          readerName: runtimeAfterLoad.readerName,
          readerAvailable: !!runtimeAfterLoad.readerClass,
          availableReaderClasses: runtimeAfterLoad.namespace ? Object.keys(runtimeAfterLoad.namespace).filter((key) => /Reader/i.test(key)).slice(0, 25) : [],
        });

        if (runtimeAfterLoad.readerClass) {
          console.log('ZXING READER AVAILABLE', {
            readerName: runtimeAfterLoad.readerName,
            constructor: runtimeAfterLoad.readerClass && runtimeAfterLoad.readerClass.name,
            typeofReader: typeof runtimeAfterLoad.readerClass,
          });
          resolve(runtimeAfterLoad);
          return;
        }

        console.warn('ZXING LOAD WARNING: script loaded but no supported reader constructor was found on the runtime namespace.');
        reject(new Error('ZXing Browser failed to load.'));
      };
      script.onerror = () => {
        console.warn('ZXING LOAD WARNING: request failed for https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js');
        reject(new Error('Unable to load ZXing Browser script.'));
      };
      document.head.appendChild(script);
    });
  }

  return await zxingLoaderPromise;
}

async function startZxingScanner() {
  if (!scannerVideo) {
    return;
  }

  try {
    await ensureZxingLoaded();

    if (!window.ZXingBrowser?.BrowserBarcodeReader || !cameraStream) {
      return;
    }

    if (zxingReader) {
      return;
    }

    const hints = new Map();
    const zxingNamespace = window.ZXingBrowser || window.ZXing;
    if (zxingNamespace?.DecodeHintType && zxingNamespace?.BarcodeFormat) {
      const supportedFormats = [
        zxingNamespace.BarcodeFormat.CODE_128,
        zxingNamespace.BarcodeFormat.CODE_39,
        zxingNamespace.BarcodeFormat.EAN_13,
        zxingNamespace.BarcodeFormat.EAN_8,
        zxingNamespace.BarcodeFormat.UPC_A,
        zxingNamespace.BarcodeFormat.UPC_E,
      ].filter(Boolean);
      hints.set(zxingNamespace.DecodeHintType.POSSIBLE_FORMATS, supportedFormats);
    }

    const reader = new window.ZXingBrowser.BrowserBarcodeReader(500, hints);
    zxingReader = reader;
    console.log('ZXING DEBUG: initialized');

    const onDecode = (result, error) => {
      console.log('ZXING DEBUG: detection event');

      if (error) {
        console.log('ZXING DEBUG: decoder error =', error);
        return;
      }

      if (!result) {
        console.log('ZXING DEBUG: no decoded value present');
        return;
      }

      const decodedValue = String(result.getText ? result.getText() : result).trim();
      console.log('ZXING DEBUG: decoded value =', decodedValue);

      if (!isLikelyValidScannerCode(decodedValue)) {
        console.log('ZXING DEBUG: rejected by validation', decodedValue);
        return;
      }

      console.log('ZXING DEBUG: passed validation', decodedValue);
      handleDetectedCode(decodedValue);
    };

    await reader.decodeFromVideoDevice(undefined, scannerVideo, onDecode, hints);
  } catch (error) {
    console.warn('ZXing Code 128 scanner failed, falling back to Quagga.', error);
    zxingReader = null;
    throw error;
  }
}

async function runZxingCode128DiagnosticOnce() {
  if (!scannerVideo) {
    console.log('ZXING CODE128 TEST STARTED', { result: 'FAILED', reason: 'scannerVideo missing' });
    console.log('ZXING DECODE FAILED', { reason: 'scannerVideo missing' });
    return { valid: false, reason: 'scannerVideo missing' };
  }

  try {
    await ensureZxingLoaded();
  } catch (error) {
    console.log('ZXING CODE128 TEST STARTED', { result: 'FAILED', reason: 'ZXing load failed', error: error?.message || String(error) });
    console.log('ZXING DECODE FAILED', { reason: 'ZXing load failed', error: error?.message || String(error) });
    return { valid: false, reason: 'ZXing load failed', error: error?.message || String(error) };
  }

  const zxingRuntime = resolveZxingRuntime();
  const BrowserBarcodeReader = zxingRuntime.readerClass;
  if (!zxingRuntime.namespace || !BrowserBarcodeReader) {
    console.log('ZXING CODE128 TEST STARTED', { result: 'FAILED', reason: 'No supported ZXing reader constructor available on the runtime namespace' });
    console.log('ZXING DECODE FAILED', { reason: 'No supported ZXing reader constructor available on the runtime namespace' });
    return { valid: false, reason: 'No supported ZXing reader constructor available on the runtime namespace' };
  }

  const zxingNamespace = zxingRuntime.namespace;
  const hints = new Map();
  if (zxingNamespace?.DecodeHintType && zxingNamespace?.BarcodeFormat) {
    hints.set(zxingNamespace.DecodeHintType.POSSIBLE_FORMATS, [zxingNamespace.BarcodeFormat.CODE_128]);
  }

  const reader = new BrowserBarcodeReader(500, hints);
  const videoWidth = scannerVideo.videoWidth || 0;
  const videoHeight = scannerVideo.videoHeight || 0;

  console.log('ZXING RUNTIME NAMESPACE', {
    namespaceName: Object.keys(window).find((key) => window[key] === zxingNamespace) || 'resolved namespace',
    typeofZXing: typeof window.ZXing,
    typeofZXingBrowser: typeof window.ZXingBrowser,
    zxingKeys: Object.keys(window).filter((key) => /zxing/i.test(key)).slice(0, 25),
    resolvedReaderName: zxingRuntime.readerName,
    resolvedReaderConstructor: BrowserBarcodeReader && BrowserBarcodeReader.name,
  });

  console.log('ZXING CODE128 TEST STARTED', {
    videoWidth,
    videoHeight,
    possibleFormats: hints.get(zxingNamespace?.DecodeHintType?.POSSIBLE_FORMATS) || ['CODE_128'],
    hasScannerVideo: !!scannerVideo,
    source: 'live scannerVideo',
    readerName: zxingRuntime.readerName,
  });

  return await new Promise((resolve) => {
    let settled = false;

    const finalize = (result) => {
      if (settled) {
        return;
      }
      settled = true;

      try {
        if (typeof reader.stopContinuousDecode === 'function') {
          reader.stopContinuousDecode();
        }
      } catch (error) {
        console.warn('ZXING DIAGNOSTIC STOP ERROR', error);
      }

      if (!result) {
        console.log('ZXING DECODE FAILED', { reason: 'no result from live frame' });
        resolve({ valid: false, reason: 'no result from live frame' });
        return;
      }

      const decodedText = String(result.getText ? result.getText() : result).trim();
      const rawFormat = typeof result.getBarcodeFormat === 'function' ? result.getBarcodeFormat() : null;
      console.log('ZXING RAW RESULT', {
        decodedText: decodedText || null,
        format: rawFormat || null,
        result,
      });

      if (decodedText) {
        console.log('ZXING CODE128 DECODE SUCCESS', decodedText);
        resolve({ valid: true, decodedText, format: rawFormat || null });
        return;
      }

      console.log('ZXING DECODE FAILED', { reason: 'empty decoded text', result });
      resolve({ valid: false, reason: 'empty decoded text', result });
    };

    const onDecode = (result, error) => {
      if (error) {
        console.log('ZXING DECODE FAILED', { error: error?.message || String(error), rawError: error });
        resolve({ valid: false, reason: 'ZXing decoder error', error: error?.message || String(error) });
        return;
      }

      finalize(result);
    };

    try {
      reader.decodeFromVideoDevice(undefined, scannerVideo, onDecode, hints);
    } catch (error) {
      console.log('ZXING DECODE FAILED', { error: error?.message || String(error), rawError: error });
      resolve({ valid: false, reason: 'decodeFromVideoDevice threw', error: error?.message || String(error) });
      return;
    }

    setTimeout(() => {
      if (!settled) {
        console.log('ZXING DECODE FAILED', { reason: 'diagnostic timeout' });
        try {
          if (typeof reader.stopContinuousDecode === 'function') {
            reader.stopContinuousDecode();
          }
          if (typeof reader.reset === 'function') {
            reader.reset();
          }
        } catch (error) {
          console.warn('ZXING DIAGNOSTIC TIMEOUT RESET ERROR', error);
        }
        resolve({ valid: false, reason: 'diagnostic timeout' });
      }
    }, 4000);
  });
}

if (typeof window !== 'undefined') {
  window.runZxingCode128DiagnosticOnce = runZxingCode128DiagnosticOnce;
}

function runQuaggaStillFrameDiagnostic() {
  if (!window.Quagga || !scannerVideo || !cameraStream || !scanningActive || scannerMode !== 'fallback') {
    return;
  }

  const frameWidth = scannerVideo.videoWidth || 1280;
  const frameHeight = scannerVideo.videoHeight || 720;
  if (!frameWidth || !frameHeight) {
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = frameWidth;
  canvas.height = frameHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.drawImage(scannerVideo, 0, 0, canvas.width, canvas.height);

  window.Quagga.decodeSingle({
    decoder: {
      readers: ['code_128_reader', 'code_39_reader', 'ean_reader', 'ean_8_reader', 'ean_13_reader', 'upc_reader'],
    },
    locate: false,
    src: canvas.toDataURL('image/png'),
  }, (result) => {
    if (result?.codeResult?.code) {
      const value = String(result.codeResult.code).trim();
      console.log('QUAGGA STILL FRAME DIAGNOSTIC: decoded =', value);
      return;
    }
    console.log('QUAGGA STILL FRAME DIAGNOSTIC: no codeResult from still frame.');
  });
}

function getCurrentBarcodeDiagnosticValue() {
  const candidates = [
    window.intakeUiState?.generatedBarcode,
    document.getElementById('barcodePrintPreviewText')?.textContent,
    document.getElementById('barcodePrintOnlyLabels')?.textContent,
    window.__currentBarcodeDiagnosticValue,
  ];

  const value = candidates.find((entry) => typeof entry === 'string' && entry.trim());
  return value ? String(value).trim() : 'AB09022026001';
}

function resolveSvgDimensions(svg) {
  const widthAttribute = svg.getAttribute('width');
  const heightAttribute = svg.getAttribute('height');
  const viewBox = svg.getAttribute('viewBox') || '';

  const parseNumeric = (value) => {
    if (typeof value !== 'string') {
      return 0;
    }

    const match = value.match(/-?\d*\.?\d+/);
    return match ? Number(match[0]) : 0;
  };

  let resolvedWidth = parseNumeric(widthAttribute);
  let resolvedHeight = parseNumeric(heightAttribute);

  if (!resolvedWidth || !resolvedHeight) {
    const viewBoxParts = viewBox.split(/\s+/).map((part) => Number(part)).filter((part) => Number.isFinite(part));
    if (viewBoxParts.length >= 4) {
      resolvedWidth = viewBoxParts[2] || 0;
      resolvedHeight = viewBoxParts[3] || 0;
    }
  }

  return {
    widthAttribute,
    heightAttribute,
    viewBox,
    resolvedWidth,
    resolvedHeight,
  };
}

function renderJsBarcodeToRaster(barcodeValue, options, labelName = 'BARCODE') {
  return new Promise((resolve) => {
    if (typeof window.JsBarcode !== 'function') {
      console.log('STATIC DIAGNOSTIC ERROR — JsBarcode is not loaded on scanner.html');
      resolve({ valid: false, reason: 'JsBarcode unavailable', value: barcodeValue });
      return;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '1200');
    svg.setAttribute('height', '260');
    svg.setAttribute('viewBox', '0 0 1200 260');

    try {
      window.JsBarcode(svg, barcodeValue, options);
    } catch (error) {
      console.warn(labelName + ' JSBARCODE RENDER ERROR', error);
      console.log(labelName + ' STATIC TEST INVALID — BARCODE NOT RENDERED');
      resolve({ valid: false, reason: 'JsBarcode render error', value: barcodeValue });
      return;
    }

    console.log('STATIC SVG RAW OUTPUT', {
      jsBarcodeAvailable: typeof window.JsBarcode,
      svgOuterHTML: svg.outerHTML,
      widthAttribute: svg.getAttribute('width'),
      heightAttribute: svg.getAttribute('height'),
      viewBox: svg.getAttribute('viewBox'),
      childElementCount: svg.childElementCount,
      childNodeCount: svg.childNodes.length,
      innerHTMLLength: svg.innerHTML.length,
      rectCount: svg.querySelectorAll('rect').length,
      pathCount: svg.querySelectorAll('path').length,
      textCount: svg.querySelectorAll('text').length,
    });
    console.log('STATIC SVG PREVIEW', svg.outerHTML.slice(0, 1000));

    const dimensions = resolveSvgDimensions(svg);
    const { widthAttribute, heightAttribute, viewBox, resolvedWidth, resolvedHeight } = dimensions;

    console.log('STATIC BARCODE SVG CHECK', {
      value: barcodeValue,
      svgWidthAttribute: widthAttribute,
      svgHeightAttribute: heightAttribute,
      viewBox,
      resolvedWidth,
      resolvedHeight,
    });

    const hasBarcodeDrawingElements = svg.childElementCount > 0 && (
      svg.querySelectorAll('rect').length > 0 ||
      svg.querySelectorAll('path').length > 0 ||
      svg.querySelectorAll('g').length > 0 ||
      svg.querySelectorAll('line').length > 0 ||
      svg.querySelectorAll('polygon').length > 0
    );

    if (!resolvedWidth || !resolvedHeight) {
      if (!hasBarcodeDrawingElements) {
        console.log(labelName + ' STATIC TEST INVALID — BARCODE NOT RENDERED');
        resolve({ valid: false, reason: 'svg lacks dimensions and drawing elements', value: barcodeValue });
        return;
      }

      const temporaryContainer = document.createElement('div');
      temporaryContainer.style.position = 'absolute';
      temporaryContainer.style.left = '-99999px';
      temporaryContainer.style.top = '-99999px';
      temporaryContainer.style.visibility = 'hidden';
      temporaryContainer.style.pointerEvents = 'none';
      temporaryContainer.appendChild(svg);
      document.body.appendChild(temporaryContainer);

      const rect = svg.getBoundingClientRect();
      const measuredWidth = Number(rect.width || 0);
      const measuredHeight = Number(rect.height || 0);

      temporaryContainer.remove();

      console.log('STATIC BARCODE OFFSCREEN MEASURE', {
        measuredWidth,
        measuredHeight,
      });

      if (!measuredWidth || !measuredHeight) {
        console.log(labelName + ' STATIC TEST INVALID — BARCODE NOT RENDERED');
        resolve({ valid: false, reason: 'offscreen measurement still zero', value: barcodeValue });
        return;
      }
    }

    const finalDimensions = resolveSvgDimensions(svg);
    if (!finalDimensions.resolvedWidth || !finalDimensions.resolvedHeight) {
      const temporaryContainer = document.createElement('div');
      temporaryContainer.style.position = 'absolute';
      temporaryContainer.style.left = '-99999px';
      temporaryContainer.style.top = '-99999px';
      temporaryContainer.style.visibility = 'hidden';
      temporaryContainer.style.pointerEvents = 'none';
      temporaryContainer.appendChild(svg);
      document.body.appendChild(temporaryContainer);

      const rect = svg.getBoundingClientRect();
      const width = Number(rect.width || 0);
      const height = Number(rect.height || 0);
      temporaryContainer.remove();

      if (!width || !height) {
        console.log(labelName + ' STATIC TEST INVALID — BARCODE NOT RENDERED');
        resolve({ valid: false, reason: 'all dimensions zero after measurement', value: barcodeValue });
        return;
      }
    }

    const serializer = new XMLSerializer();
    const svgMarkup = serializer.serializeToString(svg);
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const imageUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      const imageWidth = Number(image.naturalWidth || image.width || resolveSvgDimensions(svg).resolvedWidth || 0);
      const imageHeight = Number(image.naturalHeight || image.height || resolveSvgDimensions(svg).resolvedHeight || 0);

      console.log('STATIC BARCODE IMAGE READY', {
        imageWidth,
        imageHeight,
      });

      if (!imageWidth || !imageHeight) {
        console.log(labelName + ' STATIC TEST INVALID — BARCODE NOT RENDERED');
        URL.revokeObjectURL(imageUrl);
        resolve({ valid: false, reason: 'zero image dimensions', value: barcodeValue });
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = imageWidth;
      canvas.height = imageHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        console.log(labelName + ' STATIC TEST INVALID — BARCODE NOT RENDERED');
        URL.revokeObjectURL(imageUrl);
        resolve({ valid: false, reason: 'canvas context unavailable', value: barcodeValue });
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const pngDataUrl = canvas.toDataURL('image/png');
      console.log('STATIC PNG GENERATED', {
        width: canvas.width,
        height: canvas.height,
        dataUrlPrefix: pngDataUrl.slice(0, 50),
        isPng: pngDataUrl.startsWith('data:image/png'),
      });

      console.log('STATIC BARCODE CANVAS READY', {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });

      URL.revokeObjectURL(imageUrl);
      resolve({
        valid: true,
        value: barcodeValue,
        imageDataUrl: pngDataUrl,
        svgWidth: resolveSvgDimensions(svg).resolvedWidth,
        svgHeight: resolveSvgDimensions(svg).resolvedHeight,
        rasterWidth: canvas.width,
        rasterHeight: canvas.height,
        imageWidth,
        imageHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        pngGenerated: true,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      console.log(labelName + ' STATIC TEST INVALID — BARCODE NOT RENDERED');
      resolve({ valid: false, reason: 'image load failed', value: barcodeValue });
    };

    image.src = imageUrl;
  });
}

async function runStaticBarcodeValidationDiagnostic(barcodeValue = 'AB09022026001') {
  const safeBarcodeValue = typeof barcodeValue === 'string' && barcodeValue.trim()
    ? barcodeValue.trim()
    : 'AB09022026001';

  const productionConfig = {
    format: 'CODE128',
    displayValue: false,
    width: 3.0,
    height: 70,
    margin: 10,
    background: '#ffffff',
    lineColor: '#111827',
  };

  const controlConfig = {
    format: 'CODE128',
    displayValue: false,
    width: 4.0,
    height: 100,
    margin: 16,
    background: '#ffffff',
    lineColor: '#111827',
  };

  async function runDecodeTest(label, config, value) {
    if (!window.Quagga) {
      console.log(label + ' STATIC TEST', { value, result: 'FAILED' });
      console.log('STATIC CODE128 DECODE FAILED');
      return { valid: false, value, reason: 'no Quagga' };
    }

    const rendered = await renderJsBarcodeToRaster(value, config, label);
    if (!rendered.valid) {
      console.log(label + ' STATIC TEST', { value, result: 'FAILED' });
      return { valid: false, value, reason: rendered.reason };
    }

    console.log(label + ' STATIC TEST', {
      value,
      svgWidth: rendered.svgWidth,
      svgHeight: rendered.svgHeight,
      rasterWidth: rendered.rasterWidth,
      rasterHeight: rendered.rasterHeight,
    });

    console.log('QUAGGA STATIC INPUT', {
      type: typeof rendered.imageDataUrl,
      prefix: rendered.imageDataUrl.slice(0, 50),
      length: rendered.imageDataUrl.length,
    });

    const quaggaStaticConfig = {
      src: rendered.imageDataUrl,
      numOfWorkers: 0,
      inputStream: {
        size: 0,
      },
      decoder: {
        readers: ['code_128_reader'],
      },
      locate: true,
    };

    console.log('QUAGGA STATIC CONFIG', {
      sourceImageWidth: rendered.rasterWidth,
      sourceImageHeight: rendered.rasterHeight,
      inputStreamSize: quaggaStaticConfig.inputStream.size,
      numOfWorkers: quaggaStaticConfig.numOfWorkers,
      locate: quaggaStaticConfig.locate,
      readers: quaggaStaticConfig.decoder.readers,
    });

    return new Promise((resolve) => {
      window.Quagga.decodeSingle(quaggaStaticConfig, (result) => {
        const decoded = result?.codeResult?.code ? String(result.codeResult.code).trim() : '';
        const format = result?.codeResult?.format || null;
        const boxesLength = Array.isArray(result?.boxes) ? result.boxes.length : 0;

        console.log('QUAGGA STATIC RAW RESULT', {
          resultExists: !!result,
          codeResultExists: !!result?.codeResult,
          decodedCode: decoded || null,
          decodedFormat: format,
          boxesCount: boxesLength,
          fullResult: result || null,
        });

        if (decoded) {
          console.log('STATIC CODE128 DECODE SUCCESS:', decoded);
          console.log('EXPECTED:', value);
          console.log('MATCH:', decoded === value);
          console.log(label + ' DECODE RESULT: SUCCESS');
          resolve({ valid: true, value, decoded, svgWidth: rendered.svgWidth, svgHeight: rendered.svgHeight, rasterWidth: rendered.rasterWidth, rasterHeight: rendered.rasterHeight, pngGenerated: true });
          return;
        }

        console.log('STATIC CODE128 DECODE FAILED');
        console.log(label + ' DECODE RESULT: FAILED');
        resolve({ valid: false, value, reason: 'no result', svgWidth: rendered.svgWidth, svgHeight: rendered.svgHeight, rasterWidth: rendered.rasterWidth, rasterHeight: rendered.rasterHeight, pngGenerated: true });
      });
    });
  }

  console.log('PRODUCTION BARCODE STATIC TEST', {
    value: safeBarcodeValue,
    format: productionConfig.format,
    width: productionConfig.width,
    height: productionConfig.height,
    margin: productionConfig.margin,
  });

  const productionResult = await runDecodeTest('PRODUCTION', productionConfig, safeBarcodeValue);

  console.log('CONTROL BARCODE STATIC TEST', {
    value: safeBarcodeValue,
    format: controlConfig.format,
    width: controlConfig.width,
    height: controlConfig.height,
    margin: controlConfig.margin,
  });

  const controlResult = await runDecodeTest('CONTROL', controlConfig, safeBarcodeValue);

  console.log('PRODUCTION RESULT:', productionResult.valid ? 'SUCCESS' : 'FAILED');
  console.log('CONTROL RESULT:', controlResult.valid ? 'SUCCESS' : 'FAILED');
  return { production: productionResult, control: controlResult };
}

if (typeof window !== 'undefined') {
  window.runStaticBarcodeValidationDiagnostic = runStaticBarcodeValidationDiagnostic;
}

async function startFallbackScanner() {
  if (!window.Quagga) {
    setCameraStatus('Camera Scanner: Unavailable', 'error');
    setStatus('Scanner is not supported on this browser.', 'error');
    updateViewportState('error');
    resetCameraPlaceholder('Scanner is not supported on this browser.');
    return;
  }

  try {
    if (quaggaDetectedHandler) {
      window.Quagga.offDetected(quaggaDetectedHandler);
    }
    if (quaggaProcessedHandler) {
      window.Quagga.offProcessed(quaggaProcessedHandler);
      quaggaProcessedHandler = null;
    }

    if (!scannerVideo) {
      throw new Error('Scanner video element is missing.');
    }

    scannerVideo.style.display = 'block';
    scannerVideo.style.visibility = 'visible';
    scannerVideo.style.opacity = '1';
    scannerVideo.style.width = '100%';
    scannerVideo.style.height = '100%';
    scannerVideo.style.objectFit = 'cover';
    scannerVideo.style.position = 'absolute';
    scannerVideo.style.inset = '0';
    scannerVideo.style.zIndex = '1';
    if (cameraPlaceholder) {
      cameraPlaceholder.style.display = 'none';
    }

    quaggaProcessedHandler = (result) => {
      const boxes = Array.isArray(result?.boxes) ? result.boxes : [];
      const decodedCode = String(result?.codeResult?.code || result?.barcodes?.[0]?.code || '').trim();
      const hasRegion = boxes.length > 0;
      const codeResult = result?.codeResult || null;
      const barcodes = Array.isArray(result?.barcodes) ? result.barcodes : [];

      renderQuaggaDebugFrame(result);

      if (hasRegion) {
        console.log('BARCODE REGION FOUND', { boxCount: boxes.length });

        boxes.forEach((box, index) => {
          const points = Array.isArray(box) ? box : [];
          const xs = points
            .filter((point) => Array.isArray(point) && point.length >= 2)
            .map((point) => Number(point[0]));
          const ys = points
            .filter((point) => Array.isArray(point) && point.length >= 2)
            .map((point) => Number(point[1]));
          const minX = xs.length ? Math.min(...xs) : 0;
          const maxX = xs.length ? Math.max(...xs) : 0;
          const minY = ys.length ? Math.min(...ys) : 0;
          const maxY = ys.length ? Math.max(...ys) : 0;
          const width = maxX - minX;
          const height = maxY - minY;

          console.log('BARCODE REGION GEOMETRY', {
            index,
            points: points.slice(0, 4),
            minX,
            maxX,
            minY,
            maxY,
            width,
            height,
          });
        });

        if (!codeResult?.code && !barcodes.some((barcode) => barcode && barcode.code)) {
          console.log('LOCATOR FOUND REGION BUT NO CODE128 RESULT');
        }
      }

      if (codeResult || barcodes.length) {
        const candidateCode = codeResult?.code || barcodes.find((barcode) => barcode && barcode.code)?.code || null;
        const candidateFormat = codeResult?.format || barcodes.find((barcode) => barcode && barcode.format)?.format || null;

        console.log('CODE RESULT CANDIDATE', {
          code: candidateCode,
          format: candidateFormat,
          codeResult: codeResult ? {
            code: codeResult.code || null,
            format: codeResult.format || null,
          } : null,
          barcodesCount: barcodes.length,
        });
      }

      if (decodedCode) {
        console.log('CODE128 DECODE SUCCESS', decodedCode);
      }
    };

    quaggaDetectedHandler = (result) => {
      const detectedCode = result?.codeResult?.code?.trim();
      if (!detectedCode) {
        return;
      }

      console.log('ONDETECTED ENTERED', detectedCode);
      console.log('QUAGGA DETECTED:', detectedCode);
      console.log('QUAGGA → handleDetectedCode:', detectedCode);
      handleDetectedCode(detectedCode);
    };

    console.log('QUAGGA TARGET VIDEO', { scannerVideo: !!scannerVideo, cameraViewport: !!cameraViewport, scannerVideoElement: scannerVideo, cameraViewportElement: cameraViewport });

    await new Promise((resolve, reject) => {
      window.Quagga.init(
        {
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: scannerVideo,
            constraints: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          locator: {
            patchSize: 'medium',
            halfSample: false,
          },
          numOfWorkers: 1,
          frequency: 5,
          decoder: {
            readers: ['code_128_reader'],
          },
          locate: true,
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          console.log('QUAGGA INITIALIZED');
          ensureQuaggaPreviewVisible();
          logActiveCameraVideoState('ACTIVE CAMERA VIDEO ELEMENT');
          console.log('REGISTERING onProcessed', window.Quagga);
          window.Quagga.onProcessed(quaggaProcessedHandler);
          console.log('REGISTERING onDetected', window.Quagga);
          window.Quagga.onDetected(quaggaDetectedHandler);
          window.Quagga.start();
          quaggaStarted = true;
          quaggaRunning = true;
          console.log('QUAGGA STARTED');
          logActiveCameraVideoState('ACTIVE CAMERA VIDEO ELEMENT AFTER QUAGGA START');
          resolve();
        }
      );
    });

    setStatus('QUAGGA ready. Scan the physical barcode.', 'info');
  } catch (error) {
    console.warn('Quagga scanner failed:', error);
    setCameraStatus('Camera Scanner: Error', 'error');
    setStatus('Quagga scanner failed. Please try again.', 'error');
  }
}

function scanNativeFrame() {
  if (!scanningActive || scannerMode !== 'native' || !detector || !scannerVideo.videoWidth || !scannerVideo.videoHeight) {
    if (scanningActive && scannerMode === 'native') {
      nativeAnimationFrameId = requestAnimationFrame(scanNativeFrame);
    }
    return;
  }

  scheduleNextScanFrame(() => {
    const canvas = document.createElement('canvas');
    canvas.width = scannerVideo.videoWidth;
    canvas.height = scannerVideo.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(scannerVideo, 0, 0, canvas.width, canvas.height);

    detector.detect(canvas).then((barcodes) => {
      if (barcodes?.length) {
        handleDetectedCode(barcodes[0].rawValue);
      }
    }).catch(() => {
      // Ignore transient scan frame failures and continue.
    }).finally(() => {
      if (scanningActive && scannerMode === 'native') {
        nativeAnimationFrameId = requestAnimationFrame(scanNativeFrame);
      }
    });
  });
}

let quaggaDebugCanvas = null;

function ensureQuaggaDebugCanvas() {
  if (!cameraViewport || !scannerVideo) {
    return null;
  }

  if (!quaggaDebugCanvas) {
    const debugCanvas = document.createElement('canvas');
    debugCanvas.id = 'quagga-debug-canvas';
    debugCanvas.width = 320;
    debugCanvas.height = 180;
    debugCanvas.style.position = 'absolute';
    debugCanvas.style.right = '12px';
    debugCanvas.style.bottom = '12px';
    debugCanvas.style.width = '220px';
    debugCanvas.style.height = '120px';
    debugCanvas.style.border = '2px solid rgba(239, 68, 68, 0.9)';
    debugCanvas.style.borderRadius = '8px';
    debugCanvas.style.background = 'rgba(15, 23, 42, 0.7)';
    debugCanvas.style.boxShadow = '0 10px 24px rgba(0, 0, 0, 0.25)';
    debugCanvas.style.zIndex = '20';
    debugCanvas.style.pointerEvents = 'none';
    debugCanvas.style.objectFit = 'contain';
    cameraViewport.appendChild(debugCanvas);
    quaggaDebugCanvas = debugCanvas;
  }

  return quaggaDebugCanvas;
}

function renderQuaggaDebugFrame(result = null) {
  if (!scannerVideo || !cameraViewport) {
    return;
  }

  const debugCanvas = ensureQuaggaDebugCanvas();
  if (!debugCanvas) {
    return;
  }

  const videoWidth = scannerVideo.videoWidth || 960;
  const videoHeight = scannerVideo.videoHeight || 540;

  if (!videoWidth || !videoHeight) {
    return;
  }

  const targetWidth = Math.min(videoWidth, 320);
  const targetHeight = Math.max(1, Math.round((videoHeight / videoWidth) * targetWidth));

  if (debugCanvas.width !== targetWidth || debugCanvas.height !== targetHeight) {
    debugCanvas.width = targetWidth;
    debugCanvas.height = targetHeight;
  }

  const ctx = debugCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  ctx.drawImage(scannerVideo, 0, 0, debugCanvas.width, debugCanvas.height);

  const boxes = Array.isArray(result?.boxes) ? result.boxes : [];
  const codeValue = result?.codeResult?.code || result?.barcodes?.[0]?.code || 'NONE';

  if (boxes.length) {
    const widthScale = debugCanvas.width / videoWidth;
    const heightScale = debugCanvas.height / videoHeight;

    ctx.strokeStyle = 'rgba(34, 197, 94, 1)';
    ctx.lineWidth = 2;

    boxes.forEach((box, index) => {
      if (!Array.isArray(box) || box.length < 4) {
        return;
      }

      const x = box[0] * widthScale;
      const y = box[1] * heightScale;
      const w = box[2] * widthScale;
      const h = box[3] * heightScale;

      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
      ctx.fillText(`R${index + 1}`, x + 6, y + 16);
    });
  }

  ctx.strokeStyle = 'rgba(248, 113, 113, 1)';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, debugCanvas.width - 16, debugCanvas.height - 16);

  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText(`VIDEO: ${videoWidth}x${videoHeight}`, 12, 22);
  ctx.fillText(`BOXES: ${boxes.length}`, 12, 40);
  ctx.fillText(`CODE: ${codeValue === 'NONE' ? 'NONE' : codeValue}`, 12, 58);
}

function renderQuaggaRegionOverlay(result) {
  if (!result || !Array.isArray(result.boxes) || !result.boxes.length) {
    return;
  }

  renderQuaggaDebugFrame(result);
}

function scanFallbackFrame() {
  if (!scanningActive || scannerMode !== 'fallback') {
    return;
  }

  scheduleNextScanFrame(() => {
    if (!scannerVideo.videoWidth || !scannerVideo.videoHeight) {
      fallbackFrameHandle = requestAnimationFrame(scanFallbackFrame);
      return;
    }

    renderQuaggaDebugFrame();

    const canvas = document.createElement('canvas');
    canvas.width = scannerVideo.videoWidth;
    canvas.height = scannerVideo.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(scannerVideo, 0, 0, canvas.width, canvas.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR?.(imageData.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
    if (result?.data) {
      handleDetectedCode(result.data);
    }

    if (scanningActive && scannerMode === 'fallback') {
      fallbackFrameHandle = requestAnimationFrame(scanFallbackFrame);
    }
  });
}

function resetExactTransferVerification() {
  activeExactTransferVerification = null;
  if (receiptModal) {
    receiptModal.classList.add('hidden');
    receiptModal.classList.remove('flex');
  }
  if (receiptDetails) {
    receiptDetails.innerHTML = '';
  }
  if (confirmReceiptBtn) {
    confirmReceiptBtn.disabled = false;
    confirmReceiptBtn.textContent = 'Confirm Receipt';
  }
}

function processExactTransferUnitScan(rawValue) {
  if (!activeExactTransferVerification) {
    return;
  }

  const exactState = activeExactTransferVerification;
  const normalizedCode = `${rawValue || ''}`.replace(/[\x00-\x1F\x7F]/g, '').trim().toUpperCase();

  if (!normalizedCode) {
    setStatus('Enter a serialized unit barcode to verify.', 'error');
    return;
  }

  if (!isSerializedItemBarcode(normalizedCode)) {
    setStatus('This is not a valid serialized item barcode.', 'error');
    return;
  }

  const expectedSet = new Set(exactState.expectedBarcodes);
  const verifiedSet = new Set(exactState.verifiedBarcodes);

  if (verifiedSet.has(normalizedCode)) {
    setStatus('DUPLICATE ITEM: this serialized unit has already been verified.', 'error');
    return;
  }

  if (!expectedSet.has(normalizedCode)) {
    setStatus('WRONG ITEM: this serialized unit is not part of the selected transfer.', 'error');
    return;
  }

  exactState.verifiedBarcodes = [...verifiedSet, normalizedCode].sort();
  const verifiedCount = exactState.verifiedBarcodes.length;
  const totalCount = exactState.expectedBarcodes.length;

  if (verifiedCount >= totalCount) {
    setStatus(`All ${totalCount} serialized items verified. Ready to confirm receipt.`, 'success');
  } else {
    setStatus(`Verified ${verifiedCount}/${totalCount} serialized items.`, 'success');
  }

  renderExactTransferVerification(exactState.transfer, exactState);
  barcodeInput.value = normalizedCode;
  scanInProgress = false;
}

function renderExactTransferVerification(transfer, state = activeExactTransferVerification) {
  if (!transfer || !state) {
    return;
  }

  const expectedBarcodes = Array.isArray(state.expectedBarcodes) && state.expectedBarcodes.length
    ? state.expectedBarcodes
    : Array.isArray(transfer.expected_unit_barcodes)
      ? transfer.expected_unit_barcodes
      : [];

  const verifiedBarcodes = Array.isArray(state.verifiedBarcodes) ? state.verifiedBarcodes : [];
  const totalCount = expectedBarcodes.length;
  const verifiedCount = expectedBarcodes.filter((code) => verifiedBarcodes.includes(code)).length;
  const allVerified = totalCount > 0 && totalCount === verifiedCount;

  const branchNameMap = window.branchNameMap || {};
  const sourceBranch = branchNameMap[transfer.source_branch_id] || transfer.source_branch_id || 'N/A';
  const destinationBranch = branchNameMap[transfer.destination_branch_id] || transfer.destination_branch_id || 'N/A';

  const rows = expectedBarcodes.map((code, index) => {
    const isVerified = verifiedBarcodes.includes(code);
    const statusText = isVerified ? 'Verified' : 'Pending';
    const statusClass = isVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
    const itemLabel = transfer.expected_serialized_units?.[index]?.product_uuid || 'Serialized item';

    return `
      <div class="flex items-center justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-3">
        <div class="min-w-0">
          <div class="font-semibold text-on-surface">${itemLabel}</div>
          <div class="font-mono text-xs text-on-surface-variant">${code}</div>
        </div>
        <span class="inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClass}">${statusText}</span>
      </div>
    `;
  }).join('');

  receiptDetails.innerHTML = `
    <div class="space-y-4">
      <div class="border-b border-[#E2E8F0] pb-4 text-center">
        <div class="text-lg font-bold text-on-surface">Exact transfer verification</div>
        <div class="text-sm text-on-surface-variant">Verify each serialized item before final receipt confirmation.</div>
      </div>

      <div class="space-y-2">
        <div class="flex justify-between gap-4">
          <span class="text-on-surface-variant">Tracking code</span>
          <span class="font-mono font-semibold text-right">${transfer.tracking_code || 'N/A'}</span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-on-surface-variant">Source</span>
          <span class="font-semibold text-right">${sourceBranch}</span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-on-surface-variant">Destination</span>
          <span class="font-semibold text-right">${destinationBranch}</span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-on-surface-variant">Expected items</span>
          <span class="font-semibold text-right">${verifiedCount}/${totalCount}</span>
        </div>
      </div>

      <div class="rounded-lg border border-[#E2E8F0] bg-slate-50 p-3">
        <div class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-secondary">Serialized item list</div>
        <div class="space-y-2">${rows || '<div class="text-sm text-on-surface-variant">No expected barcode records.</div>'}</div>
      </div>

      <div class="rounded-lg border border-[#E2E8F0] p-3">
        <div class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-secondary">Verify barcode</div>
        <div class="flex gap-2">
          <input id="transferVerificationInput" type="text" autocomplete="off" placeholder="Scan or type item barcode" class="min-w-0 flex-1 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-primary focus:ring-primary">
          <button id="transferVerificationSubmitBtn" type="button" class="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-container">Verify</button>
        </div>
      </div>
    </div>
  `;

  const verifyInput = document.getElementById('transferVerificationInput');
  const verifyButton = document.getElementById('transferVerificationSubmitBtn');
  verifyButton?.addEventListener('click', () => processExactTransferUnitScan(verifyInput?.value || ''));
  verifyInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      processExactTransferUnitScan(verifyInput.value);
    }
  });

  confirmReceiptBtn.disabled = !allVerified;
  confirmReceiptBtn.textContent = allVerified ? 'Confirm Receipt' : 'Scan all items';
  confirmReceiptBtn.onclick = async () => {
    if (!allVerified) {
      setStatus('All expected serialized items must be verified before receipt confirmation.', 'error');
      return;
    }

    try {
      confirmReceiptBtn.disabled = true;
      confirmReceiptBtn.textContent = 'Receiving...';

      const payload = {
        tracking_code: transfer.tracking_code,
        scanned_serialized_unit_barcodes: [...new Set(exactState.verifiedBarcodes)],
        user: getCurrentUsername(),
      };

      const receiveResult = await apiRequest('/receive/transfer', {
        method: 'POST',
        body: payload,
      });

      if (!receiveResult?.success) {
        throw new Error(receiveResult?.message || 'Failed to receive transfer.');
      }

      setStatus('Transfer received successfully.', 'success');
      closeReceiptAndResumeScanner('Transfer received successfully');
    } catch (error) {
      console.error('Exact transfer receive failed:', error);
      confirmReceiptBtn.disabled = false;
      confirmReceiptBtn.textContent = 'Confirm Receipt';
      setStatus(error.message || 'Failed to receive transfer.', 'error');
    }
  };
}

function handleDetectedCode(code) {
  const normalizedCode = `${code || ''}`.replace(/[\x00-\x1F\x7F]/g, '').trim();
  console.log('HANDLE DETECTED CODE ENTERED:', normalizedCode);

  if (!normalizedCode) {
    return;
  }

  if (!isLikelyValidScannerCode(normalizedCode)) {
    return;
  }

  if (activeExactTransferVerification) {
    if (scanInProgress) {
      return;
    }

    const transferNow = Date.now();
    if (normalizedCode === lastDetectedCode && transferNow - lastDetectionAt < 1800) {
      return;
    }

    lastDetectedCode = normalizedCode;
    lastDetectionAt = transferNow;
    scanInProgress = true;
    barcodeInput.value = normalizedCode;
    if (isSerializedItemBarcode(normalizedCode)) {
      processExactTransferUnitScan(normalizedCode);
      return;
    }

    setStatus('Place the transfer verification barcode into the exact item scan field.', 'error');
    scanInProgress = false;
    return;
  }

  const currentRole = getCurrentUserRole();
  if (canPrepareMainSourceIntake() && isMainSourceIntakeCandidate(normalizedCode)) {
    const now = Date.now();
    if (successfullyProcessedIntakeBarcodes.has(normalizedCode) || scanInProgress || (normalizedCode === lastDetectedCode && now - lastDetectionAt < 1800)) {
      return;
    }

    if (normalizedCode !== intakeConfirmationValue || now - intakeConfirmationStartedAt > intakeConfirmationWindowMs) {
      intakeConfirmationValue = normalizedCode;
      intakeConfirmationCount = 1;
      intakeConfirmationStartedAt = now;
      console.log('[Scanner Intake] Confirmation 1/2:', normalizedCode);
      return;
    }

    intakeConfirmationCount += 1;
    console.log('[Scanner Intake] Confirmation 2/2:', normalizedCode);
    intakeConfirmationValue = '';
    intakeConfirmationCount = 0;
    intakeConfirmationStartedAt = 0;
    lastDetectedCode = normalizedCode;
    lastDetectionAt = now;
    scanInProgress = true;
    barcodeInput.value = normalizedCode;
    stopCamera();
    void prepareMainSourceIntakeFromScan(normalizedCode)
      .catch((error) => {
        console.error('[Scanner Intake] Barcode preparation failed:', error);
      })
      .finally(() => {
        scanInProgress = false;
      });
    return;
  }

  if (scanInProgress) {
    return;
  }

  const now = Date.now();
  if (normalizedCode === lastDetectedCode && now - lastDetectionAt < 1800) {
    return;
  }

  lastDetectedCode = normalizedCode;
  lastDetectionAt = now;
  scanInProgress = true;
  barcodeInput.value = normalizedCode;

  // Serialized unit barcode: primary physical-item identity for the final runtime workflow.
  if (isSerializedItemBarcode(normalizedCode)) {
    console.log('SERIALIZED ITEM BARCODE DETECTED:', normalizedCode);

    setModeLabel('Item Barcode Detected');
    setStatus('Serialized item barcode detected.', 'success');

    if (currentRole === 'delivery_personnel') {
      stopCamera();
      void processDeliveryPickupScan(normalizedCode);
      return;
    }

    // Preserve intake behavior. Only a unit already marked IN_TRANSIT is
    // routed into destination delivery receipt after its status is checked.
    void (async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/intake/status/${encodeURIComponent(normalizedCode)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const result = await response.json();
        if (response.ok && result?.success && String(result.status || '').toUpperCase() === 'IN_TRANSIT') {
          stopCamera();
          await processDeliveryReceiveScan(normalizedCode);
          return;
        }
      } catch (error) {
        console.warn('Delivery status pre-check failed; using existing item lookup.', error);
      }
      await lookupSerializedItemStatus(normalizedCode);
      scanInProgress = false;
    })();
    stopCamera();
    return;
  }

  // TRF- prefix: transfer metadata only, not the physical item barcode.
  if (normalizedCode.toUpperCase().startsWith('TRF-')) {
    console.log('TRANSFER TRACKING CODE DETECTED:', normalizedCode);

    setModeLabel('Transfer Detected');
    setStatus(`Transfer detected: ${normalizedCode}`, 'success');

    stopCamera();

    void lookupTransfer(normalizedCode);
    return;
  }

  // Legacy ADD- compatibility remains for older intake flows, but it is not the final
  // operational physical-item workflow.
  if (normalizedCode.toUpperCase().startsWith('ADD-')) {
    console.log('ADD BARCODE DETECTED (LEGACY COMPAT):', normalizedCode);

    setModeLabel('Legacy Intake Detected');
    setStatus(`Legacy ADD barcode detected: ${normalizedCode}`, 'info');

    stopCamera();

    void performAddBarcodeIntake(normalizedCode);
    return;
  }

  if (/^\d+$/.test(normalizedCode)) {
    console.warn('Rejected invalid numeric Quagga false-positive:', normalizedCode);
    setStatus('Invalid barcode scan ignored.', 'error');
    scanInProgress = false;
    return;
  }

  // Default: Product barcode
  console.log('PRODUCT BARCODE DETECTED:', normalizedCode);

  setModeLabel('Barcode Detected');
  setStatus('Barcode detected.', 'success');

  void lookupBarcode(normalizedCode);
  stopCamera();
}

setCameraStatus('Camera Scanner: Ready', 'info');
window.addEventListener('keydown', handleHardwareKeydown);

scannerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const barcode = barcodeInput.value.trim();
  await lookupBarcode(barcode);
});

cameraToggleBtn?.addEventListener('click', async () => {
  if (cameraStream) {
    stopCamera();
    return;
  }
  await startCamera();
});

cameraStopBtn?.addEventListener('click', () => stopCamera());
window.addEventListener('beforeunload', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  }
});
