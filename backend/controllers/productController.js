const pool = require('../config/database');
const { supabase, isSupabaseEnabled } = require('../config/supabase');

function isUnrestrictedProductRole(user) {
  return ['admin', 'superadmin'].includes(String(user?.role || '').toLowerCase());
}

function getAuthorizedBranch(user) {
  return String(user?.branch || user?.assigned_branch || '').trim();
}

async function resolveAuthorizedBranchId(user) {
  const branchName = getAuthorizedBranch(user);
  if (!branchName || !isSupabaseEnabled || !supabase) {
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

function filterInventoryForUser(inventoryRows, user, authorizedBranchId) {
  if (isUnrestrictedProductRole(user)) {
    return inventoryRows;
  }

  if (!authorizedBranchId) {
    return [];
  }

  return inventoryRows.filter((row) => String(row.branch_id || '') === String(authorizedBranchId));
}

exports.getProducts = async (req, res) => {
  if (!isUnrestrictedProductRole(req.user) && !getAuthorizedBranch(req.user)) {
    return res.status(403).json({ message: 'A branch assignment is required' });
  }

  try {
    if (isSupabaseEnabled && supabase) {
      console.log('PRODUCT API PATH: SUPABASE');
      console.log('PRODUCT API USER:', {
        role: req.user?.role || null,
        branch: req.user?.branch || req.user?.assigned_branch || null,
      });
      console.log('PRODUCT DEBUG: Supabase enabled =', isSupabaseEnabled);
      const { data: productRows, error: productError } = await supabase
        .from('products')
        .select('*')
        .order('product_name', { ascending: true });

      console.log('PRODUCT DEBUG: productError =', productError);
console.log('PRODUCT DEBUG: productRows count =', productRows?.length);
        if (!productError && productRows) {
        const productUuids = productRows
          .map((row) => row.uuid || row.id)
          .filter(Boolean);
        const { data: inventoryRows, error: inventoryError } = productUuids.length
          ? await supabase.from('inventory').select('*')
          : { data: [], error: null };

        console.log('PRODUCT DEBUG: inventoryError =', inventoryError);
        console.log('PRODUCT DEBUG: inventoryRows count =', inventoryRows?.length);
          if (!inventoryError) {
          console.log('PRODUCT DEBUG: inventoryError =', inventoryError);
console.log('PRODUCT DEBUG: inventoryRows count =', inventoryRows?.length);
          const authorizedBranchId = await resolveAuthorizedBranchId(req.user);
          const authorizedInventoryRows = filterInventoryForUser(inventoryRows || [], req.user, authorizedBranchId);
          const knownInventoryRowBeforeFilter = (inventoryRows || []).find(row => row.barcode === 'ABC000009' || row.product_uuid === '4fdda29b-6bba-47b7-a6cf-77f0c91b35a2');
          const knownInventoryRowAfterFilter = authorizedInventoryRows.find(row => row.barcode === 'ABC000009' || row.product_uuid === '4fdda29b-6bba-47b7-a6cf-77f0c91b35a2');
          console.log('PRODUCT API BRANCH DIAGNOSTICS:', {
            resolvedAuthorizedBranchId: authorizedBranchId,
            inventoryRowsBeforeFilter: inventoryRows?.length || 0,
            authorizedInventoryRowsAfterFilter: authorizedInventoryRows.length,
            knownProductBeforeFilter: knownInventoryRowBeforeFilter ? {
              branch_id: knownInventoryRowBeforeFilter.branch_id,
              branch: knownInventoryRowBeforeFilter.branch,
              quantity: knownInventoryRowBeforeFilter.quantity,
            } : null,
            knownProductAfterFilter: knownInventoryRowAfterFilter ? {
              branch_id: knownInventoryRowAfterFilter.branch_id,
              branch: knownInventoryRowAfterFilter.branch,
              quantity: knownInventoryRowAfterFilter.quantity,
            } : null,
          });
          const inventoryByProduct = authorizedInventoryRows.reduce((acc, row) => {
            const productKey = row.product_uuid || row.product_id;
            if (!productKey) return acc;
            acc[productKey] = (acc[productKey] || 0) + Number(row.quantity || 0);
            return acc;
          }, {});
          console.log('PRODUCT API KNOWN PRODUCT AGGREGATION:', {
            productRecordFound: productRows.some(row => row.barcode === 'ABC000009'),
            aggregatedQuantity: inventoryByProduct['4fdda29b-6bba-47b7-a6cf-77f0c91b35a2'] || 0,
          });

          const visibleProductRows = isUnrestrictedProductRole(req.user)
            ? productRows
            : productRows.filter((row) => authorizedInventoryRows.some(
              (inventoryRow) => (inventoryRow.product_uuid || inventoryRow.product_id) === (row.uuid || row.id)
            ));

          const responseRows = visibleProductRows.map((row) => ({
              id: row.uuid || row.id,
              uuid: row.uuid || row.id,
              barcode: row.barcode,
              add_item_barcode: row.add_item_barcode,
              product_name: row.product_name,
              category: row.category,
              expiration_date: row.expiration_date,
              total_quantity: inventoryByProduct[row.uuid || row.id] || 0,
          }));
          console.log('PRODUCT API KNOWN PRODUCT RESPONSE:', {
            included: responseRows.some(row => row.barcode === 'ABC000009'),
            totalQuantity: responseRows.find(row => row.barcode === 'ABC000009')?.total_quantity || 0,
          });
          return res.json(responseRows);
        }
      }
      if (productError) {
        if (['PGRST205', '42703'].includes(productError.code)) return res.json([]);
        console.warn('Supabase product fetch failed:', productError.message);
      }
    }

    if (!pool) return res.status(500).json({ message: 'Database is not configured for this environment' });

    console.log('PRODUCT API PATH: MYSQL FALLBACK');
    const branch = getAuthorizedBranch(req.user);
    const [rows] = await pool.query(
      `SELECT p.id, p.barcode, p.product_name, p.category, p.expiration_date,
              IFNULL(SUM(i.quantity), 0) AS total_quantity
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id
         ${isUnrestrictedProductRole(req.user) ? '' : 'AND LOWER(i.branch) = LOWER(?)'}
       ${isUnrestrictedProductRole(req.user) ? '' : 'WHERE i.id IS NOT NULL'}
       GROUP BY p.id
       ORDER BY p.product_name`,
      isUnrestrictedProductRole(req.user) ? [] : [branch]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch products', error: error.message });
  }
};

exports.getProductByBarcode = async (req, res) => {
  if (!isUnrestrictedProductRole(req.user) && !getAuthorizedBranch(req.user)) {
    return res.status(403).json({ message: 'A branch assignment is required' });
  }

  const { code } = req.params;
  try {
    if (isSupabaseEnabled && supabase) {
      const { data, error } = await supabase.from('products').select('*').eq('barcode', code).limit(1);
      if (error) {
        if (['PGRST205', '42703'].includes(error.code)) return res.status(404).json({ message: 'Product not found' });
        throw error;
      }
      if (!data || !data.length) return res.status(404).json({ message: 'Product not found' });

      const product = data[0];
      const { data: inventoryRows, error: inventoryError } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_uuid', product.uuid || product.id);
      if (inventoryError) {
        if (['PGRST205', '42703'].includes(inventoryError.code)) {
          return res.json({
            ...product,
            id: product.uuid || product.id,
            uuid: product.uuid || product.id,
            total_quantity: 0,
            inventory: [],
          });
        }
        throw inventoryError;
      }

      const authorizedBranchId = await resolveAuthorizedBranchId(req.user);
      const authorizedInventoryRows = filterInventoryForUser(inventoryRows || [], req.user, authorizedBranchId);
      if (!isUnrestrictedProductRole(req.user) && !authorizedInventoryRows.length) {
        return res.status(404).json({ message: 'Product not found' });
      }

      return res.json({
        ...product,
        id: product.uuid || product.id,
        uuid: product.uuid || product.id,
        total_quantity: authorizedInventoryRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
        inventory: authorizedInventoryRows,
      });
    }

    if (!pool) return res.status(500).json({ message: 'Database is not configured for this environment' });

    const [rows] = await pool.query('SELECT id, barcode, product_name, category, expiration_date FROM products WHERE barcode = ?', [code]);
    if (!rows.length) return res.status(404).json({ message: 'Product not found' });

    const product = rows[0];
    const branch = getAuthorizedBranch(req.user);
    const [inventoryRows] = await pool.query(
      `SELECT id, branch, branch_id, quantity
       FROM inventory
       WHERE product_id = ?
         ${isUnrestrictedProductRole(req.user) ? '' : 'AND LOWER(branch) = LOWER(?)'}`,
      isUnrestrictedProductRole(req.user) ? [product.id] : [product.id, branch]
    );
    if (!isUnrestrictedProductRole(req.user) && !inventoryRows.length) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const totalQuantity = inventoryRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    res.json({
      ...product,
      total_quantity: totalQuantity,
      inventory: inventoryRows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch product', error: error.message });
  }
};

exports.createProduct = async (req, res) => {
  const { product_name, barcode, category, expiration_date, sku, description } = req.body;
  
  if (!product_name || !barcode) {
    return res.status(400).json({ message: 'Product name and barcode are required' });
  }

  try {
    if (isSupabaseEnabled && supabase) {
      // Check if barcode already exists
      const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('barcode', barcode)
        .limit(1);

      if (existing && existing.length > 0) {
        return res.status(409).json({ message: 'Product with this barcode already exists' });
      }

      // Insert new product
      const { data, error } = await supabase
        .from('products')
        .insert([
          {
            product_name,
            barcode,
            category: category || null,
            expiration_date: expiration_date || null,
            sku: sku || null,
            description: description || null,
            is_active: true,
          }
        ])
        .select();

      if (error) {
        return res.status(500).json({ message: 'Failed to create product', error: error.message });
      }

      if (!data || !data.length) {
        return res.status(500).json({ message: 'Failed to create product - no data returned' });
      }

      const newProduct = data[0];
      return res.status(201).json({
        id: newProduct.uuid || newProduct.id,
        uuid: newProduct.uuid || newProduct.id,
        product_name: newProduct.product_name,
        barcode: newProduct.barcode,
        category: newProduct.category,
        expiration_date: newProduct.expiration_date,
        sku: newProduct.sku,
        description: newProduct.description,
        is_active: newProduct.is_active,
        message: 'Product created successfully'
      });
    }

    if (!pool) {
      return res.status(500).json({ message: 'Database is not configured for this environment' });
    }

    // Fallback to MySQL if Supabase not available
    const checkQuery = 'SELECT id FROM products WHERE barcode = ?';
    const [existing] = await pool.query(checkQuery, [barcode]);
    
    if (existing && existing.length > 0) {
      return res.status(409).json({ message: 'Product with this barcode already exists' });
    }

    const insertQuery = `INSERT INTO products (product_name, barcode, category, expiration_date, sku, description, is_active)
                         VALUES (?, ?, ?, ?, ?, ?, 1)`;
    const result = await pool.query(insertQuery, [
      product_name,
      barcode,
      category || null,
      expiration_date || null,
      sku || null,
      description || null
    ]);

    res.status(201).json({
      id: result[0].insertId,
      product_name,
      barcode,
      category: category || null,
      expiration_date: expiration_date || null,
      sku: sku || null,
      description: description || null,
      is_active: 1,
      message: 'Product created successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create product', error: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const { product_name, barcode, category, expiration_date, sku, description, is_active } = req.body;

  if (!id) {
    return res.status(400).json({ message: 'Product ID is required' });
  }

  try {
    if (isSupabaseEnabled && supabase) {
      // Check if barcode already used by another product
      if (barcode) {
        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .eq('barcode', barcode)
          .neq('id', id)
          .limit(1);

        if (existing && existing.length > 0) {
          return res.status(409).json({ message: 'Barcode already used by another product' });
        }
      }

      const updateData = {};
      if (product_name !== undefined) updateData.product_name = product_name;
      if (barcode !== undefined) updateData.barcode = barcode;
      if (category !== undefined) updateData.category = category;
      if (expiration_date !== undefined) updateData.expiration_date = expiration_date;
      if (sku !== undefined) updateData.sku = sku;
      if (description !== undefined) updateData.description = description;
      if (is_active !== undefined) updateData.is_active = is_active;

      const { data, error } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', id)
        .select();

      if (error) {
        return res.status(500).json({ message: 'Failed to update product', error: error.message });
      }

      if (!data || !data.length) {
        return res.status(404).json({ message: 'Product not found' });
      }

      const updatedProduct = data[0];
      return res.json({
        id: updatedProduct.uuid || updatedProduct.id,
        uuid: updatedProduct.uuid || updatedProduct.id,
        product_name: updatedProduct.product_name,
        barcode: updatedProduct.barcode,
        category: updatedProduct.category,
        expiration_date: updatedProduct.expiration_date,
        sku: updatedProduct.sku,
        description: updatedProduct.description,
        is_active: updatedProduct.is_active,
        message: 'Product updated successfully'
      });
    }

    if (!pool) {
      return res.status(500).json({ message: 'Database is not configured for this environment' });
    }

    // Fallback to MySQL
    const fields = [];
    const values = [];

    if (product_name !== undefined) {
      fields.push('product_name = ?');
      values.push(product_name);
    }
    if (barcode !== undefined) {
      fields.push('barcode = ?');
      values.push(barcode);
    }
    if (category !== undefined) {
      fields.push('category = ?');
      values.push(category);
    }
    if (expiration_date !== undefined) {
      fields.push('expiration_date = ?');
      values.push(expiration_date);
    }
    if (sku !== undefined) {
      fields.push('sku = ?');
      values.push(sku);
    }
    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description);
    }
    if (is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id);
    const query = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;
    const result = await pool.query(query, values);

    if (result[0].affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json({ message: 'Product updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update product', error: error.message });
  }
};

exports.deleteProduct = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Product ID is required' });
  }

  try {
    if (isSupabaseEnabled && supabase) {
      // For safety, we deactivate instead of hard delete
      const { data, error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', id)
        .select();

      if (error) {
        return res.status(500).json({ message: 'Failed to deactivate product', error: error.message });
      }

      if (!data || !data.length) {
        return res.status(404).json({ message: 'Product not found' });
      }

      return res.json({ message: 'Product deactivated successfully', data: data[0] });
    }

    if (!pool) {
      return res.status(500).json({ message: 'Database is not configured for this environment' });
    }

    // Fallback to MySQL - also deactivate instead of delete
    const query = 'UPDATE products SET is_active = 0 WHERE id = ?';
    const result = await pool.query(query, [id]);

    if (result[0].affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json({ message: 'Product deactivated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to deactivate product', error: error.message });
  }
};
