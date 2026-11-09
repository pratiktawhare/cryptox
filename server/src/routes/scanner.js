/**
 * routes/scanner.js
 *
 * REST endpoints for the MCdynamic Universal Market Scanner & Strategy Automation:
 *   GET   /api/scanner/config   - Get scanner user preferences & runtime status
 *   PATCH /api/scanner/config   - Update scanner preferences (timeframe, interval, auto-trade)
 *   POST  /api/scanner/run      - Trigger an on-demand scan of all 194 coins
 *   GET   /api/scanner/results  - Get latest cached scan results
 *   POST  /api/scanner/trade    - 1-click execution for a scanned coin (Paper or Live)
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const ScannerPreference = require('../models/ScannerPreference');
const universalMarketScanner = require('../services/custom_strategy/UniversalMarketScanner');
const scannerScheduler = require('../services/custom_strategy/ScannerScheduler');
const paperEngine = require('../services/trading/PaperTradingEngine');
const orderExecutor = require('../services/trading/OrderExecutor');
const productCatalog = require('../services/ProductCatalog');

const router = express.Router();
router.use(authMiddleware);

// ─── GET /api/scanner/config ──────────────────────────────────────────────────
router.get('/config', async (req, res) => {
    try {
        let prefs = await ScannerPreference.findOne({ userId: req.user.id });
        if (!prefs) {
            prefs = await ScannerPreference.create({ userId: req.user.id });
        }

        const schedulerConfig = scannerScheduler.getConfig();

        res.json({
            preferences: prefs,
            scheduler: schedulerConfig,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch scanner configuration: ' + err.message });
    }
});

// ─── PATCH /api/scanner/config ────────────────────────────────────────────────
router.patch('/config', async (req, res) => {
    try {
        const allowedFields = [
            'timeframe',
            'interval',
            'fastPeriod',
            'slowPeriod',
            'triggerDiffPct',
            'autoTradeMode',
            'maxLeverage',
            'tradeAllocationUsdt',
            'takeProfitMode',
            'takeProfitValue',
            'stopLossMode',
            'stopLossValue',
            'filterZeroVolume',
            'favoriteCoins',
        ];

        let prefs = await ScannerPreference.findOne({ userId: req.user.id });
        if (!prefs) {
            prefs = new ScannerPreference({ userId: req.user.id });
        }

        const updateData = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                prefs[field] = req.body[field];
                updateData[field] = req.body[field];
            }
        }

        await prefs.save();

        // Sync changes to active runtime scheduler
        scannerScheduler.updateConfig(updateData);

        res.json({
            message: 'Scanner configuration updated successfully',
            preferences: prefs,
            scheduler: scannerScheduler.getConfig(),
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update scanner configuration: ' + err.message });
    }
});

// ─── POST /api/scanner/run ────────────────────────────────────────────────────
router.post('/run', async (req, res) => {
    try {
        const prefs = await ScannerPreference.findOne({ userId: req.user.id }).lean();
        const io = req.app.get('io');

        const {
            timeframe = prefs?.timeframe || '4h',
            fastPeriod = prefs?.fastPeriod || 14,
            slowPeriod = prefs?.slowPeriod || 50,
            triggerDiffPct = prefs?.triggerDiffPct ?? 0.10,
            filterZeroVolume = prefs?.filterZeroVolume ?? true,
            symbols = null,
        } = req.body || {};

        console.log(`[Scanner API] ⚡ Manual scan requested by user ${req.user.id} (${timeframe})`);

        const result = await universalMarketScanner.scanAll({
            timeframe,
            fastPeriod,
            slowPeriod,
            triggerDiffPct,
            filterZeroVolume,
            symbols,
            io,
        });

        res.json(result);
    } catch (err) {
        console.error('[Scanner API] Scan failed:', err.message);
        res.status(500).json({ error: 'Market scan failed: ' + err.message });
    }
});

// ─── GET /api/scanner/results ─────────────────────────────────────────────────
router.get('/results', (req, res) => {
    try {
        const cached = universalMarketScanner.getLastResults();
        res.json(cached);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch scan results: ' + err.message });
    }
});

// ─── POST /api/scanner/trade ──────────────────────────────────────────────────
router.post('/trade', async (req, res) => {
    try {
        const {
            symbol,
            side,
            mode = 'paper', // 'paper' | 'live'
            size,
            leverage = 3,
            price,
            stopLoss,
            takeProfit,
        } = req.body;

        if (!symbol || !side) {
            return res.status(400).json({ error: 'Symbol and side are required' });
        }

        const normSymbol = symbol.toUpperCase();
        const normSide = side.toLowerCase();

        // Get latest price if not passed
        const wsManager = req.app.get('wsManager');
        const currentPrice = price || wsManager?.getPrice(normSymbol) || 0;

        const orderParams = {
            symbol: normSymbol,
            side: normSide,
            size: parseInt(size) || 1,
            price: currentPrice,
            orderType: 'market',
            leverage: parseInt(leverage) || 3,
            stopLoss: stopLoss ? parseFloat(stopLoss) : null,
            takeProfit: takeProfit ? parseFloat(takeProfit) : null,
            source: 'MCdynamic_Scanner',
        };

        if (mode === 'paper') {
            const position = await paperEngine.placeOrder(req.user.id, orderParams);
            return res.json({
                success: true,
                mode: 'paper',
                message: `Paper order executed: ${normSide.toUpperCase()} ${orderParams.size} ${normSymbol}`,
                position,
            });
        } else {
            // Live order
            const io = req.app.get('io');
            const history = await orderExecutor.execute(req.user.id, orderParams, io);
            return res.json({
                success: true,
                mode: 'live',
                message: `Live order placed: ${normSide.toUpperCase()} ${orderParams.size} ${normSymbol}`,
                history,
            });
        }
    } catch (err) {
        console.error('[Scanner Trade] Execution error:', err.message);
        res.status(500).json({ error: 'Trade execution failed: ' + err.message });
    }
});

module.exports = router;

