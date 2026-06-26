/**
 * PaperWallet.js
 *
 * Virtual wallet for paper trading mode.
 * One document per user — tracks simulated USDT balance.
 */
const mongoose = require('mongoose');

const paperWalletSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    balance:    { type: Number, default: 10000 },  // Starting USDT balance
    equity:     { type: Number, default: 10000 },  // balance + unrealised PnL
    available:  { type: Number, default: 10000 },  // free margin
    used:       { type: Number, default: 0 },       // margin locked in positions

    // Performance tracking
    startingBalance: { type: Number, default: 10000 },
    totalRealised:   { type: Number, default: 0 },
    totalWins:       { type: Number, default: 0 },
    totalLosses:     { type: Number, default: 0 },
    totalTrades:     { type: Number, default: 0 },
    peakEquity:      { type: Number, default: 10000 },
    maxDrawdown:     { type: Number, default: 0 },  // %

}, { timestamps: true });

// Compute win rate virtual
paperWalletSchema.virtual('winRate').get(function () {
    if (this.totalTrades === 0) return 0;
    return parseFloat(((this.totalWins / this.totalTrades) * 100).toFixed(1));
});

// Compute total return %
paperWalletSchema.virtual('returnPct').get(function () {
    if (this.startingBalance === 0) return 0;
    return parseFloat((((this.equity - this.startingBalance) / this.startingBalance) * 100).toFixed(2));
});

paperWalletSchema.set('toJSON', { virtuals: true });
paperWalletSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('PaperWallet', paperWalletSchema);
