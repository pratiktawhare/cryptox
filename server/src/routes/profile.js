const express = require('express');
const ApiKey = require('../models/ApiKey');
const User = require('../models/User');
const UserPreferences = require('../models/UserPreferences');
const ExchangeService = require('../services/exchangeService');
const { encryptData } = require('../utils/encryption');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Apply auth middleware to all profile routes
router.use(authMiddleware);

// ═══ API Keys Management ═══

// Get all keys
router.get('/keys', async (req, res) => {
    try {
        const keys = await ApiKey.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json({ keys });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch API keys' });
    }
});

// Add new key
router.post('/keys', async (req, res) => {
    try {
        const { name, exchange = 'delta', apiKey, apiSecret } = req.body;

        if (!name || !apiKey || !apiSecret) {
            return res.status(400).json({ error: 'Name, API Key, and API Secret are required' });
        }

        // Optional: Test the key immediately before saving
        try {
            await ExchangeService.testCredentials(apiKey, apiSecret);
        } catch (testErr) {
            return res.status(400).json({ error: 'Invalid API Keys. Exchange rejected them.' });
        }

        const encKey = encryptData(apiKey);
        const encSecret = encryptData(apiSecret);

        const newKey = await ApiKey.create({
            userId: req.user.id,
            name,
            exchange,
            apiKeyEncrypted: encKey,
            apiSecretEncrypted: encSecret,
            isActive: true, // Auto-activate if tested successfully
            testResult: 'success',
            lastTestedAt: new Date()
        });

        res.status(201).json({ message: 'API Key added successfully', key: newKey });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'You already have a key for this exchange' });
        }
        res.status(500).json({ error: 'Failed to add API key' });
    }
});

// Delete a key
router.delete('/keys/:id', async (req, res) => {
    try {
        const key = await ApiKey.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        if (!key) {
            return res.status(404).json({ error: 'Key not found' });
        }
        res.json({ message: 'API Key deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete API key' });
    }
});

// ═══ Portfolio Sync ═══

// Get wallet balances — returns empty gracefully when no API key
router.get('/portfolio/balances', async (req, res) => {
    try {
        const exchange = new ExchangeService(req.user.id);
        const balances = await exchange.getBalances();
        res.json({ balances });
    } catch (error) {
        // No API key or exchange error — return empty instead of 500
        if (error.message?.includes('No active Delta')) {
            return res.json({ balances: [], noKey: true });
        }
        console.error('Fetch balances error:', error.message);
        res.json({ balances: [], error: error.message });
    }
});

// Get open positions — returns empty gracefully when no API key
router.get('/portfolio/positions', async (req, res) => {
    try {
        const exchange = new ExchangeService(req.user.id);
        const positions = await exchange.getPositions();
        res.json({ positions });
    } catch (error) {
        // No API key or exchange error — return empty instead of 500
        if (error.message?.includes('No active Delta')) {
            return res.json({ positions: [], noKey: true });
        }
        res.json({ positions: [], error: error.message });
    }
});

// ═══ Account Mode (LIVE / PAPER) ═══

// Get current mode
router.get('/mode', async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('accountMode').lean();
        res.json({ mode: user?.accountMode || 'paper' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Switch mode
router.patch('/mode', async (req, res) => {
    try {
        const { mode } = req.body;
        if (!['live', 'paper'].includes(mode)) {
            return res.status(400).json({ error: 'mode must be "live" or "paper"' });
        }
        const user = await User.findByIdAndUpdate(req.user.id, { accountMode: mode }, { new: true });
        res.json({ mode: user.accountMode });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══ User Preferences (including AI Model Configuration) ═══

// Get user preferences
router.get('/preferences', async (req, res) => {
    try {
        let prefs = await UserPreferences.findOne({ userId: req.user.id });
        if (!prefs) {
            prefs = await UserPreferences.create({ userId: req.user.id });
        }
        
        const prefsJson = prefs.toJSON();
        const hasGroqKey = !!prefsJson.groqApiKeyEncrypted;
        const hasDeepseekKey = !!prefsJson.deepseekApiKeyEncrypted;
        
        delete prefsJson.groqApiKeyEncrypted;
        delete prefsJson.deepseekApiKeyEncrypted;
        
        res.json({
            preferences: {
                ...prefsJson,
                hasGroqKey,
                hasDeepseekKey
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch preferences' });
    }
});

// Update user preferences
router.patch('/preferences', async (req, res) => {
    try {
        const { aiProvider, groqApiKey, deepseekApiKey, useCustomGroqKey, useCustomDeepseekKey, riskTolerance, maxLeverage } = req.body;
        
        let prefs = await UserPreferences.findOne({ userId: req.user.id });
        if (!prefs) {
            prefs = await UserPreferences.create({ userId: req.user.id });
        }
        
        if (aiProvider) {
            if (!['groq', 'deepseek'].includes(aiProvider)) {
                return res.status(400).json({ error: 'Invalid AI provider' });
            }
            prefs.aiProvider = aiProvider;
        }
        
        if (groqApiKey !== undefined) {
            if (groqApiKey === '') {
                prefs.groqApiKeyEncrypted = '';
            } else {
                prefs.groqApiKeyEncrypted = encryptData(groqApiKey);
            }
        }
        
        if (deepseekApiKey !== undefined) {
            if (deepseekApiKey === '') {
                prefs.deepseekApiKeyEncrypted = '';
            } else {
                prefs.deepseekApiKeyEncrypted = encryptData(deepseekApiKey);
            }
        }

        if (useCustomGroqKey !== undefined) {
            prefs.useCustomGroqKey = !!useCustomGroqKey;
        }

        if (useCustomDeepseekKey !== undefined) {
            prefs.useCustomDeepseekKey = !!useCustomDeepseekKey;
        }

        if (riskTolerance) {
            prefs.riskTolerance = riskTolerance;
        }

        if (maxLeverage !== undefined) {
            prefs.maxLeverage = maxLeverage;
        }
        
        await prefs.save();
        
        const prefsJson = prefs.toJSON();
        const hasGroqKey = !!prefsJson.groqApiKeyEncrypted;
        const hasDeepseekKey = !!prefsJson.deepseekApiKeyEncrypted;
        
        delete prefsJson.groqApiKeyEncrypted;
        delete prefsJson.deepseekApiKeyEncrypted;
        
        res.json({
            message: 'Preferences updated successfully',
            preferences: {
                ...prefsJson,
                hasGroqKey,
                hasDeepseekKey
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update preferences: ' + error.message });
    }
});

module.exports = router;
