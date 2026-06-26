const mongoose = require('mongoose');

const paperOrderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    symbol: {
        type: String,
        required: true,
        trim: true,
        uppercase: true
    },
    side: {
        type: String,
        required: true,
        enum: ['buy', 'sell']
    },
    size: {
        type: Number,
        required: true,
        min: 1
    },
    orderType: {
        type: String,
        required: true,
        enum: ['limit_order', 'market_order']
    },
    price: {
        type: Number,
        required: function() { return this.orderType === 'limit_order'; }
    },
    stopLoss: {
        type: Number,
        default: null
    },
    takeProfit: {
        type: Number,
        default: null
    },
    leverage: {
        type: Number,
        default: 1
    },
    status: {
        type: String,
        required: true,
        enum: ['open', 'filled', 'cancelled'],
        default: 'open'
    },
    signalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TradeSignal',
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('PaperOrder', paperOrderSchema);
