/**
 * PositionMonitor.js
 *
 * Background monitor for open BotTrade positions.
 * Runs periodically (default every 10s) to check TP/SL hits, compute unrealised P&L,
 * execute exits, update PaperWallet balances, record risk metrics (daily loss, consecutive losses, cooldown),
 * and push real-time updates via Socket.IO.
 */

const BotTrade = require('../../models/BotTrade');
const BotEvent = require('../../models/BotEvent');
const PaperPosition = require('../../models/PaperPosition');
const PaperWallet = require('../../models/PaperWallet');
const TradingConfig = require('../../models/TradingConfig');
const ApiKey = require('../../models/ApiKey');
const DeltaOrderClient = require('../trading/DeltaOrderClient');
const productCatalog = require('../ProductCatalog');
const notificationService = require('../NotificationService');
const { decryptData } = require('../../utils/encryption');

class PositionMonitor {
    constructor() {
        this.io = null;
        this.wsManager = null;
        this._timer = null;
        this._intervalMs = 10_000; // 10s
        this._isTicking = false;

        /**
         * Memory cache for fast risk checks:
         * key: `${userId}:${mode}` -> { dateStr, dailyLoss, consecutiveLosses, cooldownUntil }
         */
        this._riskStats = new Map();
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start(io = null, wsManager = null, intervalMs = 10_000) {
        if (this._timer) return;
        this.io = io;
        this.wsManager = wsManager;
        this._intervalMs = intervalMs;

        this._timer = setInterval(() => this._tick(), this._intervalMs);
        console.log(`[PositionMonitor] 👁️ Started — checking open positions every ${this._intervalMs / 1000}s`);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            console.log('[PositionMonitor] Stopped');
        }
    }

    // ─── Risk & Cooldown State Management ─────────────────────────────────────

    _getKey(userId, mode) {
        return `${String(userId)}:${mode}`;
    }

    _getTodayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    /**
     * Get or initialize today's daily risk stats for (userId, mode).
     * Automatically queries today's closed BotTrade records if not cached.
     */
    async getDailyStats(userId, mode) {
        const key = this._getKey(userId, mode);
        const todayStr = this._getTodayStr();
        const cached = this._riskStats.get(key);

        if (cached && cached.dateStr === todayStr) {
            return {
                dailyLoss: cached.dailyLoss,
                consecutiveLosses: cached.consecutiveLosses,
                cooldownUntil: cached.cooldownUntil,
            };
        }

        // Query today's closed trades from DB
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);

        const todayTrades = await BotTrade.find({
            userId,
            mode,
            exitTime: { $gte: startOfDay },
            result: { $in: ['win', 'loss'] },
        }).sort({ exitTime: 1 });

        let dailyLoss = 0;
        let consecutiveLosses = 0;

        for (const t of todayTrades) {
            if (t.netPnl < 0) {
                dailyLoss += Math.abs(t.netPnl);
                consecutiveLosses += 1;
            } else {
                consecutiveLosses = 0;
            }
        }

        const state = {
            dateStr: todayStr,
            dailyLoss,
            consecutiveLosses,
            cooldownUntil: cached?.cooldownUntil || null,
        };
        this._riskStats.set(key, state);

        return {
            dailyLoss: state.dailyLoss,
            consecutiveLosses: state.consecutiveLosses,
            cooldownUntil: state.cooldownUntil,
        };
    }

    /**
     * Record a closed trade result, updating daily loss, consecutive losses, and cooldown.
     */
    async recordTradeResult(userId, mode, netPnl, config = null) {
        const stats = await this.getDailyStats(userId, mode);
        const key = this._getKey(userId, mode);
        const cooldownSec = config?.cooldownSeconds || 60;

        if (netPnl < 0) {
            stats.dailyLoss += Math.abs(netPnl);
            stats.consecutiveLosses += 1;
        } else {
            stats.consecutiveLosses = 0;
        }

        stats.cooldownUntil = Date.now() + cooldownSec * 1000;
        this._riskStats.set(key, { ...stats, dateStr: this._getTodayStr() });

        console.log(`[PositionMonitor] 📊 Risk stats updated for ${mode}: dailyLoss=$${stats.dailyLoss.toFixed(4)}, consecutiveLosses=${stats.consecutiveLosses}, cooldown=${cooldownSec}s`);
    }

    // ─── Main Monitoring Tick ──────────────────────────────────────────────────

    async _tick() {
        if (this._isTicking) return;
        this._isTicking = true;

        try {
            const openTrades = await BotTrade.find({ result: 'open' });
            if (!openTrades || openTrades.length === 0) {
                return;
            }

            for (const trade of openTrades) {
                try {
                    if (trade.mode === 'paper') {
                        await this._checkPaperTrade(trade);
                    } else if (trade.mode === 'live') {
                        await this._checkLiveTrade(trade);
                    }
                } catch (tradeErr) {
                    console.error(`[PositionMonitor] Error checking trade ${trade._id} (${trade.symbol}):`, tradeErr.message);
                }
            }
        } catch (err) {
            console.error('[PositionMonitor] Tick error:', err.message);
        } finally {
            this._isTicking = false;
        }
    }

    // ─── Paper Trade Monitoring ────────────────────────────────────────────────

    async _checkPaperTrade(trade) {
        const symbol = trade.symbol;
        let currentPrice = null;

        if (this.wsManager?.getPrice) {
            currentPrice = this.wsManager.getPrice(symbol);
        }

        if (!currentPrice) {
            return; // No price data available yet
        }

        const spec = productCatalog.getBySymbol(symbol);
        const contractValue = parseFloat(spec?.contract_value || 1);
        const isLong = trade.direction === 'long';

        // Calculate current unrealised gross P&L
        const priceDiff = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
        const unrealisedGross = priceDiff * trade.quantity * contractValue;
        const roe = trade.margin > 0 ? (unrealisedGross / trade.margin) * 100 : 0;

        // Update PaperPosition for real-time tracking
        await PaperPosition.updateMany(
            { userId: trade.userId, symbol, status: 'open' },
            {
                markPrice: currentPrice,
                unrealisedPnl: unrealisedGross,
                roe,
            }
        );

        // Check Take Profit hit
        let hitTP = isLong ? currentPrice >= trade.takeProfit : currentPrice <= trade.takeProfit;
        // Check Stop Loss hit
        let hitSL = isLong ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss;

        if (hitTP || hitSL) {
            const exitReason = hitTP ? 'take_profit' : 'stop_loss';
            const exitPrice = hitTP ? trade.takeProfit : trade.stopLoss;
            await this._closePaperTrade(trade, exitPrice, exitReason, contractValue, isLong);
        } else {
            // Push real-time position update
            this._emit(trade.userId, 'bot_position_updated', {
                tradeId: trade._id,
                symbol,
                currentPrice,
                unrealisedPnl: unrealisedGross,
                roe,
                mode: 'paper',
            });
        }
    }

    async _closePaperTrade(trade, exitPrice, exitReason, contractValue, isLong) {
        const priceDiff = isLong ? (exitPrice - trade.entryPrice) : (trade.entryPrice - exitPrice);
        const grossPnl = priceDiff * trade.quantity * contractValue;

        // Exit fee: taker rate on entry-price notional (matches CostEngine estimation basis)
        // Note: do NOT subtract trade.slippage again here — it was already factored into the
        // TP distance by RiskEngine via CostEngine.breakEvenAbs. Double-deducting it would
        // turn TP hits into apparent losses on small/low-margin trades.
        const entryNotional = trade.entryPrice * trade.quantity * contractValue;
        const exitFee = entryNotional * (0.0005 * 1.18); // taker 0.05% + 18% GST
        const totalFees = (trade.fees || 0) + exitFee;
        const netPnl = grossPnl - totalFees;

        const isWin = netPnl >= 0;

        // 1. Update BotTrade
        trade.exitPrice = exitPrice;
        trade.exitTime = new Date();
        trade.durationSeconds = Math.round((trade.exitTime - trade.entryTime) / 1000);
        trade.grossPnl = grossPnl;
        trade.fees = totalFees;
        trade.netPnl = netPnl;
        trade.result = isWin ? 'win' : 'loss';
        trade.exitReason = exitReason;
        await trade.save();

        // 2. Update PaperPosition
        await PaperPosition.updateMany(
            { userId: trade.userId, symbol: trade.symbol, status: 'open' },
            {
                status: exitReason === 'take_profit' ? 'closed_tp' : (exitReason === 'smart_loss_guard' ? 'closed_smart_guard' : 'closed_sl'),
                closePrice: exitPrice,
                realisedPnl: netPnl,
                closedAt: new Date(),
                unrealisedPnl: 0,
            }
        );

        // 3. Update PaperWallet balance
        const wallet = await PaperWallet.findOne({ userId: trade.userId });
        if (wallet) {
            wallet.available += trade.margin + netPnl;
            wallet.used = Math.max(0, wallet.used - trade.margin);
            wallet.balance += netPnl;
            wallet.totalRealised += netPnl;
            wallet.totalTrades += 1;
            if (isWin) wallet.totalWins += 1;
            else wallet.totalLosses += 1;
            await wallet.save();
        }

        // 4. Update Risk Stats & Cooldown
        const config = await TradingConfig.findOne({ userId: trade.userId, mode: 'paper' });
        await this.recordTradeResult(trade.userId, 'paper', netPnl, config);

        // 5. Log BotEvents
        const eventType = exitReason === 'take_profit' ? 'POSITION_CLOSED_TP' : (exitReason === 'smart_loss_guard' ? 'POSITION_CLOSED_SMART_GUARD' : 'POSITION_CLOSED_SL');
        await this._logEvent(
            trade.userId,
            'paper',
            eventType,
            isWin ? 'info' : 'warn',
            `[Paper] ${trade.symbol} closed via ${exitReason.toUpperCase()} @ $${exitPrice} | Net PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(4)}`,
            { tradeId: trade._id, symbol: trade.symbol, exitPrice, netPnl, grossPnl, fees: totalFees, exitReason }
        );

        // 6. Notify user
        this._notifyOutcome(trade.userId, trade.symbol, trade.direction, isWin, exitPrice, netPnl, exitReason);

        // 7. Emit Socket.IO events
        this._emit(trade.userId, 'bot_trade_closed', {
            trade: trade.toObject(),
            wallet: wallet ? wallet.toObject() : null,
            mode: 'paper',
        });
        this._emit(trade.userId, 'bot_position_updated', {
            symbol: trade.symbol,
            status: 'closed',
            mode: 'paper',
        });

        console.log(`[PositionMonitor] 📄 [Paper] Trade ${trade.symbol} closed via ${exitReason} @ $${exitPrice} | Net PnL: $${netPnl.toFixed(4)}`);
    }

    /**
     * Public method to close a trade immediately with a custom exitReason
     * (e.g. 'smart_loss_guard'). Supports both Paper and Live modes.
     *
     * @param {object} trade       - BotTrade document
     * @param {number} exitPrice   - Market / limit price to execute close
     * @param {string} exitReason  - e.g. 'smart_loss_guard'
     * @param {object} [metadata]  - Additional telemetry details
     */
    async closeTradeWithReason(trade, exitPrice, exitReason = 'smart_loss_guard', metadata = {}) {
        const spec = productCatalog.getBySymbol(trade.symbol);
        const contractValue = parseFloat(spec?.contract_value || trade.contractValue || 1);
        const isLong = trade.direction === 'long';

        if (trade.mode === 'paper') {
            await this._closePaperTrade(trade, exitPrice, exitReason, contractValue, isLong);
        } else if (trade.mode === 'live') {
            const client = await this._buildDeltaClient(trade.userId);
            if (!client) {
                throw new Error(`No Delta client available to close live trade for user ${trade.userId}`);
            }

            // 1. Cancel open orders for symbol on Delta (prevents pending bracket orders from triggering)
            try {
                await client.cancelAllOrders(trade.symbol);
            } catch (cancelErr) {
                console.warn(`[PositionMonitor] Cancel orders warning for ${trade.symbol}:`, cancelErr.message);
            }

            // 2. Place limit close order at exitPrice, falling back to market order if needed
            const side = isLong ? 'buy' : 'sell'; // opposite of position side
            try {
                await client.closePosition(trade.symbol, trade.quantity, side, exitPrice);
            } catch (ordErr) {
                console.warn(`[PositionMonitor] Limit close failed (${ordErr.message}), falling back to market close:`, ordErr.message);
                await client.closePosition(trade.symbol, trade.quantity, side);
            }

            // 3. Calculate PnL
            const priceDiff = isLong ? (exitPrice - trade.entryPrice) : (trade.entryPrice - exitPrice);
            const grossPnl = priceDiff * trade.quantity * contractValue;
            const exitFee = (trade.entryPrice * trade.quantity * contractValue) * 0.0005;
            const totalFees = (trade.fees || 0) + exitFee;
            const netPnl = grossPnl - totalFees;
            const isWin = netPnl >= 0;

            // 4. Update BotTrade
            trade.exitPrice = exitPrice;
            trade.exitTime = new Date();
            trade.durationSeconds = Math.round((trade.exitTime - trade.entryTime) / 1000);
            trade.grossPnl = grossPnl;
            trade.fees = totalFees;
            trade.netPnl = netPnl;
            trade.result = isWin ? 'win' : 'loss';
            trade.exitReason = exitReason;
            await trade.save();

            // 5. Update Risk Stats & Cooldown
            const config = await TradingConfig.findOne({ userId: trade.userId, mode: 'live' });
            await this.recordTradeResult(trade.userId, 'live', netPnl, config);

            // 6. Log BotEvent
            const eventType = exitReason === 'smart_loss_guard' ? 'POSITION_CLOSED_SMART_GUARD' : (isWin ? 'POSITION_CLOSED_TP' : 'POSITION_CLOSED_SL');
            await this._logEvent(
                trade.userId,
                'live',
                eventType,
                'warn',
                `[Live] ${trade.symbol} closed via ${exitReason.toUpperCase()} @ $${exitPrice} | Net PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(4)}`,
                { tradeId: trade._id, symbol: trade.symbol, exitPrice, netPnl, grossPnl, fees: totalFees, exitReason, ...metadata }
            );

            // 7. Notify user
            this._notifyOutcome(trade.userId, trade.symbol, trade.direction, isWin, exitPrice, netPnl, exitReason);

            // 8. Emit Socket.IO events
            this._emit(trade.userId, 'bot_trade_closed', {
                trade: trade.toObject(),
                mode: 'live',
            });
            this._emit(trade.userId, 'bot_position_updated', {
                symbol: trade.symbol,
                status: 'closed',
                mode: 'live',
            });

            console.log(`[PositionMonitor] 💰 [Live] Trade ${trade.symbol} closed via ${exitReason} @ $${exitPrice} | Net PnL: $${netPnl.toFixed(4)}`);
        }
    }

    // ─── Live Trade Monitoring ─────────────────────────────────────────────────

    async _checkLiveTrade(trade) {
        const client = await this._buildDeltaClient(trade.userId);
        if (!client) return;

        // 1. Fetch positions from Delta
        let positions = [];
        try {
            const posResp = await client.getPositions();
            positions = posResp?.result || [];
        } catch (posErr) {
            console.warn(`[PositionMonitor] Could not fetch positions from Delta:`, posErr.message);
            return;
        }

        const openDeltaPos = positions.find(
            (p) => p.product_symbol === trade.symbol && Math.abs(parseFloat(p.size || 0)) > 0
        );

        if (openDeltaPos) {
            // Position is still active on Delta — emit live updates
            const markPrice = parseFloat(openDeltaPos.mark_price || trade.entryPrice);
            const unrealisedPnl = parseFloat(openDeltaPos.unrealized_pnl || 0);

            this._emit(trade.userId, 'bot_position_updated', {
                tradeId: trade._id,
                symbol: trade.symbol,
                currentPrice: markPrice,
                unrealisedPnl,
                mode: 'live',
            });
            return;
        }

        // 2. Position is no longer in open positions on Delta -> Closed!
        console.log(`[PositionMonitor] 💰 [Live] Position for ${trade.symbol} no longer open on Delta. Fetching fills...`);

        let fills = [];
        try {
            const fillResp = await client.getFills(trade.symbol, 5);
            fills = fillResp?.result || [];
        } catch (fillErr) {
            console.warn(`[PositionMonitor] Could not fetch fills from Delta:`, fillErr.message);
        }

        // Locate exit fill (opposite side)
        const exitSide = trade.direction === 'long' ? 'sell' : 'buy';
        const exitFill = fills.find((f) => f.side === exitSide) || fills[0];

        let exitPrice = trade.takeProfit;
        let exitFee = trade.quantity * trade.entryPrice * 0.0005;

        if (exitFill) {
            exitPrice = parseFloat(exitFill.fill_price || exitFill.price || trade.entryPrice);
            exitFee = parseFloat(exitFill.fee || exitFee);
        }

        // Determine if TP or SL was hit based on proximity
        const distTP = Math.abs(exitPrice - trade.takeProfit);
        const distSL = Math.abs(exitPrice - trade.stopLoss);
        const exitReason = distTP <= distSL ? 'take_profit' : 'stop_loss';

        const spec = productCatalog.getBySymbol(trade.symbol);
        const contractValue = parseFloat(spec?.contract_value || 1);
        const isLong = trade.direction === 'long';
        const priceDiff = isLong ? (exitPrice - trade.entryPrice) : (trade.entryPrice - exitPrice);
        const grossPnl = priceDiff * trade.quantity * contractValue;
        const totalFees = (trade.fees || 0) + exitFee;
        const netPnl = grossPnl - totalFees;
        const isWin = netPnl >= 0;

        // Update BotTrade
        trade.exitPrice = exitPrice;
        trade.exitTime = new Date();
        trade.durationSeconds = Math.round((trade.exitTime - trade.entryTime) / 1000);
        trade.grossPnl = grossPnl;
        trade.fees = totalFees;
        trade.netPnl = netPnl;
        trade.result = isWin ? 'win' : 'loss';
        trade.exitReason = exitReason;
        await trade.save();

        // Clean up any remaining orders on Delta for this symbol
        try {
            await client.cancelAllOrders(trade.symbol);
        } catch (cancelErr) {
            console.warn(`[PositionMonitor] Cancel all orders cleanup warn:`, cancelErr.message);
        }

        // Update Risk Stats & Cooldown
        const config = await TradingConfig.findOne({ userId: trade.userId, mode: 'live' });
        await this.recordTradeResult(trade.userId, 'live', netPnl, config);

        // Log BotEvent
        const eventType = exitReason === 'take_profit' ? 'POSITION_CLOSED_TP' : 'POSITION_CLOSED_SL';
        await this._logEvent(
            trade.userId,
            'live',
            eventType,
            isWin ? 'info' : 'warn',
            `[Live] ${trade.symbol} closed on Delta via ${exitReason.toUpperCase()} @ $${exitPrice} | Net PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(4)}`,
            { tradeId: trade._id, symbol: trade.symbol, exitPrice, netPnl, grossPnl, fees: totalFees, exitReason }
        );

        // Notify user
        this._notifyOutcome(trade.userId, trade.symbol, trade.direction, isWin, exitPrice, netPnl);

        // Emit Socket.IO events
        this._emit(trade.userId, 'bot_trade_closed', {
            trade: trade.toObject(),
            mode: 'live',
        });
        this._emit(trade.userId, 'bot_position_updated', {
            symbol: trade.symbol,
            status: 'closed',
            mode: 'live',
        });

        console.log(`[PositionMonitor] 💰 [Live] Trade ${trade.symbol} closed via ${exitReason} @ $${exitPrice} | Net PnL: $${netPnl.toFixed(4)}`);
    }

    // ─── Internal Helpers ──────────────────────────────────────────────────────

    async _buildDeltaClient(userId) {
        try {
            const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
            if (!apiKeyDoc) return null;
            const apiKey = decryptData(apiKeyDoc.apiKeyEncrypted);
            const apiSecret = decryptData(apiKeyDoc.apiSecretEncrypted);
            return new DeltaOrderClient(apiKey, apiSecret);
        } catch (err) {
            console.error(`[PositionMonitor] Failed to build Delta client:`, err.message);
            return null;
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
            console.error(`[PositionMonitor] Failed to log BotEvent:`, err.message);
        }
    }

    _emit(userId, event, payload) {
        if (!this.io) return;
        try {
            this.io.to(`user:${userId}`).emit(event, payload);
        } catch (err) {
            console.error(`[PositionMonitor] Socket emit error:`, err.message);
        }
    }

    _notifyOutcome(userId, symbol, direction, isWin, exitPrice, netPnl, exitReason = null) {
        try {
            const sym = (symbol || '').replace('USD', '/USD');
            const pnlStr = `${netPnl >= 0 ? '+' : ''}$${Number(netPnl).toFixed(2)}`;
            let title = isWin ? `🎯 Target Hit: ${sym}` : `🛑 Stop Loss: ${sym}`;
            let message = `${isWin ? 'Profit' : 'Loss'}: ${pnlStr} on ${direction.toUpperCase()} @ $${Number(exitPrice).toFixed(4)}`;

            if (exitReason === 'smart_loss_guard') {
                title = `🛡️ Smart Loss Guard: ${sym}`;
                message = `Auto-exited early on trend reversal: ${pnlStr} on ${direction.toUpperCase()} @ $${Number(exitPrice).toFixed(4)}`;
            }

            if (notificationService?._createAndEmit) {
                notificationService._createAndEmit(userId, {
                    type: 'resolved',
                    title,
                    message,
                    priority: 'high',
                    sound: exitReason === 'smart_loss_guard' ? 'stoploss_hit' : (isWin ? 'target_hit' : 'stoploss_hit'),
                }).catch(() => {});
            }
        } catch (e) {
            // Ignore notification errors
        }
    }
}

module.exports = new PositionMonitor();
