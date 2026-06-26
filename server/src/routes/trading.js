/**
 * routes/trading.js
 *
 * One-click trading endpoints — Phase 7.
 * All routes require JWT authentication.
 *
 * POST /api/trading/order              — Place a new order
 * DELETE /api/trading/order/:orderId   — Cancel an order
 * POST /api/trading/close              — Close a position (market order opposite side)
 * GET  /api/trading/positions          — Get live cached positions
 * GET  /api/trading/wallet             — Get live cached wallet balance
 * GET  /api/trading/history            — Paginated trade history
 * GET  /api/trading/history/:symbol    — History for a specific symbol
 */

const express = require('express');
const authenticate = require('../middleware/auth');
const orderExecutor  = require('../services/trading/OrderExecutor');
const positionTracker = require('../services/trading/PositionTracker');
const TradeHistory   = require('../models/TradeHistory');

const router = express.Router();
router.use(authenticate);

// Attach io from app to request for real-time emit
router.use((req, _res, next) => {
    req.io = req.app.get('io');
    next();
});

// ── Place order ───────────────────────────────────────────────────────────────
router.post('/order', async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            symbol, side, size, orderType = 'market_order',
            price, stopLoss, takeProfit, leverage = 1,
            signalId, source = 'manual',
        } = req.body;

        // Basic validation
        if (!symbol || !side || !size) {
            return res.status(400).json({ error: 'symbol, side, and size are required' });
        }
        if (!['buy', 'sell'].includes(side)) {
            return res.status(400).json({ error: 'side must be "buy" or "sell"' });
        }
        if (size < 1 || !Number.isInteger(Number(size))) {
            return res.status(400).json({ error: 'size must be a positive integer' });
        }

        const result = await orderExecutor.execute(
            userId,
            { symbol: symbol.toUpperCase(), side, size: parseInt(size), orderType, price: price ? parseFloat(price) : null, stopLoss: stopLoss ? parseFloat(stopLoss) : null, takeProfit: takeProfit ? parseFloat(takeProfit) : null, leverage: parseInt(leverage), signalId, source },
            req.io
        );

        res.status(201).json({ success: true, trade: result });

    } catch (err) {
        const code = err.message?.includes('Safety check') ? 400 : 502;
        res.status(code).json({ error: err.message });
    }
});

// ── Cancel order ──────────────────────────────────────────────────────────────
router.delete('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { symbol } = req.query;
        if (!symbol) return res.status(400).json({ error: 'symbol query param required' });

        const result = await orderExecutor.cancel(req.user.id, orderId, symbol.toUpperCase(), req.io);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Edit order ────────────────────────────────────────────────────────────────
router.put('/order', async (req, res) => {
    try {
        const { id, symbol, size, limitPrice, stopPrice, bracketStopLossPrice, bracketTakeProfitPrice } = req.body;
        if (!id || !symbol) {
            return res.status(400).json({ error: 'id and symbol are required' });
        }

        const ApiKey = require('../models/ApiKey');
        const { decryptData } = require('../utils/encryption');
        const DeltaOrderClient = require('../services/trading/DeltaOrderClient');

        const activeKey = await ApiKey.findOne({ userId: req.user.id, exchange: 'delta', isActive: true });
        if (!activeKey) {
            return res.status(400).json({ error: 'No active API Key found' });
        }

        const apiKey = decryptData(activeKey.apiKeyEncrypted);
        const apiSecret = decryptData(activeKey.apiSecretEncrypted);
        const client = new DeltaOrderClient(apiKey, apiSecret);

        const productCatalog = require('../services/ProductCatalog');
        const prod = productCatalog.getBySymbol(symbol);
        if (!prod) {
            return res.status(404).json({ error: `Product not found for symbol: ${symbol}` });
        }

        let sizeOrPriceUpdated = false;
        const mainBody = {
            id: id.toString(),
            product_id: prod.id,
        };

        if (size) {
            mainBody.size = parseInt(size);
            sizeOrPriceUpdated = true;
        }
        if (limitPrice !== undefined) {
            mainBody.limit_price = limitPrice !== null ? limitPrice.toString() : null;
            sizeOrPriceUpdated = true;
        }
        if (stopPrice !== undefined) {
            mainBody.stop_price = stopPrice !== null ? stopPrice.toString() : null;
            sizeOrPriceUpdated = true;
        }

        let result = null;
        if (sizeOrPriceUpdated) {
            result = await client._request('PUT', '/v2/orders', mainBody);
        }

        // Bracket Stop-Loss / Take-Profit parameters updates
        const hasBracketUpdate = bracketStopLossPrice !== undefined || bracketTakeProfitPrice !== undefined;
        if (hasBracketUpdate) {
            const bracketBody = {
                id: id.toString(),
                product_id: prod.id,
            };

            if (bracketStopLossPrice !== undefined) {
                if (bracketStopLossPrice === null || bracketStopLossPrice === "") {
                    bracketBody.bracket_stop_loss_price = null;
                    bracketBody.bracket_stop_loss_limit_price = null;
                } else {
                    bracketBody.bracket_stop_loss_price = bracketStopLossPrice.toString();
                    bracketBody.bracket_stop_loss_limit_price = bracketStopLossPrice.toString();
                }
            }

            if (bracketTakeProfitPrice !== undefined) {
                if (bracketTakeProfitPrice === null || bracketTakeProfitPrice === "") {
                    bracketBody.bracket_take_profit_price = null;
                    bracketBody.bracket_take_profit_limit_price = null;
                } else {
                    bracketBody.bracket_take_profit_price = bracketTakeProfitPrice.toString();
                    bracketBody.bracket_take_profit_limit_price = bracketTakeProfitPrice.toString();
                }
            }

            const bracketRes = await client._request('PUT', '/v2/orders/bracket', bracketBody);
            if (!result) {
                result = bracketRes;
            }
        }

        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Close a position ──────────────────────────────────────────────────────────
router.post('/close', async (req, res) => {
    try {
        const { symbol, size, side } = req.body;
        if (!symbol || !size || !side) {
            return res.status(400).json({ error: 'symbol, size, and side are required' });
        }
        const result = await orderExecutor.closePosition(
            req.user.id, symbol.toUpperCase(), parseInt(size), side, req.io
        );
        res.json({ success: true, trade: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Live positions (from cache) ───────────────────────────────────────────────
router.get('/positions', (req, res) => {
    const positions = positionTracker.getPositions(req.user.id);
    res.json({ positions, count: positions.length, timestamp: Date.now() });
});

// ── Wallet balance (from cache) ───────────────────────────────────────────────
router.get('/wallet', (req, res) => {
    const wallet = positionTracker.getWallet(req.user.id);
    if (!wallet) {
        return res.status(202).json({ wallet: null, message: 'Polling in progress — data available in 10s' });
    }
    res.json({ wallet, timestamp: Date.now() });
});

// ── Open orders ──────────────────────────────────────────────────────────────
router.get('/open-orders', async (req, res) => {
    try {
        const ApiKey = require('../models/ApiKey');
        const { decryptData } = require('../utils/encryption');
        const DeltaOrderClient = require('../services/trading/DeltaOrderClient');

        const activeKey = await ApiKey.findOne({ userId: req.user.id, exchange: 'delta', isActive: true });
        if (!activeKey) {
            return res.json({ openOrders: [] });
        }

        const apiKey = decryptData(activeKey.apiKeyEncrypted);
        const apiSecret = decryptData(activeKey.apiSecretEncrypted);
        const client = new DeltaOrderClient(apiKey, apiSecret);

        const openOrdersRes = await client.getOpenOrders();
        const rawOrders = openOrdersRes.result || [];

        const openOrders = rawOrders.map(o => ({
            id: o.id,
            symbol: o.product_symbol,
            side: o.side,
            orderType: o.order_type,
            size: parseFloat(o.size || 0),
            unfilledSize: parseFloat(o.unfilled_size || 0),
            limitPrice: o.limit_price ? parseFloat(o.limit_price) : null,
            stopPrice: o.stop_price ? parseFloat(o.stop_price) : null,
            stopOrderType: o.stop_order_type || null,
            bracketStopLossPrice: o.bracket_stop_loss_price ? parseFloat(o.bracket_stop_loss_price) : null,
            bracketTakeProfitPrice: o.bracket_take_profit_price ? parseFloat(o.bracket_take_profit_price) : null,
            createdAt: o.created_at
        }));

        res.json({ openOrders });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ── Trade history (paginated) ─────────────────────────────────────────────────
router.get('/history', async (req, res) => {
    try {
        const page   = parseInt(req.query.page) || 1;
        const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
        const symbol = req.query.symbol;

        // Try to find active API Key for Live trading
        const ApiKey = require('../models/ApiKey');
        const { decryptData } = require('../utils/encryption');
        const DeltaOrderClient = require('../services/trading/DeltaOrderClient');

        const activeKey = await ApiKey.findOne({ userId: req.user.id, exchange: 'delta', isActive: true });
        if (activeKey) {
            try {
                const apiKey = decryptData(activeKey.apiKeyEncrypted);
                const apiSecret = decryptData(activeKey.apiSecretEncrypted);
                const client = new DeltaOrderClient(apiKey, apiSecret);
                const fillsRes = await client.getFills(symbol ? symbol.toUpperCase() : null, limit);
                const rawFills = fillsRes.result || [];
                
                const trades = rawFills.map(f => {
                    const isBuy = f.side === 'buy';
                    return {
                        _id: f.id,
                        orderId: f.order_id,
                        symbol: f.product_symbol,
                        side: f.side,
                        orderType: f.meta_data?.order_type || 'market_order',
                        size: parseFloat(f.size || 0),
                        price: parseFloat(f.price || 0),
                        filledPrice: parseFloat(f.price || 0),
                        leverage: parseFloat(f.meta_data?.new_position?.leverage || 1),
                        status: 'filled',
                        createdAt: f.created_at,
                        closedAt: f.created_at,
                        commission: parseFloat(f.commission || f.meta_data?.total_commission_in_settling_asset || 0),
                        realisedPnl: parseFloat(f.meta_data?.new_position?.realized_pnl || 0),
                        source: f.meta_data?.source || 'Delta'
                    };
                });
                return res.json({ trades, total: trades.length, page: 1, pages: 1 });
            } catch (apiErr) {
                console.error('[Trading Route] Error fetching live fills:', apiErr.message);
                // Fallback to local DB if API call fails
            }
        }

        const skip   = (page - 1) * limit;
        const status = req.query.status;
        const filter = { userId: req.user.id };
        if (status) filter.status = status;
        if (symbol) filter.symbol = symbol.toUpperCase();

        const [trades, total] = await Promise.all([
            TradeHistory.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            TradeHistory.countDocuments(filter),
        ]);

        res.json({ trades, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── History for specific symbol ───────────────────────────────────────────────
router.get('/history/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const limit  = parseInt(req.query.limit) || 20;
        const trades = await TradeHistory
            .find({ userId: req.user.id, symbol })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
        res.json({ symbol, trades, count: trades.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Modify SL / TP on an open live position ───────────────────────────────────
router.patch('/position/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const { stopLoss, takeProfit } = req.body;

        const ApiKey = require('../models/ApiKey');
        const { decryptData } = require('../utils/encryption');
        const DeltaOrderClient = require('../services/trading/DeltaOrderClient');

        const activeKey = await ApiKey.findOne({ userId: req.user.id, exchange: 'delta', isActive: true });
        if (!activeKey) {
            return res.status(400).json({ error: 'No active API Key found for live trading' });
        }

        const apiKey = decryptData(activeKey.apiKeyEncrypted);
        const apiSecret = decryptData(activeKey.apiSecretEncrypted);
        const client = new DeltaOrderClient(apiKey, apiSecret);

        // Fetch open orders first to inspect existing SL/TP legs
        const openOrdersRes = await client.getOpenOrders(symbol);
        const openOrders = openOrdersRes.result || [];
        const symbolOrders = openOrders.filter(o => o.product_symbol === symbol);

        const slOrder = symbolOrders.find(o => o.stop_order_type === 'stop_loss_order');
        const tpOrder = symbolOrders.find(o => o.stop_order_type === 'take_profit_order');

        // Cancel active SL if it exists
        let cancelledAny = false;
        if (slOrder) {
            try {
                await client.cancelOrder(slOrder.id, symbol);
                cancelledAny = true;
            } catch (err) {
                console.error(`[Trading Route] Failed to cancel SL order ${slOrder.id}:`, err.message);
            }
        }

        // Cancel active TP if it exists
        if (tpOrder) {
            try {
                await client.cancelOrder(tpOrder.id, symbol);
                cancelledAny = true;
            } catch (err) {
                console.error(`[Trading Route] Failed to cancel TP order ${tpOrder.id}:`, err.message);
            }
        }

        // Wait 800ms to ensure the exchange has updated the position's bracket status
        if (cancelledAny) {
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        // Place new bracket order if values are provided
        const hasNewSl = stopLoss !== undefined && stopLoss !== null && stopLoss !== '';
        const hasNewTp = takeProfit !== undefined && takeProfit !== null && takeProfit !== '';

        let result = null;
        if (hasNewSl || hasNewTp) {
            const productCatalog = require('../services/ProductCatalog');
            const prod = productCatalog.getBySymbol(symbol);
            if (!prod) {
                return res.status(404).json({ error: `Product not found for symbol: ${symbol}` });
            }

            const body = {
                product_id: prod.id,
            };

            if (hasNewSl) {
                body.stop_loss_order = {
                    order_type: 'market_order',
                    stop_price: stopLoss.toString()
                };
            }
            if (hasNewTp) {
                body.take_profit_order = {
                    order_type: 'market_order',
                    stop_price: takeProfit.toString()
                };
            }

            try {
                result = await client._request('POST', '/v2/orders/bracket', body);
            } catch (postErr) {
                throw new Error(postErr.message || 'Failed to place bracket order');
            }
        }

        // Force a poll in the background to update the cache instantly
        positionTracker._pollUser(activeKey).catch(err => {
            console.error('[Trading Route] Post-modify poll failed:', err.message);
        });

        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
