/**
 * AutomationLog.js
 *
 * Records every cycle the AutomationEngine runs (paper or live).
 * Used to build daily performance reports.
 */
const mongoose = require('mongoose');

const automationLogSchema = new mongoose.Schema({
    mode:       { type: String, enum: ['paper', 'live'], required: true },
    date:       { type: String, required: true },   // 'YYYY-MM-DD' IST for daily grouping

    // Cycle outcome
    cycleAction:  { type: String, enum: ['BUY', 'SELL', 'NO_TRADE', 'SKIPPED_BALANCE', 'SKIPPED_DISABLED', 'ERROR'], required: true },
    symbol:       { type: String, default: null },
    confidence:   { type: Number, default: null },
    triesCount:   { type: Number, default: 1 },     // how many coins were tried this cycle

    // Trade details (if a trade was placed)
    entryPrice:   { type: Number, default: null },
    quantity:     { type: Number, default: null },
    marginUsed:   { type: Number, default: null },  // actual margin deducted (USD)
    leverage:     { type: Number, default: null },
    stopLoss:     { type: Number, default: null },
    target1:      { type: Number, default: null },
    riskReward:   { type: Number, default: null },

    // Outcome (filled in later by SignalTracker / AutomationEngine)
    outcome:      { type: String, enum: ['open', 'tp_hit', 'sl_hit', 'trailed_out', 'timeout', 'pending', null], default: 'pending' },
    exitPrice:    { type: Number, default: null },
    pnl:          { type: Number, default: null },  // realised PnL in USD
    pnlPct:       { type: Number, default: null },  // PnL as % of margin

    // References
    signalId:     { type: mongoose.Schema.Types.ObjectId, ref: 'TradeSignal', default: null },
    positionId:   { type: mongoose.Schema.Types.ObjectId, default: null },

    notes:        { type: String, default: '' },
}, { timestamps: true });

// Index for fast daily lookups
automationLogSchema.index({ mode: 1, date: 1 });
automationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AutomationLog', automationLogSchema);
