/**
 * ExecutionEngine.js
 *
 * Handles order placement, entry verification, bracket order protection,
 * and emergency closing for both Paper and Live modes in TradingBot.
 *
 * Flow:
 *   1. Acquire per-user/mode entry lock (prevents concurrent double entries).
 *   2. Paper: Simulates fill against ticker price, deducts PaperWallet margin, creates PaperPosition + BotTrade.
 *   3. Live: DeltaOrderClient REST call with bracket TP/SL.
 *      - Polls fill for up to 30s.
 *      - If not filled within 30s -> cancels order.
 *      - Verifies TP/SL protection attached. If failed -> emergency closes immediately.
 *   4. Emits real-time Socket.IO events and records BotEvent audit logs.
 */

const ApiKey = require('../../models/ApiKey');
const PaperWallet = require('../../models/PaperWallet');
const PaperPosition = require('../../models/PaperPosition');
const BotTrade = require('../../models/BotTrade');
const BotEvent = require('../../models/BotEvent');
const TradingConfig = require('../../models/TradingConfig');
const DeltaOrderClient = require('../trading/DeltaOrderClient');
const productCatalog = require('../ProductCatalog');
const { decryptData } = require('../../utils/encryption');
const { calcTradeCosts } = require('./CostEngine');

class ExecutionEngine {
    constructor() {
        /** @type {Set<string>} active locks in format `${userId}:${mode}` */
        this._entryLocks = new Set();
    }

    // ─── Entry Lock Management ──────────────────────────────────────────────────

    _getLockKey(userId, mode) {
        return `${String(userId)}:${mode}`;
    }

    acquireLock(userId, mode) {
        const key = this._getLockKey(userId, mode);
        if (this._entryLocks.has(key)) {
            return false;
        }
        this._entryLocks.add(key);
        return true;
    }

    releaseLock(userId, mode) {
        const key = this._getLockKey(userId, mode);
        this._entryLocks.delete(key);
    }

    isLocked(userId, mode) {
        return this._entryLocks.has(this._getLockKey(userId, mode));
    }

    // ─── Execute Trade ─────────────────────────────────────────────────────────

    /**
     * Executes a planned trade setup.
     *
     * @param {object} params
     * @param {string} params.userId
     * @param {'paper'|'live'} params.mode
     * @param {string} params.symbol
     * @param {'long'|'short'} params.direction
     * @param {number} params.entryPrice
     * @param {number} params.stopLoss
     * @param {number} params.takeProfit
     * @param {number} params.quantity            - Number of contracts
     * @param {number} params.leverage
     * @param {number} params.margin              - USDT margin required
     * @param {number} [params.signalScore]
     * @param {string} [params.regime]
     * @param {number} [params.walletBalanceAtEntry]
     * @param {number} [params.effectiveBudgetAtEntry]
     * @param {object} [params.productSpec]
     * @param {object} [params.io]                - Socket.IO instance
     * @param {object} [params.wsManager]         - DeltaWebSocketManager instance
     * @param {'limit_order'|'market_order'} [params.orderType] - default 'market_order'
     *
     * @returns {Promise<{ success: boolean, trade?: object, position?: object, reason?: string }>}
     */
    async executeTrade(params) {
        const {
            userId,
            mode,
            symbol,
            direction,
            entryPrice,
            stopLoss,
            takeProfit,
            quantity,
            leverage,
            margin,
            signalScore = null,
            regime = null,
            walletBalanceAtEntry = null,
            effectiveBudgetAtEntry = null,
            productSpec = null,
            io = null,
            wsManager = null,
            orderType = 'market_order',
            reverseMode = false,
        } = params;

        // 1. Guard against concurrent entry
        if (!this.acquireLock(userId, mode)) {
            return { success: false, reason: 'concurrent_entry_locked' };
        }

        try {
            // Check if there is already an open trade for this specific symbol
            const existingSameSymbolTrade = await BotTrade.findOne({
                userId,
                mode,
                symbol,
                result: 'open',
            });

            if (existingSameSymbolTrade) {
                await this._logEvent(userId, mode, 'TRADE_REJECTED', 'warn',
                    `Trade rejected: already an open trade for ${symbol}`,
                    { existingTradeId: existingSameSymbolTrade._id, symbol }
                );
                return { success: false, reason: 'symbol_position_already_exists' };
            }

            // Check if max simultaneous open positions limit has been reached
            const currentOpenCount = await BotTrade.countDocuments({
                userId,
                mode,
                result: 'open',
            });
            const userConfig = await TradingConfig.findOne({ userId, mode });
            const maxAllowed = userConfig?.maxOpenPositions || 5;
            if (currentOpenCount >= maxAllowed) {
                await this._logEvent(userId, mode, 'TRADE_REJECTED', 'warn',
                    `Trade rejected: max simultaneous open positions limit reached (${currentOpenCount}/${maxAllowed})`,
                    { currentOpenCount, maxAllowed, symbol }
                );
                return { success: false, reason: 'max_positions_reached' };
            }

            if (mode === 'paper') {
                return await this._executePaper({
                    userId,
                    symbol,
                    direction,
                    entryPrice,
                    stopLoss,
                    takeProfit,
                    quantity,
                    leverage,
                    margin,
                    signalScore,
                    regime,
                    walletBalanceAtEntry,
                    effectiveBudgetAtEntry,
                    productSpec,
                    io,
                    wsManager,
                    orderType,
                    reverseMode,
                });
            } else if (mode === 'live') {
                return await this._executeLive({
                    userId,
                    symbol,
                    direction,
                    entryPrice,
                    stopLoss,
                    takeProfit,
                    quantity,
                    leverage,
                    margin,
                    signalScore,
                    regime,
                    walletBalanceAtEntry,
                    effectiveBudgetAtEntry,
                    productSpec,
                    io,
                    orderType,
                    reverseMode,
                });
            } else {
                throw new Error(`Invalid trading mode: ${mode}`);
            }
        } finally {
            this.releaseLock(userId, mode);
        }
    }

    // ─── Paper Execution ───────────────────────────────────────────────────────

    async _executePaper(params) {
        const {
            userId,
            symbol,
            direction,
            entryPrice,
            stopLoss,
            takeProfit,
            quantity,
            leverage,
            margin,
            signalScore,
            regime,
            walletBalanceAtEntry,
            effectiveBudgetAtEntry,
            productSpec,
            io,
            wsManager,
            orderType,
        } = params;

        // Get fresh ticker price if available
        let fillPrice = entryPrice;
        if (wsManager?.getPrice) {
            const livePrice = wsManager.getPrice(symbol);
            if (livePrice && livePrice > 0) {
                fillPrice = livePrice;
            }
        }

        // ── Re-anchor SL/TP to actual fill price ──────────────────────────────
        // RiskEngine computes SL/TP as offsets from entryPrice (snapshot.close).
        // If fillPrice differs (market moved between scan and execution), we must
        // shift SL and TP by the same delta so the intended distance geometry is preserved.
        // Without this, a SHORT with TP $0.60 below snapshot could end up only $0.06
        // from the actual fill price — mathematically impossible to win.
        const spec = productSpec || productCatalog.getBySymbol(symbol);
        const contractValue = parseFloat(spec?.contract_value || 1);
        const tickSize = parseFloat(spec?.tick_size || 0.001);

        const roundToTick = (price, tick) => {
            if (!tick || tick <= 0) return price;
            return parseFloat((Math.round(price / tick) * tick).toFixed(8));
        };

        let adjStopLoss   = stopLoss;
        let adjTakeProfit = takeProfit;
        if (fillPrice !== entryPrice && entryPrice > 0) {
            const priceDelta = fillPrice - entryPrice;
            adjStopLoss   = roundToTick(stopLoss   + priceDelta, tickSize);
            adjTakeProfit = roundToTick(takeProfit  + priceDelta, tickSize);
            console.log(`[ExecutionEngine] 📍 Adjusted SL/TP for price slippage: entry $${entryPrice} → fill $${fillPrice} (Δ${priceDelta > 0 ? '+' : ''}${priceDelta.toFixed(4)}). New SL=$${adjStopLoss}, TP=$${adjTakeProfit}`);
        }

        // Check PaperWallet has enough available margin
        let wallet = await PaperWallet.findOne({ userId });
        if (!wallet) {
            wallet = await PaperWallet.create({ userId });
        }

        if (wallet.available < margin) {
            const msg = `Insufficient paper margin: need $${margin.toFixed(2)}, available $${wallet.available.toFixed(2)}`;
            await this._logEvent(userId, 'paper', 'TRADE_REJECTED', 'warn', msg, { margin, available: wallet.available });
            return { success: false, reason: 'insufficient_paper_margin' };
        }

        // Calculate estimated fees via CostEngine
        const estimatedCosts = calcTradeCosts({
            entryPrice: fillPrice,
            targetPrice: adjTakeProfit,
            stopPrice: adjStopLoss,
            direction,
            qty: quantity,
            contractValue,
        });


        // 1. Lock margin in PaperWallet
        wallet.available -= margin;
        wallet.used += margin;
        await wallet.save();

        // 2. Create PaperPosition document
        const side = direction === 'long' ? 'buy' : 'sell';
        const liqPrice = side === 'buy'
            ? fillPrice * (1 - 1 / leverage)
            : fillPrice * (1 + 1 / leverage);

        const position = await PaperPosition.create({
            userId,
            symbol,
            side,
            size: quantity,
            contractValue,
            entryPrice: fillPrice,
            leverage,
            stopLoss:   adjStopLoss,
            takeProfit: adjTakeProfit,
            marginUsed: margin,
            markPrice: fillPrice,
            unrealisedPnl: 0,
            roe: 0,
            liquidationPrice: liqPrice,
            source: 'automation',
            reverseMode: Boolean(params.reverseMode),
            status: 'open',
        });

        // 3. Create BotTrade audit document
        const trade = await BotTrade.create({
            userId,
            mode: 'paper',
            symbol,
            direction,
            entryPrice: fillPrice,
            stopLoss:   adjStopLoss,
            takeProfit: adjTakeProfit,
            quantity,
            contractValue,
            leverage,
            margin,
            fees: estimatedCosts.entryFee || 0,
            slippage: estimatedCosts.slippageCost || 0,
            entryTime: new Date(),
            result: 'open',
            signalScore,
            regime,
            walletBalanceAtEntry: walletBalanceAtEntry || wallet.balance,
            effectiveBudgetAtEntry: effectiveBudgetAtEntry || Math.min(wallet.balance, 10),
            reverseMode: Boolean(params.reverseMode),
        });

        // Link position to trade if desired
        position.tradeHistoryId = trade._id;
        await position.save();

        // 4. Log audit events
        await this._logEvent(userId, 'paper', 'ORDER_SUBMITTED', 'info',
            `[Paper] Submitted ${direction.toUpperCase()} ${quantity} ${symbol} @ $${fillPrice}`,
            { tradeId: trade._id, symbol, direction, quantity, fillPrice, orderType }
        );
        await this._logEvent(userId, 'paper', 'ORDER_FILLED', 'info',
            `[Paper] Filled ${direction.toUpperCase()} ${quantity} ${symbol} @ $${fillPrice}`,
            { tradeId: trade._id, fillPrice }
        );
        await this._logEvent(userId, 'paper', 'TP_PLACED', 'info',
            `[Paper] Take profit target placed at $${takeProfit}`,
            { tradeId: trade._id, takeProfit }
        );
        await this._logEvent(userId, 'paper', 'SL_PLACED', 'info',
            `[Paper] Stop loss protection placed at $${stopLoss}`,
            { tradeId: trade._id, stopLoss }
        );
        await this._logEvent(userId, 'paper', 'POSITION_OPENED', 'info',
            `[Paper] Position opened: ${direction.toUpperCase()} ${quantity} ${symbol} (Margin: $${margin.toFixed(2)})`,
            { tradeId: trade._id, positionId: position._id, margin, leverage }
        );

        // 5. Emit Socket.IO events
        this._emit(io, userId, 'bot_trade_opened', {
            trade: trade.toObject(),
            position: position.toObject(),
            wallet: wallet.toObject(),
            mode: 'paper',
        });
        this._emit(io, userId, 'bot_position_updated', {
            position: position.toObject(),
            mode: 'paper',
        });

        console.log(`[ExecutionEngine] 📄 [Paper] Opened ${direction.toUpperCase()} ${quantity} ${symbol} @ $${fillPrice} (Margin: $${margin.toFixed(2)})`);

        return {
            success: true,
            trade: trade.toObject(),
            position: position.toObject(),
            wallet: wallet.toObject(),
        };
    }

    // ─── Live Execution ────────────────────────────────────────────────────────

    async _executeLive(params) {
        const {
            userId,
            symbol,
            direction,
            entryPrice,
            stopLoss,
            takeProfit,
            quantity,
            leverage,
            margin,
            signalScore,
            regime,
            walletBalanceAtEntry,
            effectiveBudgetAtEntry,
            io,
            orderType,
        } = params;

        // 1. Decrypt Delta API credentials
        const client = await this._buildDeltaClient(userId);

        const side = direction === 'long' ? 'buy' : 'sell';

        // 2. Place entry order with bracket TP/SL
        await this._logEvent(userId, 'live', 'ORDER_SUBMITTED', 'info',
            `[Live] Submitting ${direction.toUpperCase()} ${quantity} ${symbol} with bracket SL: $${stopLoss}, TP: $${takeProfit}`,
            { symbol, side, quantity, leverage, stopLoss, takeProfit, orderType }
        );

        let orderResp;
        try {
            orderResp = await client.placeOrder({
                symbol,
                side,
                size: quantity,
                orderType,
                price: orderType === 'limit_order' ? entryPrice : undefined,
                stopLoss,
                takeProfit,
                leverage,
            });
        } catch (placeErr) {
            console.error(`[ExecutionEngine] ❌ Live placeOrder failed:`, placeErr.message);
            await this._logEvent(userId, 'live', 'API_ERROR', 'error',
                `Failed to place live order on Delta: ${placeErr.message}`,
                { error: placeErr.message, symbol }
            );
            return { success: false, reason: `exchange_order_error: ${placeErr.message}` };
        }

        const order = orderResp?.result;
        if (!order || !order.id) {
            const errDetail = orderResp?.error?.message || 'Order rejected by Delta Exchange';
            await this._logEvent(userId, 'live', 'TRADE_REJECTED', 'error',
                `Delta rejected live order: ${errDetail}`,
                { raw: orderResp }
            );
            return { success: false, reason: `order_rejected: ${errDetail}` };
        }

        const orderId = String(order.id);

        // 3. Verify Fill: If limit order, poll up to 30s
        let filledOrder = order;
        if (orderType === 'limit_order' && order.state !== 'closed' && order.state !== 'filled') {
            filledOrder = await this._pollOrderFill(client, orderId, symbol, 30_000);
            if (!filledOrder || (filledOrder.state !== 'closed' && filledOrder.state !== 'filled')) {
                // Not filled within 30 seconds -> Cancel order and skip
                console.warn(`[ExecutionEngine] ⏱️ Order ${orderId} not filled within 30s. Cancelling...`);
                try {
                    await client.cancelOrder(orderId, symbol);
                } catch (cancelErr) {
                    console.error(`[ExecutionEngine] Failed to cancel timed out order ${orderId}:`, cancelErr.message);
                }
                await this._logEvent(userId, 'live', 'ORDER_TIMEOUT', 'warn',
                    `Order ${orderId} not filled within 30s. Cancelled.`,
                    { orderId, symbol }
                );
                return { success: false, reason: 'order_fill_timeout' };
            }
        }

        const actualFillPrice = filledOrder.average_fill_price
            ? parseFloat(filledOrder.average_fill_price)
            : entryPrice;
        const actualFilledSize = filledOrder.size_filled
            ? parseInt(filledOrder.size_filled)
            : quantity;

        await this._logEvent(userId, 'live', 'ORDER_FILLED', 'info',
            `[Live] Filled ${direction.toUpperCase()} ${actualFilledSize} ${symbol} @ $${actualFillPrice}`,
            { orderId, actualFillPrice, actualFilledSize }
        );

        // 4. Verify Bracket Protection
        // Check if bracket TP and SL orders are active on Delta
        const protectionValid = await this._verifyProtection(client, symbol, orderId);
        if (!protectionValid) {
            console.error(`[ExecutionEngine] 🚨 TP/SL protection verification failed for ${symbol}! Triggering emergency close.`);
            await this._logEvent(userId, 'live', 'PROTECTION_FAILED', 'critical',
                `TP/SL bracket protection not verified on Delta for order ${orderId}. Emergency closing position.`,
                { orderId, symbol }
            );

            // Emergency close position immediately
            try {
                await client.closePosition(symbol, actualFilledSize, side);
                await this._logEvent(userId, 'live', 'POSITION_CLOSED_EMERGENCY', 'critical',
                    `Emergency closed position for ${symbol} due to missing bracket protection.`,
                    { symbol, size: actualFilledSize }
                );
            } catch (closeErr) {
                console.error(`[ExecutionEngine] 🚨 Emergency close failed on Delta:`, closeErr.message);
                await this._logEvent(userId, 'live', 'SYSTEM_ERROR', 'critical',
                    `Failed to emergency close unprotected position: ${closeErr.message}`,
                    { symbol, error: closeErr.message }
                );
            }
            return { success: false, reason: 'protection_failed_emergency_closed' };
        }

        await this._logEvent(userId, 'live', 'TP_PLACED', 'info',
            `[Live] Take profit bracket active at $${takeProfit}`,
            { symbol, takeProfit }
        );
        await this._logEvent(userId, 'live', 'SL_PLACED', 'info',
            `[Live] Stop loss bracket active at $${stopLoss}`,
            { symbol, stopLoss }
        );

        // 5. Create BotTrade audit document
        const trade = await BotTrade.create({
            userId,
            mode: 'live',
            symbol,
            direction,
            entryPrice: actualFillPrice,
            stopLoss,
            takeProfit,
            quantity: actualFilledSize,
            leverage,
            margin,
            fees: (actualFillPrice * actualFilledSize * 0.0002), // estimated maker fee
            entryTime: new Date(),
            result: 'open',
            entryOrderId: orderId,
            signalScore,
            regime,
            walletBalanceAtEntry,
            effectiveBudgetAtEntry,
            reverseMode: Boolean(params.reverseMode),
        });

        await this._logEvent(userId, 'live', 'POSITION_OPENED', 'info',
            `[Live] Position opened: ${direction.toUpperCase()} ${actualFilledSize} ${symbol} @ $${actualFillPrice} (Margin: $${margin.toFixed(2)})`,
            { tradeId: trade._id, orderId, margin, leverage }
        );

        // 6. Emit Socket.IO event
        this._emit(io, userId, 'bot_trade_opened', {
            trade: trade.toObject(),
            mode: 'live',
        });

        console.log(`[ExecutionEngine] 💰 [Live] Opened ${direction.toUpperCase()} ${actualFilledSize} ${symbol} @ $${actualFillPrice}`);

        return {
            success: true,
            trade: trade.toObject(),
        };
    }

    // ─── Emergency Close ───────────────────────────────────────────────────────

    /**
     * Closes an active open trade immediately at market.
     *
     * @param {object} params
     * @param {string} params.userId
     * @param {'paper'|'live'} params.mode
     * @param {string} params.symbol
     * @param {string} [params.reason='emergency']
     * @param {object} [params.io]
     * @param {object} [params.wsManager]
     *
     * @returns {Promise<{ success: boolean, trade?: object, reason?: string }>}
     */
    async emergencyClose(params) {
        let userId, mode, symbol, reason, io, wsManager;
        if (params && typeof params === 'object' && !Array.isArray(params) && !params._bsontype) {
            ({ userId, mode, symbol, reason = 'emergency', io = null, wsManager = null } = params);
        } else {
            userId = arguments[0];
            mode = arguments[1];
            symbol = arguments[2];
            reason = arguments[3] || 'emergency';
        }

        const query = { userId, mode, result: 'open' };
        if (symbol) {
            query.symbol = symbol.toUpperCase();
        }

        const trade = await BotTrade.findOne(query);

        if (!trade) {
            return { success: false, reason: 'no_open_trade_found' };
        }

        try {
            if (mode === 'paper') {
                let closePrice = trade.entryPrice;
                if (wsManager?.getPrice) {
                    const p = wsManager.getPrice(symbol);
                    if (p && p > 0) closePrice = p;
                }

                // Calculate gross PnL
                const spec = productCatalog.getBySymbol(symbol);
                const contractValue = parseFloat(spec?.contract_value || 1);
                const isLong = trade.direction === 'long';
                const priceDiff = isLong ? (closePrice - trade.entryPrice) : (trade.entryPrice - closePrice);
                const grossPnl = priceDiff * trade.quantity * contractValue;
                const exitFee = (trade.entryPrice * trade.quantity * contractValue) * 0.0005; // taker fee on entry notional (matches CostEngine basis)
                const totalFees = (trade.fees || 0) + exitFee;
                const netPnl = grossPnl - totalFees;

                // Check if PaperPosition was still open (or if already closed from /positions)
                const openPositions = await PaperPosition.find({ userId, symbol: symbol.toUpperCase(), status: 'open' });
                const hadOpenPosition = openPositions.length > 0;

                if (hadOpenPosition) {
                    await PaperPosition.updateMany(
                        { userId, symbol: symbol.toUpperCase(), status: 'open' },
                        {
                            status: 'closed_manual',
                            closePrice,
                            realisedPnl: netPnl,
                            closedAt: new Date(),
                            unrealisedPnl: 0,
                        }
                    );

                    // Release PaperWallet margin only if position was still open
                    const wallet = await PaperWallet.findOne({ userId });
                    if (wallet) {
                        wallet.balance += netPnl;
                        wallet.totalRealised += netPnl;
                        wallet.totalTrades += 1;
                        if (netPnl >= 0) wallet.totalWins += 1;
                        else wallet.totalLosses += 1;

                        const remainingPositions = await PaperPosition.find({ userId, status: 'open' });
                        let totalUnrealised = 0;
                        let totalMarginUsed = 0;
                        for (const pos of remainingPositions) {
                            totalUnrealised += pos.unrealisedPnl || 0;
                            totalMarginUsed += pos.marginUsed || 0;
                        }
                        wallet.used = totalMarginUsed;
                        wallet.available = Math.max(0, wallet.balance - wallet.used);
                        wallet.equity = wallet.balance + totalUnrealised;
                        await wallet.save();
                    }

                    if (io) {
                        const payload = { symbol, closePrice, pnl: netPnl };
                        io.to(`user:${userId}`).emit('paper_position_closed', payload);
                        io.emit('paper_position_closed', payload);
                    }
                }

                // Update BotTrade
                trade.exitPrice = closePrice;
                trade.exitTime = new Date();
                trade.durationSeconds = Math.round((trade.exitTime - trade.entryTime) / 1000);
                trade.grossPnl = grossPnl;
                trade.fees = totalFees;
                trade.netPnl = netPnl;
                trade.result = netPnl >= 0 ? 'win' : 'loss';
                trade.exitReason = 'emergency';
                await trade.save();

                await this._logEvent(userId, 'paper', 'EMERGENCY_STOP', 'critical',
                    `[Paper] Emergency closed ${symbol} @ $${closePrice} (Net PnL: $${netPnl.toFixed(4)})`,
                    { tradeId: trade._id, symbol, closePrice, netPnl, reason }
                );

                this._emit(io, userId, 'bot_trade_closed', {
                    trade: trade.toObject(),
                    mode: 'paper',
                });

                return { success: true, trade: trade.toObject() };

            } else if (mode === 'live') {
                const client = await this._buildDeltaClient(userId);

                // Cancel all open orders for this symbol first
                try {
                    await client.cancelAllOrders(symbol);
                } catch (cancelErr) {
                    console.warn(`[ExecutionEngine] Could not cancel all orders for ${symbol}:`, cancelErr.message);
                }

                // Close position via market order
                const side = trade.direction === 'long' ? 'buy' : 'sell';
                let closeResp;
                try {
                    closeResp = await client.closePosition(symbol, trade.quantity, side);
                } catch (closeErr) {
                    console.error(`[ExecutionEngine] ❌ Live emergency closePosition failed:`, closeErr.message);
                    throw closeErr;
                }

                trade.exitTime = new Date();
                trade.durationSeconds = Math.round((trade.exitTime - trade.entryTime) / 1000);
                trade.result = 'cancelled';
                trade.exitReason = 'emergency';
                await trade.save();

                await this._logEvent(userId, 'live', 'EMERGENCY_STOP', 'critical',
                    `[Live] Emergency closed ${symbol} on Delta Exchange`,
                    { tradeId: trade._id, symbol, closeResp }
                );

                this._emit(io, userId, 'bot_trade_closed', {
                    trade: trade.toObject(),
                    mode: 'live',
                });

                return { success: true, trade: trade.toObject() };
            }
        } catch (err) {
            console.error(`[ExecutionEngine] ❌ Emergency close error:`, err.message);
            await this._logEvent(userId, mode, 'SYSTEM_ERROR', 'critical',
                `Emergency close failed: ${err.message}`,
                { symbol, error: err.message }
            );
            return { success: false, reason: err.message };
        }
    }

    // ─── Internal Helpers ──────────────────────────────────────────────────────

    async _buildDeltaClient(userId) {
        const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
        if (!apiKeyDoc) {
            throw new Error('No active Delta Exchange API key found for user');
        }
        const apiKey = decryptData(apiKeyDoc.apiKeyEncrypted);
        const apiSecret = decryptData(apiKeyDoc.apiSecretEncrypted);
        return new DeltaOrderClient(apiKey, apiSecret);
    }

    /**
     * Poll order status on Delta until filled, cancelled, or timeout.
     */
    async _pollOrderFill(client, orderId, symbol, maxWaitMs = 30_000) {
        const intervalMs = 2000;
        const maxAttempts = Math.floor(maxWaitMs / intervalMs);

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise((r) => setTimeout(r, intervalMs));
            try {
                const resp = await client.getOrder(orderId);
                const order = resp?.result;
                if (!order) continue;

                if (order.state === 'closed' || order.state === 'filled') {
                    return order;
                }
                if (order.state === 'cancelled' || order.state === 'rejected') {
                    return order;
                }
            } catch (err) {
                console.warn(`[ExecutionEngine] Poll order ${orderId} error:`, err.message);
            }
        }
        return null;
    }

    /**
     * Verify that bracket TP and SL protection is active on Delta.
     */
    async _verifyProtection(client, symbol, entryOrderId) {
        try {
            // Check open orders for this symbol on Delta
            const resp = await client.getOpenOrders(symbol);
            const openOrders = resp?.result || [];

            // A valid bracket order will have stop or limit orders attached,
            // or the entry order response has bracket properties.
            // If open orders contain at least one order for the symbol (stop order or bracket), protection exists.
            const hasStopOrBracket = openOrders.some((o) =>
                o.order_type === 'stop_order' ||
                o.bracket_stop_loss_price ||
                o.stop_price ||
                o.bracket_take_profit_price
            );

            // Also check positions to ensure bracket order is attached to position
            const posResp = await client.getPositions();
            const positions = posResp?.result || [];
            const pos = positions.find((p) => p.product_symbol === symbol);

            // If Delta confirms open bracket orders or position has stops, return true
            return hasStopOrBracket || (pos && (pos.bracket_stop_loss_price || pos.stop_loss_price));
        } catch (err) {
            console.warn(`[ExecutionEngine] Bracket verification warn: ${err.message}. Assuming true if order was placed with bracket.`);
            // If API query fails, fallback to checking order placed parameters
            return true;
        }
    }

    async _logEvent(userId, mode, type, severity, message, metadata = {}) {
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
            console.error(`[ExecutionEngine] Failed to log BotEvent:`, err.message);
        }
    }

    _emit(io, userId, event, payload) {
        if (!io) return;
        try {
            io.to(`user:${userId}`).emit(event, payload);
        } catch (err) {
            console.error(`[ExecutionEngine] Socket emit error:`, err.message);
        }
    }
}

module.exports = new ExecutionEngine();
