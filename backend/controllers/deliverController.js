const { supabase, isSupabaseEnabled } = require('../config/supabase');

function isUnrestrictedUserRole(user) {
  return ['admin', 'superadmin'].includes(String(user?.role || '').toLowerCase());
}

async function resolveUserBranchUuid(user) {
  if (!user || isUnrestrictedUserRole(user)) {
    return null;
  }

  const branchName = String(user?.branch || user?.assigned_branch || '').trim();
  if (!branchName) {
    return null;
  }

  if (!isSupabaseEnabled || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('branches')
    .select('id, branch_name')
    .ilike('branch_name', branchName)
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0]?.id || null;
}

async function authorizeBranchAccess(req, expectedBranchId) {
  if (!req?.user) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }

  if (isUnrestrictedUserRole(req.user)) {
    return { ok: true };
  }

  const userBranchId = await resolveUserBranchUuid(req.user);
  if (!userBranchId) {
    return { ok: false, status: 403, message: 'User branch assignment is missing or invalid.' };
  }

  if (!expectedBranchId) {
    return { ok: false, status: 400, message: 'Branch ID is required.' };
  }

  if (String(expectedBranchId).trim() !== String(userBranchId).trim()) {
    return { ok: false, status: 403, message: 'You are not authorized for this branch.' };
  }

  return { ok: true };
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function normalizeUuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  return uuidPattern.test(trimmed) ? trimmed : null;
}

function isSerializedItemBarcode(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.startsWith('ADD-') || trimmed.startsWith('TRF-')) {
    return false;
  }

  return /^[A-Za-z]{2}\d{8}\d{4}$/.test(trimmed);
}

async function handleSerializedTransferItem(req, res) {
  const trackingCode = String(req.body?.tracking_code || req.body?.trf_code || '').trim();
  const unitBarcode = String(req.body?.unit_barcode || req.body?.barcode || '').trim();
  const sourceBranchId = req.body?.from_branch_id || req.body?.source_branch_id || null;

  if (!trackingCode) {
    return res.status(400).json({ success: false, message: 'Tracking code is required for serialized-item transfer.' });
  }

  if (!unitBarcode || !isSerializedItemBarcode(unitBarcode)) {
    return res.status(400).json({ success: false, message: 'Valid serialized item barcode is required.' });
  }

  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
    }

    const { data: transfer, error: transferError } = await supabase
      .from('transfer_headers')
      .select('id, tracking_code, source_branch_id, destination_branch_id, status')
      .eq('tracking_code', trackingCode)
      .maybeSingle();

    if (transferError) {
      throw transferError;
    }

    if (!transfer) {
      return res.status(404).json({ success: false, message: 'Transfer not found.' });
    }

    if (String(transfer.status || '').toUpperCase() !== 'IN_TRANSIT') {
      return res.status(400).json({ success: false, message: 'Transfer is not in transit.' });
    }

    const sourceBranch = normalizeUuid(sourceBranchId || transfer.source_branch_id);
    if (!sourceBranch) {
      return res.status(400).json({ success: false, message: 'Source branch is required.' });
    }

    if (String(transfer.source_branch_id).trim() !== String(sourceBranch).trim()) {
      return res.status(403).json({ success: false, message: 'The serialized item does not belong to this source branch.' });
    }

    const { data: unitRows, error: unitError } = await supabase
      .from('serialized_units')
      .select('id, product_uuid, branch_id, status, unit_barcode, sequence_number')
      .eq('unit_barcode', unitBarcode)
      .limit(1);

    if (unitError) {
      throw unitError;
    }

    const unit = Array.isArray(unitRows) ? unitRows[0] : null;
    if (!unit) {
      return res.status(404).json({ success: false, message: 'Serialized item not found.' });
    }

    if (String(unit.status || '').toUpperCase() !== 'AVAILABLE') {
      return res.status(400).json({ success: false, message: 'Serialized item is not available for transfer.' });
    }

    if (String(unit.branch_id || '').trim() !== String(sourceBranch).trim()) {
      return res.status(403).json({ success: false, message: 'Serialized item is not assigned to the source branch.' });
    }

    const { data: inventoryRows, error: inventoryError } = await supabase
      .from('inventory')
      .select('product_uuid, branch_id, quantity')
      .eq('product_uuid', unit.product_uuid)
      .eq('branch_id', sourceBranch)
      .limit(1);

    if (inventoryError) {
      throw inventoryError;
    }

    const currentInventory = Number((Array.isArray(inventoryRows) ? inventoryRows[0]?.quantity : 0) || 0);
    if (currentInventory < 1) {
      return res.status(400).json({ success: false, message: 'Insufficient stock for this serialized item.' });
    }

    const { error: updateError } = await supabase
      .from('serialized_units')
      .update({ status: 'IN_TRANSIT', updated_at: new Date().toISOString() })
      .eq('id', unit.id);

    if (updateError) {
      throw updateError;
    }

    const nextInventory = Math.max(0, currentInventory - 1);
    const { error: inventoryUpdateError } = await supabase
      .from('inventory')
      .update({ quantity: nextInventory, last_updated: new Date().toISOString() })
      .eq('product_uuid', unit.product_uuid)
      .eq('branch_id', sourceBranch);

    if (inventoryUpdateError) {
      throw inventoryUpdateError;
    }

    const { error: stockError } = await supabase
      .from('stock_transactions')
      .insert({
        product_uuid: unit.product_uuid,
        branch_id: sourceBranch,
        barcode: unitBarcode,
        branch: 'Pasong Buaya Main Source',
        type: 'TRANSFER_OUT',
        quantity: 1,
        user_name: req.user?.username || 'system',
        date: new Date().toISOString(),
        tracking_code: trackingCode,
      });

    if (stockError) {
      throw stockError;
    }

    return res.json({
      success: true,
      message: 'Serialized item transferred successfully.',
      tracking_code: trackingCode,
      unit_barcode: unitBarcode,
      status: 'IN_TRANSIT',
      source_branch_id: sourceBranch,
      inventory_quantity: nextInventory,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Serialized item transfer failed.', error: error.message });
  }
}

exports.deliverStock = async (req, res) => {
  const { from_branch_id, to_branch_id, barcode, quantity, user, tracking_code, unit_barcode } = req.body;
  const serializedBarcode = String(unit_barcode || barcode || '').trim();

  if (isSerializedItemBarcode(serializedBarcode) && tracking_code) {
    return handleSerializedTransferItem(req, res);
  }

  if (!from_branch_id || !to_branch_id) {
    return res.status(400).json({ message: 'Source and destination branches are required.' });
  }

  const normalizedSourceId = normalizeUuid(from_branch_id);
  const normalizedDestinationId = normalizeUuid(to_branch_id);

  if (!normalizedSourceId || !normalizedDestinationId) {
    return res.status(400).json({ message: 'Branch IDs must be valid UUIDs.' });
  }

  if (normalizedSourceId === normalizedDestinationId) {
    return res.status(400).json({ message: 'A branch cannot deliver stock to itself.' });
  }

  if (!barcode || typeof barcode !== 'string' || barcode.trim().length === 0) {
    return res.status(400).json({ message: 'Product barcode is required.' });
  }

  const qty = normalizePositiveInteger(quantity);
  if (qty === null) {
    return res.status(400).json({ message: 'Quantity must be a positive whole number.' });
  }

  try {
    const authCheck = await authorizeBranchAccess(req, normalizedSourceId);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ message: authCheck.message });
    }

    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({ message: 'Supabase delivery path is not configured for this environment.' });
    }

    const rpcPayload = {
      p_from_branch_id: normalizedSourceId,
      p_to_branch_id: normalizedDestinationId,
      p_barcode: barcode.trim(),
      p_qty: qty,
      p_user: user || 'system',
    };

    const { data, error } = await supabase.rpc('create_transfer', rpcPayload);

    if (error) {
      const message = error.message || 'Delivery RPC failed.';
     if (/does not exist|function.*create_transfer|schema cache/i.test(message)) {
  return res.status(500).json({
    message: 'Transfer creation RPC is not available in the live Supabase database.',
    error: message,
  });
}

      return res.status(500).json({ message: 'Delivery RPC failed.', error: message });
    }

    const resultRow = Array.isArray(data) ? data[0] : data;
    if (!resultRow) {
      return res.status(500).json({ message: 'Delivery RPC returned no result.' });
    }

   if (resultRow.success === false) {
  const statusCode = String(resultRow.message || '').includes('insufficient_stock') ? 400 : 404;

  return res.status(statusCode).json({
    message: resultRow.message || 'Transfer rejected.',
    success: false,
  });
}

return res.json({
  success: true,
  message: resultRow.message || 'Transfer created successfully.',
  tracking_code: resultRow.tracking_code,
  status: resultRow.status || 'IN_TRANSIT',
  quantity: resultRow.quantity ?? qty,
  source_branch_id: normalizedSourceId,
  destination_branch_id: normalizedDestinationId,
});

  } catch (error) {
    return res.status(500).json({
      message: 'Failed to process delivery.',
      error: error.message,
    });
  }
};



function isDeliveryPersonnel(user) {
  return String(user?.role || '').toLowerCase() === 'delivery_personnel';
}

function isAdminUser(user) {
  return ['admin', 'superadmin'].includes(String(user?.role || '').toLowerCase());
}

async function resolveBranchIdByName(branchName) {
  const normalizedName = String(branchName || '').trim();
  if (!normalizedName || !isSupabaseEnabled || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('branches')
    .select('id, branch_name')
    .ilike('branch_name', normalizedName)
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0]?.id || null;
}

exports.getSerializedDeliveryUnit = async (req, res) => {
  const unitBarcode = String(req.params?.unit_barcode || '').trim().toUpperCase();

  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  if (!unitBarcode || !isSerializedItemBarcode(unitBarcode)) {
    return res.status(400).json({ success: false, message: 'A valid serialized unit barcode is required.' });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
  }

  try {
    const { data: unit, error: unitError } = await supabase
      .from('serialized_units')
      .select('id, unit_barcode, product_uuid, branch_id, status, current_custodian_user_id')
      .eq('unit_barcode', unitBarcode)
      .maybeSingle();

    if (unitError) throw unitError;
    if (!unit) {
      return res.status(404).json({ success: false, message: 'Serialized unit not found.' });
    }

    const [{ data: product, error: productError }, { data: branch, error: branchError }] = await Promise.all([
      supabase
        .from('products')
        .select('uuid, product_name, barcode')
        .eq('uuid', unit.product_uuid)
        .maybeSingle(),
      supabase
        .from('branches')
        .select('id, branch_name')
        .eq('id', unit.branch_id)
        .maybeSingle(),
    ]);

    if (productError) throw productError;
    if (branchError) throw branchError;
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product for serialized unit not found.' });
    }
    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch for serialized unit not found.' });
    }

    return res.json({
      success: true,
      unit: {
        id: unit.id,
        unit_barcode: unit.unit_barcode,
        product_uuid: unit.product_uuid,
        product_name: product.product_name,
        product_barcode: product.barcode,
        branch_id: unit.branch_id,
        branch_name: branch.branch_name,
        status: unit.status,
        current_custodian_user_id: unit.current_custodian_user_id,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to look up serialized unit.',
      error: error.message,
    });
  }
};

exports.getDeliveryPersonnel = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  if (!isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Only admins can view delivery personnel.' });
  }

  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, username, full_name, email, role, is_active, delivery_storage_branch_id')
      .eq('role', 'delivery_personnel')
      .eq('is_active', true)
      .order('username', { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      users: (data || []).map(user => ({
        id: user.id,
        username: user.username,
        full_name: user.full_name || user.username,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        delivery_storage_branch_id: user.delivery_storage_branch_id,
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load delivery personnel.',
      error: error.message,
    });
  }
};

exports.createAssignedDelivery = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  if (!isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Only admins can create assigned deliveries.' });
  }

  const sourceBranchValue = req.body?.source_branch_id ?? req.body?.from_branch_id ?? req.body?.sourceBranchId ?? null;
  const destinationBranchValue = req.body?.destination_branch_id ?? req.body?.to_branch_id ?? req.body?.destinationBranchId ?? null;
  const assignedDeliveryPersonnelId = req.body?.assigned_delivery_personnel_id ?? req.body?.delivery_personnel_id ?? req.body?.assignee_id ?? null;
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
    }

    if (!destinationBranchValue) {
      return res.status(400).json({ success: false, message: 'Destination branch is required.' });
    }

    if (!assignedDeliveryPersonnelId) {
      return res.status(400).json({ success: false, message: 'Delivery personnel is required.' });
    }

    const destinationBranchId = normalizeUuid(String(destinationBranchValue));
    if (!destinationBranchId) {
      return res.status(400).json({ success: false, message: 'Destination branch ID is invalid.' });
    }

    const deliveryPersonnelId = Number(assignedDeliveryPersonnelId);
    if (!Number.isInteger(deliveryPersonnelId) || deliveryPersonnelId <= 0) {
      return res.status(400).json({ success: false, message: 'Assigned delivery personnel ID must be valid.' });
    }

    const { data: deliveryUser, error: deliveryUserError } = await supabase
      .from('users')
      .select('id, username, role, is_active')
      .eq('id', deliveryPersonnelId)
      .maybeSingle();

    if (deliveryUserError) {
      throw deliveryUserError;
    }

    if (!deliveryUser || String(deliveryUser.role || '').toLowerCase() !== 'delivery_personnel' || deliveryUser.is_active === false) {
      return res.status(400).json({ success: false, message: 'Selected user is not an active delivery personnel account.' });
    }

    const sourceBranchId = sourceBranchValue
      ? normalizeUuid(String(sourceBranchValue))
      : await resolveBranchIdByName('Pasong Buaya Main Source');

    if (!sourceBranchId) {
      return res.status(404).json({ success: false, message: 'Pasong Buaya Main Source branch was not found.' });
    }

    if (sourceBranchId === destinationBranchId) {
      return res.status(400).json({ success: false, message: 'Source and destination branches must be different.' });
    }

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one serialized item is required.' });
    }

    const normalizedItems = rawItems.map(item => {
      if (!item || typeof item !== 'object') {
        throw new Error('Each item must be an object.');
      }

      const productUuid = normalizeUuid(item.product_uuid ?? item.productId ?? item.product_id);
      const serializedUnitIds = Array.isArray(item.serialized_unit_ids)
        ? item.serialized_unit_ids.map(unitId => normalizeUuid(unitId)).filter(Boolean)
        : [];

      if (!productUuid || serializedUnitIds.length === 0) {
        throw new Error('Each item must include a valid product UUID and serialized unit IDs.');
      }

      return {
        product_uuid: productUuid,
        serialized_unit_ids: serializedUnitIds,
      };
    });

    const rpcPayload = {
      p_source_branch_id: sourceBranchId,
      p_destination_branch_id: destinationBranchId,
      p_items: normalizedItems,
      p_created_by: req.user?.username || 'admin',
      p_assigned_delivery_personnel_id: deliveryPersonnelId,
    };

    const { data, error } = await supabase.rpc('create_assigned_delivery_reservation', rpcPayload);

    let resultRow = Array.isArray(data) ? data[0] : data;

    if (error) {
      const message = error.message || 'Assigned delivery creation failed.';
      throw error;
    }

    return res.status(201).json({
      success: true,
      message: 'Assigned delivery created successfully.',
      transfer: {
        transfer_id: resultRow?.transfer_id,
        tracking_code: resultRow?.tracking_code,
        source_branch_id: sourceBranchId,
        destination_branch_id: destinationBranchId,
        status: resultRow?.status || 'PENDING_PICKUP',
        assigned_delivery_personnel_id: deliveryPersonnelId,
        items: resultRow?.items || normalizedItems,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create assigned delivery.',
      error: error.message,
    });
  }
};

exports.pickupSerializedTransferUnit = async (req, res) => {
  const unitBarcode = String(req.body?.unit_barcode || req.body?.barcode || '').trim().toUpperCase();

  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  if (!isDeliveryPersonnel(req.user)) {
    return res.status(403).json({ success: false, message: 'Only delivery personnel can pick up assigned delivery items.' });
  }

  if (!unitBarcode || !isSerializedItemBarcode(unitBarcode)) {
    return res.status(400).json({ success: false, message: 'A valid serialized item barcode is required.' });
  }

  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
  }

  try {
    const { data, error } = await supabase.rpc('pickup_serialized_transfer_unit', {
      p_unit_barcode: unitBarcode,
      p_delivery_personnel_id: req.user.id
    });

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.success === false) {
      return res.status(400).json({
        success: false,
        message: result?.message || 'Delivery pickup could not be completed.'
      });
    }

    const io = req.app.get('io');
    if (io) io.emit('inventoryUpdated', { barcode: unitBarcode, type: 'DELIVERY_PICKUP' });

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to pick up assigned delivery item.',
      error: error.message
    });
  }
};

exports.createMultiProductTransfer = async (req, res) => {
  const sourceBranchValue = req.body.from_branch_id ?? req.body.source_branch_id;
  const destinationBranchValue = req.body.to_branch_id ?? req.body.destination_branch_id;
  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  const createdBy = req.user?.username || 'system';

  if (isDeliveryPersonnel(req.user)) {
    return res.status(403).json({ message: 'Delivery personnel cannot create transfers.' });
  }

  const assignedDeliveryPersonnelId = req.body.assigned_delivery_personnel_id ?? req.body.delivery_personnel_id ?? null;

  if (!sourceBranchValue || !destinationBranchValue) {
    return res.status(400).json({ message: 'Source and destination branches are required.' });
  }

  const sourceBranchId = normalizeUuid(sourceBranchValue);
  const destinationBranchId = normalizeUuid(destinationBranchValue);

  if (!sourceBranchId || !destinationBranchId) {
    return res.status(400).json({ message: 'Branch IDs must be valid UUIDs.' });
  }

  if (sourceBranchId === destinationBranchId) {
    return res.status(400).json({ message: 'A branch cannot transfer stock to itself.' });
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return res.status(400).json({ message: 'Transfer items are required.' });
  }

  const seenProducts = new Set();
  const seenUnits = new Set();
  const normalizedItems = [];

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ message: 'Each transfer item must be an object.' });
    }

    const productUuid = normalizeUuid(item.product_uuid ?? item.productId ?? item.product_id);
    const serializedUnitIds = Array.isArray(item.serialized_unit_ids)
      ? item.serialized_unit_ids.map(unitId => normalizeUuid(unitId))
      : null;

    if (!productUuid) {
      return res.status(400).json({ message: 'Each item requires a valid product UUID.' });
    }

    if (!serializedUnitIds || serializedUnitIds.length === 0 || serializedUnitIds.some(unitId => !unitId)) {
      return res.status(400).json({ message: 'Each item requires serialized_unit_ids.' });
    }

    if (seenProducts.has(productUuid)) {
      return res.status(400).json({ message: 'Duplicate products are not allowed in a single transfer.' });
    }

    seenProducts.add(productUuid);

    for (const unitId of serializedUnitIds) {
      if (seenUnits.has(unitId)) {
        return res.status(400).json({ message: 'Duplicate serialized units are not allowed.' });
      }
      seenUnits.add(unitId);
    }

    normalizedItems.push({
      product_uuid: productUuid,
      serialized_unit_ids: serializedUnitIds
    });
  }

  try {
    const authCheck = await authorizeBranchAccess(req, sourceBranchId);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ message: authCheck.message });
    }

    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({ message: 'Supabase multi-product transfer path is not configured for this environment.' });
    }

    if (assignedDeliveryPersonnelId !== null && assignedDeliveryPersonnelId !== undefined && String(assignedDeliveryPersonnelId).trim() !== '') {
      const deliveryId = Number(assignedDeliveryPersonnelId);
      if (!Number.isInteger(deliveryId) || deliveryId <= 0) {
        return res.status(400).json({ message: 'Assigned delivery personnel ID must be valid.' });
      }

      const { data: deliveryUser, error: deliveryUserError } = await supabase
        .from('users')
        .select('id, username, role, is_active')
        .eq('id', deliveryId)
        .maybeSingle();
      if (deliveryUserError) throw deliveryUserError;
      if (!deliveryUser || String(deliveryUser.role || '').toLowerCase() !== 'delivery_personnel' || deliveryUser.is_active === false) {
        return res.status(400).json({ message: 'Selected user is not an active delivery personnel account.' });
      }
    }

    const rpcPayload = {
      p_source_branch_id: sourceBranchId,
      p_destination_branch_id: destinationBranchId,
      p_items: normalizedItems,
      p_created_by: req.user?.username || 'system',
      ...(assignedDeliveryPersonnelId !== null && assignedDeliveryPersonnelId !== undefined && String(assignedDeliveryPersonnelId).trim() !== ''
        ? { p_assigned_delivery_personnel_id: Number(assignedDeliveryPersonnelId) }
        : {}),
    };

    const { data, error } = await supabase.rpc('create_multi_product_transfer', rpcPayload);

    if (error) {
      const message = error.message || 'Multi-product transfer RPC failed.';

      if (/does not exist|function.*create_multi_product_transfer|schema cache/i.test(message)) {
        return res.status(500).json({
          success: false,
          message: 'Multi-product transfer RPC is not available in the live Supabase database.',
          error: message,
        });
      }

      // Map RPC error codes to HTTP status codes
      let statusCode = 500;
      let userMessage = 'Transfer failed.';

      if (/insufficient_aggregate_stock|insufficient_stock/i.test(message)) {
        statusCode = 400;
        userMessage = 'Insufficient aggregate stock available for this transfer.';
      } else if (/insufficient_serialized_units/i.test(message)) {
        statusCode = 400;
        userMessage = 'Insufficient serialized units available for this transfer.';
      } else if (/product_not_found|product.*inactive/i.test(message)) {
        statusCode = 404;
        userMessage = 'One or more products not found or inactive.';
      } else if (/source_branch_not_found/i.test(message)) {
        statusCode = 404;
        userMessage = 'Source branch not found.';
      } else if (/destination_branch_not_found/i.test(message)) {
        statusCode = 404;
        userMessage = 'Destination branch not found.';
      } else if (/duplicate_products/i.test(message)) {
        statusCode = 400;
        userMessage = 'Duplicate products are not allowed in a single transfer.';
      } else if (/duplicate_serialized_units/i.test(message)) {
        statusCode = 400;
        userMessage = 'Duplicate serialized units are not allowed.';
      } else if (/serialized_unit_not_found/i.test(message)) {
        statusCode = 404;
        userMessage = 'One or more serialized units were not found.';
      } else if (/serialized_unit_(product_mismatch|source_branch_mismatch|not_available|already_in_active_transfer)/i.test(message)) {
        statusCode = 400;
        userMessage = 'One or more serialized units failed transfer validation.';
      }

      return res.status(statusCode).json({
        success: false,
        message: userMessage,
        error: message
      });
    }

    const resultRow = Array.isArray(data) ? data[0] : data;
    if (!resultRow) {
      return res.status(500).json({ message: 'Multi-product transfer RPC returned no result.' });
    }

    // Return transfer data in consistent format for frontend
    return res.status(201).json({
      success: true,
      message: 'Multi-product transfer created successfully.',
      transfer: {
        transfer_id: resultRow.transfer_id,
        tracking_code: resultRow.tracking_code,
        source_branch_id: sourceBranchId,
        source_branch: resultRow.source_branch,
        destination_branch_id: destinationBranchId,
        destination_branch: resultRow.destination_branch,
        status: resultRow.status || 'IN_TRANSIT',
        items: resultRow.items || [],
        created_at: resultRow.created_at,
        created_by: resultRow.created_by
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to process multi-product transfer.',
      error: error.message,
    });
  }
};
