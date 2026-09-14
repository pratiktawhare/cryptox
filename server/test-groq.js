/**
 * test-groq.js — Quick smoke test for the Groq fallback client.
 * Run from the server/ directory:  node test-groq.js
 */

require('dotenv').config();
const axios = require('axios');

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const API_KEY = process.env.GROQ_API_KEY;

const FREE_TIER_MODELS = [
    'openai/gpt-oss-120b',
    'qwen/qwen3.6-27b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b',
];

const SYSTEM_PROMPT = 'You are a crypto trading assistant. Always respond with valid JSON only.';
const USER_PROMPT   = 'Give me a short BTC trade signal as JSON with fields: action, confidence, reasoning.';

function isModelUnavailableError(err) {
    const status  = err.response?.status;
    const errData = err.response?.data?.error;
    const code    = errData?.code || '';
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

async function testModel(model) {
    const res = await axios.post(
        API_URL,
        {
            model,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user',   content: USER_PROMPT   },
            ],
            temperature:     0.15,
            max_tokens:      256,
            response_format: { type: 'json_object' },
        },
        {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type':  'application/json',
            },
            timeout: 20000,
        }
    );
    return res.data?.choices?.[0]?.message?.content;
}

(async () => {
    if (!API_KEY) {
        console.error('❌ GROQ_API_KEY is not set in .env');
        process.exit(1);
    }

    console.log('🔑 API key found. Testing fallback chain...\n');

    for (const model of FREE_TIER_MODELS) {
        process.stdout.write(`  Testing "${model}" ... `);
        try {
            const content = await testModel(model);
            const parsed  = JSON.parse(content);
            console.log('✅ WORKING');
            console.log(`     Response: ${JSON.stringify(parsed)}`);
            console.log(`\n🎉 First working model: "${model}" — this will be used as primary.\n`);
            process.exit(0);
        } catch (err) {
            if (isModelUnavailableError(err)) {
                console.log('⚠️  DEPRECATED / UNAVAILABLE — trying next...');
            } else {
                const msg = err.response?.data?.error?.message || err.message;
                console.log(`❌ ERROR: ${msg}`);
                // Don't fallback on non-deprecation errors
                process.exit(1);
            }
        }
    }

    console.log('\n❌ All models in the fallback chain are unavailable.');
    console.log('   Visit https://console.groq.com/docs/models and update FREE_TIER_MODELS in GroqClient.js');
    process.exit(1);
})();
