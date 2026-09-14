/**
 * AutomationEngine.js
 *
 * Runs AI-driven trade automation for both paper and live modes independently.
 *
 * Features:
 *  - Scans every N minutes (configurable per mode, default 30m)
 *  - Respects wallet balance: skips if remaining < 5% of estimatedWallet
 *  - Margin sizing: estimatedWallet × tradePct% → margin per trade
 *  - Leverage: AI decides within [minLeverage, maxLeverage] range
 *  - Retries: tries up to 5 coins per cycle before returning NO_TRADE
 *  - Trail stop-loss every 5 minutes (1R → breakeven, 2R → lock +0.5R)
 *  - Daily report: generates DailyReport doc + in-app notification at configured time
 */

const UserPreferences  = require('../../models/UserPreferences');
const AutomationLog    = require('../../models/AutomationLog');
const DailyReport      = require('../../models/DailyReport');
const PaperWallet      = require('../../models/PaperWallet');
const PaperPosition    = require('../../models/PaperPosition');
const notificationSvc  = require('../NotificationService');

// IST offset
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST()       { return new Date(Date.now() + IST_OFFSET_MS); }
function istDateStr()   { return nowIST().toISOString().slice(0, 10); }
function istTimeStr()   { const d = nowIST(); return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`; }

class AutomationEngine {
    constructor() {
        this._paperTimer    = null;
        this._liveTimer     = null;
        this._trailTimer    = null;
        this._reportTimer   = null;
        this._running       = { paper: false, live: false };
        this._io            = null;
        this._signalEngine  = null;
        this._paperEngine   = null;
        this._orderExecutor = null;
        this._wsManager     = null;
    }

    // ─── Initialise ─────────────────────────────────────────────────────────

    init(io, signalEngine, paperEngine, orderExecutor, wsManager) {
        this._io            = io;
        this._signalEngine  = signalEngine;
        this._paperEngine   = paperEngine;
        this._orderExecutor = orderExecutor;
        this._wsManager     = wsManager;

        // Trail stop-loss every 5 minutes regardless of automation mode
        this._trailTimer = setInterval(() => this._trailAllPositions(), 5 * 60 * 1000);

        // Daily report check every minute
        this._reportTimer = setInterval(() => this._checkDailyReports(), 60 * 1000);

        console.log('[AutomationEngine] Initialised ✓');
    }

    // ─── Public control ─────────────────────────────────────────────────────

    async startMode(mode) {
        if (this._running[mode]) {
            console.log(`[AutomationEngine] ${mode} already running`);
            return;
        }

        const prefs = await this._loadPrefs();
        const cfg   = prefs?.[`${mode}Auto`];

        if (!cfg?.enabled) {
            console.log(`[AutomationEngine] ${mode} not enabled in preferences — enabling now`);
            // Don't abort — caller (route) already set enabled=true in DB, just proceed
        }

        this._running[mode] = true;
        const intervalMin = cfg?.intervalMinutes || 30;
        console.log(`[AutomationEngine] ▶ Starting ${mode} automation (every ${intervalMin}m)`);

        // Run first cycle immediately, then schedule
        this._runCycle(mode).catch(e => console.error(`[AutomationEngine] First cycle error:`, e.message));
        this[`_${mode}Timer`] = setInterval(
            () => this._runCycle(mode).catch(e => console.error(`[AutomationEngine] Cycle error:`, e.message)),
            intervalMin * 60 * 1000
        );
    }

    async stopMode(mode) {
        if (this[`_${mode}Timer`]) {
            clearInterval(this[`_${mode}Timer`]);
            this[`_${mode}Timer`] = null;
        }
        this._running[mode] = false;
        console.log(`[AutomationEngine] ⏹ Stopped ${mode} automation`);
    }

    /** Called when user changes intervalMinutes — reschedules the timer */
    async restartMode(mode) {
        await this.stopMode(mode);
        await this.startMode(mode);
    }

    getStatus() {
        return {
            paper: this._running.paper,
            live:  this._running.live,
        };
    }

    // ─── Core cycle ─────────────────────────────────────────────────────────

    async _runCycle(mode) {
        if (!this._running[mode]) return; // Guard: only run if actually started

        const cycleStart = Date.now();
        console.log(`[AutomationEngine] 🔄 ${mode.toUpperCase()} cycle start`);

        const prefs = await this._loadPrefs();
        const cfg   = prefs?.[`${mode}Auto`] || {};
        const date  = istDateStr();

        // ── Balance check ────────────────────────────────────────────────────
        const walletBalance = await this._getBalance(mode);
        const minBalance    = cfg.estimatedWalletUSD * 0.05;

        if (walletBalance !== null && walletBalance < minBalance) {
            console.log(`[AutomationEngine] ⚠ ${mode} balance $${walletBalance.toFixed(2)} < $${minBalance.toFixed(2)} minimum — skipping`);
            await AutomationLog.create({
                mode, date, cycleAction: 'SKIPPED_BALANCE',
                notes: `Balance $${walletBalance.toFixed(2)} below 5% threshold $${minBalance.toFixed(2)}`
            });
            this._emit('automation_cycle', { mode, action: 'SKIPPED_BALANCE', reason: 'Low balance' });
            return;
        }

        // ── Calculate margin for this trade ──────────────────────────────────
        const marginBudget = (cfg.estimatedWalletUSD * cfg.tradePct) / 100;

        // ── Run signal scan (tries up to 5 coins with built-in retry) ────────
        // Use 'RANDOM' which scans cheap coins; fallback to BTCUSD if catalog not ready
        const scanSymbol = (this._signalEngine?.catalog?.isReady) ? 'RANDOM' : 'BTCUSD';

        // Build userPrefs override with automation's own confidence/leverage settings
        const scanPrefs = {
            aiProvider:   prefs.aiProvider || 'groq',
            maxLeverage:  cfg.maxLeverage  || 20,
            minLeverage:  cfg.minLeverage  || 10,
            riskTolerance: prefs.riskTolerance || 'medium',
        };

        let scanResult = null;
        try {
            scanResult = await this._signalEngine.analyzeNow(
                scanSymbol,
                scanPrefs,
                {
                    tradeBudget:  marginBudget,
                    mode,
                }
            );
        } catch (err) {
            console.error(`[AutomationEngine] ${mode} scan error:`, err.message);
            await AutomationLog.create({ mode, date, cycleAction: 'ERROR', notes: err.message });
            return;
        }

        const signal = scanResult?.signal || scanResult?.saved;

        // ── NO_TRADE ─────────────────────────────────────────────────────────
        if (!signal || !scanResult || scanResult.action === 'NO_TRADE' ||
            (signal.action === 'NO_TRADE') ||
            (signal.confidence || 0) < cfg.minConfidence) {

            const conf = signal?.confidence || scanResult?.confidence || 0;
            console.log(`[AutomationEngine] ⬜ ${mode} NO_TRADE (best conf: ${conf}%)`);
            await AutomationLog.create({
                mode, date, cycleAction: 'NO_TRADE', confidence: conf,
                notes: scanResult?.reasoning || 'No valid setup found after all retries'
            });
            this._emit('automation_cycle', { mode, action: 'NO_TRADE', confidence: conf });
            return;
        }

        // ── Confidence gate ───────────────────────────────────────────────────
        if (signal.confidence < cfg.minConfidence) {
            console.log(`[AutomationEngine] ⬜ ${mode} confidence ${signal.confidence}% < ${cfg.minConfidence}% threshold`);
            await AutomationLog.create({
                mode, date, cycleAction: 'NO_TRADE', confidence: signal.confidence,
                notes: `Confidence ${signal.confidence}% below minimum ${cfg.minConfidence}%`
            });
            return;
        }

        // ── Clamp leverage to user's allowed range ────────────────────────────
        const rawLeverage = signal.leverage || cfg.maxLeverage;
        const leverage    = Math.max(cfg.minLeverage, Math.min(cfg.maxLeverage, rawLeverage));
        signal.leverage   = leverage;

        // ── Recalculate quantity from margin budget ───────────────────────────
        const entry    = signal.entry || signal.entryPrice || 0;
        if (entry > 0) {
            const marginPerContract = entry / leverage;
            signal.quantity = Math.max(1, Math.floor(marginBudget / marginPerContract));
        }

        const actualMargin = entry > 0
            ? (signal.quantity * entry) / leverage
            : marginBudget;

        console.log(`[AutomationEngine] ✅ ${mode} ${signal.action} ${signal.symbol} conf:${signal.confidence}% lev:${leverage}x margin:$${actualMargin.toFixed(2)}`);

        // ── Execute trade ─────────────────────────────────────────────────────
        let positionId = null;
        let executeErr = null;
        try {
            if (mode === 'paper') {
                const result = await this._executePaper(signal, prefs, cfg);
                positionId = result?._id;
            } else {
                const result = await this._executeLive(signal, prefs);
                positionId = result?._id || result?.orderId;
            }
        } catch (err) {
            executeErr = err.message;
            console.error(`[AutomationEngine] ${mode} execute error:`, err.message);
        }

        // ── Log the cycle ─────────────────────────────────────────────────────
        await AutomationLog.create({
            mode, date,
            cycleAction:  signal.action,
            symbol:       signal.symbol,
            confidence:   signal.confidence,
            entryPrice:   signal.entry,
            quantity:     signal.quantity,
            marginUsed:   actualMargin,
            leverage,
            stopLoss:     signal.stopLoss,
            target1:      signal.target1,
            riskReward:   signal.riskReward,
            outcome:      executeErr ? 'pending' : 'open',
            signalId:     signal._id || scanResult?.saved?._id || null,
            positionId,
            notes:        executeErr || '',
        });

        // ── Update lastCycleAt in prefs ───────────────────────────────────────
        await UserPreferences.updateMany(
            {},
            { $set: { [`${mode}Auto.lastCycleAt`]: new Date() } }
        );

        // ── Real-time event ───────────────────────────────────────────────────
        this._emit('automation_cycle', {
            mode,
            action:     signal.action,
            symbol:     signal.symbol,
            confidence: signal.confidence,
            leverage,
            margin:     actualMargin,
            error:      executeErr,
        });
    }

    // ─── Paper execution ─────────────────────────────────────────────────────

    async _executePaper(signal, prefs, cfg) {
        if (!this._paperEngine) throw new Error('PaperTradingEngine not connected');
        return await this._paperEngine.openPosition({
            symbol:      signal.symbol,
            side:        signal.action === 'BUY' ? 'buy' : 'sell',
            size:        signal.quantity,
            entryPrice:  signal.entry,
            leverage:    signal.leverage,
            stopLoss:    signal.stopLoss,
            takeProfit:  signal.target1,
            takeProfit2: signal.target2,
            source:      'automation',
            signalId:    signal._id,
        });
    }

    // ─── Live execution ──────────────────────────────────────────────────────

    async _executeLive(signal, prefs) {
        if (!this._orderExecutor) throw new Error('OrderExecutor not connected');
        // We need a userId — load from User model (single-user app)
        const User = require('../../models/User');
        const user = await User.findOne({});
        if (!user) throw new Error('No user found for live execution');

        return await this._orderExecutor.execute(user._id, {
            symbol:     signal.symbol,
            side:       signal.action === 'BUY' ? 'buy' : 'sell',
            size:       signal.quantity,
            orderType:  'limit',
            price:      signal.entry,
            stopLoss:   signal.stopLoss,
            takeProfit: signal.target1,
            leverage:   signal.leverage,
            signalId:   signal._id,
            source:     'automation',
        }, this._io);
    }

    // ─── Stop-loss trailing ──────────────────────────────────────────────────

    async _trailAllPositions() {
        try {
            // Only trail paper positions for now (live positions tracked by exchange)
            if (!this._wsManager) return;

            const openPositions = await PaperPosition.find({ status: 'open', source: 'automation' });
            for (const pos of openPositions) {
                try {
                    await this._trailPosition(pos);
                } catch (e) {
                    console.error(`[AutomationEngine] Trail error on ${pos.symbol}:`, e.message);
                }
            }
        } catch (err) {
            console.error('[AutomationEngine] _trailAllPositions error:', err.message);
        }
    }

    async _trailPosition(pos) {
        const price = this._wsManager?.getPrice?.(pos.symbol);
        if (!price || !pos.entryPrice || !pos.stopLoss) return;

        const isBuy  = pos.side === 'buy';
        const risk   = Math.abs(pos.entryPrice - pos.stopLoss); // 1R distance
        if (risk === 0) return;

        const priceDelta = isBuy ? price - pos.entryPrice : pos.entryPrice - price;
        const rMultiple  = priceDelta / risk;

        let newSL = pos.stopLoss;

        if (rMultiple >= 2) {
            // 2R in profit → move SL to entry + 0.5R (lock profit)
            newSL = isBuy
                ? pos.entryPrice + risk * 0.5
                : pos.entryPrice - risk * 0.5;
        } else if (rMultiple >= 1) {
            // 1R in profit → move SL to breakeven
            newSL = pos.entryPrice;
        }

        // Only update if SL actually improves
        const slImproved = isBuy ? newSL > pos.stopLoss : newSL < pos.stopLoss;
        if (slImproved) {
            await PaperPosition.updateOne({ _id: pos._id }, { $set: { stopLoss: newSL } });
            console.log(`[AutomationEngine] 📈 Trail SL ${pos.symbol}: ${pos.stopLoss.toFixed(4)} → ${newSL.toFixed(4)} (${rMultiple.toFixed(1)}R in profit)`);
        }
    }

    // ─── Daily report ────────────────────────────────────────────────────────

    async _checkDailyReports() {
        try {
            const currentTime = istTimeStr(); // 'HH:MM'
            const date        = istDateStr();
            const prefs       = await this._loadPrefs();

            for (const mode of ['paper', 'live']) {
                const cfg = prefs[`${mode}Auto`];
                if (!cfg?.dailyReportEnabled) continue;
                if (cfg.dailyReportTime !== currentTime) continue;

                // Check if already generated for today
                const existing = await DailyReport.findOne({ date, mode });
                if (existing?.notified) continue;

                await this._generateDailyReport(mode, date, prefs);
            }
        } catch (err) {
            console.error('[AutomationEngine] _checkDailyReports error:', err.message);
        }
    }

    async _generateDailyReport(mode, date, prefs) {
        console.log(`[AutomationEngine] 📊 Generating ${mode} daily report for ${date}`);

        const logs = await AutomationLog.find({ mode, date });
        if (logs.length === 0) return;

        const trades     = logs.filter(l => ['BUY','SELL'].includes(l.cycleAction));
        const closed     = trades.filter(l => ['tp_hit','sl_hit','trailed_out','timeout'].includes(l.outcome));
        const wins       = closed.filter(l => l.pnl > 0);
        const losses     = closed.filter(l => l.pnl <= 0);
        const totalPnl   = closed.reduce((s, l) => s + (l.pnl || 0), 0);
        const totalMargin= trades.reduce((s, l) => s + (l.marginUsed || 0), 0);
        const avgConf    = trades.length
            ? trades.reduce((s, l) => s + (l.confidence || 0), 0) / trades.length
            : 0;
        const avgLev     = trades.length
            ? trades.reduce((s, l) => s + (l.leverage || 0), 0) / trades.length
            : 0;

        const bestTrade  = closed.reduce((best, l) => (!best || (l.pnl||0) > (best.pnl||0)) ? l : best, null);
        const worstTrade = closed.reduce((worst, l) => (!worst || (l.pnl||0) < (worst.pnl||0)) ? l : worst, null);

        // Wallet snapshot
        let walletEnd = null;
        if (mode === 'paper') {
            const pw = await PaperWallet.findOne({});
            walletEnd = pw?.balance || null;
        }

        const report = await DailyReport.findOneAndUpdate(
            { date, mode },
            {
                date, mode,
                totalCycles:    logs.length,
                totalTrades:    trades.length,
                wins:           wins.length,
                losses:         losses.length,
                winRate:        closed.length ? (wins.length / closed.length) * 100 : 0,
                noTrades:       logs.filter(l => l.cycleAction === 'NO_TRADE').length,
                skipped:        logs.filter(l => l.cycleAction === 'SKIPPED_BALANCE').length,
                totalPnl:       parseFloat(totalPnl.toFixed(2)),
                totalMarginUsed: parseFloat(totalMargin.toFixed(2)),
                avgConfidence:  parseFloat(avgConf.toFixed(1)),
                avgLeverage:    parseFloat(avgLev.toFixed(1)),
                bestTrade:  bestTrade  ? { symbol: bestTrade.symbol,  pnl: bestTrade.pnl,  pnlPct: bestTrade.pnlPct  } : {},
                worstTrade: worstTrade ? { symbol: worstTrade.symbol, pnl: worstTrade.pnl, pnlPct: worstTrade.pnlPct } : {},
                walletEnd,
                notified: false,
            },
            { upsert: true, returnDocument: 'after' }
        );

        // Send notification
        await this._sendDailyNotification(mode, report);
        await DailyReport.updateOne({ _id: report._id }, { $set: { notified: true } });
        this._emit('daily_report', { mode, report });
    }

    async _sendDailyNotification(mode, report) {
        const modeLabel  = mode === 'paper' ? '📄 Paper' : '💰 Live';
        const pnlSign    = report.totalPnl >= 0 ? '+' : '';
        const title      = `${modeLabel} Daily Summary — ${report.date}`;
        const message    = [
            `Trades: ${report.totalTrades}`,
            `Win Rate: ${report.winRate.toFixed(1)}%`,
            `P&L: ${pnlSign}$${report.totalPnl.toFixed(2)}`,
            `Margin Deployed: $${report.totalMarginUsed.toFixed(2)}`,
            report.bestTrade?.symbol ? `Best: ${report.bestTrade.symbol} +$${(report.bestTrade.pnl||0).toFixed(2)}` : '',
        ].filter(Boolean).join(' · ');

        await notificationSvc._notifyAllUsers({
            type:     'system',
            title,
            message,
            priority: report.totalPnl >= 0 ? 'medium' : 'high',
            sound:    'system',
        });
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    async _loadPrefs() {
        const prefs = await UserPreferences.findOne({});
        return prefs || {};
    }

    async _getBalance(mode) {
        try {
            if (mode === 'paper') {
                const pw = await PaperWallet.findOne({});
                return pw?.available ?? null;
            }
            // For live, we'd query exchange — return null to skip balance check if not available
            return null;
        } catch {
            return null;
        }
    }

    _emit(event, data) {
        try {
            if (this._io) this._io.emit(event, data);
        } catch {}
    }
}

module.exports = new AutomationEngine();
