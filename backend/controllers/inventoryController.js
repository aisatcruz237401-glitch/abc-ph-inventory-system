const pool = require('../config/database');
const { supabase, isSupabaseEnabled } = require('../config/supabase');

function normalizeBranchName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

exports.getInventory = async (req, res) => {
  try {
    const branchId =
      typeof req.query.branch_id === 'string'
        ? req.query.branch_id.trim()
        : '';

    const branchName =
      normalizeBranchName(req.query.branch);

    // =========================================================
    // NEW BEHAVIOR:
    // /api/inventory?branch_id=UUID
    //
    // Returns ALL active products and the selected branch's
    // current quantity. Missing inventory rows = quantity 0.
    // =========================================================
    if (branchId) {
      if (isSupabaseEnabled && supabase) {

        // 1. Get ALL active products
        const {
          data: products,
          error: productError
        } = await supabase
          .from('products')
          .select(`
            uuid,
            id,
            product_name,
            category,
            unit,
            barcode,
            description,
            is_active
          `)
          .eq('is_active', true)
          .order('product_name', {
            ascending: true
          });

        if (productError) {
          console.error(
            'Failed to fetch products:',
            productError
          );

          return res.status(500).json({
            message: 'Failed to fetch products',
            error: productError.message
          });
        }

        // 2. Get inventory ONLY for the selected branch
        const {
          data: inventoryRows,
          error: inventoryError
        } = await supabase
          .from('inventory')
          .select(`
            id,
            uuid,
            product_uuid,
            branch_id,
            branch,
            quantity,
            last_updated
          `)
          .eq('branch_id', branchId);

        if (inventoryError) {
          console.error(
            'Failed to fetch branch inventory:',
            inventoryError
          );

          return res.status(500).json({
            message: 'Failed to fetch branch inventory',
            error: inventoryError.message
          });
        }

        // 3. Create a lookup using product_uuid
        const inventoryMap = Object.fromEntries(
          (inventoryRows || []).map(row => [
            row.product_uuid,
            row
          ])
        );

        // 4. Combine ALL products with branch inventory
        const result = (products || []).map(product => {
          const inventory =
            inventoryMap[product.uuid] || null;

          return {
            id: inventory?.id || null,

            product_uuid:
              product.uuid,

            product_name:
              product.product_name || null,

            barcode:
              product.barcode || null,

            category:
              product.category || null,

            unit:
              product.unit || null,

            description:
              product.description || null,

            is_active:
              product.is_active,

            branch:
              inventory?.branch || null,

            branch_id:
              branchId,

            quantity:
              Number(inventory?.quantity || 0),

            last_updated:
              inventory?.last_updated || null
          };
        });

        return res.json(result);
      }

      return res.status(500).json({
        message:
          'Supabase is not configured for branch inventory.'
      });
    }

    // =========================================================
    // EXISTING BEHAVIOR:
    // Keep the old endpoint working for your Current Stock page.
    // =========================================================

    if (isSupabaseEnabled && supabase) {
      let inventoryQuery =
        supabase
          .from('inventory')
          .select('*');

      if (branchName) {
        inventoryQuery =
          inventoryQuery.eq(
            'branch',
            branchName
          );
      }

      inventoryQuery =
        inventoryQuery.order(
          'last_updated',
          {
            ascending: false
          }
        );

      const {
        data,
        error
      } = await inventoryQuery;

      if (!error && data) {
        const productUuids = [
          ...new Set(
            data
              .filter(
                row =>
                  row.product_uuid ||
                  row.product_id
              )
              .map(
                row =>
                  row.product_uuid ||
                  row.product_id
              )
          )
        ];

        let productMap = {};

        if (productUuids.length) {
          const {
            data: productRows,
            error: productError
          } = await supabase
            .from('products')
            .select('*');

          if (
            !productError &&
            productRows
          ) {
            productMap =
              Object.fromEntries(
                productRows.map(row => [
                  row.uuid || row.id,
                  row
                ])
              );
          }
        }

        return res.json(
          data.map(row => {
            const productKey =
              row.product_uuid ||
              row.product_id;

            const product =
              productMap[productKey] || {};

            return {
              id:
                row.id,

              product_uuid:
                row.product_uuid ||
                row.product_id,

              product_name:
                product.product_name ||
                row.product_name ||
                null,

              barcode:
                product.barcode ||
                row.barcode ||
                null,

              category:
                product.category ||
                row.category ||
                null,

              branch:
                row.branch ||
                row.branch_name ||
                null,

              branch_id:
                row.branch_id ||
                null,

              quantity:
                Number(row.quantity || 0),

              last_updated:
                row.last_updated ||
                null
            };
          })
        );
      }

      if (error) {
        if (
          ['PGRST205', '42703']
            .includes(error.code)
        ) {
          return res.json([]);
        }

        console.warn(
          'Supabase inventory fetch failed:',
          error.message
        );
      }
    }

    // MySQL fallback
    if (!pool) {
      return res.status(500).json({
        message:
          'Database is not configured for this environment'
      });
    }

    const branchFilter =
      branchName
        ? `WHERE i.branch = ?`
        : '';

    const params =
      branchName
        ? [branchName]
        : [];

    const [rows] =
      await pool.query(
        `
        SELECT
          i.id,
          p.product_name,
          p.barcode,
          p.category,
          i.branch AS branch,
          i.quantity,
          i.last_updated
        FROM inventory i
        JOIN products p
          ON p.id = i.product_id
        ${branchFilter}
        ORDER BY i.branch, p.product_name
        `,
        params
      );

    return res.json(rows);

  } catch (error) {
    console.error(
      'Get inventory error:',
      error
    );

    return res.status(500).json({
      message: 'Failed to fetch inventory',
      error: error.message
    });
  }
};
exports.getLowStock = async (req, res) => {
  try {
    const branchName = normalizeBranchName(
      req.query.branch
    );

    if (isSupabaseEnabled && supabase) {
      let lowStockQuery = supabase
        .from('inventory')
        .select('*')
        .lte('quantity', 10);

      if (branchName) {
        lowStockQuery =
          lowStockQuery.eq('branch', branchName);
      }

      lowStockQuery =
        lowStockQuery.order('branch', {
          ascending: true
        });

      const {
        data,
        error
      } = await lowStockQuery;

      if (!error && data) {
        const productUuids = [
          ...new Set(
            data
              .filter(row => row.product_uuid)
              .map(row => row.product_uuid)
          )
        ];

        let productMap = {};

        if (productUuids.length) {
          const {
            data: productRows,
            error: productError
          } = await supabase
            .from('products')
            .select('*')
            .in('uuid', productUuids);

          if (!productError && productRows) {
            productMap =
              Object.fromEntries(
                productRows.map(row => [
                  row.uuid,
                  row
                ])
              );
          }
        }

        return res.json(
          data.map(row => {
            const product =
              productMap[row.product_uuid] || {};

            return {
              id: row.id,
              product_uuid: row.product_uuid,
              product_name:
                product.product_name || null,
              barcode:
                product.barcode || null,
              branch:
                row.branch || null,
              branch_id:
                row.branch_id || null,
              quantity:
                Number(row.quantity || 0),
              minimum_stock:
                Number(row.quantity || 0)
            };
          })
        );
      }

      if (error) {
        if (
          ['PGRST205', '42703']
            .includes(error.code)
        ) {
          return res.json([]);
        }

        console.warn(
          'Supabase low stock fetch failed:',
          error.message
        );
      }
    }

    if (!pool) {
      return res.status(500).json({
        message:
          'Database is not configured for this environment'
      });
    }

    const branchFilter =
      branchName
        ? `AND i.branch = ?`
        : '';

    const params =
      branchName
        ? [branchName]
        : [];

    const [rows] =
      await pool.query(
        `
        SELECT
          i.id,
          p.product_name,
          p.barcode,
          i.branch AS branch,
          i.quantity,
          i.quantity AS minimum_stock
        FROM inventory i
        JOIN products p
          ON p.id = i.product_id
        WHERE i.quantity <= 10
        ${branchFilter}
        ORDER BY i.branch, p.product_name
        `,
        params
      );

    return res.json(rows);

  } catch (error) {
    console.error(
      'Get low stock error:',
      error
    );

    return res.status(500).json({
      message: 'Failed to fetch low stock',
      error: error.message
    });
  }
};