/**
 * MarketAnalyzer.js
 *
 * Runs all technical indicators on a single symbol using CandleStore data.
 * Returns a normalized market snapshot used by RegimeDetector and SignalScorer.
 *
 * Called per symbol during multi-symbol scan.
 * Pure computation — no DB writes, no side effects.
 */

const candleStore        = require('./CandleStore');
const { calcEMA, calcEMASlope } = require('./indicators/ema');
const { calcRSI }        = require('./indicators/rsi');
const { calcATR, calcATRPercent } = require('./indicators/atr');
const { calcVolumeRatio } = require('./indicators/volume');
const { calcMomentum }   = require('./indicators/momentum');

/**
 * Analyze a single symbol and return a full market snapshot.
 *
 * @param {string} symbol          - e.g. 'BTCUSD'
 * @param {object} wsManager       - DeltaWebSocketManager (for bid/ask/spread)
 * @returns {object|null}          - Market snapshot, or null if not enough data
 */
function analyzeSymbol(symbol, wsManager) {
    const sym = symbol.toUpperCase();

    // ── Candle data ─────────────────────────────────────────────────────────
    // We need 35 candles for 5m indicators, 22 for 1m
    if (!candleStore.hasEnoughData(sym, '5m') || !candleStore.hasEnoughData(sym, '1m')) {
        return null;
    }

    const candles5m = candleStore.getCandles(sym, '5m', 50);
    const candles1m = candleStore.getCandles(sym, '1m', 30);

    if (candles5m.length < 25 || candles1m.length < 22) return null;

    // ── Extract arrays ──────────────────────────────────────────────────────
    const closes5m  = candles5m.map(c => c.close);
    const highs5m   = candles5m.map(c => c.high);
    const lows5m    = candles5m.map(c => c.low);
    const volumes5m = candles5m.map(c => c.volume);

    const closes1m  = candles1m.map(c => c.close);

    const currentClose = closes5m[closes5m.length - 1];

    // ── 5m Indicators ───────────────────────────────────────────────────────
    const ema9_5m       = calcEMA(closes5m, 9);
    const ema21_5m      = calcEMA(closes5m, 21);
    const ema21Slope_5m = calcEMASlope(closes5m, 21);
    const rsi_5m        = calcRSI(closes5m, 14);
    const atr_5m        = calcATR(highs5m, lows5m, closes5m, 14);
    const atrPct_5m     = calcATRPercent(highs5m, lows5m, closes5m, 14);
    const volumeRatio   = calcVolumeRatio(volumes5m, 20);

    // RSI slope: current RSI minus RSI computed without the last candle → detects momentum deceleration
    const rsiPrev_5m   = candles5m.length > 16 ? calcRSI(closes5m.slice(0, -1), 14) : null;
    const rsiSlope_5m  = (rsi_5m !== null && rsiPrev_5m !== null) ? (rsi_5m - rsiPrev_5m) : null;

    // Stretch ratio: how many ATRs the close is from EMA21 → measures overextension
    const stretchRatio_5m = (atr_5m !== null && atr_5m > 0 && ema21_5m !== null)
        ? Math.abs(currentClose - ema21_5m) / atr_5m
        : null;

    // ── 1m Indicators ───────────────────────────────────────────────────────
    const closes1mFull  = candles1m.map(c => c.close);
    const ema9_1m       = calcEMA(closes1mFull, 9);
    const ema21_1m      = calcEMA(closes1mFull, 21);
    const rsi_1m        = calcRSI(closes1mFull, 14);
    const momentum_1m   = calcMomentum(closes1mFull, 5);

    // ── Spread (from live ticker) ────────────────────────────────────────────
    // Delta's WebSocket ticker doesn't always have bid/ask separately.
    // We estimate spread as a small fraction of ATR as fallback.
    let spread = null;
    if (wsManager) {
        const ticker = wsManager.getTicker(sym);
        if (ticker?.bid && ticker?.ask) {
            spread = ticker.ask - ticker.bid;
        } else if (atr_5m !== null) {
            spread = atr_5m * 0.05; // ~5% of ATR as conservative estimate
        }
    }

    // ── Funding rate (from ticker if available) ──────────────────────────────
    let fundingRate = null;
    if (wsManager) {
        const ticker = wsManager.getTicker(sym);
        if (ticker?.fundingRate != null) {
            fundingRate = parseFloat(ticker.fundingRate);
        }
    }

    // ── Return normalized snapshot ───────────────────────────────────────────
    return {
        symbol: sym,
        timestamp: Date.now(),

        // Price
        close:  currentClose,
        spread: spread,
        fundingRate: fundingRate,

        // 5m timeframe
        '5m': {
            ema9:        ema9_5m,
            ema21:       ema21_5m,
            ema21Slope:  ema21Slope_5m,
            rsi:         rsi_5m,
            rsiSlope:    rsiSlope_5m,    // RSI this bar minus RSI previous bar (deceleration)
            atr:         atr_5m,
            atrPct:      atrPct_5m,      // ATR as % of price — for regime detection
            stretchRatio: stretchRatio_5m, // |close - EMA21| / ATR — overextension gauge
            volumeRatio: volumeRatio,
            close:       currentClose,
        },

        // 1m timeframe
        '1m': {
            ema9:     ema9_1m,
            ema21:    ema21_1m,
            rsi:      rsi_1m,
            momentum: momentum_1m,
            close:    closes1mFull[closes1mFull.length - 1],
        },
    };
}

/**
 * Analyze multiple symbols and return an array of snapshots.
 * Symbols without enough data are skipped (null filtered out).
 *
 * @param {string[]} symbols
 * @param {object}   wsManager
 * @returns {object[]}  - array of market snapshots
 */
function analyzeSymbols(symbols, wsManager) {
    const results = [];
    for (const symbol of symbols) {
        const snapshot = analyzeSymbol(symbol, wsManager);
        if (snapshot !== null) results.push(snapshot);
    }
    return results;
}

module.exports = { analyzeSymbol, analyzeSymbols };
