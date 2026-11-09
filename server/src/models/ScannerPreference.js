/**
 * ScannerPreference.js
 *
 * Mongoose model storing user configuration for the MCdynamic Universal Scanner:
 *   - Preferred timeframe (default: 4H)
 *   - Auto-scan interval (manual, 15m, 30m, 1h, 4h)
 *   - Trigger Difference / Confirmation Buffer %
 *   - Auto-trade settings (mode, leverage, allocation, SL/TP preferences)
 */

const mongoose = require('mongoose');

const scannerPreferenceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true,
    },
    timeframe: {
        type: String,
        enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
        default: '4h',
    },
    interval: {
        type: String,
        enum: ['manual', '5m', '15m', '30m', '1h', '4h'],
        default: '1h',
    },
    fastPeriod: {
        type: Number,
        default: 14,
        min: 2,
        max: 100,
    },
    slowPeriod: {
        type: Number,
        default: 50,
        min: 5,
        max: 200,
    },
    triggerDiffPct: {
        type: Number,
        default: 0.10, // 0.10% spread confirmation buffer
        min: 0,
        max: 5,
    },
    autoTradeMode: {
        type: String,
        enum: ['off', 'paper', 'live'],
        default: 'off',
    },
    maxLeverage: {
        type: Number,
        default: 3,
        min: 1,
        max: 20,
    },
    tradeAllocationUsdt: {
        type: Number,
        default: 100,
        min: 10,
        max: 50000,
    },
    takeProfitMode: {
        type: String,
        enum: ['rr', 'atr', 'fixed_pct'],
        default: 'rr',
    },
    takeProfitValue: {
        type: Number,
        default: 2.0, // 1:2.0 R:R or 2x ATR
    },
    stopLossMode: {
        type: String,
        enum: ['mc50_trailing', 'atr', 'fixed_pct'],
        default: 'mc50_trailing', // Follows the MC50 line as dynamic trailing stop
    },
    stopLossValue: {
        type: Number,
        default: 1.5, // 1.5x ATR if ATR mode
    },
    filterZeroVolume: {
        type: Boolean,
        default: true,
    },
    favoriteCoins: [{
        type: String,
        uppercase: true,
        trim: true,
    }],
}, {
    timestamps: true,
});

module.exports = mongoose.model('ScannerPreference', scannerPreferenceSchema);

