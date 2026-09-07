const pool = require('../config/database');
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

function normalizeUnitCandidates(rawValue) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : rawValue == null
      ? []
      : [rawValue];

  return values
    .flatMap(value => String(value ?? '').split(','))
    .map(value => String(value ?? '').replace(/[\x00-\x1F\x7F]/g, '').trim())
    .filter(Boolean)
    .map(value => value.toUpperCase());
}

async function validateExactTransferItems(req, trackingCode, scannedValues) {
  const normalizedScans = normalizeUnitCandidates(scannedValues);
  if (!normalizedScans.length) {
    return { ok: true };
  }

  if (!req?.user) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }

  if (!isSupabaseEnabled || !supabase) {
    return { ok: false, status: 500, message: 'Supabase is not configured.' };
  }

  const { data: transfer, error: transferError } = await supabase
    .from('transfer_headers')
    .select('id, tracking_code, source_branch_id, destination_branch_id, status')
    .eq('tracking_code', String(trackingCode || '').trim())
    .maybeSingle();

  if (transferError) {
    throw transferError;
  }

  if (!transfer) {
    return { ok: false, status: 404, message: 'Transfer not found.' };
  }

  if (String(transfer.status || '').toUpperCase() !== 'IN_TRANSIT') {
    return { ok: false, status: 400, message: 'Transfer is not in transit.' };
  }

  if (!isUnrestrictedUserRole(req.user)) {
    const userBranchId = await resolveUserBranchUuid(req.user);
    if (!userBranchId) {
      return { ok: false, status: 403, message: 'User branch assignment is missing or invalid.' };
    }

    if (String(transfer.destination_branch_id || '').trim() !== String(userBranchId).trim()) {
      return { ok: false, status: 403, message: 'WRONG BRANCH' };
    }
  }

  const { data: itemRows, error: itemError } = await supabase
    .from('transfer_items')
    .select('id, product_uuid, barcode, quantity, item_order')
    .eq('transfer_id', transfer.id)
    .order('item_order', { ascending: true });

  if (itemError) {
    throw itemError;
  }

  const itemIds = (itemRows || []).map(row => row.id).filter(Boolean);
  if (itemIds.length === 0) {
    return { ok: false, status: 400, message: 'Transfer has no expected items to receive.' };
  }

  const { data: links, error: linksError } = await supabase
    .from('transfer_item_units')
    .select('transfer_item_id, serialized_unit_id, unit_order')
    .in('transfer_item_id', itemIds);

  if (linksError) {
    if (/does not exist|relation .*transfer_item_units.* does not exist/i.test(String(linksError.message || ''))) {
      return { ok: false, status: 500, message: 'Exact serialized transfer contract is not installed in the live Supabase database.' };
    }
    throw linksError;
  }

  const unitIds = [...new Set((links || []).map(link => link.serialized_unit_id).filter(Boolean))];
  if (unitIds.length === 0) {
    return { ok: false, status: 400, message: 'This transfer has no serialized unit links to verify.' };
  }

  const { data: units, error: unitError } = await supabase
    .from('serialized_units')
    .select('id, unit_barcode, product_uuid, status, branch_id')
    .in('id', unitIds);

  if (unitError) {
    throw unitError;
  }

  const unitMap = Object.fromEntries((units || []).map(unit => [unit.id, unit]));
  const expectedBarcodes = (links || [])
    .map(link => unitMap[link.serialized_unit_id]?.unit_barcode)
    .filter(Boolean)
    .sort();

  const expectedSet = new Set(expectedBarcodes);
  const duplicateMatches = normalizedScans.filter((value, index) => normalizedScans.indexOf(value) !== index);
  if (duplicateMatches.length) {
    return { ok: false, status: 400, message: 'DUPLICATE', duplicate_items: [...new Set(duplicateMatches)] };
  }

  const wrongItems = normalizedScans.filter(value => !expectedSet.has(value));
  if (wrongItems.length) {
    return { ok: false, status: 400, message: 'WRONG ITEM', wrong_items: [...new Set(wrongItems)] };
  }

  const missingItems = expectedBarcodes.filter(value => !normalizedScans.includes(value));
  if (missingItems.length) {
    return { ok: false, status: 400, message: 'Missing expected items.', missing_items: missingItems };
  }

  return { ok: true, expected_items: expectedBarcodes, scanned_items: normalizedScans, transfer_id: transfer.id };
}

console.log('>>> RECEIVE CONTROLLER LOADED <<<');

async function handleSerializedTransferReceive(req, res) {
  const unitBarcode = String(req.body?.unit_barcode || req.body?.barcode || '').trim();
  const trackingCode = String(req.body?.tracking_code || req.body?.trf_code || '').trim();
  const destinationBranchId = String(req.body?.branch_id || req.body?.destination_branch_id || '').trim();
  const receivingUser = String(req.body?.user || req.user?.username || 'system').trim() || 'system';

  if (!unitBarcode || !isSerializedItemBarcode(unitBarcode)) {
    return res.status(400).json({ success: false, message: 'Valid serialized item barcode is required.' });
  }

  if (!destinationBranchId) {
    return res.status(400).json({ success: false, message: 'Destination branch ID is required.' });
  }

  if (!trackingCode) {
    return res.status(400).json({ success: false, message: 'Transfer tracking code is required for serialized item receive.' });
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
      return res.status(404).json({ success: false, message: 'Transfer not found for this serialized item.' });
    }

    if (String(transfer.status || '').toUpperCase() !== 'IN_TRANSIT') {
      return res.status(400).json({ success: false, message: 'Transfer is not in transit.' });
    }

    if (String(transfer.destination_branch_id || '').trim() !== String(destinationBranchId).trim()) {
      return res.status(403).json({ success: false, message: 'The serialized item does not belong to the destination branch.' });
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

    if (String(unit.status || '').toUpperCase() !== 'IN_TRANSIT') {
      return res.status(400).json({ success: false, message: 'Serialized item is not in transit and cannot be received.' });
    }

    if (String(unit.branch_id || '').trim() !== String(transfer.source_branch_id || '').trim()) {
      return res.status(403).json({ success: false, message: 'Serialized item is not currently assigned to the source branch.' });
    }

    const { data: transferRelationRows, error: transferRelationError } = await supabase
      .from('transfer_item_units')
      .select('serialized_unit_id')
      .eq('serialized_unit_id', unit.id)
      .limit(1);

    if (transferRelationError && String(transferRelationError.message || '').toLowerCase().includes('does not exist')) {
      // The transfer history table may not exist in older live schemas. The runtime guard still
      // verifies the serialized item, transfer, and branch state before the receive update.
    } else if (transferRelationError) {
      throw transferRelationError;
    } else if (Array.isArray(transferRelationRows) && transferRelationRows.length === 0) {
      return res.status(400).json({ success: false, message: 'Serialized item is not linked to the active transfer.' });
    }

    const { data: inventoryRows, error: inventoryError } = await supabase
      .from('inventory')
      .select('product_uuid, branch_id, quantity')
      .eq('product_uuid', unit.product_uuid)
      .eq('branch_id', destinationBranchId)
      .limit(1);

    if (inventoryError) {
      throw inventoryError;
    }

    const currentInventory = Number((Array.isArray(inventoryRows) ? inventoryRows[0]?.quantity : 0) || 0);

    const { error: updateError } = await supabase
      .from('serialized_units')
      .update({
        branch_id: destinationBranchId,
        status: 'AVAILABLE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', unit.id);

    if (updateError) {
      throw updateError;
    }

    const nextInventory = currentInventory + 1;
    if (Array.isArray(inventoryRows) && inventoryRows.length > 0) {
      const { error: inventoryUpdateError } = await supabase
        .from('inventory')
        .update({ quantity: nextInventory, last_updated: new Date().toISOString() })
        .eq('product_uuid', unit.product_uuid)
        .eq('branch_id', destinationBranchId);

      if (inventoryUpdateError) {
        throw inventoryUpdateError;
      }
    } else {
      const { error: inventoryInsertError } = await supabase
        .from('inventory')
        .insert({
          product_uuid: unit.product_uuid,
          branch_id: destinationBranchId,
          branch: 'Branch Destination',
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
        product_uuid: unit.product_uuid,
        branch_id: destinationBranchId,
        barcode: unitBarcode,
        branch: 'Destination Branch',
        type: 'TRANSFER_IN',
        quantity: 1,
        user_name: receivingUser,
        date: new Date().toISOString(),
        tracking_code: trackingCode,
      });

    if (stockError) {
      throw stockError;
    }

    return res.json({
      success: true,
      message: 'Serialized item received successfully.',
      unit_barcode: unitBarcode,
      status: 'AVAILABLE',
      branch_id: destinationBranchId,
      tracking_code: trackingCode,
      inventory_quantity: nextInventory,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Serialized item receive failed.', error: error.message });
  }
}



function isDeliveryPersonnel(user) {
  return String(user?.role || '').toLowerCase() === 'delivery_personnel';
}

exports.receiveSerializedDeliveryUnit = async (req, res) => {
  const unitBarcode = String(req.body?.unit_barcode || req.body?.barcode || '').trim().toUpperCase();

  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (isDeliveryPersonnel(req.user)) {
    return res.status(403).json({ success: false, message: 'Delivery personnel cannot receive delivery items into a destination branch.' });
  }
  if (!unitBarcode || !isSerializedItemBarcode(unitBarcode)) {
    return res.status(400).json({ success: false, message: 'A valid serialized item barcode is required.' });
  }
  if (!isSupabaseEnabled || !supabase) {
    return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
  }

  try {
    const { data, error } = await supabase.rpc('receive_serialized_delivery_unit', {
      p_unit_barcode: unitBarcode,
      p_receiving_user_id: req.user.id
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.success === false) {
      return res.status(400).json({ success: false, message: result?.message || 'Delivery item could not be received.' });
    }

    const io = req.app.get('io');
    if (io) io.emit('inventoryUpdated', { barcode: unitBarcode, type: 'DELIVERY_RECEIVE' });

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to receive delivery item.', error: error.message });
  }
};

exports.receiveStock = async (req, res) => {
  const { barcode, quantity, branch, branch_id, user } = req.body;
  if (!barcode || !quantity || !branch_id) return res.status(400).json({ message: 'Missing request data' });

  try {
    const authCheck = await authorizeBranchAccess(req, branch_id);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ message: authCheck.message });
    }

    if (isSupabaseEnabled) {
      const rpcRes = await supabase.rpc('receive_stock', {
        p_barcode: barcode,
        p_branch_id: branch_id,
        p_qty: Number(quantity),
        p_note: user || 'system',
      });

      if (rpcRes.error) return res.status(500).json({ message: 'Supabase RPC error', error: rpcRes.error.message });
      const rows = rpcRes.data;
      if (rows && rows.length && rows[0].success) {
        const io = req.app.get('io');
        if (io) io.emit('inventoryUpdated', { barcode, quantity, branch: branch || branch_id, type: 'RECEIVE' });
        return res.json({ message: 'Stock received successfully (supabase)' });
      }
      return res.status(400).json({ message: 'Failed to receive stock', info: rows });
    }

    let branchName = branch;
    let branchIdValue = null;

    if (branch_id) {
      const [branchRows] = await pool.query('SELECT id, branch_name FROM branches WHERE id = ?', [branch_id]);
      if (!branchRows.length) return res.status(400).json({ message: 'Branch not found' });
      branchName = branchRows[0].branch_name;
      branchIdValue = branchRows[0].id;
    }

    const [productRows] = await pool.query('SELECT * FROM products WHERE barcode = ?', [barcode]);
    if (!productRows.length) return res.status(404).json({ message: 'Product not found' });

    const product = productRows[0];
    const [inventoryRows] = await pool.query(
      branchIdValue
        ? 'SELECT * FROM inventory WHERE product_id = ? AND branch_id = ?'
        : 'SELECT * FROM inventory WHERE product_id = ? AND branch = ?',
      [product.id, branchIdValue || branchName]
    );

    if (inventoryRows.length) {
      await pool.query(
        'UPDATE inventory SET quantity = quantity + ?, last_updated = NOW(), branch_id = COALESCE(branch_id, ?) WHERE id = ?',
        [quantity, branchIdValue, inventoryRows[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO inventory (product_id, branch, branch_id, quantity, last_updated) VALUES (?, ?, ?, ?, NOW())',
        [product.id, branchName, branchIdValue, quantity]
      );
    }

    await pool.query(
      'INSERT INTO stock_transactions (barcode, product_id, branch, branch_id, type, quantity, user, date) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [barcode, product.id, branchName, branchIdValue, 'RECEIVE', quantity, user || 'system']
    );

    const io = req.app.get('io');
    if (io) io.emit('inventoryUpdated', { barcode, quantity, branch: branchName, type: 'RECEIVE' });

    res.json({ message: 'Stock received successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to receive stock', error: error.message });
  }
};

exports.receiveTransfer = async (req, res) => {  const serializedBarcode = String(req.body?.unit_barcode || req.body?.barcode || '').trim();
  if (isSerializedItemBarcode(serializedBarcode)) {
    return handleSerializedTransferReceive(req, res);
  }
  console.log('>>> ACTIVE receiveTransfer CONTROLLER <<<');

  const { tracking_code, user } = req.body;
  const scannedValues = req.body?.scanned_serialized_unit_ids || req.body?.scanned_serialized_unit_barcodes || req.body?.serialized_unit_ids || req.body?.unit_barcodes || [];

  if (!tracking_code) {
    return res.status(400).json({
      message: 'Tracking code is required.'
    });
  }

  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({
        message: 'Supabase is not enabled.'
      });
    }

    if (normalizeUnitCandidates(scannedValues).length > 0) {
      const validation = await validateExactTransferItems(req, tracking_code, scannedValues);
      if (!validation.ok) {
        return res.status(validation.status || 400).json({
          success: false,
          message: validation.message || 'Transfer verification failed.',
          wrong_items: validation.wrong_items || [],
          duplicate_items: validation.duplicate_items || [],
          missing_items: validation.missing_items || [],
          expected_items: validation.expected_items || []
        });
      }
    }

    const { data: multiProductTransfer, error: multiProductLookupError } = await supabase
      .from('transfer_headers')
      .select('id, tracking_code, destination_branch_id')
      .eq('tracking_code', tracking_code.trim())
      .maybeSingle();

    if (multiProductLookupError) {
      throw multiProductLookupError;
    }

    if (multiProductTransfer) {
      if (!isUnrestrictedUserRole(req.user)) {
        const userBranchId = await resolveUserBranchUuid(req.user);
        if (!userBranchId) {
          return res.status(403).json({ message: 'User branch assignment is missing or invalid.' });
        }

        if (!multiProductTransfer.destination_branch_id || String(multiProductTransfer.destination_branch_id).trim() !== String(userBranchId).trim()) {
          return res.status(403).json({ message: 'You are not authorized to receive this transfer.' });
        }
      }

      const { data, error } = await supabase.rpc('receive_multi_product_transfer', {
        p_tracking_code: tracking_code.trim(),
        p_received_by: req.user.username || 'system'
      });

      console.log('>>> RECEIVE TRANSFER RPC DATA <<<', data);
      console.log('>>> RECEIVE TRANSFER RPC ERROR <<<', error);

      if (error) {
        return res.status(500).json({
          message: 'Receive transfer RPC failed.',
          error: error.message
        });
      }

      const resultRow = Array.isArray(data) ? data[0] : data;

      if (!resultRow) {
        return res.status(500).json({
          message: 'Receive transfer RPC returned no result.'
        });
      }

      if (resultRow.success === false) {
        return res.status(400).json({
          message: resultRow.message || 'Transfer could not be received.',
          success: false
        });
      }

      const io = req.app.get('io');

      if (io) {
        io.emit('inventoryUpdated', {
          tracking_code: resultRow.tracking_code,
          quantity: resultRow.quantity,
          type: 'TRANSFER_IN'
        });
      }

      return res.json({
        success: true,
        message: resultRow.message || 'Transfer received successfully.',
        tracking_code: resultRow.tracking_code,
        status: resultRow.status,
        quantity: resultRow.quantity,
        source_branch_id: resultRow.source_branch_id,
        destination_branch_id: resultRow.destination_branch_id,
        received_by: resultRow.received_by
      });
    }

    const { data: deliveryRows, error: deliveryLookupError } = await supabase
      .from('delivery_transactions')
      .select('id, tracking_code, to_branch_id, status')
      .eq('tracking_code', tracking_code.trim())
      .order('id', { ascending: true });

    if (deliveryLookupError) {
      throw deliveryLookupError;
    }

    const isMultiProductDelivery = (deliveryRows?.length || 0) > 1;

    if (!isUnrestrictedUserRole(req.user)) {
      const userBranchId = await resolveUserBranchUuid(req.user);
      if (!userBranchId) {
        return res.status(403).json({ message: 'User branch assignment is missing or invalid.' });
      }

      const destinationBranch = deliveryRows?.[0]?.to_branch_id;

      if (!destinationBranch || String(destinationBranch).trim() !== String(userBranchId).trim()) {
        return res.status(403).json({ message: 'You are not authorized to receive this transfer.' });
      }
    }

    const { data, error } = await supabase.rpc(
      isMultiProductDelivery
        ? 'receive_multi_product_delivery_transfer'
        : 'receive_transfer',
      {
        p_tracking_code: tracking_code.trim(),
        p_received_by: isMultiProductDelivery
          ? (req.user.username || 'system')
          : (user || 'system')
      }
    );

    console.log('>>> RECEIVE TRANSFER RPC DATA <<<', data);
console.log('>>> RECEIVE TRANSFER RPC ERROR <<<', error);

    if (error) {
      return res.status(500).json({
        message: 'Receive transfer RPC failed.',
        error: error.message
      });
    }

    const resultRow = Array.isArray(data) ? data[0] : data;

    if (!resultRow) {
      return res.status(500).json({
        message: 'Receive transfer RPC returned no result.'
      });
    }

    if (resultRow.success === false) {
      return res.status(400).json({
        message: resultRow.message || 'Transfer could not be received.',
        success: false
      });
    }

    const io = req.app.get('io');

    if (io) {
      io.emit('inventoryUpdated', {
        tracking_code: resultRow.tracking_code,
        quantity: resultRow.quantity,
        type: 'TRANSFER_IN'
      });
    }

    return res.json({
      success: true,
      message: resultRow.message || 'Transfer received successfully.',
      tracking_code: resultRow.tracking_code,
      status: resultRow.status,
      quantity: resultRow.quantity,
      source_branch_id: resultRow.source_branch_id,
      destination_branch_id: resultRow.destination_branch_id,
      received_by: resultRow.received_by
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Failed to receive transfer.',
      error: error.message
    });
  }
};