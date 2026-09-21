/**
 * volume.js — Volume analysis (pure functions)
 *
 * Provides:
 *   - Simple Moving Average of volume over a lookback period
 *   - Volume ratio = current volume / average volume
 *     > 1.5 = elevated  → confirms signal
 *     < 0.7 = weak      → low conviction, may skip
 */

/**
 * Calculate average volume over the last `period` candles (excluding current).
 *
 * @param {number[]} volumes - Volume per candle (oldest → newest)
 * @param {number}   period  - Lookback period, default 20
 * @returns {number|null}
 */
function calcAvgVolume(volumes, period = 20) {
    if (!Array.isArray(volumes) || volumes.length < period + 1) return null;

    // Use the last `period` candles, excluding the very last (current, possibly incomplete)
    const slice = volumes.slice(-(period + 1), -1);
    return slice.reduce((s, v) => s + v, 0) / period;
}

/**
 * Calculate volume ratio: current candle volume / average volume.
 *
 * @param {number[]} volumes - Volume per candle (oldest → newest)
 * @param {number}   period  - Lookback period, default 20
 * @returns {number|null}    - e.g. 1.35 means 35% above average
 */
function calcVolumeRatio(volumes, period = 20) {
    const avgVol = calcAvgVolume(volumes, period);
    if (avgVol === null || avgVol === 0) return null;

    const currentVol = volumes[volumes.length - 1];
    return currentVol / avgVol;
}

module.exports = { calcAvgVolume, calcVolumeRatio };
