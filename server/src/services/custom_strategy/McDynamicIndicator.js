/**
 * McDynamicIndicator.js
 *
 * Implements the McGinley Dynamic (MCdynamic) indicator created by John R. McGinley.
 * A self-adjusting moving average that automatically tracks market velocity,
 * eliminating lag in trends and preventing false whipsaws during consolidation.
 *
 * Formula:
 *   MD[t] = MD[t-1] + (Close[t] - MD[t-1]) / (N * (Close[t] / MD[t-1])^4)
 *
 * Provides:
 *   - mcDynamic(candles, period, kPower): returns series array
 *   - mcDynamicPair(candles, fastPeriod, slowPeriod): returns { fast, slow }
 *   - evaluateDualCrossover(candles, fastPeriod, slowPeriod, triggerDiffPct)
 */

/**
 * Compute the McGinley Dynamic series for an array of OHLCV candles or prices.
 * @param {Array<object|number>} data - Candles ({ close, ... }) or array of closing prices
 * @param {number} [period=14] - Smoothing period N (e.g. 14, 50)
 * @param {number} [kPower=4] - Exponent power (default 4)
 * @returns {number[]} Array of McGinley Dynamic values aligned with input
 */
function mcDynamic(data, period = 14, kPower = 4) {
    if (!data || data.length === 0) return [];

    const closes = data.map(d => (typeof d === 'number' ? d : d.close));
    const result = new Array(closes.length).fill(null);

    // Filter valid positive starting price
    let startIdx = closes.findIndex(c => c != null && !isNaN(c) && c > 0);
    if (startIdx === -1) return result;

    // Initialize with first valid close
    result[startIdx] = closes[startIdx];

    for (let i = startIdx + 1; i < closes.length; i++) {
        const close = closes[i];
        const prevMD = result[i - 1];

        if (close == null || isNaN(close) || prevMD == null || prevMD <= 0) {
            result[i] = prevMD ?? close;
            continue;
        }

        // Velocity ratio: (Close / PrevMD)
        const ratio = close / prevMD;
        
        // Denominator adjustment factor: N * (ratio)^4
        // Guard against overflow or underflow
        const safeRatio = Math.max(0.1, Math.min(10, ratio));
        const adjustment = period * Math.pow(safeRatio, kPower);
        const safeAdjustment = Math.max(0.0001, adjustment);

        const currentMD = prevMD + (close - prevMD) / safeAdjustment;
        result[i] = parseFloat(currentMD.toFixed(8));
    }

    return result;
}

/**
 * Compute both Fast (e.g. MC14) and Slow (e.g. MC50) McGinley Dynamic series.
 * @param {Array} candles
 * @param {number} [fastPeriod=14]
 * @param {number} [slowPeriod=50]
 * @returns {{ fast: number[], slow: number[] }}
 */
function mcDynamicPair(candles, fastPeriod = 14, slowPeriod = 50) {
    return {
        fast: mcDynamic(candles, fastPeriod, 4),
        slow: mcDynamic(candles, slowPeriod, 4),
    };
}

/**
 * Evaluates dual MC crossover state (e.g. MC14 vs MC50) on the latest candles.
 * 
 * Classifications:
 *   - FRESH_BULLISH_CROSS: MC14 crossed above MC50 within last 1-2 candles
 *   - FRESH_BEARISH_CROSS: MC14 crossed below MC50 within last 1-2 candles
 *   - BULLISH_EXPANSION: MC14 > MC50, trending upwards
 *   - BEARISH_EXPANSION: MC14 < MC50, trending downwards
 *   - SQUEEZE_APPROACHING: Spread < 0.15%, lines compressing for imminent cross
 *
 * @param {Array} candles - OHLCV candles array (min 55 recommended)
 * @param {number} [fastPeriod=14]
 * @param {number} [slowPeriod=50]
 * @param {number} [triggerDiffPct=0.10] - Minimum spread % required for confirmation
 * @returns {object} Analysis result
 */
function evaluateDualCrossover(candles, fastPeriod = 14, slowPeriod = 50, triggerDiffPct = 0.10) {
    if (!candles || candles.length < slowPeriod) {
        return {
            status: 'INSUFFICIENT_DATA',
            candleCount: candles?.length || 0,
            required: slowPeriod,
        };
    }

    const { fast, slow } = mcDynamicPair(candles, fastPeriod, slowPeriod);
    const len = candles.length;
    const currentPrice = candles[len - 1].close;

    const currFast = fast[len - 1];
    const currSlow = slow[len - 1];
    const prevFast = fast[len - 2];
    const prevSlow = slow[len - 2];
    const prev2Fast = fast[len - 3];
    const prev2Slow = slow[len - 3];

    if (!currFast || !currSlow || !prevFast || !prevSlow) {
        return { status: 'INSUFFICIENT_DATA' };
    }

    // Spread percentage: (Fast - Slow) / Slow * 100
    const rawSpread = currFast - currSlow;
    const spreadPct = parseFloat(((rawSpread / currSlow) * 100).toFixed(4));
    const absSpreadPct = Math.abs(spreadPct);

    // Determine how many bars ago the last cross occurred (up to 30 bars lookback)
    let barsSinceCross = null;
    let crossDirection = null; // 'bullish' | 'bearish'

    for (let i = len - 1; i >= Math.max(1, len - 30); i--) {
        const fCurr = fast[i];
        const sCurr = slow[i];
        const fPrev = fast[i - 1];
        const sPrev = slow[i - 1];

        if (fCurr == null || sCurr == null || fPrev == null || sPrev == null) continue;

        if (fPrev <= sPrev && fCurr > sCurr) {
            barsSinceCross = (len - 1) - i;
            crossDirection = 'bullish';
            break;
        } else if (fPrev >= sPrev && fCurr < sCurr) {
            barsSinceCross = (len - 1) - i;
            crossDirection = 'bearish';
            break;
        }
    }

    // Check for fresh cross on the latest bar or bar immediately prior
    const isFreshBullishCross = 
        (prevFast <= prevSlow && currFast > currSlow) ||
        (prev2Fast != null && prev2Slow != null && prev2Fast <= prev2Slow && prevFast > prevSlow && barsSinceCross === 1);

    const isFreshBearishCross = 
        (prevFast >= prevSlow && currFast < currSlow) ||
        (prev2Fast != null && prev2Slow != null && prev2Fast >= prev2Slow && prevFast < prevSlow && barsSinceCross === 1);

    // Slope / momentum of fast MC (over last 3 candles)
    const fastSlope = currFast - prevFast;
    const slowSlope = currSlow - prevSlow;
    const fastSlopeDirection = fastSlope > 0 ? 'rising' : fastSlope < 0 ? 'falling' : 'flat';

    // Status assignment
    let status = 'NEUTRAL';
    let isConfirmedByBuffer = absSpreadPct >= triggerDiffPct;

    if (isFreshBullishCross) {
        status = isConfirmedByBuffer ? 'FRESH_BULLISH_CROSS' : 'BULLISH_CROSS_UNCONFIRMED';
    } else if (isFreshBearishCross) {
        status = isConfirmedByBuffer ? 'FRESH_BEARISH_CROSS' : 'BEARISH_CROSS_UNCONFIRMED';
    } else if (absSpreadPct < 0.15) {
        status = 'SQUEEZE_APPROACHING'; // Lines compressing, breakout impending
    } else if (currFast > currSlow) {
        status = 'BULLISH_EXPANSION';
    } else if (currFast < currSlow) {
        status = 'BEARISH_EXPANSION';
    }

    // Distance of price from MC lines
    const priceToFastPct = parseFloat((((currentPrice - currFast) / currFast) * 100).toFixed(3));
    const priceToSlowPct = parseFloat((((currentPrice - currSlow) / currSlow) * 100).toFixed(3));

    return {
        status,
        symbol: candles[len - 1].symbol || null,
        currentPrice,
        fastPeriod,
        slowPeriod,
        fastValue: currFast,
        slowValue: currSlow,
        spread: parseFloat(rawSpread.toFixed(8)),
        spreadPct,
        absSpreadPct,
        triggerDiffPct,
        isConfirmedByBuffer,
        barsSinceCross: barsSinceCross !== null ? barsSinceCross : '>30',
        crossDirection,
        fastSlope: parseFloat(fastSlope.toFixed(8)),
        fastSlopeDirection,
        slowSlope: parseFloat(slowSlope.toFixed(8)),
        priceToFastPct,
        priceToSlowPct,
        isPriceAboveFast: currentPrice >= currFast,
        isPriceAboveSlow: currentPrice >= currSlow,
        timestamp: candles[len - 1].time || Math.floor(Date.now() / 1000),
    };
}

module.exports = {
    mcDynamic,
    mcDynamicPair,
    evaluateDualCrossover,
};

