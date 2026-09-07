const express = require('express');
const router = express.Router();
const { consumeStock } = require('../controllers/consumeController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/', authenticateToken, consumeStock);

module.exports = router;
