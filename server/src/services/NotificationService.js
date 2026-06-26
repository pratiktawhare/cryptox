const Notification = require('../models/Notification');
const TradeSignal  = require('../models/TradeSignal');
const User         = require('../models/User');

const MIN_CONFIDENCE_TO_NOTIFY = 65;

class NotificationService {
    constructor() { this.io = null; }

    /** Called once from app.js after Socket.IO is ready */
    init(io) { this.io = io; }

    // ─── Public API ──────────────────────────────────────────────────────────

    async notifyNewSignal(signal) {
        try {
            if (!signal || signal.confidence < MIN_CONFIDENCE_TO_NOTIFY) return;
            const isHigh   = signal.confidence >= 80;
            const sym      = (signal.symbol || '').replace('USD', '/USD');
            const action   = signal.action || '';
            const entry    = Number(signal.entry || 0);
            const entryStr = entry < 1
                ? entry.toFixed(6)
                : entry.toLocaleString(undefined, { maximumFractionDigits: 2 });

            const title   = `${action} ${sym}`;
            const message = `${signal.confidence}% confidence · Entry $${entryStr} · R:R ${signal.riskReward || '?'}`;

            await this._notifyAllUsers({
                type:     'signal',
                title,
                message,
                signalId: signal._id,
                priority: isHigh ? 'high' : 'medium',
                sound:    isHigh ? 'signal_high' : 'signal_normal',
            });
        } catch (err) {
            console.error('[NotificationService] notifyNewSignal error:', err.message);
        }
    }

    async notifySignalResolved(signal, outcome, exitPrice, realisedPnlPct) {
        try {
            if (outcome === 'timeout') return;
            const sym    = (signal.symbol || '').replace('USD', '/USD');
            const isWin  = outcome === 'win';
            const pctStr = realisedPnlPct != null
                ? `${isWin ? '+' : ''}${Number(realisedPnlPct).toFixed(1)}%`
                : '';
            const ep    = Number(exitPrice || 0);
            const epStr = ep < 1
                ? ep.toFixed(6)
                : ep.toLocaleString(undefined, { maximumFractionDigits: 2 });

            const title   = isWin ? `Target Hit: ${sym}` : `Stop Loss: ${sym}`;
            const message = `${pctStr ? pctStr + ' ' : ''}${isWin ? 'profit' : 'loss'} on ${signal.action || ''} · Exit $${epStr}`;

            await this._notifyAllUsers({
                type:     'resolved',
                title,
                message,
                signalId: signal._id,
                priority: 'high',
                sound:    isWin ? 'target_hit' : 'stoploss_hit',
            });
        } catch (err) {
            console.error('[NotificationService] notifySignalResolved error:', err.message);
        }
    }

    async notifyDailySummary(userId) {
        try {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const q = { createdAt: { $gte: since } };
            const [s, w, l] = await Promise.all([
                TradeSignal.countDocuments(q),
                TradeSignal.countDocuments({ ...q, status: 'completed' }),
                TradeSignal.countDocuments({ ...q, status: 'stopped' }),
            ]);
            await this._createAndEmit(userId, {
                type:     'system',
                title:    'Daily Trading Summary',
                message:  `Signals today: ${s} · Wins: ${w} · Losses: ${l}`,
                priority: 'low',
                sound:    null,
            });
        } catch (err) {
            console.error('[NotificationService] notifyDailySummary error:', err.message);
        }
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    async _notifyAllUsers(payload) {
        try {
            const users = await User.find({}).select('_id').lean();
            await Promise.allSettled(users.map(u => this._createAndEmit(String(u._id), payload)));
        } catch (err) {
            console.error('[NotificationService] _notifyAllUsers error:', err.message);
        }
    }

    async _createAndEmit(userId, payload) {
        try {
            const doc = await Notification.create({
                userId,
                signalId: payload.signalId || null,
                type:     payload.type,
                title:    payload.title,
                message:  payload.message,
                priority: payload.priority || 'medium',
                sound:    payload.sound    || null,
                isRead:   false,
            });
            if (this.io) {
                this.io.to(`user:${userId}`).emit('notification', {
                    id:        String(doc._id),
                    type:      doc.type,
                    title:     doc.title,
                    message:   doc.message,
                    priority:  doc.priority,
                    sound:     doc.sound,
                    signalId:  doc.signalId ? String(doc.signalId) : null,
                    isRead:    false,
                    createdAt: doc.createdAt,
                });
            }
            return doc;
        } catch (err) {
            console.error('[NotificationService] _createAndEmit error:', err.message);
        }
    }
}

module.exports = new NotificationService();