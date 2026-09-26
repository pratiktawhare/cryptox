/**
 * BreakoutWatcher.js
 *
 * Real-time WebSocket monitor for Armed Breakout Tripwires.
 * Evaluates live price breaches on Upper (Long) and Lower (Short) levels.
 *
 * Features:
 *   1. Real-time sub-second execution on trigger breach.
 *   2. Relative Volume (RVOL >= 1.8) surge confirmation to filter fakeouts.
 *   3. Instant OCO (One-Cancels-the-Other) — disarms opposing trigger upon breach.
 *   4. Tripwire TTL auto-expiration (default 60 minutes).
 */

const candleStore = require('./CandleStore');
const executionEngine = require('./ExecutionEngine');
const BotEvent = require('../../models/BotEvent');
const productCatalog = require('../ProductCatalog');

const TRIPWIRE_TTL_MS = 60 * 60 * 1000; // 60 minutes max lifespan

class BreakoutWatcher {
    constructor() {
        /** @type {Map<string, object>} symbol -> tripwire config */
        this.armedTripwires = new Map();
        this.io = null;
        this.wsManager = null;
        this._isAttached = false;
        this._processing = new Set(); // symbols currently executing
        this._pollTimer = null;
    }

    /**
     * Start/attach to DeltaWebSocketManager and Socket.IO.
     *
     * @param {object} io
     * @param {object} wsManager
     */
    start(io = null, wsManager = null) {
        if (io) this.io = io;
        if (wsManager) this.wsManager = wsManager;

        const attachWs = () => {
            if (this.wsManager?._candleEmitter && !this._isAttached) {
                this.wsManager._candleEmitter.on('candle', (candle) => {
                    this.onPriceTick(candle.symbol, candle.close, candle.volume);
                });
                this._isAttached = true;
                console.log('[BreakoutWatcher] 🎯 Attached to WebSocket candle emitter');
            }
        };

        attachWs();

        // High-frequency 2s check against live wsManager ticker prices for any armed tripwires
        if (!this._pollTimer) {
            this._pollTimer = setInterval(() => {
                if (!this._isAttached) attachWs();
                if (this.armedTripwires.size === 0) return;
                for (const [sym] of this.armedTripwires.entries()) {
                    const price = this.wsManager?.getPrice(sym);
                    if (price && price > 0) {
                        this.onPriceTick(sym, price);
                    }
                }
            }, 2000);
        }
    }

    /**
     * Stop watcher and clean up.
     */
    stop() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this.disarmAll('bot_stopped');
        this._isAttached = false;
        console.log('[BreakoutWatcher] ⏹️ Stopped');
    }

    /**
     * Disarm all active tripwires.
     */
    disarmAll(reason = 'manual') {
        const symbols = Array.from(this.armedTripwires.keys());
        for (const sym of symbols) {
            this.disarmTripwire(sym, reason);
        }
    }

    /**
     * Arm dual tripwires for a symbol.
     *
     * @param {object} setup - Output from BreakoutScanner.evaluateSymbol()
     * @param {object} context - { userId, mode, config, effectiveBudget, margin, quantity }
     */
    armTripwire(setup, context) {
        const symbol = setup.symbol.toUpperCase();
        const tripwireData = {
            ...setup,
            ...context,
            armedAt: Date.now(),
        };

        this.armedTripwires.set(symbol, tripwireData);
        console.log(`[BreakoutWatcher] 🎯 ARMED Tripwires for ${symbol}: Long Breakout @ $${setup.upperTripwire.toFixed(4)} | Short Breakdown @ $${setup.lowerTripwire.toFixed(4)} (TP: +${setup.targetRoiPct}%)`);

        // Emit Socket.IO event for frontend dashboard
        if (this.io) {
            this.io.emit('bot_tripwire_armed', {
                symbol,
                upperTripwire: setup.upperTripwire,
                lowerTripwire: setup.lowerTripwire,
                rangeHigh: setup.rangeHigh,
                rangeLow: setup.rangeLow,
                bandwidth: setup.bandwidth,
                squeezeBars: setup.squeezeBars,
                targetRoiPct: setup.targetRoiPct,
                mode: context.mode,
            });
        }

        // Log BotEvent audit
        this._logEvent(context.userId, context.mode, 'TRIPWIRE_ARMED', 'info',
            `🎯 [ARMED] ${symbol}: Dual tripwires armed (Squeeze: ${setup.squeezeBars} bars). Long @ $${setup.upperTripwire.toFixed(4)}, Short @ $${setup.lowerTripwire.toFixed(4)}`,
            { symbol, upperTripwire: setup.upperTripwire, lowerTripwire: setup.lowerTripwire }
        );
    }

    /**
     * Disarm / cancel tripwires for a symbol.
     *
     * @param {string} symbol
     * @param {string} reason
     */
    disarmTripwire(symbol, reason = 'manual') {
        const sym = symbol.toUpperCase();
        const existing = this.armedTripwires.get(sym);
        if (!existing) return;

        this.armedTripwires.delete(sym);
        console.log(`[BreakoutWatcher] Disarmed tripwires for ${sym}: ${reason}`);

        if (this.io) {
            this.io.emit('bot_tripwire_disarmed', { symbol: sym, reason });
        }
    }

    /**
     * Returns an array of all currently armed tripwires for display.
     */
    getArmedTripwires() {
        return Array.from(this.armedTripwires.values());
    }

    /**
     * Called whenever a price tick arrives from WebSocket ticker or 1m candle.
     *
     * @param {string} symbol
     * @param {number} livePrice
     * @param {number} [tickVolume]
     */
    async onPriceTick(symbol, livePrice, tickVolume = null) {
        if (!symbol || !livePrice || livePrice <= 0) return;
        const sym = symbol.toUpperCase();

        const tripwire = this.armedTripwires.get(sym);
        if (!tripwire) return;

        // 1. Check TTL Expiration (60 minutes)
        if (Date.now() - tripwire.armedAt > TRIPWIRE_TTL_MS) {
            this.disarmTripwire(sym, 'expired');
            this._logEvent(tripwire.userId, tripwire.mode, 'TRIPWIRE_EXPIRED', 'info',
                `[Breakout] Tripwires for ${sym} expired after 60 min without breakout breach. Disarmed.`,
                { symbol: sym }
            );
            return;
        }

        // Lock symbol to prevent duplicate triggers
        if (this._processing.has(sym)) return;

        // 2. Check Upper Tripwire (Long Breakout)
        if (livePrice >= tripwire.upperTripwire) {
            await this._triggerBreakout(tripwire, 'long', livePrice);
            return;
        }

        // 3. Check Lower Tripwire (Short Breakdown)
        if (livePrice <= tripwire.lowerTripwire) {
            await this._triggerBreakout(tripwire, 'short', livePrice);
            return;
        }
    }

    /**
     * Internal: Fires the breakout trade with RVOL surge validation and OCO cancellation.
     */
    async _triggerBreakout(tripwire, direction, triggerPrice) {
        const sym = tripwire.symbol;
        this._processing.add(sym);

        try {
            console.log(`[BreakoutWatcher] ⚡ BREACH DETECTED for ${direction.toUpperCase()} ${sym} @ $${triggerPrice}! Checking RVOL volume surge...`);

            // 1. Advancification: Relative Volume (RVOL) Surge Confirmation
            let candles1m = candleStore.getCandles(sym, '1m', 25);
            if (!candles1m || candles1m.length < 15) {
                try {
                    await candleStore.ensureCandles(sym, '1m', 25);
                    candles1m = candleStore.getCandles(sym, '1m', 25);
                } catch { /* ignore */ }
            }

            let rvol = 1.0;
            if (candles1m && candles1m.length >= 10) {
                const recentVol = candles1m.slice(0, -1).map(c => c.volume);
                const avgVol = recentVol.reduce((s, v) => s + v, 0) / (recentVol.length || 1);
                const currentVol = candles1m[candles1m.length - 1]?.volume || avgVol;
                rvol = avgVol > 0 ? (currentVol / avgVol) : 2.0;
            } else {
                // If candle history is fresh and volume history unavailable, accept with nominal surge
                rvol = 2.0;
            }

            const minRvol = tripwire.config?.breakoutRvolMin || 1.8;
            if (rvol < minRvol) {
                console.log(`[BreakoutWatcher] ⚠️ Breach skipped: RVOL ${rvol.toFixed(2)}x < ${minRvol}x threshold (likely low-volume fakeout)`);
                this._processing.delete(sym);
                return; // Wait for real institutional volume surge
            }

            // 2. Instant OCO (One-Cancels-the-Other) — Disarm the tripwire so opposite side is dead
            this.armedTripwires.delete(sym);

            // 3. Select SL / TP based on direction
            const isLong = direction === 'long';
            const takeProfit = isLong ? tripwire.takeProfitLong : tripwire.takeProfitShort;
            const stopLoss   = isLong ? tripwire.stopLossLong : tripwire.stopLossShort;

            console.log(`[BreakoutWatcher] 🚀 FIRING ${direction.toUpperCase()} BREAKOUT on ${sym}! Price: $${triggerPrice}, TP: $${takeProfit.toFixed(4)}, SL: $${stopLoss.toFixed(4)} (RVOL: ${rvol.toFixed(2)}x)`);

            // 4. Execute Trade via ExecutionEngine
            const execResult = await executionEngine.executeTrade({
                userId:                 tripwire.userId,
                mode:                   tripwire.mode,
                symbol:                 sym,
                direction,
                entryPrice:             triggerPrice,
                stopLoss,
                takeProfit,
                quantity:               tripwire.quantity || 1,
                leverage:               tripwire.config?.maxLeverage || 20,
                margin:                 tripwire.margin || 5.0,
                signalScore:            8,
                regime:                 'BREAKOUT_EXPANSION',
                walletBalanceAtEntry:   tripwire.walletBalanceAtEntry,
                effectiveBudgetAtEntry: tripwire.effectiveBudgetAtEntry,
                productSpec:            productCatalog.getBySymbol(sym),
                io:                     this.io,
                wsManager:              this.wsManager,
                orderType:              'market_order', // immediate entry on breakout breach
                strategyType:           'breakout_straddle',
                breakoutLevel:          isLong ? tripwire.upperTripwire : tripwire.lowerTripwire,
            });

            // 5. Audit Log Event
            await this._logEvent(tripwire.userId, tripwire.mode, 'BREAKOUT_TRIGGERED', 'info',
                `🚀 [BREAKOUT] ${sym} (${direction.toUpperCase()}): Breached tripwire @ $${triggerPrice} with ${rvol.toFixed(1)}x RVOL! Target TP: $${takeProfit.toFixed(4)} (+${tripwire.targetRoiPct}% ROI)`,
                { symbol: sym, direction, triggerPrice, rvol, takeProfit, stopLoss }
            );

            if (this.io) {
                this.io.emit('bot_tripwire_triggered', {
                    symbol: sym,
                    direction,
                    triggerPrice,
                    takeProfit,
                    stopLoss,
                    mode: tripwire.mode,
                });
            }
        } catch (err) {
            console.error(`[BreakoutWatcher] Execution error on ${sym}:`, err.message);
        } finally {
            this._processing.delete(sym);
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
        } catch (e) { /* ignore */ }
    }
}

module.exports = new BreakoutWatcher();
