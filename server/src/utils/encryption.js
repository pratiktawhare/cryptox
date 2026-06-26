const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../config/env');

const SALT_ROUNDS = 12;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// ═══ Password Hashing ═══

async function hashPassword(plainPassword) {
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, hash) {
    return bcrypt.compare(plainPassword, hash);
}

// ═══ AES-256-GCM Encryption (for API keys) ═══

function encryptData(plaintext) {
    const key = Buffer.from(config.encryptionKey, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Return as a single structured string
    return `${encrypted}:${iv.toString('hex')}:${authTag}`;
}

function decryptData(combined) {
    if (!combined || !combined.includes(':')) {
        throw new Error('Invalid encrypted format');
    }
    
    const [encrypted, ivHex, authTagHex] = combined.split(':');
    
    const key = Buffer.from(config.encryptionKey, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

module.exports = {
    hashPassword,
    verifyPassword,
    encryptData,
    decryptData
};
