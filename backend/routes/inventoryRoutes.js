const express = require('express');
const router = express.Router();
const { getInventory, getLowStock } = require('../controllers/inventoryController');

router.get('/', getInventory);
router.get('/low-stock', getLowStock);

module.exports = router;
