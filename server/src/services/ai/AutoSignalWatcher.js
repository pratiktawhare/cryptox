/**
 * AutoSignalWatcher.js
 *
 * Background service for the AI Automation pipeline.
 * Monitors pending limit orders (both live and paper mode) every 10 seconds.
 *
 * LIVE mode: polls TradeHistory records with status='pending_limit'
 *   - Filled  → marks status='filled', logs fill price
 *   - Cancelled/rejected on exchange → marks status='cancelled'
 *   - >15 min unfilled → cancels ONLY that entry order by ID (never cancelAllOrders),
 *                        marks status='entry_timeout'
 *
 * PAPER mode: polls PaperOrder records with status='open' and orderType='limit_order'
 *   - Current price reaches limit price → fills the paper order (creates PaperPosition)
 *   - >15 min unfilled → cancels paper order, releases locked margin
 *
 * Safety guarantee: cancelOrder(orderId) cancels only the entry. Bracket TP/SL
 * is attached to the entry order and hasn't activated yet — so cancelling the entry
 * cleans everything. Other open positions on other symbols are completely untouched.
 */

const TradeHistory    = require('../../models/TradeHistory');
const PaperOrder      = require('../../models/PaperOrder');
const PaperPosition   = require('../../models/PaperPosition');
const PaperWallet     = require('../../models/PaperWallet');
const ApiKey          = require('../../models/ApiKey');
const DeltaOrderClient = require('../trading/DeltaOrderClient');
const { decryptData } = require('../../utils/encryption');
const productCatalog   = require('../ProductCatalog');

const ENTRY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const POLL_INTERVAL_MS = 10_000;          // 10 seconds

class AutoSignalWatcher {
    constructor() {
        this.io         = null;
        this.wsManager  = null;
        this._timer     = null;
        this._busy      = false;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────

    start(io = null, wsManager = null) {
        if (this._timer) return;
        this.io        = io;
        this.wsManager = wsManager;
        this._timer    = setInterval(() => this._tick(), POLL_INTERVAL_MS);
        console.log(`[AutoSignalWatcher] ⏳ Started — monitoring pending limit orders every ${POLL_INTERVAL_MS / 1000}s (timeout: 15 min)`);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            console.log('[AutoSignalWatcher] Stopped.');
        }
    }

    // ── Main Tick ───────────────────────────────────────────────────────────────

    async _tick() {
        if (this._busy) return;
        this._busy = true;
        try {
            await Promise.all([
                this._checkLivePending(),
                this._checkPaperPending(),
            ]);
        } catch (err) {
            console.error('[AutoSignalWatcher] Tick error:', err.message);
        } finally {
            this._busy = false;
        }
    }

    // ── Live Mode ───────────────────────────────────────────────────────────────

    async _checkLivePending() {
        const pending = await TradeHistory.find({
            mode: 'live',
            status: 'pending_limit',
            orderId: { $ne: null },
        });
        if (!pending.length) return;

        // Group by userId to reuse client instances
        const byUser = {};
        for (const th of pending) {
            const uid = String(th.userId);
            if (!byUser[uid]) byUser[uid] = [];
            byUser[uid].push(th);
        }

        for (const [userId, records] of Object.entries(byUser)) {
            const client = await this._buildDeltaClient(userId);
            if (!client) continue;

            for (const th of records) {
                try {
                    await this._checkLiveOrder(th, client);
                } catch (err) {
                    console.error(`[AutoSignalWatcher] Live check error for order ${th.orderId}:`, err.message);
                }
            }
        }
    }

    async _checkLiveOrder(th, client) {
        let orderData;
        try {
            const resp = await client.getOrder(th.orderId);
            orderData  = resp?.result;
        } catch (err) {
            console.warn(`[AutoSignalWatcher] Cannot fetch order ${th.orderId}:`, err.message);
            return;
        }
        if (!orderData) return;

        const state = orderData.state;

        // ── Filled ──────────────────────────────────────────────────────────────
        if (state === 'closed' || state === 'filled') {
            const fillPrice = orderData.average_fill_price
                ? parseFloat(orderData.average_fill_price)
                : th.price;
            const fillSize = orderData.size_filled
                ? parseInt(orderData.size_filled)
                : th.size;

            th.status      = 'filled';
            th.filledPrice = fillPrice;
            th.filledSize  = fillSize;
            th.filledAt    = new Date();
            await th.save();

            console.log(`[AutoSignalWatcher] ✅ [Live] Order ${th.orderId} filled @ $${fillPrice} for ${th.symbol}`);
            this._emit(`user:${th.userId}`, 'automation_order_filled', {
                mode: 'live', symbol: th.symbol, orderId: th.orderId, fillPrice, fillSize,
            });
            return;
        }

        // ── Cancelled / rejected by exchange ────────────────────────────────────
        if (state === 'cancelled' || state === 'rejected') {
            th.status = 'cancelled';
            await th.save();
            console.log(`[AutoSignalWatcher] ❌ [Live] Order ${th.orderId} was ${state} by exchange for ${th.symbol}`);
            this._emit(`user:${th.userId}`, 'automation_order_cancelled', {
                mode: 'live', symbol: th.symbol, orderId: th.orderId, reason: `exchange_${state}`,
            });
            return;
        }

        // ── 15-minute timeout ───────────────────────────────────────────────────
        const placedAt = th.entryOrderPlacedAt || th.createdAt;
        const elapsed  = Date.now() - new Date(placedAt).getTime();
        if (elapsed >= ENTRY_TIMEOUT_MS) {
            console.log(`[AutoSignalWatcher] ⏰ [Live] Order ${th.orderId} timed out (${Math.round(elapsed / 60000)} min) for ${th.symbol}. Cancelling entry only.`);

            try {
                await client.cancelOrder(th.orderId, th.symbol);
            } catch (cancelErr) {
                console.warn(`[AutoSignalWatcher] Cancel order ${th.orderId} warn:`, cancelErr.message);
            }

            th.status = 'entry_timeout';
            await th.save();

            this._emit(`user:${th.userId}`, 'automation_order_timeout', {
                mode: 'live', symbol: th.symbol, orderId: th.orderId, elapsedMin: Math.round(elapsed / 60000),
            });
        }
    }

    // ── Paper Mode ──────────────────────────────────────────────────────────────

    async _checkPaperPending() {
        const pendingOrders = await PaperOrder.find({
            orderType: 'limit_order',
            status:    'open',
        });
        if (!pendingOrders.length) return;

        for (const order of pendingOrders) {
            try {
                await this._checkPaperOrder(order);
            } catch (err) {
                console.error(`[AutoSignalWatcher] Paper check error for order ${order._id}:`, err.message);
            }
        }
    }

    async _checkPaperOrder(order) {
        const currentPrice = this.wsManager?.getPrice?.(order.symbol);

        // ── Price reached the limit — fill the paper order ──────────────────────
        if (currentPrice) {
            const limitPrice = parseFloat(order.price);
            const shouldFill = order.side === 'buy'
                ? currentPrice <= limitPrice   // buy limit: fill when price drops to or below limit
                : currentPrice >= limitPrice;  // sell limit: fill when price rises to or above limit

            if (shouldFill) {
                await this._fillPaperOrder(order, limitPrice);
                return;
            }
        }

        // ── 15-minute timeout ───────────────────────────────────────────────────
        const placedAt = order.entryOrderPlacedAt || order.createdAt;
        const elapsed  = Date.now() - new Date(placedAt).getTime();
        if (elapsed >= ENTRY_TIMEOUT_MS) {
            console.log(`[AutoSignalWatcher] ⏰ [Paper] Order ${order._id} timed out (${Math.round(elapsed / 60000)} min) for ${order.symbol}. Cancelling.`);
            await this._cancelPaperOrder(order, 'entry_timeout');
        }
    }

    async _fillPaperOrder(order, fillPrice) {
        // Check for existing open position to merge or create new
        const spec     = productCatalog.getBySymbol(order.symbol);
        const contractVal = spec?.contract_value || 1;
        const leverage = order.leverage || 1;
        const size     = order.size;
        const margin   = (fillPrice * size * contractVal) / leverage;

        const liqPrice = order.side === 'buy'
            ? fillPrice * (1 - 1 / leverage)
            : fillPrice * (1 + 1 / leverage);

        const existingPos = await PaperPosition.findOne({
            userId: order.userId,
            symbol: order.symbol,
            side:   order.side,
            status: 'open',
        });

        let position;
        if (existingPos) {
            const totalSize = existingPos.size + size;
            const avgEntry  = (existingPos.entryPrice * existingPos.size + fillPrice * size) / totalSize;
            existingPos.entryPrice = avgEntry;
            existingPos.size       = totalSize;
            existingPos.marginUsed += margin;
            if (order.stopLoss)   existingPos.stopLoss   = order.stopLoss;
            if (order.takeProfit) existingPos.takeProfit = order.takeProfit;
            await existingPos.save();
            position = existingPos;
        } else {
            position = await PaperPosition.create({
                userId:        order.userId,
                symbol:        order.symbol,
                side:          order.side,
                size,
                contractValue: contractVal,
                entryPrice:    fillPrice,
                leverage,
                stopLoss:      order.stopLoss || null,
                takeProfit:    order.takeProfit || null,
                marginUsed:    margin,
                markPrice:     fillPrice,
                unrealisedPnl: 0,
                liquidationPrice: liqPrice,
                status:        'open',
                signalId:      order.signalId || null,
                source:        order.source || 'automation',
            });
        }

        // Mark order filled
        order.status = 'filled';
        await order.save();

        // Update corresponding TradeHistory record
        await TradeHistory.findOneAndUpdate(
            { orderId: String(order._id), mode: 'paper' },
            { status: 'filled', filledPrice: fillPrice, filledSize: size, filledAt: new Date() }
        );

        console.log(`[AutoSignalWatcher] ✅ [Paper] Order ${order._id} filled @ $${fillPrice} for ${order.symbol}`);
        this._emit(`user:${order.userId}`, 'automation_order_filled', {
            mode: 'paper', symbol: order.symbol, orderId: String(order._id), fillPrice, size,
        });
        this._emit(`user:${order.userId}`, 'paper_position_opened', { position: position.toObject() });
    }

    async _cancelPaperOrder(order, reason) {
        // Release locked margin back to wallet
        const leverage = order.leverage || 1;
        const margin   = (order.price * order.size) / leverage;

        try {
            const wallet = await PaperWallet.findOne({ userId: order.userId });
            if (wallet) {
                wallet.available = Math.min(wallet.balance, wallet.available + margin);
                wallet.used      = Math.max(0, wallet.used - margin);
                await wallet.save();
            }
        } catch (e) {
            console.warn('[AutoSignalWatcher] Wallet release failed:', e.message);
        }

        order.status = 'cancelled';
        await order.save();

        await TradeHistory.findOneAndUpdate(
            { orderId: String(order._id), mode: 'paper' },
            { status: reason === 'entry_timeout' ? 'entry_timeout' : 'cancelled' }
        );

        console.log(`[AutoSignalWatcher] ❌ [Paper] Order ${order._id} cancelled (${reason}) for ${order.symbol}`);
        this._emit(`user:${order.userId}`, 'automation_order_cancelled', {
            mode: 'paper', symbol: order.symbol, orderId: String(order._id), reason,
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    async _buildDeltaClient(userId) {
        try {
            const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
            if (!apiKeyDoc) return null;
            const apiKey    = decryptData(apiKeyDoc.apiKeyEncrypted);
            const apiSecret = decryptData(apiKeyDoc.apiSecretEncrypted);
            return new DeltaOrderClient(apiKey, apiSecret);
        } catch (err) {
            console.error('[AutoSignalWatcher] Failed to build Delta client:', err.message);
            return null;
        }
    }

    _emit(room, event, payload) {
        if (!this.io) return;
        try {
            this.io.to(room).emit(event, payload);
        } catch (e) { /* ignore */ }
    }
}

module.exports = new AutoSignalWatcher();
