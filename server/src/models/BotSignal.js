/**
 * BotSignal.js
 *
 * Log of every signal evaluation by TradingBot — whether traded or not.
 * Stores all indicator values, regime, score, and decision reason.
 * Used for post-analysis, debugging, and backtest comparison.
 */

const mongoose = require('mongoose');

const botSignalSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        mode: {
            type: String,
            enum: ['paper', 'live'],
            required: true,
        },

        // ── Symbol & Timing ─────────────────────────────────────────────────
        symbol:    { type: String, required: true, uppercase: true },
        timestamp: { type: Date,   required: true },

        // ── Signal Output ───────────────────────────────────────────────────
        direction: {
            type: String,
            enum: ['long', 'short', null],
            default: null,
        },

        score: { type: Number, default: 0 }, // 0–8
        maxScore: { type: Number, default: 8 },
        conditions: { type: mongoose.Schema.Types.Mixed, default: {} },

        // ── 1-minute Indicators ─────────────────────────────────────────────
        ema9_1m:     { type: Number, default: null },
        ema21_1m:    { type: Number, default: null },
        rsi_1m:      { type: Number, default: null },
        momentum_1m: { type: Number, default: null },
        close_1m:    { type: Number, default: null },

        // ── 5-minute Indicators ─────────────────────────────────────────────
        ema9_5m:      { type: Number, default: null },
        ema21_5m:     { type: Number, default: null },
        ema21Slope_5m:{ type: Number, default: null }, // positive = uptrend
        rsi_5m:       { type: Number, default: null },
        atr_5m:       { type: Number, default: null },
        volumeRatio:  { type: Number, default: null }, // current vol / avg vol
        close_5m:     { type: Number, default: null },

        // ── Market Context ──────────────────────────────────────────────────
        spread:      { type: Number, default: null }, // bid-ask spread
        fundingRate: { type: Number, default: null },

        // ── Regime ─────────────────────────────────────────────────────────
        regime: {
            type: String,
            enum: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'UNCERTAIN', null],
            default: null,
        },

        // ── Groq AI context (if available) ──────────────────────────────────
        groqRegime:      { type: String, default: null },
        groqConfidence:  { type: Number, default: null },
        groqRiskAdj:     { type: Number, default: 1.0 }, // multiplier from AI

        // ── Decision ───────────────────────────────────────────────────────
        decision: {
            type: String,
            enum: ['TRADE', 'REJECT', 'NO_SETUP', 'SKIPPED_BUDGET', 'SKIPPED_COST', 'SKIPPED_RISK', 'SKIPPED_OPEN_POSITION', 'SKIPPED_COOLDOWN'],
            required: true,
        },

        rejectReason: { type: String, default: null },

        // ── Affordability context ───────────────────────────────────────────
        walletBalance:      { type: Number, default: null },
        effectiveBudget:    { type: Number, default: null },
        affordableSymbols:  { type: Number, default: null }, // how many passed filter
        totalScanned:       { type: Number, default: null },

        // ── Link to trade (if TRADE decision) ───────────────────────────────
        botTradeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'BotTrade',
            default: null,
        },

        // ── Strategy Direction Mode ─────────────────────────────────────────
        reverseMode: { type: Boolean, default: false },
    },
    {
        timestamps: true,
    }
);

botSignalSchema.index({ userId: 1, mode: 1, createdAt: -1 });
botSignalSchema.index({ userId: 1, mode: 1, decision: 1 });
botSignalSchema.index({ userId: 1, symbol: 1 });

module.exports = mongoose.model('BotSignal', botSignalSchema);
