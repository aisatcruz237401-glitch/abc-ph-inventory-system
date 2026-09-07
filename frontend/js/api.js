// Resolve the backend origin dynamically so the app works when served from localhost or a fallback local origin.
const DEFAULT_BACKEND_ORIGIN = 'http://localhost:3000';
const BACKEND_ORIGINS = [DEFAULT_BACKEND_ORIGIN, 'http://127.0.0.1:3000'];
const resolveApiBase = () => {
  if (typeof window !== 'undefined' && window.location?.origin && BACKEND_ORIGINS.includes(window.location.origin)) {
    return `${window.location.origin}/api`;
  }

  return `${DEFAULT_BACKEND_ORIGIN}/api`;
};

const API_BASE = resolveApiBase();

async function apiRequest(path, options = {}) {
  const headers = options.headers || {};
  const token = localStorage.getItem('token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    credentials: 'include',
    ...options,
    headers,
  };

  if (config.body && typeof config.body !== 'string') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(`${API_BASE}${path}`, config);
  const responseText = await response.text();
  let responseBody = null;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    const errorMessage = responseBody?.message || responseText || 'API request failed';
    throw new Error(errorMessage);
  }

  return responseBody;
}

async function fetchProducts() {
  return apiRequest('/products');
}

async function fetchBranches() {
  return apiRequest('/branches');
}

async function fetchInventory() {
  return apiRequest('/inventory');
}

async function fetchReports() {
  return apiRequest('/reports');
}

async function receiveStock(data) {
  return apiRequest('/receive', { method: 'POST', body: data });
}

async function consumeStock(data) {
  return apiRequest('/consume', { method: 'POST', body: data });
}

async function getProductByBarcode(code) {
  return apiRequest(`/products/barcode/${encodeURIComponent(code)}`);
}

async function intakeByAddBarcode(add_barcode, created_by = 'system') {
  return apiRequest('/intake/add-barcode', {
    method: 'POST',
    body: { add_barcode, created_by }
  });
}

async function getIntakeProducts() {
  return apiRequest('/intake/products');
}

async function getUnitStatus(vx_barcode) {
  return apiRequest(`/intake/status/${encodeURIComponent(vx_barcode)}`);
}

async function loginUser(credentials) {
  return apiRequest('/auth/login', { method: 'POST', body: credentials });
}
