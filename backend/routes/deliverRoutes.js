const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  deliverStock,
  createMultiProductTransfer,
  pickupSerializedTransferUnit,
  getDeliveryPersonnel,
  getSerializedDeliveryUnit,
  createAssignedDelivery,
} = require('../controllers/deliverController');

router.get('/delivery-personnel', authenticateToken, getDeliveryPersonnel);
router.get('/serialized-unit/:unit_barcode', authenticateToken, getSerializedDeliveryUnit);
router.post('/', authenticateToken, deliverStock);
router.post('/multi-product', authenticateToken, createMultiProductTransfer);
router.post('/assigned', authenticateToken, createAssignedDelivery);
router.post('/pickup', authenticateToken, pickupSerializedTransferUnit);

module.exports = router;

router.get(
  '/serialized-unit/:unit_barcode',
  authenticateToken,
  getSerializedDeliveryUnit
);
