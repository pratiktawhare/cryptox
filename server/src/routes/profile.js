const express = require('express');
const ApiKey = require('../models/ApiKey');
const User = require('../models/User');
const UserPreferences = require('../models/UserPreferences');
const ExchangeService = require('../services/exchangeService');
const { encryptData, decryptData } = require('../utils/encryption');
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
            return res.status(400).json({ error: testErr.message || 'Invalid API Keys. Exchange rejected them.' });
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
function maskEncryptedKey(encrypted) {
    try {
        const raw = decryptData(encrypted);
        if (!raw || raw.length < 8) return '••••••••';
        return `${raw.substring(0, 4)}••••${raw.slice(-4)}`;
    } catch (e) {
        return '••••••••';
    }
}

function sanitizePrefs(prefs) {
    const prefsJson = prefs.toJSON ? prefs.toJSON() : { ...prefs };
    const hasGroqKey = !!prefsJson.groqApiKeyEncrypted || (prefsJson.groqKeys && prefsJson.groqKeys.length > 0);
    const hasDeepseekKey = !!prefsJson.deepseekApiKeyEncrypted;

    delete prefsJson.groqApiKeyEncrypted;
    delete prefsJson.deepseekApiKeyEncrypted;

    if (Array.isArray(prefsJson.groqKeys)) {
        prefsJson.groqKeys = prefsJson.groqKeys.map(k => ({
            _id: k._id,
            nickname: k.nickname || 'Groq Key',
            maskedKey: maskEncryptedKey(k.keyEncrypted),
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt,
            isActive: k.isActive !== false,
        }));
    } else {
        prefsJson.groqKeys = [];
    }

    return {
        ...prefsJson,
        hasGroqKey,
        hasDeepseekKey
    };
}

router.get('/preferences', async (req, res) => {
    try {
        let prefs = await UserPreferences.findOne({ userId: req.user.id }) || await UserPreferences.findOne({});
        if (!prefs) {
            prefs = await UserPreferences.create({ userId: req.user.id });
        }

        // Auto-migrate legacy groqApiKeyEncrypted if groqKeys is empty
        if (prefs.groqApiKeyEncrypted && (!prefs.groqKeys || prefs.groqKeys.length === 0)) {
            prefs.groqKeys = [{
                keyEncrypted: prefs.groqApiKeyEncrypted,
                nickname: 'Primary Key',
                createdAt: new Date(),
                isActive: true
            }];
            await prefs.save();
        }

        res.json({ preferences: sanitizePrefs(prefs) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch preferences' });
    }
});

// Update user preferences
router.patch('/preferences', async (req, res) => {
    try {
        const { aiProvider, groqApiKey, deepseekApiKey, useCustomGroqKey, useCustomDeepseekKey, riskTolerance, maxLeverage, groqRotationIntervalMin } = req.body;
        
        let prefs = await UserPreferences.findOne({ userId: req.user.id }) || await UserPreferences.findOne({});
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

        if (groqRotationIntervalMin !== undefined) {
            prefs.groqRotationIntervalMin = parseInt(groqRotationIntervalMin);
        }
        
        await prefs.save();
        
        res.json({
            message: 'Preferences updated successfully',
            preferences: sanitizePrefs(prefs)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update preferences: ' + error.message });
    }
});

// ═══ Groq Multi-Key Pool ═══

// GET /api/profile/groq-keys
router.get('/groq-keys', async (req, res) => {
    try {
        let prefs = await UserPreferences.findOne({ userId: req.user.id }) || await UserPreferences.findOne({});
        if (!prefs) prefs = await UserPreferences.create({ userId: req.user.id });

        const keys = (prefs.groqKeys || []).map(k => ({
            _id: k._id,
            nickname: k.nickname || 'Groq Key',
            maskedKey: maskEncryptedKey(k.keyEncrypted),
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt,
            isActive: k.isActive !== false,
        }));

        res.json({
            keys,
            rotationIntervalMin: prefs.groqRotationIntervalMin !== undefined ? prefs.groqRotationIntervalMin : 15
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch Groq keys: ' + err.message });
    }
});

// POST /api/profile/groq-keys — add new key
router.post('/groq-keys', async (req, res) => {
    try {
        const { apiKey, nickname } = req.body;
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
            return res.status(400).json({ error: 'Valid Groq API key is required' });
        }

        let prefs = await UserPreferences.findOne({ userId: req.user.id }) || await UserPreferences.findOne({});
        if (!prefs) prefs = await UserPreferences.create({ userId: req.user.id });

        const trimmedKey = apiKey.trim();
        const encrypted = encryptData(trimmedKey);

        const newKey = {
            keyEncrypted: encrypted,
            nickname: (nickname && nickname.trim()) ? nickname.trim() : `Groq Key #${(prefs.groqKeys?.length || 0) + 1}`,
            createdAt: new Date(),
            isActive: true
        };

        if (!Array.isArray(prefs.groqKeys)) prefs.groqKeys = [];
        prefs.groqKeys.push(newKey);
        await prefs.save();

        const formattedKeys = prefs.groqKeys.map(k => ({
            _id: k._id,
            nickname: k.nickname,
            maskedKey: maskEncryptedKey(k.keyEncrypted),
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt,
            isActive: k.isActive !== false,
        }));

        res.status(201).json({
            message: 'Groq API key added successfully',
            keys: formattedKeys,
            rotationIntervalMin: prefs.groqRotationIntervalMin !== undefined ? prefs.groqRotationIntervalMin : 15
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add Groq key: ' + err.message });
    }
});

// DELETE /api/profile/groq-keys/:id — delete a key
router.delete('/groq-keys/:id', async (req, res) => {
    try {
        let prefs = await UserPreferences.findOne({ userId: req.user.id }) || await UserPreferences.findOne({});
        if (!prefs) return res.status(404).json({ error: 'Preferences not found' });

        const keyId = req.params.id;
        prefs.groqKeys = (prefs.groqKeys || []).filter(k => String(k._id) !== String(keyId));
        await prefs.save();

        const formattedKeys = prefs.groqKeys.map(k => ({
            _id: k._id,
            nickname: k.nickname,
            maskedKey: maskEncryptedKey(k.keyEncrypted),
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt,
            isActive: k.isActive !== false,
        }));

        res.json({
            message: 'Groq API key removed',
            keys: formattedKeys,
            rotationIntervalMin: prefs.groqRotationIntervalMin !== undefined ? prefs.groqRotationIntervalMin : 15
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete Groq key: ' + err.message });
    }
});

// PATCH /api/profile/groq-keys/:id/toggle — toggle active
router.patch('/groq-keys/:id/toggle', async (req, res) => {
    try {
        let prefs = await UserPreferences.findOne({ userId: req.user.id }) || await UserPreferences.findOne({});
        if (!prefs) return res.status(404).json({ error: 'Preferences not found' });

        const key = (prefs.groqKeys || []).find(k => String(k._id) === String(req.params.id));
        if (!key) return res.status(404).json({ error: 'Key not found' });

        key.isActive = !key.isActive;
        await prefs.save();

        const formattedKeys = prefs.groqKeys.map(k => ({
            _id: k._id,
            nickname: k.nickname,
            maskedKey: maskEncryptedKey(k.keyEncrypted),
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt,
            isActive: k.isActive !== false,
        }));

        res.json({
            message: `Key ${key.isActive ? 'activated' : 'paused'}`,
            keys: formattedKeys,
            rotationIntervalMin: prefs.groqRotationIntervalMin !== undefined ? prefs.groqRotationIntervalMin : 15
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle key: ' + err.message });
    }
});

// PATCH /api/profile/groq-rotation — update rotation interval
router.patch('/groq-rotation', async (req, res) => {
    try {
        const { intervalMin } = req.body;
        let prefs = await UserPreferences.findOne({ userId: req.user.id }) || await UserPreferences.findOne({});
        if (!prefs) prefs = await UserPreferences.create({ userId: req.user.id });

        const interval = parseInt(intervalMin);
        if ([0, 15, 30, 60].includes(interval)) {
            prefs.groqRotationIntervalMin = interval;
            await prefs.save();
        }

        res.json({
            message: 'Rotation interval updated',
            rotationIntervalMin: prefs.groqRotationIntervalMin
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update rotation: ' + err.message });
    }
});

module.exports = router;
