/**
 * SupportResistance.js
 *
 * Multi-method Support & Resistance level detection:
 *   1. Swing high/low pivots
 *   2. Volume Profile (price by volume clusters)
 *   3. Psychological round numbers
 *   4. Fibonacci retracements from last major swing
 *
 * Usage:
 *   const sr = require('./SupportResistance');
 *   const levels = sr.detect(candles);
 */

// ─── Method 1: Swing Pivots ───────────────────────────────────────────────────

function findSwingLevels(candles, pivotStrength = 3) {
    const supports = [], resistances = [];
    if (candles.length < pivotStrength * 2 + 1) return { supports, resistances };

    for (let i = pivotStrength; i < candles.length - pivotStrength; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= pivotStrength; j++) {
            if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low  >= candles[i - j].low  || candles[i].low  >= candles[i + j].low)  isLow  = false;
        }
        if (isHigh) resistances.push({ price: candles[i].high, time: candles[i].time, strength: 1 });
        if (isLow)  supports.push({    price: candles[i].low,  time: candles[i].time, strength: 1 });
    }

    return { supports, resistances };
}

// ─── Method 2: Volume Profile ─────────────────────────────────────────────────

function findVolumeProfileLevels(candles, bins = 30) {
    if (candles.length < 5) return [];
    const high  = Math.max(...candles.map(c => c.high));
    const low   = Math.min(...candles.map(c => c.low));
    const range = high - low;
    if (range <= 0) return [];

    const binSize = range / bins;
    const profile = new Array(bins).fill(0);

    for (const c of candles) {
        const mid     = (c.high + c.low) / 2;
        const binIdx  = Math.min(bins - 1, Math.floor((mid - low) / binSize));
        profile[binIdx] += c.volume || 1;
    }

    const maxVol = Math.max(...profile);
    const threshold = maxVol * 0.6; // high-volume nodes at ≥60% of max

    const levels = [];
    for (let i = 0; i < bins; i++) {
        if (profile[i] >= threshold) {
            levels.push({
                price: parseFloat((low + (i + 0.5) * binSize).toFixed(8)),
                volume: profile[i],
                strength: profile[i] / maxVol,
                source: 'volume_profile',
            });
        }
    }
    return levels;
}

// ─── Method 3: Psychological Round Numbers ────────────────────────────────────

function findRoundNumbers(currentPrice, count = 6) {
    const levels = [];
    const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));

    // Grid at 1×, 2×, 5× the leading magnitude
    const steps = [magnitude * 0.1, magnitude * 0.5, magnitude, magnitude * 2];

    for (const step of steps) {
        const base = Math.round(currentPrice / step) * step;
        for (let i = -count / 2; i <= count / 2; i++) {
            const price = parseFloat((base + i * step).toFixed(8));
            if (price > 0) {
                levels.push({ price, strength: 0.5, source: 'round_number' });
            }
        }
    }

    // Deduplicate
    return [...new Map(levels.map(l => [l.price, l])).values()];
}

// ─── Method 4: Fibonacci Retracements ────────────────────────────────────────

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function findFibonacciLevels(candles, lookback = 100) {
    const slice  = candles.slice(-lookback);
    const high   = Math.max(...slice.map(c => c.high));
    const low    = Math.min(...slice.map(c => c.low));
    const range  = high - low;
    if (range <= 0) return [];

    return FIB_LEVELS.map(fib => ({
        price:    parseFloat((low + range * fib).toFixed(8)),
        fib:      fib,
        label:    `Fib ${(fib * 100).toFixed(1)}%`,
        strength: [0.382, 0.5, 0.618].includes(fib) ? 0.9 : 0.6,
        source:   'fibonacci',
    }));
}

// ─── Merge & cluster nearby levels ───────────────────────────────────────────

function clusterLevels(levels, tolerance = 0.005) {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const clusters = [];
    let current = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prev = current[current.length - 1];
        const diff = Math.abs(sorted[i].price - prev.price) / prev.price;
        if (diff <= tolerance) {
            current.push(sorted[i]);
        } else {
            clusters.push(mergeCluster(current));
            current = [sorted[i]];
        }
    }
    clusters.push(mergeCluster(current));
    return clusters;
}

function mergeCluster(group) {
    const avgPrice = group.reduce((s, l) => s + l.price, 0) / group.length;
    const maxStrength = Math.max(...group.map(l => l.strength));
    const sources = [...new Set(group.map(l => l.source).filter(Boolean))];
    return {
        price:    parseFloat(avgPrice.toFixed(8)),
        strength: parseFloat((maxStrength + (group.length - 1) * 0.1).toFixed(3)),
        count:    group.length,
        sources,
    };
}

// ─── Classify each level as support or resistance ────────────────────────────

function classifyLevels(clusters, currentPrice) {
    const supports    = clusters.filter(l => l.price < currentPrice);
    const resistances = clusters.filter(l => l.price > currentPrice);

    // Sort: supports descending (closest first), resistances ascending
    supports.sort((a, b) => b.price - a.price);
    resistances.sort((a, b) => a.price - b.price);

    return { supports: supports.slice(0, 8), resistances: resistances.slice(0, 8) };
}

// ─── Main detect function ─────────────────────────────────────────────────────

/**
 * Detect all support & resistance levels using 4 methods.
 * @param {object[]} candles — OHLCV candles (50+ recommended)
 * @returns {{ supports, resistances, fibonacci, allLevels }}
 */
function detect(candles) {
    if (!candles || candles.length < 10) {
        return { supports: [], resistances: [], fibonacci: [], allLevels: [] };
    }

    const currentPrice = candles[candles.length - 1].close;

    // Collect from all methods
    const { supports: swingSup, resistances: swingRes } = findSwingLevels(candles, 3);
    const volLevels = findVolumeProfileLevels(candles).map(l => ({ ...l, source: 'volume_profile' }));
    const roundLevels = findRoundNumbers(currentPrice);
    const fibLevels   = findFibonacciLevels(candles);

    // Tag swing levels
    const taggedSwingSup = swingSup.map(l => ({ ...l, source: 'swing', strength: 0.7 }));
    const taggedSwingRes = swingRes.map(l => ({ ...l, source: 'swing', strength: 0.7 }));

    // Combine all
    const allRaw = [
        ...taggedSwingSup, ...taggedSwingRes,
        ...volLevels,
        ...roundLevels,
        ...fibLevels,
    ];

    const clustered = clusterLevels(allRaw);
    const { supports, resistances } = classifyLevels(clustered, currentPrice);

    return {
        supports,
        resistances,
        fibonacci: fibLevels,
        allLevels: clustered,
        currentPrice,
    };
}

module.exports = { detect, findSwingLevels, findVolumeProfileLevels, findFibonacciLevels, findRoundNumbers };
