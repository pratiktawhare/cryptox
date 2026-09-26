/**
 * TradingBot.js
 *
 * Master orchestrator for autonomous trading in CryptoX.
 * Supports independent Paper and Live instances.
 *
 * Coordinates the full scan cycle:
 *   1. Wallet balance check (Delta REST for live, PaperWallet for paper).
 *   2. Safety gates (circuit breaker, daily loss limit, cooldown, max open position).
 *   3. Affordability filter (only analyzes coins whose min contract margin fits the budget).
 *   4. Technical analysis (EMA, RSI, ATR, Volume, Momentum).
 *   5. Deterministic regime classification.
 *   6. Multi-symbol rule scoring (0–8 points).
 *   7. Dynamic position sizing & ATR bracket protection (20x margin).
 *   8. Trade execution & audit logging.
 */

const TradingConfig = require('../../models/TradingConfig');
const BotTrade = require('../../models/BotTrade');
const BotSignal = require('../../models/BotSignal');
const BotEvent = require('../../models/BotEvent');
const PaperWallet = require('../../models/PaperWallet');
const PaperPosition = require('../../models/PaperPosition');
const ApiKey = require('../../models/ApiKey');
const User = require('../../models/User');
const DeltaOrderClient = require('../trading/DeltaOrderClient');
const { decryptData } = require('../../utils/encryption');

const candleStore = require('./CandleStore');
const { analyzeSymbol } = require('./MarketAnalyzer');
const { detectRegime } = require('./RegimeDetector');
const { scoreSignal } = require('./SignalScorer');
const { filterAffordable } = require('./AffordabilityFilter');
const { calcRisk, checkDailyLimits } = require('./RiskEngine');
const executionEngine = require('./ExecutionEngine');
const positionMonitor = require('./PositionMonitor');
const entryOrderWatcher = require('./EntryOrderWatcher');
const aiRegimeAnalyzer = require('./AiRegimeAnalyzer');
const productCatalog = require('../ProductCatalog');
const breakoutScanner = require('./BreakoutScanner');
const breakoutWatcher = require('./BreakoutWatcher');

class TradingBot {
    /**
     * @param {'paper'|'live'} mode
     */
    constructor(mode = 'paper') {
        this.mode = mode;
        this.isRunning = false;
        this.isScanning = false;
        this.scanIntervalTimer = null;
        this._nextScanAt = null;

        this.io = null;
        this.wsManager = null;
        this.productCatalog = null;

        this.lastScanResult = {
            timestamp: null,
            totalScanned: 0,
            affordableCount: 0,
            bestSymbol: null,
            bestScore: null,
            decision: null,
            reason: null,
        };
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Start the bot.
     *
     * @param {object} io
     * @param {object} wsManager
     * @param {object} productCatalog
     */
    async start(io, wsManager, productCatalog) {
        if (this.isRunning) return;

        this.io = io;
        this.wsManager = wsManager;
        this.productCatalog = productCatalog;
        this.isRunning = true;

        // Attach candleStore to WebSocket manager if not already attached
        if (this.wsManager && !candleStore._attached) {
            candleStore.attach(this.wsManager);
        }

        // Start position monitor if not already running
        positionMonitor.start(this.io, this.wsManager);

        // Start entry order watcher (monitors pending paper & live limit orders)
        entryOrderWatcher.start(this.io, this.wsManager);

        // Start AI regime analyzer
        aiRegimeAnalyzer.start(this.wsManager);

        // Start breakout watcher (monitors live price breaches on armed tripwires)
        breakoutWatcher.start(this.io, this.wsManager);

        console.log(`[TradingBot] 🤖 ${this.mode.toUpperCase()} Bot started`);
        this._emitStatus();

        // Run initial scan after short 5s delay to allow WS buffers to align
        setTimeout(() => {
            if (this.isRunning) {
                this.runScan().catch(err => {
                    console.error(`[TradingBot] Initial scan error (${this.mode}):`, err.message);
                });
            }
        }, 5000);

        // Schedule recurring scan interval
        this._scheduleNextScan();
    }

    /**
     * Stop the bot.
     */
    stop() {
        this.isRunning = false;
        this.isScanning = false;
        if (this.scanIntervalTimer) {
            clearTimeout(this.scanIntervalTimer);
            this.scanIntervalTimer = null;
        }
        this._nextScanAt = null;
        aiRegimeAnalyzer.stop();
        breakoutWatcher.stop();
        console.log(`[TradingBot] ⏹️ ${this.mode.toUpperCase()} Bot stopped`);
        this._emitStatus();
    }

    /**
     * Emergency close position and stop.
     */
    async emergencyStop(userId, symbol = null, reason = 'user_emergency_stop') {
        let closeResult = null;
        if (!symbol) {
            const openTrades = await BotTrade.find({
                userId,
                mode: this.mode,
                result: { $in: ['open', 'pending_entry'] },
            });
            for (const t of openTrades) {
                await executionEngine.emergencyClose({
                    tradeId: t._id,
                    userId,
                    mode: this.mode,
                    symbol: t.symbol,
                    reason,
                    io: this.io,
                    wsManager: this.wsManager,
                });
            }
            closeResult = { success: true, count: openTrades.length };
        } else {
            closeResult = await executionEngine.emergencyClose({
                userId,
                mode: this.mode,
                symbol,
                reason,
                io: this.io,
                wsManager: this.wsManager,
            });
        }

        breakoutWatcher.disarmAll('emergency_stop');
        this.stop();
        this._emitStatus();
        return closeResult;
    }

    /**
     * Get current runtime status.
     */
    getStatus() {
        return {
            mode: this.mode,
            running: this.isRunning,
            isRunning: this.isRunning,
            isScanning: this.isScanning,
            nextScanAt: this._nextScanAt,
            lastScan: this.lastScanResult,
            armedTripwires: breakoutWatcher.getArmedTripwires(),
        };
    }

    // ─── Scan Scheduling ───────────────────────────────────────────────────────

    _scheduleNextScan(customMinutes = null) {
        if (!this.isRunning) return;

        if (this.scanIntervalTimer) {
            clearTimeout(this.scanIntervalTimer);
        }

        // Default to 5 minutes
        const intervalMs = (customMinutes || 5) * 60 * 1000;
        this._nextScanAt = new Date(Date.now() + intervalMs);
        this._emitStatus();

        this.scanIntervalTimer = setTimeout(async () => {
            if (this.isRunning) {
                try {
                    await this.runScan();
                } catch (err) {
                    console.error(`[TradingBot] Scan error (${this.mode}):`, err.message);
                } finally {
                    this._scheduleNextScan();
                }
            }
        }, intervalMs);
    }

    // ─── Main Scan Cycle ───────────────────────────────────────────────────────

    async runScan() {
        if (!this.isRunning || this.isScanning) return;
        this.isScanning = true;

        const scanStartTime = Date.now();
        console.log(`[TradingBot] 🔍 Starting ${this.mode.toUpperCase()} scan cycle...`);

        try {
            // 1. Find users who have this bot mode enabled
            let configs = await TradingConfig.find({ mode: this.mode, enabled: true });
            if (!configs || configs.length === 0) {
                // If no enabled configs, check if there is an active user to initialize default config
                const user = await User.findOne({}).sort({ createdAt: 1 });
                if (user) {
                    let defaultCfg = await TradingConfig.findOne({ userId: user._id, mode: this.mode });
                    if (!defaultCfg) {
                        defaultCfg = await TradingConfig.create({
                            userId: user._id,
                            mode: this.mode,
                            budgetUSDT: 10,
                            maxLeverage: 20,
                            enabled: true,
                        });
                    }
                    configs = [defaultCfg];
                }
            }

            if (!configs || configs.length === 0) {
                console.log(`[TradingBot] No enabled configs for ${this.mode} mode. Waiting for next cycle.`);
                return;
            }

            // Execute scan for each enabled user config
            const processedUsers = new Set();
            for (const config of configs) {
                const uId = String(config.userId);
                if (processedUsers.has(uId)) continue;
                processedUsers.add(uId);
                await this._scanForUser(config);
            }

        } catch (err) {
            console.error(`[TradingBot] ❌ Error in ${this.mode} scan:`, err.message);
        } finally {
            this.isScanning = false;
            this._emitStatus();
            console.log(`[TradingBot] 🏁 Finished ${this.mode.toUpperCase()} scan cycle in ${Date.now() - scanStartTime}ms`);
        }
    }

    async _scanForUser(config) {
        const userId = config.userId;

        // ── 0. Open Positions Safety & Drop-off Evaluation ──────────────────
        await this._scanOpenPositionsForRescue(userId, config);

        // ── 1. Fetch available wallet balance ──────────────────────────────────
        let availableBalance = 0;
        let totalBalance = 0;

        if (this.mode === 'paper') {
            let wallet = await PaperWallet.findOne({ userId });
            if (!wallet) {
                wallet = await PaperWallet.create({ userId });
            }
            availableBalance = wallet.available;
            totalBalance = wallet.balance;
        } else if (this.mode === 'live') {
            try {
                const client = await this._buildDeltaClient(userId);
                if (!client) {
                    await this._logEvent(userId, 'API_ERROR', 'error', 'No active Delta Exchange API key configured for live trading');
                    return;
                }
                const walletResp = await client.getWallet();
                const balances = walletResp?.result || [];
                const usdtBal = balances.find(b => b.asset_symbol === 'USDT' || b.asset_symbol === 'USD') || balances[0];
                availableBalance = parseFloat(usdtBal?.available_balance || 0);
                totalBalance = parseFloat(usdtBal?.balance || 0);
            } catch (walletErr) {
                console.error(`[TradingBot] Failed to fetch live wallet for user ${userId}:`, walletErr.message);
                await this._logEvent(userId, 'API_ERROR', 'error', `Delta wallet fetch failed: ${walletErr.message}`);
                return;
            }
        }

        if (availableBalance <= 0) {
            console.log(`[TradingBot] Available balance is $${availableBalance.toFixed(2)}. Skipping scan.`);
            this.lastScanResult = {
                timestamp: new Date(),
                totalScanned: 0,
                affordableCount: 0,
                bestSymbol: null,
                bestScore: null,
                decision: 'SKIPPED_BUDGET',
                reason: `Available balance is $${availableBalance.toFixed(2)}`,
            };
            return;
        }

        // ── 2. Safety Gates ────────────────────────────────────────────────────
        // Reconcile open BotTrades with actual exchange/paper positions first
        // so that manually closed or emergency-stopped positions never block new trades.
        if (this.mode === 'paper') {
            const unverifiedTrades = await BotTrade.find({
                userId,
                mode: 'paper',
                result: 'open',
            });
            for (const t of unverifiedTrades) {
                const openPos = await PaperPosition.findOne({ userId, symbol: t.symbol, status: 'open' });
                if (!openPos) {
                    console.log(`[TradingBot] 🔄 Reconciling orphan paper trade for ${t.symbol} (PaperPosition no longer open)`);
                    const lastPos = await PaperPosition.findOne({ userId, symbol: t.symbol }).sort({ updatedAt: -1 });
                    const closePrice = lastPos?.closePrice || t.entryPrice;
                    const netPnl = lastPos?.realisedPnl || 0;
                    t.exitPrice = closePrice;
                    t.exitTime = new Date();
                    t.durationSeconds = Math.round((t.exitTime - (t.entryTime || t.createdAt)) / 1000);
                    t.grossPnl = netPnl;
                    t.netPnl = netPnl;
                    t.result = netPnl >= 0 ? 'win' : 'loss';
                    t.exitReason = lastPos?.status === 'closed_tp' ? 'take_profit' : (lastPos?.status === 'closed_sl' ? 'stop_loss' : 'manual_close');
                    await t.save();
                    if (this.io) {
                        this.io.to(`user:${userId}`).emit('bot_trade_closed', { trade: t.toObject(), mode: 'paper', symbol: t.symbol });
                        this.io.emit('bot_trade_closed', { trade: t.toObject(), mode: 'paper', symbol: t.symbol });
                    }
                }
            }
        } else if (this.mode === 'live') {
            try {
                const client = await this._buildDeltaClient(userId);
                if (client) {
                    const posResp = await client.getPositions();
                    const livePositions = posResp?.result || [];
                    // Only reconcile filled 'open' trades against positions.
                    // 'pending_entry' are limit orders waiting for fill, handled by EntryOrderWatcher.
                    const unverifiedLiveTrades = await BotTrade.find({
                        userId,
                        mode: 'live',
                        result: 'open',
                    });
                    for (const t of unverifiedLiveTrades) {
                        const hasPos = livePositions.some(p => p.product_symbol === t.symbol && Math.abs(parseFloat(p.size || 0)) > 0);
                        if (!hasPos) {
                            console.log(`[TradingBot] 🔄 Reconciling orphan live trade for ${t.symbol} (no active position on Delta)`);
                            t.exitTime = new Date();
                            t.durationSeconds = Math.round((t.exitTime - (t.entryTime || t.createdAt)) / 1000);
                            t.result = 'cancelled';
                            t.exitReason = 'manual_close';
                            await t.save();
                            if (this.io) {
                                this.io.to(`user:${userId}`).emit('bot_trade_closed', { trade: t.toObject(), mode: 'live', symbol: t.symbol });
                                this.io.emit('bot_trade_closed', { trade: t.toObject(), mode: 'live', symbol: t.symbol });
                            }
                        }
                    }
                }
            } catch (reconErr) {
                console.warn('[TradingBot] Live reconciliation check warning:', reconErr.message);
            }
        }

        // Check for existing open trades (max simultaneous open positions limit)
        // Include pending_entry (limit orders awaiting fill) in the count so we don't
        // double-enter the same symbol while its entry order is sitting on the exchange.
        const openTrades = await BotTrade.find({
            userId,
            mode: this.mode,
            result: { $in: ['open', 'pending_entry'] },
        });
        const maxAllowed = Math.min(
            config.maxOpenPositions > 0 ? config.maxOpenPositions : 5,
            config.walletParts > 0 ? config.walletParts : 5
        );
        if (openTrades.length >= maxAllowed) {
            console.log(`[TradingBot] User has reached max open positions limit (${openTrades.length}/${maxAllowed}). Skipping entry.`);
            this.lastScanResult = {
                timestamp: new Date(),
                totalScanned: 0,
                affordableCount: 0,
                bestSymbol: null,
                bestScore: null,
                decision: 'SKIPPED_MAX_POSITIONS',
                reason: `Max simultaneous open positions reached (${openTrades.length}/${maxAllowed})`,
            };
            await this._recordSignal({
                userId,
                symbol: 'MAX_POSITIONS_GATE',
                direction: null,
                score: 0,
                decision: 'SKIPPED_MAX_POSITIONS',
                rejectReason: `Max simultaneous open positions limit reached (${openTrades.length}/${maxAllowed} active)`,
                walletBalance: availableBalance,
                effectiveBudget: config.budgetUSDT,
                affordableSymbols: 0,
                totalScanned: 0,
            });
            return;
        }

        // Check daily loss, consecutive loss, and cooldown
        const dailyStats = await positionMonitor.getDailyStats(userId, this.mode);
        const limitCheck = checkDailyLimits(config, availableBalance, dailyStats);
        if (!limitCheck.ok) {
            console.log(`[TradingBot] 🛑 Safety limit triggered: ${limitCheck.reason}`);
            await this._logEvent(userId, 'COOLDOWN_ACTIVE', 'warn', `Safety gate prevented trading: ${limitCheck.reason}`);
            this.lastScanResult = {
                timestamp: new Date(),
                totalScanned: 0,
                affordableCount: 0,
                bestSymbol: null,
                bestScore: null,
                decision: 'SKIPPED_COOLDOWN',
                reason: limitCheck.reason,
            };
            await this._recordSignal({
                userId,
                symbol: 'SAFETY_GATE',
                direction: null,
                score: 0,
                decision: 'SKIPPED_COOLDOWN',
                rejectReason: limitCheck.reason,
                walletBalance: availableBalance,
                effectiveBudget: config.budgetUSDT,
                affordableSymbols: 0,
                totalScanned: 0,
            });
            return;
        }

        // ── 3. Affordability Filter ────────────────────────────────────────────
        const allSymbols = this.productCatalog ? this.productCatalog.getSymbols() : [];
        if (!allSymbols || allSymbols.length === 0) {
            console.log('[TradingBot] No symbols available in product catalog.');
            return;
        }

        const affordResult = filterAffordable(
            allSymbols,
            config,
            availableBalance,
            this.wsManager,
            this.productCatalog
        );

        const affordableSymbols = affordResult.affordable;
        const effectiveBudget = affordResult.effectiveBudget;

        if (!affordableSymbols || affordableSymbols.length === 0) {
            // Silent expected event when wallet is low
            await this._logEvent(userId, 'NO_AFFORDABLE_SYMBOLS', 'info',
                `No symbols affordable with current available balance of $${availableBalance.toFixed(2)} (Effective budget: $${effectiveBudget.toFixed(2)})`
            );
            this.lastScanResult = {
                timestamp: new Date(),
                totalScanned: allSymbols.length,
                affordableCount: 0,
                bestSymbol: null,
                bestScore: null,
                decision: 'SKIPPED_BUDGET',
                reason: 'No affordable symbols for current budget',
            };
            await this._recordSignal({
                userId,
                symbol: 'BUDGET_GATE',
                direction: null,
                score: 0,
                decision: 'SKIPPED_BUDGET',
                rejectReason: `No symbols affordable with current balance $${availableBalance.toFixed(2)} (Effective budget: $${effectiveBudget.toFixed(2)})`,
                walletBalance: availableBalance,
                effectiveBudget,
                affordableSymbols: 0,
                totalScanned: allSymbols.length,
            });
            return;
        }

        // Exclude symbols that already have an open or pending position
        const openSymbols = new Set(openTrades.map(t => t.symbol));
        const unheldAffordable = affordableSymbols.filter(s => !openSymbols.has(s));

        if (unheldAffordable.length === 0) {
            console.log(`[TradingBot] All affordable coins (${affordableSymbols.length}) already have active open positions.`);
            this.lastScanResult = {
                timestamp: new Date(),
                totalScanned: allSymbols.length,
                affordableCount: affordableSymbols.length,
                bestSymbol: null,
                bestScore: null,
                decision: 'NO_SETUP',
                reason: 'All affordable coins already have active open positions',
            };
            return;
        }

        console.log(`[TradingBot] Budget $${effectiveBudget.toFixed(2)}: Filtered ${allSymbols.length} coins down to ${unheldAffordable.length} available candidates (excluding ${openSymbols.size} open): ${unheldAffordable.slice(0, 5).join(', ')}...`);

        // ── Strategy Mode Branching ──────────────────────────────────────────
        const strategyType = config.strategyType || 'trend_pullback';

        if (strategyType === 'breakout_straddle') {
            await this._scanBreakoutStraddle(config, userId, availableBalance, effectiveBudget, allSymbols, affordableSymbols, unheldAffordable, maxAllowed, openTrades);
            return;
        }

        // ── 4. Technical Analysis & Candidate Scoring ──────────────────────────
        const groqResult = (config.aiEnabled !== false) ? aiRegimeAnalyzer.getLastAnalysis() : null;
        const candidates = [];
        // Scan up to the first 25 available affordable coins
        const coinsToScan = unheldAffordable.slice(0, 25);

        for (const symbol of coinsToScan) {
            try {
                // Ensure historical candles exist in CandleStore
                await candleStore.ensureCandles(symbol, '5m', 40);
                await candleStore.ensureCandles(symbol, '1m', 30);

                const snapshot = analyzeSymbol(symbol, this.wsManager);
                if (!snapshot) continue;

                const regimeResult = detectRegime(snapshot);
                const scoreResult = scoreSignal(snapshot, regimeResult, config.minSignalScore, groqResult);

                candidates.push({
                    symbol,
                    snapshot,
                    regimeResult,
                    scoreResult,
                    groqResult,
                });
            } catch (symErr) {
                console.warn(`[TradingBot] Error scanning ${symbol}:`, symErr.message);
            }
        }

        if (candidates.length === 0) {
            this.lastScanResult = {
                timestamp: new Date(),
                totalScanned: allSymbols.length,
                affordableCount: affordableSymbols.length,
                bestSymbol: null,
                bestScore: null,
                decision: 'NO_SETUP',
                reason: 'No symbols had sufficient market data to evaluate',
            };
            return;
        }

        // ── 5. Select Best Setup ───────────────────────────────────────────────
        // Separate qualifying TRADE candidates from non-qualifying ones
        const qualifyingTrades = candidates
            .filter(c => c.scoreResult.decision === 'TRADE' && c.scoreResult.score >= config.minSignalScore)
            .sort((a, b) => {
                if (b.scoreResult.score !== a.scoreResult.score) {
                    return b.scoreResult.score - a.scoreResult.score;
                }
                const confDiff = (b.regimeResult?.confidence || 0) - (a.regimeResult?.confidence || 0);
                if (Math.abs(confDiff) > 0.01) return confDiff;
                return (b.snapshot['5m']?.volumeRatio || 0) - (a.snapshot['5m']?.volumeRatio || 0);
            });

        // Also sort overall candidates: prioritize TRADE decision, then highest score
        candidates.sort((a, b) => {
            const aTrade = a.scoreResult.decision === 'TRADE' ? 1 : 0;
            const bTrade = b.scoreResult.decision === 'TRADE' ? 1 : 0;
            if (aTrade !== bTrade) return bTrade - aTrade;
            return b.scoreResult.score - a.scoreResult.score;
        });

        // If any qualifying TRADE candidate exists, select it! Otherwise pick best overall.
        const best = qualifyingTrades.length > 0 ? qualifyingTrades[0] : candidates[0];

        this.lastScanResult = {
            timestamp: new Date(),
            totalScanned: allSymbols.length,
            affordableCount: affordableSymbols.length,
            bestSymbol: best.symbol,
            bestScore: best.scoreResult.score,
            decision: best.scoreResult.decision,
            reason: best.scoreResult.reason,
        };

        console.log(`[TradingBot] Best candidate: ${best.symbol} (${best.scoreResult.direction?.toUpperCase()}) — Score: ${best.scoreResult.score}/8 | Decision: ${best.scoreResult.decision} (${qualifyingTrades.length} qualifying setups)`);

        // Check if best setup qualifies
        if (best.scoreResult.decision !== 'TRADE' || best.scoreResult.score < config.minSignalScore) {
            // Record audit signal for top candidate
            await this._recordSignal({
                userId,
                symbol: best.symbol,
                direction: best.scoreResult.direction,
                score: best.scoreResult.score,
                conditions: best.scoreResult.conditions,
                snapshot: best.snapshot,
                regime: best.regimeResult?.regime,
                groqRegime: best.groqResult?.marketRegime,
                groqConfidence: best.groqResult?.confidence,
                groqRiskAdj: best.groqResult?.riskAdjustment,
                decision: best.scoreResult.decision === 'TRADE' ? 'NO_SETUP' : best.scoreResult.decision,
                rejectReason: best.scoreResult.reason || `Score ${best.scoreResult.score}/8 below required ${config.minSignalScore}`,
                walletBalance: availableBalance,
                effectiveBudget,
                affordableSymbols: affordableSymbols.length,
                totalScanned: allSymbols.length,
            });

            // Also record up to 2 other notable scored candidates so the log table shows evaluated market context
            const otherNotables = candidates.slice(1, 3);
            for (const other of otherNotables) {
                if (other.scoreResult?.score >= 3) {
                    await this._recordSignal({
                        userId,
                        symbol: other.symbol,
                        direction: other.scoreResult.direction,
                        score: other.scoreResult.score,
                        conditions: other.scoreResult.conditions,
                        snapshot: other.snapshot,
                        regime: other.regimeResult?.regime,
                        groqRegime: other.groqResult?.marketRegime,
                        groqConfidence: other.groqResult?.confidence,
                        groqRiskAdj: other.groqResult?.riskAdjustment,
                        decision: other.scoreResult.decision,
                        rejectReason: other.scoreResult.reason || `Score ${other.scoreResult.score}/8 below required ${config.minSignalScore}`,
                        walletBalance: availableBalance,
                        effectiveBudget,
                        affordableSymbols: affordableSymbols.length,
                        totalScanned: allSymbols.length,
                    });
                }
            }

            // If in Adaptive Hybrid mode, fall back to checking for Squeeze Breakouts
            if (strategyType === 'adaptive_hybrid') {
                console.log(`[TradingBot] 🔀 [Adaptive Hybrid] No trend pullback qualified (Best: ${best.symbol} ${best.scoreResult.score}/${config.minSignalScore}). Checking for Breakout Squeeze setups...`);
                await this._scanBreakoutStraddle(config, userId, availableBalance, effectiveBudget, allSymbols, affordableSymbols, unheldAffordable, maxAllowed, openTrades);
                return;
            }

            await this._logEvent(userId, 'NO_SIGNAL_FOUND', 'info',
                `Scan completed. Best score was ${best.symbol} (${best.scoreResult.score}/${config.minSignalScore}, ${best.scoreResult.decision}). No trade executed.`
            );
            return;
        }

        // ── 6. Risk Engine & Cost Validation ──────────────────────────────────
        let tradeDirection = best.scoreResult.direction;
        const isReverse = config.reverseMode === true;
        if (isReverse) {
            tradeDirection = tradeDirection === 'long' ? 'short' : 'long';
            console.log(`[TradingBot] 🔄 REVERSE MODE ACTIVE: Inverting signal ${best.scoreResult.direction?.toUpperCase()} → ${tradeDirection.toUpperCase()} on ${best.symbol} (fading rally/dump)`);
        }

        // ── Institutional Dynamic Pullback Limit Pricing ───────────────────────
        // Never chase the impulse climax. Anchor entry to dynamic support (EMA9)
        // or a 0.30%–0.50% ATR discount level.
        const currentLivePrice = best.snapshot.close;
        const ema9_5m          = best.snapshot['5m']?.ema9;
        const ema21_5m         = best.snapshot['5m']?.ema21;
        const atr5m            = best.snapshot['5m']?.atr || (currentLivePrice * 0.005);
        const spec             = this.productCatalog?.getBySymbol(best.symbol) || productCatalog.getBySymbol(best.symbol);
        const tickSize         = parseFloat(spec?.tick_size || 0.001);

        const roundToTick = (p, tick) => {
            if (!tick || tick <= 0) return p;
            return parseFloat((Math.round(p / tick) * tick).toFixed(8));
        };

        let smartEntryPrice = currentLivePrice;

        if (tradeDirection === 'long') {
            // For LONG: target the pullback to EMA9 (or at least 0.35 * ATR below current tip)
            if (ema9_5m && ema9_5m < currentLivePrice) {
                // If EMA9 is nearby, anchor right at EMA9, capped by max discount of 0.50 * ATR
                const targetDiscount = Math.max(ema9_5m, currentLivePrice - (atr5m * 0.50));
                smartEntryPrice = targetDiscount;
            } else {
                // Fallback discount: 0.35% below current tip
                smartEntryPrice = currentLivePrice * 0.9965;
            }
        } else if (tradeDirection === 'short') {
            // For SHORT: target the pullback to EMA9 resistance
            if (ema9_5m && ema9_5m > currentLivePrice) {
                const targetPremium = Math.min(ema9_5m, currentLivePrice + (atr5m * 0.50));
                smartEntryPrice = targetPremium;
            } else {
                // Fallback premium: 0.35% above current dump low
                smartEntryPrice = currentLivePrice * 1.0035;
            }
        }

        smartEntryPrice = roundToTick(smartEntryPrice, tickSize);
        const adjPct = (Math.abs(currentLivePrice - smartEntryPrice) / currentLivePrice * 100).toFixed(3);
        console.log(`[TradingBot] 📐 Institutional Pullback Entry on ${best.symbol}: live=$${currentLivePrice.toFixed(4)} → limit entry=$${smartEntryPrice.toFixed(4)} (${adjPct}% discount @ dynamic support)`);

        const riskResult = calcRisk({
            config,
            actualAvailableBalance: availableBalance,
            symbol: best.symbol,
            direction: tradeDirection,
            entryPrice: smartEntryPrice,
            atr: best.snapshot['5m'].atr,
            spread: best.snapshot.spread,
            fundingRate: best.snapshot.fundingRate,
            productSpec: this.productCatalog.getBySymbol(best.symbol),
            dailyStats,
        });

        if (!riskResult.valid) {
            console.log(`[TradingBot] Setup on ${best.symbol} rejected by RiskEngine: ${riskResult.reason}`);
            await this._recordSignal({
                userId,
                symbol: best.symbol,
                direction: tradeDirection,
                score: best.scoreResult.score,
                conditions: best.scoreResult.conditions,
                snapshot: best.snapshot,
                regime: best.regimeResult?.regime,
                groqRegime: best.groqResult?.marketRegime,
                groqConfidence: best.groqResult?.confidence,
                groqRiskAdj: best.groqResult?.riskAdjustment,
                decision: 'SKIPPED_RISK',
                rejectReason: `RiskEngine rejected (${isReverse ? 'REVERSED: ' : ''}${riskResult.reason})`,
                walletBalance: availableBalance,
                effectiveBudget,
                affordableSymbols: affordableSymbols.length,
                totalScanned: allSymbols.length,
                reverseMode: isReverse,
            });

            await this._logEvent(userId, 'TRADE_REJECTED', 'warn',
                `Signal on ${best.symbol} (${isReverse ? 'REVERSED ' : ''}${tradeDirection.toUpperCase()}) rejected by risk engine: ${riskResult.reason}`
            );
            return;
        }

        // ── 7. Order Execution ─────────────────────────────────────────────────
        console.log(`[TradingBot] 🚀 Executing trade: ${isReverse ? '[REVERSED] ' : ''}${tradeDirection.toUpperCase()} ${riskResult.qty} ${best.symbol} (Margin: $${riskResult.margin.toFixed(2)})`);

        const execResult = await executionEngine.executeTrade({
            userId,
            mode: this.mode,
            symbol: best.symbol,
            direction: tradeDirection,
            entryPrice: riskResult.entryPrice,
            stopLoss: riskResult.stopLoss,
            stopLossTrigger: riskResult.stopLossTrigger,
            takeProfit: riskResult.takeProfit,
            takeProfitTrigger: riskResult.takeProfitTrigger,
            quantity: riskResult.qty,
            leverage: riskResult.leverage,
            margin: riskResult.margin,
            signalScore: best.scoreResult.score,
            regime: best.regimeResult?.regime,
            walletBalanceAtEntry: availableBalance,
            effectiveBudgetAtEntry: riskResult.effectiveBudget,
            productSpec: this.productCatalog.getBySymbol(best.symbol),
            io: this.io,
            wsManager: this.wsManager,
            reverseMode: isReverse,
            orderType: 'limit_order',
        });

        // Record successful trade signal
        const botSignal = await this._recordSignal({
            userId,
            symbol: best.symbol,
            direction: tradeDirection,
            score: best.scoreResult.score,
            conditions: best.scoreResult.conditions,
            snapshot: best.snapshot,
            regime: best.regimeResult?.regime,
            groqRegime: best.groqResult?.marketRegime,
            groqConfidence: best.groqResult?.confidence,
            groqRiskAdj: best.groqResult?.riskAdjustment,
            decision: execResult.success ? 'TRADE' : 'REJECT',
            rejectReason: execResult.success ? null : execResult.reason,
            walletBalance: availableBalance,
            effectiveBudget,
            affordableSymbols: affordableSymbols.length,
            totalScanned: allSymbols.length,
            botTradeId: execResult.trade?._id || null,
            reverseMode: isReverse,
        });

        if (execResult.success) {
            await this._logEvent(userId, 'SIGNAL_GENERATED', 'info',
                `TradingBot executed ${best.scoreResult.direction.toUpperCase()} ${best.symbol} with score ${best.scoreResult.score}/8`
            );
        }
    }

    /**
     * Executes the Breakout Straddle scan pipeline:
     * 1. Evaluates affordable coins for TTM Squeeze compression (BB inside KC).
     * 2. Calculates Upper Resistance & Lower Support Tripwires with ATR buffers.
     * 3. Arms BreakoutWatcher to monitor live WebSocket ticks for instant breach execution.
     */
    async _scanBreakoutStraddle(config, userId, availableBalance, effectiveBudget, allSymbols, affordableSymbols, unheldAffordable, maxAllowed, openTrades) {
        const coinsToScan = unheldAffordable.slice(0, 25);
        console.log(`[TradingBot] ⚡ Scanning ${coinsToScan.length} coins for Breakout Straddle (TTM Squeeze)...`);

        const setups = await breakoutScanner.scanAll(coinsToScan, config, this.wsManager);

        if (!setups || setups.length === 0) {
            console.log(`[TradingBot] [Breakout] No coins in volatility squeeze among ${coinsToScan.length} scanned.`);
            this.lastScanResult = {
                timestamp: new Date(),
                totalScanned: allSymbols.length,
                affordableCount: affordableSymbols.length,
                bestSymbol: null,
                bestScore: null,
                decision: 'NO_SQUEEZE',
                reason: `Scanned ${coinsToScan.length} coins. None met ${config.breakoutSqueezeBars || 3}+ bar TTM squeeze criteria.`,
            };
            await this._recordSignal({
                userId,
                symbol: 'SQUEEZE_SCAN',
                direction: null,
                score: 0,
                decision: 'NO_SQUEEZE',
                rejectReason: `No coins met ${config.breakoutSqueezeBars || 3}+ consecutive 5m squeeze bars`,
                walletBalance: availableBalance,
                effectiveBudget,
                affordableSymbols: affordableSymbols.length,
                totalScanned: allSymbols.length,
            });
            await this._logEvent(userId, 'NO_SIGNAL_FOUND', 'info',
                `Breakout scan completed. No coins in squeeze among ${coinsToScan.length} candidates.`
            );
            return;
        }

        // Sort setups: longest squeeze (most compressed) first, then narrowest bandwidth
        setups.sort((a, b) => {
            if (b.squeezeBars !== a.squeezeBars) return b.squeezeBars - a.squeezeBars;
            return (a.bandwidth || 0) - (b.bandwidth || 0);
        });

        // Arm top setup(s) up to available slots
        const availableSlots = Math.max(1, maxAllowed - openTrades.length);
        const toArm = setups.slice(0, Math.min(availableSlots, 2));

        for (const setup of toArm) {
            const spec = this.productCatalog?.getBySymbol(setup.symbol) || productCatalog.getBySymbol(setup.symbol);
            const contractValue = parseFloat(spec?.contract_value || 1);
            const minQty = parseFloat(spec?.min_quantity || 1);
            const leverage = Math.min(config.maxLeverage || 20, parseFloat(spec?.max_leverage || 100));
            const budgetUSDT = config.budgetUSDT > 0 ? config.budgetUSDT : 10;
            const walletParts = Math.max(1, config.walletParts || 1);
            const targetPartMargin = budgetUSDT / walletParts;
            const targetMargin = Math.min(targetPartMargin, availableBalance);
            const targetNotional = targetMargin * leverage;
            const rawQty = Math.round(targetNotional / (contractValue * setup.currentPrice));
            const maxQtyFromBalance = Math.floor((availableBalance * leverage) / (contractValue * setup.currentPrice));
            const qty = Math.min(Math.max(minQty, rawQty), maxQtyFromBalance);
            const margin = (qty * contractValue * setup.currentPrice) / leverage;

            const context = {
                userId,
                mode: this.mode,
                config,
                effectiveBudget,
                margin,
                quantity: qty,
                walletBalanceAtEntry: availableBalance,
                effectiveBudgetAtEntry: effectiveBudget,
            };

            breakoutWatcher.armTripwire(setup, context);

            await this._logEvent(userId, 'SQUEEZE_DETECTED', 'info',
                `⚡ [SQUEEZE] ${setup.symbol} compressed for ${setup.squeezeBars} bars (Bandwidth: ${setup.bandwidth?.toFixed(4)}). Range: $${setup.rangeLow.toFixed(4)} - $${setup.rangeHigh.toFixed(4)}`,
                { symbol: setup.symbol, squeezeBars: setup.squeezeBars, bandwidth: setup.bandwidth, rangeHigh: setup.rangeHigh, rangeLow: setup.rangeLow }
            );
        }

        const top = toArm[0];
        this.lastScanResult = {
            timestamp: new Date(),
            totalScanned: allSymbols.length,
            affordableCount: affordableSymbols.length,
            bestSymbol: top.symbol,
            bestScore: 8,
            decision: 'TRIPWIRE_ARMED',
            reason: `Armed dual tripwires for ${top.symbol} (Squeeze: ${top.squeezeBars} bars). Long @ $${top.upperTripwire.toFixed(4)}, Short @ $${top.lowerTripwire.toFixed(4)}`,
        };

        await this._recordSignal({
            userId,
            symbol: top.symbol,
            direction: 'both',
            score: 8,
            decision: 'TRIPWIRE_ARMED',
            rejectReason: null,
            walletBalance: availableBalance,
            effectiveBudget,
            affordableSymbols: affordableSymbols.length,
            totalScanned: allSymbols.length,
        });
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    async _recordSignal(data) {
        try {
            const snap5m = data.snapshot?.['5m'] || {};
            const snap1m = data.snapshot?.['1m'] || {};

            const signal = await BotSignal.create({
                userId: data.userId,
                mode: this.mode,
                symbol: data.symbol,
                timestamp: new Date(),
                direction: data.direction,
                score: data.score || 0,
                maxScore: 8,
                conditions: data.conditions || {},
                ema9_1m: snap1m.ema9,
                ema21_1m: snap1m.ema21,
                rsi_1m: snap1m.rsi,
                momentum_1m: snap1m.momentum,
                close_1m: snap1m.close,
                ema9_5m: snap5m.ema9,
                ema21_5m: snap5m.ema21,
                ema21Slope_5m: snap5m.ema21Slope,
                rsi_5m: snap5m.rsi,
                atr_5m: snap5m.atr,
                volumeRatio: snap5m.volumeRatio,
                close_5m: snap5m.close,
                spread: data.snapshot?.spread,
                fundingRate: data.snapshot?.fundingRate,
                regime: data.regime,
                groqRegime: data.groqRegime || null,
                groqConfidence: data.groqConfidence || null,
                groqRiskAdj: data.groqRiskAdj || 1.0,
                decision: data.decision,
                rejectReason: data.rejectReason,
                walletBalance: data.walletBalance,
                effectiveBudget: data.effectiveBudget,
                affordableSymbols: data.affordableSymbols,
                totalScanned: data.totalScanned,
                botTradeId: data.botTradeId,
                reverseMode: data.reverseMode || false,
            });

            if (this.io) {
                this.io.emit('bot_signal_logged', {
                    mode: this.mode,
                    signal,
                });
            }

            return signal;
        } catch (err) {
            console.error('[TradingBot] Failed to save BotSignal audit:', err.message);
            return null;
        }
    }

    async _buildDeltaClient(userId) {
        const apiKeyDoc = await ApiKey.findOne({ userId, exchange: 'delta', isActive: true });
        if (!apiKeyDoc) return null;
        const apiKey = decryptData(apiKeyDoc.apiKeyEncrypted);
        const apiSecret = decryptData(apiKeyDoc.apiSecretEncrypted);
        return new DeltaOrderClient(apiKey, apiSecret);
    }

    async _logEvent(userId, type, severity, message, metadata = {}) {
        try {
            const eventDoc = await BotEvent.create({
                userId,
                mode: this.mode,
                type,
                severity,
                message,
                metadata,
                timestamp: new Date(),
            });

            // Emit live event via Socket.IO so it appears immediately in Live Events feed
            if (this.io) {
                const payload = {
                    _id: eventDoc._id,
                    mode: this.mode,
                    type,
                    eventType: type,
                    severity,
                    level: severity,
                    message,
                    metadata,
                    timestamp: eventDoc.timestamp,
                };
                this.io.to(`user:${userId}`).emit('bot_event', payload);
                this.io.emit('bot_event', payload);
            }
        } catch (err) {
            console.error('[TradingBot] Failed to log BotEvent:', err.message);
        }
    }

    /**
     * Scans currently open positions for the user to detect severe opposite trend/rally
     * with high drawdown (ROI < -20%). If all conditions are met, immediately closes
     * the position at current market price (Smart Loss Guard).
     *
     * Triple-Lock Conditions:
     * 1. Current unrealised ROI <= -20% on position margin.
     * 2. Market trend has reversed against trade direction (e.g. LONG into TRENDING_DOWN, SHORT into TRENDING_UP).
     * 3. 1m momentum / price action actively confirms opposite rally (negative for LONG, positive for SHORT).
     */
    /**
     * Scans currently open positions for the user to evaluate their safety and detect
     * severe opposite trend/rally with high drawdown (ROI < -20%).
     *
     * For every open position, logs to Live Events whether it is [SAFE] or [DROP OFF].
     * If all 3 drop-off conditions are met and Smart Loss Guard is enabled, immediately
     * places a limit close order at the current market price.
     *
     * Triple-Lock Drop-Off Conditions:
     * 1. Current unrealised ROI <= -20% on position margin.
     * 2. Market trend has reversed against trade direction (e.g. LONG into TRENDING_DOWN, SHORT into TRENDING_UP).
     * 3. 1m momentum / price action actively confirms opposite rally (negative for LONG, positive for SHORT).
     */
    async _scanOpenPositionsForRescue(userId, config) {
        try {
            const openTrades = await BotTrade.find({
                userId,
                mode: this.mode,
                result: 'open',
            });

            if (!openTrades || openTrades.length === 0) return 0;

            const guardActive = config.smartLossGuard === true;
            console.log(`[TradingBot] 🛡️ Scanning ${openTrades.length} open position(s) for ${this.mode} (Smart Loss Guard: ${guardActive ? 'ON' : 'OFF'})...`);
            let rescuedCount = 0;

            for (const trade of openTrades) {
                try {
                    const symbol = trade.symbol;

                    // 1. Get live price
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
                        const lastCandle = candleStore.getLastCandle(symbol, '1m') || candleStore.getLastCandle(symbol, '5m');
                        if (lastCandle?.close) currentPrice = lastCandle.close;
                    }

                    if (!currentPrice || currentPrice <= 0) {
                        continue; // cannot evaluate without live price
                    }

                    // 2. Calculate ROI on margin
                    const spec = this.productCatalog?.getBySymbol(symbol) || productCatalog.getBySymbol(symbol);
                    const contractValue = parseFloat(spec?.contract_value || trade.contractValue || 1);
                    const isLong = trade.direction === 'long';
                    const priceDiff = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
                    const unrealisedGross = priceDiff * trade.quantity * contractValue;
                    const roi = trade.margin > 0 ? (unrealisedGross / trade.margin) * 100 : 0;

                    // 3. Technical analysis for Trend Reversal & Opposite Rally
                    const snapshot = analyzeSymbol(symbol, this.wsManager);
                    const regimeResult = snapshot ? detectRegime(snapshot) : null;
                    const currentRegime = regimeResult?.regime || 'STABLE';
                    const m5 = snapshot ? snapshot['5m'] : null;
                    const m1 = snapshot ? snapshot['1m'] : null;

                    // ── BREAKEVEN SL MOVE CHECK (50% TP Target Reached) ──
                    if (!trade.breakevenMoved && trade.takeProfit && trade.entryPrice) {
                        const tpDistance = Math.abs(trade.takeProfit - trade.entryPrice);
                        const beTriggerPrice = isLong
                            ? trade.entryPrice + (tpDistance * 0.50)
                            : trade.entryPrice - (tpDistance * 0.50);

                        const pricePassedTrigger = isLong
                            ? currentPrice >= beTriggerPrice
                            : currentPrice <= beTriggerPrice;

                        // 1m trend still aligned with position direction
                        const trendAligned = isLong
                            ? (m1?.ema9 && m1?.ema21 ? m1.ema9 > m1.ema21 : true)
                            : (m1?.ema9 && m1?.ema21 ? m1.ema9 < m1.ema21 : true);

                        if (pricePassedTrigger && trendAligned) {
                            trade.breakevenTriggeredCount = (trade.breakevenTriggeredCount || 0) + 1;
                            await trade.save();

                            const neededConfirmations = trade.strategyType === 'breakout_straddle' ? 1 : 2;
                            if (trade.breakevenTriggeredCount >= neededConfirmations) {
                                // Confirmed over N consecutive cycles — execute breakeven SL move
                                console.log(`[TradingBot] 🔒 Breakeven confirmed (${trade.breakevenTriggeredCount}/${neededConfirmations}) for ${trade.direction.toUpperCase()} ${symbol} (Current: $${currentPrice}, Trigger: $${beTriggerPrice.toFixed(4)}). Moving SL to Entry: $${trade.entryPrice}`);
                                try {
                                    await positionMonitor.modifyStopLoss(trade, trade.entryPrice);
                                } catch (beErr) {
                                    console.error(`[TradingBot] Failed to execute breakeven SL move for ${symbol}:`, beErr.message);
                                }
                            } else {
                                // First confirmation cycle
                                console.log(`[TradingBot] ⏳ Breakeven trigger pending (1/${neededConfirmations} confirmations) for ${symbol} @ $${currentPrice} (Trigger: $${beTriggerPrice.toFixed(4)})`);
                                await this._logEvent(
                                    userId,
                                    'POSITION_BREAKEVEN_PENDING',
                                    'info',
                                    `⏳ [BREAKEVEN PENDING] ${symbol} (${trade.direction.toUpperCase()}): Reached 50% TP target ($${currentPrice} ${isLong ? '>=' : '<='} $${beTriggerPrice.toFixed(4)}). Awaiting confirmation to move SL to Entry.`,
                                    { tradeId: trade._id, symbol, currentPrice, beTriggerPrice, confirmations: 1 }
                                );
                            }
                        } else if (trade.breakevenTriggeredCount > 0) {
                            // Price pulled back below 50% TP before second confirmation — reset
                            trade.breakevenTriggeredCount = 0;
                            await trade.save();
                        }
                    }

                    // Condition 2: Trend has gone opposite
                    let trendReversed = false;
                    if (snapshot && m5) {
                        if (isLong) {
                            trendReversed = currentRegime === 'TRENDING_DOWN' || (m5.ema9 < m5.ema21 && m5.ema21Slope < 0) || (m5.rsi !== null && m5.rsi < 45);
                        } else {
                            trendReversed = currentRegime === 'TRENDING_UP' || (m5.ema9 > m5.ema21 && m5.ema21Slope > 0) || (m5.rsi !== null && m5.rsi > 55);
                        }
                    }

                    // Condition 3: Signalling big loss / opposite rally (1m momentum actively confirms opposite direction)
                    // Tightened: requires both meaningful momentum magnitude (< -0.05% for LONG, > +0.05% for SHORT) AND EMA confirmation
                    let momentumConfirms = false;
                    if (snapshot && m1) {
                        if (isLong) {
                            momentumConfirms = ((m1.momentum ?? 0) < -0.05) && (m1.ema9 < m1.ema21);
                        } else {
                            momentumConfirms = ((m1.momentum ?? 0) > 0.05) && (m1.ema9 > m1.ema21);
                        }
                    }

                    // Triple-lock check: ROI <= -20% AND trend reversed AND momentum confirms
                    const isDropOffCondition = roi <= -20 && trendReversed && momentumConfirms;

                    if (isDropOffCondition) {
                        // ── TIME TO DROP OFF ──
                        if (guardActive) {
                            console.log(`[TradingBot] 🚨 SMART LOSS GUARD TRIGGERED: Closing ${isLong ? 'LONG' : 'SHORT'} ${symbol} @ $${currentPrice}! ROI: ${roi.toFixed(2)}%, Regime: ${currentRegime}, Momentum: ${m1?.momentum?.toFixed(2)}%`);

                            await positionMonitor.closeTradeWithReason(
                                trade,
                                currentPrice,
                                'smart_loss_guard',
                                {
                                    roi,
                                    regime: currentRegime,
                                    momentum: m1?.momentum,
                                    reason: `Smart Loss Guard: ROI ${roi.toFixed(2)}% <= -20% with opposite ${currentRegime} rally`,
                                }
                            );

                            await this._logEvent(
                                userId,
                                'SMART_LOSS_GUARD',
                                'critical',
                                `🚨 [DROP OFF] ${symbol} (${trade.direction.toUpperCase()}): Dropped off! ROI ${roi.toFixed(2)}% <= -20% with opposite ${currentRegime} rally. Market close placed @ $${currentPrice}`,
                                { tradeId: trade._id, symbol, direction: trade.direction, currentPrice, roi, regime: currentRegime, momentum: m1?.momentum, status: 'DROP_OFF' }
                            );

                            rescuedCount++;
                        } else {
                            // Guard disabled, but report in live events that drop-off conditions are met
                            await this._logEvent(
                                userId,
                                'POSITION_GUARD_DROP',
                                'warn',
                                `⚠️ [DROP SIGNAL] ${symbol} (${trade.direction.toUpperCase()}): Drop-off signal detected (ROI ${roi.toFixed(2)}% <= -20% & ${currentRegime} reversal). Smart Loss Guard is OFF: holding position.`,
                                { tradeId: trade._id, symbol, direction: trade.direction, currentPrice, roi, regime: currentRegime, momentum: m1?.momentum, status: 'DROP_SIGNAL' }
                            );
                        }
                    } else {
                        // ── SAFE TO HOLD ──
                        let safeReason = '';
                        if (trade.breakevenMoved) {
                            safeReason = `Breakeven SL locked @ $${trade.entryPrice} (Zero risk secured)`;
                        } else if (roi >= 0) {
                            safeReason = `In profit (+${roi.toFixed(1)}%), trend aligned`;
                        } else if (roi > -20) {
                            safeReason = `Normal pullback (${roi.toFixed(1)}%), within risk limits`;
                        } else {
                            safeReason = `Drawdown ${roi.toFixed(1)}%, but trend intact (no opposite rally)`;
                        }

                        await this._logEvent(
                            userId,
                            'POSITION_GUARD_SAFE',
                            'info',
                            `🛡️ [SAFE] ${symbol} (${trade.direction.toUpperCase()}): Safe to hold · ROI: ${roi >= 0 ? '+' : ''}${roi.toFixed(2)}% · Trend: ${currentRegime} · ${safeReason}`,
                            { tradeId: trade._id, symbol, direction: trade.direction, currentPrice, roi, regime: currentRegime, status: 'SAFE' }
                        );
                    }
                } catch (posErr) {
                    console.error(`[TradingBot] Error checking position ${trade.symbol} in position scan:`, posErr.message);
                }
            }

            if (rescuedCount > 0) {
                console.log(`[TradingBot] 🛡️ Smart Loss Guard closed ${rescuedCount} position(s).`);
            }

            return rescuedCount;
        } catch (err) {
            console.error(`[TradingBot] ❌ Error in position safety scan:`, err.message);
            return 0;
        }
    }

    _emitStatus() {
        if (!this.io) return;
        try {
            this.io.emit('bot_status', {
                mode: this.mode,
                ...this.getStatus(),
            });
        } catch (err) {
            console.error('[TradingBot] Failed to emit status:', err.message);
        }
    }
}

// Instantiate singletons for paper and live modes
const paperBot = new TradingBot('paper');
const liveBot = new TradingBot('live');

module.exports = {
    TradingBot,
    paperBot,
    liveBot,
};
