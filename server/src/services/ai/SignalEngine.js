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

// Configuration
const CYCLE_INTERVAL_MS   = 5 * 60 * 1000;  // 5 minutes per cycle
const COINS_PER_CYCLE     = 20;              // Coins scanned per cycle
const GEMINI_CALL_DELAY   = 4000;            // 4s between Gemini calls → max ~15 RPM
const MIN_BIAS_SCORE      = 0.10;            // Minimum bias score to call Gemini
const MIN_SIGNAL_GAP_MS   = 15 * 60 * 1000; // 15 min gap between signals per coin
const MIN_CONFIDENCE      = 55;              // Minimum confidence to emit signal

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
                UserPreferences.findOne({}).lean(),
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
            const currentPrice  = primary.price;
            const leverage      = userPrefs.maxLeverage || 10;
            const tradeBudget   = walletContext.tradeBudget ?? 10000;
            const marginFor1    = currentPrice / leverage; // margin needed for 1 contract
            if (marginFor1 > tradeBudget) {
                // Too expensive — quietly skip (don't even waste bias computation)
                return;
            }

            // Step 2b: Pre-filter — only call Gemini for strong-bias setups
            const biasScore = mtf.mtfBias?.score ?? 0;
            if (Math.abs(biasScore) < MIN_BIAS_SCORE) return;

            console.log(`[SignalEngine] 🔍 ${symbol} @ $${currentPrice} | margin/contract: $${marginFor1.toFixed(2)} | budget: $${tradeBudget} | bias: ${biasScore.toFixed(2)}`);


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
            if (signal.confidence < MIN_CONFIDENCE) {
                console.log(`[SignalEngine] ⬜ ${symbol} → Low confidence: ${signal.confidence}% < ${MIN_CONFIDENCE}%`);
                return true; // Gemini was called
            }

            // Step 6: Auto-calculate recommended quantity from budget if Gemini didn't set one
            const entry = signal.entry || currentPrice;
            // Use Gemini's suggested leverage if within user's max, else fall back to Step 2a value
            const sigLeverage = Math.min(signal.leverage || leverage, leverage);
            if (!signal.quantity && entry) {
                const marginPerContract = entry / sigLeverage;
                signal.quantity = Math.max(1, Math.floor(tradeBudget / marginPerContract));
            }
            // Cap quantity so margin never exceeds tradeBudget
            if (signal.quantity && entry) {
                const marginNeeded = (signal.quantity * entry) / sigLeverage;
                if (marginNeeded > tradeBudget * 1.1) {
                    signal.quantity = Math.max(1, Math.floor((tradeBudget * sigLeverage) / entry));
                }
            }
            signal.leverage = sigLeverage;

            await this._saveSignal(signal, mtf, primary, walletContext);
            this._lastSignalTime.set(symbol, Date.now());
            return true; // Gemini was called

        } catch (err) {
            this._stats.errors++;
            if (!err.message?.includes('Insufficient')) {
                console.error(`[SignalEngine] Error on ${symbol}:`, err.message);
            }
        }
        return false;
    }


    // ─── Signal persistence ────────────────────────────────────────────────────

    async _saveSignal(signal, mtf, primary, walletContext = {}) {
        const ind = primary.indicators;
        const smc = primary.smc;
        const estimatedMargin = signal.entry && signal.quantity
            ? ((signal.quantity * signal.entry) / (signal.leverage || 10)).toFixed(2)
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
        const productCatalog = this.catalog;
        const wsManager = this.wsManager;

        if (symbol === 'RANDOM' || symbol === 'CHEAP') {
            if (!productCatalog?.isReady) {
                throw new Error('Product catalog is not ready');
            }
            const allSymbols = productCatalog.getSymbols();
            const cheapCoins = allSymbols.filter(s => {
                if (s === 'BTCUSD' || s === 'ETHUSD') return false;
                const price = wsManager ? wsManager.getPrice(s) : null;
                if (price !== null) return price < 200;
                return true;
            });

            if (cheapCoins.length === 0) {
                throw new Error('No cheap coins found in catalog');
            }

            const requestedAction = walletContext.requestedAction || 'all';
            const requestedConfRange = walletContext.requestedConfRange || 'all';

            console.log(`[On-Demand] Starting cheap coin search. Filter: Action = ${requestedAction}, Confidence Range = ${requestedConfRange}`);

            // Shuffle cheapCoins to keep the scan random/fresh
            const shuffledCheap = [...cheapCoins].sort(() => Math.random() - 0.5);
            
            let fallbackSignal = null;
            let llmCallsCount = 0;
            const maxLlmCalls = 10;
            const batchSize = 15;

            let firstMtf = null; // To use as a fallback mtf context if no trade is found

            for (let startIdx = 0; startIdx < shuffledCheap.length; startIdx += batchSize) {
                if (llmCallsCount >= maxLlmCalls) {
                    console.log(`[On-Demand] Reached max LLM calls limit of ${maxLlmCalls}. Stopping search.`);
                    break;
                }
                
                const batchSymbols = shuffledCheap.slice(startIdx, startIdx + batchSize);
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
                            // Check liquidity/volume (skip if coin is staying still / illiquid)
                            const isLiquid = primary.volumeContext?.isLiquid ?? true;
                            if (!isLiquid) {
                                console.log(`[On-Demand] Skipping illiquid/dead coin: ${batchSymbols[j]} (Avg Vol USDT: $${primary.volumeContext?.avgVolumeUsdt}, Zero Vol Pct: ${(primary.volumeContext?.zeroVolumePct * 100).toFixed(1)}%)`);
                                continue;
                            }

                            const score = mtf.mtfBias?.score ?? 0;
                            batchCandidates.push({ symbol: batchSymbols[j], score, mtf });
                            if (!firstMtf) {
                                firstMtf = mtf;
                            }
                        }
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
                    
                    console.log(`[On-Demand] LLM Call #${llmCallsCount+1}/${maxLlmCalls} for: ${candidate.symbol} (Bias Score: ${candidate.score.toFixed(2)})`);
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
                            const matchesAction = requestedAction === 'all' || signal.action === requestedAction;
                            
                            let matchesConf = true;
                            if (requestedConfRange !== 'all') {
                                if (requestedConfRange === '80+') {
                                    matchesConf = signal.confidence >= 80;
                                } else if (requestedConfRange.includes('-')) {
                                    const [low, high] = requestedConfRange.split('-').map(Number);
                                    matchesConf = signal.confidence >= low && signal.confidence <= high;
                                }
                            }

                            if (matchesAction && matchesConf) {
                                const entry = signal.entry || candidate.mtf['5m']?.price;
                                const sigLeverage = Math.min(signal.leverage || userPrefs.maxLeverage || 10, userPrefs.maxLeverage || 10);
                                const tradeBudget = walletContext.tradeBudget ?? 10000;
                                
                                if (!signal.quantity && entry) {
                                    const marginPerContract = entry / sigLeverage;
                                    signal.quantity = Math.max(1, Math.floor(tradeBudget / marginPerContract));
                                }
                                if (signal.quantity && entry) {
                                    const marginNeeded = (signal.quantity * entry) / sigLeverage;
                                    if (marginNeeded > tradeBudget * 1.1) {
                                        signal.quantity = Math.max(1, Math.floor((tradeBudget * sigLeverage) / entry));
                                    }
                                }
                                signal.leverage = sigLeverage;

                                const saved = await this._saveSignal(signal, candidate.mtf, candidate.mtf['5m'] || candidate.mtf['15m'], walletContext);
                                console.log(`[On-Demand] Perfect match found: ${candidate.symbol} (Action: ${signal.action}, Confidence: ${signal.confidence}%)`);
                                this._lastSignalTime.set(candidate.symbol, Date.now());
                                return { signal, saved, mtf: candidate.mtf, avgVolumeUsdt: candidate.mtf['5m']?.volumeContext?.avgVolumeUsdt || null };
                            } else {
                                console.log(`[On-Demand] Candidate ${candidate.symbol} generated ${signal.action} (${signal.confidence}%), mismatch. Filter was Action: ${requestedAction}, Range: ${requestedConfRange}`);
                                if (!fallbackSignal) {
                                    fallbackSignal = { signal, mtf: candidate.mtf };
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[On-Demand] Candidate scan error on ${candidate.symbol}:`, err.message);
                    }
                }
            }

            // Only return a fallback if no specific filters were requested
            if (fallbackSignal && requestedAction === 'all' && requestedConfRange === 'all') {
                const { signal, mtf } = fallbackSignal;
                const primary = mtf['5m'] || mtf['15m'];
                const saved = await this._saveSignal(signal, mtf, primary, walletContext);
                console.log(`[On-Demand] Returning fallback setup for ${mtf.symbol}`);
                this._lastSignalTime.set(mtf.symbol, Date.now());
                return { signal, saved, mtf, avgVolumeUsdt: primary?.volumeContext?.avgVolumeUsdt || null };
            }

            return {
                action: 'NO_TRADE',
                confidence: 0,
                reasoning: `No cheap coin setups matching requested ${requestedAction.toUpperCase()} and ${requestedConfRange}% confidence range were found after scanning ${llmCallsCount} candidates.`,
                mtf: firstMtf || null,
                avgVolumeUsdt: firstMtf?.['5m']?.volumeContext?.avgVolumeUsdt || null
            };
        }

        const mtf = await MarketAnalyzer.analyzeMultiTimeframe(symbol);
        const primary = mtf['5m'] || mtf['15m'];
        if (!primary || primary.error) throw new Error('Analysis failed: ' + (primary?.error || 'no data'));

        let learningCtx = null;
        try {
            const [symCtx, globalCtx] = await Promise.all([
                selfLearning.getContext(symbol),
                selfLearning.getGlobalContext(),
            ]);
            learningCtx = selfLearning.formatForPrompt(symCtx, globalCtx);
        } catch (_) { /* skip */ }

        const prefsWithBudget = { ...userPrefs, ...walletContext };
        const userPrompt = buildUserPrompt(mtf, prefsWithBudget, learningCtx);
        const signal = await GeminiClient.call(userPrefs, SYSTEM_PROMPT, userPrompt);

        if (!signal || signal.action === 'NO_TRADE' || signal.confidence < MIN_CONFIDENCE) {
            const confidence = signal?.confidence || 0;
            const reasoning = signal?.reasoning || (signal && signal.confidence < MIN_CONFIDENCE 
                ? `Confidence (${signal.confidence}%) is below minimum threshold of ${MIN_CONFIDENCE}%.` 
                : 'No trade setup');
            return { action: 'NO_TRADE', confidence, reasoning, mtf };
        }

        const currentPrice = primary.price;
        const entry = signal.entry || currentPrice;
        const leverage = userPrefs.maxLeverage || 10;
        const tradeBudget = walletContext.tradeBudget ?? 10000;
        const sigLeverage = Math.min(signal.leverage || leverage, leverage);
        if (!signal.quantity && entry) {
            const marginPerContract = entry / sigLeverage;
            signal.quantity = Math.max(1, Math.floor(tradeBudget / marginPerContract));
        }
        if (signal.quantity && entry) {
            const marginNeeded = (signal.quantity * entry) / sigLeverage;
            if (marginNeeded > tradeBudget * 1.1) {
                signal.quantity = Math.max(1, Math.floor((tradeBudget * sigLeverage) / entry));
            }
        }
        signal.leverage = sigLeverage;

        const saved = await this._saveSignal(signal, mtf, primary, walletContext);
        this._lastSignalTime.set(symbol, Date.now());
        
        return { signal, saved, mtf, avgVolumeUsdt: primary?.volumeContext?.avgVolumeUsdt || null };
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
