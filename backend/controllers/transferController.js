console.log("ACTIVE TRANSFER CONTROLLER - TEST 123");

const { supabase, isSupabaseEnabled } = require('../config/supabase');

exports.getTransferHistory = async (req, res) => {
  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({
        message: 'Supabase is not configured.'
      });
    }

    const { data: allData, error } = await supabase
      .from('stock_transactions')
      .select(`
        id,
        product_uuid,
        barcode,
        branch_id,
        branch,
        type,
        quantity,
        user_name,
        date,
        tracking_code,
        products (
          product_name,
          unit
        )
      `)
      .in('type', ['TRANSFER_OUT', 'TRANSFER_IN'])
      .order('date', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Failed to load transfer history:', error);

      return res.status(500).json({
        message: 'Failed to load transfer history.',
        error: error.message
      });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    const assignedBranch = String(req.user?.branch || req.user?.assigned_branch || '').trim().toLowerCase();
    const data = ['admin', 'superadmin'].includes(userRole)
      ? (allData || [])
      : (allData || []).filter(transaction =>
        assignedBranch && String(transaction.branch || '').trim().toLowerCase() === assignedBranch
      );

   const trackingCodes = [...new Set(
  data
    .map(transaction => transaction.tracking_code)
    .filter(Boolean)
)];

let statusMap = {};
let transferHeaders = [];
let deliveries = [];
let assignedDeliveryMap = {};

if (trackingCodes.length > 0) {
  const { data: headerRows, error: headerError } = await supabase
    .from('transfer_headers')
    .select('tracking_code, status, from_branch_id, to_branch_id, created_at, created_by, assigned_delivery_personnel_id')
    .in('tracking_code', trackingCodes);

  if (headerError) {
    console.error('Failed to load transfer header statuses:', headerError);
  } else {
    transferHeaders = headerRows || [];
    statusMap = Object.fromEntries(
      transferHeaders.map(header => [
        header.tracking_code,
        header.status
      ])
    );

    const assignedUserIds = [...new Set((transferHeaders || [])
      .map(header => header.assigned_delivery_personnel_id)
      .filter(Boolean))];

    if (assignedUserIds.length > 0) {
      const { data: assignedUsers, error: assignedUsersError } = await supabase
        .from('users')
        .select('id, username, full_name')
        .in('id', assignedUserIds);

      if (assignedUsersError) {
        console.error('Failed to load assigned delivery personnel:', assignedUsersError);
      } else {
        assignedDeliveryMap = Object.fromEntries((assignedUsers || []).map(user => [
          String(user.id),
          {
            id: user.id,
            username: user.username,
            full_name: user.full_name || user.username,
          }
        ]));
      }
    }
  }

  const { data: legacyRows, error: deliveryError } = await supabase
    .from('delivery_transactions')
    .select('tracking_code, status, from_branch_id, to_branch_id, created_at, created_by')
    .in('tracking_code', trackingCodes);

  if (deliveryError) {
    console.error('Failed to load legacy transfer statuses:', deliveryError);
  } else {
    deliveries = legacyRows || [];

    for (const delivery of deliveries) {
      if (!statusMap[delivery.tracking_code]) {
        statusMap[delivery.tracking_code] = delivery.status;
      }
    }
  }
}

const sourceRecords = [...transferHeaders, ...deliveries];
const branchIds = [...new Set(
  sourceRecords
    .flatMap(record => [record.from_branch_id, record.to_branch_id])
    .filter(Boolean)
)];
let branchMap = {};
if (branchIds.length > 0) {
  const { data: branches, error: branchError } = await supabase
    .from('branches')
    .select('id, branch_name')
    .in('id', branchIds);
  if (!branchError) {
    branchMap = Object.fromEntries((branches || []).map(branch => [branch.id, branch.branch_name]));
  }
}

const transferHeaderMap = Object.fromEntries((transferHeaders || []).map(header => [header.tracking_code, header]));
const deliveryMap = Object.fromEntries((deliveries || []).map(delivery => [delivery.tracking_code, delivery]));
const historyWithStatus = (data || []).map(transaction => {
  const trackingCode = transaction.tracking_code;
  const sourceRecord = transferHeaderMap[trackingCode] || deliveryMap[trackingCode];
  const assignedPersonnelId = sourceRecord?.assigned_delivery_personnel_id;
  const assignedPersonnel = assignedPersonnelId ? assignedDeliveryMap[String(assignedPersonnelId)] : null;

  return {
    ...transaction,
    status: trackingCode
      ? statusMap[trackingCode] || 'UNKNOWN'
      : null,
    source_branch: sourceRecord
      ? branchMap[sourceRecord.from_branch_id] || null
      : null,
    destination_branch: sourceRecord
      ? branchMap[sourceRecord.to_branch_id] || null
      : null,
    assigned_delivery_personnel_id: assignedPersonnelId || null,
    assigned_delivery_personnel_name: assignedPersonnel ? (assignedPersonnel.full_name || assignedPersonnel.username) : null,
    assigned_delivery_personnel_username: assignedPersonnel?.username || null,
    delivery_created_at: sourceRecord?.created_at || null,
    delivery_created_by: sourceRecord?.created_by || null
  };
});

return res.json(historyWithStatus);

  } catch (error) {
    console.error('Transfer history error:', error);

    return res.status(500).json({
      message: 'Failed to load transfer history.',
      error: error.message
    });
  }
};

exports.getTransferByTrackingCode = async (req, res) => {
  const trackingCode = String(req.params.tracking_code || '').trim();

  if (!trackingCode) {
    return res.status(400).json({
      success: false,
      message: 'Tracking code is required.'
    });
  }

  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({
        success: false,
        message: 'Supabase is not configured.'
      });
    }

    const { data: header, error: headerError } = await supabase
      .from('transfer_headers')
      .select('*')
      .eq('tracking_code', trackingCode)
      .maybeSingle();

    if (headerError) {
      console.error('Failed to lookup multi-product transfer:', headerError);

      return res.status(500).json({
        success: false,
        message: 'Failed to lookup transfer.',
        error: headerError.message
      });
    }

    if (header) {
      const { data: items, error: itemsError } = await supabase
        .from('transfer_items')
        .select('*')
        .eq('transfer_id', header.id)
        .order('item_order', { ascending: true });

      if (itemsError) {
        console.error('Failed to lookup transfer items:', itemsError);

        return res.status(500).json({
          success: false,
          message: 'Failed to lookup transfer items.',
          error: itemsError.message
        });
      }

      let expectedSerializedUnits = [];
      const itemIds = (items || []).map(item => item.id).filter(Boolean);

      if (itemIds.length > 0) {
        const { data: links, error: linkError } = await supabase
          .from('transfer_item_units')
          .select('transfer_item_id, serialized_unit_id, unit_order, is_active')
          .in('transfer_item_id', itemIds);

        if (linkError) {
          if (!/does not exist|relation .*transfer_item_units.* does not exist/i.test(String(linkError.message || ''))) {
            console.error('Failed to lookup serialized unit links:', linkError);
          }
        } else if (Array.isArray(links) && links.length > 0) {
          const unitIds = [...new Set((links || []).map(link => link.serialized_unit_id).filter(Boolean))];
          const { data: unitRows, error: unitError } = await supabase
            .from('serialized_units')
            .select('id, unit_barcode, product_uuid, branch_id, status, sequence_number')
            .in('id', unitIds);

          if (unitError) {
            console.error('Failed to lookup serialized units:', unitError);
          } else {
            const unitMap = Object.fromEntries((unitRows || []).map(unit => [unit.id, unit]));
            expectedSerializedUnits = (links || [])
              .map(link => {
                const unit = unitMap[link.serialized_unit_id];
                return unit
                  ? {
                      transfer_item_id: link.transfer_item_id,
                      serialized_unit_id: link.serialized_unit_id,
                      unit_barcode: unit.unit_barcode,
                      status: unit.status,
                      product_uuid: unit.product_uuid,
                      branch_id: unit.branch_id,
                      unit_order: link.unit_order,
                      is_active: link.is_active,
                    }
                  : null;
              })
              .filter(Boolean)
              .sort((a, b) => Number(a.unit_order || 0) - Number(b.unit_order || 0));
          }
        }
      }

      const productUuids = [...new Set((items || []).map(item => item.product_uuid).filter(Boolean))];
      let products = [];

      if (productUuids.length > 0) {
        const { data: productRows, error: productsError } = await supabase
          .from('products')
          .select('uuid, product_name, unit, barcode')
          .in('uuid', productUuids);

        if (productsError) {
          console.error('Failed to lookup transfer products:', productsError);

          return res.status(500).json({
            success: false,
            message: 'Failed to lookup transfer products.',
            error: productsError.message
          });
        }

        products = productRows || [];
      }

      const productMap = Object.fromEntries(products.map(product => [product.uuid, product]));
      const transferItems = (items || []).map(item => ({
        ...item,
        product_name: productMap[item.product_uuid]?.product_name || null,
        unit: productMap[item.product_uuid]?.unit || null,
      }));

      return res.json({
        success: true,
        transfer: {
          ...header,
          items: transferItems,
          expected_serialized_units: expectedSerializedUnits,
          expected_serialized_unit_ids: expectedSerializedUnits.map(unit => unit.serialized_unit_id).filter(Boolean),
          expected_unit_barcodes: expectedSerializedUnits.map(unit => unit.unit_barcode).filter(Boolean),
          quantity: transferItems.reduce((total, item) => total + Number(item.quantity || 0), 0),
          barcode: transferItems[0]?.barcode || null,
        }
      });
    }

    const { data: deliveryRows, error } = await supabase
      .from('delivery_transactions')
      .select('*')
      .eq('tracking_code', trackingCode)
      .order('id', { ascending: true });

    if (error) {
      console.error('Failed to lookup transfer:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to lookup transfer.',
        error: error.message
      });
    }

    if (!deliveryRows || deliveryRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found.',
        tracking_code: trackingCode
      });
    }

    if (deliveryRows.length === 1) {
      return res.json({
        success: true,
        transfer: deliveryRows[0]
      });
    }

    const productUuids = [...new Set(deliveryRows.map(row => row.product_uuid).filter(Boolean))];
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('uuid, product_name, unit, barcode')
      .in('uuid', productUuids);

    if (productsError) {
      throw productsError;
    }

    const productMap = Object.fromEntries((products || []).map(product => [product.uuid, product]));
    const items = deliveryRows.map(row => ({
      ...row,
      product_name: productMap[row.product_uuid]?.product_name || null,
      unit: productMap[row.product_uuid]?.unit || null,
    }));

    return res.json({
      success: true,
      transfer: {
        ...deliveryRows[0],
        status: deliveryRows.every(row => row.status === 'RECEIVED') ? 'RECEIVED' : 'IN_TRANSIT',
        items,
        quantity: items.reduce((total, item) => total + Number(item.quantity || 0), 0),
      }
    });

  } catch (error) {
    console.error('Transfer lookup error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to lookup transfer.',
      error: error.message
    });
  }
};