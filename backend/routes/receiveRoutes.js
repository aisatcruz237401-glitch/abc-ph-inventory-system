const express = require('express');

const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');

const {
  receiveStock,
  receiveTransfer,
  receiveSerializedDeliveryUnit
} = require('../controllers/receiveController');

// Normal stock receiving
router.post('/', authenticateToken, receiveStock);

// Transfer receiving
router.post('/transfer', authenticateToken, receiveTransfer);

// Physical serialized item receipt from delivery personnel storage
router.post('/delivery-unit', authenticateToken, receiveSerializedDeliveryUnit);

module.exports = router;