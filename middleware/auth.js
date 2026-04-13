const jwt = require('jsonwebtoken');

/**
 * Required auth middleware — rejects request if no valid JWT.
 */
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = header.split(' ')[1];
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { id: payload.id, username: payload.username, email: payload.email };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Optional auth middleware — attaches user if valid JWT present, but doesn't reject.
 */
function optionalAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }

    const token = header.split(' ')[1];
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { id: payload.id, username: payload.username, email: payload.email };
    } catch {
        req.user = null;
    }
    next();
}

module.exports = { requireAuth, optionalAuth };
