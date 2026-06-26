/**
 * AiService.js
 *
 * Unified AI service dispatcher. Resolves the active AI provider (Groq or DeepSeek)
 * from user preferences, decrypts user-supplied API keys, and handles fallback
 * to system default keys.
 */

const { decryptData } = require('../../utils/encryption');
const groqClient = require('./GroqClient');
const deepseekClient = require('./DeepSeekClient');

class AiService {
    /**
     * Call the active AI provider dynamically.
     * @param {object} userPrefs - UserPreferences document or object
     * @param {string} systemPrompt
     * @param {string} userPrompt
     * @returns {Promise<object>} parsed JSON trade signal
     */
    async call(userPrefs, systemPrompt, userPrompt) {
        const provider = userPrefs?.aiProvider || 'groq';
        let customApiKey = null;

        try {
            if (provider === 'groq' && userPrefs?.useCustomGroqKey !== false && userPrefs?.groqApiKeyEncrypted) {
                customApiKey = decryptData(userPrefs.groqApiKeyEncrypted);
            } else if (provider === 'deepseek' && userPrefs?.useCustomDeepseekKey !== false && userPrefs?.deepseekApiKeyEncrypted) {
                customApiKey = decryptData(userPrefs.deepseekApiKeyEncrypted);
            }
        } catch (err) {
            console.error(`[AiService] Failed to decrypt custom API key for ${provider}:`, err.message);
        }

        let signal;
        if (provider === 'deepseek') {
            signal = await deepseekClient.call(systemPrompt, userPrompt, customApiKey);
        } else {
            signal = await groqClient.call(systemPrompt, userPrompt, customApiKey);
        }

        // Post-process precision and mathematical accuracy
        if (signal && signal.action !== 'NO_TRADE') {
            const symbol = signal.symbol;
            if (symbol) {
                const ProductCatalog = require('../ProductCatalog');
                const prod = ProductCatalog.getBySymbol(symbol);
                if (prod) {
                    const tickSize = prod.tick_size;
                    let decimals = 4;
                    if (tickSize && !isNaN(tickSize) && tickSize > 0) {
                        const str = tickSize.toString();
                        if (str.includes('e')) {
                            const parts = str.split('e-');
                            if (parts.length === 2) decimals = parseInt(parts[1], 10);
                        } else {
                            const parts = str.split('.');
                            decimals = parts.length === 2 ? parts[1].length : 0;
                        }
                    }
                    decimals = Math.max(0, Math.min(8, decimals));

                    if (signal.entry) signal.entry = parseFloat(signal.entry.toFixed(decimals));
                    if (signal.stopLoss) signal.stopLoss = parseFloat(signal.stopLoss.toFixed(decimals));
                    if (signal.target1) signal.target1 = parseFloat(signal.target1.toFixed(decimals));
                    if (signal.target2) signal.target2 = parseFloat(signal.target2.toFixed(decimals));
                    if (signal.invalidationLevel) signal.invalidationLevel = parseFloat(signal.invalidationLevel.toFixed(decimals));
                }
            }

            // Recalculate Risk/Reward mathematically
            if (signal.entry && signal.stopLoss && signal.target1) {
                const risk = Math.abs(signal.entry - signal.stopLoss);
                if (risk > 0) {
                    const reward1 = Math.abs(signal.target1 - signal.entry);
                    signal.riskReward = parseFloat((reward1 / risk).toFixed(2));
                }
            }
        }

        return signal;
    }

    /**
     * Get the status of the active AI provider.
     * @param {object} [userPrefs]
     * @returns {object} status info
     */
    status(userPrefs = null) {
        const provider = userPrefs?.aiProvider || 'groq';
        if (provider === 'deepseek') {
            const baseStatus = deepseekClient.status();
            const hasCustom = !!userPrefs?.deepseekApiKeyEncrypted;
            const useCustom = userPrefs?.useCustomDeepseekKey !== false;
            return {
                ...baseStatus,
                provider: 'deepseek',
                hasCustomKey: hasCustom,
                useCustomKey: useCustom && hasCustom
            };
        } else {
            const baseStatus = groqClient.status();
            const hasCustom = !!userPrefs?.groqApiKeyEncrypted;
            const useCustom = userPrefs?.useCustomGroqKey !== false;
            return {
                ...baseStatus,
                provider: 'groq',
                hasCustomKey: hasCustom,
                useCustomKey: useCustom && hasCustom
            };
        }
    }
}

module.exports = new AiService();
