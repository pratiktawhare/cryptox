/**
 * GroqClient.js
 *
 * Connects to the Groq API (llama-3.1-70b-versatile or llama3-8b-8192) for structured JSON trade signal output.
 * Fully compatible with OpenAI chat completion spec.
 */

const axios = require('axios');
const config = require('../../config/env');

const MODEL_NAME = 'llama-3.3-70b-versatile'; // High-performance Llama 3.3 model
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

class GroqClient {
    constructor() {
        this.apiKey = config.groqApiKey;
        this.mock = !this.apiKey;
        if (this.mock) {
            console.warn('[Groq] ⚠️  GROQ_API_KEY not set — signals will be mocked');
        } else {
            console.log('[Groq] ✅ Client initialized with model:', MODEL_NAME);
        }
    }

    /**
     * Send a structured prompt to Groq and parse the JSON response.
     * @param {string} systemPrompt
     * @param {string} userPrompt
     * @param {string} [customApiKey]
     * @returns {object} parsed JSON response
     */
    async call(systemPrompt, userPrompt, customApiKey = null) {
        const keyToUse = customApiKey || this.apiKey;
        if (!keyToUse) {
            return this._mockSignal();
        }

        try {
            const response = await axios.post(
                API_URL,
                {
                    model: MODEL_NAME,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.15,
                    max_tokens: 2048,
                    response_format: { type: 'json_object' } // Forces JSON output
                },
                {
                    headers: {
                        'Authorization': `Bearer ${keyToUse}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 25000 // 25s timeout
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
                    model:      MODEL_NAME,
                    timestamp:  Date.now(),
                    tokenCount: response.data?.usage?.total_tokens ?? null,
                },
            };

        } catch (err) {
            console.error('[Groq] API error:', err.response?.data || err.message);
            const errMsg = err.response?.data?.error?.message || err.message;
            if (err instanceof SyntaxError || err.message?.includes('JSON') || err.message?.includes('SyntaxError')) {
                return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI response parse error: ' + errMsg };
            }
            return { action: 'NO_TRADE', confidence: 0, reasoning: 'AI API error: ' + errMsg };
        }
    }

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
            reasoning: '[MOCK] Groq API key not configured. This is a simulated signal for testing.',
            smcContext: 'Mock SMC context.',
            invalidationLevel: null,
            tradeType: 'scalp',
            tags: ['mock'],
            _mock: true,
        };
    }

    status() {
        return {
            model: MODEL_NAME,
            mock:  this.mock,
        };
    }
}

module.exports = new GroqClient();
