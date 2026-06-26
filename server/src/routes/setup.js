const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const ApiKey = require('../models/ApiKey');
const UserPreferences = require('../models/UserPreferences');
const PaperWallet = require('../models/PaperWallet');
const { hashPassword, encryptData } = require('../utils/encryption');

const router = express.Router();

// GET /api/setup/status — Check if app is initialized
router.get('/status', async (req, res) => {
    try {
        const userCount = await User.countDocuments();
        res.json({ initialized: userCount > 0 });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check setup status' });
    }
});

// POST /api/setup/initialize — First-time setup wizard
router.post('/initialize', async (req, res) => {
    try {
        // Check if already initialized
        const existing = await User.countDocuments();
        if (existing > 0) {
            return res.status(400).json({ error: 'App is already initialized' });
        }

        const {
            username, password,
            apiKey, apiSecret, keyName,
            totalBudget, budgetCurrency, maxLeverage, riskTolerance
        } = req.body;
        // Note: trackedCoins removed — all 50+ coins are always accessible

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // 1. Create user
        const passwordHash = await hashPassword(password);
        const user = await User.create({
            username: username.toLowerCase().trim(),
            passwordHash,
            displayName: username,
            lastLogin: new Date()
        });

        // 2. Encrypt & store API key (if provided)
        if (apiKey && apiSecret) {
            const encKey = encryptData(apiKey);
            const encSecret = encryptData(apiSecret);
            await ApiKey.create({
                userId: user._id,
                name: keyName || 'My Delta Key',
                exchange: 'delta',
                apiKeyEncrypted: encKey,
                apiSecretEncrypted: encSecret,
                isActive: true,
                permissions: 'read'
            });
        }

        // 3. Create preferences
        await UserPreferences.create({
            userId: user._id,
            totalBudget: totalBudget || 0,
            budgetCurrency: budgetCurrency || 'INR',
            maxLeverage: maxLeverage || 10,
            riskTolerance: riskTolerance || 'medium',
        });

        // 4. Create paper wallet (always — safe default)
        await PaperWallet.create({ userId: user._id });

        // 4. Generate JWT and set cookie
        const token = jwt.sign(
            { id: user._id, username: user.username },
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn }
        );

        res.cookie('cryptox_token', token, {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24h
        });

        res.status(201).json({
            message: 'Setup complete! Welcome to CryptoX.',
            user: user.toJSON(),
            token: token
        });

    } catch (error) {
        console.error('Setup error:', error);
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: 'Setup failed: ' + error.message });
    }
});

module.exports = router;
