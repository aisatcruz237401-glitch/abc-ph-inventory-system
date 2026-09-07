const express = require('express');
const router = express.Router();
const intakeController = require('../controllers/intakeController');
const { authenticateToken } = require('../middleware/authMiddleware');

/**
 * POST /api/intake/main-source
 * Create a batch intake for a selected product using a generated serialized item barcode format.
 * Auth required: Main Source staff or admin
 * Body: { product_uuid, intake_date, quantity, created_by? }
 * Response: { success, product_name, inventory_qty, generated_barcodes, ... }
 */
router.post('/main-source', authenticateToken, intakeController.createMainSourceIntake);

/**
 * POST /api/intake/add-barcode
 * Create a single-unit intake by scanning ADD barcode
 * Auth required: Main Source staff or admin
 * Body: { add_barcode, created_by? }
 * Response: { success, vx_barcode, serialized_unit_id, product_uuid, product_name, inventory_qty, ... }
 */
router.post('/add-barcode', authenticateToken, intakeController.intakeByAddBarcode);

/**
 * POST /api/intake/pending-item
 * Register a generated-but-not-yet-registered Main Source item so the scanner can recognize it.
 * Auth required: Main Source staff or admin
 */
router.post('/pending-item', authenticateToken, intakeController.createPendingMainSourceItem);

/**
 * POST /api/intake/register-pending
 * Final validation and registration of a generated pending Main Source item.
 * Auth required: Main Source staff or admin
 */
router.post('/register-pending', authenticateToken, intakeController.registerPendingMainSourceItem);

/**
 * POST /api/intake/register-pending-batch
 * Final validation and registration of multiple generated pending Main Source items.
 * Auth required: Main Source staff or admin
 * Body: { barcodes: ["BARCODE1", "BARCODE2", ...] }
 */
router.post(
  '/register-pending-batch',
  authenticateToken,
  intakeController.registerPendingMainSourceItems
);

/**
 * GET /api/intake/products
 * List all products available for intake (those with add_item_barcode)
 * Auth required: Main Source staff or admin
 * Response: Array of { id, uuid, barcode, add_item_barcode, product_name, category, expiration_date, is_active }
 */
router.get('/products', authenticateToken, intakeController.getIntakeProducts);

/**
 * GET /api/intake/status/:vx_barcode
 * Check status of a scanned unit by VX barcode
 * No auth required for status check (read-only)
 * Response: { success, vx_barcode, status, product_name, product_uuid, created_at }
 */
router.get('/status/:vx_barcode', intakeController.getUnitStatus);

module.exports = router;
