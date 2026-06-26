const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

// ═══════════════════════════════════════════════════════════
// Auto-generate cryptographic secrets on first run
// ═══════════════════════════════════════════════════════════
function ensureSecrets() {
    const envPath = path.join(__dirname, '../../.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    let changed = false;

    if (!process.env.JWT_SECRET) {
        const secret = crypto.randomBytes(64).toString('hex');
        process.env.JWT_SECRET = secret;
        envContent = envContent.replace('JWT_SECRET=', `JWT_SECRET=${secret}`);
        changed = true;
        console.log('🔑 Auto-generated JWT_SECRET');
    }

    if (!process.env.ENCRYPTION_KEY) {
        const key = crypto.randomBytes(32).toString('hex');
        process.env.ENCRYPTION_KEY = key;
        envContent = envContent.replace('ENCRYPTION_KEY=', `ENCRYPTION_KEY=${key}`);
        changed = true;
        console.log('🔐 Auto-generated ENCRYPTION_KEY');
    }

    if (changed) {
        fs.writeFileSync(envPath, envContent);
    }
}

ensureSecrets();

// ═══════════════════════════════════════════════════════════
// Centralised configuration — single source of truth
// ═══════════════════════════════════════════════════════════
const config = {
    // Server
    port: parseInt(process.env.PORT, 10) || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',
    isDev: process.env.NODE_ENV !== 'production',
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

    // Database
    mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cryptox',

    // Auth
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

    // Encryption
    encryptionKey: process.env.ENCRYPTION_KEY,

    // AI
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',

    // Delta Exchange — centralised, no more magic strings
    deltaBaseUrl: process.env.DELTA_BASE_URL || 'https://api.india.delta.exchange',
    deltaWsUrl: process.env.DELTA_WS_URL || 'wss://public-socket.india.delta.exchange',
};

// Validate critical config
if (!config.jwtSecret) throw new Error('JWT_SECRET is required');
if (!config.encryptionKey) throw new Error('ENCRYPTION_KEY is required');

module.exports = config;
