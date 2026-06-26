/**
 * SignalTracker.js
 *
 * Monitors live price vs each open signal's SL/TP every 30 seconds.
 * When price hits TP or SL, writes outcome to AiCorrection and emits
 * a Socket.IO event so the frontend can update the signal card.
 *
 * Also marks signals as "expired" if open for > 24 hours without a hit.
 */

const TradeSignal  = require('../../models/TradeSignal');
const AiCorrection = require('../../models/AiCorrection');
const notificationService = require('../NotificationService');

const CHECK_INTERVAL_MS  = 30_000;  // 30 seconds
const SIGNAL_EXPIRY_HOURS = 24;     // auto-expire after 24h

class SignalTracker {
    constructor() {
        this.io         = null;
        this.timer      = null;
        this.running    = false;
        this._priceMap  = null; // reference to WS manager's live price map
    }

    start(io, wsManager) {
        if (this.running) return;
        this.io         = io;
        this._wsManager = wsManager;
        this.running    = true;
        this.timer      = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
        console.log('[SignalTracker] 🎯 Started — checking outcomes every 30s');
    }

    stop() {
        this.running = false;
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    _getPrice(symbol) {
        return this._wsManager?.getPrice?.(symbol) || null;
    }

    async _tick() {
        if (!this.running) return;
        try {
            // Fetch all active signals (BUY/SELL with SL/TP set)
            const signals = await TradeSignal.find({
                action:   { $in: ['BUY', 'SELL'] },
                status:   { $in: ['active', 'pending'] },
                stopLoss: { $ne: null },
            }).lean();

            const now = Date.now();

            for (const signal of signals) {
                const price = this._getPrice(signal.symbol);
                if (!price) continue;

                // ── Check expiry ──────────────────────────────────────────
                const ageHours = (now - new Date(signal.createdAt).getTime()) / 3_600_000;
                if (ageHours > SIGNAL_EXPIRY_HOURS) {
                    await this._markOutcome(signal, price, 'timeout');
                    continue;
                }

                const isBuy = signal.action === 'BUY';

                // ── TP hit ────────────────────────────────────────────────
                if (signal.target1) {
                    const tpHit = isBuy
                        ? price >= signal.target1
                        : price <= signal.target1;
                    if (tpHit) {
                        await this._markOutcome(signal, price, 'tp_hit');
                        continue;
                    }
                }

                // ── SL hit ────────────────────────────────────────────────
                const slHit = isBuy
                    ? price <= signal.stopLoss
                    : price >= signal.stopLoss;
                if (slHit) {
                    await this._markOutcome(signal, price, 'sl_hit');
                }
            }
        } catch (err) {
            console.error('[SignalTracker] tick error:', err.message);
        }
    }

    async _markOutcome(signal, exitPrice, rawOutcome) {
        try {
            const isBuy    = signal.action === 'BUY';
            const entry    = signal.entry || 0;
            const sl       = signal.stopLoss || 0;
            const tp       = signal.target1 || 0;

            // Determine win/loss
            let outcome;
            if (rawOutcome === 'tp_hit')   outcome = 'win';
            else if (rawOutcome === 'sl_hit') outcome = 'loss';
            else outcome = 'timeout';

            // Realised PnL as % of risk
            let realisedPnlPct = null;
            if (entry > 0 && sl > 0) {
                const riskPerUnit = Math.abs(entry - sl);
                if (riskPerUnit > 0) {
                    const movePerUnit = isBuy ? exitPrice - entry : entry - exitPrice;
                    realisedPnlPct = (movePerUnit / riskPerUnit) * 100;
                }
            }

            // Entry accuracy (how close actual open signal price was to predicted entry)
            let entryAccuracy = null;
            if (entry > 0) {
                entryAccuracy = Math.max(0, 1 - Math.abs(exitPrice - entry) / entry);
            }

            // Holding hours
            const holdingHours = (Date.now() - new Date(signal.createdAt).getTime()) / 3_600_000;

            // R/R achieved
            let rrAchieved = null;
            if (entry > 0 && sl > 0 && tp > 0) {
                const risk   = Math.abs(entry - sl);
                const reward = isBuy ? exitPrice - entry : entry - exitPrice;
                if (risk > 0) rrAchieved = reward / risk;
            }

            // Upsert outcome record
            await AiCorrection.findOneAndUpdate(
                { signalId: signal._id },
                {
                    $setOnInsert: { signalId: signal._id, symbol: signal.symbol },
                    $set: {
                        action:          signal.action,
                        predictedEntry:  entry,
                        predictedSL:     sl,
                        predictedTP:     tp,
                        predictedRR:     signal.riskReward || null,
                        confidence:      signal.confidence || null,
                        outcome,
                        actualExitPrice: exitPrice,
                        realisedPnlPct,
                        entryAccuracy,
                        holdingHours,
                        rrAchieved,
                        checkedAt: new Date(),
                    },
                },
                { upsert: true }
            );

            // Update signal status
            await TradeSignal.findByIdAndUpdate(signal._id, {
                status: rawOutcome === 'timeout' ? 'expired' : (outcome === 'win' ? 'completed' : 'stopped'),
            });

            console.log(`[SignalTracker] ${outcome === 'win' ? '✅' : outcome === 'loss' ? '❌' : '⏱️'} ${signal.symbol} ${signal.action} → ${outcome} @ $${exitPrice} | PnL: ${realisedPnlPct?.toFixed(1) ?? '?'}%`);

            // Emit to frontend
            this.io?.emit('signal_outcome', {
                signalId: String(signal._id),
                symbol:   signal.symbol,
                outcome,
                exitPrice,
                realisedPnlPct,
                holdingHours,
            });

            // Push notification
            if (outcome !== 'timeout') {
                notificationService.notifySignalResolved(signal, outcome, exitPrice, realisedPnlPct).catch(() => {});
            }

        } catch (err) {
            console.error(`[SignalTracker] markOutcome error (${signal.symbol}):`, err.message);
        }
    }
}

module.exports = new SignalTracker();
