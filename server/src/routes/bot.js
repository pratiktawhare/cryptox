/**
 * bot.js
 *
 * REST API routes for TradingBot controls, configuration,
 * trade logs, signals, and live/paper wallet views.
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');

const TradingConfig = require('../models/TradingConfig');
const BotTrade = require('../models/BotTrade');
const BotSignal = require('../models/BotSignal');
const BotEvent = require('../models/BotEvent');
const PaperWallet = require('../models/PaperWallet');
const PaperPosition = require('../models/PaperPosition');
const ApiKey = require('../models/ApiKey');
const DeltaOrderClient = require('../services/trading/DeltaOrderClient');
const { decryptData } = require('../utils/encryption');

const { paperBot, liveBot } = require('../services/bot/TradingBot');
const backtestEngine = require('../services/bot/BacktestEngine');
const executionEngine = require('../services/bot/ExecutionEngine');
const paperEngine = require('../services/trading/PaperTradingEngine');
const ExchangeService = require('../services/exchangeService');
const positionTracker = require('../services/trading/PositionTracker');

// All routes require authentication
router.use(authMiddleware);

// ── GET /api/bot/status ───────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
    try {
        const userId = req.user.id;

        const [paperTrades, liveTrades, paperCfg, liveCfg] = await Promise.all([
            BotTrade.find({ userId, mode: 'paper', result: 'open' }),
            BotTrade.find({ userId, mode: 'live', result: 'open' }),
            TradingConfig.findOne({ userId, mode: 'paper' }),
            TradingConfig.findOne({ userId, mode: 'live' }),
        ]);

        res.json({
            paper: {
                ...paperBot.getStatus(),
                config: paperCfg || null,
                openTrade: paperTrades[0] || null,
                openTrades: paperTrades || [],
            },
            live: {
                ...liveBot.getStatus(),
                config: liveCfg || null,
                openTrade: liveTrades[0] || null,
                openTrades: liveTrades || [],
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/start ────────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
    const { mode } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const userId = req.user.id;

        // Conflict check: if starting live TradingBot, ensure AI Automation live mode is not running
        if (mode === 'live') {
            const automationEngine = req.app.get('automationEngine');
            if (automationEngine?.getStatus()?.live?.running) {
                return res.status(409).json({
                    error: 'AI Automation is currently running in live mode. Please stop it before starting TradingBot live mode.',
                });
            }

            // Also check that user has an active Delta API key
            const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
            if (!apiKeyDoc) {
                return res.status(400).json({
                    error: 'No active Delta Exchange API key found. Please add your API key in Settings.',
                });
            }
        }

        // Enable in TradingConfig
        await TradingConfig.findOneAndUpdate(
            { userId, mode },
            { enabled: true },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        const io = req.app.get('io');
        const wsManager = req.app.get('wsManager');
        const productCatalog = req.app.get('productCatalog');

        const bot = mode === 'paper' ? paperBot : liveBot;
        await bot.start(io, wsManager, productCatalog);

        res.json({ success: true, mode, running: true, isRunning: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/stop ─────────────────────────────────────────────────────────
router.post('/stop', async (req, res) => {
    const { mode } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const userId = req.user.id;

        await TradingConfig.findOneAndUpdate(
            { userId, mode },
            { enabled: false },
            { returnDocument: 'after' }
        );

        const bot = mode === 'paper' ? paperBot : liveBot;
        bot.stop();

        res.json({ success: true, mode, running: false, isRunning: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/emergency-stop ───────────────────────────────────────────────
router.post('/emergency-stop', async (req, res) => {
    const { mode, symbol } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const userId = req.user.id;

        await TradingConfig.findOneAndUpdate(
            { userId, mode },
            { enabled: false },
            { returnDocument: 'after' }
        );

        const bot = mode === 'paper' ? paperBot : liveBot;
        const result = await bot.emergencyStop(userId, symbol, 'user_emergency_stop');

        res.json({ success: true, mode, running: false, isRunning: false, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/close-trade ─────────────────────────────────────────────────
router.post('/close-trade', async (req, res) => {
    const { mode, symbol } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const userId = req.user.id;
        const io = req.app.get('io');
        const wsManager = req.app.get('wsManager');
        const result = await executionEngine.emergencyClose({
            userId,
            mode,
            symbol,
            reason: 'manual_close',
            io,
            wsManager,
        });
        res.json({ success: true, mode, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/scan-now ─────────────────────────────────────────────────────
router.post('/scan-now', async (req, res) => {
    const { mode } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const bot = mode === 'paper' ? paperBot : liveBot;
        if (!bot.isRunning) {
            return res.status(400).json({ error: `Bot is not running in ${mode} mode` });
        }

        // Run scan asynchronously
        bot.runScan().catch(err => {
            console.error(`[TradingBot] Manual scan error (${mode}):`, err.message);
        });

        res.json({ success: true, message: `Scan initiated for ${mode} mode` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/bot/config/:mode ──────────────────────────────────────────────────
router.get('/config/:mode', async (req, res) => {
    const { mode } = req.params;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const userId = req.user.id;
        let config = await TradingConfig.findOne({ userId, mode });
        if (!config) {
            config = await TradingConfig.create({
                userId,
                mode,
                budgetUSDT: 10,
                maxLeverage: 20,
                targetRoiPct: 5,
                slAtrMultiplier: 5.0,
            });
        }
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── PUT /api/bot/config/:mode ──────────────────────────────────────────────────
router.put('/config/:mode', async (req, res) => {
    const { mode } = req.params;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    const ALLOWED = [
        'budgetUSDT', 'riskPerTradePct', 'maxDailyLossPct',
        'maxConsecutiveLosses', 'cooldownSeconds', 'minRewardRisk',
        'minSignalScore', 'slAtrMultiplier', 'tpSafetyMultiplier',
        'maxLeverage', 'maxOpenPositions', 'scanIntervalMinutes',
        'aiEnabled', 'aiRequired', 'aiIntervalSeconds', 'enabled',
        'targetRoiPct', 'reverseMode', 'walletParts', 'smartLossGuard',
    ];

    const updates = {};
    for (const key of ALLOWED) {
        if (req.body[key] !== undefined) {
            updates[key] = req.body[key];
        }
    }

    try {
        const userId = req.user.id;
        const config = await TradingConfig.findOneAndUpdate(
            { userId, mode },
            { $set: updates },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        // If scanIntervalMinutes updated, adjust bot's schedule
        if (updates.scanIntervalMinutes) {
            const bot = mode === 'paper' ? paperBot : liveBot;
            if (bot.isRunning) {
                bot._scheduleNextScan(updates.scanIntervalMinutes);
            }
        }

        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/toggle-reverse ───────────────────────────────────────────────
router.post('/toggle-reverse', async (req, res) => {
    const { mode, reverseMode } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const userId = req.user.id;
        const current = await TradingConfig.findOne({ userId, mode });
        const nextVal = typeof reverseMode === 'boolean' ? reverseMode : !current?.reverseMode;

        const config = await TradingConfig.findOneAndUpdate(
            { userId, mode },
            { $set: { reverseMode: nextVal } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        res.json({ success: true, mode, reverseMode: config.reverseMode, config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/toggle-smart-guard ───────────────────────────────────────────
router.post('/toggle-smart-guard', async (req, res) => {
    const { mode, smartLossGuard } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        const userId = req.user.id;
        const current = await TradingConfig.findOne({ userId, mode });
        const nextVal = typeof smartLossGuard === 'boolean' ? smartLossGuard : !current?.smartLossGuard;

        const config = await TradingConfig.findOneAndUpdate(
            { userId, mode },
            { $set: { smartLossGuard: nextVal } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        res.json({ success: true, mode, smartLossGuard: config.smartLossGuard, config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/bot/wallet/:mode ──────────────────────────────────────────────────
router.get('/wallet/:mode', async (req, res) => {
    const { mode } = req.params;
    const userId = req.user.id;

    try {
        if (mode === 'paper') {
            const engine = req.app.get('paperEngine') || paperEngine;
            const wallet = await engine.getWallet(userId);
            return res.json(wallet);
        } else if (mode === 'live') {
            // 1. Try PositionTracker cache first (existing real-time method)
            const tracker = req.app.get('positionTracker') || positionTracker;
            const cached = tracker ? tracker.getWallet(userId) : null;
            if (cached && (cached.available != null || cached.equity != null)) {
                return res.json({
                    balance: cached.equity ?? cached.balance ?? 0,
                    available: cached.available ?? 0,
                    used: cached.used ?? 0,
                    equity: cached.equity ?? cached.balance ?? 0,
                    unrealisedPnl: cached.unrealisedPnl ?? 0,
                    currency: 'USDT',
                });
            }

            // 2. Direct fetch via ExchangeService (existing method used across profile/positions)
            const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
            if (!apiKeyDoc) {
                return res.json({
                    balance: 0,
                    available: 0,
                    used: 0,
                    equity: 0,
                    unrealisedPnl: 0,
                    currency: 'USDT',
                    noKey: true,
                    error: 'No active Delta API key found. Please add your API key in Settings.',
                });
            }

            try {
                const exchange = new ExchangeService(userId);
                const balances = await exchange.getBalances();
                const usdt = (balances || []).find(b => b.asset_symbol === 'USDT' || b.asset_symbol === 'USD') || balances[0] || {};

                const balance = parseFloat(usdt.equity || usdt.balance || 0);
                const available = parseFloat(usdt.available_balance || 0);
                const used = parseFloat(usdt.order_margin || 0) + parseFloat(usdt.position_margin || 0);
                const equity = parseFloat(usdt.equity || usdt.balance || 0);
                const unrealisedPnl = parseFloat(usdt.unrealized_pnl || 0);

                return res.json({
                    balance,
                    available,
                    used,
                    equity,
                    unrealisedPnl,
                    currency: usdt.asset_symbol || 'USDT',
                });
            } catch (exchangeErr) {
                // If exchange request fails (e.g. IP not whitelisted on Delta), return graceful object with error description
                return res.json({
                    balance: 0,
                    available: 0,
                    used: 0,
                    equity: 0,
                    unrealisedPnl: 0,
                    currency: 'USDT',
                    error: exchangeErr.message,
                });
            }
        } else {
            return res.status(400).json({ error: 'mode must be "paper" or "live"' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/bot/trades ────────────────────────────────────────────────────────
router.get('/trades', async (req, res) => {
    const { mode, result, limit = 50 } = req.query;
    const userId = req.user.id;

    const query = { userId };
    if (mode && ['paper', 'live'].includes(mode)) query.mode = mode;
    if (result) query.result = result;

    try {
        const trades = await BotTrade.find(query)
            .sort({ createdAt: -1 })
            .limit(Math.min(parseInt(limit) || 50, 200));

        res.json({ trades, total: trades.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/bot/signals ───────────────────────────────────────────────────────
router.get('/signals', async (req, res) => {
    const { mode, limit = 50 } = req.query;
    const userId = req.user.id;

    const query = { userId };
    if (mode && ['paper', 'live'].includes(mode)) query.mode = mode;

    try {
        const signals = await BotSignal.find(query)
            .sort({ createdAt: -1 })
            .limit(Math.min(parseInt(limit) || 50, 200));

        res.json({ signals, total: signals.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/bot/events ────────────────────────────────────────────────────────
router.get('/events', async (req, res) => {
    const { mode, severity, limit = 50 } = req.query;
    const userId = req.user.id;

    const query = { userId };
    if (mode && ['paper', 'live'].includes(mode)) query.mode = mode;
    if (severity) query.severity = severity;

    try {
        const events = await BotEvent.find(query)
            .sort({ timestamp: -1 })
            .limit(Math.min(parseInt(limit) || 50, 200));

        res.json({ events, total: events.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/bot/performance ───────────────────────────────────────────────────
router.get('/performance', async (req, res) => {
    const { mode = 'paper' } = req.query;
    const userId = req.user.id;

    try {
        const closedTrades = await BotTrade.find({
            userId,
            mode,
            result: { $in: ['win', 'loss'] },
        }).sort({ exitTime: 1 });

        let totalGrossPnl = 0;
        let totalNetPnl = 0;
        let totalFees = 0;
        let wins = 0;
        let losses = 0;
        let winPnlSum = 0;
        let lossPnlSum = 0;

        for (const t of closedTrades) {
            const net = t.netPnl || 0;
            totalNetPnl += net;
            totalGrossPnl += (t.grossPnl || 0);
            totalFees += (t.fees || 0);

            if (net >= 0) {
                wins++;
                winPnlSum += net;
            } else {
                losses++;
                lossPnlSum += Math.abs(net);
            }
        }

        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
        const avgWin = wins > 0 ? winPnlSum / wins : 0;
        const avgLoss = losses > 0 ? lossPnlSum / losses : 0;
        const profitFactor = lossPnlSum > 0 ? winPnlSum / lossPnlSum : winPnlSum > 0 ? 999 : 0;

        res.json({
            mode,
            totalTrades,
            wins,
            losses,
            winRate: parseFloat(winRate.toFixed(2)),
            totalNetPnl: parseFloat(totalNetPnl.toFixed(4)),
            totalGrossPnl: parseFloat(totalGrossPnl.toFixed(4)),
            totalFees: parseFloat(totalFees.toFixed(4)),
            avgWin: parseFloat(avgWin.toFixed(4)),
            avgLoss: parseFloat(avgLoss.toFixed(4)),
            profitFactor: parseFloat(profitFactor.toFixed(2)),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/bot/backtest ─────────────────────────────────────────────────────
router.post('/backtest', async (req, res) => {
    const { symbol = 'DOGEUSD', from, to, startBalance = 10, config } = req.body;

    try {
        const result = await backtestEngine.runBacktest({
            symbol,
            from,
            to,
            startBalance,
            config,
        });

        res.json(result);
    } catch (err) {
        console.error('[BotRoute] Backtest failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
