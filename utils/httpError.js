// utils/httpError.js - Errors that carry an HTTP status, and one way to send them
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sendError = (res, error, context) => {
    if (error instanceof HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error(`${context} error:`, error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

module.exports = { HttpError, sendError };
