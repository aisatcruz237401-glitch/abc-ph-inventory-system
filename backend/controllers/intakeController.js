const { supabase, isSupabaseEnabled } = require('../config/supabase');

const MAIN_SOURCE_BRANCH_NAME = 'Pasong Buaya Main Source';
const pendingMainSourceItems = new Map();

function normalizeBarcode(value) {
  return String(value ?? '').replace(/[\x00-\x1F\x7F]/g, '').trim().toUpperCase();
}

function normalizePendingItemDate(value) {
  return normalizeIntakeDate(value);
}

function buildProductDateBarcodePrefix(productName) {
  const letters = String(productName || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!letters) {
    return 'AB';
  }
  return letters.slice(0, 2).padEnd(2, 'X');
}

function buildProductDateBarcode(productName, intakeDate, sequenceNumber) {
  const prefix = buildProductDateBarcodePrefix(productName);
  const datePart = normalizeIntakeDate(intakeDate);
  if (!datePart) {
    throw new Error('A valid intake date is required.');
  }

  const normalizedDate = datePart.match(/^\d{4}-\d{2}-\d{2}$/)
    ? datePart.split('-').reverse().join('')
    : datePart;

  const sequence = Number(sequenceNumber || 1);
  return `${prefix}${normalizedDate}${String(sequence).padStart(3, '0')}`;
}

async function computeNextPendingMainSourceBarcode(productUuid, productName, intakeDate) {
  if (!productUuid || !productName || !intakeDate) {
    throw new Error('Product UUID, product name, and intake date are required.');
  }

  const normalizedDate = normalizeIntakeDate(intakeDate);
  if (!normalizedDate) {
    throw new Error('A valid intake date is required.');
  }

  const prefix = buildProductDateBarcodePrefix(productName);
  const datePart = normalizedDate.split('-').reverse().join('');
  const pattern = `^${prefix}${datePart}[0-9]{3}$`;

  const pendingMatches = Array.from(pendingMainSourceItems.values()).filter((item) => {
    return item.product_uuid === productUuid && item.intake_date === normalizedDate && item.barcode && new RegExp(pattern, 'i').test(item.barcode);
  });

  const usedNumbers = new Set(pendingMatches.map((item) => Number(String(item.barcode).slice(-3)) || 0));

  if (!isSupabaseEnabled || !supabase) {
    const nextSequence = Math.max(...Array.from(usedNumbers), 0) + 1;
    return `${prefix}${datePart}${String(nextSequence).padStart(3, '0')}`;
  }

  try {
    const { data, error } = await supabase
      .from('serialized_units')
      .select('unit_barcode')
      .eq('product_uuid', productUuid)
      .like('unit_barcode', `${prefix}${datePart}%`);

    if (error) {
      throw error;
    }

    const existing = Array.isArray(data) ? data : [];
    existing.forEach((row) => {
      const code = String(row.unit_barcode || '').trim();
      const match = code.match(
  new RegExp(`^${prefix}${datePart}(\\d{3})$`, 'i')
);
      if (match) {
        usedNumbers.add(Number(match[1]));
      }
    });

    let nextSequence = Math.max(...Array.from(usedNumbers), 0) + 1;
    let candidate = `${prefix}${datePart}${String(nextSequence).padStart(3, '0')}`;
    let attempts = 0;

    while (pendingMainSourceItems.has(candidate) || (Array.isArray(data) && data.some((row) => String(row.unit_barcode || '').toUpperCase() === candidate.toUpperCase()))) {
      attempts += 1;
      nextSequence += 1;
      candidate = `${prefix}${datePart}${String(nextSequence).padStart(3, '0')}`;
      if (attempts > 1000) {
        throw new Error('Barcode generation collision detected.');
      }
    }

    return candidate;
  } catch (error) {
    console.warn('Falling back to in-memory pending barcode generation due to Supabase lookup issue:', error);
    const nextSequence = Math.max(...Array.from(usedNumbers), 0) + 1;
    return `${prefix}${datePart}${String(nextSequence).padStart(3, '0')}`;
  }
}

function isMainSourceStaffRole(user) {
  if (!user) return false;

  const role = String(user?.role || '').toLowerCase().trim();

  const branch = String(
    user?.branch ||
    user?.assigned_branch ||
    user?.branch_name ||
    ''
  ).toLowerCase().trim();

  // Admin access
  if (['admin', 'superadmin'].includes(role)) {
    return true;
  }

  // Only staff assigned to Pasong Buaya Main Source
  if (
    role === 'staff' &&
    branch === MAIN_SOURCE_BRANCH_NAME.toLowerCase()
  ) {
    return true;
  }

  return false;
}

async function resolveMainSourceBranchId() {
  if (!isSupabaseEnabled || !supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('branches')
      .select('id, branch_name')
      .eq('branch_name', MAIN_SOURCE_BRANCH_NAME)
      .limit(1);

    if (error) {
      throw error;
    }

    return data?.[0]?.id || null;
  } catch (error) {
    console.error('Failed to resolve Main Source branch:', error);
    return null;
  }
}

/**
 * POST /api/intake/add-barcode
 * Create a single-unit intake by scanning ADD barcode
 * 
 * Request body: { add_barcode, created_by }
 * Response: { success, vx_barcode, serialized_unit_id, product_uuid, product_name, inventory_qty }
 */
exports.intakeByAddBarcode = async (req, res) => {
  // Authorization check
  if (!isMainSourceStaffRole(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to perform Main Source intake. Main Source staff or admin access required.',
    });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({
      success: false,
      message: 'Supabase is not configured for this environment.',
    });
  }

  const { add_barcode, created_by } = req.body;

  // Validate inputs
  if (!add_barcode || typeof add_barcode !== 'string' || add_barcode.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'ADD barcode is required and must be a non-empty string.',
    });
  }

  const normalizedAddBarcode = add_barcode.trim();
  const createdByValue = created_by || req.user?.username || 'system';

  try {
    // Call the atomic RPC
    const { data, error } = await supabase.rpc('create_main_source_intake_unit', {
      p_add_barcode: normalizedAddBarcode,
      p_created_by: createdByValue,
    });

    if (error) {
      console.error('RPC error:', error);
      
      const errorMessage = (error.message || '').toLowerCase();

      if (errorMessage.includes('add_barcode_required')) {
        return res.status(400).json({
          success: false,
          message: 'ADD barcode is required.',
        });
      }

      if (errorMessage.includes('add_barcode_not_found')) {
        return res.status(404).json({
          success: false,
          message: 'Product with this ADD barcode not found.',
        });
      }

      if (errorMessage.includes('main_source_not_found')) {
        return res.status(500).json({
          success: false,
          message: 'Main Source branch not found. Please contact administrator.',
        });
      }

      if (errorMessage.includes('intake_creation_failed')) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create intake. Please try again.',
          error: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Intake RPC failed.',
        error: error.message,
      });
    }

    // Parse response
    const resultRow = Array.isArray(data) ? data[0] : data;

    if (!resultRow) {
      return res.status(500).json({
        success: false,
        message: 'RPC returned no result.',
      });
    }

    if (resultRow.success === false) {
      return res.status(400).json({
        success: false,
        message: resultRow.error || 'Intake creation failed.',
      });
    }

    // Success response
    return res.json({
      success: true,
      message: 'Unit intake created successfully.',
      vx_barcode: resultRow.vx_barcode,
      serialized_unit_id: resultRow.serialized_unit_id,
      product_uuid: resultRow.product_uuid,
      product_name: resultRow.product_name,
      inventory_qty: resultRow.inventory_qty,
      branch_id: resultRow.branch_id,
      created_at: resultRow.created_at,
    });

  } catch (error) {
    console.error('Intake endpoint error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process intake request.',
      error: error.message,
    });
  }
};

function normalizeIntakeDate(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [month, day, year] = trimmed.split('/');
    return `${year}-${month}-${day}`;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    const [month, day, year] = trimmed.split('-');
    return `${year}-${month}-${day}`;
  }

  return null;
}

exports.createMainSourceIntake = async (req, res) => {
  if (!isMainSourceStaffRole(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to perform Main Source intake. Main Source staff or admin access required.',
    });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({
      success: false,
      message: 'Supabase is not configured for this environment.',
    });
  }

  const productUuid = String(
    req.body?.product_uuid || req.body?.productId || req.body?.product_id || ''
  ).trim();
  const intakeDate = normalizeIntakeDate(req.body?.intake_date || req.body?.date || '');
  const quantity = Number(req.body?.quantity ?? 1);
  const createdByValue = String(req.body?.created_by || req.user?.username || 'system').trim() || 'system';

  if (!productUuid) {
    return res.status(400).json({
      success: false,
      message: 'Product is required.',
    });
  }

  if (!intakeDate) {
    return res.status(400).json({
      success: false,
      message: 'A valid intake date is required (MM/DD/YYYY or YYYY-MM-DD).',
    });
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({
      success: false,
      message: 'Quantity must be a positive whole number.',
    });
  }

  try {
    // Final Admin/Main Source intake path must resolve through the final one-barcode
    // batch RPC contract: product_uuid + intake date + quantity + created_by.
    const { data, error } = await supabase.rpc('create_main_source_intake_batch', {
      p_product_uuid: productUuid,
      p_intake_date: intakeDate,
      p_quantity: quantity,
      p_created_by: createdByValue,
    });

    if (error) {
      const message = (error.message || '').toLowerCase();

      if (message.includes('does not exist') || message.includes('function') || message.includes('schema cache')) {
        return res.status(501).json({
          success: false,
          message: 'Final one-barcode intake RPC is not available in the live Supabase database yet. The migration has not been applied.',
          error: error.message,
        });
      }

      if (message.includes('product_required')) {
        return res.status(400).json({ success: false, message: 'Product is required.' });
      }

      if (message.includes('date_required') || message.includes('invalid_date')) {
        return res.status(400).json({ success: false, message: 'A valid intake date is required.' });
      }

      if (message.includes('quantity_required') || message.includes('quantity_must')) {
        return res.status(400).json({ success: false, message: 'Quantity must be a positive whole number.' });
      }

      if (message.includes('product_not_found')) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }

      if (message.includes('main_source_not_found')) {
        return res.status(500).json({ success: false, message: 'Main Source branch not found.' });
      }

      if (message.includes('intake_creation_failed')) {
        return res.status(500).json({ success: false, message: 'Failed to create Main Source intake batch.', error: error.message });
      }

      return res.status(500).json({
        success: false,
        message: 'Main Source intake RPC failed.',
        error: error.message,
      });
    }

    const resultRow = Array.isArray(data) ? data[0] : data;
    if (!resultRow) {
      return res.status(500).json({ success: false, message: 'RPC returned no result.' });
    }

    if (resultRow.success === false) {
      return res.status(400).json({ success: false, message: resultRow.error || 'Intake creation failed.' });
    }

    return res.json({
      success: true,
      message: `${quantity} ${resultRow.product_name || 'product'} unit(s) added to Main Source.`,
      product_name: resultRow.product_name,
      product_uuid: resultRow.product_uuid,
      inventory_qty: resultRow.inventory_qty,
      generated_barcodes: Array.isArray(resultRow.generated_barcodes) ? resultRow.generated_barcodes : [],
      branch_id: resultRow.branch_id,
      intake_date: resultRow.intake_date,
      created_at: resultRow.created_at,
    });
  } catch (error) {
    console.error('Main Source intake endpoint error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process Main Source intake request.',
      error: error.message,
    });
  }
};

/**
 * GET /api/intake/products
 * List all active products available for Main Source intake.
 */
exports.getIntakeProducts = async (req, res) => {
  // Authorization check (Main Source staff or admin)
  if (!isMainSourceStaffRole(req.user)) {
    return res.status(403).json({
      message:
        'You are not authorized to view intake products. Main Source staff or admin access required.',
    });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({
      message: 'Supabase is not configured for this environment.',
    });
  }

  try {
    console.log('[Intake Products] Request user:', {
      id: req.user?.id,
      username: req.user?.username,
      role: req.user?.role,
      branch: req.user?.branch,
    });

    const { data, error } = await supabase
      .from('products')
      .select(
        'id, uuid, barcode, add_item_barcode, intake_prefix, product_name, category, is_active'
      )
      .eq('is_active', true)
      .order('product_name');

    if (error) {
      console.error('[Intake Products] Supabase query failed:', error);

      return res.status(500).json({
        message: 'Failed to fetch intake products.',
        error: error.message,
        code: error.code,
      });
    }

    console.log('[Intake Products] Product count:', data?.length || 0);

    console.log(
      '[Intake Products] Tetanus Toxoid product:',
      data?.find(
        (product) =>
          String(product.barcode).trim().toUpperCase() === 'ABC000003'
      )
    );

    return res.json(data || []);

  } catch (error) {
    console.error('[Intake Products] Unexpected error:', error);

    return res.status(500).json({
      message: 'Failed to fetch intake products.',
      error: error.message,
    });
  }
};

/**
 * GET /api/intake/status/:vx_barcode
 * Check the status of a scanned unit by VX barcode
 * 
 * Response: { success, status, product_name, product_uuid, inventory_qty }
 */
exports.createPendingMainSourceItem = async (req, res) => {
  if (!isMainSourceStaffRole(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to generate pending Main Source items.',
    });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({
      success: false,
      message: 'Supabase is not configured for this environment.',
    });
  }

  const requestedBarcode = normalizeBarcode(req.body?.barcode);

  const productUuid = String(
    req.body?.product_uuid ||
    req.body?.productId ||
    req.body?.product_id ||
    ''
  ).trim();

  const intakeDate = normalizePendingItemDate(
    req.body?.intake_date ||
    req.body?.date ||
    ''
  );

  if (!productUuid) {
    return res.status(400).json({
      success: false,
      message: 'Product UUID is required.',
    });
  }

  if (!intakeDate) {
    return res.status(400).json({
      success: false,
      message: 'A valid intake date is required.',
    });
  }

  try {
    /*
      Get product directly from database.

      We do NOT trust product_name sent by the browser.
      The database remains the source of truth.
    */

    const { data: productRows, error: productError } = await supabase
      .from('products')
      .select(`
        id,
        uuid,
        product_name,
        is_active
      `)
      .eq('uuid', productUuid)
      .limit(1);

    if (productError) {
      throw productError;
    }

    const product = productRows?.[0];

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    if (product.is_active !== true) {
      return res.status(400).json({
        success: false,
        message: 'Product is not active.',
      });
    }

    /*
      Always resolve the REAL Main Source branch.
    */

    const branchId = await resolveMainSourceBranchId();

    if (!branchId) {
      return res.status(404).json({
        success: false,
        message: 'Pasong Buaya Main Source branch not found.',
      });
    }

    /*
      Generate barcode if scanner did not provide one.
    */

    let barcode = requestedBarcode;

    if (!barcode) {
      barcode = await computeNextPendingMainSourceBarcode(
        product.uuid,
        product.product_name,
        intakeDate
      );
    }

    /*
      Prevent already registered serialized unit.
    */

    const { data: existingRows, error: existingError } = await supabase
      .from('serialized_units')
      .select('id')
      .eq('unit_barcode', barcode)
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    if (existingRows?.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This barcode is already registered.',
      });
    }

    /*
      Store only temporarily.

      Nothing has been added to inventory yet.
    */

    const pendingItem = {
      barcode,
      product_uuid: product.uuid,
      product_name: product.product_name,

      branch_id: branchId,
      branch_name: MAIN_SOURCE_BRANCH_NAME,

      intake_date: intakeDate,

      generated_by:
        req.user?.username ||
        req.user?.name ||
        'system',

      created_at: new Date().toISOString(),

      status: 'PENDING_MAIN_SOURCE',
    };

    pendingMainSourceItems.set(barcode, pendingItem);

    return res.json({
      success: true,

      pending: true,

      barcode,

      product_uuid: product.uuid,

      product_name: product.product_name,

      branch_id: branchId,

      branch_name: MAIN_SOURCE_BRANCH_NAME,

      intake_date: intakeDate,

      status: 'PENDING_MAIN_SOURCE',

      message:
        'Barcode prepared successfully. Confirm ADD TO INVENTORY to register it.',
    });

  } catch (error) {
    console.error(
      'Failed to create pending Main Source item:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to create pending Main Source item.',
      error: error.message,
    });
  }
};

exports.registerPendingMainSourceItem = async (req, res) => {
  if (!isMainSourceStaffRole(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to register pending Main Source items.',
    });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({
      success: false,
      message: 'Supabase is not configured for this environment.',
    });
  }

  const barcode = normalizeBarcode(req.body?.barcode || req.body?.unit_barcode);
  if (!barcode) {
    return res.status(400).json({ success: false, message: 'Barcode is required.' });
  }

  try {
    const pendingItem = pendingMainSourceItems.get(barcode);
    if (!pendingItem) {
      const { data: registeredRows, error: registeredError } = await supabase
        .from('serialized_units')
        .select('id, product_uuid, branch_id, unit_barcode, status, created_at')
        .eq('unit_barcode', barcode)
        .limit(1);

      if (registeredError) {
        throw registeredError;
      }

      if (Array.isArray(registeredRows) && registeredRows.length > 0) {
        const existing = registeredRows[0];
        const { data: productRows } = await supabase
          .from('products')
          .select('product_name')
          .eq('uuid', existing.product_uuid)
          .limit(1);

        return res.json({
          success: true,
          already_registered: true,
          barcode,
          product_name: productRows?.[0]?.product_name || 'Unknown product',
          status: existing.status || 'AVAILABLE',
          branch_id: existing.branch_id,
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Pending generated Main Source item not found.',
      });
    }

    const { data: productRows, error: productError } = await supabase
      .from('products')
      .select('id, uuid, product_name, is_active')
      .eq('uuid', pendingItem.product_uuid)
      .limit(1);

    if (productError) {
      throw productError;
    }

    const product = Array.isArray(productRows) ? productRows[0] : null;
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (product.is_active !== true && product.is_active !== 'true') {
      return res.status(400).json({ success: false, message: 'Product is not active.' });
    }

    const { data: existingUnits, error: existingUnitError } = await supabase
      .from('serialized_units')
      .select('id, product_uuid, branch_id, status, unit_barcode')
      .eq('unit_barcode', barcode)
      .limit(1);

    if (existingUnitError) {
      throw existingUnitError;
    }

    if (Array.isArray(existingUnits) && existingUnits.length > 0) {
      pendingMainSourceItems.delete(barcode);
      return res.json({
        success: true,
        already_registered: true,
        barcode,
        product_name: product.product_name,
        status: existingUnits[0].status || 'AVAILABLE',
        branch_id: existingUnits[0].branch_id,
      });
    }

    const { data: branchRows, error: branchError } = await supabase
  .from('branches')
  .select('id, branch_name')
  .eq('id', pendingItem.branch_id)
  .limit(1);

    if (branchError) {
      throw branchError;
    }

    const branch = Array.isArray(branchRows) ? branchRows[0] : null;
    if (!branch) {
      return res.status(404).json({ success: false, message: 'Main Source branch not found.' });
    }

    const { data: maxRows, error: maxError } = await supabase
      .from('serialized_units')
      .select('sequence_number')
      .eq('product_uuid', product.uuid)
      .eq('branch_id', branch.id)
      .order('sequence_number', { ascending: false })
      .limit(1);

    if (maxError) {
      throw maxError;
    }

    const nextSequence = Number((Array.isArray(maxRows) && maxRows[0]?.sequence_number) || 0) + 1;

    const { data: insertedRows, error: insertError } = await supabase
      .from('serialized_units')
      .insert({
        product_uuid: product.uuid,
        branch_id: branch.id,
        sequence_number: nextSequence,
        unit_barcode: barcode,
        status: 'AVAILABLE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id, product_uuid, branch_id, unit_barcode, status');

    if (insertError) {
      throw insertError;
    }

    const inserted = Array.isArray(insertedRows) ? insertedRows[0] : null;

    const { data: inventoryRows, error: inventoryFetchError } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('product_uuid', product.uuid)
      .eq('branch_id', branch.id)
      .limit(1);

    if (inventoryFetchError) {
      throw inventoryFetchError;
    }

    const currentInventory = Number((Array.isArray(inventoryRows) && inventoryRows[0]?.quantity) || 0);
    const nextInventory = currentInventory + 1;

    if (Array.isArray(inventoryRows) && inventoryRows.length > 0) {
      const { error: inventoryUpdateError } = await supabase
        .from('inventory')
        .update({ quantity: nextInventory, last_updated: new Date().toISOString() })
        .eq('product_uuid', product.uuid)
        .eq('branch_id', branch.id);

      if (inventoryUpdateError) {
        throw inventoryUpdateError;
      }
    } else {
      const { error: inventoryInsertError } = await supabase
        .from('inventory')
        .insert({
          product_uuid: product.uuid,
          branch_id: branch.id,
          branch: branch.branch_name || MAIN_SOURCE_BRANCH_NAME,
          quantity: 1,
          last_updated: new Date().toISOString(),
        });

      if (inventoryInsertError) {
        throw inventoryInsertError;
      }
    }

    const { error: stockError } = await supabase
      .from('stock_transactions')
      .insert({
        product_uuid: product.uuid,
        branch_id: branch.id,
        barcode,
        branch: branch.branch_name || MAIN_SOURCE_BRANCH_NAME,
        type: 'RECEIVE',
        quantity: 1,
        user_name: req.user?.username || pendingItem.generated_by || 'system',
        date: new Date().toISOString(),
        tracking_code: null,
      });

    if (stockError) {
      throw stockError;
    }

    pendingMainSourceItems.delete(barcode);

    return res.json({
      success: true,
      barcode,    
      product_uuid: product.uuid,
      product_name: product.product_name,
      branch_id: branch.id,
      branch_name: branch.branch_name || MAIN_SOURCE_BRANCH_NAME,
      status: inserted?.status || 'AVAILABLE',
      inventory_quantity: nextInventory,
      registered: true,
    });
  } catch (error) {
    console.error('Failed to register pending Main Source item:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to register pending Main Source item.',
      error: error.message,
    });
  }
};

/**
 * Register multiple generated pending Main Source items.
 *
 * Body:
 * {
 *   barcodes: ["BARCODE1", "BARCODE2", ...]
 * }
 */
exports.registerPendingMainSourceItems = async (req, res) => {
  if (!isMainSourceStaffRole(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to register pending Main Source items.',
    });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({
      success: false,
      message: 'Supabase is not configured for this environment.',
    });
  }

  const rawBarcodes = Array.isArray(req.body?.barcodes)
    ? req.body.barcodes
    : [];

  const barcodes = [
    ...new Set(
      rawBarcodes
        .map((barcode) => normalizeBarcode(barcode))
        .filter(Boolean)
    ),
  ];

  if (barcodes.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'At least one barcode is required.',
    });
  }

  try {
    const results = [];
    const errors = [];

    for (const barcode of barcodes) {
      try {
        const pendingItem = pendingMainSourceItems.get(barcode);

        if (!pendingItem) {
          const { data: existingUnits, error: existingUnitError } = await supabase
            .from('serialized_units')
            .select('id, product_uuid, branch_id, unit_barcode, status')
            .eq('unit_barcode', barcode)
            .limit(1);

          if (existingUnitError) {
            throw existingUnitError;
          }

          if (Array.isArray(existingUnits) && existingUnits.length > 0) {
            results.push({
              barcode,
              already_registered: true,
              product_uuid: existingUnits[0].product_uuid,
              branch_id: existingUnits[0].branch_id,
              status: existingUnits[0].status || 'AVAILABLE',
            });
            continue;
          }

          errors.push({
            barcode,
            message: 'Pending generated Main Source item not found.',
          });
          continue;
        }

        const { data: productRows, error: productError } = await supabase
          .from('products')
          .select('uuid, product_name, is_active')
          .eq('uuid', pendingItem.product_uuid)
          .limit(1);

        if (productError) {
          throw productError;
        }

        const product = Array.isArray(productRows)
          ? productRows[0]
          : null;

        if (!product) {
          errors.push({
            barcode,
            message: 'Product not found.',
          });
          continue;
        }

        if (
          product.is_active !== true &&
          product.is_active !== 'true'
        ) {
          errors.push({
            barcode,
            message: 'Product is not active.',
          });
          continue;
        }

        const { data: existingUnits, error: existingUnitError } = await supabase
          .from('serialized_units')
          .select('id, product_uuid, branch_id, status')
          .eq('unit_barcode', barcode)
          .limit(1);

        if (existingUnitError) {
          throw existingUnitError;
        }

        if (Array.isArray(existingUnits) && existingUnits.length > 0) {
          pendingMainSourceItems.delete(barcode);

          results.push({
            barcode,
            product_uuid: existingUnits[0].product_uuid,
            product_name: product.product_name,
            branch_id: existingUnits[0].branch_id,
            status: existingUnits[0].status || 'AVAILABLE',
            already_registered: true,
          });

          continue;
        }

        const { data: branchRows, error: branchError } = await supabase
          .from('branches')
          .select('id, branch_name')
          .eq('id', pendingItem.branch_id)
          .limit(1);

        if (branchError) {
          throw branchError;
        }

        const branch = Array.isArray(branchRows)
          ? branchRows[0]
          : null;

        if (!branch) {
          errors.push({
            barcode,
            message: 'Main Source branch not found.',
          });
          continue;
        }

        const { data: maxRows, error: maxError } = await supabase
          .from('serialized_units')
          .select('sequence_number')
          .eq('product_uuid', product.uuid)
          .eq('branch_id', branch.id)
          .order('sequence_number', { ascending: false })
          .limit(1);

        if (maxError) {
          throw maxError;
        }

        const nextSequence =
          Number(
            (
              Array.isArray(maxRows) &&
              maxRows[0]?.sequence_number
            ) || 0
          ) + 1;

        const now = new Date().toISOString();

        const { data: insertedRows, error: insertError } = await supabase
          .from('serialized_units')
          .insert({
            product_uuid: product.uuid,
            branch_id: branch.id,
            sequence_number: nextSequence,
            unit_barcode: barcode,
            status: 'AVAILABLE',
            created_at: now,
            updated_at: now,
          })
          .select('id, product_uuid, branch_id, unit_barcode, status');

        if (insertError) {
          throw insertError;
        }

        const inserted = Array.isArray(insertedRows)
          ? insertedRows[0]
          : null;

        const { data: inventoryRows, error: inventoryFetchError } =
          await supabase
            .from('inventory')
            .select('quantity')
            .eq('product_uuid', product.uuid)
            .eq('branch_id', branch.id)
            .limit(1);

        if (inventoryFetchError) {
          throw inventoryFetchError;
        }

        const currentInventory = Number(
          (
            Array.isArray(inventoryRows) &&
            inventoryRows[0]?.quantity
          ) || 0
        );

        const nextInventory = currentInventory + 1;

        if (
          Array.isArray(inventoryRows) &&
          inventoryRows.length > 0
        ) {
          const { error: inventoryUpdateError } = await supabase
            .from('inventory')
            .update({
              quantity: nextInventory,
              last_updated: now,
            })
            .eq('product_uuid', product.uuid)
            .eq('branch_id', branch.id);

          if (inventoryUpdateError) {
            throw inventoryUpdateError;
          }
        } else {
          const { error: inventoryInsertError } = await supabase
            .from('inventory')
            .insert({
              product_uuid: product.uuid,
              branch_id: branch.id,
              branch:
                branch.branch_name || MAIN_SOURCE_BRANCH_NAME,
              quantity: 1,
              last_updated: now,
            });

          if (inventoryInsertError) {
            throw inventoryInsertError;
          }
        }

        const { error: stockError } = await supabase
          .from('stock_transactions')
          .insert({
            product_uuid: product.uuid,
            branch_id: branch.id,
            barcode,
            branch:
              branch.branch_name || MAIN_SOURCE_BRANCH_NAME,
            type: 'RECEIVE',
            quantity: 1,
            user_name:
              req.user?.username ||
              pendingItem.generated_by ||
              'system',
            date: now,
            tracking_code: null,
          });

        if (stockError) {
          throw stockError;
        }

        pendingMainSourceItems.delete(barcode);

        results.push({
          barcode,
          product_uuid: product.uuid,
          product_name: product.product_name,
          branch_id: branch.id,
          branch_name:
            branch.branch_name || MAIN_SOURCE_BRANCH_NAME,
          status: inserted?.status || 'AVAILABLE',
          registered: true,
          already_registered: false,
        });

      } catch (itemError) {
        console.error(
          `Failed to register pending barcode ${barcode}:`,
          itemError
        );

        errors.push({
          barcode,
          message: itemError.message || 'Failed to register barcode.',
        });
      }
    }

    return res.json({
      success: errors.length === 0,
      partial_success:
        results.length > 0 && errors.length > 0,
      total_requested: barcodes.length,
      total_registered: results.length,
      total_failed: errors.length,
      results,
      errors,
    });

  } catch (error) {
    console.error(
      'Failed to register pending Main Source items:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to register pending Main Source items.',
      error: error.message,
    });
  }
};

exports.getUnitStatus = async (req, res) => {
  const { vx_barcode } = req.params;

  if (!vx_barcode || typeof vx_barcode !== 'string' || vx_barcode.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'VX barcode is required.',
    });
  }

  const barcode = normalizeBarcode(vx_barcode);

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({
      success: false,
      message: 'Supabase is not configured for this environment.',
    });
  }

  try {
    const { data: units, error: unitError } = await supabase
      .from('serialized_units')
      .select('id, product_uuid, branch_id, status, created_at, unit_barcode')
      .eq('unit_barcode', barcode)
      .limit(1);

    if (unitError) {
      throw unitError;
    }

    if (!units || units.length === 0) {
      const pendingItem = pendingMainSourceItems.get(barcode);
      if (pendingItem) {
        return res.json({
          success: true,
          pending: true,
          barcode,
          status: 'PENDING_MAIN_SOURCE',
          product_name: pendingItem.product_name,
          product_uuid: pendingItem.product_uuid,
          branch_id: pendingItem.branch_id,
          branch_name: pendingItem.branch_name || MAIN_SOURCE_BRANCH_NAME,
          intake_date: pendingItem.intake_date || null,
          generated_by: pendingItem.generated_by,
          created_at: pendingItem.created_at,
          message: 'Pending Main Source item detected.',
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Product or pending item not found.',
      });
    }

    const unit = units[0];

    const { data: products, error: productError } = await supabase
      .from('products')
      .select('uuid, product_name')
      .eq('uuid', unit.product_uuid)
      .limit(1);

    if (productError) {
      throw productError;
    }

    const product = products?.[0];
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    return res.json({
      success: true,
      pending: false,
      vx_barcode: barcode,
      serialized_unit_id: unit.id,
      status: unit.status,
      branch_id: unit.branch_id,
      product_name: product.product_name,
      product_uuid: product.uuid,
      created_at: unit.created_at,
    });

  } catch (error) {
    console.error('Failed to get unit status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get unit status.',
      error: error.message,
    });
  }
};
