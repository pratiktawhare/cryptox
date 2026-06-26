/**
 * routes/market.js
 *
 * Public market data endpoints — no auth required.
 *
 * GET /api/market/products          — All perpetual futures from ProductCatalog
 * GET /api/market/history           — Historical OHLCV (legacy endpoint)
 * GET /api/market/candles/:symbol/:resolution — Historical OHLCV per symbol
 * GET /api/market/ticker            — Full live ticker snapshot
 * GET /api/market/ticker/:symbol    — Single symbol live ticker
 */

const express = require('express');
const ExchangeService = require('../services/exchangeService');

const router = express.Router();

// ─── Products ─────────────────────────────────────────────────────────────────

/**
 * GET /api/market/products
 * Returns all perpetual futures from the cached ProductCatalog.
 */
router.get('/products', (req, res) => {
    const catalog = req.app.get('productCatalog');
    if (!catalog?.isReady) {
        return res.status(503).json({ error: 'Product catalog is loading. Try again in a moment.' });
    }
    const products = catalog.getAll();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ products, count: products.length });
});

// ─── Live Ticker ──────────────────────────────────────────────────────────────

/**
 * GET /api/market/ticker
 * Returns the full live ticker snapshot (all symbols with current prices).
 */
router.get('/ticker', (req, res) => {
    const wsManager = req.app.get('wsManager');
    if (!wsManager) {
        return res.status(503).json({ error: 'WebSocket manager not ready' });
    }
    res.json(wsManager.getTickerSnapshot());
});

/**
 * GET /api/market/ticker/:symbol
 * Returns the live ticker for a single symbol.
 */
router.get('/ticker/:symbol', (req, res) => {
    const wsManager = req.app.get('wsManager');
    const symbol = req.params.symbol.toUpperCase();
    if (!wsManager) {
        return res.status(503).json({ error: 'WebSocket manager not ready' });
    }
    const ticker = wsManager.getTicker(symbol);
    if (!ticker) {
        return res.status(404).json({ error: `No live ticker data for ${symbol}` });
    }
    res.json(ticker);
});

// ─── Historical Candles ───────────────────────────────────────────────────────

/**
 * GET /api/market/candles/:symbol/:resolution
 * Fetch OHLCV candle history for a specific symbol and resolution.
 * Resolution: 1m | 5m | 15m | 1h | 4h | 1d
 */
router.get('/candles/:symbol/:resolution', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const resolution = req.params.resolution || '5m';

        // Default window depends on resolution
        const resMap = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
        const resMinutes = resMap[resolution] ?? 5;
        const defaultWindow = Math.min(resMinutes * 500, 365 * 24 * 60); // Up to 500 candles

        const endTs = req.query.end ? parseInt(req.query.end) : Math.floor(Date.now() / 1000);
        const startTs = req.query.start ? parseInt(req.query.start) : endTs - defaultWindow * 60;

        const candles = await ExchangeService.fetchHistoricalCandles(symbol, resolution, startTs, endTs);

        res.set('Cache-Control', 'public, max-age=60'); // 1 min cache for candles
        res.json({ symbol, resolution, candles, count: candles.length });
    } catch (error) {
        console.error('Candle History Error:', error.message);
        res.status(502).json({ error: 'Failed to fetch candle data from exchange' });
    }
});

/**
 * GET /api/market/history  (legacy — kept for backward compat with TradingChart)
 * Fetch OHLCV candles via query params.
 */
router.get('/history', async (req, res) => {
    try {
        const { symbol, resolution } = req.query;
        if (!symbol) {
            return res.status(400).json({ error: 'Query param "symbol" is required (e.g. BTCUSD)' });
        }

        const resValue = resolution || '1m';
        const resMap = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
        const resMinutes = resMap[resValue] ?? 5;
        const defaultWindow = Math.min(resMinutes * 500, 365 * 24 * 60); // Up to 500 candles

        const endTs = req.query.end ? parseInt(req.query.end) : Math.floor(Date.now() / 1000);
        const startTs = req.query.start ? parseInt(req.query.start) : endTs - defaultWindow * 60;

        const candles = await ExchangeService.fetchHistoricalCandles(
            symbol.toUpperCase(), resValue, startTs, endTs
        );

        res.set('Cache-Control', 'public, max-age=300');
        res.json(candles);
    } catch (error) {
        console.error('Market History Error:', error.message);
        res.status(502).json({ error: 'Failed to fetch market data from exchange' });
    }
});

module.exports = router;
