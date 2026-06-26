const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    signalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TradeSignal'
    },
    type: {
        type: String,
        required: true,
        enum: ['signal', 'alert', 'system', 'resolved']
    },
    title:    { type: String, required: true,  maxlength: 200 },
    message:  { type: String, required: true,  maxlength: 1000 },
    priority: { type: String, default: 'medium', enum: ['low', 'medium', 'high'] },
    sound:    { type: String, default: null },
    isRead:   { type: Boolean, default: false },
    readAt:   { type: Date,    default: null },
}, {
    timestamps: true
});

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
