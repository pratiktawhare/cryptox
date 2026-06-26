/**
 * DeltaWebSocketManager.js
 *
 * Manages the live WebSocket connection to Delta Exchange India.
 * Phase 4: Subscribes to ALL perpetual futures from ProductCatalog.
 *
 * Emits to Socket.IO clients:
 *   - 'ticker'               — individual price update (backward compat)
 *   - 'market_ticker_batch'  — full ticker map every 2 seconds
 *   - 'candle_update'        — new candle on any subscribed symbol/resolution
 */

const WebSocket = require('ws');
const config = require('../config/env');

const PING_INTERVAL_MS     = 25_000;
const RECONNECT_DELAY_MS   = 5_000;
const BATCH_EMIT_INTERVAL  = 2_000;   // emit full ticker map every 2 s
const MAX_SYMBOLS_PER_MSG  = 50;      // Delta may have message size limits

class DeltaWebSocketManager {
    /**
     * @param {import('socket.io').Server} io
     * @param {import('./ProductCatalog')} catalog - optional, set later via setCatalog()
     */
    constructor(io, catalog = null) {
        this.io = io;
        this.catalog = catalog;
        this.ws = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.batchTimer = null;
        this._destroyed = false;

        /**
         * In-memory ticker map: symbol → {price, change24h, volume24h, high24h, low24h, timestamp}
         * @type {Map<string, object>}
         */
        this.tickerMap = new Map();

        /**
         * 24h open prices for accurate change% calculation.
         * We store the first close seen each session per symbol.
         * @type {Map<string, number>}
         */
        this._dayOpen = new Map();
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────

    /** Inject the ProductCatalog after construction (called from app.js) */
    setCatalog(catalog) {
        this.catalog = catalog;
    }

    connect() {
        if (this._destroyed) return;
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
        }

        console.log('[WS] Connecting to Delta Exchange…');
        this.ws = new WebSocket(config.deltaWsUrl);

        this.ws.on('open', () => {
            console.log('[WS] ✓ Connected to Delta Exchange');
            this.isConnected = true;
            this._subscribe();
            this._startPing();
            this._startBatchEmit();
        });

        this.ws.on('message', (raw) => {
            try {
                this._handleMessage(JSON.parse(raw));
            } catch { /* ignore non-JSON */ }
        });

        this.ws.on('close', (code) => {
            console.log(`[WS] Disconnected (code ${code})`);
            this.isConnected = false;
            this._stopPing();
            this._stopBatchEmit();
            this._scheduleReconnect();
        });

        this.ws.on('error', (err) => {
            console.error('[WS] Error:', err.message);
        });
    }

    destroy() {
        this._destroyed = true;
        this._stopPing();
        this._stopBatchEmit();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }
        console.log('[WS] Manager destroyed');
    }

    // ─── Public helpers (used by SignalEngine, PositionTracker, etc.) ────────

    /**
     * Get the latest ticker for a symbol.
     * @param {string} symbol e.g. 'BTCUSD'
     */
    getTicker(symbol) {
        return this.tickerMap.get(symbol?.toUpperCase()) ?? null;
    }

    /**
     * Get the latest price for a symbol (or null).
     */
    getPrice(symbol) {
        return this.tickerMap.get(symbol?.toUpperCase())?.price ?? null;
    }

    /**
     * Return a snapshot of the entire ticker map as a plain object.
     */
    getTickerSnapshot() {
        const out = {};
        this.tickerMap.forEach((v, k) => { out[k] = v; });
        return out;
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    _scheduleReconnect() {
        if (this._destroyed) return;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            console.log('[WS] Reconnecting…');
            this.connect();
        }, RECONNECT_DELAY_MS);
    }

    _startPing() {
        this._stopPing();
        this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
        }, PING_INTERVAL_MS);
    }

    _stopPing() {
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    }

    /** Emit the full ticker map to all clients every 2 seconds */
    _startBatchEmit() {
        this._stopBatchEmit();
        this.batchTimer = setInterval(() => {
            if (this.tickerMap.size === 0) return;
            const snapshot = this.getTickerSnapshot();
            this.io.emit('market_ticker_batch', snapshot);
        }, BATCH_EMIT_INTERVAL);
    }

    _stopBatchEmit() {
        if (this.batchTimer) { clearInterval(this.batchTimer); this.batchTimer = null; }
    }

    _subscribe() {
        if (!this.isConnected) return;

        // Get all symbols from catalog, or fall back to core 3
        let symbols = ['BTCUSD', 'ETHUSD', 'SOLUSD'];
        if (this.catalog?.isReady) {
            symbols = this.catalog.getSymbols();
        }

        // Delta supports all symbols in one message for public channels
        // Split into chunks if needed
        const chunks = [];
        for (let i = 0; i < symbols.length; i += MAX_SYMBOLS_PER_MSG) {
            chunks.push(symbols.slice(i, i + MAX_SYMBOLS_PER_MSG));
        }

        for (const chunk of chunks) {
            const payload = {
                type: 'subscribe',
                payload: {
                    channels: [
                        { name: 'candlestick_1m',  symbols: chunk },
                        { name: 'candlestick_5m',  symbols: chunk },
                        { name: 'candlestick_15m', symbols: chunk },
                        { name: 'candlestick_1h',  symbols: chunk },
                        { name: 'candlestick_4h',  symbols: chunk },
                        { name: 'ticker',          symbols: chunk },
                    ]
                }
            };
            this.ws.send(JSON.stringify(payload));
        }

        console.log(`[WS] Subscribed to candle & ticker channels for ${symbols.length} symbols`);
    }

    _handleMessage(msg) {
        const type = msg.type || '';

        // Subscription confirmations / channel errors
        if (type === 'subscriptions') {
            const errors = (msg.channels || []).filter(c => c.error);
            errors.forEach(c => console.warn(`[WS] Channel error: ${c.name} — ${c.error}`));
            return;
        }

        // Ticker messages (provides 5-second updates for all assets regardless of trades)
        if (type === 'ticker') {
            const symbol = msg.sy;
            if (!symbol) return;

            const close = parseFloat(msg.sp); // spot price
            const details = msg.d?.[0];
            if (isNaN(close) || !details) return;

            const change24h = details.m24hc ? parseFloat(details.m24hc) : 0;
            const volume24h = details.to?.[0] ? parseFloat(details.to[0]) : 0;
            const high24h   = details.ohlc?.[1] ? parseFloat(details.ohlc[1]) : close;
            const low24h    = details.ohlc?.[2] ? parseFloat(details.ohlc[2]) : close;

            const ticker = {
                symbol,
                price: close,
                change24h,
                volume24h,
                high24h,
                low24h,
                timestamp: Date.now(),
            };

            this.tickerMap.set(symbol, ticker);

            // Emit individual ticker for backward compatibility (Dashboard)
            this.io.emit('ticker', ticker);
            return;
        }

        // Candlestick messages
        // Format: { type:'candlestick_1m', sy:'BTCUSD', o, h, l, c, v, cst, res }
        if (type.startsWith('candlestick_')) {
            const symbol     = msg.sy;
            const resolution = msg.res || type.replace('candlestick_', '');
            if (!symbol) return;

            // candle_start is in microseconds on Delta India
            const timeUs  = msg.cst || msg.timestamp || 0;
            const timeSec = Math.floor(timeUs / 1_000_000);

            const open   = parseFloat(msg.o);
            const high   = parseFloat(msg.h);
            const low    = parseFloat(msg.l);
            const close  = parseFloat(msg.c);
            const volume = parseFloat(msg.v || 0);

            if (isNaN(open) || timeSec === 0) return;

            // ── Update live ticker from 1m candle (as a fallback) ──────────
            if (resolution === '1m') {
                this._updateTicker(symbol, close, high, low, volume);
            }

            // ── Emit candle update to frontend ─────────────────────────────
            this.io.emit('candle_update', {
                symbol, resolution, time: timeSec,
                open, high, low, close, volume
            });
        }
    }

    _updateTicker(symbol, close, high, low, volume) {
        const existing = this.tickerMap.get(symbol);

        // Track day-open price for 24h change calculation
        if (!this._dayOpen.has(symbol)) {
            this._dayOpen.set(symbol, close);
        }
        const dayOpen = this._dayOpen.get(symbol);
        const change24h = dayOpen > 0
            ? parseFloat(((close - dayOpen) / dayOpen * 100).toFixed(4))
            : 0;

        const ticker = {
            symbol,
            price: close,
            change24h,
            volume24h: (existing?.volume24h ?? 0) + volume,
            high24h: existing ? Math.max(existing.high24h ?? high, high) : high,
            low24h:  existing ? Math.min(existing.low24h  ?? low,  low)  : low,
            timestamp: Date.now(),
        };

        this.tickerMap.set(symbol, ticker);

        // Also emit individual ticker for backward compat (Dashboard)
        this.io.emit('ticker', ticker);
    }
}

module.exports = DeltaWebSocketManager;
