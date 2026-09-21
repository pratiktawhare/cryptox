/**
 * AiRegimeAnalyzer.js
 *
 * Periodic 30-minute macro market regime analyzer powered by Groq LLM.
 *
 * Analyzes market leaders (BTC, ETH, SOL) and market breadth indicators,
 * then queries Groq for:
 *   - Macro regime classification (TRENDING_UP, TRENDING_DOWN, RANGING, HIGH_VOLATILITY, UNCERTAIN)
 *   - Confidence level (0–100)
 *   - Risk adjustment factor (0.1 to 1.0)
 *
 * The risk adjustment factor dynamically tightens the technical entry criteria
 * (e.g. riskAdjustment 0.5 raises minimum score requirement in choppy conditions).
 *
 * 100% Fail-Safe:
 *   - Non-blocking. If Groq is disabled, offline, or rate-limited,
 *     falls back immediately to neutral riskAdjustment = 1.0 without interrupting the bot.
 */

const groqClient = require('../ai/GroqClient');
const UserPreferences = require('../../models/UserPreferences');
const BotEvent = require('../../models/BotEvent');
const candleStore = require('./CandleStore');
const { analyzeSymbol } = require('./MarketAnalyzer');
const productCatalog = require('../ProductCatalog');

const REGIME_SYSTEM_PROMPT = `You are an elite quantitative crypto risk manager and market regime specialist.
Your role is to analyze multi-coin market telemetry across benchmark assets (BTC, ETH, SOL) and overall market breadth to classify the macro market regime.

Return STRICT RFC-8259 JSON with no markdown formatting and no conversational prelude.
JSON schema:
{
  "marketRegime": "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "HIGH_VOLATILITY" | "UNCERTAIN",
  "confidence": <integer between 0 and 100>,
  "riskAdjustment": <float between 0.25 and 1.0>, // 1.0 = optimal conditions, 0.75 = minor caution, 0.5 = choppy/reduce risk, 0.25 = extreme volatility/chop
  "reasoning": "<concise 1-2 sentence rationale>"
}`;

class AiRegimeAnalyzer {
    constructor() {
        this.lastAnalysis = null;
        this.isRunning = false;
        this.isAnalyzing = false;
        this.timer = null;
        this.intervalMs = 30 * 60 * 1000; // 30 minutes
        this.wsManager = null;
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start(wsManager = null, intervalSeconds = 1800) {
        if (this.isRunning) return;

        this.wsManager = wsManager;
        this.intervalMs = (intervalSeconds || 1800) * 1000;
        this.isRunning = true;

        console.log(`[AiRegimeAnalyzer] 🧠 Started — analyzing macro regime every ${this.intervalMs / 60000}m`);

        // Run initial analysis after 10s warmup
        setTimeout(() => {
            if (this.isRunning) {
                this.analyze().catch(err => {
                    console.warn('[AiRegimeAnalyzer] Initial regime analysis error:', err.message);
                });
            }
        }, 10_000);

        this.timer = setInterval(() => {
            if (this.isRunning) {
                this.analyze().catch(err => {
                    console.warn('[AiRegimeAnalyzer] Scheduled regime analysis error:', err.message);
                });
            }
        }, this.intervalMs);
    }

    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        console.log('[AiRegimeAnalyzer] Stopped');
    }

    // ─── Analysis Logic ────────────────────────────────────────────────────────

    /**
     * Run macro regime analysis via Groq.
     *
     * @param {boolean} [force=false]
     * @returns {Promise<object>}
     */
    async analyze(force = false) {
        // Return cached if fresh (less than 15 mins old) and not forced
        if (!force && this.lastAnalysis && Date.now() - this.lastAnalysis.timestamp.getTime() < 15 * 60 * 1000) {
            return this.lastAnalysis;
        }

        if (this.isAnalyzing) {
            return this.getLastAnalysis();
        }

        this.isAnalyzing = true;
        console.log('[AiRegimeAnalyzer] 🧠 Running macro market regime analysis...');

        try {
            // 1. Gather benchmark asset telemetry (BTC, ETH, SOL)
            const benchmarks = ['BTCUSD', 'ETHUSD', 'SOLUSD'];
            const telemetry = [];

            for (const sym of benchmarks) {
                await candleStore.ensureCandles(sym, '5m', 40);
                await candleStore.ensureCandles(sym, '1m', 30);
                const snap = analyzeSymbol(sym, this.wsManager);
                if (snap) {
                    telemetry.push({
                        symbol: sym,
                        price: snap.close,
                        trend5m: snap['5m'].ema9 > snap['5m'].ema21 ? 'BULLISH' : 'BEARISH',
                        ema21Slope5m: snap['5m'].ema21Slope > 0 ? 'POSITIVE' : 'NEGATIVE',
                        rsi5m: snap['5m'].rsi ? Number(snap['5m'].rsi.toFixed(1)) : null,
                        atrPct5m: snap['5m'].atrPct ? Number(snap['5m'].atrPct.toFixed(3)) : null,
                        trend1m: snap['1m'].ema9 > snap['1m'].ema21 ? 'BULLISH' : 'BEARISH',
                    });
                }
            }

            // 2. Load user Groq key pool if configured
            let customKeys = null;
            try {
                const prefs = await UserPreferences.findOne({}).sort({ updatedAt: -1 });
                if (prefs?.groqKeyPool?.keys?.length > 0) {
                    customKeys = prefs.groqKeyPool;
                }
            } catch (prefErr) {
                // Ignore DB error, will use default system key
            }

            // If no benchmark telemetry available, return fallback
            if (telemetry.length === 0) {
                console.warn('[AiRegimeAnalyzer] No benchmark candle telemetry available yet. Using neutral fallback.');
                return this._fallback('Insufficient benchmark market data');
            }

            // 3. Build user prompt
            const userPrompt = `Benchmark Telemetry (Current 5m / 1m readings):
${JSON.stringify(telemetry, null, 2)}

Task:
Synthesize the benchmark alignment across BTC, ETH, and SOL.
Determine the macro market regime and return the JSON object.`;

            // 4. Call Groq
            const resp = await groqClient.call(REGIME_SYSTEM_PROMPT, userPrompt, customKeys);

            if (resp && resp.marketRegime) {
                const validRegimes = ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'HIGH_VOLATILITY', 'UNCERTAIN'];
                const regime = validRegimes.includes(resp.marketRegime) ? resp.marketRegime : 'UNCERTAIN';
                const confidence = Math.min(Math.max(parseInt(resp.confidence) || 50, 0), 100);
                const riskAdjustment = Math.min(Math.max(parseFloat(resp.riskAdjustment) || 1.0, 0.25), 1.0);

                this.lastAnalysis = {
                    marketRegime: regime,
                    confidence,
                    riskAdjustment,
                    reasoning: resp.reasoning || 'Regime classified by AI model',
                    timestamp: new Date(),
                    isFallback: false,
                };

                console.log(`[AiRegimeAnalyzer] ✅ Groq Regime: ${regime} (${confidence}% conf, riskAdj: ${riskAdjustment}) — "${this.lastAnalysis.reasoning}"`);
                return this.lastAnalysis;
            }

            return this._fallback(resp?.reasoning || 'Invalid AI response format');

        } catch (err) {
            console.error('[AiRegimeAnalyzer] ❌ AI analysis error:', err.message);
            return this._fallback(err.message);
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Get current regime analysis or neutral fallback.
     */
    getLastAnalysis() {
        if (this.lastAnalysis) {
            return this.lastAnalysis;
        }
        return this._fallback('Awaiting first AI analysis cycle');
    }

    _fallback(reason = 'Neutral fallback') {
        return {
            marketRegime: null,
            confidence: 50,
            riskAdjustment: 1.0,
            reasoning: reason,
            timestamp: new Date(),
            isFallback: true,
        };
    }
}

module.exports = new AiRegimeAnalyzer();
