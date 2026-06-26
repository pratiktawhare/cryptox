/**
 * GeminiClient.js
 *
 * Wraps the Google Gemini API (gemini-2.0-flash) for structured JSON trade signal output.
 * Uses the @google/generative-ai SDK.
 *
 * Features:
 *   - Strict JSON output mode (responseMimeType: application/json)
 *   - Retry with exponential backoff on rate limit errors
 *   - Per-minute rate limiting (max 15 RPM on free tier)
 *   - Input/output token tracking
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config/env');

const MODEL_NAME = 'gemini-3.5-flash';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

// Simple rate limiter: track request timestamps
const requestLog = [];
const RATE_WINDOW_MS = 60_000;
const MAX_RPM = 14; // stay under free-tier limit

class GeminiClient {
    constructor() {
        if (!config.geminiApiKey) {
            console.warn('[Gemini] ⚠️  GEMINI_API_KEY not set — signals will be mocked');
            this.mock = true;
            return;
        }
        this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
        this.mock = false;
        console.log('[Gemini] ✅ Client initialized with model:', MODEL_NAME);
    }

    // ─── Rate limit check ──────────────────────────────────────────────────────

    _canRequest() {
        const now = Date.now();
        // Clean up old timestamps
        while (requestLog.length > 0 && requestLog[0] < now - RATE_WINDOW_MS) {
            requestLog.shift();
        }
        return requestLog.length < MAX_RPM;
    }

    _recordRequest() {
        requestLog.push(Date.now());
    }

    /**
     * Send a structured prompt to Gemini and parse the JSON response.
     * Uses generateContent with systemInstruction (required for responseMimeType JSON mode).
     * @param {string} systemPrompt
     * @param {string} userPrompt
     * @returns {object} parsed JSON response
     */
    async call(systemPrompt, userPrompt) {
        if (this.mock) {
            return this._mockSignal();
        }

        // Rate limit guard
        if (!this._canRequest()) {
            const waitMs = RATE_WINDOW_MS - (Date.now() - requestLog[0]);
            console.warn(`[Gemini] Rate limit hit. Waiting ${(waitMs / 1000).toFixed(1)}s…`);
            await new Promise(r => setTimeout(r, waitMs + 100));
        }

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                this._recordRequest();

                // Build a model instance with systemInstruction for this call.
                // This is required for responseMimeType to work correctly.
                const model = this.genAI.getGenerativeModel({
                    model: MODEL_NAME,
                    systemInstruction: systemPrompt,
                    generationConfig: {
                        temperature:      0.15,
                        topP:             0.8,
                        maxOutputTokens:  2048,
                        responseMimeType: 'application/json',
                    },
                });

                const result = await model.generateContent(userPrompt);
                const rawText = result.response.text();

                // ── Multi-strategy JSON extraction ──
                const parsed = this._extractJSON(rawText);
                if (!parsed) {
                    console.error('[Gemini] Raw response (no JSON found):', rawText.slice(0, 300));
                    throw new SyntaxError('Could not extract valid JSON from response');
                }

                // Ensure required fields have safe defaults so DB validation never fails
                const safe = {
                    action:     parsed.action     || 'NO_TRADE',
                    confidence: parsed.confidence ?? 0,
                    reasoning:  parsed.reasoning  || '',
                    ...parsed,
                };

                return {
                    ...safe,
                    _meta: {
                        model:      MODEL_NAME,
                        timestamp:  Date.now(),
                        tokenCount: result.response.usageMetadata?.totalTokenCount ?? null,
                    },
                };

            } catch (err) {
                const isRateLimit = err.status === 429 || err.message?.includes('429');
                const isRetryable = isRateLimit || err.message?.includes('UNAVAILABLE');

                if (isRetryable && attempt < MAX_RETRIES) {
                    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    console.warn(`[Gemini] Attempt ${attempt} failed (${err.message}). Retrying in ${delay}ms…`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                if (err.message?.includes('JSON') || err.message?.includes('SyntaxError')) {
                    console.error('[Gemini] JSON parse error:', err.message);
                    return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI response parse error', _error: err.message };
                }

                console.error('[Gemini] API error:', err.message);
                return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI API error: ' + err.message, _error: err.message };
            }
        }

        return { action: 'NO_TRADE', confidence: 0, reasoning: 'Max retries exceeded', _error: 'max_retries' };
    }


    // ─── JSON extractor ────────────────────────────────────────────────────────

    /**
     * Robustly extract a JSON object from Gemini's raw text output.
     * Handles: markdown code fences, trailing text, truncated JSON, comments.
     */
    _extractJSON(raw) {
        if (!raw || typeof raw !== 'string') return null;

        // Strategy 1: Strip markdown fences and parse directly
        let cleaned = raw.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        try { return JSON.parse(cleaned); } catch (_) {}

        // Strategy 2: Find the first complete {...} block
        const start = cleaned.indexOf('{');
        if (start !== -1) {
            // Walk forward, tracking brace depth
            let depth = 0;
            let inStr  = false;
            let escape = false;
            for (let i = start; i < cleaned.length; i++) {
                const ch = cleaned[i];
                if (escape)          { escape = false; continue; }
                if (ch === '\\')     { escape = true;  continue; }
                if (ch === '"')      { inStr = !inStr; continue; }
                if (inStr)           continue;
                if (ch === '{')      depth++;
                else if (ch === '}') { depth--; if (depth === 0) {
                    try { return JSON.parse(cleaned.slice(start, i + 1)); } catch (_) {}
                    break;
                }}
            }
        }

        // Strategy 3: Auto-repair truncated JSON (add closing braces)
        if (start !== -1) {
            let partial = cleaned.slice(start);

            // Strategy 3.5: Remove dangling partial number/value at end
            // e.g. '"target2": 0.'  or  '"key": ' with no value
            partial = partial
                // Remove trailing partial decimal like: 0. or 123.
                .replace(/:\s*\d+\.\s*$/, ': 0')
                // Remove trailing partial key-value with no value: "key":
                .replace(/,?\s*"[^"]*"\s*:\s*$/, '')
                // Remove trailing comma before close
                .replace(/,\s*$/, '');

            // Count unclosed braces/brackets
            let braces = 0, brackets = 0, inStr2 = false, esc2 = false;
            for (const ch of partial) {
                if (esc2)        { esc2 = false; continue; }
                if (ch === '\\') { esc2 = true;  continue; }
                if (ch === '"')  { inStr2 = !inStr2; continue; }
                if (inStr2)      continue;
                if (ch === '{')  braces++;
                else if (ch === '}') braces--;
                else if (ch === '[') brackets++;
                else if (ch === ']') brackets--;
            }
            // Close any open string first
            if (inStr2) partial += '"';
            // Close open brackets / braces
            partial += ']'.repeat(Math.max(0, brackets)) + '}'.repeat(Math.max(0, braces));
            try { return JSON.parse(partial); } catch (_) {}
        }

        return null;
    }

    // ─── Mock (when no API key) ────────────────────────────────────────────────

    _mockSignal() {
        const actions = ['BUY', 'SELL', 'NO_TRADE', 'NO_TRADE'];
        const action  = actions[Math.floor(Math.random() * actions.length)];
        return {
            action,
            symbol: 'BTCUSD',
            entry: null,
            stopLoss: null,
            target1: null,
            target2: null,
            leverage: action !== 'NO_TRADE' ? 3 : null,
            quantity: action !== 'NO_TRADE' ? 1 : null,
            confidence: action !== 'NO_TRADE' ? Math.floor(60 + Math.random() * 30) : 30,
            riskReward: action !== 'NO_TRADE' ? 2.5 : null,
            timeframe: '5m',
            reasoning: '[MOCK] Gemini API key not configured. This is a simulated signal for testing.',
            smcContext: 'Mock SMC context.',
            invalidationLevel: null,
            tradeType: 'scalp',
            tags: ['mock'],
            _mock: true,
        };
    }

    // ─── Status ───────────────────────────────────────────────────────────────

    status() {
        const now = Date.now();
        const recent = requestLog.filter(t => t > now - RATE_WINDOW_MS).length;
        return {
            model: MODEL_NAME,
            mock:  this.mock,
            requestsInLastMinute: recent,
            remainingRpm: MAX_RPM - recent,
        };
    }
}

module.exports = new GeminiClient();
