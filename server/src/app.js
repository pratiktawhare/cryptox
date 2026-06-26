const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const config = require('./config/env');
const connectDB = require('./config/database');
const DeltaWebSocketManager    = require('./services/DeltaWebSocketManager');
const productCatalog           = require('./services/ProductCatalog');
const notificationService      = require('./services/NotificationService');

// ─── Routes ──────────────────────────────────────────────
const setupRoutes         = require('./routes/setup');
const authRoutes          = require('./routes/auth');
const profileRoutes       = require('./routes/profile');
const marketRoutes        = require('./routes/market');
const analysisRoutes      = require('./routes/analysis');
const signalRoutes        = require('./routes/signals');
const tradingRoutes       = require('./routes/trading');
const paperRoutes         = require('./routes/paper');
const analyticsRoutes     = require('./routes/analytics');
const notificationRoutes  = require('./routes/notifications');
const signalEngine        = require('./services/ai/SignalEngine');
const signalTracker       = require('./services/ai/SignalTracker');
const positionTracker     = require('./services/trading/PositionTracker');
const paperEngine         = require('./services/trading/PaperTradingEngine');
const cron                = require('node-cron');
const User                = require('./models/User');

const app = express();
const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────────────────
const io = new Server(server, {
    cors: { origin: config.corsOrigin, credentials: true }
});

// ─── Middleware ───────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later' }
});

// ─── Routes ──────────────────────────────────────────────
app.use('/api/setup', setupRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/signals',       signalRoutes);
app.use('/api/trading',       tradingRoutes);
app.use('/api/paper',         paperRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        catalog: {
            ready: productCatalog.isReady,
            count: productCatalog.getAll().length,
        }
    });
});

// ─── Socket.IO events ────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`⚡ Client connected: ${socket.id}`);

    // Send full product catalog immediately to new clients
    if (productCatalog.isReady) {
        socket.emit('product_catalog', {
            products: productCatalog.getAll(),
            count: productCatalog.getAll().length,
        });
    }

    socket.on('join_user_room', (userId) => {
        if (userId) {
            socket.join(`user:${userId}`);
            console.log(`⚡ Socket ${socket.id} joined user room: ${userId}`);
        }
    });

    socket.on('disconnect', () => console.log(`◌  Client disconnected: ${socket.id}`));
});

app.set('io', io);
// Expose catalog and wsManager for use in routes
app.set('productCatalog', productCatalog);

// Initialise NotificationService so it can emit events
notificationService.init(io);
app.set('notificationService', notificationService);

// ─── Error handlers ──────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: config.isDev ? err.message : 'Internal server error' });
});

app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ─── Start ───────────────────────────────────────────────
let wsManager = null;

async function start() {
    await connectDB();

    // 1. Boot ProductCatalog — fetch all perpetual futures
    await productCatalog.init();

    // 2. Start WebSocket — subscribe to ALL coins
    wsManager = new DeltaWebSocketManager(io, productCatalog);
    app.set('wsManager', wsManager);
    wsManager.connect();

    // 3. Start SignalEngine — AI 5-minute scan cycle
    signalEngine.start(io, wsManager, productCatalog);
    app.set('signalEngine', signalEngine);

    // 4. Start PositionTracker — poll live positions every 10s
    positionTracker.start(io);
    app.set('positionTracker', positionTracker);

    // 5. Start PaperTradingEngine — simulate fills & auto SL/TP
    paperEngine.start(io, wsManager);
    app.set('paperEngine', paperEngine);

    // 6. Start SignalTracker — monitor signal outcomes every 30s (Phase 9)
    signalTracker.start(io, wsManager);
    app.set('signalTracker', signalTracker);

    // 7. Daily summary cron — fires at midnight every day
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('[CRON] Sending daily summaries…');
            const users = await User.find({}).select('_id').lean();
            await Promise.allSettled(
                users.map(u => notificationService.notifyDailySummary(String(u._id)))
            );
        } catch (err) {
            console.error('[CRON] Daily summary error:', err.message);
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\n❌ Port ${config.port} is already in use.`);
            console.error('   Kill the other process first:  npx kill-port ' + config.port);
            process.exit(1);
        }
        throw err;
    });

    server.listen(config.port, () => {
        console.log(`
┌─────────────────────────────────────────┐
│         CryptoX Backend v4.0            │
├─────────────────────────────────────────┤
│  Port:     ${String(config.port).padEnd(28)}│
│  Mode:     ${config.nodeEnv.padEnd(28)}│
│  MongoDB:  Connected                    │
│  Catalog:  ${String(productCatalog.getAll().length + ' futures').padEnd(28)}│
│  Socket:   Ready                        │
│  Delta WS: Streaming all coins          │
└─────────────────────────────────────────┘`);
    });
}

// ─── Graceful shutdown ───────────────────────────────────
function shutdown(signal) {
    console.log(`\n${signal} received — shutting down gracefully…`);
    signalEngine.stop();
    signalTracker.stop();
    positionTracker.stop();
    paperEngine.stop();
    productCatalog.destroy();
    if (wsManager) wsManager.destroy();
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

module.exports = { app, server, io };
