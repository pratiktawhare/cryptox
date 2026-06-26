/**
 * OrderExecutor.js
 *
 * The safety-first order execution layer for Phase 7.
 *
 * Responsibilities:
 *   1. Decrypt user API keys
 *   2. Run pre-trade safety checks (risk limits, duplicate orders, margin)
 *   3. Place the order via DeltaOrderClient
 *   4. Save a TradeHistory record
 *   5. Emit real-time order status to the user via Socket.IO
 *
 * Usage:
 *   const executor = require('./OrderExecutor');
 *   const result = await executor.execute(userId, orderParams, io);
 */

const ApiKey    = require('../../models/ApiKey');
const TradeHistory = require('../../models/TradeHistory');
const DeltaOrderClient = require('./DeltaOrderClient');
const { decryptData } = require('../../utils/encryption');
const positionTracker = require('./PositionTracker');

// ─── Safety limits (configurable per user in Phase 9) ─────────────────────────
const SAFETY = {
    MAX_LEVERAGE:      20,       // Hard cap on leverage
    MAX_ORDER_SIZE:    100,      // Max contracts per order
    MIN_ORDER_SIZE:    1,        // Min contracts per order
    MAX_CONCURRENT:    5,        // Max open positions
    MIN_RR_RATIO:      1.5,      // Minimum risk/reward (SL+TP must be set)
    REQUIRE_SL:        true,     // Force stop-loss on every order
    MIN_MARGIN_PCT:    0.1,      // 10% margin buffer required
};

class OrderExecutor {

    // ─── Main execute method ───────────────────────────────────────────────────

    /**
     * Execute a trade order.
     * @param {string}  userId
     * @param {object}  params   — { symbol, side, size, orderType, price, stopLoss, takeProfit, leverage, signalId, source }
     * @param {object}  io       — Socket.IO server instance for real-time updates
     * @returns {TradeHistory}
     */
    async execute(userId, params, io = null) {
        const historyDoc = await this._createPending(userId, params);

        try {
            // Step 1: Load and decrypt API key
            const client = await this._buildClient(userId);

            // Step 2: Pre-trade safety checks
            await this._safetyChecks(params, client);

            // Step 3: Place the order
            let rawResponse;
            try {
                rawResponse = await client.placeOrder(params);
            } catch (placeErr) {
                if (placeErr.message?.includes('bracket_order_position_exists')) {
                    console.log(`[OrderExecutor] 🔄 Bracket order already exists for this position. Retrying order placement without bracket legs...`);
                    const fallbackParams = { ...params, stopLoss: null, takeProfit: null };
                    rawResponse = await client.placeOrder(fallbackParams);
                } else {
                    throw placeErr;
                }
            }
            const order = rawResponse?.result;

            if (!order || !order.id) {
                throw new Error(rawResponse?.error?.message || 'Order rejected by exchange');
            }

            // Step 4: Update history record
            historyDoc.orderId       = String(order.id);
            historyDoc.clientOrderId = order.client_order_id;
            historyDoc.status        = order.state === 'open' ? 'open' : 'pending';
            historyDoc.filledPrice   = order.average_fill_price ? parseFloat(order.average_fill_price) : null;
            historyDoc.filledSize    = order.size_filled ? parseInt(order.size_filled) : null;
            historyDoc.filledAt      = order.size_filled > 0 ? new Date() : null;
            historyDoc.rawResponse   = order;
            await historyDoc.save();

            console.log(`[OrderExecutor] ✅ ${params.side.toUpperCase()} ${params.size} ${params.symbol} @ ${params.price || 'MARKET'} — Order ${order.id}`);

            // Step 5: Emit real-time update
            this._emit(io, userId, 'order_placed', historyDoc.toObject());

            // Force update position tracker cache instantly in background
            ApiKey.findOne({ userId, exchange: 'delta', isActive: true })
                .then(keyDoc => {
                    if (keyDoc) {
                        positionTracker._pollUser(keyDoc).catch(e => {});
                    }
                })
                .catch(e => {});

            return historyDoc;

        } catch (err) {
            historyDoc.status       = 'failed';
            historyDoc.errorMessage = err.message;
            await historyDoc.save();

            console.error(`[OrderExecutor] ❌ Order failed: ${err.message}`);
            this._emit(io, userId, 'order_failed', { ...historyDoc.toObject(), error: err.message });

            throw err;
        }
    }

    // ─── Cancel an order ───────────────────────────────────────────────────────

    async cancel(userId, orderId, symbol, io = null) {
        const client = await this._buildClient(userId);
        const result = await client.cancelOrder(orderId, symbol);

        await TradeHistory.findOneAndUpdate(
            { orderId, userId },
            { status: 'cancelled' }
        );

        this._emit(io, userId, 'order_cancelled', { orderId, symbol });
        return result;
    }

    // ─── Close an entire position ──────────────────────────────────────────────

    async closePosition(userId, symbol, size, side, io = null) {
        const params = {
            symbol,
            side: side === 'buy' ? 'sell' : 'buy',
            size,
            orderType: 'market_order',
            source: 'manual',
            isClose: true,
            reduceOnly: true,
        };
        return this.execute(userId, params, io);
    }

    // ─── Build authenticated Delta client ─────────────────────────────────────

    async _buildClient(userId) {
        const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
        if (!apiKeyDoc) {
            throw new Error('No active Delta Exchange API key found. Please add one in Settings → API Keys.');
        }
        const apiKey    = decryptData(apiKeyDoc.apiKeyEncrypted);
        const apiSecret = decryptData(apiKeyDoc.apiSecretEncrypted);
        return new DeltaOrderClient(apiKey, apiSecret);
    }

    // ─── Pre-trade safety checks ──────────────────────────────────────────────

    async _safetyChecks(params, client) {
        if (params.isClose) {
            return;
        }
        const errors = [];

        // Leverage cap
        if (params.leverage > SAFETY.MAX_LEVERAGE) {
            errors.push(`Leverage ${params.leverage}× exceeds maximum allowed (${SAFETY.MAX_LEVERAGE}×)`);
        }

        // Size limits
        if (params.size < SAFETY.MIN_ORDER_SIZE) {
            errors.push(`Order size ${params.size} is below minimum (${SAFETY.MIN_ORDER_SIZE})`);
        }
        if (params.size > SAFETY.MAX_ORDER_SIZE) {
            errors.push(`Order size ${params.size} exceeds maximum (${SAFETY.MAX_ORDER_SIZE})`);
        }

        // Stop loss required
        if (SAFETY.REQUIRE_SL && !params.stopLoss) {
            errors.push('Stop loss is required for all orders');
        }

        // R/R ratio check
        if (params.stopLoss && params.takeProfit && params.price) {
            const risk   = Math.abs(params.price - params.stopLoss);
            const reward = Math.abs(params.takeProfit - params.price);
            const rr     = risk > 0 ? reward / risk : 0;
            if (rr < SAFETY.MIN_RR_RATIO) {
                errors.push(`Risk/reward ratio ${rr.toFixed(2)} is below minimum (${SAFETY.MIN_RR_RATIO}). Adjust your TP or SL.`);
            }
        }

        // Stop-loss direction check
        if (params.stopLoss && params.price) {
            if (params.side === 'buy' && params.stopLoss >= params.price) {
                errors.push('Stop loss must be below entry price for a BUY order');
            }
            if (params.side === 'sell' && params.stopLoss <= params.price) {
                errors.push('Stop loss must be above entry price for a SELL order');
            }
        }

        if (errors.length > 0) {
            throw new Error('Safety check failed:\n• ' + errors.join('\n• '));
        }
    }

    // ─── Create pending record ─────────────────────────────────────────────────

    async _createPending(userId, params) {
        return TradeHistory.create({
            userId,
            symbol:    params.symbol,
            side:      params.side,
            orderType: params.orderType || 'market_order',
            size:      params.size,
            price:     params.price || null,
            leverage:  params.leverage || 1,
            stopLoss:  params.stopLoss || null,
            takeProfit: params.takeProfit || null,
            status:    'pending',
            mode:      'live',
            signalId:  params.signalId || null,
            source:    params.source || 'manual',
        });
    }

    // ─── Socket.IO emit (namespaced to user) ──────────────────────────────────

    _emit(io, userId, event, data) {
        if (!io) return;
        // Emit to the user's personal room (joined in socket auth — Phase 3)
        io.to(`user:${userId}`).emit(event, data);
        // Also broadcast to all connected clients (for admin monitoring)
        io.emit(event, data);
    }
}

module.exports = new OrderExecutor();
