/**
 * PositionTracker.js
 *
 * Polls Delta Exchange every 10 seconds for:
 *   - Open positions (with live unrealised P&L)
 *   - Wallet balance (equity, available margin)
 *
 * Emits via Socket.IO:
 *   'positions_update'  — { positions, timestamp }
 *   'wallet_update'     — { balance, equity, available, timestamp }
 *
 * Also reconciles TradeHistory records:
 *   - Marks 'open' → 'filled' when a position appears
 *   - Marks 'open' → 'cancelled' when order disappears
 *
 * Usage:
 *   const tracker = require('./PositionTracker');
 *   tracker.start(io);
 *   tracker.stop();
 */

const ApiKey       = require('../../models/ApiKey');
const TradeHistory = require('../../models/TradeHistory');
const DeltaOrderClient = require('./DeltaOrderClient');
const { decryptData } = require('../../utils/encryption');

const POLL_INTERVAL_MS = 10_000; // 10 seconds

// In-memory state: userId → { positions, wallet }
const _state = new Map();

class PositionTracker {
    constructor() {
        this.io      = null;
        this.timer   = null;
        this.running = false;
    }

    start(io) {
        if (this.running) return;
        this.io      = io;
        this.running = true;
        this.timer   = setInterval(() => this._poll(), POLL_INTERVAL_MS);
        // Run immediately
        setTimeout(() => this._poll(), 2000);
        console.log('[PositionTracker] 🔄 Started — polling every 10s');
    }

    stop() {
        this.running = false;
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        console.log('[PositionTracker] Stopped');
    }

    // ─── Get cached state for a user ──────────────────────────────────────────

    getPositions(userId) {
        return _state.get(String(userId))?.positions || [];
    }

    getWallet(userId) {
        return _state.get(String(userId))?.wallet || null;
    }

    // ─── Polling cycle ─────────────────────────────────────────────────────────

    async _poll() {
        if (!this.running) return;

        // Find all users with an active Delta API key
        let activeKeys;
        try {
            activeKeys = await ApiKey.find({ exchange: 'delta', isActive: true }).lean();
        } catch (e) {
            return; // DB not ready
        }

        for (const keyDoc of activeKeys) {
            try {
                await this._pollUser(keyDoc);
            } catch (err) {
                // Don't crash the whole cycle for one user's error
                if (!err.message?.includes('401') && !err.message?.includes('403')) {
                    console.error(`[PositionTracker] Error for user ${keyDoc.userId}:`, err.message);
                }
            }
        }
    }

    async _pollUser(keyDoc) {
        const userId    = String(keyDoc.userId);
        const apiKey    = decryptData(keyDoc.apiKeyEncrypted);
        const apiSecret = decryptData(keyDoc.apiSecretEncrypted);
        const client    = new DeltaOrderClient(apiKey, apiSecret);

        // Fetch positions + wallet + orders concurrently
        const [posRes, walletRes, ordersRes] = await Promise.allSettled([
            client.getPositions(),
            client.getWallet(),
            client.getOpenOrders(),
        ]);

        // ── Positions ──────────────────────────────────────────────────────────
        if (posRes.status === 'fulfilled') {
            const raw = posRes.value?.result || [];
            
            let openOrders = [];
            if (ordersRes.status === 'fulfilled') {
                openOrders = ordersRes.value?.result || [];
            }

            const positions = raw
                .filter(p => parseFloat(p.size) !== 0)
                .map(p => {
                    const symbolOrders = openOrders.filter(o => o.product_symbol === p.product_symbol);
                    const slOrder = symbolOrders.find(o => o.stop_order_type === 'stop_loss_order');
                    const tpOrder = symbolOrders.find(o => o.stop_order_type === 'take_profit_order');

                    return {
                        symbol:          p.product_symbol,
                        side:            p.entry_price > 0 ? (p.size > 0 ? 'buy' : 'sell') : 'unknown',
                        size:            Math.abs(parseFloat(p.size || 0)),
                        entryPrice:      parseFloat(p.entry_price || 0),
                        markPrice:       parseFloat(p.mark_price || 0),
                        unrealisedPnl:   parseFloat(p.unrealized_pnl || 0),
                        realisedPnl:     parseFloat(p.realized_pnl || 0),
                        margin:          parseFloat(p.initial_margin || 0),
                        leverage:        parseFloat(p.leverage || 1),
                        liquidationPrice: parseFloat(p.liquidation_price || 0),
                        roe:             parseFloat(p.roe || 0),
                        stopLoss:        slOrder ? parseFloat(slOrder.stop_price) : null,
                        takeProfit:      tpOrder ? parseFloat(tpOrder.stop_price) : null,
                    };
                });

            _state.set(userId, { ...(_state.get(userId) || {}), positions, posTimestamp: Date.now() });
            this.io?.to(`user:${userId}`).emit('positions_update', { positions, timestamp: Date.now() });
        }

        // ── Wallet ─────────────────────────────────────────────────────────────
        if (walletRes.status === 'fulfilled') {
            const raw = walletRes.value?.result || [];
            // Delta returns array of asset balances
            const usdtBalance = raw.find(b => b.asset_symbol === 'USDT') || raw[0] || {};
            const wallet = {
                equity:    parseFloat(usdtBalance.equity || usdtBalance.balance || 0),
                available: parseFloat(usdtBalance.available_balance || 0),
                used:      parseFloat(usdtBalance.position_margin || 0),
                unrealisedPnl: parseFloat(usdtBalance.unrealized_pnl || 0),
            };
            _state.set(userId, { ...(_state.get(userId) || {}), wallet, walletTimestamp: Date.now() });
            this.io?.to(`user:${userId}`).emit('wallet_update', { wallet, timestamp: Date.now() });
        }
    }
}

module.exports = new PositionTracker();
