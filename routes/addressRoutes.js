// routes/addressRoutes.js - Customer delivery addresses
const express = require('express');
const router = express.Router();

const addressController = require('../controllers/addressController');
const { authenticateToken } = require('../middleware/auth');
const { validateAddress } = require('../middleware/shopValidation');

router.get('/', authenticateToken, addressController.listAddresses);
router.post('/', [authenticateToken, validateAddress], addressController.createAddress);
router.put('/:id', [authenticateToken, validateAddress], addressController.updateAddress);
router.delete('/:id', authenticateToken, addressController.deleteAddress);

module.exports = router;
