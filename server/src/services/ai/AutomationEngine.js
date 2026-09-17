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
        this._nextCycleAt   = { paper: null, live: null };
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

        // Sync AutomationLog outcomes from closed positions every 3 minutes
        this._syncTimer = setInterval(() => this._syncAutomationLogOutcomes().catch(() => {}), 3 * 60 * 1000);

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
        this._nextCycleAt[mode] = Date.now() + intervalMin * 60 * 1000;
        console.log(`[AutomationEngine] ▶ Starting ${mode} automation (every ${intervalMin}m, next at ${new Date(this._nextCycleAt[mode]).toISOString()})`);

        // Persist nextCycleAt so page-refresh shows correct countdown
        UserPreferences.updateMany({}, { $set: { [`${mode}Auto.nextCycleAt`]: new Date(this._nextCycleAt[mode]) } }).catch(() => {});

        this._emit('automation_status', this.getStatus());

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
        this._nextCycleAt[mode] = null;
        this._emit('automation_status', this.getStatus());
        console.log(`[AutomationEngine] ⏹ Stopped ${mode} automation`);
    }

    /** Called when user changes intervalMinutes — reschedules the timer */
    async restartMode(mode) {
        await this.stopMode(mode);
        await this.startMode(mode);
    }

    getStatus() {
        return {
            paper: {
                running: !!this._running.paper,
                nextCycleAt: this._running.paper ? this._nextCycleAt?.paper : null,
            },
            live: {
                running: !!this._running.live,
                nextCycleAt: this._running.live ? this._nextCycleAt?.live : null,
            },
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

        const intervalMin = cfg?.intervalMinutes || 30;
        this._nextCycleAt[mode] = Date.now() + intervalMin * 60 * 1000;
        UserPreferences.updateMany({}, { $set: { [`${mode}Auto.nextCycleAt`]: new Date(this._nextCycleAt[mode]) } }).catch(() => {});
        this._emit('automation_status', this.getStatus());

        // ── Balance check ────────────────────────────────────────────────────
        const walletBalance = await this._getBalance(mode, prefs);
        const minBalancePct = (cfg.minBalancePct ?? 5) / 100;
        const minBalance    = (cfg.estimatedWalletUSD || 100) * minBalancePct;

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
        let marginBudget = ((cfg.estimatedWalletUSD || 100) * (cfg.tradePct || 20)) / 100;
        if (walletBalance !== null && walletBalance > 0) {
            marginBudget = Math.min(marginBudget, walletBalance * 0.95);
        }

        // ── Run signal scan (tries up to 5 coins with built-in retry) ────────
        // Use 'RANDOM' which scans cheap coins; fallback to BTCUSD if catalog not ready
        const scanSymbol = (this._signalEngine?.catalog?.isReady) ? 'RANDOM' : 'BTCUSD';

        // Build userPrefs override with automation's own confidence/leverage settings
        const rawPrefs = (prefs && typeof prefs.toObject === 'function') ? prefs.toObject() : (prefs || {});
        const scanPrefs = {
            ...rawPrefs,
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

        // analyzeNow returns { signal (raw AI), saved (DB doc), mtf }
        // Use the DB-saved doc first (has _id for signalId linking), fall back to raw signal
        const savedSignalDoc = scanResult?.saved;
        const signal = scanResult?.signal || savedSignalDoc;
        if (signal && savedSignalDoc?._id) signal._id = savedSignalDoc._id;

        // ── NO_TRADE ─────────────────────────────────────────────────────────
        if (!signal || scanResult?.action === 'NO_TRADE' ||
            signal.action === 'NO_TRADE') {
            const conf = signal?.confidence || scanResult?.confidence || 0;
            const reason = scanResult?.reasoning || signal?.reasoning || 'No valid setup found after all retries';
            console.log(`[AutomationEngine] ⬜ ${mode} NO_TRADE (best conf: ${conf}%): ${reason.slice(0,80)}`);
            await AutomationLog.create({
                mode, date, cycleAction: 'NO_TRADE', confidence: conf, notes: reason
            });
            this._emit('automation_cycle', { mode, action: 'NO_TRADE', confidence: conf, nextCycleAt: this._nextCycleAt[mode] });
            return;
        }

        // ── Confidence gate ───────────────────────────────────────────────────
        if ((signal.confidence || 0) < (cfg.minConfidence || 70)) {
            console.log(`[AutomationEngine] ⬜ ${mode} confidence ${signal.confidence}% < ${cfg.minConfidence}% threshold — skipping`);
            await AutomationLog.create({
                mode, date, cycleAction: 'NO_TRADE', confidence: signal.confidence,
                notes: `Confidence ${signal.confidence}% below minimum ${cfg.minConfidence}%`
            });
            return;
        }

        // ── Reverse Engineering Mode ──────────────────────────────────────────
        // Flips BUY→SELL (and vice-versa) and swaps SL↔TP at execution time.
        // The AI signal stored in DB is UNCHANGED — only execution is mirrored.
        const reverseMode = cfg.reverseMode === true;
        const execSignal  = { ...signal }; // shallow clone — never mutate the original

        if (reverseMode) {
            const origAction = execSignal.action;
            execSignal.action   = origAction === 'BUY' ? 'SELL' : 'BUY';
            // Swap stop-loss and target so the trade still has a valid R/R structure
            const origSL        = execSignal.stopLoss;
            execSignal.stopLoss = execSignal.target1;
            execSignal.target1  = origSL;
            console.log(`[AutomationEngine] 🔄 REVERSE MODE: ${origAction} → ${execSignal.action} | SL↔TP swapped for ${execSignal.symbol}`);
        }

        // ── Clamp leverage to user's allowed range ────────────────────────────
        const rawLeverage    = execSignal.leverage || cfg.maxLeverage;
        const leverage       = Math.max(cfg.minLeverage, Math.min(cfg.maxLeverage, rawLeverage));
        execSignal.leverage  = leverage;

        // ── Recalculate quantity from margin budget ───────────────────────────
        const entry = execSignal.entry || execSignal.entryPrice || 0;
        if (entry > 0) {
            const marginPerContract = entry / leverage;
            const rawQty = Math.floor(marginBudget / marginPerContract);

            if (rawQty < 1) {
                // Even 1 contract costs more than our budget — skip this coin
                const cost1 = marginPerContract.toFixed(2);
                const reason = `Insufficient margin: 1 contract of ${execSignal.symbol} costs $${cost1} but budget is $${marginBudget.toFixed(2)}`;
                console.log(`[AutomationEngine] ⛔ ${mode} ${reason}`);
                await AutomationLog.create({
                    mode, date, cycleAction: 'SKIPPED_BALANCE',
                    symbol: execSignal.symbol, confidence: signal.confidence,
                    entryPrice: entry, leverage, marginUsed: marginPerContract,
                    notes: reason,
                });
                this._emit('automation_cycle', { mode, action: 'SKIPPED_BALANCE', reason, nextCycleAt: this._nextCycleAt[mode] });
                return;
            }

            execSignal.quantity = rawQty;
        }

        const actualMargin = entry > 0
            ? (execSignal.quantity * entry) / leverage
            : marginBudget;

        console.log(`[AutomationEngine] ✅ ${mode}${reverseMode ? ' [REVERSED]' : ''} ${execSignal.action} ${execSignal.symbol} conf:${signal.confidence}% lev:${leverage}x margin:$${actualMargin.toFixed(2)}`);

        // ── Execute trade ─────────────────────────────────────────────────────
        let positionId = null;
        let executeErr = null;
        try {
            if (mode === 'paper') {
                const result = await this._executePaper(execSignal, prefs, cfg);
                positionId = result?._id || result?.position?._id || result?.order?._id;
            } else {
                const result = await this._executeLive(execSignal, prefs);
                positionId = result?._id || result?.orderId;
            }
        } catch (err) {
            executeErr = err.message;
            console.error(`[AutomationEngine] ${mode} execute error:`, err.message);
        }

        // ── Log the cycle ─────────────────────────────────────────────────────
        // Log the EXECUTED action (execSignal) but preserve original AI action for audit
        await AutomationLog.create({
            mode, date,
            cycleAction:  execSignal.action,                  // what was actually executed
            symbol:       execSignal.symbol,
            confidence:   signal.confidence,
            entryPrice:   execSignal.entry,
            quantity:     execSignal.quantity,
            marginUsed:   actualMargin,
            leverage,
            stopLoss:     execSignal.stopLoss,
            target1:      execSignal.target1,
            riskReward:   execSignal.riskReward,
            outcome:      executeErr ? 'pending' : 'open',
            signalId:     signal._id || scanResult?.saved?._id || null,
            positionId,
            notes:        [
                executeErr || '',
                reverseMode ? `[REVERSED] AI predicted ${signal.action} → executed ${execSignal.action}` : '',
            ].filter(Boolean).join(' | ') || '',
        });

        // ── Update lastCycleAt in prefs ───────────────────────────────────────
        await UserPreferences.updateMany(
            {},
            { $set: { [`${mode}Auto.lastCycleAt`]: new Date() } }
        );

        // ── Real-time event ───────────────────────────────────────────────────
        this._emit('automation_cycle', {
            mode,
            action:      execSignal.action,
            aiAction:    signal.action,       // original AI prediction (for UI display)
            reverseMode,
            symbol:      execSignal.symbol,
            confidence:  signal.confidence,
            leverage,
            margin:      actualMargin,
            error:       executeErr,
            nextCycleAt: this._nextCycleAt[mode],
        });
    }

    // ─── Paper execution ─────────────────────────────────────────────────────

    async _executePaper(signal, prefs, cfg) {
        if (!this._paperEngine) throw new Error('PaperTradingEngine not connected');

        const PaperWallet = require('../../models/PaperWallet');
        const User = require('../../models/User');

        // Prefer userId from loaded prefs (which are the active user's prefs)
        let userId = prefs?.userId ? String(prefs.userId) : null;
        if (!userId) {
            const pw = await PaperWallet.findOne({}).sort({ updatedAt: -1 });
            userId = pw?.userId ? String(pw.userId) : null;
        }
        if (!userId) {
            const user = await User.findOne({});
            userId = user?._id ? String(user._id) : 'default_user';
        }
        console.log(`[AutomationEngine] 🤖 Placing paper order for userId: ${userId} | ${signal.symbol} ${signal.action}`);

        if (signal.entry) {
            this._paperEngine.updatePrice(signal.symbol, signal.entry);
        }

        const res = await this._paperEngine.placeOrder(
            userId,
            {
                symbol:      signal.symbol.toUpperCase(),
                side:        signal.action === 'BUY' ? 'buy' : 'sell',
                size:        signal.quantity,
                orderType:   'market_order',
                price:       signal.entry,
                stopLoss:    signal.stopLoss,
                takeProfit:  signal.target1,
                leverage:    signal.leverage,
                signalId:    signal._id,
                source:      'automation',
            },
            this._io
        );

        return res?.position || res?.order || res;
    }

    // ─── Live execution ──────────────────────────────────────────────────────

    async _executeLive(signal, prefs) {
        if (!this._orderExecutor) throw new Error('OrderExecutor not connected');
        const User = require('../../models/User');
        const user = await User.findOne({});
        if (!user) throw new Error('No user found for live execution');

        return await this._orderExecutor.execute(user._id, {
            symbol:     signal.symbol.toUpperCase(),
            side:       signal.action === 'BUY' ? 'buy' : 'sell',
            size:       signal.quantity,
            orderType:  'limit_order',
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

    // ─── Sync AutomationLog outcomes from closed positions ───────────────────

    async _syncAutomationLogOutcomes() {
        // Find all paper automation logs that have a positionId but outcome is still 'open' or 'pending'
        const staleLogs = await AutomationLog.find({
            mode: 'paper',
            positionId: { $ne: null },
            outcome: { $in: ['open', 'pending'] },
            cycleAction: { $in: ['BUY', 'SELL'] },
        }).lean();

        if (staleLogs.length === 0) return;

        const positionIds = staleLogs.map(l => l.positionId);
        const closedPos   = await PaperPosition.find({
            _id: { $in: positionIds },
            status: { $ne: 'open' },
        }).lean();

        if (closedPos.length === 0) return;

        const posMap = {};
        for (const p of closedPos) posMap[p._id.toString()] = p;

        let syncCount = 0;
        for (const log of staleLogs) {
            const pos = posMap[log.positionId.toString()];
            if (!pos) continue;

            const pnl    = pos.realisedPnl ?? 0;
            const pnlPct = log.marginUsed ? parseFloat(((pnl / log.marginUsed) * 100).toFixed(2)) : null;
            const outcome = pos.status === 'closed_tp'     ? 'tp_hit'
                          : pos.status === 'closed_sl'     ? 'sl_hit'
                          : pos.status === 'closed_manual' ? 'timeout'
                          : 'timeout';

            await AutomationLog.updateOne({ _id: log._id }, {
                $set: { outcome, pnl, pnlPct, exitPrice: pos.closePrice }
            });
            syncCount++;
        }

        if (syncCount > 0) {
            console.log(`[AutomationEngine] 🔄 Synced ${syncCount} AutomationLog outcome(s) from closed positions`);
        }
    }

    // ─── Daily report ────────────────────────────────────────────────────────

    async _checkDailyReports() {
        try {
            const now  = nowIST();
            const date = istDateStr();
            const prefs = await this._loadPrefs();

            for (const mode of ['paper', 'live']) {
                const cfg = prefs[`${mode}Auto`];
                if (!cfg?.dailyReportEnabled) continue;
                if (!cfg.dailyReportTime) continue;

                // Parse configured report time (HH:MM IST)
                const [rh, rm] = cfg.dailyReportTime.split(':').map(Number);
                const reportMinutes = rh * 60 + rm;
                const nowMinutes    = now.getUTCHours() * 60 + now.getUTCMinutes();

                // Fire if current time is within [reportTime, reportTime + 30 min]
                const inWindow = nowMinutes >= reportMinutes && nowMinutes < reportMinutes + 30;
                if (!inWindow) continue;

                // Check if already generated for today
                const existing = await DailyReport.findOne({ date, mode });
                if (existing?.notified) continue;

                await this._generateDailyReport(mode, date, prefs);
            }
        } catch (err) {
            console.error('[AutomationEngine] _checkDailyReports error:', err.message);
        }
    }

    /** Called on server startup — generates any missed reports from today */
    async _recoverMissedReports() {
        try {
            const now  = nowIST();
            const date = istDateStr();
            const prefs = await this._loadPrefs();

            for (const mode of ['paper', 'live']) {
                const cfg = prefs[`${mode}Auto`];
                if (!cfg?.dailyReportEnabled) continue;
                if (!cfg.dailyReportTime) continue;

                const [rh, rm] = cfg.dailyReportTime.split(':').map(Number);
                const reportMinutes = rh * 60 + rm;
                const nowMinutes    = now.getUTCHours() * 60 + now.getUTCMinutes();

                // If we're past the report time today and it hasn't been sent
                if (nowMinutes < reportMinutes) continue;

                const existing = await DailyReport.findOne({ date, mode });
                if (existing?.notified) continue;

                console.log(`[AutomationEngine] 🔄 Recovering missed ${mode} daily report for ${date}`);
                await this._generateDailyReport(mode, date, prefs);
            }
        } catch (err) {
            console.error('[AutomationEngine] _recoverMissedReports error:', err.message);
        }
    }

    async _generateDailyReport(mode, date, prefs) {
        console.log(`[AutomationEngine] 📊 Generating ${mode} daily report for ${date}`);

        const logs = await AutomationLog.find({ mode, date });
        // Build report even when logs.length === 0 (zero-activity day)

        const tradeLogs = logs.filter(l => ['BUY','SELL'].includes(l.cycleAction));

        // ── Sync AutomationLog outcomes from closed positions ─────────────────
        // This backfills pnl/exitPrice/outcome on each log entry using the actual position
        if (mode === 'paper') {
            for (const log of tradeLogs) {
                if (!log.positionId) continue;
                if (['tp_hit','sl_hit','trailed_out','timeout'].includes(log.outcome)) continue; // already synced

                const pos = await PaperPosition.findById(log.positionId).lean();
                if (!pos || pos.status === 'open') continue;

                const pnl     = pos.realisedPnl ?? 0;
                const pnlPct  = log.marginUsed ? parseFloat(((pnl / log.marginUsed) * 100).toFixed(2)) : null;
                const outcome = pos.status === 'closed_tp'     ? 'tp_hit'
                              : pos.status === 'closed_sl'     ? 'sl_hit'
                              : pos.status === 'closed_manual' ? 'timeout'
                              : 'timeout';

                await AutomationLog.updateOne({ _id: log._id }, {
                    $set: { outcome, pnl, pnlPct, exitPrice: pos.closePrice }
                });
                // Update in-memory for report calculation below
                log.outcome   = outcome;
                log.pnl       = pnl;
                log.pnlPct    = pnlPct;
                log.exitPrice = pos.closePrice;
            }
        }

        // ── Calculate report metrics ──────────────────────────────────────────
        let totalPnl   = 0;
        let wins       = [];
        let losses     = [];
        let closed     = [];

        if (mode === 'paper') {
            // Join PaperPosition directly for most accurate PnL (covers all closed positions today)
            const positionIds = tradeLogs.map(l => l.positionId).filter(Boolean);
            const positions   = positionIds.length
                ? await PaperPosition.find({ _id: { $in: positionIds }, status: { $ne: 'open' } }).lean()
                : [];

            totalPnl = positions.reduce((s, p) => s + (p.realisedPnl || 0), 0);
            wins     = positions.filter(p => (p.realisedPnl || 0) > 0);
            losses   = positions.filter(p => (p.realisedPnl || 0) <= 0);
            closed   = positions;
        } else {
            // For live: fall back to log.pnl (set by live close handlers)
            const closedLogs = tradeLogs.filter(l => ['tp_hit','sl_hit','trailed_out','timeout'].includes(l.outcome));
            totalPnl = closedLogs.reduce((s, l) => s + (l.pnl || 0), 0);
            wins     = closedLogs.filter(l => (l.pnl || 0) > 0);
            losses   = closedLogs.filter(l => (l.pnl || 0) <= 0);
            closed   = closedLogs;
        }

        const totalMargin = tradeLogs.reduce((s, l) => s + (l.marginUsed || 0), 0);
        const avgConf     = tradeLogs.length
            ? tradeLogs.reduce((s, l) => s + (l.confidence || 0), 0) / tradeLogs.length : 0;
        const avgLev      = tradeLogs.length
            ? tradeLogs.reduce((s, l) => s + (l.leverage || 0), 0) / tradeLogs.length : 0;

        // Best/worst trade — from positions for paper, from logs for live
        let bestTrade = null, worstTrade = null;
        if (mode === 'paper') {
            const positionIds = tradeLogs.map(l => l.positionId).filter(Boolean);
            const positions   = positionIds.length
                ? await PaperPosition.find({ _id: { $in: positionIds }, status: { $ne: 'open' } }).lean()
                : [];
            bestTrade  = positions.reduce((b, p) => (!b || (p.realisedPnl||0) > (b.realisedPnl||0)) ? p : b, null);
            worstTrade = positions.reduce((w, p) => (!w || (p.realisedPnl||0) < (w.realisedPnl||0)) ? p : w, null);
        } else {
            const closedLogs = tradeLogs.filter(l => l.pnl != null);
            bestTrade  = closedLogs.reduce((b, l) => (!b || (l.pnl||0) > (b.pnl||0)) ? l : b, null);
            worstTrade = closedLogs.reduce((w, l) => (!w || (l.pnl||0) < (w.pnl||0)) ? l : w, null);
        }

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
        const prefs = await UserPreferences.findOne({}).sort({ updatedAt: -1 });
        return prefs || {};
    }

    async _getBalance(mode, prefs = null) {
        try {
            if (mode === 'paper') {
                // Try to find wallet for the active user first, else use most recently updated
                let pw = null;
                if (prefs?.userId) {
                    pw = await PaperWallet.findOne({ userId: prefs.userId });
                }
                if (!pw) {
                    pw = await PaperWallet.findOne({}).sort({ updatedAt: -1 });
                }
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
