/**
 * GroqClient.js
 *
 * Connects to the Groq API for structured JSON trade signal output.
 * Fully compatible with OpenAI chat completion spec.
 *
 * Auto-fallback: tries each model in FREE_TIER_MODELS in order.
 * If a model is deprecated/decommissioned, it silently moves to the next one.
 * The first working model is cached so future calls skip straight to it.
 *
 * To refresh the live model list:
 *   GET https://api.groq.com/openai/v1/models  (with your API key)
 */

const axios = require('axios');
const config = require('../../config/env');

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Prioritized list of free-tier Groq models.
 * Ordered by preference (best first). If the first fails due to deprecation,
 * the client automatically falls through to the next.
 */
const FREE_TIER_MODELS = [
    'openai/gpt-oss-120b',   // Primary: official replacement for llama-3.3-70b (Aug 2026)
    'qwen/qwen3.6-27b',      // Fallback 1: Alibaba Qwen, free tier, strong reasoning
    'qwen/qwen3.8-27b',      // Fallback 2: newer Qwen variant
    'openai/gpt-oss-20b',    // Fallback 3: lighter OpenAI OSS model
];

/**
 * Detects if an Axios error means the model is deprecated/decommissioned,
 * as opposed to a transient error (network, rate limit, etc.).
 */
function isModelUnavailableError(err) {
    const status  = err.response?.status;
    const errData = err.response?.data?.error;
    const code    = errData?.code  || '';
    const message = (errData?.message || err.message || '').toLowerCase();

    if (status === 404) return true;
    if (code === 'model_not_found') return true;
    if (status === 400 && (
        message.includes('decommission') ||
        message.includes('deprecated')   ||
        message.includes('not found')    ||
        message.includes('does not exist')
    )) return true;

    return false;
}

class GroqClient {
    constructor() {
        this.apiKey       = config.groqApiKey;
        this.mock         = !this.apiKey;
        this.activeModel  = null; // cached once a working model is found

        if (this.mock) {
            console.warn('[Groq] ⚠️  GROQ_API_KEY not set — signals will be mocked');
        } else {
            console.log('[Groq] ✅ Client initialized — will probe models:', FREE_TIER_MODELS.join(', '));
        }
    }

    /**
     * Send a structured prompt to Groq with automatic model fallback.
     * @param {string} systemPrompt
     * @param {string} userPrompt
     * @param {string} [customApiKey]
     * @returns {object} parsed JSON signal response
     */
    async call(systemPrompt, userPrompt, customApiKey = null) {
        const keyToUse = customApiKey || this.apiKey;
        if (!keyToUse) {
            return this._mockSignal();
        }

        // Build the list to try: cached active model first, then the rest
        const modelsToTry = this.activeModel
            ? [this.activeModel, ...FREE_TIER_MODELS.filter(m => m !== this.activeModel)]
            : [...FREE_TIER_MODELS];

        let lastError = null;

        for (const model of modelsToTry) {
            try {
                const result = await this._callModel(model, systemPrompt, userPrompt, keyToUse);

                // Cache this model if it's not already cached
                if (this.activeModel !== model) {
                    console.log(`[Groq] ✅ Active model set to: ${model}`);
                    this.activeModel = model;
                }

                return result;

            } catch (err) {
                if (isModelUnavailableError(err)) {
                    console.warn(`[Groq] ⚠️  Model "${model}" is unavailable/deprecated — trying next fallback...`);
                    // If this was our cached model, clear it so we probe from scratch next time
                    if (this.activeModel === model) {
                        this.activeModel = null;
                    }
                    lastError = err;
                    continue; // try next model
                }

                // Non-deprecation error (rate limit, network, JSON parse, etc.) — don't fallback
                console.error('[Groq] API error:', err.response?.data || err.message);
                const errMsg = err.response?.data?.error?.message || err.message;
                if (err instanceof SyntaxError || err.message?.includes('JSON') || err.message?.includes('SyntaxError')) {
                    return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI response parse error: ' + errMsg };
                }
                return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI API error: ' + errMsg };
            }
        }

        // All models exhausted
        console.error('[Groq] ❌ All models in fallback chain are unavailable.');
        const errMsg = lastError?.response?.data?.error?.message || lastError?.message || 'All models unavailable';
        return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI unavailable (all models deprecated): ' + errMsg };
    }

    /**
     * Makes a single API call to a specific model.
     * Throws on any error — caller handles retry/fallback logic.
     */
    async _callModel(model, systemPrompt, userPrompt, apiKey) {
        const response = await axios.post(
            API_URL,
            {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userPrompt   },
                ],
                temperature:     0.15,
                max_tokens:      2048,
                response_format: { type: 'json_object' }, // Forces JSON output
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type':  'application/json',
                },
                timeout: 25000, // 25s timeout
            }
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Empty response from Groq API');
        }

        let parsed;
        try {
            parsed = JSON.parse(content.trim());
        } catch (jsonErr) {
            console.error('[Groq] JSON Parse failed for content:', content);
            throw jsonErr;
        }

        // Ensure required fields have safe defaults
        const safe = {
            action:     parsed.action     || 'NO_TRADE',
            confidence: parsed.confidence ?? 0,
            reasoning:  parsed.reasoning  || '',
            ...parsed,
        };

        return {
            ...safe,
            _meta: {
                model,
                timestamp:  Date.now(),
                tokenCount: response.data?.usage?.total_tokens ?? null,
            },
        };
    }

    _mockSignal() {
        const actions = ['BUY', 'SELL', 'NO_TRADE', 'NO_TRADE'];
        const action  = actions[Math.floor(Math.random() * actions.length)];
        return {
            action,
            symbol:             'BTCUSD',
            entry:              null,
            stopLoss:           null,
            target1:            null,
            target2:            null,
            leverage:           action !== 'NO_TRADE' ? 3 : null,
            quantity:           action !== 'NO_TRADE' ? 1 : null,
            confidence:         action !== 'NO_TRADE' ? Math.floor(60 + Math.random() * 30) : 30,
            riskReward:         action !== 'NO_TRADE' ? 2.5 : null,
            timeframe:          '5m',
            reasoning:          '[MOCK] Groq API key not configured. This is a simulated signal for testing.',
            smcContext:         'Mock SMC context.',
            invalidationLevel:  null,
            tradeType:          'scalp',
            tags:               ['mock'],
            _mock:              true,
        };
    }

    status() {
        return {
            model:          this.activeModel || FREE_TIER_MODELS[0],
            activeModel:    this.activeModel,
            fallbackChain:  FREE_TIER_MODELS,
            mock:           this.mock,
        };
    }
}

module.exports = new GroqClient();
