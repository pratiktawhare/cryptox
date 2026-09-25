/**
 * EntryOrderWatcher.js
 *
 * Background monitor for BotTrade records in 'pending_entry' state (live mode only).
 *
 * Runs every 10 seconds. For each pending entry:
 *   - If the limit order filled on Delta → activate the trade (result: 'open').
 *   - If Delta already cancelled/rejected it → mark it cancelled in DB.
 *   - If 15 minutes have elapsed without a fill → cancel ONLY that entry order on Delta.
 *     NEVER calls cancelAllOrders — bracket TP/SL of other open positions are safe.
 *
 * Paper mode: not applicable — paper fills are simulated instantly at entry.
 */

const BotTrade          = require('../../models/BotTrade');
const BotEvent          = require('../../models/BotEvent');
const ApiKey            = require('../../models/ApiKey');
const DeltaOrderClient  = require('../trading/DeltaOrderClient');
const executionEngine   = require('./ExecutionEngine');
const { decryptData }   = require('../../utils/encryption');

const ENTRY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const POLL_INTERVAL_MS = 10_000;          // 10 seconds

class EntryOrderWatcher {
    constructor() {
        this.io        = null;
        this.wsManager = null;
        this._timer    = null;
        this._busy     = false;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────

    start(io = null, wsManager = null) {
        if (io) this.io = io;
        if (wsManager) this.wsManager = wsManager;
        if (this._timer) return;
        this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
        console.log(`[EntryOrderWatcher] ⏳ Started — checking pending entries every ${POLL_INTERVAL_MS / 1000}s (timeout: ${ENTRY_TIMEOUT_MS / 60000} min)`);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            console.log('[EntryOrderWatcher] Stopped.');
        }
    }

    // ── Main Tick ───────────────────────────────────────────────────────────────

    async _tick() {
        if (this._busy) return;
        this._busy = true;

        try {
            const pendingTrades = await BotTrade.find({ result: 'pending_entry' });
            if (!pendingTrades || pendingTrades.length === 0) return;

            for (const trade of pendingTrades) {
                try {
                    await this._checkPendingTrade(trade);
                } catch (err) {
                    console.error(`[EntryOrderWatcher] Error checking trade ${trade._id} (${trade.symbol}):`, err.message);
                }
            }
        } catch (err) {
            console.error('[EntryOrderWatcher] Tick error:', err.message);
        } finally {
            this._busy = false;
        }
    }

    // ── Per-Trade Logic ─────────────────────────────────────────────────────────

    async _checkPendingTrade(trade) {
        if (trade.mode === 'paper') {
            await this._checkPaperPendingTrade(trade);
        } else {
            await this._checkLivePendingTrade(trade);
        }
    }

    // ── Paper Mode Pending Entry Check ──────────────────────────────────────────

    async _checkPaperPendingTrade(trade) {
        // 1. Check 15-Minute Timeout
        const elapsedMs = Date.now() - new Date(trade.entryOrderPlacedAt || trade.entryTime || trade.createdAt).getTime();
        if (elapsedMs >= ENTRY_TIMEOUT_MS) {
            console.log(`[EntryOrderWatcher] ⏰ [Paper] Resting limit order timed out after ${Math.round(elapsedMs / 60000)} min for ${trade.symbol}. Cancelling order and refunding margin.`);
            await this._markCancelled(trade, 'entry_timeout');
            return;
        }

        // 2. Get Live Market Price
        const currentPrice = this._getPrice(trade.symbol);
        if (!currentPrice || currentPrice <= 0) {
            return; // No price data available yet, wait for next tick
        }

        // 3. Check Pullback Fill Condition
        // Long limit: resting below market, filled when price pulls down to or below limit
        // Short limit: resting above market, filled when price rallies up to or above limit
        const isFilled = (trade.direction === 'long' && currentPrice <= trade.entryPrice) ||
                         (trade.direction === 'short' && currentPrice >= trade.entryPrice);

        if (isFilled) {
            console.log(`[EntryOrderWatcher] ✅ [Paper] Limit entry touched for ${trade.direction.toUpperCase()} ${trade.symbol}! Market: $${currentPrice}, Limit: $${trade.entryPrice}. Activating trade.`);
            await executionEngine._activatePaperTrade({
                trade,
                fillPrice: trade.entryPrice,
                io: this.io,
            });
        }
    }

    // ── Live Mode Pending Entry Check ───────────────────────────────────────────

    async _checkLivePendingTrade(trade) {
        const orderId = trade.pendingEntryOrderId || trade.entryOrderId;
        if (!orderId) {
            await this._markCancelled(trade, 'missing_order_id');
            return;
        }

        const client = await this._buildDeltaClient(trade.userId);
        if (!client) return; // No API key — retry next tick

        let orderData;
        try {
            const resp = await client.getOrder(orderId);
            orderData  = resp?.result;
        } catch (err) {
            console.warn(`[EntryOrderWatcher] Could not fetch order ${orderId} (${trade.symbol}):`, err.message);
            return;
        }

        if (!orderData) return;

        const state = orderData.state;

        // ── Case 1: Filled ──────────────────────────────────────────────────────
        if (state === 'closed' || state === 'filled') {
            console.log(`[EntryOrderWatcher] ✅ Order ${orderId} filled for ${trade.symbol}. Activating trade.`);
            await executionEngine._activateLiveTrade({
                userId:                 trade.userId,
                symbol:                 trade.symbol,
                direction:              trade.direction,
                entryPrice:             trade.entryPrice,
                stopLoss:               trade.stopLoss,
                takeProfit:             trade.takeProfit,
                quantity:               trade.quantity,
                leverage:               trade.leverage,
                margin:                 trade.margin,
                signalScore:            trade.signalScore,
                regime:                 trade.regime,
                walletBalanceAtEntry:   trade.walletBalanceAtEntry,
                effectiveBudgetAtEntry: trade.effectiveBudgetAtEntry,
                io:                     this.io,
                orderId,
                filledOrder:            orderData,
                reverseMode:            trade.reverseMode,
                existingTradeId:        trade._id,  // update the pending_entry record in-place
            });
            return;
        }

        // ── Case 2: Cancelled or rejected by exchange ───────────────────────────
        if (state === 'cancelled' || state === 'rejected') {
            console.log(`[EntryOrderWatcher] ❌ Order ${orderId} was ${state} by Delta for ${trade.symbol}.`);
            await this._markCancelled(trade, `exchange_${state}`);
            return;
        }

        // ── Case 3: Still open — check 15-minute timeout ────────────────────────
        const elapsedMs = Date.now() - new Date(trade.entryOrderPlacedAt || trade.entryTime || trade.createdAt).getTime();
        if (elapsedMs >= ENTRY_TIMEOUT_MS) {
            console.log(`[EntryOrderWatcher] ⏰ Order ${orderId} timed out after ${Math.round(elapsedMs / 60000)} min for ${trade.symbol}. Cancelling entry order only.`);

            // Cancel ONLY the specific entry order by ID — NEVER cancelAllOrders
            try {
                await client.cancelOrder(orderId, trade.symbol);
                console.log(`[EntryOrderWatcher] 🗑️ Limit entry order ${orderId} (${trade.symbol}) deleted on Delta Exchange.`);
            } catch (cancelErr) {
                // If it failed, check if the order might have filled right before cancel
                console.warn(`[EntryOrderWatcher] Cancel order ${orderId} on Delta warn:`, cancelErr.message);
                try {
                    const freshOrder = await client.getOrder(orderId);
                    if (freshOrder?.result?.state === 'closed' || freshOrder?.result?.state === 'filled') {
                        console.log(`[EntryOrderWatcher] ⚡ Order ${orderId} actually filled right before cancel! Activating trade.`);
                        await executionEngine._activateLiveTrade({
                            userId:                 trade.userId,
                            symbol:                 trade.symbol,
                            direction:              trade.direction,
                            entryPrice:             trade.entryPrice,
                            stopLoss:               trade.stopLoss,
                            takeProfit:             trade.takeProfit,
                            quantity:               trade.quantity,
                            leverage:               trade.leverage,
                            margin:                 trade.margin,
                            signalScore:            trade.signalScore,
                            regime:                 trade.regime,
                            walletBalanceAtEntry:   trade.walletBalanceAtEntry,
                            effectiveBudgetAtEntry: trade.effectiveBudgetAtEntry,
                            io:                     this.io,
                            orderId,
                            filledOrder:            freshOrder.result,
                            reverseMode:            trade.reverseMode,
                            existingTradeId:        trade._id,
                        });
                        return;
                    }
                } catch (checkErr) { /* ignore */ }

                await this._logEvent(trade.userId, 'live', 'ORDER_CANCELLED', 'warn',
                    `Cancel attempt for timed-out order ${orderId} returned: ${cancelErr.message}`,
                    { orderId, symbol: trade.symbol }
                );
            }

            await this._logEvent(trade.userId, 'live', 'ORDER_TIMEOUT', 'warn',
                `[Live] Limit entry order ${orderId} for ${trade.symbol} cancelled after 15 min timeout. No fill received.`,
                { orderId, symbol: trade.symbol, elapsedMs }
            );

            await this._markCancelled(trade, 'entry_timeout');
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    _getPrice(symbol) {
        let currentPrice = null;
        if (this.wsManager?.getPrice) {
            const p = this.wsManager.getPrice(symbol);
            if (p && p > 0) currentPrice = p;
        }
        if (!currentPrice && this.wsManager?.getTicker) {
            const ticker = this.wsManager.getTicker(symbol);
            if (ticker?.mark_price) currentPrice = parseFloat(ticker.mark_price);
            else if (ticker?.close) currentPrice = parseFloat(ticker.close);
        }
        if (!currentPrice) {
            try {
                const candleStore = require('../CandleStore');
                const lastCandle = candleStore.getLastCandle(symbol, '1m') || candleStore.getLastCandle(symbol, '5m');
                if (lastCandle?.close) currentPrice = lastCandle.close;
            } catch (e) { /* ignore */ }
        }
        return currentPrice;
    }

    async _markCancelled(trade, reason) {
        trade.result           = 'cancelled';
        trade.exitReason       = (reason === 'entry_timeout' || reason === 'timeout') ? 'entry_timeout' : 'cancelled';
        trade.entryOrderStatus = reason === 'entry_timeout' ? 'timeout' : 'cancelled';
        trade.exitTime         = new Date();
        trade.durationSeconds  = Math.round((trade.exitTime - (trade.entryOrderPlacedAt || trade.entryTime || trade.createdAt)) / 1000);
        await trade.save();

        let wallet = null;
        if (trade.mode === 'paper') {
            try {
                const PaperWallet = require('../../models/PaperWallet');
                wallet = await PaperWallet.findOne({ userId: trade.userId });
                if (wallet) {
                    wallet.available += trade.margin;
                    wallet.used = Math.max(0, wallet.used - trade.margin);
                    await wallet.save();
                }
            } catch (wErr) {
                console.error(`[EntryOrderWatcher] Error refunding paper margin for trade ${trade._id}:`, wErr.message);
            }
        }

        const modeTag = trade.mode === 'paper' ? '[Paper]' : '[Live]';
        const eventType = reason === 'entry_timeout' ? 'ORDER_TIMEOUT' : 'ORDER_CANCELLED';
        await this._logEvent(trade.userId, trade.mode, eventType, 'warn',
            `${modeTag} Pending entry for ${trade.symbol} cancelled: ${reason}${trade.mode === 'paper' ? ` (Margin $${trade.margin.toFixed(2)} refunded)` : ''}`,
            { tradeId: trade._id, symbol: trade.symbol, reason, margin: trade.margin }
        );

        if (this.io) {
            try {
                this.io.to(`user:${trade.userId}`).emit('bot_trade_cancelled', {
                    trade:  trade.toObject(),
                    reason,
                    mode:   trade.mode,
                });
                this.io.to(`user:${trade.userId}`).emit('bot_trade_closed', {
                    trade:  trade.toObject(),
                    mode:   trade.mode,
                    symbol: trade.symbol,
                });
                this.io.emit('bot_trade_closed', {
                    trade:  trade.toObject(),
                    mode:   trade.mode,
                    symbol: trade.symbol,
                });
                if (wallet) {
                    this.io.to(`user:${trade.userId}`).emit('bot_wallet_updated', {
                        wallet: wallet.toObject(),
                        mode:   'paper',
                    });
                }
            } catch (e) { /* ignore */ }
        }
    }

    async _buildDeltaClient(userId) {
        try {
            const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
            if (!apiKeyDoc) return null;
            const apiKey    = decryptData(apiKeyDoc.apiKeyEncrypted);
            const apiSecret = decryptData(apiKeyDoc.apiSecretEncrypted);
            return new DeltaOrderClient(apiKey, apiSecret);
        } catch (err) {
            console.error(`[EntryOrderWatcher] Failed to build Delta client:`, err.message);
            return null;
        }
    }

    async _logEvent(userId, mode = 'live', type, severity, message, metadata = {}) {
        try {
            await BotEvent.create({
                userId,
                mode,
                type,
                severity,
                message,
                metadata,
                timestamp: new Date(),
            });
        } catch (err) {
            console.error(`[EntryOrderWatcher] Failed to log BotEvent:`, err.message);
        }
    }
}

module.exports = new EntryOrderWatcher();
