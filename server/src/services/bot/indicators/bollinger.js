/**
 * bollinger.js — Bollinger Bands (pure function)
 *
 * Middle Band = SMA(closes, period)
 * Upper Band  = Middle + (stdDevMultiplier * StdDev)
 * Lower Band  = Middle - (stdDevMultiplier * StdDev)
 * Bandwidth   = (Upper - Lower) / Middle
 *
 * @param {number[]} closes            - Close prices (oldest -> newest)
 * @param {number}   period            - Default 20
 * @param {number}   stdDevMultiplier  - Default 2.0
 * @returns {{ middle: number, upper: number, lower: number, bandwidth: number, stdDev: number } | null}
 */
function calcBollingerBands(closes, period = 20, stdDevMultiplier = 2.0) {
    if (!Array.isArray(closes) || closes.length < period) return null;

    const slice = closes.slice(-period);
    const middle = slice.reduce((sum, val) => sum + val, 0) / period;

    const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upper = middle + (stdDevMultiplier * stdDev);
    const lower = middle - (stdDevMultiplier * stdDev);
    const bandwidth = middle > 0 ? (upper - lower) / middle : 0;

    return {
        middle,
        upper,
        lower,
        bandwidth,
        stdDev,
    };
}

module.exports = { calcBollingerBands };
