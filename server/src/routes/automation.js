/**
 * automation.js — Express routes for AI Automation control
 *
 * GET  /api/automation/status          → current running state + config
 * POST /api/automation/start           → start automation for a mode
 * POST /api/automation/stop            → stop automation for a mode
 * GET  /api/automation/logs            → recent AutomationLog entries
 * GET  /api/automation/daily-reports   → paginated DailyReport entries
 * PATCH /api/automation/settings       → save automation settings for a mode
 */

const express         = require('express');
const router          = express.Router();
const authMiddleware  = require('../middleware/auth');
const AutomationLog   = require('../models/AutomationLog');
const DailyReport     = require('../models/DailyReport');
const UserPreferences = require('../models/UserPreferences');
const automationEngine = require('../services/ai/AutomationEngine');

// All routes require auth
router.use(authMiddleware);

// ── GET /api/automation/status ───────────────────────────────────────────────
router.get('/status', async (req, res) => {
    try {
        const prefs  = await UserPreferences.findOne({}).sort({ updatedAt: -1 });
        const status = automationEngine.getStatus();

        // For nextCycleAt: prefer live engine value, fall back to DB value
        const paperNextAt = (status.paper?.nextCycleAt) || (prefs?.paperAuto?.nextCycleAt ? new Date(prefs.paperAuto.nextCycleAt).getTime() : null);
        const liveNextAt  = (status.live?.nextCycleAt)  || (prefs?.liveAuto?.nextCycleAt  ? new Date(prefs.liveAuto.nextCycleAt).getTime()  : null);

        res.json({
            paper: {
                running:         typeof status.paper === 'object' ? !!status.paper.running : !!status.paper,
                nextCycleAt:     paperNextAt,
                config:          prefs?.paperAuto || {},
            },
            live: {
                running:         typeof status.live === 'object' ? !!status.live.running : !!status.live,
                nextCycleAt:     liveNextAt,
                config:          prefs?.liveAuto || {},
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/automation/start ───────────────────────────────────────────────
router.post('/start', async (req, res) => {
    const { mode } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        if (mode === 'live') {
            const liveTradingBot = req.app.get('liveTradingBot');
            if (liveTradingBot?.isRunning) {
                return res.status(409).json({
                    error: 'TradingBot is currently running in live mode. Please stop it before starting AI Automation live mode.',
                });
            }
        }

        // Enable in DB first
        await UserPreferences.updateMany(
            {},
            { $set: { [`${mode}Auto.enabled`]: true } }
        );

        await automationEngine.startMode(mode);
        res.json({ success: true, mode, running: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/automation/stop ────────────────────────────────────────────────
router.post('/stop', async (req, res) => {
    const { mode } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        // Disable in DB
        await UserPreferences.updateMany(
            {},
            { $set: { [`${mode}Auto.enabled`]: false } }
        );

        await automationEngine.stopMode(mode);
        res.json({ success: true, mode, running: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── PATCH /api/automation/settings ──────────────────────────────────────────
router.patch('/settings', async (req, res) => {
    const { mode, settings } = req.body;
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    const ALLOWED = [
        'intervalMinutes', 'estimatedWalletUSD', 'tradePct',
        'minConfidence', 'minLeverage', 'maxLeverage',
        'trailStopLoss', 'dailyReportEnabled', 'dailyReportTime',
        'reverseMode',   // Reverse Engineering Mode flag
    ];

    const update = {};
    for (const key of ALLOWED) {
        if (settings[key] !== undefined) {
            update[`${mode}Auto.${key}`] = settings[key];
        }
    }

    try {
        const prefs = await UserPreferences.findOneAndUpdate(
            {},
            { $set: update },
            { returnDocument: 'after' }
        );

        // If automation is running and interval changed, restart to pick up new interval
        const engineStatus = automationEngine.getStatus();
        const isRunning = typeof engineStatus[mode] === 'object' ? !!engineStatus[mode].running : !!engineStatus[mode];
        if (isRunning && settings.intervalMinutes !== undefined) {
            await automationEngine.restartMode(mode);
        }

        res.json({ success: true, config: prefs[`${mode}Auto`] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/automation/reverse ─────────────────────────────────────────────
// Atomically sets reverseMode and (re)starts automation in one step.
// Avoids the race condition of PATCH-then-start with an already-running engine.
router.post('/reverse', async (req, res) => {
    const { mode, enable } = req.body;  // enable: true = start reversed, false = stop
    if (!['paper', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "paper" or "live"' });
    }

    try {
        if (enable) {
            // 1. Save reverseMode=true and enabled=true atomically
            await UserPreferences.updateMany(
                {},
                { $set: { [`${mode}Auto.reverseMode`]: true, [`${mode}Auto.enabled`]: true } }
            );
            // 2. Stop first (if running) so startMode picks up fresh prefs
            await automationEngine.stopMode(mode);
            // 3. Start — now reads reverseMode=true from DB
            await automationEngine.startMode(mode);
            res.json({ success: true, mode, running: true, reverseMode: true });
        } else {
            // Stop and clear the flag
            await automationEngine.stopMode(mode);
            await UserPreferences.updateMany(
                {},
                { $set: { [`${mode}Auto.reverseMode`]: false, [`${mode}Auto.enabled`]: false } }
            );
            res.json({ success: true, mode, running: false, reverseMode: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/automation/logs ─────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
    try {
        const { mode, limit = 50, page = 1 } = req.query;
        const query = mode ? { mode } : {};
        const skip  = (parseInt(page) - 1) * parseInt(limit);

        const [logs, total] = await Promise.all([
            AutomationLog.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            AutomationLog.countDocuments(query),
        ]);

        res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/automation/daily-reports ───────────────────────────────────────
router.get('/daily-reports', async (req, res) => {
    try {
        const { mode, limit = 30 } = req.query;
        const query = mode ? { mode } : {};

        const reports = await DailyReport.find(query)
            .sort({ date: -1 })
            .limit(parseInt(limit));

        res.json({ reports });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
