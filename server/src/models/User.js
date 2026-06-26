const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: true,
        required: [true, 'Username is required'],
        minlength: [3, 'Username must be at least 3 characters'],
        maxlength: [30, 'Username must be at most 30 characters'],
        trim: true,
        lowercase: true,
        match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
    },
    passwordHash: {
        type: String,
        required: [true, 'Password is required']
    },
    displayName: {
        type: String,
        default: 'Trader',
        maxlength: 50
    },
    lastLogin: {
        type: Date
    },
    accountMode: {
        type: String,
        enum: ['live', 'paper'],
        default: 'paper',   // New users start in paper mode for safety
    }
}, {
    timestamps: true
});

// Don't return passwordHash in JSON
userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.passwordHash;
    return obj;
};

module.exports = mongoose.model('User', userSchema);
