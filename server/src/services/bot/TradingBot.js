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
const aiRegimeAnalyzer = require('./AiRegimeAnalyzer');

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

        // Start AI regime analyzer
        aiRegimeAnalyzer.start(this.wsManager);

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
        console.log(`[TradingBot] ⏹️ ${this.mode.toUpperCase()} Bot stopped`);
        this._emitStatus();
    }

    /**
     * Emergency close position and stop.
     */
    async emergencyStop(userId, symbol = null, reason = 'user_emergency_stop') {
        let closeResult = null;
        if (!symbol) {
            const openTrades = await BotTrade.find({ userId, mode: this.mode, result: 'open' });
            for (const t of openTrades) {
                await executionEngine.emergencyClose({
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

        this.stop();
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
        // Check for existing open trades (max simultaneous open positions limit)
        const openTrades = await BotTrade.find({ userId, mode: this.mode, result: 'open' });
        const maxAllowed = config.maxOpenPositions || 5;
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

        // Exclude symbols that already have an open position so we don't duplicate trades in the same coin
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

        const riskResult = calcRisk({
            config,
            actualAvailableBalance: availableBalance,
            symbol: best.symbol,
            direction: tradeDirection,
            entryPrice: best.snapshot.close,
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
            takeProfit: riskResult.takeProfit,
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
            await BotEvent.create({
                userId,
                mode: this.mode,
                type,
                severity,
                message,
                metadata,
                timestamp: new Date(),
            });
        } catch (err) {
            console.error('[TradingBot] Failed to log BotEvent:', err.message);
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
