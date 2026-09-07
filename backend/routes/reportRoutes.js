const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

const {
  getReport,
  uploadReport,
  exportPdf,
  exportExcel,
  getConsumptionHistory,
  exportConsumptionExcel
} = require('../controllers/reportController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

// Get report data
router.get('/', getReport);

// Upload an existing report file
router.post(
  '/upload',
  upload.single('file'),
  uploadReport
);

// Generate and save PDF report
router.get('/export/pdf', exportPdf);

// Generate and save Excel report
router.get('/export/excel', exportExcel);

// Consumption history and exports are separately scoped by authenticated role.
router.get('/consumption', authenticateToken, getConsumptionHistory);
router.get('/consumption/export/excel', authenticateToken, exportConsumptionExcel);

module.exports = router;