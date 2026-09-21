/**
 * atr.js — Average True Range (pure function)
 *
 * True Range = max(High-Low, |High-prevClose|, |Low-prevClose|)
 * ATR(14) uses Wilder's smoothing (same as RSI):
 *   Seed:      simple avg of first 14 TRs
 *   Smoothed:  ATR = (prevATR × 13 + currentTR) / 14
 *
 * @param {number[]} highs  - High prices  (oldest → newest)
 * @param {number[]} lows   - Low prices   (oldest → newest)
 * @param {number[]} closes - Close prices (oldest → newest)
 * @param {number}   period - Default 14
 * @returns {number|null}   - Most recent ATR value, or null if not enough data
 */
function calcATR(highs, lows, closes, period = 14) {
    if (
        !Array.isArray(highs)  || highs.length  < period + 1 ||
        !Array.isArray(lows)   || lows.length   < period + 1 ||
        !Array.isArray(closes) || closes.length < period + 1
    ) return null;

    // Step 1: compute True Range for each candle (needs prevClose)
    const trs = [];
    for (let i = 1; i < closes.length; i++) {
        const hl   = highs[i]  - lows[i];
        const hpc  = Math.abs(highs[i]  - closes[i - 1]);
        const lpc  = Math.abs(lows[i]   - closes[i - 1]);
        trs.push(Math.max(hl, hpc, lpc));
    }

    // Step 2: seed ATR = simple avg of first `period` TRs
    let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;

    // Step 3: Wilder's smoothing for the rest
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }

    return atr;
}

/**
 * Returns ATR as a percentage of current price.
 * Useful for regime detection (high/low volatility).
 *
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number}   period
 * @returns {number|null} - ATR as % of last close
 */
function calcATRPercent(highs, lows, closes, period = 14) {
    const atr = calcATR(highs, lows, closes, period);
    if (atr === null) return null;
    const lastClose = closes[closes.length - 1];
    return lastClose > 0 ? (atr / lastClose) * 100 : null;
}

module.exports = { calcATR, calcATRPercent };
