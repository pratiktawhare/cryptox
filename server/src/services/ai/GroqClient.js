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
        this.apiKey            = config.groqApiKey;
        this.mock              = !this.apiKey;
        this.activeModel       = null; // cached once a working model is found
        this._currentKeyIndex  = 0;
        this._lastRotationAt   = Date.now();
        this._cooldowns        = new Map(); // keyString -> cooldown timestamp

        if (this.mock) {
            console.warn('[Groq] ⚠️  GROQ_API_KEY not set — signals will be mocked unless user keys are added');
        } else {
            console.log('[Groq] ✅ Client initialized — default model:', FREE_TIER_MODELS[0]);
        }
    }

    _resolveKeyPool(customKeyInput) {
        let keys = [];
        let rotationIntervalMin = 15;

        if (Array.isArray(customKeyInput)) {
            keys = customKeyInput.map((k, i) => typeof k === 'string' ? { key: k, nickname: `Key #${i + 1}` } : k);
        } else if (customKeyInput && typeof customKeyInput === 'object' && Array.isArray(customKeyInput.keys)) {
            keys = customKeyInput.keys;
            if (customKeyInput.rotationIntervalMin !== undefined) {
                rotationIntervalMin = customKeyInput.rotationIntervalMin;
            }
        } else if (typeof customKeyInput === 'string' && customKeyInput.trim()) {
            keys = [{ key: customKeyInput.trim(), nickname: 'Custom Key' }];
        }

        if (keys.length === 0 && this.apiKey) {
            keys = [{ key: this.apiKey, nickname: 'System Default' }];
        }

        return { keys, rotationIntervalMin };
    }

    _rotateKeys(keys, rotationIntervalMin) {
        if (!keys || keys.length <= 1) return keys;

        const now = Date.now();
        if (rotationIntervalMin > 0) {
            const intervalMs = rotationIntervalMin * 60 * 1000;
            if (now - this._lastRotationAt >= intervalMs) {
                this._currentKeyIndex = (this._currentKeyIndex + 1) % keys.length;
                this._lastRotationAt = now;
                console.log(`[Groq] 🔄 Key rotation interval (${rotationIntervalMin}m) reached → switched to Key #${this._currentKeyIndex + 1} (${keys[this._currentKeyIndex].nickname})`);
            }
        } else if (rotationIntervalMin === 0) {
            this._currentKeyIndex = (this._currentKeyIndex + 1) % keys.length;
            this._lastRotationAt = now;
        }

        const ordered = [];
        for (let i = 0; i < keys.length; i++) {
            const idx = (this._currentKeyIndex + i) % keys.length;
            ordered.push(keys[idx]);
        }

        return ordered.sort((a, b) => {
            const aCd = (this._cooldowns.get(a.key) || 0) > now ? 1 : 0;
            const bCd = (this._cooldowns.get(b.key) || 0) > now ? 1 : 0;
            return aCd - bCd;
        });
    }

    /**
     * Send a structured prompt to Groq with automatic key rotation and 429 failover.
     * @param {string} systemPrompt
     * @param {string} userPrompt
     * @param {string|object|Array} [customKeyInput]
     * @returns {object} parsed JSON signal response
     */
    async call(systemPrompt, userPrompt, customKeyInput = null) {
        const { keys, rotationIntervalMin } = this._resolveKeyPool(customKeyInput);
        if (keys.length === 0) {
            return this._mockSignal();
        }

        const prioritizedKeys = this._rotateKeys(keys, rotationIntervalMin);

        // Standard model list
        const modelsToTry = this.activeModel
            ? [this.activeModel, ...FREE_TIER_MODELS.filter(m => m !== this.activeModel)]
            : [...FREE_TIER_MODELS];

        let lastRateLimitErr = null;

        for (let kIdx = 0; kIdx < prioritizedKeys.length; kIdx++) {
            const keyObj = prioritizedKeys[kIdx];
            const currentApiKey = keyObj.key;
            const keyName = keyObj.nickname || `Key #${kIdx + 1}`;

            for (const model of modelsToTry) {
                try {
                    console.log(`[Groq] 🤖 Prompting ${model} with ${keyName}...`);
                    const result = await this._callModel(model, systemPrompt, userPrompt, currentApiKey);

                    if (this.activeModel !== model) {
                        console.log(`[Groq] ✅ Active model set to: ${model}`);
                        this.activeModel = model;
                    }

                    this._cooldowns.delete(currentApiKey);
                    return result;

                } catch (err) {
                    if (isModelUnavailableError(err)) {
                        console.warn(`[Groq] ⚠️ Model "${model}" is unavailable/deprecated — trying next fallback model...`);
                        if (this.activeModel === model) this.activeModel = null;
                        continue;
                    }

                    const status = err.response?.status;
                    const errCode = err.response?.data?.error?.code || '';
                    const errMsg = err.response?.data?.error?.message || err.message || '';
                    const isRateLimit = status === 429 || errCode === 'rate_limit_exceeded' || err.message?.includes('429');
                    const isBadKey = status === 401 || errCode === 'invalid_api_key' || errMsg.toLowerCase().includes('invalid api key') || errMsg.toLowerCase().includes('unauthorized');

                    if (isRateLimit) {
                        console.warn(`[Groq] ⚡ Rate limit (429) on ${keyName}. Adding 60s cooldown and switching to next key in pool...`);
                        this._cooldowns.set(currentApiKey, Date.now() + 60_000);
                        lastRateLimitErr = err;
                        break; // Try next key in pool
                    }

                    if (isBadKey) {
                        console.warn(`[Groq] ⚠️ Invalid API key on ${keyName} (${errMsg}). Adding 24h cooldown and switching to next key in pool...`);
                        this._cooldowns.set(currentApiKey, Date.now() + 24 * 60 * 60 * 1000);
                        break; // Try next key in pool
                    }

                    console.error('[Groq] API error:', err.response?.data || err.message);
                    if (err instanceof SyntaxError || err.message?.includes('JSON') || err.message?.includes('SyntaxError')) {
                        return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI response parse error: ' + errMsg };
                    }
                    return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI API error: ' + errMsg };
                }
            }
        }

        if (lastRateLimitErr) {
            console.error(`[Groq] ❌ All ${prioritizedKeys.length} keys in pool exceeded rate limit.`);
            return {
                action: 'NO_TRADE',
                confidence: 0,
                reasoning: `All ${prioritizedKeys.length} Groq API keys rate limited. Will retry next cycle.`
            };
        }

        console.error('[Groq] ❌ All models or keys exhausted.');
        return { action: 'NO_TRADE', confidence: 0, reasoning: 'All AI models/keys unavailable' };
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
