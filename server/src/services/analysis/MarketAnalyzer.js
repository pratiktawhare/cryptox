/**
 * MarketAnalyzer.js
 *
 * Orchestrates Phase 5 analysis for a given symbol.
 * Fetches candles from Delta Exchange, runs all engines, and returns a
 * complete AnalysisSnapshot used by the Gemini Signal Engine.
 *
 * Results are cached per (symbol, resolution) for 60s to avoid redundant API calls.
 *
 * Usage:
 *   const analyzer = require('./MarketAnalyzer');
 *   const snapshot = await analyzer.analyze('BTCUSD', '5m');
 */

const axios = require('axios');
const config = require('../../config/env');
const IndicatorEngine = require('./IndicatorEngine');
const PatternDetector = require('./PatternDetector');
const SmartMoneyConcepts = require('./SmartMoneyConcepts');
const SupportResistance = require('./SupportResistance');

// Cache: key = `${symbol}_${resolution}` → { data, expiresAt }
const _cache = new Map();
const CACHE_TTL_MS = 60_000; // 60 seconds

// Resolution → minutes mapping (for window calculations)
const RES_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };

// ─── Candle fetch ─────────────────────────────────────────────────────────────

async function fetchCandles(symbol, resolution = '5m', count = 200) {
    const resMin = RES_MINUTES[resolution] || 5;
    const endTs  = Math.floor(Date.now() / 1000);
    const startTs = endTs - count * resMin * 60;

    const resp = await axios.get(`${config.deltaBaseUrl}/v2/history/candles`, {
        timeout: 10_000,
        params: {
            symbol,
            resolution,
            start: startTs,
            end:   endTs,
        },
    });

    const raw = resp.data?.result || [];

    return raw
        .filter(c => c.time && c.open && c.close)
        .map(c => ({
            time:   parseInt(c.time),
            open:   parseFloat(c.open),
            high:   parseFloat(c.high),
            low:    parseFloat(c.low),
            close:  parseFloat(c.close),
            volume: parseFloat(c.volume || 0),
        }))
        .sort((a, b) => a.time - b.time);
}

// ─── Main analyze ─────────────────────────────────────────────────────────────

/**
 * Full technical analysis for a symbol at a given resolution.
 * @param {string} symbol       e.g. 'BTCUSD'
 * @param {string} resolution   e.g. '5m' | '15m' | '1h'
 * @param {boolean} forceRefresh  bypass cache
 * @returns {AnalysisSnapshot}
 */
async function analyze(symbol, resolution = '5m', forceRefresh = false) {
    const cacheKey = `${symbol}_${resolution}`;

    // Cache hit
    if (!forceRefresh) {
        const cached = _cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
    }

    const candles = await fetchCandles(symbol, resolution, 300);
    if (candles.length < 15) {
        return { symbol, resolution, error: 'Insufficient candle data', candles: [] };
    }

    // Run all engines in parallel
    const [indicators, smcData, srData] = await Promise.all([
        Promise.resolve(IndicatorEngine.compute(candles)),
        Promise.resolve(SmartMoneyConcepts.analyze(candles)),
        Promise.resolve(SupportResistance.detect(candles)),
    ]);

    const patterns = PatternDetector.detect(candles, 10);
    const patternSummary = PatternDetector.summarize(patterns);

    // Extract the last 10 candles for the chart context
    const recentCandles = candles.slice(-50);

    // Key trading levels derived from analysis
    const keyLevels = buildKeyLevels(indicators, srData, smcData);

    // Overall bias voting
    const bias = computeBias(indicators, smcData, patternSummary);

    // Calculate volume context (last 50 candles for recent activity)
    const recentVolCandles = candles.slice(-50);
    const recentVolSum = recentVolCandles.reduce((sum, c) => sum + c.volume, 0);
    const avgVolume = recentVolSum / (recentVolCandles.length || 1);
    const avgVolumeUsdt = avgVolume * candles[candles.length - 1].close;
    const zeroVolCandles = recentVolCandles.filter(c => c.volume === 0).length;
    const zeroVolumePct = zeroVolCandles / (recentVolCandles.length || 1);

    const snapshot = {
        symbol,
        resolution,
        timestamp:  Date.now(),
        candleCount: candles.length,

        // Latest OHLCV
        price:  candles[candles.length - 1].close,
        open:   candles[candles.length - 1].open,
        high:   candles[candles.length - 1].high,
        low:    candles[candles.length - 1].low,
        volume: candles[candles.length - 1].volume,

        // Volume context
        volumeContext: {
            avgVolume: parseFloat(avgVolume.toFixed(2)),
            avgVolumeUsdt: parseFloat(avgVolumeUsdt.toFixed(2)),
            zeroVolumePct: parseFloat(zeroVolumePct.toFixed(4)),
            isLiquid: zeroVolumePct < 0.25 && avgVolumeUsdt > 200, // Liquid if < 25% empty candles and > $200 USDT per candle
        },

        // Analysis modules
        indicators,
        patterns: { list: patterns, summary: patternSummary },
        smc: smcData,
        sr:  srData,

        // Derived
        keyLevels,
        bias,

        // Recent candles for Gemini prompt context
        recentCandles,
    };

    _cache.set(cacheKey, { data: snapshot, expiresAt: Date.now() + CACHE_TTL_MS });

    return snapshot;
}

// ─── Multi-timeframe analysis ─────────────────────────────────────────────────

/**
 * Analyze the same symbol at 5m, 15m and 1h simultaneously.
 * Used by the Gemini Signal Engine for confluence scoring.
 */
async function analyzeMultiTimeframe(symbol) {
    const [tf5m, tf15m, tf1h, tf4h] = await Promise.allSettled([
        analyze(symbol, '5m'),
        analyze(symbol, '15m'),
        analyze(symbol, '1h'),
        analyze(symbol, '4h'),
    ]);

    return {
        symbol,
        timestamp: Date.now(),
        '5m':  tf5m.status  === 'fulfilled' ? tf5m.value  : null,
        '15m': tf15m.status === 'fulfilled' ? tf15m.value : null,
        '1h':  tf1h.status  === 'fulfilled' ? tf1h.value  : null,
        '4h':  tf4h.status  === 'fulfilled' ? tf4h.value  : null,
        mtfBias: computeMtfBias(
            tf5m.value?.bias,
            tf15m.value?.bias,
            tf1h.value?.bias
        ),
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildKeyLevels(indicators, sr, smc) {
    const levels = [];

    // Nearest support / resistance
    if (sr.supports[0])    levels.push({ type: 'support',    price: sr.supports[0].price,    strength: sr.supports[0].strength });
    if (sr.resistances[0]) levels.push({ type: 'resistance', price: sr.resistances[0].price, strength: sr.resistances[0].strength });

    // VWAP
    if (indicators.vwap)   levels.push({ type: 'vwap', price: indicators.vwap, strength: 0.7 });

    // EMA 21
    if (indicators.ema?.ema21) levels.push({ type: 'ema21', price: indicators.ema.ema21, strength: 0.6 });

    // EMA 50
    if (indicators.ema?.ema50) levels.push({ type: 'ema50', price: indicators.ema.ema50, strength: 0.6 });

    // Bollinger bands
    if (indicators.bb?.upper) levels.push({ type: 'bb_upper', price: indicators.bb.upper, strength: 0.5 });
    if (indicators.bb?.lower) levels.push({ type: 'bb_lower', price: indicators.bb.lower, strength: 0.5 });

    // Nearest bullish OB
    if (smc.orderBlocks?.bullish?.[0]) {
        const ob = smc.orderBlocks.bullish[0];
        levels.push({ type: 'order_block_bull', price: ob.high, strength: 0.8 });
    }

    // Nearest bearish OB
    if (smc.orderBlocks?.bearish?.[0]) {
        const ob = smc.orderBlocks.bearish[0];
        levels.push({ type: 'order_block_bear', price: ob.low, strength: 0.8 });
    }

    return levels.sort((a, b) => b.strength - a.strength);
}

function computeBias(indicators, smc, patternSummary) {
    const votes = [];

    // Indicators composite
    const ic = indicators.composite;
    if (ic?.signal === 'BULLISH') votes.push(1);
    else if (ic?.signal === 'BEARISH') votes.push(-1);
    else votes.push(0);

    // SMC bias
    if (smc?.bias === 'bullish') votes.push(1);
    else if (smc?.bias === 'bearish') votes.push(-1);
    else votes.push(0);

    // Pattern dominance
    if (patternSummary?.dominance === 'bullish') votes.push(0.5);
    else if (patternSummary?.dominance === 'bearish') votes.push(-0.5);

    // EMA trend
    const emaTrend = indicators.ema?.trend;
    if (emaTrend === 'bullish') votes.push(0.5);
    else if (emaTrend === 'bearish') votes.push(-0.5);

    const score = votes.reduce((a, b) => a + b, 0) / votes.length;
    const signal = score > 0.3 ? 'BULLISH' : score < -0.3 ? 'BEARISH' : 'NEUTRAL';
    const strength = Math.min(100, Math.abs(score) * 100).toFixed(0) + '%';

    return { score: parseFloat(score.toFixed(3)), signal, strength };
}

function computeMtfBias(b5m, b15m, b1h) {
    if (!b5m && !b15m && !b1h) return 'NEUTRAL';
    const signals = [b5m, b15m, b1h].filter(Boolean).map(b => b.score || 0);
    const avg = signals.reduce((a, b) => a + b, 0) / signals.length;

    // Higher-TF alignment gets more weight
    const weighted = ((b1h?.score || 0) * 0.5 + (b15m?.score || 0) * 0.3 + (b5m?.score || 0) * 0.2);
    return {
        aligned: signals.every(s => s > 0) || signals.every(s => s < 0),
        signal:  weighted > 0.2 ? 'BULLISH' : weighted < -0.2 ? 'BEARISH' : 'NEUTRAL',
        score:   parseFloat(weighted.toFixed(3)),
    };
}

// ─── Cache management ─────────────────────────────────────────────────────────

function clearCache(symbol) {
    if (symbol) {
        ['5m', '15m', '1h'].forEach(r => _cache.delete(`${symbol}_${r}`));
    } else {
        _cache.clear();
    }
}

function getCacheStats() {
    const now = Date.now();
    return {
        entries: _cache.size,
        valid: [..._cache.values()].filter(c => c.expiresAt > now).length,
    };
}

module.exports = { analyze, analyzeMultiTimeframe, fetchCandles, clearCache, getCacheStats };
