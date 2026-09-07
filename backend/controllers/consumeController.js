const pool = require('../config/database');
const { supabase, isSupabaseEnabled } = require('../config/supabase');

function isUnrestrictedRole(user) {
  return ['admin', 'superadmin'].includes(String(user?.role || '').toLowerCase());
}

function isSerializedItemBarcode(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.startsWith('ADD-') || trimmed.startsWith('TRF-')) {
    return false;
  }

  return /^[A-Za-z]{2}\d{8}\d{4}$/.test(trimmed);
}

async function handleSerializedItemConsumption(req, res) {
  const branchId = String(req.body?.branch_id || '').trim();
  const barcode = String(req.body?.unit_barcode || req.body?.barcode || '').trim();

  if (!branchId) {
    return res.status(400).json({ success: false, message: 'Branch ID is required.' });
  }

  if (!barcode || !isSerializedItemBarcode(barcode)) {
    return res.status(400).json({ success: false, message: 'Valid serialized item barcode is required.' });
  }

  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
    }

    const { data: unitRows, error: unitError } = await supabase
      .from('serialized_units')
      .select('id, product_uuid, branch_id, status, unit_barcode')
      .eq('unit_barcode', barcode)
      .limit(1);

    if (unitError) {
      throw unitError;
    }

    const unit = Array.isArray(unitRows) ? unitRows[0] : null;
    if (!unit) {
      return res.status(404).json({ success: false, message: 'Serialized item not found.' });
    }

    if (String(unit.status || '').toUpperCase() !== 'AVAILABLE') {
      return res.status(400).json({ success: false, message: 'Serialized item is not available for consumption.' });
    }

    if (String(unit.branch_id || '').trim() !== String(branchId).trim()) {
      return res.status(403).json({ success: false, message: 'Serialized item does not belong to this branch.' });
    }

    const { data: inventoryRows, error: inventoryError } = await supabase
      .from('inventory')
      .select('product_uuid, branch_id, quantity')
      .eq('product_uuid', unit.product_uuid)
      .eq('branch_id', branchId)
      .limit(1);

    if (inventoryError) {
      throw inventoryError;
    }

    const currentInventory = Number((Array.isArray(inventoryRows) ? inventoryRows[0]?.quantity : 0) || 0);
    if (currentInventory < 1) {
      return res.status(400).json({ success: false, message: 'Insufficient stock to consume this serialized item.' });
    }

    const { error: unitUpdateError } = await supabase
      .from('serialized_units')
      .update({ status: 'CONSUMED', updated_at: new Date().toISOString() })
      .eq('id', unit.id);

    if (unitUpdateError) {
      throw unitUpdateError;
    }

    const { error: inventoryUpdateError } = await supabase
      .from('inventory')
      .update({ quantity: currentInventory - 1, last_updated: new Date().toISOString() })
      .eq('product_uuid', unit.product_uuid)
      .eq('branch_id', branchId);

    if (inventoryUpdateError) {
      throw inventoryUpdateError;
    }

    const { error: stockError } = await supabase
      .from('stock_transactions')
      .insert({
        product_uuid: unit.product_uuid,
        branch_id: branchId,
        barcode: barcode,
        branch: req.body?.branch || 'Branch',
        type: 'CONSUME',
        quantity: 1,
        user_name: req.body?.user || req.user?.username || 'system',
        date: new Date().toISOString(),
      });

    if (stockError) {
      throw stockError;
    }

    return res.json({
      success: true,
      message: 'Serialized item consumed successfully.',
      unit_barcode: barcode,
      status: 'CONSUMED',
      branch_id: branchId,
      inventory_quantity: currentInventory - 1,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Serialized item consumption failed.', error: error.message });
  }
}

async function resolveBranchId(branchId, user) {
  if (!branchId || !isSupabaseEnabled || !supabase) {
    return branchId;
  }

  const { data: branches, error } = await supabase
    .from('branches')
    .select('id, branch_name')
    .eq('id', branchId)
    .limit(1);

  if (error) {
    throw error;
  }

  const branch = branches?.[0];
  if (!branch) {
    return null;
  }

  if (!isUnrestrictedRole(user)) {
    const assignedBranch = String(user?.branch || user?.assigned_branch || '').trim().toLowerCase();
    if (!assignedBranch || String(branch.branch_name || '').trim().toLowerCase() !== assignedBranch) {
      return null;
    }
  }

  return branch.id;
}

exports.consumeStock = async (req, res) => {
  const rawBarcode = String(req.body?.unit_barcode || req.body?.barcode || '').trim();
  if (isSerializedItemBarcode(rawBarcode)) {
    return handleSerializedItemConsumption(req, res);
  }

  const { barcode, quantity, branch, branch_id, user } = req.body;
  if (!barcode || !quantity || !branch_id) return res.status(400).json({ message: 'Missing request data' });

  try {
    const authorizedBranchId = await resolveBranchId(branch_id, req.user);
    if (!authorizedBranchId) {
      return res.status(403).json({ message: 'You are not authorized to consume from this branch' });
    }

    if (isSupabaseEnabled) {
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('uuid, barcode, category')
        .eq('barcode', barcode)
        .limit(1);

      if (productError) throw productError;
      const product = products?.[0];
      if (!product) return res.status(404).json({ message: 'Product not found' });
      if (String(product.category || '').trim().toLowerCase() !== 'vaccine') {
        return res.status(400).json({ message: 'Only vaccine products can be consumed here' });
      }

      const { data: inventoryRows, error: inventoryError } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('product_uuid', product.uuid)
        .eq('branch_id', authorizedBranchId)
        .limit(1);

      if (inventoryError) throw inventoryError;
      const availableQuantity = Number(inventoryRows?.[0]?.quantity || 0);
      if (availableQuantity < Number(quantity)) {
        return res.status(400).json({ message: 'Not enough stock available' });
      }

      const rpcRes = await supabase.rpc('consume_stock', {
        p_barcode: barcode,
        p_branch_id: authorizedBranchId,
        p_qty: Number(quantity),
        p_note: user || 'system',
      });

      if (rpcRes.error) return res.status(500).json({ message: 'Supabase RPC error', error: rpcRes.error.message });
      const rows = rpcRes.data;
      if (rows && rows.length && rows[0].success) {
        const io = req.app.get('io');
        if (io) io.emit('inventoryUpdated', { barcode, quantity, branch: branch || branch_id, type: 'CONSUME' });
        return res.json({ message: 'Stock consumed successfully (supabase)' });
      }
      return res.status(400).json({ message: 'Failed to consume stock', info: rows });
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
    if (!inventoryRows.length) return res.status(404).json({ message: 'Inventory record not found' });

    const inventoryRow = inventoryRows[0];
    const currentQty = inventoryRow.quantity;
    if (currentQty < quantity) return res.status(400).json({ message: 'Not enough stock available' });

    await pool.query('UPDATE inventory SET quantity = quantity - ?, last_updated = NOW(), branch_id = COALESCE(branch_id, ?) WHERE id = ?', [quantity, branchIdValue, inventoryRow.id]);

    await pool.query(
      'INSERT INTO stock_transactions (barcode, product_id, branch, branch_id, type, quantity, user, date) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [barcode, product.id, branchName, branchIdValue, 'CONSUME', quantity, user || 'system']
    );

    const io = req.app.get('io');
    if (io) io.emit('inventoryUpdated', { barcode, quantity, branch: branchName, type: 'CONSUME' });

    res.json({ message: 'Stock consumed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to consume stock', error: error.message });
  }
};
