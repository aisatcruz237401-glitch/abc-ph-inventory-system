const pool = require('../config/database');
const { supabase, isSupabaseEnabled } = require('../config/supabase');

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

/**
 * Fetch report rows from Supabase or the fallback database.
 * This keeps the same filtering behavior as your existing getReport().
 */
async function fetchReportRows(req) {
  const branch = req.query.branch;
  const type = req.query.type;
  const product = req.query.product;
  const sourceBranch = req.query.sourceBranch;
  const destinationBranch = req.query.destinationBranch;

  if (isSupabaseEnabled && supabase) {
    let reportQuery = supabase
      .from('stock_transactions')
      .select('*');

    if (branch) {
      reportQuery = reportQuery.eq('branch', branch);
    }

    if (type) {
      reportQuery = reportQuery.eq('type', type);
    }

    if (sourceBranch) {
      reportQuery = reportQuery.eq('branch', sourceBranch);
    }

    const { data, error } = await reportQuery
      .order('date', { ascending: false })
      .limit(100);

    if (!error && data) {
      const productUuids = [
        ...new Set(
          data
            .filter((row) => row.product_uuid)
            .map((row) => row.product_uuid)
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
          productMap = Object.fromEntries(
            productRows.map((row) => [row.uuid, row])
          );
        }
      }

      return data.map((row) => ({
        id: row.id,
        barcode: row.barcode,
        product_name:
          productMap[row.product_uuid]?.product_name || null,
        type: row.type,
        quantity: row.quantity,
        user: row.user_name || row.user,
        branch: row.branch,
        date: row.date
      }));
    }

    if (error && !['PGRST205', '42703'].includes(error.code)) {
      console.warn(
        'Supabase report fetch failed:',
        error.message
      );
    }
  }

  if (!pool) {
    throw new Error(
      'Database is not configured for this environment'
    );
  }

  let query = `
    SELECT
      st.id,
      st.barcode,
      p.product_name,
      st.type,
      st.quantity,
      st.user,
      st.branch AS branch,
      st.date
    FROM stock_transactions st
    JOIN products p ON p.id = st.product_id
    WHERE 1=1
  `;

  const params = [];

  if (branch) {
    query += ' AND st.branch = ?';
    params.push(branch);
  }

  if (type) {
    query += ' AND st.type = ?';
    params.push(type);
  }

  if (product) {
    query += ' AND p.product_name LIKE ?';
    params.push(`%${product}%`);
  }

  if (sourceBranch) {
    query += ' AND st.branch = ?';
    params.push(sourceBranch);
  }

  if (destinationBranch) {
    // Destination branch is not currently supported
    // by the stock_transactions schema.
  }

  query += ' ORDER BY st.date DESC LIMIT 100';

  const [rows] = await pool.query(query, params);

  return rows;
}

function isUnrestrictedReportRole(user) {
  return ['admin', 'superadmin'].includes(String(user?.role || '').toLowerCase());
}

async function resolveConsumptionScope(user) {
  if (isUnrestrictedReportRole(user)) {
    return { branchId: null };
  }

  const branchName = String(user?.branch || user?.assigned_branch || '').trim();
  if (!branchName) {
    const error = new Error('Assigned branch is required');
    error.statusCode = 403;
    throw error;
  }

  if (isSupabaseEnabled && supabase) {
    const { data, error } = await supabase
      .from('branches')
      .select('id, branch_name')
      .ilike('branch_name', branchName)
      .limit(1);

    if (error) throw error;
    if (!data?.[0]) {
      const error = new Error('Assigned branch was not found');
      error.statusCode = 403;
      throw error;
    }
    return { branchId: data[0].id };
  }

  if (!pool) throw new Error('Database is not configured for this environment');
  const [rows] = await pool.query(
    'SELECT id FROM branches WHERE LOWER(COALESCE(branch_name, name)) = LOWER(?) LIMIT 1',
    [branchName]
  );
  if (!rows.length) {
    const error = new Error('Assigned branch was not found');
    error.statusCode = 403;
    throw error;
  }
  return { branchId: rows[0].id };
}

function normalizeConsumptionRow(row, product = {}) {
  const normalized = {
    id: row.id,
    uuid: row.uuid,
    product_id: row.product_id,
    product_uuid: row.product_uuid,
    product_name: product.product_name || row.product_name || null,
    barcode: row.barcode,
    branch_id: row.branch_id,
    branch: row.branch,
    quantity: row.quantity,
    user: row.user_name || row.user || null,
    date: row.date,
    type: row.type
  };

  if (product.unit !== undefined) normalized.unit = product.unit;
  if (row.user_id !== undefined) normalized.user_id = row.user_id;
  if (row.reference !== undefined) normalized.reference = row.reference;
  if (row.note !== undefined) normalized.note = row.note;
  return normalized;
}

async function loadConsumptionProducts(rows) {
  if (!rows.length || !isSupabaseEnabled || !supabase) return {};

  const productUuids = [...new Set(rows.map((row) => row.product_uuid).filter(Boolean))];
  if (!productUuids.length) return {};

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .in('uuid', productUuids);
  if (error) throw error;
  return Object.fromEntries((data || []).map((product) => [product.uuid, product]));
}

async function fetchConsumptionRows({ branchId, page, limit }) {
  const offset = (page - 1) * limit;

  if (isSupabaseEnabled && supabase) {
    let query = supabase
      .from('stock_transactions')
      .select('*', { count: 'exact' })
      .eq('type', 'CONSUME');

    if (branchId) query = query.eq('branch_id', branchId);

    const { data, count, error } = await query
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const productMap = await loadConsumptionProducts(data || []);
    return {
      rows: (data || []).map((row) => normalizeConsumptionRow(row, productMap[row.product_uuid])),
      total: count || 0
    };
  }

  if (!pool) throw new Error('Database is not configured for this environment');

  let where = 'WHERE st.type = ?';
  const countParams = ['CONSUME'];
  const queryParams = ['CONSUME'];
  if (branchId) {
    where += ' AND st.branch_id = ?';
    countParams.push(branchId);
    queryParams.push(branchId);
  }

  const [[countRows], [rows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total FROM stock_transactions st ${where}`, countParams),
    pool.query(
      `SELECT st.*, p.product_name, p.uuid AS product_uuid
       FROM stock_transactions st
       LEFT JOIN products p ON p.id = st.product_id
       ${where}
       ORDER BY st.date DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )
  ]);

  return {
    rows: rows.map((row) => normalizeConsumptionRow(row, row)),
    total: Number(countRows[0]?.total || 0)
  };
}

async function fetchAllConsumptionRows(branchId) {
  const rows = [];
  let page = 1;
  const limit = 1000;
  let total = 0;

  do {
    const result = await fetchConsumptionRows({ branchId, page, limit });
    rows.push(...result.rows);
    total = result.total;
    page += 1;
  } while (rows.length < total);

  return rows;
}

exports.getConsumptionHistory = async (req, res) => {
  try {
    const { branchId } = await resolveConsumptionScope(req.user);
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 5, 1), 100);
    const { rows, total } = await fetchConsumptionRows({ branchId, page, limit });
    const totalPages = Math.ceil(total / limit);

    return res.json({
      data: rows,
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1
    });
  } catch (error) {
    console.error('Get consumption history error:', error);
    return res.status(error.statusCode || 500).json({ message: 'Failed to fetch consumption history', error: error.message });
  }
};

function createConsumptionExcelBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Consumption History');
  const columns = [
    ['Transaction ID', 'id'],
    ['Transaction UUID', 'uuid'],
    ['Product ID', 'product_id'],
    ['Product UUID', 'product_uuid'],
    ['Product', 'product_name'],
    ['Barcode', 'barcode'],
    ['Branch ID', 'branch_id'],
    ['Branch', 'branch'],
    ['Quantity', 'quantity'],
    ['Unit', 'unit'],
    ['Consumed By', 'user'],
    ['User ID', 'user_id'],
    ['Date', 'date'],
    ['Type', 'type'],
    ['Reference', 'reference'],
    ['Note', 'note']
  ].filter(([, key]) => rows.some((row) => row[key] !== undefined));

  worksheet.columns = columns.map(([header, key]) => ({ header, key, width: 24 }));
  rows.forEach((row) => worksheet.addRow({
    ...row,
    date: row.date ? new Date(row.date) : null
  }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook.xlsx.writeBuffer().then((buffer) => Buffer.from(buffer));
}

exports.exportConsumptionExcel = async (req, res) => {
  try {
    const { branchId } = await resolveConsumptionScope(req.user);
    const rows = await fetchAllConsumptionRows(branchId);
    const buffer = await createConsumptionExcelBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="consumption-history.xlsx"');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Consumption Excel export error:', error);
    return res.status(error.statusCode || 500).json({ message: 'Failed to export consumption history', error: error.message });
  }
};

/**
 * Get report data as JSON.
 */
exports.getReport = async (req, res) => {
  try {
    const rows = await fetchReportRows(req);

    return res.json(rows);
  } catch (error) {
    console.error('Get report error:', error);

    return res.status(500).json({
      message: 'Failed to fetch report',
      error: error.message
    });
  }
};

/**
 * Upload an existing file to Supabase Storage.
 *
 * POST /api/reports/upload
 * Form-data field: file
 */
exports.uploadReport = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: 'No file uploaded'
      });
    }

    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({
        message: 'Supabase is not configured'
      });
    }

    const file = req.file;

    const safeFileName = file.originalname.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );

    const filePath = `reports/${Date.now()}-${safeFileName}`;

    const { data, error } = await supabase.storage
      .from('inventory_file')
      .upload(filePath, file.buffer, {
        contentType:
          file.mimetype || 'application/octet-stream',
        upsert: false
      });

    if (error) {
      console.error(
        'Supabase Storage upload failed:',
        error
      );

      return res.status(500).json({
        message: 'Failed to upload report',
        error: error.message
      });
    }

    return res.status(201).json({
      message: 'Report uploaded successfully',
      path: data.path
    });
  } catch (error) {
    console.error('Report upload error:', error);

    return res.status(500).json({
      message: 'Failed to upload report',
      error: error.message
    });
  }
};

/**
 * Generate a PDF report in memory.
 */
function createPdfBuffer(rows) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        layout: 'landscape'
      });

      const chunks = [];

      doc.on('data', (chunk) => {
        chunks.push(chunk);
      });

      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      doc.on('error', reject);

      doc
        .fontSize(18)
        .text('Inventory Report', {
          align: 'center'
        });

      doc.moveDown();

      doc
        .fontSize(9)
        .text(`Generated: ${new Date().toLocaleString()}`);

      doc.moveDown();

      const headers = [
        'ID',
        'Barcode',
        'Product',
        'Type',
        'Quantity',
        'Branch',
        'User',
        'Date'
      ];

      const columnX = [
        40,
        75,
        155,
        315,
        375,
        425,
        520,
        600
      ];

      let y = 95;

      doc.font('Helvetica-Bold').fontSize(8);

      headers.forEach((header, index) => {
        doc.text(header, columnX[index], y, {
          width: 75
        });
      });

      y += 20;

      doc.font('Helvetica').fontSize(7);

      rows.forEach((row) => {
        if (y > 540) {
          doc.addPage();
          y = 40;

          doc.font('Helvetica-Bold').fontSize(8);

          headers.forEach((header, index) => {
            doc.text(header, columnX[index], y, {
              width: 75
            });
          });

          y += 20;

          doc.font('Helvetica').fontSize(7);
        }

        const values = [
          row.id ?? '',
          row.barcode ?? '',
          row.product_name ?? '',
          row.type ?? '',
          row.quantity ?? '',
          row.branch ?? '',
          row.user ?? '',
          row.date
            ? new Date(row.date).toLocaleString()
            : ''
        ];

        values.forEach((value, index) => {
          doc.text(String(value), columnX[index], y, {
            width: 75
          });
        });

        y += 18;});

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate an Excel report in memory.
 */
async function createExcelBuffer(rows) {
  const workbook = new ExcelJS.Workbook();

  const worksheet = workbook.addWorksheet(
    'Inventory Report'
  );

  worksheet.columns = [
    {
      header: 'ID',
      key: 'id',
      width: 10
    },
    {
      header: 'Barcode',
      key: 'barcode',
      width: 18
    },
    {
      header: 'Product',
      key: 'product_name',
      width: 30
    },
    {
      header: 'Type',
      key: 'type',
      width: 15
    },
    {
      header: 'Quantity',
      key: 'quantity',
      width: 12
    },
    {
      header: 'Branch',
      key: 'branch',
      width: 25
    },
    {
      header: 'User',
      key: 'user',
      width: 25
    },
    {
      header: 'Date',
      key: 'date',
      width: 25
    }
  ];

  rows.forEach((row) => {
    worksheet.addRow({
      id: row.id,
      barcode: row.barcode,
      product_name: row.product_name,
      type: row.type,
      quantity: row.quantity,
      branch: row.branch,
      user: row.user,
      date: row.date
        ? new Date(row.date)
        : null
    });
  });

  worksheet.getRow(1).font = {
    bold: true
  };

  worksheet.views = [
    {
      state: 'frozen',
      ySplit: 1
    }
  ];

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(buffer);
}

/**
 * Generate PDF, upload it to Supabase Storage,
 * and return a temporary download URL.
 *
 * GET /api/reports/export/pdf
 */
exports.exportPdf = async (req, res) => {
  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({
        message: 'Supabase is not configured'
      });
    }

    const rows = await fetchReportRows(req);

    const pdfBuffer = await createPdfBuffer(rows);

    const fileName = `inventory-report-${Date.now()}.pdf`;
    const filePath = `reports/${fileName}`;

    const { data, error } = await supabase.storage
      .from('inventory_file')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (error) {
      console.error('PDF upload failed:', error);

      return res.status(500).json({
        message: 'Failed to upload PDF report',
        error: error.message
      });
    }

    // Create a temporary download URL for the private file
    const {
      data: signedData,
      error: signedError
    } = await supabase.storage
      .from('inventory_file')
      .createSignedUrl(filePath, 60 * 10); // 10 minutes

    if (signedError) {
      console.error(
        'PDF signed URL creation failed:',
        signedError
      );

      return res.status(500).json({
        message: 'PDF uploaded, but download link could not be created',
        error: signedError.message
      });
    }

    return res.status(201).json({
      message: 'PDF report generated successfully',
      path: data.path,
      downloadUrl: signedData.signedUrl
    });
  } catch (error) {
    console.error('PDF export error:', error);

    return res.status(500).json({
      message: 'Failed to export PDF report',
      error: error.message
    });
  }
};

/**
 * Generate Excel, upload it to Supabase Storage,
 * and return a temporary download URL.
 *
 * GET /api/reports/export/excel
 */
exports.exportExcel = async (req, res) => {
  try {
    if (!isSupabaseEnabled || !supabase) {
      return res.status(500).json({
        message: 'Supabase is not configured'
      });
    }

    const rows = await fetchReportRows(req);

    const excelBuffer = await createExcelBuffer(rows);

    const fileName = `inventory-report-${Date.now()}.xlsx`;
    const filePath = `reports/${fileName}`;

    const { data, error } = await supabase.storage
      .from('inventory_file')
      .upload(filePath, excelBuffer, {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false
      });

    if (error) {
      console.error('Excel upload failed:', error);

      return res.status(500).json({
        message: 'Failed to upload Excel report',
        error: error.message
      });
    }

    // Create a temporary download URL for the private file
    const {
      data: signedData,
      error: signedError
    } = await supabase.storage
      .from('inventory_file')
      .createSignedUrl(filePath, 60 * 10); // 10 minutes

    if (signedError) {
      console.error(
        'Excel signed URL creation failed:',
        signedError
      );

      return res.status(500).json({
        message: 'Excel uploaded, but download link could not be created',
        error: signedError.message
      });
    }

    return res.status(201).json({
      message: 'Excel report generated successfully',
      path: data.path,
      downloadUrl: signedData.signedUrl
    });
  } catch (error) {
    console.error('Excel export error:', error);

    return res.status(500).json({
      message: 'Failed to export Excel report',
      error: error.message
    });
  }
};