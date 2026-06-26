/**
 * routes/signals.js
 *
 * Trade Signal endpoints.
 * All routes require JWT auth.
 *
 * GET  /api/signals              — Paginated signal history
 * GET  /api/signals/latest       — Last 20 signals (live feed)
 * GET  /api/signals/:symbol      — Signals for a specific coin
 * POST /api/signals/analyze/:symbol — On-demand AI analysis (manual trigger)
 * GET  /api/signals/stats        — Engine stats
 */

const express = require('express');
const authenticate = require('../middleware/auth');
const TradeSignal = require('../models/TradeSignal');
const signalEngine = require('../services/ai/SignalEngine');
const UserPreferences = require('../models/UserPreferences');

const router = express.Router();
router.use(authenticate);

// ── Latest signals feed ───────────────────────────────────────────────────────
router.get('/latest', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const signals = await TradeSignal
            .find({ mode: 'live' })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
        res.json({ signals, count: signals.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Paginated history ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const page   = parseInt(req.query.page) || 1;
        const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
        const skip   = (page - 1) * limit;
        const action = req.query.action; // BUY | SELL
        const status = req.query.status; // pending | hit_tp | hit_sl | expired

        const filter = { mode: 'live' };
        if (action) filter.action = action.toUpperCase();
        if (status) filter.status = status;

        const [signals, total] = await Promise.all([
            TradeSignal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            TradeSignal.countDocuments(filter),
        ]);

        res.json({ signals, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Delete all closed signals ─────────────────────────────────────────────────
router.delete('/closed', async (req, res) => {
    try {
        const result = await TradeSignal.deleteMany({
            status: { $nin: ['pending', 'open'] }
        });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Signals for a specific symbol ─────────────────────────────────────────────
router.get('/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const limit  = parseInt(req.query.limit) || 20;
        const signals = await TradeSignal
            .find({ symbol, mode: 'live' })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
        res.json({ symbol, signals, count: signals.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── On-demand analysis for a specific symbol ──────────────────────────────────
router.post('/analyze/:symbol', async (req, res) => {
    try {
        let symbol = req.params.symbol.toUpperCase();
        const { action = 'all', confidenceRange = 'all' } = req.body || {};
        const productCatalog = require('../services/ProductCatalog');

        if (symbol !== 'RANDOM' && symbol !== 'CHEAP' && productCatalog && productCatalog.isReady) {
            const allSymbols = productCatalog.getSymbols();
            if (!allSymbols.includes(symbol)) {
                if (allSymbols.includes(symbol + 'USD')) {
                    symbol = symbol + 'USD';
                } else {
                    const matched = allSymbols.find(s => s.startsWith(symbol));
                    if (matched) {
                        symbol = matched;
                    }
                }
            }
        }

        const userPrefs = await UserPreferences.findOne({ userId: req.user.id }).lean() || {};
        const PaperWallet = require('../models/PaperWallet');
        const paperWallet = await PaperWallet.findOne({ userId: req.user.id }).lean();

        let walletContext = { availableBalance: 10000, tradeBudget: 3000, mode: 'paper' };
        if (paperWallet) {
            const available = paperWallet.available ?? paperWallet.balance ?? 10000;
            const maxSinglePct = userPrefs.maxSingleTradePct ?? 30;
            const reservePct   = userPrefs.minReservePct   ?? 20;
            const usable = available * (1 - reservePct / 100);
            const tradeBudget = Math.floor(usable * (maxSinglePct / 100));
            walletContext = { availableBalance: available, tradeBudget, mode: 'paper' };
        }

        const result = await signalEngine.analyzeNow(symbol, userPrefs, {
            ...walletContext,
            requestedAction: action,
            requestedConfRange: confidenceRange
        });
        res.json(result);
    } catch (err) {
        console.error('[Signals] On-demand analysis error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Engine stats ──────────────────────────────────────────────────────────────
router.get('/engine/stats', (req, res) => {
    res.json(signalEngine.getStats());
});

module.exports = router;
