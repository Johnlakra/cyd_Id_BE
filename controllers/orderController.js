// controllers/orderController.js - Order placement and fulfillment
//
// Checkout note: a customer's cart is grouped by shop on the frontend and this endpoint is
// called once per shop, so every order row always belongs to exactly one shop (see
// config/shopDatabase.js design notes). Prices are always re-read from the database here -
// never trust a price the client sends - so a stale cart can't be used to under-pay.
const { query, queryOne, withTransaction } = require('../config/database');
const { generateOrderNumber } = require('../utils/shopHelpers');

const ALLOWED_TRANSITIONS = {
    placed: ['accepted', 'rejected'],
    accepted: ['packed', 'rejected'],
    packed: ['shipped'],
    shipped: ['delivered'],
};

// POST /shop/orders - customer places an order for ONE shop's items
const placeOrder = async (req, res) => {
    try {
        const { shop_id, address_id, items, payment_method, notes } = req.body;

        const shop = await queryOne("SELECT * FROM shops WHERE id = ? AND status = 'approved'", [shop_id]);
        if (!shop) {
            return res.status(404).json({ success: false, message: 'Shop not found or not approved' });
        }

        const address = await queryOne('SELECT * FROM shop_addresses WHERE id = ? AND user_id = ?', [address_id, req.user.id]);
        if (!address) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        const order = await withTransaction(async (tx) => {
            let subtotalPaise = 0;
            const resolvedItems = [];

            for (const item of items) {
                const product = await tx.queryOne(
                    "SELECT * FROM shop_products WHERE id = ? AND shop_id = ? AND status = 'active' FOR UPDATE",
                    [item.product_id, shop_id]
                );

                if (!product) {
                    throw Object.assign(new Error(`Product ${item.product_id} is not available`), { statusCode: 400 });
                }
                if (product.stock_quantity < item.quantity) {
                    throw Object.assign(new Error(`Not enough stock for "${product.title}" (only ${product.stock_quantity} left)`), { statusCode: 400 });
                }

                const lineTotal = product.price_paise * item.quantity;
                subtotalPaise += lineTotal;
                resolvedItems.push({ product, quantity: item.quantity, lineTotal });
            }

            const totalPaise = subtotalPaise; // shipping is 0 for MVP; shop owners arrange local delivery/pickup
            const orderNumber = generateOrderNumber();

            const orderResult = await tx.query(
                `INSERT INTO shop_orders (order_number, customer_user_id, shop_id, address_id, subtotal_paise, shipping_paise, total_paise, status, payment_status, payment_method, notes)
                 VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'pending', ?, ?)`,
                [
                    orderNumber,
                    req.user.id,
                    shop_id,
                    address_id,
                    subtotalPaise,
                    totalPaise,
                    payment_method === 'cod' ? 'placed' : 'pending_payment',
                    payment_method,
                    notes || null,
                ]
            );

            const orderId = orderResult.insertId;

            for (const resolved of resolvedItems) {
                await tx.query(
                    `INSERT INTO shop_order_items (order_id, product_id, product_title_snapshot, unit_price_paise, quantity, line_total_paise)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [orderId, resolved.product.id, resolved.product.title, resolved.product.price_paise, resolved.quantity, resolved.lineTotal]
                );
                await tx.query('UPDATE shop_products SET stock_quantity = stock_quantity - ? WHERE id = ?', [
                    resolved.quantity,
                    resolved.product.id,
                ]);
            }

            return tx.queryOne('SELECT * FROM shop_orders WHERE id = ?', [orderId]);
        });

        res.status(201).json({
            success: true,
            message: payment_method === 'cod'
                ? 'Order placed successfully. Pay the shop owner on delivery.'
                : 'Order created. Proceed to payment.',
            data: { order },
        });
    } catch (error) {
        console.error('placeOrder error:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : 'Failed to place order',
        });
    }
};

const attachItems = async (orders) => {
    if (orders.length === 0) return orders;
    const ids = orders.map((o) => o.id);
    const items = await query(
        `SELECT * FROM shop_order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    return orders.map((order) => ({ ...order, items: items.filter((i) => i.order_id === order.id) }));
};

// GET /shop/orders - customer's own order history
const listMyOrders = async (req, res) => {
    try {
        const orders = await query(
            `SELECT o.*, s.name as shop_name
             FROM shop_orders o JOIN shops s ON s.id = o.shop_id
             WHERE o.customer_user_id = ?
             ORDER BY o.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, message: 'Orders retrieved successfully', data: { orders: await attachItems(orders) } });
    } catch (error) {
        console.error('listMyOrders error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve orders' });
    }
};

// GET /shop/orders/shop - shop owner's incoming orders
const listShopOrders = async (req, res) => {
    try {
        const orders = await query(
            `SELECT o.*, u.username as customer_username
             FROM shop_orders o JOIN users u ON u.id = o.customer_user_id
             WHERE o.shop_id = ?
             ORDER BY o.created_at DESC`,
            [req.shop.id]
        );
        res.json({ success: true, message: 'Shop orders retrieved successfully', data: { orders: await attachItems(orders) } });
    } catch (error) {
        console.error('listShopOrders error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve shop orders' });
    }
};

// GET /shop/orders/:id - accessible by the customer who placed it, the owning shop, or an admin
const getOrderById = async (req, res) => {
    try {
        const order = await queryOne(
            `SELECT o.*, s.name as shop_name, s.owner_user_id, a.full_name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode
             FROM shop_orders o
             JOIN shops s ON s.id = o.shop_id
             JOIN shop_addresses a ON a.id = o.address_id
             WHERE o.id = ?`,
            [req.params.id]
        );

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const isCustomer = order.customer_user_id === req.user.id;
        const isShopOwner = order.owner_user_id === req.user.id;
        const isAdmin = req.user.role === 'admin';

        if (!isCustomer && !isShopOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'You do not have access to this order' });
        }

        const items = await query('SELECT * FROM shop_order_items WHERE order_id = ?', [req.params.id]);
        res.json({ success: true, message: 'Order retrieved successfully', data: { order: { ...order, items } } });
    } catch (error) {
        console.error('getOrderById error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve order' });
    }
};

// PUT /shop/orders/:id/status - shop owner advances order fulfillment status
const updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const order = await queryOne('SELECT * FROM shop_orders WHERE id = ?', [req.params.id]);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.shop_id !== req.shop.id) {
            return res.status(403).json({ success: false, message: 'This order does not belong to your shop' });
        }

        const allowedNext = ALLOWED_TRANSITIONS[order.status] || [];
        if (!allowedNext.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot move order from "${order.status}" to "${status}"`,
            });
        }

        await query('UPDATE shop_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, req.params.id]);
        const updated = await queryOne('SELECT * FROM shop_orders WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: `Order marked as ${status}`, data: { order: updated } });
    } catch (error) {
        console.error('updateOrderStatus error:', error);
        res.status(500).json({ success: false, message: 'Failed to update order status' });
    }
};

// PUT /shop/orders/:id/cancel - customer cancels before the shop starts fulfilling it
const cancelOrder = async (req, res) => {
    try {
        const order = await queryOne('SELECT * FROM shop_orders WHERE id = ?', [req.params.id]);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.customer_user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'This is not your order' });
        }
        if (!['pending_payment', 'placed'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'This order can no longer be cancelled' });
        }

        await withTransaction(async (tx) => {
            await tx.query("UPDATE shop_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
            const items = await tx.query('SELECT * FROM shop_order_items WHERE order_id = ?', [req.params.id]);
            for (const item of items) {
                await tx.query('UPDATE shop_products SET stock_quantity = stock_quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
            }
        });

        res.json({ success: true, message: 'Order cancelled successfully' });
    } catch (error) {
        console.error('cancelOrder error:', error);
        res.status(500).json({ success: false, message: 'Failed to cancel order' });
    }
};

module.exports = {
    placeOrder,
    listMyOrders,
    listShopOrders,
    getOrderById,
    updateOrderStatus,
    cancelOrder,
};
