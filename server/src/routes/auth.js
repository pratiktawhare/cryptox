const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const { verifyPassword } = require('../utils/encryption');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Find user
        const user = await User.findOne({ username: username.toLowerCase().trim() });
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Verify password
        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate JWT
        const token = jwt.sign(
            { id: user._id, username: user.username },
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn }
        );

        res.cookie('cryptox_token', token, {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000
        });

        res.json({
            message: 'Login successful',
            user: user.toJSON()
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.clearCookie('cryptox_token');
    res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me — Get current user
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: user.toJSON() });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

module.exports = router;
