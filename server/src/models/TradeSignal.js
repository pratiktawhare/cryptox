/**
 * TradeSignal.js
 *
 * Schema for AI-generated trade signals (Phase 6).
 * Stored in MongoDB, emitted via Socket.IO, tracked for outcomes (Phase 9).
 */
const mongoose = require('mongoose');

const indicatorSnapshotSchema = new mongoose.Schema({
    rsi:       Number,
    macd:      Number,
    macdTrend: String,
    bbUpper:   Number,
    bbLower:   Number,
    bbSqueeze: Boolean,
    ema8:      Number,
    ema21:     Number,
    ema50:     Number,
    emaTrend:  String,
    adx:       Number,
    stochK:    Number,
    stochD:    Number,
    vwap:      Number,
    atr:       Number,
}, { _id: false });

const smcSnapshotSchema = new mongoose.Schema({
    bias:               String,   // 'bullish' | 'bearish' | 'neutral'
    hasOrderBlocks:     Boolean,
    hasFvg:             Boolean,
    hasLiquiditySweep:  Boolean,
    premiumDiscount:    String,   // 'premium' | 'discount' | 'equilibrium'
}, { _id: false });

const tradeSignalSchema = new mongoose.Schema({
    // Core signal
    symbol:     { type: String, required: true, index: true, uppercase: true },
    action:     { type: String, required: true, enum: ['BUY', 'SELL', 'NO_TRADE'] },
    entry:      { type: Number, default: null },
    stopLoss:   { type: Number, default: null },
    target1:    { type: Number, default: null },
    target2:    { type: Number, default: null },
    leverage:   { type: Number, default: 1, min: 1, max: 100 },
    quantity:   { type: Number, default: 1, min: 0 },
    confidence: { type: Number, required: true, min: 0, max: 100 },
    riskReward: { type: Number, default: null },
    avgVolumeUsdt: { type: Number, default: null },

    // AI reasoning
    reasoning:         { type: String, default: '' },
    smcContext:        { type: String, default: '' },
    invalidationLevel: { type: Number, default: null },
    tradeType:         { type: String, enum: ['scalp', 'swing', 'position'], default: 'scalp' },
    tags:              [{ type: String }],
    timeframe:         { type: String, default: '5m' },

    // Trading mode
    mode: { type: String, enum: ['live', 'paper'], default: 'live' },

    // Snapshots for analytics
    indicatorSnapshot: indicatorSnapshotSchema,
    smcSnapshot:       smcSnapshotSchema,
    patterns:          [{ type: String }],

    // Lifecycle / outcome tracking (Phase 9)
    status:         { type: String, enum: ['pending', 'open', 'hit_tp1', 'hit_tp2', 'hit_sl', 'expired', 'cancelled'], default: 'pending' },
    openedAt:       { type: Date, default: null },
    closedAt:       { type: Date, default: null },
    closePrice:     { type: Number, default: null },
    pnlPct:         { type: Number, default: null },   // % P&L if taken
    pnlUsd:         { type: Number, default: null },
    isWin:          { type: Boolean, default: null },

    // Self-learning feedback
    aiCorrection:   { type: String, default: null },   // next-cycle correction note
    accuracyScore:  { type: Number, default: null },   // 0–100 retrospective score

    // User interaction
    executedByUser: { type: Boolean, default: false },
    userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

}, { timestamps: true });

// Indexes
tradeSignalSchema.index({ status: 1, createdAt: -1 });
tradeSignalSchema.index({ symbol: 1, status: 1, createdAt: -1 });
tradeSignalSchema.index({ mode: 1, action: 1, createdAt: -1 });
tradeSignalSchema.index({ createdAt: -1 });
tradeSignalSchema.index({ confidence: -1 });

module.exports = mongoose.model('TradeSignal', tradeSignalSchema);
