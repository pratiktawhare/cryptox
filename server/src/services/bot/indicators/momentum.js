/**
 * momentum.js — Short-term price momentum (pure function)
 *
 * Rate of Change (ROC):
 *   momentum = (close_now - close_n_periods_ago) / close_n_periods_ago × 100
 *
 * Interpretation:
 *   > 0  = positive momentum (price rising)
 *   < 0  = negative momentum (price falling)
 *   ≈ 0  = ranging / no momentum
 *
 * @param {number[]} closes - Close prices (oldest → newest)
 * @param {number}   period - Lookback period, default 5
 * @returns {number|null}   - Momentum as % change, or null if not enough data
 */
function calcMomentum(closes, period = 5) {
    if (!Array.isArray(closes) || closes.length < period + 1) return null;

    const current = closes[closes.length - 1];
    const past    = closes[closes.length - 1 - period];

    if (past === 0) return null;
    return ((current - past) / past) * 100;
}

/**
 * Returns true if momentum confirms the intended trade direction.
 *
 * @param {number|null} momentum
 * @param {'long'|'short'} direction
 * @param {number} threshold - minimum |momentum| to be considered meaningful (default 0.05%)
 * @returns {boolean}
 */
function isMomentumConfirming(momentum, direction, threshold = 0.05) {
    if (momentum === null) return false;
    if (direction === 'long')  return momentum >  threshold;
    if (direction === 'short') return momentum < -threshold;
    return false;
}

module.exports = { calcMomentum, isMomentumConfirming };
