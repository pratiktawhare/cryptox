const mongoose = require('mongoose');

const budgetAllocationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    signalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TradeSignal',
        required: true
    },
    coinSymbol:        { type: String, required: true, uppercase: true },
    allocatedAmount:   { type: Number, required: true, min: 0 },
    leverage:          { type: Number, default: 1, min: 1, max: 20 },
    effectivePosition: { type: Number, required: true },
    entryPrice:        { type: Number, required: true },
    liquidationPrice:  Number,
    status:            { type: String, default: 'active', enum: ['active', 'closed'] },
    pnlAmount:         Number,
    closedAt:          Date
}, {
    timestamps: true
});

budgetAllocationSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('BudgetAllocation', budgetAllocationSchema);
