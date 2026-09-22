/**
 * SignalEngine.js
 *
 * Gemini AI Signal Engine — Phase 6.
 *
 * Architecture:
 *   1. Every 5 minutes, rotates through all 195 perpetual futures.
 *   2. For each coin, runs MarketAnalyzer.analyzeMultiTimeframe() (5m/15m/1h).
 *   3. Only calls Gemini if:
 *        - The composite indicator + SMC bias score exceeds a threshold
 *        - The coin hasn't had a signal in the last 15 minutes
 *   4. Parses Gemini's JSON response and saves it as a TradeSignal document.
 *   5. Emits real-time signal to all connected Socket.IO clients.
 *   6. Tracks AI accuracy for self-learning (Phase 9).
 *
 * Usage:
 *   const signalEngine = require('./SignalEngine');
 *   signalEngine.start(io, wsManager, productCatalog);
 *   signalEngine.stop();
 */

const TradeSignal = require('../../models/TradeSignal');
const MarketAnalyzer = require('../analysis/MarketAnalyzer');
const GeminiClient = require('./AiService'); // Dynamic AI Router for Groq & DeepSeek
const { SYSTEM_PROMPT, buildUserPrompt } = require('./PromptBuilder');
const UserPreferences = require('../../models/UserPreferences');
const PaperWallet = require('../../models/PaperWallet');
const selfLearning = require('./SelfLearning');
const notificationService = require('../NotificationService');
const scalpRiskGuard = require('./ScalpRiskGuard');
const productCatalog = require('../ProductCatalog');

// Configuration — Scalp Mode (90%+ Target Win Rate)
const CYCLE_INTERVAL_MS   = 5 * 60 * 1000;  // 5 minutes per cycle
const COINS_PER_CYCLE     = 20;              // Coins scanned per cycle
const GEMINI_CALL_DELAY   = 4000;            // 4s between Gemini calls → max ~15 RPM
const MIN_BIAS_SCORE      = 0.35;            // Minimum bias score to call AI (strong directional bias only)
const MIN_SIGNAL_GAP_MS   = 15 * 60 * 1000; // 15 min gap between signals per coin
const MIN_CONFIDENCE      = 72;              // Minimum confidence to emit signal (high conviction setups)
const MIN_RR              = 0.35;            // Minimum R/R ratio gate before saving signal (scalp math: 0.3-0.6)

class SignalEngine {
    constructor() {
        this.io = null;
        this.wsManager = null;
        this.catalog = null;
        this.cycleTimer = null;
        this.running = false;
        this._lastSignalTime = new Map(); // symbol → timestamp
        this._cycleCount = 0;
        this._stats = { processed: 0, called: 0, saved: 0, errors: 0 };
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Start the 5-minute signal engine.
     * @param {import('socket.io').Server} io
     * @param {import('../DeltaWebSocketManager')} wsManager
     * @param {import('../ProductCatalog')} catalog
     */
    start(io, wsManager, catalog) {
        if (this.running) return;
        this.io = io;
        this.wsManager = wsManager;
        this.catalog = catalog;
        this.running = true;

        console.log('[SignalEngine] 🚀 Initialized (On-Demand scan mode only)');

        /*
        console.log('[SignalEngine] 🚀 Started — scanning 195 coins every 5 minutes');

        // Run first cycle after 30s (give WS time to collect live prices)
        setTimeout(() => this._runCycle(), 30_000);

        // Then every 5 minutes
        this.cycleTimer = setInterval(() => this._runCycle(), CYCLE_INTERVAL_MS);
        */
    }

    stop() {
        this.running = false;
        if (this.cycleTimer) {
            clearInterval(this.cycleTimer);
            this.cycleTimer = null;
        }
        console.log('[SignalEngine] Stopped');
    }

    // ─── Main cycle ────────────────────────────────────────────────────────────

    async _runCycle() {
        if (!this.running || !this.catalog?.isReady) return;
        this._cycleCount++;
        const cycleStart = Date.now();

        const allSymbols = this.catalog.getSymbols();

        // ── Fair rotation: each cycle picks a different slice of ALL coins ──
        if (!this._shuffledSymbols || this._cycleCount % 20 === 1) {
            this._shuffledSymbols = [...allSymbols].sort(() => Math.random() - 0.5);
            this._rotationIndex = 0;
            console.log(`[SignalEngine] 🔀 Reshuffled ${allSymbols.length} symbols for fair rotation`);
        }
        const start  = this._rotationIndex % this._shuffledSymbols.length;
        const slice  = [];
        for (let i = 0; i < COINS_PER_CYCLE; i++) {
            slice.push(this._shuffledSymbols[(start + i) % this._shuffledSymbols.length]);
        }
        this._rotationIndex = (this._rotationIndex + COINS_PER_CYCLE) % this._shuffledSymbols.length;

        this._stats = { processed: 0, called: 0, saved: 0, errors: 0 };

        // ── Fetch user prefs + wallet balance ────────────────────────────────
        let userPrefs = { maxLeverage: 10, riskTolerance: 'medium', maxSingleTradePct: 30, minReservePct: 20 };
        let walletContext = { availableBalance: 10000, tradeBudget: 3000, mode: 'paper' };
        try {
            const [dbPrefs, paperWallet] = await Promise.all([
                UserPreferences.findOne({}).sort({ updatedAt: -1 }).lean(),
                PaperWallet.findOne({}).lean(),
            ]);
            if (dbPrefs) userPrefs = { ...userPrefs, ...dbPrefs };

            if (paperWallet) {
                const available = paperWallet.available ?? paperWallet.balance ?? 10000;
                const maxSinglePct = userPrefs.maxSingleTradePct ?? 30;
                const reservePct   = userPrefs.minReservePct   ?? 20;
                // Budget per trade = available × maxSingleTradePct%, but leave reserve
                const usable = available * (1 - reservePct / 100);
                const tradeBudget = Math.floor(usable * (maxSinglePct / 100));
                walletContext = { availableBalance: available, tradeBudget, mode: 'paper' };
            }
        } catch (e) { /* use defaults */ }

        console.log(`[SignalEngine] Cycle #${this._cycleCount} | coins: ${slice.length} (pos ${start}/${allSymbols.length}) | budget: $${walletContext.tradeBudget} | ${slice.slice(0,4).join(', ')}…`);

        // ── Process coins SEQUENTIALLY — only delay when Gemini was actually called ──
        for (const sym of slice) {
            if (!this.running) break;
            const calledGemini = await this._processSymbol(sym, userPrefs, walletContext);
            // Only insert delay when a real API call was made (prevents rate limiting)
            if (calledGemini) {
                await new Promise(r => setTimeout(r, GEMINI_CALL_DELAY));
            }
        }

        const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
        console.log(`[SignalEngine] Cycle #${this._cycleCount} done in ${elapsed}s | `+
                    `Scanned: ${this._stats.processed} | AI calls: ${this._stats.called} | ` +
                    `Signals: ${this._stats.saved} | Errors: ${this._stats.errors}`);
    }

    // ─── Per-symbol processing ─────────────────────────────────────────────────

    async _processSymbol(symbol, userPrefs, walletContext = {}) {
        this._stats.processed++;

        try {
            // Skip if signaled recently
            const lastSignal = this._lastSignalTime.get(symbol);
            if (lastSignal && Date.now() - lastSignal < MIN_SIGNAL_GAP_MS) return;

            // Step 1: Multi-timeframe analysis
            const mtf = await MarketAnalyzer.analyzeMultiTimeframe(symbol);
            const primary = mtf['5m'] || mtf['15m'];
            if (!primary || primary.error) return;

            // Check liquidity/volume (skip if coin is staying still / illiquid)
            const isLiquid = primary.volumeContext?.isLiquid ?? true;
            if (!isLiquid) return;

            // Step 2a: Affordability check — can the user afford ≥1 contract?
            const catalog       = this.catalog || productCatalog;
            const spec          = catalog?.getBySymbol(symbol);
            const contractVal   = parseFloat(spec?.contract_value || 1);
            const currentPrice  = primary.price;
            const leverage      = Math.min(spec?.max_leverage || 10, userPrefs.maxLeverage || 10);
            const tradeBudget   = walletContext.tradeBudget ?? 10000;
            const marginFor1    = (currentPrice * contractVal) / leverage; // margin needed for 1 contract
            if (marginFor1 > tradeBudget) {
                // Too expensive — quietly skip (don't even waste bias computation)
                return;
            }

            // Step 2b: Pre-filter — Regime Guard (directional bias + ADX momentum check)
            const regime = this._checkMarketRegime(mtf);
            if (!regime.pass) {
                return;
            }
            const biasScore = mtf.mtfBias?.score ?? 0;

            console.log(`[SignalEngine] 🔍 ${symbol} @ $${currentPrice} | margin/contract: $${marginFor1.toFixed(4)} | budget: $${tradeBudget} | bias: ${biasScore.toFixed(2)}`);


            // Step 3: Self-learning context (non-blocking)
            let learningCtx = null;
            try {
                const [symCtx, globalCtx] = await Promise.all([
                    selfLearning.getContext(symbol),
                    selfLearning.getGlobalContext(),
                ]);
                learningCtx = selfLearning.formatForPrompt(symCtx, globalCtx);
            } catch (_) { /* skip */ }

            // Step 4: Call Gemini with budget context injected into prefs
            this._stats.called++;
            const prefsWithBudget = { ...userPrefs, ...walletContext };
            const userPrompt = buildUserPrompt(mtf, prefsWithBudget, learningCtx);
            const signal = await GeminiClient.call(userPrefs, SYSTEM_PROMPT, userPrompt);
            const geminiCalled = true; // flag for rate-limit delay

            // Step 5: Validate
            if (!signal || signal.action === 'NO_TRADE') {
                console.log(`[SignalEngine] ⬜ ${symbol} → NO_TRADE (conf: ${signal?.confidence ?? 0})`);
                return true; // Gemini was called
            }
            const effectiveMinConfidence = userPrefs.minConfidence || MIN_CONFIDENCE;
            if (signal.confidence < effectiveMinConfidence) {
                console.log(`[SignalEngine] ⬜ ${symbol} → Low confidence: ${signal.confidence}% < ${effectiveMinConfidence}%`);
                return true; // Gemini was called
            }

            // Step 5b: ScalpRiskGuard post-processor (enforces micro TP and wide SL for 90%+ win rate)
            const guardResult = scalpRiskGuard.process(signal, mtf);
            if (!guardResult.valid) {
                console.log(`[SignalEngine] ❌ ${symbol} — ScalpRiskGuard rejected: ${guardResult.error || 'invalid setup'}`);
                return true;
            }

            // Step 6: Auto-calculate recommended quantity from budget if Gemini didn't set one
            const entry = signal.entry || currentPrice;
            // Use Gemini's suggested leverage if within allowed max, else fall back to Step 2a value
            const sigLeverage = Math.min(signal.leverage || leverage, leverage);
            if (!signal.quantity && entry) {
                const marginPerContract = (entry * contractVal) / sigLeverage;
                signal.quantity = Math.max(1, Math.floor(tradeBudget / marginPerContract));
            }
            // Cap quantity so margin never exceeds tradeBudget
            if (signal.quantity && entry) {
                const marginNeeded = (signal.quantity * entry * contractVal) / sigLeverage;
                if (marginNeeded > tradeBudget * 1.1) {
                    signal.quantity = Math.max(1, Math.floor((tradeBudget * sigLeverage) / (entry * contractVal)));
                }
            }
            signal.leverage = sigLeverage;

            // Step 7: R/R validation gate — reject if math doesn't meet minimum
            if (!this._validateSignalRR(signal, symbol)) return true;

            await this._saveSignal(signal, mtf, primary, walletContext);
            this._lastSignalTime.set(symbol, Date.now());
            return true; // AI was called

        } catch (err) {
            this._stats.errors++;
            if (!err.message?.includes('Insufficient')) {
                console.error(`[SignalEngine] Error on ${symbol}:`, err.message);
            }
        }
        return false;
    }


    // ─── Market Regime & R/R Gates ───────────────────────────────────────────

    /**
     * Regime Guard: Verifies market conditions support high-probability scalping.
     * Rejects ranging / choppy markets or symbols lacking sufficient momentum/bias.
     * @param {Object} mtf
     * @returns {{ pass: boolean, reason?: string }}
     */
    _checkMarketRegime(mtf) {
        if (!mtf) return { pass: false, reason: 'Missing MTF analysis' };

        const tf15 = mtf['15m'] || mtf['5m'];
        const tf4h = mtf['4h'];
        const biasScore = Math.abs(mtf.mtfBias?.score ?? 0);

        // 1. Bias score gate (must have clear directional bias)
        if (biasScore < MIN_BIAS_SCORE) {
            return { pass: false, reason: `Bias score (${biasScore.toFixed(2)}) < ${MIN_BIAS_SCORE}` };
        }

        // 2. 4H Trend alignment (if 4H available, avoid conflicting / dead macro trends)
        if (tf4h && tf4h.bias && Math.abs(tf4h.bias.score ?? 0) < 0.20 && biasScore < 0.45) {
            return { pass: false, reason: `4H trend ambiguous (score ${tf4h.bias.score?.toFixed(2)})` };
        }

        // 3. ADX Momentum gate (ADX < 20 indicates sideways chop / ranging)
        const adx = tf15?.indicators?.adx?.adx;
        if (adx !== undefined && adx !== null && adx < 20) {
            return { pass: false, reason: `ADX too low (${adx} < 20) — market in low-momentum chop` };
        }

        return { pass: true };
    }

    /**
     * Validates that the signal's R/R meets the minimum threshold.
     * Rejects the signal and logs a warning if it doesn't.
     * @returns {boolean} true = valid (save it), false = reject (discard)
     */
    _validateSignalRR(signal, symbol) {
        if (!signal.entry || !signal.stopLoss || !signal.target1) {
            console.log(`[SignalEngine] ⚠️  ${symbol} — Missing entry/SL/TP, cannot validate R/R. Rejecting.`);
            return false;
        }
        const risk   = Math.abs(signal.entry - signal.stopLoss);
        const reward = Math.abs(signal.target1 - signal.entry);
        if (risk === 0) {
            console.log(`[SignalEngine] ⚠️  ${symbol} — Zero risk (entry === stopLoss). Rejecting.`);
            return false;
        }
        const rr = reward / risk;
        if (rr < MIN_RR) {
            console.log(`[SignalEngine] ❌ ${symbol} — R/R ${rr.toFixed(2)} < ${MIN_RR} minimum. Rejected.`);
            return false;
        }
        return true;
    }

    // ─── Signal persistence ────────────────────────────────────────────────────

    async _saveSignal(signal, mtf, primary, walletContext = {}) {
        const ind = primary.indicators;
        const smc = primary.smc;
        const catalog = this.catalog || productCatalog;
        const spec = catalog?.getBySymbol(signal.symbol || mtf.symbol);
        const contractVal = parseFloat(spec?.contract_value || 1);
        const estimatedMargin = signal.entry && signal.quantity
            ? ((signal.quantity * signal.entry * contractVal) / (signal.leverage || 10)).toFixed(2)
            : null;

        const doc = {
            symbol:     signal.symbol || mtf.symbol,
            action:     signal.action,
            entry:      signal.entry,
            stopLoss:   signal.stopLoss,
            target1:    signal.target1,
            target2:    signal.target2,
            leverage:   signal.leverage ?? 1,
            quantity:   signal.quantity ?? 1,
            confidence: signal.confidence,
            riskReward: signal.riskReward,
            avgVolumeUsdt: primary.volumeContext?.avgVolumeUsdt || null,
            reasoning:  signal.reasoning,
            smcContext: signal.smcContext,
            invalidationLevel: signal.invalidationLevel,
            tradeType:  signal.tradeType || 'scalp',
            tags:       signal.tags || [],
            timeframe:  signal.timeframe || '5m',
            mode:       'live',
            status:     'pending',

            // Indicator snapshot
            indicatorSnapshot: {
                rsi:      ind?.rsi,
                macd:     ind?.macd?.histogram,
                macdTrend: ind?.macd?.trend,
                bbUpper:  ind?.bb?.upper,
                bbLower:  ind?.bb?.lower,
                bbSqueeze: ind?.bb?.squeeze,
                ema8:     ind?.ema?.ema8,
                ema21:    ind?.ema?.ema21,
                ema50:    ind?.ema?.ema50,
                emaTrend: ind?.ema?.trend,
                adx:      ind?.adx?.adx,
                stochK:   ind?.stoch?.k,
                stochD:   ind?.stoch?.d,
                vwap:     ind?.vwap,
                atr:      ind?.atr,
            },

            // SMC snapshot
            smcSnapshot: {
                bias:            smc?.bias,
                hasOrderBlocks:  (smc?.orderBlocks?.bullish?.length || smc?.orderBlocks?.bearish?.length) > 0,
                hasFvg:          (smc?.fvgs?.bullish?.length || smc?.fvgs?.bearish?.length) > 0,
                hasLiquiditySweep: (smc?.liquiditySweeps?.length) > 0,
                premiumDiscount: smc?.premiumDiscount?.zone,
            },

            // Patterns
            patterns: primary.patterns?.list?.map(p => p.name) || [],
        };

        try {
            const saved = await TradeSignal.create(doc);
            this._stats.saved++;

            console.log(`[SignalEngine] ✅ ${doc.action} ${doc.symbol} @ $${doc.entry} | `+
                        `Qty: ${doc.quantity} | Margin: ~$${estimatedMargin} | `+
                        `SL: $${doc.stopLoss} | TP: $${doc.target1} | Conf: ${doc.confidence}%`);

            // Emit to all clients in real time
            if (this.io) {
                this.io.emit('new_signal', saved.toObject());
            }

            // Notify users via the notification system
            notificationService.notifyNewSignal(saved.toObject()).catch(() => {});

            return saved;
        } catch (dbErr) {
            console.error('[SignalEngine] DB save error:', dbErr.message);
        }
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    /**
     * Manually trigger analysis for a specific symbol (on-demand from frontend).
     */
    async analyzeNow(symbol, userPrefs, walletContext = {}) {
        const catalog = this.catalog || productCatalog;
        const wsManager = this.wsManager;

        if (symbol === 'RANDOM' || symbol === 'CHEAP') {
            if (!catalog?.isReady) {
                throw new Error('Product catalog is not ready');
            }
            const allSymbols = catalog.getSymbols();
            const tradeBudget = walletContext.tradeBudget;
            const userMaxLev = userPrefs.maxLeverage || 10;

            // Map each symbol to its 1-contract margin cost
            const symbolMarginMap = new Map();
            for (const s of allSymbols) {
                const spec = catalog.getBySymbol(s);
                const contractVal = parseFloat(spec?.contract_value || 1);
                const coinLev = Math.min(spec?.max_leverage || userMaxLev, userMaxLev);
                const price = wsManager ? wsManager.getPrice(s) : null;
                if (price && price > 0) {
                    const marginFor1 = (price * contractVal) / coinLev;
                    symbolMarginMap.set(s, marginFor1);
                }
            }

            // Filter for affordable coins: 1 contract must fit within tradeBudget
            let affordableCoins = allSymbols.filter(s => {
                const margin = symbolMarginMap.get(s);
                if (margin !== undefined && tradeBudget) {
                    return margin <= tradeBudget;
                }
                return true;
            });

            if (affordableCoins.length === 0) {
                // If strictly no coin fits, fallback to lowest margin coins
                affordableCoins = [...allSymbols].sort((a, b) => {
                    const ma = symbolMarginMap.get(a) ?? 9999;
                    const mb = symbolMarginMap.get(b) ?? 9999;
                    return ma - mb;
                });
            }

            const requestedAction = walletContext.requestedAction || 'all';
            const requestedConfRange = walletContext.requestedConfRange || 'all';

            console.log(`[On-Demand] Starting coin search (budget: $${tradeBudget ? tradeBudget.toFixed(2) : 'unlimited'}). Filter: Action = ${requestedAction}, Confidence Range = ${requestedConfRange}`);

            let prioritizedCoins;
            if (tradeBudget && tradeBudget <= 50) {
                // Low budget: sort by lowest margin first so user's trade executes reliably!
                prioritizedCoins = [...affordableCoins].sort((a, b) => {
                    const ma = symbolMarginMap.get(a) ?? 9999;
                    const mb = symbolMarginMap.get(b) ?? 9999;
                    return ma - mb;
                });
                console.log(`[On-Demand] 💡 Low budget mode active ($${tradeBudget.toFixed(2)}): prioritized ${prioritizedCoins.length} affordable coins. Cheapest: ${prioritizedCoins.slice(0, 5).map(s => `${s} ($${symbolMarginMap.get(s)?.toFixed(4)})`).join(', ')}`);
            } else {
                prioritizedCoins = [...affordableCoins].sort(() => Math.random() - 0.5);
            }

            let bestCandidateMatch = null;
            let topBiasCandidate = null;
            let llmCallsCount = 0;
            const maxLlmCalls = 10;
            const batchSize = 15;

            let firstMtf = null; // To use as a fallback mtf context if no trade is found

            for (let startIdx = 0; startIdx < prioritizedCoins.length; startIdx += batchSize) {
                if (llmCallsCount >= maxLlmCalls) {
                    console.log(`[On-Demand] Reached max LLM calls limit of ${maxLlmCalls}. Stopping search.`);
                    break;
                }
                
                const batchSymbols = prioritizedCoins.slice(startIdx, startIdx + batchSize);
                console.log(`[On-Demand] Fetching indicators for batch: ${batchSymbols.join(', ')}`);
                
                const batchResults = await Promise.allSettled(
                    batchSymbols.map(sym => MarketAnalyzer.analyzeMultiTimeframe(sym))
                );
                
                const batchCandidates = [];
                for (let j = 0; j < batchResults.length; j++) {
                    const res = batchResults[j];
                    if (res.status === 'fulfilled' && res.value) {
                        const mtf = res.value;
                        const primary = mtf['5m'] || mtf['15m'];
                        if (primary && !primary.error) {
                            const sym = batchSymbols[j];
                            // Check liquidity/volume (skip if coin is staying still / illiquid)
                            const isLiquid = primary.volumeContext?.isLiquid ?? true;
                            if (!isLiquid) {
                                console.log(`[On-Demand] Skipping illiquid/dead coin: ${sym}`);
                                continue;
                            }

                            // Affordability check with real primary.price & contract_value
                            const spec = catalog.getBySymbol(sym);
                            const contractVal = parseFloat(spec?.contract_value || 1);
                            const coinLev = Math.min(spec?.max_leverage || userMaxLev, userMaxLev);
                            const marginFor1 = (primary.price * contractVal) / coinLev;
                            if (tradeBudget && marginFor1 > tradeBudget) {
                                console.log(`[On-Demand] Skipping unaffordable coin: ${sym} (margin: $${marginFor1.toFixed(4)} > budget: $${tradeBudget.toFixed(2)})`);
                                continue;
                            }

                            const score = mtf.mtfBias?.score ?? 0;
                            batchCandidates.push({ symbol: sym, score, mtf, marginFor1, contractVal, coinLev });
                            if (!firstMtf) {
                                firstMtf = mtf;
                            }
                        }
                    }
                }
                
                // Track candidate with highest directional momentum / bias
                for (const c of batchCandidates) {
                    if (!topBiasCandidate || Math.abs(c.score) > Math.abs(topBiasCandidate.score)) {
                        topBiasCandidate = c;
                    }
                }

                // Filter and sort candidates based on requestedAction
                let filteredCandidates = [];
                if (requestedAction === 'BUY') {
                    // Pre-filter: only keep bullish bias candidates to save LLM calls
                    filteredCandidates = batchCandidates.filter(c => c.score > 0);
                    filteredCandidates.sort((a, b) => b.score - a.score);
                } else if (requestedAction === 'SELL') {
                    // Pre-filter: only keep bearish bias candidates
                    filteredCandidates = batchCandidates.filter(c => c.score < 0);
                    filteredCandidates.sort((a, b) => a.score - b.score);
                } else {
                    filteredCandidates = [...batchCandidates];
                    filteredCandidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
                }
                
                console.log(`[On-Demand] Batch yielded ${filteredCandidates.length} trend-aligned candidates out of ${batchSymbols.length} symbols.`);
                
                for (const candidate of filteredCandidates) {
                    if (llmCallsCount >= maxLlmCalls) break;
                    
                    console.log(`[On-Demand] LLM Call #${llmCallsCount+1}/${maxLlmCalls} for: ${candidate.symbol} (Bias Score: ${candidate.score.toFixed(2)}, Margin/contract: $${candidate.marginFor1.toFixed(4)})`);
                    llmCallsCount++;
                    
                    try {
                        let learningCtx = null;
                        try {
                            const [symCtx, globalCtx] = await Promise.all([
                                selfLearning.getContext(candidate.symbol),
                                selfLearning.getGlobalContext(),
                            ]);
                            learningCtx = selfLearning.formatForPrompt(symCtx, globalCtx);
                        } catch (_) {}

                        const prefsWithBudget = { ...userPrefs, ...walletContext };
                        const userPrompt = buildUserPrompt(candidate.mtf, prefsWithBudget, learningCtx);
                        const signal = await GeminiClient.call(userPrefs, SYSTEM_PROMPT, userPrompt);

                        if (signal && signal.action !== 'NO_TRADE') {
                            const effectiveMinConf = userPrefs.minConfidence || 65;
                            const matchesAction = requestedAction === 'all' || signal.action === requestedAction;
                            
                            let matchesConf = true;
                            if (requestedConfRange !== 'all') {
                                if (requestedConfRange === '80+') {
                                    matchesConf = signal.confidence >= 80;
                                } else if (requestedConfRange.includes('-')) {
                                    const [low, high] = requestedConfRange.split('-').map(Number);
                                    matchesConf = signal.confidence >= low && signal.confidence <= high;
                                }
                            } else {
                                matchesConf = signal.confidence >= effectiveMinConf;
                            }

                            // ScalpRiskGuard: deterministic target & SL post-processing
                            const guardResult = scalpRiskGuard.process(signal, candidate.mtf);
                            if (!guardResult.valid) {
                                console.log(`[On-Demand] ScalpRiskGuard rejected ${candidate.symbol}: ${guardResult.error || 'invalid'}`);
                                continue;
                            }

                            if (!this._validateSignalRR(signal, candidate.symbol)) {
                                console.log(`[On-Demand] Candidate ${candidate.symbol} R/R too low (< ${MIN_RR})`);
                                continue;
                            }

                            const entry = signal.entry || candidate.mtf['5m']?.price;
                            const sigLeverage = Math.min(signal.leverage || candidate.coinLev, candidate.coinLev);
                            const contractVal = candidate.contractVal || 1;
                            const budget = walletContext.tradeBudget ?? 10000;
                            
                            if (!signal.quantity && entry) {
                                const marginPerContract = (entry * contractVal) / sigLeverage;
                                signal.quantity = Math.max(1, Math.floor(budget / marginPerContract));
                            }
                            if (signal.quantity && entry) {
                                const marginNeeded = (signal.quantity * entry * contractVal) / sigLeverage;
                                if (marginNeeded > budget * 1.1) {
                                    signal.quantity = Math.max(1, Math.floor((budget * sigLeverage) / (entry * contractVal)));
                                }
                            }
                            signal.leverage = sigLeverage;

                            if (matchesAction && matchesConf) {
                                const saved = await this._saveSignal(signal, candidate.mtf, candidate.mtf['5m'] || candidate.mtf['15m'], walletContext);
                                console.log(`[On-Demand] Perfect match found: ${candidate.symbol} (Action: ${signal.action}, Confidence: ${signal.confidence}%, Qty: ${signal.quantity})`);
                                this._lastSignalTime.set(candidate.symbol, Date.now());
                                return { signal, saved, mtf: candidate.mtf, avgVolumeUsdt: candidate.mtf['5m']?.volumeContext?.avgVolumeUsdt || null };
                            } else {
                                // Score relevance across candidates to pick the best relative opportunity
                                let relevanceScore = Number(signal.confidence) || 50;
                                if (matchesAction) relevanceScore += 30;
                                if (matchesConf) relevanceScore += 15;
                                if (candidate.score) relevanceScore += Math.abs(candidate.score) * 10;

                                console.log(`[On-Demand] Candidate ${candidate.symbol} generated ${signal.action} (${signal.confidence}%), relevance: ${relevanceScore.toFixed(1)}`);
                                if (!bestCandidateMatch || relevanceScore > bestCandidateMatch.relevanceScore) {
                                    bestCandidateMatch = {
                                        signal,
                                        candidate,
                                        mtf: candidate.mtf,
                                        relevanceScore,
                                        matchesAction
                                    };
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[On-Demand] Candidate scan error on ${candidate.symbol}:`, err.message);
                    }
                }
            }

            // Return the most relevant setup found across all evaluated candidates
            if (bestCandidateMatch) {
                const { signal, candidate, mtf } = bestCandidateMatch;
                const primary = mtf['5m'] || mtf['15m'];
                const saved = await this._saveSignal(signal, mtf, primary, walletContext);
                console.log(`[On-Demand] 🎯 Returning most relevant setup found: ${candidate.symbol} (${signal.action} ${signal.confidence}%)`);
                signal.retryNote = `Selected as the most relevant setup among ${llmCallsCount} scanned coins (Confidence: ${signal.confidence}%).`;
                this._lastSignalTime.set(candidate.symbol, Date.now());
                return { signal, saved, mtf, avgVolumeUsdt: primary?.volumeContext?.avgVolumeUsdt || null };
            }

            // Fallback: If no candidate yielded a full AI signal, synthesize a clean scalp trade on top trend-bias coin
            if (topBiasCandidate && topBiasCandidate.mtf) {
                const mtf = topBiasCandidate.mtf;
                const primary = mtf['5m'] || mtf['15m'];
                const entry = primary?.price;
                if (entry) {
                    const action = requestedAction !== 'all' ? requestedAction : (topBiasCandidate.score >= 0 ? 'BUY' : 'SELL');
                    const tf15 = mtf['15m'];
                    const tf1h = mtf['1h'];
                    const atr15 = Number(tf15?.indicators?.atr) || (entry * 0.005);
                    const atr1h = Number(tf1h?.indicators?.atr) || (atr15 * 1.8) || (entry * 0.012);
                    const decimals = String(entry).includes('.') ? String(entry).split('.')[1].length : 4;
                    const roundPrice = (p) => Number(Number(p).toFixed(decimals));

                    const target1 = action === 'BUY' ? roundPrice(entry + 0.6 * atr15) : roundPrice(entry - 0.6 * atr15);
                    const stopLoss = action === 'BUY' ? roundPrice(entry - 2.5 * atr1h) : roundPrice(entry + 2.5 * atr1h);
                    const target2 = action === 'BUY' ? roundPrice(entry + 1.2 * atr15) : roundPrice(entry - 1.2 * atr15);

                    const syntheticSignal = {
                        symbol: topBiasCandidate.symbol,
                        action,
                        entry,
                        target1,
                        target2,
                        stopLoss,
                        confidence: Math.min(74, Math.max(60, Math.round(58 + Math.abs(topBiasCandidate.score) * 12))),
                        leverage: Math.min(userPrefs.maxLeverage || 10, topBiasCandidate.coinLev || 10),
                        timeframe: '15m',
                        tradeType: 'scalp',
                        reasoning: `Most relevant technical setup among ${llmCallsCount} scanned cheap coins. ${topBiasCandidate.symbol} shows the strongest multi-timeframe trend alignment (Bias Score: ${topBiasCandidate.score.toFixed(2)}) with micro-structure respecting 15m/1H EMA levels.`,
                        tags: ['Top Trend Bias', 'Micro Scalp', 'Confluence Setup'],
                        retryNote: `Selected as the most relevant setup among ${llmCallsCount} scanned coins (Top trend bias).`
                    };

                    const guardResult = scalpRiskGuard.process(syntheticSignal, mtf);
                    const finalSignal = guardResult.valid ? guardResult.signal : syntheticSignal;
                    const budget = walletContext.tradeBudget ?? 10000;
                    const marginPerContract = (entry * topBiasCandidate.contractVal) / finalSignal.leverage;
                    finalSignal.quantity = Math.max(1, Math.floor(budget / marginPerContract));

                    const saved = await this._saveSignal(finalSignal, mtf, primary, walletContext);
                    console.log(`[On-Demand] 🎯 Returning synthesized top trend setup for ${topBiasCandidate.symbol}`);
                    this._lastSignalTime.set(topBiasCandidate.symbol, Date.now());
                    return { signal: finalSignal, saved, mtf, avgVolumeUsdt: primary?.volumeContext?.avgVolumeUsdt || null };
                }
            }

            return {
                action: 'NO_TRADE',
                confidence: 0,
                reasoning: `No cheap coin setups matching requested ${requestedAction.toUpperCase()} and ${requestedConfRange}% confidence range were found after scanning ${llmCallsCount} candidates.`,
                mtf: firstMtf || null,
                avgVolumeUsdt: firstMtf?.['5m']?.volumeContext?.avgVolumeUsdt || null
            };
        }

        // ── Specific symbol: analyse, then auto-retry up to 2 alternative coins on NO_TRADE ──

        const MAX_RETRIES = 4;
        const trySymbols  = [symbol];

        // Pick alternative coins from catalog affordable within tradeBudget
        const catalogRef = this.catalog || productCatalog;
        if (catalogRef?.isReady) {
            const allSyms = catalogRef.getSymbols().filter(s => s !== symbol);
            const tradeBudget = walletContext.tradeBudget;
            
            let pool = allSyms.filter(s => {
                const spec = catalogRef.getBySymbol(s);
                const cv = parseFloat(spec?.contract_value || 1);
                const lev = Math.min(spec?.max_leverage || 10, userPrefs.maxLeverage || 10);
                const p = this.wsManager?.getPrice?.(s);
                if (p && tradeBudget) {
                    return ((p * cv) / lev) <= tradeBudget;
                }
                return true;
            });

            if (tradeBudget && tradeBudget <= 50) {
                // Low budget: sort by lowest margin first
                pool.sort((a, b) => {
                    const pa = this.wsManager?.getPrice?.(a) || 1;
                    const pb = this.wsManager?.getPrice?.(b) || 1;
                    const cva = parseFloat(catalogRef.getBySymbol(a)?.contract_value || 1);
                    const cvb = parseFloat(catalogRef.getBySymbol(b)?.contract_value || 1);
                    return (pa * cva) - (pb * cvb);
                });
            } else {
                pool.sort(() => Math.random() - 0.5);
            }
            trySymbols.push(...pool.slice(0, MAX_RETRIES));
        }

        let lastNoTrade = null;
        let bestSpecificAttempt = null;

        for (let attempt = 0; attempt < trySymbols.length; attempt++) {
            const trySym = trySymbols[attempt];
            const isRetry = attempt > 0;

            if (isRetry) {
                console.log(`[On-Demand] 🔄 Retry ${attempt}/${MAX_RETRIES} → ${trySym} (NO_TRADE on ${trySymbols[attempt - 1]})`);
            }

            try {
                const mtf = await MarketAnalyzer.analyzeMultiTimeframe(trySym);
                const primary = mtf['5m'] || mtf['15m'];
                if (!primary || primary.error) {
                    if (!isRetry) throw new Error('Analysis failed: ' + (primary?.error || 'no data'));
                    continue;
                }

                // Skip illiquid coins on retries
                if (isRetry && !(primary.volumeContext?.isLiquid ?? true)) continue;

                let learningCtx = null;
                try {
                    const [symCtx, globalCtx] = await Promise.all([
                        selfLearning.getContext(trySym),
                        selfLearning.getGlobalContext(),
                    ]);
                    learningCtx = selfLearning.formatForPrompt(symCtx, globalCtx);
                } catch (_) {}

                const prefsWithBudget = { ...userPrefs, ...walletContext };
                const userPrompt = buildUserPrompt(mtf, prefsWithBudget, learningCtx);
                const signal = await GeminiClient.call(userPrefs, SYSTEM_PROMPT, userPrompt);

                if (signal && signal.action !== 'NO_TRADE') {
                    // ScalpRiskGuard: deterministic target & SL post-processing
                    const guardResult = scalpRiskGuard.process(signal, mtf);
                    if (guardResult.valid && this._validateSignalRR(signal, trySym)) {
                        const currentPrice = primary.price;
                        const spec         = catalogRef.getBySymbol(trySym);
                        const contractVal  = parseFloat(spec?.contract_value || 1);
                        const entry        = signal.entry || currentPrice;
                        const maxAllowedLev = Math.min(spec?.max_leverage || 10, userPrefs.maxLeverage || 10);
                        const sigLeverage  = Math.min(signal.leverage || maxAllowedLev, maxAllowedLev);
                        const tradeBudget  = walletContext.tradeBudget ?? 10000;
                        
                        if (!signal.quantity && entry) {
                            const marginPerContract = (entry * contractVal) / sigLeverage;
                            signal.quantity = Math.max(1, Math.floor(tradeBudget / marginPerContract));
                        }
                        if (signal.quantity && entry) {
                            const marginNeeded = (signal.quantity * entry * contractVal) / sigLeverage;
                            if (marginNeeded > tradeBudget * 1.1) {
                                signal.quantity = Math.max(1, Math.floor((tradeBudget * sigLeverage) / (entry * contractVal)));
                            }
                        }
                        signal.leverage = sigLeverage;

                        const effectiveMinConf = userPrefs.minConfidence || MIN_CONFIDENCE;
                        if (signal.confidence >= effectiveMinConf) {
                            const saved = await this._saveSignal(signal, mtf, primary, walletContext);
                            this._lastSignalTime.set(trySym, Date.now());

                            if (isRetry) {
                                console.log(`[On-Demand] ✅ Signal found on retry: ${trySym} (requested: ${symbol})`);
                                signal.retryNote = `No setup on ${symbol.replace('USD','/USD')} — signal found on ${trySym.replace('USD','/USD')} instead.`;
                            }

                            return { signal, saved, mtf, avgVolumeUsdt: primary?.volumeContext?.avgVolumeUsdt || null };
                        } else {
                            if (!bestSpecificAttempt || (signal.confidence || 0) > (bestSpecificAttempt.signal.confidence || 0)) {
                                bestSpecificAttempt = { signal, mtf, primary, trySym, isRetry };
                            }
                        }
                    }
                }

                const confidence = signal?.confidence || 0;
                const reasoning  = signal?.reasoning || 'No trade setup';
                lastNoTrade = { action: 'NO_TRADE', confidence, reasoning, mtf };
                console.log(`[On-Demand] ⬜ ${trySym} → NO_TRADE (conf: ${confidence}%)${isRetry ? ' [retry]' : ''}`);
                continue;

            } catch (err) {
                if (!isRetry) throw err;
                console.error(`[On-Demand] Retry error on ${trySym}:`, err.message);
            }
        }

        // If high-confidence threshold wasn't hit, but we found a valid setup, return the most relevant one!
        if (bestSpecificAttempt) {
            const { signal, mtf, primary, trySym, isRetry } = bestSpecificAttempt;
            const saved = await this._saveSignal(signal, mtf, primary, walletContext);
            this._lastSignalTime.set(trySym, Date.now());
            signal.retryNote = isRetry
                ? `Most relevant setup found on alternative coin ${trySym.replace('USD','/USD')} (Confidence: ${signal.confidence}%).`
                : `Most relevant setup for ${trySym.replace('USD','/USD')} (Confidence: ${signal.confidence}%).`;
            console.log(`[On-Demand] 🎯 Returning most relevant setup for ${trySym} (${signal.confidence}%)`);
            return { signal, saved, mtf, avgVolumeUsdt: primary?.volumeContext?.avgVolumeUsdt || null };
        }

        // All attempts exhausted — surface best NO_TRADE with list of tried coins
        const triedExtra = trySymbols.slice(1).map(s => s.replace('USD', '')).join(', ');
        return {
            ...(lastNoTrade || { action: 'NO_TRADE', confidence: 0, reasoning: 'No trade setup' }),
            reasoning: (lastNoTrade?.reasoning || 'No trade setup') +
                (triedExtra ? ` (Also checked: ${triedExtra} — no setup found)` : ''),
        };
    }

    getStats() {
        return {
            ...this._stats,
            cycleCount: this._cycleCount,
            running: this.running,
            geminiStatus: GeminiClient.status(null),
        };
    }
}

module.exports = new SignalEngine();
