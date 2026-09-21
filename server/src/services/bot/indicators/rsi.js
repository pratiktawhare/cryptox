/**
 * rsi.js — Relative Strength Index (pure function)
 *
 * Standard Wilder's smoothed RSI(14):
 *   1. Compute gain/loss for each period
 *   2. Seed: simple avg of first 14 gains and losses
 *   3. Smooth: avgGain = (prevAvgGain × 13 + currentGain) / 14
 *   4. RSI = 100 - (100 / (1 + RS)),  RS = avgGain / avgLoss
 *
 * @param {number[]} closes - Close prices (oldest → newest), min length: period + 1
 * @param {number}   period - Default 14
 * @returns {number|null}   - RSI value 0–100, or null if not enough data
 */
function calcRSI(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length < period + 1) return null;

    // Step 1: calculate all changes
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
        changes.push(closes[i] - closes[i - 1]);
    }

    // Step 2: seed avg gain/loss from first `period` changes
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 0; i < period; i++) {
        if (changes[i] > 0) avgGain += changes[i];
        else                  avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;

    // Step 3: Wilder's smoothing for remaining changes
    for (let i = period; i < changes.length; i++) {
        const gain = changes[i] > 0 ? changes[i] : 0;
        const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    // Step 4: RSI
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

module.exports = { calcRSI };
