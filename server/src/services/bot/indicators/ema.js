/**
 * ema.js — Exponential Moving Average (pure function)
 *
 * Formula: EMA_t = price_t × k + EMA_{t-1} × (1 - k)
 *          where k = 2 / (period + 1)
 *
 * @param {number[]} values - Array of prices (oldest → newest)
 * @param {number}   period - EMA period (e.g. 9, 21)
 * @returns {number|null}   - Most recent EMA value, or null if not enough data
 */
function calcEMA(values, period) {
    if (!Array.isArray(values) || values.length < period) return null;

    const k = 2 / (period + 1);

    // Seed: simple average of first `period` values
    let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;

    // Apply EMA formula from index `period` onwards
    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }

    return ema;
}

/**
 * Returns the EMA slope (difference between last two EMA values).
 * Positive = uptrend, Negative = downtrend.
 *
 * @param {number[]} values
 * @param {number}   period
 * @returns {number|null}
 */
function calcEMASlope(values, period) {
    if (!Array.isArray(values) || values.length < period + 1) return null;

    const emaNow  = calcEMA(values, period);
    const emaPrev = calcEMA(values.slice(0, -1), period);

    if (emaNow === null || emaPrev === null) return null;
    return emaNow - emaPrev;
}

module.exports = { calcEMA, calcEMASlope };
