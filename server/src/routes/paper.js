/**
 * routes/paper.js
 *
 * Paper trading REST endpoints — Phase 8.
 *
 * POST /api/paper/order          — Place a simulated order
 * POST /api/paper/close/:id      — Manually close a paper position
 * GET  /api/paper/positions      — Get open paper positions
 * GET  /api/paper/wallet         — Get paper wallet state
 * GET  /api/paper/history        — Closed paper positions
 * POST /api/paper/reset          — Reset wallet to starting balance
 * GET  /api/paper/stats          — Performance summary
 */

const express = require('express');
const authenticate = require('../middleware/auth');
const paperEngine  = require('../services/trading/PaperTradingEngine');
const PaperWallet  = require('../models/PaperWallet');
const PaperPosition = require('../models/PaperPosition');
const TradeHistory   = require('../models/TradeHistory');
const PaperOrder     = require('../models/PaperOrder');

const router = express.Router();
router.use(authenticate);

router.use((req, _res, next) => {
    req.io = req.app.get('io');
    next();
});

// ── Place paper order ─────────────────────────────────────────────────────────
router.post('/order', async (req, res) => {
    try {
        const { symbol, side, size, orderType = 'market_order',
                price, stopLoss, takeProfit, leverage = 1, signalId } = req.body;

        if (!symbol || !side || !size) {
            return res.status(400).json({ error: 'symbol, side, and size are required' });
        }
        if (!['buy', 'sell'].includes(side)) {
            return res.status(400).json({ error: 'side must be "buy" or "sell"' });
        }
        if (parseInt(size) < 1) {
            return res.status(400).json({ error: 'size must be a positive integer' });
        }

        const result = await paperEngine.placeOrder(
            req.user.id,
            {
                symbol: symbol.toUpperCase(),
                side,
                size:       parseInt(size),
                orderType,
                price:      price ? parseFloat(price) : null,
                stopLoss:   stopLoss   ? parseFloat(stopLoss) : null,
                takeProfit: takeProfit ? parseFloat(takeProfit) : null,
                leverage:   parseInt(leverage),
                signalId,
            },
            req.io
        );

        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(err.message?.includes('Insufficient') ? 400 : 500).json({ error: err.message });
    }
});

// ── Close a paper position ────────────────────────────────────────────────────
router.post('/close/:id', async (req, res) => {
    try {
        const result = await paperEngine.closePosition(req.user.id, req.params.id, req.io);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// ── Modify SL / TP on an open position ────────────────────────────────────────
router.patch('/position/:id', async (req, res) => {
    try {
        const { stopLoss, takeProfit } = req.body;
        const pos = await PaperPosition.findOne({ _id: req.params.id, userId: req.user.id, status: 'open' });
        if (!pos) return res.status(404).json({ error: 'Position not found' });

        if (stopLoss  !== undefined) pos.stopLoss  = stopLoss  === null ? null : parseFloat(stopLoss);
        if (takeProfit !== undefined) pos.takeProfit = takeProfit === null ? null : parseFloat(takeProfit);
        await pos.save();

        // Emit update so frontend refreshes in real-time
        if (req.io) req.io.emit('paper_position_updated', pos.toObject());

        res.json({ success: true, position: pos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Partial close ─────────────────────────────────────────────────────────────
router.post('/partial-close/:id', async (req, res) => {
    try {
        const { size } = req.body;
        if (!size || parseInt(size) < 1) return res.status(400).json({ error: 'size required' });

        const pos = await PaperPosition.findOne({ _id: req.params.id, userId: req.user.id, status: 'open' });
        if (!pos) return res.status(404).json({ error: 'Position not found' });

        const closeSize = Math.min(parseInt(size), pos.size);
        if (closeSize >= pos.size) {
            // Full close
            const result = await paperEngine.closePosition(req.user.id, req.params.id, req.io);
            return res.json({ success: true, fullyClosedI: true, ...result });
        }

        // Partial: reduce position size and release proportional margin
        const price       = paperEngine.getPrice(pos.symbol) || pos.entryPrice;
        const priceDiff   = pos.side === 'buy' ? (price - pos.entryPrice) : (pos.entryPrice - price);
        const pnlPerUnit  = priceDiff;                          // per contract
        const closedPnl   = pnlPerUnit * closeSize;
        const marginPerUnit = pos.marginUsed / pos.size;
        const marginReleased = marginPerUnit * closeSize;

        // Update position
        pos.size      -= closeSize;
        pos.marginUsed -= marginReleased;
        await pos.save();

        // Credit wallet
        const wallet = await PaperWallet.findOne({ userId: req.user.id });
        if (wallet) {
            wallet.balance   += marginReleased + closedPnl;
            wallet.available += marginReleased + closedPnl;
            wallet.used      -= marginReleased;
            wallet.totalRealised += closedPnl;
            if (closedPnl > 0) wallet.totalWins++; else wallet.totalLosses++;
            wallet.totalTrades++;
            await wallet.save();
        }

        if (req.io) req.io.emit('paper_position_updated', pos.toObject());
        res.json({ success: true, fullyClosedI: false, closedSize: closeSize, pnl: closedPnl, remaining: pos.size });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ── Add contracts to an existing open position ────────────────────────────────
router.post('/add/:id', async (req, res) => {
    try {
        const { size, price } = req.body;
        if (!size || parseInt(size) < 1) {
            return res.status(400).json({ error: 'size must be a positive integer' });
        }
        const result = await paperEngine.addToPosition(
            req.user.id,
            req.params.id,
            { size: parseInt(size), price: price ? parseFloat(price) : null },
            req.io
        );
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.message?.includes('Insufficient') ? 400 : 500).json({ error: err.message });
    }
});

// ── Open positions ────────────────────────────────────────────────────────────
router.get('/positions', async (req, res) => {
    try {
        const positions = await paperEngine.getOpenPositions(req.user.id);
        res.json({ positions, count: positions.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Paper wallet ──────────────────────────────────────────────────────────────
router.get('/wallet', async (req, res) => {
    try {
        const wallet = await paperEngine.getWallet(req.user.id);
        res.json({ wallet });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Closed position history ───────────────────────────────────────────────────
router.get('/history', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const history = await paperEngine.getHistory(req.user.id, limit);
        res.json({ history, count: history.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Reset paper wallet to default balance ─────────────────────────────────────
router.post('/reset', async (req, res) => {
    try {
        const startBalance = parseFloat(req.body.balance) || 10000;
        if (startBalance < 100 || startBalance > 1_000_000) {
            return res.status(400).json({ error: 'Starting balance must be between $100 and $1,000,000' });
        }

        // Close all open positions (market close)
        const openPositions = await PaperPosition.find({ userId: req.user.id, status: 'open' });
        for (const pos of openPositions) {
            const price = paperEngine.getPrice(pos.symbol) || pos.entryPrice;
            await paperEngine._closePosition(pos, price, 'closed_manual', null);
        }

        // Delete all closed paper positions, trade history, and open orders
        await PaperPosition.deleteMany({ userId: req.user.id, status: { $ne: 'open' } });
        await TradeHistory.deleteMany({ userId: req.user.id, mode: 'paper' });
        await PaperOrder.deleteMany({ userId: req.user.id });

        // Reset wallet
        let wallet = await PaperWallet.findOne({ userId: req.user.id });
        if (!wallet) {
            wallet = new PaperWallet({ userId: req.user.id });
        }
        wallet.balance        = startBalance;
        wallet.equity         = startBalance;
        wallet.available      = startBalance;
        wallet.used           = 0;
        wallet.startingBalance = startBalance;
        wallet.totalRealised  = 0;
        wallet.totalWins      = 0;
        wallet.totalLosses    = 0;
        wallet.totalTrades    = 0;
        wallet.peakEquity     = startBalance;
        wallet.maxDrawdown    = 0;
        await wallet.save();

        res.json({ success: true, wallet });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Performance stats ─────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
    try {
        const wallet = await paperEngine.getWallet(req.user.id);
        const openPositions = await PaperPosition.countDocuments({ userId: req.user.id, status: 'open' });

        // Best & worst trades
        const [best, worst] = await Promise.all([
            PaperPosition.findOne({ userId: req.user.id, status: { $ne: 'open' } }).sort({ realisedPnl: -1 }).lean(),
            PaperPosition.findOne({ userId: req.user.id, status: { $ne: 'open' } }).sort({ realisedPnl: 1 }).lean(),
        ]);

        res.json({
            wallet,
            openPositions,
            bestTrade:  best  ? { symbol: best.symbol, pnl: best.realisedPnl }  : null,
            worstTrade: worst ? { symbol: worst.symbol, pnl: worst.realisedPnl } : null,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Open orders ──────────────────────────────────────────────────────────────
router.get('/open-orders', async (req, res) => {
    try {
        const rawOrders = await PaperOrder.find({ userId: req.user.id, status: 'open' }).lean();

        const openOrders = rawOrders.map(o => ({
            id: o._id.toString(),
            symbol: o.symbol,
            side: o.side,
            orderType: o.orderType,
            size: o.size,
            unfilledSize: o.size,
            limitPrice: o.price,
            stopPrice: null,
            stopOrderType: null,
            bracketStopLossPrice: o.stopLoss,
            bracketTakeProfitPrice: o.takeProfit,
            createdAt: o.createdAt
        }));

        res.json({ openOrders });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Edit open order ──────────────────────────────────────────────────────────
router.put('/order', async (req, res) => {
    try {
        const { id, size, limitPrice, bracketStopLossPrice, bracketTakeProfitPrice } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'id is required' });
        }

        const order = await PaperOrder.findOne({ _id: id, userId: req.user.id, status: 'open' });
        if (!order) {
            return res.status(404).json({ error: 'Open order not found' });
        }

        const oldPrice = order.price || 0;
        const oldSize = order.size || 0;
        const oldMargin = (oldPrice * oldSize) / order.leverage;

        if (size !== undefined) order.size = parseInt(size);
        if (limitPrice !== undefined) order.price = parseFloat(limitPrice);
        if (bracketStopLossPrice !== undefined) order.stopLoss = bracketStopLossPrice === null ? null : parseFloat(bracketStopLossPrice);
        if (bracketTakeProfitPrice !== undefined) order.takeProfit = bracketTakeProfitPrice === null ? null : parseFloat(bracketTakeProfitPrice);

        const newMargin = (order.price * order.size) / order.leverage;
        const marginDifference = newMargin - oldMargin;

        const wallet = await paperEngine._getOrCreateWallet(req.user.id);
        if (wallet.available < marginDifference) {
            return res.status(400).json({ error: `Insufficient margin to update order. Need $${marginDifference.toFixed(2)} more.` });
        }

        wallet.available -= marginDifference;
        wallet.used += marginDifference;
        await wallet.save();

        await order.save();

        // Also update the TradeHistory record associated with it
        const tradeHistory = await TradeHistory.findOne({ orderId: id, userId: req.user.id, status: 'open' });
        if (tradeHistory) {
            tradeHistory.size = order.size;
            tradeHistory.price = order.price;
            tradeHistory.stopLoss = order.stopLoss;
            tradeHistory.takeProfit = order.takeProfit;
            await tradeHistory.save();
        }

        if (req.io) {
            req.io.to(`user:${req.user.id}`).emit('paper_order_placed', { order: order.toObject(), wallet: wallet.toObject() });
        }

        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Cancel open order ────────────────────────────────────────────────────────
router.delete('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await PaperOrder.findOne({ _id: orderId, userId: req.user.id, status: 'open' });
        if (!order) {
            return res.status(404).json({ error: 'Open order not found' });
        }

        order.status = 'cancelled';
        await order.save();

        // Refund locked margin
        const margin = (order.price * order.size) / order.leverage;
        const wallet = await paperEngine._getOrCreateWallet(req.user.id);
        wallet.available += margin;
        wallet.used = Math.max(0, wallet.used - margin);
        await wallet.save();

        // Update trade history
        const tradeHistory = await TradeHistory.findOne({ orderId, userId: req.user.id, status: 'open' });
        if (tradeHistory) {
            tradeHistory.status = 'cancelled';
            await tradeHistory.save();
        }

        if (req.io) {
            req.io.to(`user:${req.user.id}`).emit('paper_order_placed', { order: order.toObject(), wallet: wallet.toObject() });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
