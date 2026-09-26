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
const { calcBollingerBands } = require('./indicators/bollinger');
const { calcKeltnerChannels } = require('./indicators/keltner');

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
    // Confirmed completed candles: candles5m.slice(0, -1) to avoid intra-candle phantom wicks.
    // If not enough completed candles, fallback to full array.
    const closedCandles5m = candles5m.length > 25 ? candles5m.slice(0, -1) : candles5m;
    const closedCloses5m  = closedCandles5m.map(c => c.close);
    const closedHighs5m   = closedCandles5m.map(c => c.high);
    const closedLows5m    = closedCandles5m.map(c => c.low);
    const closedVolumes5m = closedCandles5m.map(c => c.volume);

    // Live price from ticker or latest ticking bar
    let livePrice = candles5m[candles5m.length - 1].close;
    if (wsManager?.getPrice) {
        const p = wsManager.getPrice(sym);
        if (p && p > 0) livePrice = p;
    }
    const currentClose = livePrice;

    // ── 5m Indicators (computed on confirmed CLOSED candles) ────────────────
    const ema9_5m       = calcEMA(closedCloses5m, 9);
    const ema21_5m      = calcEMA(closedCloses5m, 21);
    const ema21Slope_5m = calcEMASlope(closedCloses5m, 21);
    const rsi_5m        = calcRSI(closedCloses5m, 14);
    const atr_5m        = calcATR(closedHighs5m, closedLows5m, closedCloses5m, 14);
    const atrPct_5m     = calcATRPercent(closedHighs5m, closedLows5m, closedCloses5m, 14);
    const volumeRatio   = calcVolumeRatio(closedVolumes5m, 20);

    // RSI slope: current RSI minus RSI computed without the last candle → detects momentum deceleration
    const rsiPrev_5m   = closedCandles5m.length > 16 ? calcRSI(closedCloses5m.slice(0, -1), 14) : null;
    const rsiSlope_5m  = (rsi_5m !== null && rsiPrev_5m !== null) ? (rsi_5m - rsiPrev_5m) : null;

    // Stretch ratio: how many ATRs the live close is from EMA21 → measures overextension
    const stretchRatio_5m = (atr_5m !== null && atr_5m > 0 && ema21_5m !== null)
        ? Math.abs(currentClose - ema21_5m) / atr_5m
        : null;

    // Bollinger Bands & Keltner Channels (TTM Squeeze Detection)
    const bb5m = calcBollingerBands(closedCloses5m, 20, 2.0);
    const kc5m = calcKeltnerChannels(closedHighs5m, closedLows5m, closedCloses5m, 20, 14, 1.5);
    const inSqueeze5m = (bb5m && kc5m)
        ? (bb5m.upper <= kc5m.upper && bb5m.lower >= kc5m.lower)
        : false;
    const squeezeBandwidth5m = bb5m?.bandwidth ?? null;

    // ── 1m Indicators ───────────────────────────────────────────────────────
    const closes1mFull  = candles1m.map(c => c.close);
    const ema9_1m       = calcEMA(closes1mFull, 9);
    const ema21_1m      = calcEMA(closes1mFull, 21);
    const rsi_1m        = calcRSI(closes1mFull, 14);
    const momentum_1m   = calcMomentum(closes1mFull, 5);

    // 1m wick absorption ratio (detects buyer/seller absorption on pullbacks)
    const last1m = candles1m[candles1m.length - 1];
    const range1m = Math.max(last1m.high - last1m.low, 0.000001);
    const lowerWick1m = Math.max(0, Math.min(last1m.open, last1m.close) - last1m.low);
    const upperWick1m = Math.max(0, last1m.high - Math.max(last1m.open, last1m.close));
    const lowerWickRatio1m = lowerWick1m / range1m;
    const upperWickRatio1m = upperWick1m / range1m;

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
            bollinger:   bb5m,
            keltner:     kc5m,
            inSqueeze:   inSqueeze5m,
            squeezeBandwidth: squeezeBandwidth5m,
            close:       currentClose,
            closedClose: closedCloses5m[closedCloses5m.length - 1],
        },

        // 1m timeframe
        '1m': {
            ema9:            ema9_1m,
            ema21:           ema21_1m,
            rsi:             rsi_1m,
            momentum:        momentum_1m,
            lowerWickRatio:  lowerWickRatio1m,
            upperWickRatio:  upperWickRatio1m,
            close:           closes1mFull[closes1mFull.length - 1],
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
