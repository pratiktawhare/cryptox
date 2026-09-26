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

        // ── Wallet Balance Split (Parts) ────────────────────────────────────
        // Divides effective budget into N parts to size each trade's margin.
        // E.g. $10 budget / 2 parts = ~$5 margin per trade.
        // With 20x leverage = ~$100 overall trade notional size.
        walletParts: {
            type: Number,
            default: 2,
            min: 1,
            max: 50,
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

        // ── Strategy Selection ──────────────────────────────────────────────
        // 'trend_pullback'    = Buys pullbacks at EMA9 support during active trends (default)
        // 'breakout_straddle' = Arms dual tripwires around tight ranges, trades volatility expansion
        // 'radar_fleet'       = Event-driven multi-asset armada. Arms up to 15-20 coiled coins simultaneously
        // 'adaptive_hybrid'   = Auto-selects based on market regime (pullback on trends, radar fleet on squeeze)
        strategyType: {
            type: String,
            enum: ['trend_pullback', 'breakout_straddle', 'radar_fleet', 'adaptive_hybrid'],
            default: 'trend_pullback',
        },

        // ── Breakout Straddle & Radar Fleet Parameters ───────────────────────
        // Maximum number of coiled symbols to arm simultaneously in the radar fleet (default: 15)
        breakoutMaxArmedFleet: {
            type: Number,
            default: 15,
            min: 3,
            max: 30,
        },

        // Cooldown spacing (seconds) between consecutive breakout executions across the fleet (prevents flash-crash avalanches)
        breakoutThrottleSeconds: {
            type: Number,
            default: 15,
            min: 5,
            max: 120,
        },

        // Minimum 24h trading volume in USDT to qualify for candidate pool (filters illiquid slippage)
        breakoutMin24hVolumeUSDT: {
            type: Number,
            default: 50000,
            min: 0,
        },

        // Minimum consecutive 5m candles in a squeeze before arming tripwires (crypto default: 2 bars)
        breakoutSqueezeBars: {
            type: Number,
            default: 2,
            min: 1,
            max: 20,
        },

        // Keltner Channel multiplier for squeeze detection (2.0 is standard for crypto derivatives)
        breakoutKcMultiplier: {
            type: Number,
            default: 2.0,
            min: 1.0,
            max: 3.0,
        },

        // Maximum Bollinger Bandwidth (e.g. 0.015 = 1.5%) to count as volatility compression
        breakoutMaxBandwidth: {
            type: Number,
            default: 0.015,
            min: 0.005,
            max: 0.05,
        },

        // Number of affordable candidates to scan for breakout compression (default: 50)
        breakoutCandidatesCount: {
            type: Number,
            default: 50,
            min: 10,
            max: 150,
        },

        // Minimum relative volume surge required on breakout candle (default: 1.2x for active execution)
        breakoutRvolMin: {
            type: Number,
            default: 1.2,
            min: 1.0,
            max: 5.0,
        },

        // Target ROI % on margin for fast breakout scalps (e.g. 10 = 10% ROI at 20x)
        breakoutTargetRoiPct: {
            type: Number,
            default: 10,
            min: 2,
            max: 50,
        },

        // ATR buffer multiplier applied beyond Range High/Low to prevent false wick breaches
        breakoutAtrBufferMultiplier: {
            type: Number,
            default: 0.15,
            min: 0.05,
            max: 0.5,
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

        // ── Counter-Trend / Reverse Strategy (Fade the Rally / Dump) ───────
        // When true: Invert trade direction.
        // If technical setup signals a peak bullish rally (LONG), enter SHORT to scalp the pullback.
        // If technical setup signals a peak dump (SHORT), enter LONG to scalp the bounce.
        // Preserves the small target ROI and wide safety stop loss.
        reverseMode: {
            type: Boolean,
            default: false,
        },

        // ── Smart Loss Guard (Auto-Exit on Trend Reversal & Drawdown) ────────
        // When true: during every scan cycle, the bot scans open positions.
        // If an open position has ROI < -20% AND current market trend has reversed
        // against the trade direction (signalling big loss/opposite rally),
        // it immediately places a limit close/sell order at current market price.
        smartLossGuard: {
            type: Boolean,
            default: false,
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
