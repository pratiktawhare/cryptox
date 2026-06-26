/**
 * PatternDetector.js
 *
 * Candlestick pattern recognition engine.
 * Detects 25+ classic and SMC-adjacent patterns.
 *
 * Usage:
 *   const { detect } = require('./PatternDetector');
 *   const patterns = detect(candles); // returns PatternResult[]
 *
 * Each PatternResult: { name, type, significance, candle_index }
 *   type:         'bullish' | 'bearish' | 'neutral'
 *   significance: 'low' | 'medium' | 'high'
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const body   = (c) => Math.abs(c.close - c.open);
const range  = (c) => c.high - c.low;
const isUp   = (c) => c.close >= c.open;
const topWick    = (c) => isUp(c) ? c.high - c.close : c.high - c.open;
const bottomWick = (c) => isUp(c) ? c.open - c.low  : c.close - c.low;
const midPoint   = (c) => (c.high + c.low) / 2;
const bodyRatio  = (c) => range(c) > 0 ? body(c) / range(c) : 0;

// ─── Single-candle patterns ───────────────────────────────────────────────────

function isDoji(c) {
    return bodyRatio(c) < 0.1;
}

function isHammer(c) {
    // Small body at top, long lower wick (>= 2× body), small or no upper wick
    return body(c) > 0 &&
           bottomWick(c) >= 2 * body(c) &&
           topWick(c) <= 0.3 * body(c);
}

function isInvertedHammer(c) {
    return body(c) > 0 &&
           topWick(c) >= 2 * body(c) &&
           bottomWick(c) <= 0.3 * body(c);
}

function isShootingStar(c) {
    return !isUp(c) && isInvertedHammer(c);
}

function isMarubozu(c) {
    // Candle with no (or tiny) wicks
    return bodyRatio(c) > 0.92;
}

function isSpinningTop(c) {
    return bodyRatio(c) < 0.3 && bodyRatio(c) > 0.1;
}

// ─── Two-candle patterns ──────────────────────────────────────────────────────

function isBullishEngulfing(c1, c2) {
    return !isUp(c1) && isUp(c2) &&
           c2.open < c1.close && c2.close > c1.open;
}

function isBearishEngulfing(c1, c2) {
    return isUp(c1) && !isUp(c2) &&
           c2.open > c1.close && c2.close < c1.open;
}

function isBullishHarami(c1, c2) {
    return !isUp(c1) && isUp(c2) &&
           c2.open > c1.close && c2.close < c1.open &&
           body(c2) < body(c1) * 0.5;
}

function isBearishHarami(c1, c2) {
    return isUp(c1) && !isUp(c2) &&
           c2.open < c1.close && c2.close > c1.open &&
           body(c2) < body(c1) * 0.5;
}

function isTweezerBottom(c1, c2) {
    return !isUp(c1) && isUp(c2) &&
           Math.abs(c1.low - c2.low) / c1.low < 0.001;
}

function isTweezerTop(c1, c2) {
    return isUp(c1) && !isUp(c2) &&
           Math.abs(c1.high - c2.high) / c1.high < 0.001;
}

function isPiercing(c1, c2) {
    return !isUp(c1) && isUp(c2) &&
           c2.open < c1.low &&
           c2.close > midPoint(c1) && c2.close < c1.open;
}

function isDarkCloudCover(c1, c2) {
    return isUp(c1) && !isUp(c2) &&
           c2.open > c1.high &&
           c2.close < midPoint(c1) && c2.close > c1.open;
}

function isKicker(c1, c2) {
    // Strong momentum reversal: gap in opposite direction
    if (isUp(c1) && !isUp(c2)) {
        return c2.open < c1.open && body(c2) > body(c1) * 0.8;
    }
    if (!isUp(c1) && isUp(c2)) {
        return c2.open > c1.open && body(c2) > body(c1) * 0.8;
    }
    return false;
}

// ─── Three-candle patterns ────────────────────────────────────────────────────

function isMorningStar(c1, c2, c3) {
    return !isUp(c1) && body(c1) > 0 &&
           isDoji(c2) &&
           isUp(c3) && body(c3) > body(c1) * 0.5 &&
           c3.close > midPoint(c1);
}

function isEveningStar(c1, c2, c3) {
    return isUp(c1) && body(c1) > 0 &&
           isDoji(c2) &&
           !isUp(c3) && body(c3) > body(c1) * 0.5 &&
           c3.close < midPoint(c1);
}

function isThreeWhiteSoldiers(c1, c2, c3) {
    return isUp(c1) && isUp(c2) && isUp(c3) &&
           c2.open > c1.open && c2.open < c1.close &&
           c3.open > c2.open && c3.open < c2.close &&
           c3.close > c2.close &&
           bodyRatio(c1) > 0.6 && bodyRatio(c2) > 0.6 && bodyRatio(c3) > 0.6;
}

function isThreeBlackCrows(c1, c2, c3) {
    return !isUp(c1) && !isUp(c2) && !isUp(c3) &&
           c2.open < c1.open && c2.open > c1.close &&
           c3.open < c2.open && c3.open > c2.close &&
           c3.close < c2.close &&
           bodyRatio(c1) > 0.6 && bodyRatio(c2) > 0.6 && bodyRatio(c3) > 0.6;
}

function isAbandonedBaby(c1, c2, c3) {
    // Bullish: bearish c1, doji c2 with gap, bullish c3 with gap
    const bullish = !isUp(c1) && isDoji(c2) && isUp(c3) &&
                    c2.high < c1.low && c2.low > c3.high;
    const bearish = isUp(c1) && isDoji(c2) && !isUp(c3) &&
                    c2.low > c1.high && c2.high < c3.low;
    return { bullish, bearish };
}

// ─── Multi-candle: Inside Bar ─────────────────────────────────────────────────

function isInsideBar(c1, c2) {
    return c2.high < c1.high && c2.low > c1.low;
}

function isOutsideBar(c1, c2) {
    return c2.high > c1.high && c2.low < c1.low;
}

// ─── Price action context: Pin bar ───────────────────────────────────────────

function isPinBar(c) {
    const bw = bottomWick(c);
    const tw = topWick(c);
    const b  = body(c);
    // Bullish pin: long lower wick (>= 3× body), small upper wick
    if (bw >= 3 * b && tw <= b * 0.5) return 'bullish';
    // Bearish pin: long upper wick
    if (tw >= 3 * b && bw <= b * 0.5) return 'bearish';
    return null;
}

// ─── Main detect function ─────────────────────────────────────────────────────

/**
 * Detect candlestick patterns in the last N candles.
 * @param {object[]} candles — at least 3 candles required
 * @param {number} lookback  — how many candles back to scan (default 5)
 * @returns {PatternResult[]}
 */
function detect(candles, lookback = 5) {
    const results = [];
    if (!candles || candles.length < 3) return results;

    const start = Math.max(0, candles.length - lookback);

    for (let i = start; i < candles.length; i++) {
        const c  = candles[i];
        const c1 = i >= 1 ? candles[i - 1] : null;
        const c2 = i >= 2 ? candles[i - 2] : null;

        // ── Single-candle ──────────────────────────────────────────────────

        if (isDoji(c)) {
            results.push({ name: 'Doji', type: 'neutral', significance: 'medium', candle_index: i });
        }
        if (isHammer(c) && isUp(c)) {
            results.push({ name: 'Hammer', type: 'bullish', significance: 'high', candle_index: i });
        }
        if (isHammer(c) && !isUp(c)) {
            results.push({ name: 'Hanging Man', type: 'bearish', significance: 'medium', candle_index: i });
        }
        if (isShootingStar(c)) {
            results.push({ name: 'Shooting Star', type: 'bearish', significance: 'high', candle_index: i });
        }
        if (isMarubozu(c) && isUp(c)) {
            results.push({ name: 'Bullish Marubozu', type: 'bullish', significance: 'high', candle_index: i });
        }
        if (isMarubozu(c) && !isUp(c)) {
            results.push({ name: 'Bearish Marubozu', type: 'bearish', significance: 'high', candle_index: i });
        }
        if (isSpinningTop(c)) {
            results.push({ name: 'Spinning Top', type: 'neutral', significance: 'low', candle_index: i });
        }
        const pin = isPinBar(c);
        if (pin) {
            results.push({ name: `Pin Bar (${pin})`, type: pin, significance: 'high', candle_index: i });
        }

        // ── Two-candle ──────────────────────────────────────────────────────

        if (c1) {
            if (isBullishEngulfing(c1, c)) {
                results.push({ name: 'Bullish Engulfing', type: 'bullish', significance: 'high', candle_index: i });
            }
            if (isBearishEngulfing(c1, c)) {
                results.push({ name: 'Bearish Engulfing', type: 'bearish', significance: 'high', candle_index: i });
            }
            if (isBullishHarami(c1, c)) {
                results.push({ name: 'Bullish Harami', type: 'bullish', significance: 'medium', candle_index: i });
            }
            if (isBearishHarami(c1, c)) {
                results.push({ name: 'Bearish Harami', type: 'bearish', significance: 'medium', candle_index: i });
            }
            if (isTweezerBottom(c1, c)) {
                results.push({ name: 'Tweezer Bottom', type: 'bullish', significance: 'medium', candle_index: i });
            }
            if (isTweezerTop(c1, c)) {
                results.push({ name: 'Tweezer Top', type: 'bearish', significance: 'medium', candle_index: i });
            }
            if (isPiercing(c1, c)) {
                results.push({ name: 'Piercing Line', type: 'bullish', significance: 'high', candle_index: i });
            }
            if (isDarkCloudCover(c1, c)) {
                results.push({ name: 'Dark Cloud Cover', type: 'bearish', significance: 'high', candle_index: i });
            }
            if (isKicker(c1, c)) {
                const type = isUp(c) ? 'bullish' : 'bearish';
                results.push({ name: `Kicker (${type})`, type, significance: 'high', candle_index: i });
            }
            if (isInsideBar(c1, c)) {
                results.push({ name: 'Inside Bar', type: 'neutral', significance: 'medium', candle_index: i });
            }
            if (isOutsideBar(c1, c)) {
                results.push({ name: 'Outside Bar', type: 'neutral', significance: 'medium', candle_index: i });
            }
        }

        // ── Three-candle ────────────────────────────────────────────────────

        if (c1 && c2) {
            if (isMorningStar(c2, c1, c)) {
                results.push({ name: 'Morning Star', type: 'bullish', significance: 'high', candle_index: i });
            }
            if (isEveningStar(c2, c1, c)) {
                results.push({ name: 'Evening Star', type: 'bearish', significance: 'high', candle_index: i });
            }
            if (isThreeWhiteSoldiers(c2, c1, c)) {
                results.push({ name: 'Three White Soldiers', type: 'bullish', significance: 'high', candle_index: i });
            }
            if (isThreeBlackCrows(c2, c1, c)) {
                results.push({ name: 'Three Black Crows', type: 'bearish', significance: 'high', candle_index: i });
            }
            const ab = isAbandonedBaby(c2, c1, c);
            if (ab.bullish) {
                results.push({ name: 'Abandoned Baby (Bullish)', type: 'bullish', significance: 'high', candle_index: i });
            }
            if (ab.bearish) {
                results.push({ name: 'Abandoned Baby (Bearish)', type: 'bearish', significance: 'high', candle_index: i });
            }
        }
    }

    // Deduplicate (keep highest significance per name)
    const seen = new Map();
    const sigOrder = { high: 3, medium: 2, low: 1 };
    for (const p of results) {
        const existing = seen.get(p.name);
        if (!existing || sigOrder[p.significance] > sigOrder[existing.significance]) {
            seen.set(p.name, p);
        }
    }

    return Array.from(seen.values());
}

/**
 * Returns a summary: { bullish: [], bearish: [], neutral: [], dominance: 'bullish'|'bearish'|'neutral' }
 */
function summarize(patterns) {
    const bullish = patterns.filter(p => p.type === 'bullish');
    const bearish = patterns.filter(p => p.type === 'bearish');
    const neutral = patterns.filter(p => p.type === 'neutral');
    const dominance = bullish.length > bearish.length ? 'bullish'
                    : bearish.length > bullish.length ? 'bearish' : 'neutral';
    return { bullish, bearish, neutral, dominance };
}

module.exports = { detect, summarize };
