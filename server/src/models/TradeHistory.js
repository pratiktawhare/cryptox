/**
 * TradeHistory.js
 *
 * Records every order placed through CryptoX — both attempted and executed.
 * Used for: P&L calculation, analytics (Phase 9), and audit trail.
 */
const mongoose = require('mongoose');

const tradeHistorySchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Delta Exchange order identifiers
    orderId:    { type: String, default: null, index: true },  // Delta order_id if placed
    clientOrderId: { type: String, default: null },

    // Order details
    symbol:     { type: String, required: true, uppercase: true, index: true },
    side:       { type: String, required: true, enum: ['buy', 'sell'] },
    orderType:  { type: String, required: true, enum: ['market_order', 'limit_order'] },
    size:       { type: Number, required: true, min: 1 },         // contracts
    price:      { type: Number, default: null },                   // limit price (null for market)
    leverage:   { type: Number, default: 1, min: 1, max: 200 },

    // Bracket (SL / TP)
    stopLoss:   { type: Number, default: null },
    takeProfit: { type: Number, default: null },

    // Execution
    status:     { type: String, enum: ['pending', 'open', 'filled', 'cancelled', 'rejected', 'failed'], default: 'pending' },
    filledPrice:   { type: Number, default: null },
    filledAt:      { type: Date, default: null },
    filledSize:    { type: Number, default: null },
    commission:    { type: Number, default: null },  // USDT

    // P&L (filled in when closed)
    closedAt:      { type: Date, default: null },
    closePrice:    { type: Number, default: null },
    realisedPnl:   { type: Number, default: null },
    pnlPct:        { type: Number, default: null },
    isWin:         { type: Boolean, default: null },

    // Source
    mode:        { type: String, enum: ['live', 'paper'], default: 'live' },
    signalId:    { type: mongoose.Schema.Types.ObjectId, ref: 'TradeSignal', default: null },
    source:      { type: String, enum: ['signal', 'manual', 'paper'], default: 'signal' },

    // Error (if failed)
    errorMessage: { type: String, default: null },
    rawResponse:  { type: mongoose.Schema.Types.Mixed, default: null },

}, { timestamps: true });

// Indexes for fast queries
tradeHistorySchema.index({ userId: 1, status: 1, createdAt: -1 });
tradeHistorySchema.index({ userId: 1, symbol: 1, createdAt: -1 });
tradeHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model('TradeHistory', tradeHistorySchema);
