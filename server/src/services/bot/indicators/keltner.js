/**
 * keltner.js — Keltner Channels (pure function)
 *
 * Middle Line   = EMA(closes, period)
 * Upper Channel = Middle + (multiplier * ATR)
 * Lower Channel = Middle - (multiplier * ATR)
 *
 * Used with Bollinger Bands to detect TTM Squeezes:
 * Squeeze occurs when Bollinger Bands are completely inside Keltner Channels.
 *
 * @param {number[]} highs       - High prices
 * @param {number[]} lows        - Low prices
 * @param {number[]} closes      - Close prices
 * @param {number}   period      - Default 20
 * @param {number}   atrPeriod   - Default 14
 * @param {number}   multiplier  - Default 1.5
 * @returns {{ middle: number, upper: number, lower: number, atr: number } | null}
 */
const { calcEMA } = require('./ema');
const { calcATR } = require('./atr');

function calcKeltnerChannels(highs, lows, closes, period = 20, atrPeriod = 14, multiplier = 1.5) {
    if (
        !Array.isArray(highs)  || highs.length  < period + 1 ||
        !Array.isArray(lows)   || lows.length   < period + 1 ||
        !Array.isArray(closes) || closes.length < period + 1
    ) return null;

    const middle = calcEMA(closes, period);
    const atr = calcATR(highs, lows, closes, atrPeriod);

    if (middle === null || atr === null) return null;

    const upper = middle + (multiplier * atr);
    const lower = middle - (multiplier * atr);

    return {
        middle,
        upper,
        lower,
        atr,
    };
}

module.exports = { calcKeltnerChannels };
