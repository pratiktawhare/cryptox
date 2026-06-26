const mongoose = require('mongoose');

const preferencesSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        unique: true,
        required: true
    },

    // Budget & Portfolio
    totalBudget:            { type: Number, default: 0, min: 0 },
    budgetCurrency:         { type: String, default: 'INR', enum: ['INR', 'USD'] },
    maxConcurrentPositions: { type: Number, default: 5, min: 1, max: 20 },
    maxSingleTradePct:      { type: Number, default: 30, min: 5, max: 100 },
    minReservePct:          { type: Number, default: 20, min: 0, max: 80 },

    // Leverage
    maxLeverage:            { type: Number, default: 10, min: 1, max: 20 },
    autoLeverageSuggestion: { type: Boolean, default: true },

    // Risk
    riskTolerance:          { type: String, default: 'medium', enum: ['low', 'medium', 'high'] },
    maxRiskPerTradePct:     { type: Number, default: 2.0, min: 0.5, max: 10 },

    // Coins
    trackedCoins:           [{ type: String, trim: true, uppercase: true }],

    // Profit
    profitTargetPct:        { type: Number, default: 2.0, min: 0.5, max: 20 },

    // Scan
    scanFrequency:          { type: String, default: '5m', enum: ['1m', '5m', '15m', 'manual'] },

    // Notifications
    notificationSound:      { type: Boolean, default: true },
    notificationTypes:      {
        type: [String],
        default: ['signal', 'alert', 'system', 'resolved'],
        enum: ['signal', 'alert', 'system', 'resolved']
    },

    // Theme
    theme:                  { type: String, default: 'dark', enum: ['dark', 'light'] },

    // AI Configuration
    aiProvider:             { type: String, default: 'groq', enum: ['groq', 'deepseek'] },
    groqApiKeyEncrypted:    { type: String, default: '' },
    deepseekApiKeyEncrypted:{ type: String, default: '' },
    useCustomGroqKey:       { type: Boolean, default: true },
    useCustomDeepseekKey:   { type: Boolean, default: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('UserPreferences', preferencesSchema);
