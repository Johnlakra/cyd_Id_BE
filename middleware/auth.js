// middleware/auth.js - Authentication middleware
const jwt = require('jsonwebtoken');
const { queryOne } = require('../config/database');

// Verify JWT token middleware
const authenticateToken = async (req, res, next) => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access token required'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const user = await queryOne(
            'SELECT id, username, email, role, diocese_id, platform_role FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token - user not found'
            });
        }

        // Add user to request object. Tenant resolution: DB row wins over the
        // JWT claim; rows/tokens predating the platform migration resolve to
        // diocese 1 (Jalandhar) so legacy behavior is unchanged.
        req.user = user;
        req.dioceseId = user.diocese_id || decoded.diocese_id || 1;
        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }

        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication error'
        });
    }
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }
    next();
};

// Check if user is a platform super admin (above diocese admin).
// platform_role is an additive column; legacy users default to 'none'.
const requireSuperAdmin = (req, res, next) => {
    if (!req.user || req.user.platform_role !== 'super_admin') {
        return res.status(403).json({
            success: false,
            message: 'Super admin access required'
        });
    }
    next();
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await queryOne(
                'SELECT id, username, email, role, diocese_id FROM users WHERE id = ?',
                [decoded.userId]
            );

            if (user) {
                req.user = user;
                req.dioceseId = user.diocese_id || decoded.diocese_id || 1;
            }
        }
        
        next();
    } catch (error) {
        // Continue without authentication if token is invalid
        next();
    }
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requireSuperAdmin,
    optionalAuth
};