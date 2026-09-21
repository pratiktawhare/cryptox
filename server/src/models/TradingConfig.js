/**
 * TradingConfig.js
 *
 * Stores TradingBot configuration per user per mode (paper | live).
 * One document per (userId, mode) pair.
 *
 * Key design:
 *   - budgetUSDT: free number, no min/no max — user sets manually
 *   - effectiveBudget at runtime = min(budgetUSDT, actualAvailableBalance)
 *   - All % fields operate on effectiveBudget, not total wallet
 */

const mongoose = require('mongoose');

const tradingConfigSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        // 'paper' or 'live' — one document per mode
        mode: {
            type: String,
            enum: ['paper', 'live'],
            required: true,
        },

        // ── Budget ──────────────────────────────────────────────────────────
        // Free number input — no min/max restriction.
        // Runtime: effectiveBudget = min(budgetUSDT, actualAvailableBalance)
        budgetUSDT: {
            type: Number,
            required: true,
            default: 10,
        },

        // ── Risk Settings ───────────────────────────────────────────────────
        // % of effectiveBudget risked per trade
        riskPerTradePct: {
            type: Number,
            default: 5,
        },

        // % of effectiveBudget — stop opening new trades for the day
        maxDailyLossPct: {
            type: Number,
            default: 10,
        },

        // Stop opening new trades after N consecutive losses
        maxConsecutiveLosses: {
            type: Number,
            default: 3,
        },

        // Seconds to wait after a trade closes before next entry
        cooldownSeconds: {
            type: Number,
            default: 60,
        },

        // Minimum net reward/risk ratio required to take a trade
        // Default 0.05: Allows high-win-rate scalping with wide SL and targeted ROI
        minRewardRisk: {
            type: Number,
            default: 0.05,
        },

        // Minimum signal score (out of 8) required to enter
        // Paper default: 5, Live default: 6
        minSignalScore: {
            type: Number,
            default: 5,
        },

        // ── Target ROI & High Win-Rate Scalping ─────────────────────────────
        // Target expected Net ROI % on margin per trade (e.g. 5 = 5% ROI on margin)
        // Used to dynamically set take-profit price targeting high win rate after exchange fees
        targetRoiPct: {
            type: Number,
            default: 5,
            min: 0.5,
            max: 100,
        },

        // ── Position Sizing ─────────────────────────────────────────────────
        // SL = entry ± (ATR × slAtrMultiplier)
        // Wide SL default: 5.0x ATR with safety liquidation buffer (noise immune)
        slAtrMultiplier: {
            type: Number,
            default: 5.0,
        },

        // TP safety: ensure TP > breakEvenCost × tpSafetyMultiplier
        tpSafetyMultiplier: {
            type: Number,
            default: 2.0,
        },

        // Maximum leverage the bot is allowed to use
        // Default: 20x margin
        maxLeverage: {
            type: Number,
            default: 20,
        },

        // Max simultaneous open positions (default 5 concurrent trades)
        maxOpenPositions: {
            type: Number,
            default: 5,
        },

        // ── Scan Settings ───────────────────────────────────────────────────
        // How often to scan all symbols for setups (minutes)
        scanIntervalMinutes: {
            type: Number,
            default: 5,
        },

        // ── Groq AI Settings ────────────────────────────────────────────────
        // Whether to use Groq for market regime analysis
        aiEnabled: {
            type: Boolean,
            default: true,
        },

        // If true — bot stops opening trades when AI analysis is stale/unavailable
        // If false — bot continues with deterministic TA when Groq fails
        aiRequired: {
            type: Boolean,
            default: false,
        },

        // How often to call Groq for market regime analysis (seconds)
        aiIntervalSeconds: {
            type: Number,
            default: 1800, // 30 minutes
        },

        // ── State ───────────────────────────────────────────────────────────
        // Whether this mode is currently enabled (persisted across restarts)
        enabled: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index: one config per (userId, mode)
tradingConfigSchema.index({ userId: 1, mode: 1 }, { unique: true });

module.exports = mongoose.model('TradingConfig', tradingConfigSchema);
