/**
 * SmartMoneyConcepts.js
 *
 * Smart Money Concepts (SMC) engine.
 * Detects: Order Blocks, Fair Value Gaps (FVG), Liquidity Sweeps,
 *          Break of Structure (BOS), Change of Character (CHoCH),
 *          Premium/Discount zones, and Equal Highs/Lows.
 *
 * Usage:
 *   const smc = require('./SmartMoneyConcepts');
 *   const result = smc.analyze(candles);
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isUp   = (c) => c.close >= c.open;
const body   = (c) => Math.abs(c.close - c.open);
const avgBody = (candles) => {
    const bodies = candles.map(body);
    return bodies.reduce((a, b) => a + b, 0) / bodies.length;
};

// ─── Order Blocks ─────────────────────────────────────────────────────────────

/**
 * An Order Block is the last opposing candle before a strong impulse move.
 *
 * Bullish OB: last bearish candle before a strong bullish impulse.
 * Bearish OB: last bullish candle before a strong bearish impulse.
 */
function findOrderBlocks(candles, lookback = 50, impulseThreshold = 1.5) {
    const result = { bullish: [], bearish: [] };
    if (candles.length < 4) return result;

    const avg = avgBody(candles);
    const start = Math.max(0, candles.length - lookback);

    for (let i = start + 1; i < candles.length - 2; i++) {
        const c      = candles[i];
        const next1  = candles[i + 1];
        const next2  = i + 2 < candles.length ? candles[i + 2] : null;

        // Bullish OB: bearish candle, then strong bullish move
        if (!isUp(c) && isUp(next1) && body(next1) > avg * impulseThreshold) {
            result.bullish.push({
                index: i,
                high:  c.high,
                low:   c.low,
                time:  c.time,
                // strength: how big was the impulse relative to OB size
                strength: parseFloat((body(next1) / (body(c) || 1)).toFixed(2)),
                mitigated: false, // will be checked below
            });
        }

        // Bearish OB: bullish candle, then strong bearish move
        if (isUp(c) && !isUp(next1) && body(next1) > avg * impulseThreshold) {
            result.bearish.push({
                index: i,
                high:  c.high,
                low:   c.low,
                time:  c.time,
                strength: parseFloat((body(next1) / (body(c) || 1)).toFixed(2)),
                mitigated: false,
            });
        }
    }

    // Mark mitigated OBs (price traded back through them)
    const currentHigh = Math.max(...candles.slice(-5).map(c => c.high));
    const currentLow  = Math.min(...candles.slice(-5).map(c => c.low));

    for (const ob of result.bullish) {
        ob.mitigated = currentLow < ob.low;
    }
    for (const ob of result.bearish) {
        ob.mitigated = currentHigh > ob.high;
    }

    // Return only last 5 unmitigated of each
    return {
        bullish: result.bullish.filter(ob => !ob.mitigated).slice(-5),
        bearish: result.bearish.filter(ob => !ob.mitigated).slice(-5),
    };
}

// ─── Fair Value Gaps ──────────────────────────────────────────────────────────

/**
 * A Fair Value Gap (FVG / Imbalance) is a 3-candle structure where there is
 * a gap between candle[i-1].high and candle[i+1].low (bullish FVG)
 * or between candle[i+1].high and candle[i-1].low (bearish FVG).
 */
function findFairValueGaps(candles, lookback = 50) {
    const result = { bullish: [], bearish: [] };
    if (candles.length < 3) return result;

    const start = Math.max(1, candles.length - lookback);

    for (let i = start; i < candles.length - 1; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const next = candles[i + 1];

        // Bullish FVG: big bullish middle candle, gap above prev high and below next low
        if (isUp(curr) && next.low > prev.high) {
            result.bullish.push({
                top:   next.low,
                bottom: prev.high,
                size:  parseFloat((next.low - prev.high).toFixed(8)),
                time:  curr.time,
                index: i,
                filled: false,
            });
        }

        // Bearish FVG: big bearish middle candle, gap below prev low and above next high
        if (!isUp(curr) && next.high < prev.low) {
            result.bearish.push({
                top:    prev.low,
                bottom: next.high,
                size:   parseFloat((prev.low - next.high).toFixed(8)),
                time:   curr.time,
                index:  i,
                filled: false,
            });
        }
    }

    // Check if filled (price traded into the gap)
    const lastCandles = candles.slice(-10);
    const lastLow  = Math.min(...lastCandles.map(c => c.low));
    const lastHigh = Math.max(...lastCandles.map(c => c.high));

    for (const fvg of result.bullish) {
        fvg.filled = lastLow < fvg.bottom;
    }
    for (const fvg of result.bearish) {
        fvg.filled = lastHigh > fvg.top;
    }

    return {
        bullish: result.bullish.filter(f => !f.filled).slice(-3),
        bearish: result.bearish.filter(f => !f.filled).slice(-3),
    };
}

// ─── Liquidity Sweeps ─────────────────────────────────────────────────────────

/**
 * A Liquidity Sweep occurs when price breaks a recent high/low (sweeping stop
 * losses clustered there) and immediately reverses.
 */
function findLiquiditySweeps(candles, lookback = 30) {
    const result = [];
    if (candles.length < lookback + 2) return result;

    const recent = candles.slice(-lookback - 2);

    for (let i = lookback; i < recent.length - 1; i++) {
        const lookbackSlice = recent.slice(i - lookback, i);
        const localHigh = Math.max(...lookbackSlice.map(c => c.high));
        const localLow  = Math.min(...lookbackSlice.map(c => c.low));
        const c    = recent[i];
        const next = recent[i + 1];

        // Bullish sweep: wick below recent low, close above
        if (c.low < localLow && c.close > localLow && isUp(next)) {
            result.push({
                type:  'bullish',
                level: localLow,
                wick:  c.low,
                time:  c.time,
                index: i,
            });
        }

        // Bearish sweep: wick above recent high, close below
        if (c.high > localHigh && c.close < localHigh && !isUp(next)) {
            result.push({
                type:  'bearish',
                level: localHigh,
                wick:  c.high,
                time:  c.time,
                index: i,
            });
        }
    }

    return result.slice(-4);
}

// ─── Break of Structure / Change of Character ─────────────────────────────────

/**
 * BOS: continuation break of previous swing high/low.
 * CHoCH: first break in the opposite direction of the prevailing trend.
 */
function findStructureBreaks(candles) {
    if (candles.length < 10) return { bos: [], choch: [] };

    const bos = [], choch = [];

    // Find swing highs / lows using a 5-bar pivot
    const swingHighs = [], swingLows = [];

    for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        const isSwingHigh = c.high > candles[i-1].high && c.high > candles[i-2].high &&
                            c.high > candles[i+1].high && c.high > candles[i+2].high;
        const isSwingLow  = c.low < candles[i-1].low && c.low < candles[i-2].low &&
                            c.low < candles[i+1].low && c.low < candles[i+2].low;
        if (isSwingHigh) swingHighs.push({ price: c.high, time: c.time, index: i });
        if (isSwingLow)  swingLows.push({ price: c.low,  time: c.time, index: i });
    }

    const lastClose = candles[candles.length - 1].close;
    const lastHigh  = candles[candles.length - 1].high;
    const lastLow   = candles[candles.length - 1].low;

    // BOS Bullish: price closes above previous swing high
    if (swingHighs.length >= 2) {
        const prevHigh = swingHighs[swingHighs.length - 2];
        const lastHigh2 = swingHighs[swingHighs.length - 1];
        if (lastHigh2.price > prevHigh.price) {
            bos.push({ type: 'bullish', level: prevHigh.price, time: lastHigh2.time });
        }
        if (lastLow < prevHigh.price) {
            choch.push({ type: 'bearish', level: prevHigh.price, time: candles[candles.length - 1].time });
        }
    }

    // BOS Bearish: price closes below previous swing low
    if (swingLows.length >= 2) {
        const prevLow = swingLows[swingLows.length - 2];
        const lastLow2 = swingLows[swingLows.length - 1];
        if (lastLow2.price < prevLow.price) {
            bos.push({ type: 'bearish', level: prevLow.price, time: lastLow2.time });
        }
        if (lastHigh > prevLow.price) {
            choch.push({ type: 'bullish', level: prevLow.price, time: candles[candles.length - 1].time });
        }
    }

    return {
        bos: bos.slice(-3),
        choch: choch.slice(-3),
        swingHighs: swingHighs.slice(-6),
        swingLows: swingLows.slice(-6)
    };
}

// ─── Premium / Discount Zones ─────────────────────────────────────────────────

/**
 * Based on Fibonacci levels between the last major swing low and high.
 * Premium: above 50% = area where institutions sell.
 * Discount: below 50% = area where institutions buy.
 */
function findPremiumDiscount(candles, lookback = 50) {
    const slice = candles.slice(-lookback);
    const high  = Math.max(...slice.map(c => c.high));
    const low   = Math.min(...slice.map(c => c.low));
    const range = high - low;
    if (range <= 0) return null;

    const last  = candles[candles.length - 1].close;
    const pct   = (last - low) / range;

    return {
        rangeHigh: parseFloat(high.toFixed(8)),
        rangeLow:  parseFloat(low.toFixed(8)),
        equilibrium: parseFloat(((high + low) / 2).toFixed(8)),
        fib618:    parseFloat((low + range * 0.618).toFixed(8)),
        fib382:    parseFloat((low + range * 0.382).toFixed(8)),
        currentPct: parseFloat((pct * 100).toFixed(2)),
        zone: pct > 0.618 ? 'premium' : pct < 0.382 ? 'discount' : 'equilibrium',
    };
}

// ─── Equal Highs / Lows ───────────────────────────────────────────────────────

function findEqualHighsLows(candles, lookback = 30, tolerance = 0.002) {
    const slice = candles.slice(-lookback);
    const result = { equalHighs: [], equalLows: [] };

    for (let i = 0; i < slice.length - 1; i++) {
        for (let j = i + 1; j < slice.length; j++) {
            const hDiff = Math.abs(slice[i].high - slice[j].high) / slice[i].high;
            const lDiff = Math.abs(slice[i].low  - slice[j].low)  / slice[i].low;

            if (hDiff < tolerance) {
                result.equalHighs.push({
                    price: (slice[i].high + slice[j].high) / 2,
                    timeA: slice[i].time, timeB: slice[j].time,
                });
            }
            if (lDiff < tolerance) {
                result.equalLows.push({
                    price: (slice[i].low + slice[j].low) / 2,
                    timeA: slice[i].time, timeB: slice[j].time,
                });
            }
        }
    }

    // Deduplicate
    const dedup = (arr) => {
        const seen = new Set();
        return arr.filter(e => {
            const key = e.price.toFixed(2);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    return {
        equalHighs: dedup(result.equalHighs).slice(-3),
        equalLows:  dedup(result.equalLows).slice(-3),
    };
}

// ─── Main analyze function ────────────────────────────────────────────────────

/**
 * Full SMC analysis.
 * @param {object[]} candles — OHLCV candle array (30+ recommended)
 * @returns {SmcSnapshot}
 */
function analyze(candles) {
    if (!candles || candles.length < 10) {
        return { error: 'Insufficient candle data for SMC analysis' };
    }

    const orderBlocks     = findOrderBlocks(candles);
    const fvgs            = findFairValueGaps(candles);
    const liquiditySweeps = findLiquiditySweeps(candles);
    const structure       = findStructureBreaks(candles);
    const premiumDiscount = findPremiumDiscount(candles);
    const equalLevels     = findEqualHighsLows(candles);

    // Determine overall SMC bias
    const bullScore = orderBlocks.bullish.length + fvgs.bullish.length +
                      liquiditySweeps.filter(s => s.type === 'bullish').length +
                      structure.bos.filter(b => b.type === 'bullish').length;

    const bearScore = orderBlocks.bearish.length + fvgs.bearish.length +
                      liquiditySweeps.filter(s => s.type === 'bearish').length +
                      structure.bos.filter(b => b.type === 'bearish').length;

    const bias = bullScore > bearScore ? 'bullish' : bearScore > bullScore ? 'bearish' : 'neutral';

    return {
        orderBlocks,
        fvgs,
        liquiditySweeps,
        structure,
        premiumDiscount,
        equalLevels,
        bias,
        timestamp: Date.now(),
    };
}

module.exports = { analyze, findOrderBlocks, findFairValueGaps, findLiquiditySweeps, findStructureBreaks, findPremiumDiscount };
