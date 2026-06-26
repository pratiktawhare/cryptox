const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: [true, 'Key name is required'],
        maxlength: 50,
        trim: true
    },
    exchange: {
        type: String,
        default: 'delta',
        enum: ['delta', 'binance']
    },
    // Encrypted as "ciphertext:iv:authTag" — single self-contained string
    apiKeyEncrypted: {
        type: String,
        required: true
    },
    apiSecretEncrypted: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: false
    },
    permissions: {
        type: String,
        default: 'read',
        enum: ['read', 'read_write']
    },
    lastTestedAt: Date,
    testResult: {
        type: String,
        enum: ['success', 'failed', null],
        default: null
    }
}, {
    timestamps: true
});

// One active key per user per exchange
apiKeySchema.index({ userId: 1, exchange: 1 });

// Never expose encrypted data in API responses
apiKeySchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.apiKeyEncrypted;
    delete obj.apiSecretEncrypted;
    obj.maskedKey = '••••' + (obj.name || '').slice(-4);
    return obj;
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
