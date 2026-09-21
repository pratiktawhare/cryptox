/**
 * CandleStore.js
 *
 * In-memory ring buffer for OHLCV candles per (symbol, timeframe).
 *
 * Hooks into DeltaWebSocketManager's 'candle_update' events (emitted to Socket.IO).
 * For the bot, we need a server-side EventEmitter approach — we listen directly
 * on the WS manager instance rather than Socket.IO (to avoid round-trip).
 *
 * Supported timeframes: '1m', '5m'  (others ignored)
 *
 * Usage:
 *   const store = new CandleStore();
 *   store.attach(wsManager);           // subscribe to candle events
 *   store.getCandles('BTCUSD', '5m', 30)  // → last 30 5m candles
 *   store.hasEnoughData('BTCUSD', '5m', 30) // → boolean
 */

const EventEmitter = require('events');
const axios = require('axios');
const config = require('../../config/env');

// How many candles to keep per (symbol, timeframe)
const MAX_CANDLES = {
    '1m': 120,  // 2 hours of 1m data
    '5m': 100,  // ~8 hours of 5m data
};

// Minimum candles needed before indicators can fire
const MIN_CANDLES_REQUIRED = {
    '1m': 22,   // EMA21 needs 21 + a few extra
    '5m': 35,   // EMA21(14) + ATR(14) + RSI(14) need ~35
};

const SUPPORTED = new Set(['1m', '5m']);

class CandleStore extends EventEmitter {
    constructor() {
        super();
        // Map key: `${symbol}:${timeframe}` → array of candle objects (oldest first)
        this._store = new Map();
        this._wsManager = null;
        this._attached = false;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Attach to a DeltaWebSocketManager instance.
     * The WS manager needs a way to emit to server-side listeners.
     * We patch in an internal EventEmitter on the wsManager.
     *
     * @param {object} wsManager - DeltaWebSocketManager instance
     */
    attach(wsManager) {
        if (this._attached) return;
        this._wsManager = wsManager;

        // Patch: add server-side candle emitter to wsManager if not present
        if (!wsManager._candleEmitter) {
            wsManager._candleEmitter = new EventEmitter();
            wsManager._candleEmitter.setMaxListeners(20);

            // Intercept the existing _handleMessage to also emit server-side if present
            if (typeof wsManager._handleMessage === 'function') {
                const origHandle = wsManager._handleMessage.bind(wsManager);
                wsManager._handleMessage = (msg) => {
                    origHandle(msg);
                    const type = msg.type || '';
                    if (type.startsWith('candlestick_')) {
                        const resolution = msg.res || type.replace('candlestick_', '');
                        if (SUPPORTED.has(resolution)) {
                            wsManager._candleEmitter.emit('candle', {
                                symbol:     msg.sy,
                                resolution,
                                time:       Math.floor((msg.cst || msg.timestamp || 0) / 1_000_000),
                                open:       parseFloat(msg.o),
                                high:       parseFloat(msg.h),
                                low:        parseFloat(msg.l),
                                close:      parseFloat(msg.c),
                                volume:     parseFloat(msg.v || 0),
                            });
                        }
                    }
                };
            }
        }

        // Listen for candle events
        wsManager._candleEmitter.on('candle', (candle) => this._onCandle(candle));
        this._attached = true;
        console.log('[CandleStore] Attached to DeltaWebSocketManager');
    }

    detach() {
        if (this._wsManager?._candleEmitter) {
            this._wsManager._candleEmitter.removeAllListeners('candle');
        }
        this._attached = false;
        console.log('[CandleStore] Detached');
    }

    destroy() {
        this.detach();
        this._store.clear();
    }

    // ─── Internal candle handler ──────────────────────────────────────────────

    _onCandle({ symbol, resolution, time, open, high, low, close, volume }) {
        if (!symbol || !SUPPORTED.has(resolution)) return;
        if (isNaN(open) || isNaN(close) || time === 0) return;

        const key    = `${symbol}:${resolution}`;
        const candle = { time, open, high, low, close, volume };

        if (!this._store.has(key)) {
            this._store.set(key, []);
        }

        const buf = this._store.get(key);
        const max = MAX_CANDLES[resolution] || 100;

        // If this candle has the same timestamp as the last → update (live candle)
        if (buf.length > 0 && buf[buf.length - 1].time === time) {
            buf[buf.length - 1] = candle;
        } else {
            // New candle — push
            buf.push(candle);
            // Trim to max size (ring buffer)
            if (buf.length > max) buf.shift();
        }

        // Notify listeners that data is available for this symbol/timeframe
        this.emit('update', { symbol, resolution });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Get the last N candles for a symbol/timeframe.
     * Returns a new array (safe to mutate).
     *
     * @param {string} symbol       - e.g. 'BTCUSD'
     * @param {string} timeframe    - '1m' | '5m'
     * @param {number} count        - how many candles (from most recent)
     * @returns {object[]}          - array of { time, open, high, low, close, volume }
     */
    getCandles(symbol, timeframe, count = 50) {
        const key = `${symbol.toUpperCase()}:${timeframe}`;
        const buf = this._store.get(key);
        if (!buf || buf.length === 0) return [];
        return buf.slice(-count);
    }

    /**
     * Seed an array of historical candles into the store.
     * @param {string} symbol
     * @param {'1m'|'5m'} resolution
     * @param {object[]} candles - [{ time, open, high, low, close, volume }]
     */
    seedCandles(symbol, resolution, candles) {
        if (!symbol || !SUPPORTED.has(resolution) || !Array.isArray(candles)) return;
        const key = `${symbol.toUpperCase()}:${resolution}`;
        const max = MAX_CANDLES[resolution] || 100;
        const sorted = [...candles].sort((a, b) => a.time - b.time).slice(-max);
        this._store.set(key, sorted);
    }

    /**
     * Fetch historical candles via Delta REST API if buffer doesn't have enough data.
     * @param {string} symbol
     * @param {'1m'|'5m'} [resolution='5m']
     * @param {number} [count=50]
     * @returns {Promise<boolean>}
     */
    async ensureCandles(symbol, resolution = '5m', count = 50) {
        const sym = symbol.toUpperCase();
        if (this.hasEnoughData(sym, resolution)) return true;

        try {
            const resMin = resolution === '1m' ? 1 : 5;
            const endTs = Math.floor(Date.now() / 1000);
            const startTs = endTs - count * resMin * 60;

            const resp = await axios.get(`${config.deltaBaseUrl}/v2/history/candles`, {
                timeout: 8000,
                params: {
                    symbol: sym,
                    resolution,
                    start: startTs,
                    end: endTs,
                },
            });

            const raw = resp.data?.result || [];
            const candles = raw
                .filter(c => c.time && c.open && c.close)
                .map(c => ({
                    time: parseInt(c.time),
                    open: parseFloat(c.open),
                    high: parseFloat(c.high),
                    low: parseFloat(c.low),
                    close: parseFloat(c.close),
                    volume: parseFloat(c.volume || 0),
                }))
                .sort((a, b) => a.time - b.time);

            if (candles.length > 0) {
                this.seedCandles(sym, resolution, candles);
                return true;
            }
        } catch (err) {
            // Silently return false on network error
        }
        return false;
    }

    /**
     * Check if a symbol/timeframe has enough data for indicator calculation.
     *
     * @param {string} symbol
     * @param {string} timeframe
     * @param {number} [minCount]  - override minimum (optional)
     * @returns {boolean}
     */
    hasEnoughData(symbol, timeframe, minCount) {
        const key = `${symbol.toUpperCase()}:${timeframe}`;
        const buf = this._store.get(key);
        const required = minCount ?? (MIN_CANDLES_REQUIRED[timeframe] || 35);
        return buf ? buf.length >= required : false;
    }

    /**
     * Return all symbols that have enough 5m data to run indicators.
     * Used by the bot's multi-symbol scan.
     *
     * @param {number} [minCandles] - default from MIN_CANDLES_REQUIRED['5m']
     * @returns {string[]}
     */
    getSymbolsWithData(minCandles) {
        const required = minCandles ?? MIN_CANDLES_REQUIRED['5m'];
        const symbols = new Set();

        for (const key of this._store.keys()) {
            const [symbol, tf] = key.split(':');
            if (tf === '5m') {
                const buf = this._store.get(key);
                if (buf && buf.length >= required) {
                    symbols.add(symbol);
                }
            }
        }

        return [...symbols].sort();
    }

    /**
     * Get latest OHLC for a symbol from the most recent 1m candle.
     * Used for price, bid/ask approximation.
     *
     * @param {string} symbol
     * @returns {object|null}
     */
    getLatestCandle(symbol, timeframe = '1m') {
        const key = `${symbol.toUpperCase()}:${timeframe}`;
        const buf = this._store.get(key);
        if (!buf || buf.length === 0) return null;
        return buf[buf.length - 1];
    }

    /**
     * Returns a summary of what's in the store — useful for debugging.
     */
    getStats() {
        const stats = {};
        for (const [key, buf] of this._store.entries()) {
            stats[key] = buf.length;
        }
        return stats;
    }
}

// Singleton — one store shared across the whole bot
module.exports = new CandleStore();
