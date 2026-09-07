const express = require('express');

const router = express.Router();

const {
  getTransferHistory,
  getTransferByTrackingCode
} = require('../controllers/transferController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/history', authenticateToken, getTransferHistory);

router.get('/:tracking_code', getTransferByTrackingCode);

module.exports = router;