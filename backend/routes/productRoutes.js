const express = require('express');
const router = express.Router();
const { getProducts, getProductByBarcode, createProduct, updateProduct, deleteProduct } = require('../controllers/productController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/', authenticateToken, getProducts);
router.post('/', createProduct);
router.get('/barcode/:code', authenticateToken, getProductByBarcode);
router.put('/:id', updateProduct);
router.patch('/:id', updateProduct);
router.delete('/:id', deleteProduct);

module.exports = router;
