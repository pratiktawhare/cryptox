/**
 * BotTrade.js
 *
 * Complete record of every trade executed by TradingBot.
 * Separate from existing TradeHistory (which covers manual + AutomationEngine trades).
 *
 * Tracks gross vs net PnL so fees/funding/slippage are always visible.
 */

const mongoose = require('mongoose');

const botTradeSchema = new mongoose.Schema(
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

        // ── Symbol & Direction ──────────────────────────────────────────────
        symbol: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
        },

        direction: {
            type: String,
            enum: ['long', 'short'],
            required: true,
        },

        // ── Prices ─────────────────────────────────────────────────────────
        entryPrice:        { type: Number, required: true },
        exitPrice:         { type: Number, default: null },
        stopLoss:          { type: Number, required: true },
        stopLossTrigger:   { type: Number, default: null },
        takeProfit:        { type: Number, required: true },
        takeProfitTrigger: { type: Number, default: null },

        // ── Position details ────────────────────────────────────────────────
        quantity:      { type: Number, required: true },  // contracts
        contractValue: { type: Number, default: 1 },     // multiplier from ProductCatalog
        leverage:      { type: Number, required: true },
        margin:        { type: Number, required: true },  // USDT margin used

        // ── PnL breakdown ───────────────────────────────────────────────────
        grossPnl:    { type: Number, default: null },  // before fees/funding
        fees:        { type: Number, default: 0 },     // entry + exit fees
        fundingCost: { type: Number, default: 0 },     // funding paid/received
        slippage:    { type: Number, default: 0 },     // estimated slippage
        netPnl:      { type: Number, default: null },  // grossPnl - fees - funding - slippage

        // ── Timing ─────────────────────────────────────────────────────────
        entryTime:       { type: Date, required: true },
        exitTime:        { type: Date, default: null },
        durationSeconds: { type: Number, default: null },

        // ── Result ─────────────────────────────────────────────────────────
        result: {
            type: String,
            enum: ['win', 'loss', 'breakeven', 'open', 'cancelled', 'pending_entry'],
            default: 'open',
        },

        exitReason: {
            type: String,
            enum: ['take_profit', 'stop_loss', 'breakeven', 'manual', 'manual_close', 'emergency', 'user_emergency_stop', 'timeout', 'entry_timeout', 'smart_loss_guard', 'cancelled', null],
            default: null,
        },

        // ── Exchange Order IDs ──────────────────────────────────────────────
        // null for paper mode
        entryOrderId: { type: String, default: null },
        tpOrderId:    { type: String, default: null },
        slOrderId:    { type: String, default: null },

        // ── Breakeven Stop Loss Tracking ────────────────────────────────────
        breakevenMoved:          { type: Boolean, default: false },
        breakevenMovedAt:        { type: Date, default: null },
        breakevenTriggeredCount: { type: Number, default: 0 },

        // ── Pending Limit Entry Tracking ────────────────────────────────────
        // Used when the bot places a limit order and waits for fill
        pendingEntryOrderId: { type: String, default: null },
        entryOrderStatus: {
            type: String,
            enum: ['pending', 'filled', 'cancelled', 'timeout', null],
            default: null,
        },
        entryOrderPlacedAt: { type: Date, default: null },

        // ── Signal context ──────────────────────────────────────────────────
        signalScore: { type: Number, default: null },
        regime:      { type: String, default: null },

        // ── Budget snapshot at entry (for audit) ────────────────────────────
        walletBalanceAtEntry:  { type: Number, default: null },
        effectiveBudgetAtEntry: { type: Number, default: null },

        // ── Strategy Direction Mode ─────────────────────────────────────────
        reverseMode: { type: Boolean, default: false },
    },
    {
        timestamps: true,
    }
);

botTradeSchema.index({ userId: 1, mode: 1, createdAt: -1 });
botTradeSchema.index({ userId: 1, mode: 1, result: 1 });
botTradeSchema.index({ userId: 1, mode: 1, symbol: 1 });

module.exports = mongoose.model('BotTrade', botTradeSchema);
