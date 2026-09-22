const express = require('express');
const router  = express.Router();

const Notification = require('../models/Notification');
const auth         = require('../middleware/auth');

// All routes require authentication
router.use(auth);

/**
 * GET /api/notifications
 * Returns the 50 most recent notifications for the authenticated user.
 * Query params: ?unread=true to filter only unread
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const filter = { userId };
        if (req.query.unread === 'true') filter.isRead = false;

        const notifications = await Notification
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        res.json({ success: true, notifications });
    } catch (err) {
        console.error('[notifications] GET / error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
});

/**
 * GET /api/notifications/unread-count
 */
router.get('/unread-count', async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const count = await Notification.countDocuments({
            userId,
            isRead: false,
        });
        res.json({ success: true, count });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to count notifications' });
    }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read.
 */
router.patch('/:id/read', async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const doc = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId },
            { isRead: true, readAt: new Date() },
            { new: true }
        );
        if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, notification: doc });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
});

/**
 * POST /api/notifications/mark-all-read
 * Marks all of the user's notifications as read.
 */
router.post('/mark-all-read', async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        await Notification.updateMany(
            { userId, isRead: false },
            { isRead: true, readAt: new Date() }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to mark all read' });
    }
});

/**
 * DELETE /api/notifications/clear-all
 * Deletes all notifications for the authenticated user.
 */
router.delete('/clear-all', async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        await Notification.deleteMany({ userId });
        res.json({ success: true, message: 'All notifications cleared' });
    } catch (err) {
        console.error('[notifications] DELETE /clear-all error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to clear notifications' });
    }
});

/**
 * DELETE /api/notifications/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const doc = await Notification.findOneAndDelete({
            _id: req.params.id,
            userId,
        });
        if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete notification' });
    }
});

module.exports = router;