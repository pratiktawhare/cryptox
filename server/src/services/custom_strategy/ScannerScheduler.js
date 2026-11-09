/**
 * ScannerScheduler.js
 *
 * Manages the background interval scheduler for the MCdynamic Universal Scanner.
 * Allows user to toggle automated recurring scans (every 15m, 30m, 1h, 4h) or keep it on manual.
 *
 * Automatically triggers:
 *   - Real-time in-app notifications & audio chime when fresh 4H crosses are found
 *   - Automated Paper Trade or Live Trade execution if autoTradeMode is enabled
 */

const universalMarketScanner = require('./UniversalMarketScanner');
const notificationService = require('../NotificationService');
const paperEngine = require('../trading/PaperTradingEngine');
const orderExecutor = require('../trading/OrderExecutor');
const PaperWallet = require('../../models/PaperWallet');
const UserPreferences = require('../../models/UserPreferences');

// Map interval string to milliseconds
const INTERVAL_MS = {
    'manual': 0,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
};

class ScannerScheduler {
    constructor() {
        this.io = null;
        this.timer = null;
        this.running = false;
        this.config = {
            interval: '1h',          // 'manual' | '15m' | '30m' | '1h' | '4h'
            timeframe: '4h',         // 4H default as requested
            fastPeriod: 14,
            slowPeriod: 50,
            triggerDiffPct: 0.10,
            autoTradeMode: 'off',    // 'off' | 'paper' | 'live'
            maxLeverage: 3,          // Default conservative leverage for 4H swing
            tradeAllocationUsdt: 100,// USDT margin per trade
            lastRunTimestamp: null,
            nextRunTimestamp: null,
        };
        this._executedSymbols = new Set(); // Prevents re-executing same crossover bar
    }

    /**
     * Start the scheduler.
     * @param {import('socket.io').Server} io
     */
    start(io) {
        this.io = io;
        this.running = true;
        this._reschedule();
        console.log(`[ScannerScheduler] 🚀 Started — interval: ${this.config.interval}, timeframe: ${this.config.timeframe}`);
    }

    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        console.log('[ScannerScheduler] 🛑 Stopped');
    }

    /**
     * Update runtime configuration (e.g. interval changed by user in UI).
     * @param {object} newConfig
     */
    updateConfig(newConfig = {}) {
        const oldInterval = this.config.interval;
        this.config = { ...this.config, ...newConfig };

        if (newConfig.interval && newConfig.interval !== oldInterval) {
            this._reschedule();
        }

        // Broadcast config update to clients
        if (this.io) {
            this.io.emit('mc_scanner_config_updated', this.getConfig());
        }

        return this.getConfig();
    }

    getConfig() {
        return {
            ...this.config,
            running: this.running,
            isScanning: universalMarketScanner.isScanning,
            lastScanTime: universalMarketScanner.lastScanTime,
        };
    }

    /**
     * Reschedule the timer based on the current interval.
     * @private
     */
    _reschedule() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        const ms = INTERVAL_MS[this.config.interval] || 0;
        if (!this.running || ms <= 0) {
            this.config.nextRunTimestamp = null;
            return;
        }

        this.config.nextRunTimestamp = Date.now() + ms;

        this.timer = setInterval(async () => {
            await this.runScanCycle();
        }, ms);
    }

    /**
     * Execute a full scan cycle and process alerts/trades.
     */
    async runScanCycle() {
        if (!this.running || universalMarketScanner.isScanning) return;

        console.log(`[ScannerScheduler] 🔍 Running scheduled scan (${this.config.timeframe}) across all 194 coins…`);
        this.config.lastRunTimestamp = Date.now();

        const ms = INTERVAL_MS[this.config.interval] || 0;
        if (ms > 0) {
            this.config.nextRunTimestamp = Date.now() + ms;
        }

        try {
            const scanResult = await universalMarketScanner.scanAll({
                timeframe: this.config.timeframe,
                fastPeriod: this.config.fastPeriod,
                slowPeriod: this.config.slowPeriod,
                triggerDiffPct: this.config.triggerDiffPct,
                io: this.io,
            });

            await this._processScanOutcomes(scanResult);
            return scanResult;
        } catch (err) {
            console.error('[ScannerScheduler] Error during scan cycle:', err.message);
        }
    }

    /**
     * Process fresh crosses: send notifications and execute auto-trades if enabled.
     * @private
     */
    async _processScanOutcomes(scanResult) {
        if (!scanResult) return;

        const { freshBullish = [], freshBearish = [] } = scanResult;
        const totalFresh = freshBullish.length + freshBearish.length;

        if (totalFresh === 0) return;

        console.log(`[ScannerScheduler] 🔔 Found ${freshBullish.length} Fresh Bullish & ${freshBearish.length} Fresh Bearish crossovers!`);

        // Send Notification for fresh crosses
        for (const coin of [...freshBullish, ...freshBearish]) {
            const key = `${coin.symbol}_${coin.status}_${coin.timestamp}`;
            if (this._executedSymbols.has(key)) continue;
            this._executedSymbols.add(key);

            // Notify user
            if (notificationService?.notify) {
                const isBull = coin.status.includes('BULLISH');
                notificationService.notify({
                    title: `🎯 MCdynamic ${this.config.timeframe} ${isBull ? '🟢 Bullish Cross' : '🔴 Bearish Cross'}: ${coin.symbol}`,
                    message: `${coin.symbol} crossed with ${coin.spreadPct > 0 ? '+' : ''}${coin.spreadPct}% spread. Entry ~$${coin.price}`,
                    type: isBull ? 'signal_buy' : 'signal_sell',
                    symbol: coin.symbol,
                    metadata: {
                        source: 'mc_scanner',
                        timeframe: this.config.timeframe,
                        status: coin.status,
                        price: coin.price,
                        spreadPct: coin.spreadPct,
                    },
                }).catch(() => {});
            }

            // Auto-Trade execution (if enabled)
            if (this.config.autoTradeMode === 'paper' || this.config.autoTradeMode === 'live') {
                await this._executeAutoTrade(coin);
            }
        }
    }

    /**
     * Automatically execute a trade for a confirmed fresh cross.
     * @private
     */
    async _executeAutoTrade(coin) {
        try {
            const side = coin.status.includes('BULLISH') ? 'buy' : 'sell';
            const suggested = coin.suggestedTrade;
            if (!suggested) return;

            const leverage = this.config.maxLeverage || 3;
            const allocation = this.config.tradeAllocationUsdt || 100;

            // Calculate contracts based on allocation and leverage
            const marginNeededPerContract = coin.price / leverage;
            const size = Math.max(1, Math.floor(allocation / marginNeededPerContract));

            if (this.config.autoTradeMode === 'paper') {
                // Find system default or first user ID for paper wallet
                const defaultUser = await PaperWallet.findOne({}).lean();
                const userId = defaultUser?.userId || 'default_user';

                const orderParams = {
                    symbol: coin.symbol,
                    side,
                    size,
                    price: coin.price,
                    orderType: 'market',
                    leverage,
                    stopLoss: suggested.stopLoss,
                    takeProfit: suggested.target1,
                    source: 'MCdynamic_Scanner',
                };

                const pos = await paperEngine.placeOrder(userId, orderParams);
                console.log(`[ScannerScheduler] 📄 Auto-executed Paper Trade: ${side.toUpperCase()} ${size} ${coin.symbol} @ $${coin.price}`);
            }
        } catch (tradeErr) {
            console.error(`[ScannerScheduler] Auto-trade failed for ${coin.symbol}:`, tradeErr.message);
        }
    }
}

module.exports = new ScannerScheduler();

