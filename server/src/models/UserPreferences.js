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
    useCustomDeepseekKey:   { type: Boolean, default: true },

    // Groq Multi-Key Pool & Model Rotation
    groqKeys: [{
        keyEncrypted:       { type: String, required: true },
        nickname:           { type: String, default: 'Groq Key' },
        createdAt:          { type: Date,   default: Date.now },
        lastUsedAt:         { type: Date,   default: null },
        isActive:           { type: Boolean, default: true }
    }],
    groqRotationIntervalMin:{ type: Number, default: 15, enum: [0, 15, 30, 60] }, // 0 = every call (round-robin), 15 = 15m, 30 = 30m

    // ── Paper Trading Automation (completely independent of live) ─────────────
    paperAuto: {
        enabled:             { type: Boolean, default: false },
        intervalMinutes:     { type: Number,  default: 30,   min: 15, max: 240 },
        estimatedWalletUSD:  { type: Number,  default: 1000, min: 10 },
        tradePct:            { type: Number,  default: 20,   min: 5,  max: 80  }, // % of estimatedWalletUSD → margin per trade
        minConfidence:       { type: Number,  default: 70,   min: 60, max: 95  },
        minLeverage:         { type: Number,  default: 10,   min: 2,  max: 20  },
        maxLeverage:         { type: Number,  default: 20,   min: 2,  max: 20  },
        trailStopLoss:       { type: Boolean, default: true },
        dailyReportEnabled:  { type: Boolean, default: true },
        dailyReportTime:     { type: String,  default: '23:59' }, // HH:MM IST
        lastCycleAt:         { type: Date,    default: null },
        nextCycleAt:         { type: Date,    default: null },
    },

    // ── Live Trading Automation (completely independent of paper) ─────────────
    liveAuto: {
        enabled:             { type: Boolean, default: false },
        intervalMinutes:     { type: Number,  default: 30,   min: 15, max: 240 },
        estimatedWalletUSD:  { type: Number,  default: 1000, min: 10 },
        tradePct:            { type: Number,  default: 20,   min: 5,  max: 80  },
        minConfidence:       { type: Number,  default: 75,   min: 60, max: 95  }, // stricter default for real money
        minLeverage:         { type: Number,  default: 10,   min: 2,  max: 20  },
        maxLeverage:         { type: Number,  default: 20,   min: 2,  max: 20  },
        trailStopLoss:       { type: Boolean, default: true },
        dailyReportEnabled:  { type: Boolean, default: true },
        dailyReportTime:     { type: String,  default: '23:59' },
        lastCycleAt:         { type: Date,    default: null },
        nextCycleAt:         { type: Date,    default: null },
    },
}, {
    timestamps: true
});

module.exports = mongoose.model('UserPreferences', preferencesSchema);
