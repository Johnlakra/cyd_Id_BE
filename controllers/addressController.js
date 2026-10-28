// controllers/addressController.js - Customer delivery addresses
const { query, queryOne } = require('../config/database');

const listAddresses = async (req, res) => {
    try {
        const addresses = await query(
            'SELECT * FROM shop_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
            [req.user.id]
        );
        res.json({ success: true, message: 'Addresses retrieved successfully', data: { addresses } });
    } catch (error) {
        console.error('listAddresses error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve addresses' });
    }
};

const createAddress = async (req, res) => {
    try {
        const { label, full_name, phone, line1, line2, city, state, pincode, is_default } = req.body;

        if (is_default) {
            await query('UPDATE shop_addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
        }

        const result = await query(
            `INSERT INTO shop_addresses (user_id, label, full_name, phone, line1, line2, city, state, pincode, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, label || 'Home', full_name, phone, line1, line2 || null, city, state, pincode, is_default ? 1 : 0]
        );

        const address = await queryOne('SELECT * FROM shop_addresses WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Address added successfully', data: { address } });
    } catch (error) {
        console.error('createAddress error:', error);
        res.status(500).json({ success: false, message: 'Failed to add address' });
    }
};

const updateAddress = async (req, res) => {
    try {
        const existing = await queryOne('SELECT * FROM shop_addresses WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        const { label, full_name, phone, line1, line2, city, state, pincode, is_default } = req.body;

        if (is_default) {
            await query('UPDATE shop_addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
        }

        await query(
            `UPDATE shop_addresses SET label = ?, full_name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, state = ?, pincode = ?, is_default = ?
             WHERE id = ?`,
            [
                label || existing.label,
                full_name || existing.full_name,
                phone || existing.phone,
                line1 || existing.line1,
                line2 !== undefined ? line2 : existing.line2,
                city || existing.city,
                state || existing.state,
                pincode || existing.pincode,
                is_default ? 1 : existing.is_default,
                req.params.id,
            ]
        );

        const updated = await queryOne('SELECT * FROM shop_addresses WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Address updated successfully', data: { address: updated } });
    } catch (error) {
        console.error('updateAddress error:', error);
        res.status(500).json({ success: false, message: 'Failed to update address' });
    }
};

const deleteAddress = async (req, res) => {
    try {
        const existing = await queryOne('SELECT * FROM shop_addresses WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }
        await query('DELETE FROM shop_addresses WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Address deleted successfully' });
    } catch (error) {
        console.error('deleteAddress error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete address' });
    }
};

module.exports = { listAddresses, createAddress, updateAddress, deleteAddress };
