const jwt = require('jsonwebtoken');
const config = require('../config/env');

function authMiddleware(req, res, next) {
    const token = req.cookies?.cryptox_token;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        req.user = { id: decoded.id, username: decoded.username };
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }
        return res.status(401).json({ error: 'Invalid token. Please log in again.' });
    }
}

module.exports = authMiddleware;
