/**
 * BotEvent.js
 *
 * Structured event log for TradingBot.
 * Every significant action, decision, or error is recorded here.
 * Used for audit trail, debugging, and the dashboard event feed.
 *
 * Critical events also trigger in-app notifications via NotificationService.
 */

const mongoose = require('mongoose');

// All possible event types
const BOT_EVENT_TYPES = [
    // Lifecycle
    'BOT_STARTED',
    'BOT_STOPPED',
    'BOT_RESTORED',        // restored from DB after server restart

    // Scan cycle
    'SCAN_STARTED',
    'SCAN_COMPLETE',
    'NO_AFFORDABLE_SYMBOLS',   // wallet too low for any symbol
    'NO_SIGNAL_FOUND',         // scan ran but no symbol met minScore

    // Signals
    'SIGNAL_GENERATED',
    'TRADE_REJECTED',          // signal met score but rejected by cost/risk engine

    // Execution
    'ORDER_SUBMITTED',
    'ORDER_FILLED',
    'ORDER_CANCELLED',
    'ORDER_TIMEOUT',           // fill not confirmed within timeout
    'TP_PLACED',
    'SL_PLACED',
    'PROTECTION_FAILED',       // TP or SL failed to place → emergency close

    // Position lifecycle
    'POSITION_OPENED',
    'POSITION_CLOSED',
    'POSITION_CLOSED_TP',
    'POSITION_CLOSED_SL',
    'POSITION_CLOSED_EMERGENCY',
    'POSITION_CLOSED_SMART_GUARD',
    'SMART_LOSS_GUARD',
    'POSITION_GUARD_SAFE',
    'POSITION_GUARD_DROP',
    'BREAKEVEN_SL_MOVED',
    'POSITION_BREAKEVEN_PENDING',

    // Breakout Straddle Strategy
    'SQUEEZE_DETECTED',
    'TRIPWIRE_ARMED',
    'BREAKOUT_TRIGGERED',
    'TRIPWIRE_EXPIRED',

    // Risk limits
    'DAILY_LIMIT_REACHED',
    'CONSECUTIVE_LOSS_LIMIT',
    'COOLDOWN_ACTIVE',

    // Kill switch
    'KILL_SWITCH_TRIGGERED',
    'EMERGENCY_STOP',

    // WebSocket
    'WEBSOCKET_DISCONNECTED',
    'WEBSOCKET_RECONNECTED',
    'MARKET_DATA_STALE',

    // Reconciliation (live only)
    'RECONCILIATION_STARTED',
    'RECONCILIATION_DONE',
    'STATE_MISMATCH',          // bot state ≠ Delta state → paused to reconcile

    // Groq AI
    'AI_ANALYSIS_STARTED',
    'AI_ANALYSIS_COMPLETED',
    'AI_ANALYSIS_FAILED',
    'AI_RATE_LIMITED',
    'AI_ANALYSIS_STALE',       // analysis too old and aiRequired=true → paused

    // API / system errors
    'API_ERROR',
    'SYSTEM_ERROR',
];

const botEventSchema = new mongoose.Schema(
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

        type: {
            type: String,
            enum: BOT_EVENT_TYPES,
            required: true,
        },

        severity: {
            type: String,
            enum: ['info', 'warn', 'error', 'critical'],
            default: 'info',
        },

        message: {
            type: String,
            required: true,
            maxlength: 1000,
        },

        // Flexible JSON payload for event-specific context
        // e.g. { symbol, price, orderId, reason, score, balance, ... }
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        timestamp: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: false, // using custom timestamp field
    }
);

botEventSchema.index({ userId: 1, mode: 1, timestamp: -1 });
botEventSchema.index({ userId: 1, mode: 1, type: 1 });
botEventSchema.index({ userId: 1, severity: 1, timestamp: -1 });

// Auto-expire old info events after 30 days to keep collection lean
botEventSchema.index(
    { timestamp: 1 },
    { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { severity: 'info' } }
);

module.exports = mongoose.model('BotEvent', botEventSchema);
module.exports.BOT_EVENT_TYPES = BOT_EVENT_TYPES;
