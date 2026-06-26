/**
 * PaperTradingEngine.js
 *
 * Simulates order execution and position management for paper trading mode.
 *
 * Features:
 *   - Net position mode: same symbol+direction trades MERGE into one averaged position
 *   - Add-to-position: `addToPosition()` to add more contracts to existing position
 *   - Instant "fill" at current market price (or limit price if specified)
 *   - Real-time P&L updates using live WebSocket prices every 5s
 *   - Automatic SL/TP monitoring and position close
 *   - Wallet balance management (margin lock/release)
 *   - Full TradeHistory record for unified history view
 *
 * Usage:
 *   const paper = require('./PaperTradingEngine');
 *   paper.start(io, wsManager);
 *   const pos = await paper.placeOrder(userId, orderParams);
 */

const PaperWallet   = require('../../models/PaperWallet');
const PaperPosition = require('../../models/PaperPosition');
const TradeHistory  = require('../../models/TradeHistory');
const PaperOrder    = require('../../models/PaperOrder');

// In-memory live price cache: symbol → price (fed from WS manager)
const _prices = new Map();

// Active position IDs being monitored: Set of position._id strings
const _monitoredPositions = new Set();

const UPDATE_INTERVAL_MS = 5000; // 5 seconds

class PaperTradingEngine {
    constructor() {
        this.io       = null;
        this.timer    = null;
        this.running  = false;
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    async start(io, wsManager) {
        if (this.running) return;
        this.io      = io;
        this.running = true;

        // Feed live prices from the WebSocket manager's price map
        if (wsManager) {
            this._wsManager = wsManager;
        }

        // Restore open positions from DB to populate monitored positions set
        try {
            const openPos = await PaperPosition.find({ status: 'open' }).select('_id');
            for (const pos of openPos) {
                _monitoredPositions.add(String(pos._id));
            }
            console.log(`[PaperEngine] 🔄 Restored ${openPos.length} open positions for real-time monitoring`);
        } catch (e) {
            console.error('[PaperEngine] Failed to restore open positions on start:', e.message);
        }

        this.timer = setInterval(() => this._tick(), UPDATE_INTERVAL_MS);
        console.log('[PaperEngine] 📄 Started — simulating trades every 5s');
    }

    stop() {
        this.running = false;
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        console.log('[PaperEngine] Stopped');
    }

    // ─── Update price from WS (called externally by DeltaWebSocketManager) ────

    updatePrice(symbol, price) {
        _prices.set(symbol, parseFloat(price));
    }

    getPrice(symbol) {
        // Try WS manager first for freshest price
        if (this._wsManager?.getPrice) {
            const p = this._wsManager.getPrice(symbol);
            if (p) return p;
        }
        return _prices.get(symbol) || null;
    }

    // ─── Place a paper order (net position mode) ───────────────────────────────

    /**
     * Simulate an order fill.
     * If an open position for the same symbol+side already exists, MERGE into it (weighted avg entry).
     * @param {string} userId
     * @param {object} params — { symbol, side, size, orderType, price, stopLoss, takeProfit, leverage, signalId }
     * @param {object} io
     * @returns {object} { position, tradeHistory, wallet }
     */
    async placeOrder(userId, params, io = null) {
        const currentPrice = this.getPrice(params.symbol);
        if (!currentPrice) {
            throw new Error(`No live price available for ${params.symbol}. Try again in a moment.`);
        }

        const fillPrice = params.orderType === 'limit_order' && params.price
            ? parseFloat(params.price)
            : currentPrice;

        const leverage  = parseInt(params.leverage) || 1;
        const size      = parseInt(params.size) || 1;
        const margin    = (fillPrice * size) / leverage;

        // Check wallet has enough margin
        const wallet = await this._getOrCreateWallet(userId);
        if (wallet.available < margin) {
            throw new Error(
                `Insufficient paper margin. Need $${margin.toFixed(2)} but only $${wallet.available.toFixed(2)} available.`
            );
        }

        let shouldFillImmediately = true;
        if (params.orderType === 'limit_order') {
            const limitPrice = parseFloat(params.price);
            if (params.side === 'buy' && currentPrice > limitPrice) {
                shouldFillImmediately = false;
            } else if (params.side === 'sell' && currentPrice < limitPrice) {
                shouldFillImmediately = false;
            }
        }

        if (!shouldFillImmediately) {
            // Lock margin in wallet
            wallet.available -= margin;
            wallet.used      += margin;
            await wallet.save();

            // Create PaperOrder
            const order = await PaperOrder.create({
                userId,
                symbol: params.symbol.toUpperCase(),
                side: params.side,
                size,
                orderType: 'limit_order',
                price: fillPrice,
                stopLoss: params.stopLoss ? parseFloat(params.stopLoss) : null,
                takeProfit: params.takeProfit ? parseFloat(params.takeProfit) : null,
                leverage,
                status: 'open',
                signalId: params.signalId || null,
            });

            // Create TradeHistory record (mode: 'paper', status: 'open')
            const history = await TradeHistory.create({
                userId,
                symbol:    params.symbol.toUpperCase(),
                side:      params.side,
                orderType: 'limit_order',
                size,
                price:     fillPrice,
                leverage,
                stopLoss:  params.stopLoss ? parseFloat(params.stopLoss) : null,
                takeProfit: params.takeProfit ? parseFloat(params.takeProfit) : null,
                status:    'open',
                mode:      'paper',
                orderId:   String(order._id),
                signalId:  params.signalId || null,
                source:    params.signalId ? 'signal' : 'paper',
            });

            const _io = io || this.io;
            _io?.emit('paper_order_placed', { order: order.toObject(), wallet: wallet.toObject() });
            _io?.to(`user:${userId}`).emit('paper_order_placed', { order: order.toObject(), wallet: wallet.toObject() });

            return { order, tradeHistory: history, wallet };
        }

        // ── Net position mode: check if same symbol+side position already exists ──
        const existingPos = await PaperPosition.findOne({
            userId,
            symbol: params.symbol.toUpperCase(),
            side: params.side,
            status: 'open',
        });

        let position;

        if (existingPos) {
            // MERGE: weighted average entry
            const totalSize   = existingPos.size + size;
            const avgEntry    = (existingPos.entryPrice * existingPos.size + fillPrice * size) / totalSize;
            const totalMargin = existingPos.marginUsed + margin;

            // Recalculate liquidation price based on new avg entry + leverage
            const liqPrice = params.side === 'buy'
                ? avgEntry * (1 - 1 / leverage)
                : avgEntry * (1 + 1 / leverage);

            existingPos.entryPrice      = avgEntry;
            existingPos.size            = totalSize;
            existingPos.marginUsed      = totalMargin;
            existingPos.liquidationPrice = liqPrice;
            // Keep existing SL/TP unless new ones are provided
            if (params.stopLoss   != null) existingPos.stopLoss   = parseFloat(params.stopLoss);
            if (params.takeProfit != null) existingPos.takeProfit = parseFloat(params.takeProfit);
            await existingPos.save();
            position = existingPos;

            console.log(`[PaperEngine] 🔀 Merged ${params.side.toUpperCase()} ${size} ${params.symbol} → avg entry $${avgEntry.toFixed(4)} | total ${totalSize} contracts`);
        } else {
            // NEW position
            const liqPrice = params.side === 'buy'
                ? fillPrice * (1 - 1 / leverage)
                : fillPrice * (1 + 1 / leverage);

            position = await PaperPosition.create({
                userId,
                symbol:      params.symbol.toUpperCase(),
                side:        params.side,
                size,
                entryPrice:  fillPrice,
                leverage,
                stopLoss:    params.stopLoss ? parseFloat(params.stopLoss) : null,
                takeProfit:  params.takeProfit ? parseFloat(params.takeProfit) : null,
                marginUsed:  margin,
                markPrice:   fillPrice,
                unrealisedPnl: 0,
                roe:         0,
                liquidationPrice: liqPrice,
                signalId:    params.signalId || null,
            });

            console.log(`[PaperEngine] ✅ Paper ${params.side.toUpperCase()} ${size} ${params.symbol} @ $${fillPrice} | Margin: $${margin.toFixed(2)}`);
        }

        _monitoredPositions.add(String(position._id));

        // Lock margin in wallet
        wallet.available  -= margin;
        wallet.used       += margin;

        const openPositions = await PaperPosition.find({ userId, status: 'open' });
        let totalUnrealised = 0;
        for (const pos of openPositions) {
            totalUnrealised += pos.unrealisedPnl || 0;
        }
        wallet.equity = wallet.balance + totalUnrealised;
        await wallet.save();

        // Create TradeHistory record (mode: 'paper')
        const history = await TradeHistory.create({
            userId,
            symbol:    params.symbol.toUpperCase(),
            side:      params.side,
            orderType: params.orderType || 'market_order',
            size,
            price:     params.price ? parseFloat(params.price) : null,
            leverage,
            stopLoss:  params.stopLoss ? parseFloat(params.stopLoss) : null,
            takeProfit: params.takeProfit ? parseFloat(params.takeProfit) : null,
            status:    'filled',
            filledPrice: fillPrice,
            filledSize:  size,
            filledAt:    new Date(),
            mode:        'paper',
            signalId:    params.signalId || null,
            source:      params.signalId ? 'signal' : 'paper',
        });

        // Link TradeHistory to position
        position.tradeHistoryId = history._id;
        await position.save();

        const _io = io || this.io;
        _io?.emit('paper_order_placed', { position: position.toObject(), wallet: wallet.toObject() });
        _io?.to(`user:${userId}`).emit('paper_order_placed', { position: position.toObject(), wallet: wallet.toObject() });

        return { position, tradeHistory: history, wallet };
    }

    async _fillPaperOrder(order, fillPrice, io = null) {
        const existingPos = await PaperPosition.findOne({
            userId: order.userId,
            symbol: order.symbol,
            side: order.side,
            status: 'open',
        });

        let position;
        const leverage  = order.leverage;
        const size      = order.size;
        const margin    = (fillPrice * size) / leverage;

        if (existingPos) {
            // MERGE
            const totalSize   = existingPos.size + size;
            const avgEntry    = (existingPos.entryPrice * existingPos.size + fillPrice * size) / totalSize;
            const totalMargin = existingPos.marginUsed + margin;
            const liqPrice = order.side === 'buy'
                ? avgEntry * (1 - 1 / leverage)
                : avgEntry * (1 + 1 / leverage);

            existingPos.entryPrice      = avgEntry;
            existingPos.size            = totalSize;
            existingPos.marginUsed      = totalMargin;
            existingPos.liquidationPrice = liqPrice;
            if (order.stopLoss   != null) existingPos.stopLoss   = order.stopLoss;
            if (order.takeProfit != null) existingPos.takeProfit = order.takeProfit;
            await existingPos.save();
            position = existingPos;

            console.log(`[PaperEngine] 🔀 Merged open order fill ${order.side.toUpperCase()} ${size} ${order.symbol} → avg entry $${avgEntry.toFixed(4)}`);
        } else {
            // NEW position
            const liqPrice = order.side === 'buy'
                ? fillPrice * (1 - 1 / leverage)
                : fillPrice * (1 + 1 / leverage);

            position = await PaperPosition.create({
                userId: order.userId,
                symbol:      order.symbol,
                side:        order.side,
                size,
                entryPrice:  fillPrice,
                leverage,
                stopLoss:    order.stopLoss,
                takeProfit:  order.takeProfit,
                marginUsed:  margin,
                markPrice:   fillPrice,
                unrealisedPnl: 0,
                roe:         0,
                liquidationPrice: liqPrice,
                signalId:    order.signalId || null,
            });

            console.log(`[PaperEngine] ✅ Open order filled ${order.side.toUpperCase()} ${size} ${order.symbol} @ $${fillPrice}`);
        }

        _monitoredPositions.add(String(position._id));

        // Mark PaperOrder as filled
        order.status = 'filled';
        await order.save();

        // Update corresponding TradeHistory record
        const history = await TradeHistory.findOne({ orderId: String(order._id) });
        if (history) {
            history.status = 'filled';
            history.filledPrice = fillPrice;
            history.filledSize = size;
            history.filledAt = new Date();
            await history.save();

            position.tradeHistoryId = history._id;
            await position.save();
        }

        // Available/used margin already shifted when placing the order, so just update equity
        const wallet = await this._getOrCreateWallet(order.userId);
        const openPositions = await PaperPosition.find({ userId: order.userId, status: 'open' });
        let totalUnrealised = 0;
        for (const pos of openPositions) {
            totalUnrealised += pos.unrealisedPnl || 0;
        }
        wallet.equity = wallet.balance + totalUnrealised;
        await wallet.save();

        const _io = io || this.io;
        _io?.emit('paper_position_updated', position.toObject());
        _io?.to(`user:${order.userId}`).emit('paper_position_updated', position.toObject());

        return { position, wallet };
    }

    // ─── Add more contracts to an existing open position ──────────────────────

    /**
     * Add contracts to an existing open paper position (average in/out).
     * @param {string} userId
     * @param {string} positionId
     * @param {object} params — { size, price (optional) }
     * @param {object} io
     * @returns {object} { position, wallet }
     */
    async addToPosition(userId, positionId, params, io = null) {
        const position = await PaperPosition.findOne({ _id: positionId, userId, status: 'open' });
        if (!position) throw new Error('Paper position not found or already closed');

        const addSize = parseInt(params.size);
        if (!addSize || addSize < 1) throw new Error('size must be a positive integer');

        const currentPrice = this.getPrice(position.symbol);
        const fillPrice    = params.price ? parseFloat(params.price) : currentPrice;
        if (!fillPrice) throw new Error(`No live price available for ${position.symbol}. Try again.`);

        const addMargin = (fillPrice * addSize) / position.leverage;

        // Check wallet has enough margin
        const wallet = await this._getOrCreateWallet(userId);
        if (wallet.available < addMargin) {
            throw new Error(
                `Insufficient paper margin. Need $${addMargin.toFixed(2)} but only $${wallet.available.toFixed(2)} available.`
            );
        }

        // Weighted average entry price
        const totalSize   = position.size + addSize;
        const avgEntry    = (position.entryPrice * position.size + fillPrice * addSize) / totalSize;
        const totalMargin = position.marginUsed + addMargin;

        // Recalculate liquidation price
        const liqPrice = position.side === 'buy'
            ? avgEntry * (1 - 1 / position.leverage)
            : avgEntry * (1 + 1 / position.leverage);

        position.entryPrice      = avgEntry;
        position.size            = totalSize;
        position.marginUsed      = totalMargin;
        position.liquidationPrice = liqPrice;
        await position.save();

        // Lock extra margin
        wallet.available -= addMargin;
        wallet.used      += addMargin;
        await wallet.save();

        console.log(`[PaperEngine] ➕ Added ${addSize} contracts to ${position.symbol} ${position.side.toUpperCase()} → new avg $${avgEntry.toFixed(4)} | ${totalSize} total`);

        const _io = io || this.io;
        _io?.emit('paper_position_updated', position.toObject());
        _io?.to(`user:${userId}`).emit('paper_position_updated', position.toObject());

        return { position, wallet };
    }

    // ─── Manually close a position ─────────────────────────────────────────────

    async closePosition(userId, positionId, io = null) {
        const position = await PaperPosition.findOne({ _id: positionId, userId, status: 'open' });
        if (!position) throw new Error('Paper position not found or already closed');

        const closePrice = this.getPrice(position.symbol) || position.markPrice || position.entryPrice;
        return this._closePosition(position, closePrice, 'closed_manual', io || this.io);
    }

    // ─── Internal: close with P&L ─────────────────────────────────────────────

    async _closePosition(position, closePrice, status, io = null) {
        const pnl = this._calcPnl(position, closePrice);

        // Update position
        position.status      = status;
        position.closePrice  = closePrice;
        position.realisedPnl = pnl;
        position.closedAt    = new Date();
        position.unrealisedPnl = 0;
        await position.save();

        _monitoredPositions.delete(String(position._id));

        // Release margin + apply PnL to wallet
        const wallet = await this._getOrCreateWallet(String(position.userId));
        wallet.available  += position.marginUsed + pnl;
        wallet.used       = Math.max(0, wallet.used - position.marginUsed);
        wallet.balance    += pnl;
        wallet.totalRealised += pnl;
        wallet.totalTrades += 1;
        if (pnl >= 0) wallet.totalWins += 1;
        else wallet.totalLosses += 1;
        const openPositions = await PaperPosition.find({ userId: position.userId, status: 'open' });
        let totalUnrealised = 0;
        for (const pos of openPositions) {
            if (String(pos._id) !== String(position._id)) {
                totalUnrealised += pos.unrealisedPnl || 0;
            }
        }
        wallet.equity = wallet.balance + totalUnrealised;

        if (wallet.equity > wallet.peakEquity) wallet.peakEquity = wallet.equity;
        const dd = ((wallet.peakEquity - wallet.equity) / wallet.peakEquity) * 100;
        if (dd > wallet.maxDrawdown) wallet.maxDrawdown = dd;
        await wallet.save();

        // Update TradeHistory record if exists
        if (position.tradeHistoryId) {
            await TradeHistory.findByIdAndUpdate(position.tradeHistoryId, {
                status: 'filled',
                closedAt: new Date(),
                closePrice,
                realisedPnl: pnl,
                pnlPct: position.marginUsed > 0 ? (pnl / position.marginUsed) * 100 : 0,
                isWin: pnl >= 0,
            });
        }

        console.log(`[PaperEngine] ${pnl >= 0 ? '✅' : '❌'} Paper closed ${position.symbol} @ $${closePrice} | PnL: $${pnl.toFixed(2)}`);

        if (io) {
            const userId = String(position.userId);
            const data = { position: position.toObject(), pnl, wallet: wallet.toObject() };
            io.to(`user:${userId}`).emit('paper_position_closed', data);
            io.emit('paper_position_closed', data);
        }

        return { position, pnl, wallet };
    }

    // ─── P&L calculation ───────────────────────────────────────────────────────

    _calcPnl(position, currentPrice) {
        const { side, entryPrice, size, leverage } = position;
        const priceDiff = side === 'buy'
            ? currentPrice - entryPrice
            : entryPrice - currentPrice;
        return priceDiff * size;
    }

    _calcUnrealised(position, currentPrice) {
        return this._calcPnl(position, currentPrice);
    }

    // ─── Get or create wallet ─────────────────────────────────────────────────

    async _getOrCreateWallet(userId) {
        let wallet = await PaperWallet.findOne({ userId });
        if (!wallet) {
            wallet = await PaperWallet.create({ userId });
        }
        return wallet;
    }

    // ─── Tick: update live P&L and check SL/TP ────────────────────────────────

    async _tick() {
        if (!this.running) return;

        // ── Process open limit orders ──
        try {
            const openOrders = await PaperOrder.find({ status: 'open' });
            for (const order of openOrders) {
                const price = this.getPrice(order.symbol);
                if (!price) continue;

                const isBuy = order.side === 'buy';
                const conditionMet = isBuy ? price <= order.price : price >= order.price;
                if (conditionMet) {
                    try {
                        await this._fillPaperOrder(order, price);
                    } catch (fillErr) {
                        console.error(`[PaperEngine] Failed to fill open order ${order._id}:`, fillErr.message);
                    }
                }
            }
        } catch (orderErr) {
            console.error('[PaperEngine] Error querying open orders in tick:', orderErr.message);
        }

        if (_monitoredPositions.size === 0) return;

        const positions = await PaperPosition.find({
            _id: { $in: [..._monitoredPositions] },
            status: 'open',
        });

        for (const pos of positions) {
            try {
                const price = this.getPrice(pos.symbol);
                if (!price) continue;

                const unrealisedPnl = this._calcUnrealised(pos, price);
                const roe = pos.marginUsed > 0 ? (unrealisedPnl / pos.marginUsed) * 100 : 0;

                // Update mark price + P&L in DB
                pos.markPrice     = price;
                pos.unrealisedPnl = unrealisedPnl;
                pos.roe           = roe;
                await pos.save();

                // Emit to user room
                const userId = String(pos.userId);
                this.io?.to(`user:${userId}`).emit('paper_pnl_update', {
                    positionId: String(pos._id),
                    symbol:     pos.symbol,
                    markPrice:  price,
                    unrealisedPnl,
                    roe,
                });

                // ── Auto-close on SL/TP hit ──
                const isBuy = pos.side === 'buy';

                if (pos.takeProfit) {
                    const tpHit = isBuy ? price >= pos.takeProfit : price <= pos.takeProfit;
                    if (tpHit) {
                        await this._closePosition(pos, price, 'closed_tp', this.io);
                        continue;
                    }
                }

                if (pos.stopLoss) {
                    const slHit = isBuy ? price <= pos.stopLoss : price >= pos.stopLoss;
                    if (slHit) {
                        await this._closePosition(pos, price, 'closed_sl', this.io);
                        continue;
                    }
                }

                // Liquidation check
                if (pos.liquidationPrice) {
                    const liqHit = isBuy ? price <= pos.liquidationPrice : price >= pos.liquidationPrice;
                    if (liqHit) {
                        await this._closePosition(pos, pos.liquidationPrice, 'closed_sl', this.io);
                    }
                }

            } catch (err) {
                console.error(`[PaperEngine] Tick error on ${pos.symbol}:`, err.message);
            }
        }
    }

    // ─── Public helpers ────────────────────────────────────────────────────────

    async getWallet(userId) {
        const wallet = await this._getOrCreateWallet(userId);
        const openPositions = await PaperPosition.find({ userId, status: 'open' });
        let totalUnrealised = 0;
        for (const pos of openPositions) {
            totalUnrealised += pos.unrealisedPnl || 0;
        }
        wallet.equity = wallet.balance + totalUnrealised;
        await wallet.save();
        return wallet;
    }

    async getOpenPositions(userId) {
        return PaperPosition.find({ userId, status: 'open' }).lean();
    }

    async getHistory(userId, limit = 50) {
        return PaperPosition.find({ userId, status: { $ne: 'open' } })
            .sort({ closedAt: -1 })
            .limit(limit)
            .lean();
    }
}

module.exports = new PaperTradingEngine();
