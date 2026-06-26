/**
 * routes/analysis.js
 *
 * Technical analysis endpoints.
 * All routes require JWT auth.
 *
 * GET /api/analysis/:symbol           — Full analysis at 5m (with cache)
 * GET /api/analysis/:symbol/mtf       — Multi-timeframe (5m, 15m, 1h)
 * GET /api/analysis/:symbol/:resolution — Custom resolution analysis
 */

const express = require('express');
const authenticate = require('../middleware/auth');
const MarketAnalyzer = require('../services/analysis/MarketAnalyzer');

const router = express.Router();
router.use(authenticate);

// ── Full analysis at default 5m ───────────────────────────────────────────────
router.get('/:symbol', async (req, res) => {
    try {
        const symbol   = req.params.symbol.toUpperCase();
        const resolution = req.query.resolution || '5m';
        const force    = req.query.refresh === 'true';

        const snapshot = await MarketAnalyzer.analyze(symbol, resolution, force);
        if (snapshot.error) return res.status(422).json({ error: snapshot.error });
        res.json(snapshot);
    } catch (err) {
        console.error('[Analysis] Error:', err.message);
        res.status(502).json({ error: 'Analysis failed: ' + err.message });
    }
});

// ── Multi-timeframe analysis ──────────────────────────────────────────────────
router.get('/:symbol/mtf', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const mtf = await MarketAnalyzer.analyzeMultiTimeframe(symbol);
        res.json(mtf);
    } catch (err) {
        console.error('[Analysis MTF] Error:', err.message);
        res.status(502).json({ error: 'MTF analysis failed: ' + err.message });
    }
});

// ── Cache stats (admin) ───────────────────────────────────────────────────────
router.get('/_cache/stats', (req, res) => {
    res.json(MarketAnalyzer.getCacheStats());
});

module.exports = router;
