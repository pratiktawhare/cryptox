const express = require('express');
const authenticate = require('../middleware/auth');
const AiCorrection = require('../models/AiCorrection');
const TradeHistory = require('../models/TradeHistory');
const PaperWallet  = require('../models/PaperWallet');
const PaperPosition = require('../models/PaperPosition');
const ApiKey        = require('../models/ApiKey');
const selfLearning  = require('../services/ai/SelfLearning');
const paperEngine   = require('../services/trading/PaperTradingEngine');
const DeltaOrderClient = require('../services/trading/DeltaOrderClient');
const { decryptData }  = require('../utils/encryption');

const router = express.Router();
router.use(authenticate);

// ── Helper: build authenticated Delta client for a user ──────────────────────
async function buildDeltaClient(userId) {
    const keyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
    if (!keyDoc) return null;
    const apiKey    = decryptData(keyDoc.apiKeyEncrypted);
    const apiSecret = decryptData(keyDoc.apiSecretEncrypted);
    return new DeltaOrderClient(apiKey, apiSecret);
}

// ── Helper: parse Delta wallet response into usable fields ───────────────────
function parseDeltaWallet(walletData) {
    try {
        const result = walletData?.result || [];
        // Delta returns array of asset balances; find USDT (the main margin asset)
        const usdt = result.find(w => w.asset_symbol === 'USDT') || result[0] || {};
        const balance   = parseFloat(usdt.balance         || usdt.wallet_balance  || 0);
        const available = parseFloat(usdt.available_balance                        || 0);
        const blocked   = parseFloat(usdt.position_margin || usdt.blocked_margin  || 0);
        const unrealised= parseFloat(usdt.unrealised_cashflow || usdt.upl         || 0);
        return { balance, available, blocked, unrealised, raw: usdt };
    } catch { return null; }
}

// ── Overall performance summary ───────────────────────────────────────────────
router.get('/performance', async (req, res) => {
    try {
        const userId = req.user.id;

        // Paper wallet stats
        const paperWallet = await paperEngine.getWallet(userId);

        // Live trade history stats (closed trades)
        const liveTrades = await TradeHistory.find({ userId, mode: { $ne: 'paper' }, status: 'filled' }).lean();
        const liveWins   = liveTrades.filter(t => t.realisedPnl > 0).length;
        const livePnl    = liveTrades.reduce((s, t) => s + (t.realisedPnl || 0), 0);

        // Paper trade history
        const paperTrades = await PaperPosition.find({ userId, status: { $ne: 'open' } }).lean();

        // Signal accuracy
        const corrections = await AiCorrection.find().sort({ createdAt: -1 }).limit(200).lean();
        const sigTotal = corrections.length;
        const sigWins  = corrections.filter(c => c.outcome === 'win').length;
        const sigWinRate = sigTotal > 0 ? ((sigWins / sigTotal) * 100).toFixed(1) : null;
        const avgRR    = corrections.length
            ? (corrections.reduce((s, c) => s + (c.rrAchieved || 0), 0) / corrections.length).toFixed(2)
            : null;

        // Live wallet from Delta Exchange (best-effort, non-blocking)
        let liveWallet = null;
        try {
            const client = await buildDeltaClient(userId);
            if (client) {
                const walletData = await client.getWallet();
                liveWallet = parseDeltaWallet(walletData);
            }
        } catch (e) {
            console.warn('[Analytics] Could not fetch live Delta wallet:', e.message);
        }

        // All-time stats from closed live trades
        const liveAllTrades = await TradeHistory.find({ userId, mode: { $ne: 'paper' } }).lean();
        const livePending   = liveAllTrades.filter(t => ['open', 'pending'].includes(t.status)).length;

        res.json({
            paper: {
                balance:     paperWallet?.balance        ?? (paperWallet?.startingBalance ?? 10),
                equity:      paperWallet?.equity         ?? (paperWallet?.startingBalance ?? 10),
                available:   paperWallet?.available      ?? (paperWallet?.startingBalance ?? 10),
                totalPnl:    paperWallet?.totalRealised  ?? 0,
                winRate:     paperWallet?.winRate        ?? 0,
                totalTrades: paperWallet?.totalTrades    ?? 0,
                maxDrawdown: paperWallet?.maxDrawdown    ?? 0,
                returnPct:   paperWallet?.returnPct      ?? 0,
                peakEquity:  paperWallet?.peakEquity     ?? (paperWallet?.startingBalance ?? 10),
                startingBalance: paperWallet?.startingBalance ?? 10,
                totalWins:   paperWallet?.totalWins      ?? 0,
                totalLosses: paperWallet?.totalLosses    ?? 0,
            },
            live: {
                // Real-time Delta Exchange wallet data
                balance:       liveWallet?.balance    ?? null,
                available:     liveWallet?.available  ?? null,
                blocked:       liveWallet?.blocked    ?? null,
                unrealisedPnl: liveWallet?.unrealised ?? null,
                hasWallet:     liveWallet !== null,
                // Historical trade stats
                totalTrades:   liveTrades.length,
                openPositions: livePending,
                wins:          liveWins,
                losses:        liveTrades.length - liveWins,
                winRate:       liveTrades.length > 0 ? parseFloat(((liveWins / liveTrades.length) * 100).toFixed(1)) : null,
                totalPnl:      parseFloat(livePnl.toFixed(2)),
            },
            signals: {
                total:   sigTotal,
                wins:    sigWins,
                winRate: sigWinRate,
                avgRR,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── On-demand live wallet refresh ─────────────────────────────────────────────
router.get('/live-wallet', async (req, res) => {
    try {
        const userId = req.user.id;
        const client = await buildDeltaClient(userId);
        if (!client) {
            return res.status(404).json({ error: 'No active Delta Exchange API key found.' });
        }
        const [walletData, positionsData] = await Promise.allSettled([
            client.getWallet(),
            client.getPositions(),
        ]);

        const wallet    = parseDeltaWallet(walletData.value);
        const positions = positionsData.status === 'fulfilled'
            ? (positionsData.value?.result || [])
            : [];

        res.json({
            wallet,
            openPositions: positions.map(p => ({
                symbol:        p.product_symbol,
                side:          p.size > 0 ? 'buy' : 'sell',
                size:          Math.abs(p.size),
                entryPrice:    parseFloat(p.entry_price || 0),
                markPrice:     parseFloat(p.mark_price  || 0),
                unrealisedPnl: parseFloat(p.unrealised_cashflow || p.upl || 0),
                margin:        parseFloat(p.initial_margin || 0),
                leverage:      p.leverage,
            })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// ── Equity curve data ─────────────────────────────────────────────────────────
router.get('/equity-curve', async (req, res) => {
    try {
        const userId = req.user.id;
        const limit  = parseInt(req.query.limit) || 100;
        const mode   = req.query.mode || 'paper'; // 'paper' | 'live'

        let points = [];

        if (mode === 'paper') {
            const trades = await PaperPosition.find({ userId, status: { $ne: 'open' } })
                .sort({ closedAt: 1 })
                .limit(limit)
                .lean();

            // Build running equity curve
            const wallet = await PaperWallet.findOne({ userId }).lean();
            const start  = wallet?.startingBalance ?? 10000;
            let running  = start;
            points = trades.map(t => {
                running += (t.realisedPnl || 0);
                return {
                    t: new Date(t.closedAt).getTime(),
                    equity: parseFloat(running.toFixed(2)),
                    symbol: t.symbol,
                    outcome: t.status,
                    pnl: t.realisedPnl,
                };
            });

            // Prepend starting point
            if (points.length > 0) {
                points.unshift({ t: new Date(wallet.createdAt || Date.now()).getTime(), equity: start, symbol: null, outcome: 'start', pnl: 0 });
            }
        } else {
            const trades = await TradeHistory.find({ userId, mode: { $ne: 'paper' }, realisedPnl: { $ne: null } })
                .sort({ filledAt: 1 })
                .limit(limit)
                .lean();

            let running = 0;
            points = trades.map(t => {
                running += (t.realisedPnl || 0);
                return {
                    t: new Date(t.filledAt).getTime(),
                    equity: parseFloat(running.toFixed(2)),
                    symbol: t.symbol,
                    outcome: t.realisedPnl >= 0 ? 'win' : 'loss',
                    pnl: t.realisedPnl,
                };
            });
        }

        res.json({ points, mode });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Signal accuracy by symbol ─────────────────────────────────────────────────
router.get('/signals', async (req, res) => {
    try {
        const limit  = parseInt(req.query.limit) || 50;
        const symbol = req.query.symbol;

        const query = symbol ? { symbol: symbol.toUpperCase() } : {};
        const corrections = await AiCorrection.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        // Group by symbol
        const bySymbol = {};
        for (const c of corrections) {
            if (!bySymbol[c.symbol]) {
                bySymbol[c.symbol] = { wins: 0, losses: 0, timeouts: 0, total: 0, avgPnl: 0, avgRR: 0, pnls: [], rrs: [] };
            }
            const g = bySymbol[c.symbol];
            g.total++;
            if (c.outcome === 'win')     g.wins++;
            else if (c.outcome === 'loss') g.losses++;
            else g.timeouts++;
            if (c.realisedPnlPct != null) g.pnls.push(c.realisedPnlPct);
            if (c.rrAchieved != null)     g.rrs.push(c.rrAchieved);
        }

        const symbolStats = Object.entries(bySymbol).map(([sym, g]) => ({
            symbol: sym,
            total: g.total,
            wins: g.wins,
            losses: g.losses,
            timeouts: g.timeouts,
            winRate: ((g.wins / g.total) * 100).toFixed(1),
            avgPnlPct: g.pnls.length ? (g.pnls.reduce((a, b) => a + b, 0) / g.pnls.length).toFixed(1) : null,
            avgRR: g.rrs.length ? (g.rrs.reduce((a, b) => a + b, 0) / g.rrs.length).toFixed(2) : null,
        })).sort((a, b) => b.total - a.total);

        res.json({ corrections, bySymbol: symbolStats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Self-learning insights ────────────────────────────────────────────────────
router.get('/learning', async (req, res) => {
    try {
        const [globalCtx, corrections] = await Promise.all([
            selfLearning.getGlobalContext(),
            AiCorrection.find().sort({ createdAt: -1 }).limit(10).lean(),
        ]);

        // Top 10 and bottom 5 performing symbols
        const allSym = await AiCorrection.aggregate([
            { $group: {
                _id: '$symbol',
                wins: { $sum: { $cond: [{ $eq: ['$outcome', 'win'] }, 1, 0] } },
                total: { $sum: 1 },
                avgRR: { $avg: '$rrAchieved' },
                avgPnl: { $avg: '$realisedPnlPct' },
            }},
            { $match: { total: { $gte: 2 } } },
            { $addFields: { winRate: { $multiply: [{ $divide: ['$wins', '$total'] }, 100] } } },
            { $sort: { winRate: -1 } },
        ]);

        res.json({
            global: globalCtx,
            topPerformers:   allSym.slice(0, 10).map(s => ({ symbol: s._id, winRate: s.winRate.toFixed(1), total: s.total, avgRR: s.avgRR?.toFixed(2) })),
            underPerformers: allSym.slice(-5).reverse().map(s => ({ symbol: s._id, winRate: s.winRate.toFixed(1), total: s.total, avgRR: s.avgRR?.toFixed(2) })),
            recentOutcomes:  corrections.map(c => ({ symbol: c.symbol, outcome: c.outcome, pnl: c.realisedPnlPct?.toFixed(1), rr: c.rrAchieved?.toFixed(2), hours: c.holdingHours?.toFixed(1) })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Best & worst trades ───────────────────────────────────────────────────────
router.get('/best-worst', async (req, res) => {
    try {
        const userId = req.user.id;
        const mode   = req.query.mode || 'paper';

        let best, worst;
        if (mode === 'paper') {
            [best, worst] = await Promise.all([
                PaperPosition.find({ userId, status: { $ne: 'open' } }).sort({ realisedPnl: -1 }).limit(5).lean(),
                PaperPosition.find({ userId, status: { $ne: 'open' } }).sort({ realisedPnl: 1 }).limit(5).lean(),
            ]);
        } else {
            [best, worst] = await Promise.all([
                TradeHistory.find({ userId, mode: { $ne: 'paper' }, realisedPnl: { $ne: null } }).sort({ realisedPnl: -1 }).limit(5).lean(),
                TradeHistory.find({ userId, mode: { $ne: 'paper' }, realisedPnl: { $ne: null } }).sort({ realisedPnl: 1 }).limit(5).lean(),
            ]);
        }

        res.json({ best, worst, mode });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
