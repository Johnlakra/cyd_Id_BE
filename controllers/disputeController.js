// controllers/disputeController.js - Admin dispute queue
const lifecycle = require('../services/orderLifecycle');
const queries = require('../services/orderQueries');
const { sendError } = require('../utils/httpError');

const listDisputes = async (req, res) => {
    try {
        const disputes = await queries.listDisputesForAdmin(req.query.status);
        res.json({ success: true, message: 'Disputes retrieved', data: { disputes } });
    } catch (error) {
        sendError(res, error, 'listDisputes');
    }
};

const resolveDispute = async (req, res) => {
    try {
        await lifecycle.resolveDispute(req.user, Number(req.params.id), {
            resolution: req.body.resolution,
            note: req.body.note,
        });
        res.json({ success: true, message: 'Dispute resolved' });
    } catch (error) {
        sendError(res, error, 'resolveDispute');
    }
};

module.exports = { listDisputes, resolveDispute };
