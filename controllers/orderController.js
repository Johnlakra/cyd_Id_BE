// controllers/orderController.js - HTTP layer for orders. All rules live in
// services/orderLifecycle.js (writes) and services/orderQueries.js (reads).
const lifecycle = require('../services/orderLifecycle');
const queries = require('../services/orderQueries');
const { uploadImage } = require('../utils/fileUpload');
const { HttpError, sendError } = require('../utils/httpError');

const orderId = (req) => Number(req.params.id);

// Payment screenshots are stored privately (signed, expiring links only): they show bank details.
const uploadEvidence = async (base64) => {
    if (!base64) return null;
    try {
        return await uploadImage(base64, { folder: 'cyd/order-evidence', type: 'authenticated' });
    } catch (error) {
        if (error.status === 400) throw new HttpError(400, error.message);
        throw new HttpError(502, 'Could not upload the screenshot. Please try again.');
    }
};

const respondWithOrder = async (req, res, message) => {
    const order = await queries.getOrderForViewer(req.user, orderId(req));
    res.json({ success: true, message, data: { order } });
};

const listMyOrders = async (req, res) => {
    try {
        lifecycle.maybeSweep();
        const orders = await queries.listBuyerOrders(req.user);
        res.json({ success: true, message: 'Orders retrieved successfully', data: { orders } });
    } catch (error) {
        sendError(res, error, 'listMyOrders');
    }
};

const listShopOrders = async (req, res) => {
    try {
        lifecycle.maybeSweep();
        const orders = await queries.listSellerOrders(req.shop);
        res.json({ success: true, message: 'Shop orders retrieved successfully', data: { orders } });
    } catch (error) {
        sendError(res, error, 'listShopOrders');
    }
};

const actionCount = async (req, res) => {
    try {
        const counts = await queries.actionCounts(req.user);
        res.json({ success: true, message: 'Action counts', data: counts });
    } catch (error) {
        sendError(res, error, 'actionCount');
    }
};

const getOrder = async (req, res) => {
    try {
        lifecycle.maybeSweep();
        await respondWithOrder(req, res, 'Order retrieved successfully');
    } catch (error) {
        sendError(res, error, 'getOrder');
    }
};

const claimPayment = async (req, res) => {
    try {
        const evidence = await uploadEvidence(req.body.screenshot);
        await lifecycle.claimPayment(req.user, orderId(req), { utr: req.body.utr, evidence });
        await respondWithOrder(req, res, 'Payment submitted. The seller will confirm once it shows in their bank.');
    } catch (error) {
        sendError(res, error, 'claimPayment');
    }
};

const editClaim = async (req, res) => {
    try {
        await lifecycle.editClaim(req.user, orderId(req), { utr: req.body.utr });
        await respondWithOrder(req, res, 'UPI reference updated');
    } catch (error) {
        sendError(res, error, 'editClaim');
    }
};

const confirmPayment = async (req, res) => {
    try {
        await lifecycle.confirmPayment(req.user, orderId(req), { utr: req.body.utr });
        await respondWithOrder(req, res, 'Payment confirmed');
    } catch (error) {
        sendError(res, error, 'confirmPayment');
    }
};

const reportNotReceived = async (req, res) => {
    try {
        await lifecycle.reportNotReceived(req.user, orderId(req), { description: req.body.description });
        await respondWithOrder(req, res, 'Reported to an admin. The buyer has been asked for proof.');
    } catch (error) {
        sendError(res, error, 'reportNotReceived');
    }
};

const markRefunded = async (req, res) => {
    try {
        await lifecycle.markRefunded(req.user, orderId(req), { refund_utr: req.body.refund_utr });
        await respondWithOrder(req, res, 'Refund recorded');
    } catch (error) {
        sendError(res, error, 'markRefunded');
    }
};

const openDispute = async (req, res) => {
    try {
        const evidence = await uploadEvidence(req.body.screenshot);
        await lifecycle.openDispute(req.user, orderId(req), {
            reason: req.body.reason,
            description: req.body.description,
            utr: req.body.utr,
            evidence,
        });
        await respondWithOrder(req, res, 'Dispute opened. An admin will review it.');
    } catch (error) {
        sendError(res, error, 'openDispute');
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        await lifecycle.advanceFulfilment(req.user, orderId(req), { status: req.body.status, reason: req.body.reason });
        await respondWithOrder(req, res, `Order marked as ${req.body.status}`);
    } catch (error) {
        sendError(res, error, 'updateOrderStatus');
    }
};

const cancelOrder = async (req, res) => {
    try {
        await lifecycle.cancelByBuyer(req.user, orderId(req), { reason: req.body && req.body.reason });
        await respondWithOrder(req, res, 'Order cancelled');
    } catch (error) {
        sendError(res, error, 'cancelOrder');
    }
};

const listMessages = async (req, res) => {
    try {
        const after = parseInt(req.query.after, 10);
        const data = await queries.listMessages(req.user, orderId(req), after);
        res.json({ success: true, message: 'Messages', data });
    } catch (error) {
        sendError(res, error, 'listMessages');
    }
};

const postMessage = async (req, res) => {
    try {
        const message = await queries.postMessage(req.user, orderId(req), req.body.body);
        res.status(201).json({ success: true, message: 'Message sent', data: { message } });
    } catch (error) {
        sendError(res, error, 'postMessage');
    }
};

const listEvidence = async (req, res) => {
    try {
        const evidence = await queries.listEvidence(req.user, orderId(req));
        res.json({ success: true, message: 'Evidence', data: { evidence } });
    } catch (error) {
        sendError(res, error, 'listEvidence');
    }
};

const addEvidence = async (req, res) => {
    try {
        const uploaded = await uploadEvidence(req.body.image);
        const evidence = await queries.addEvidence(req.user, orderId(req), { kind: req.body.kind, uploaded });
        res.status(201).json({ success: true, message: 'Uploaded', data: { evidence } });
    } catch (error) {
        sendError(res, error, 'addEvidence');
    }
};

module.exports = {
    listMyOrders,
    listShopOrders,
    actionCount,
    getOrder,
    claimPayment,
    editClaim,
    confirmPayment,
    reportNotReceived,
    markRefunded,
    openDispute,
    updateOrderStatus,
    cancelOrder,
    listMessages,
    postMessage,
    listEvidence,
    addEvidence,
};
