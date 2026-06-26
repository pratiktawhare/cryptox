/**
 * PaperPosition.js
 *
 * Simulated open position in paper trading mode.
 * Created when a paper order is "filled", closed when SL/TP is hit or user closes manually.
 */
const mongoose = require('mongoose');

const paperPositionSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    symbol:     { type: String, required: true, uppercase: true, index: true },
    side:       { type: String, required: true, enum: ['buy', 'sell'] },
    size:       { type: Number, required: true, min: 1 },       // contracts
    entryPrice: { type: Number, required: true },
    leverage:   { type: Number, default: 1, min: 1 },

    // Bracket
    stopLoss:   { type: Number, default: null },
    takeProfit: { type: Number, default: null },

    // Margin
    marginUsed: { type: Number, default: 0 },

    // Live tracking (updated each tick)
    markPrice:    { type: Number, default: null },
    unrealisedPnl: { type: Number, default: 0 },
    roe:          { type: Number, default: 0 },   // % return on margin
    liquidationPrice: { type: Number, default: null },

    // Outcome
    status:      { type: String, enum: ['open', 'closed_tp', 'closed_sl', 'closed_manual'], default: 'open' },
    closePrice:  { type: Number, default: null },
    realisedPnl: { type: Number, default: null },
    closedAt:    { type: Date, default: null },

    // Source
    signalId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TradeSignal', default: null },
    tradeHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'TradeHistory', default: null },

}, { timestamps: true });

paperPositionSchema.index({ userId: 1, status: 1 });
paperPositionSchema.index({ userId: 1, symbol: 1, status: 1 });

module.exports = mongoose.model('PaperPosition', paperPositionSchema);
