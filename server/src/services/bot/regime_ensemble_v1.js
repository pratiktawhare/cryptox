/**
 * regime_ensemble_v1.js
 *
 * A deterministic OHLCV-only strategy.  The caller supplies candles that are
 * already complete; this module never reads a clock, exchange, database, or
 * live price.  Every decision is therefore reproducible for the same inputs.
 *
 * Regime rules, in priority order:
 *   1. Compression: a Bollinger bandwidth and ATR-percent squeeze is active
 *      now or was active immediately before the latest candle.
 *   2. Trend: fast/slow EMA separation, slow EMA slope, price location, and
 *      RSI agree on a direction.
 *   3. Range: all remaining valid, non-compressed markets.
 *
 * Setup rules:
 *   - trend       -> trend-pullback at the fast EMA
 *   - compression -> breakout only when the latest completed close clears the
 *                    prior range with an ATR buffer and volume confirmation
 *   - range       -> mean-reversion only from a range edge with RSI support
 *                    and a reversal-colored candle
 *
 * The exported `evaluate` function returns an explicit NO_TRADE result and
 * machine-readable rejection reasons instead of throwing for market-data
 * conditions.  Invalid strategy options still use the documented defaults.
 */

const { calcEMA, calcEMASlope } = require('./indicators/ema');
const { calcATR } = require('./indicators/atr');
const { calcRSI } = require('./indicators/rsi');
const { calcAvgVolume } = require('./indicators/volume');
const { calcBollingerBands } = require('./indicators/bollinger');
const { adx: calcADX } = require('../analysis/IndicatorEngine');

const STRATEGY_ID = 'regime_ensemble_v1';

const DEFAULTS = Object.freeze({
    fastPeriod: 9,
    slowPeriod: 21,
    atrPeriod: 14,
    rsiPeriod: 14,
    volumeLookback: 20,
    rangeLookback: 20,
    bollingerPeriod: 20,
    minCandles: 25,

    // Regime thresholds. Percent values are expressed as decimal percentages
    // after conversion to percent, e.g. 0.02 means 0.02% per candle.
    compressionMaxBandwidth: 0.015,
    compressionMaxAtrPct: 1.0,
    trendMinSeparationPct: 0.05,
    trendMinSlopePct: 0.02,
    trendMinAdx: 20,
    trendRsiMidline: 50,

    // Setup thresholds.
    pullbackTouchAtr: 0.35,
    pullbackMaxExtensionAtr: 0.75,
    breakoutBufferAtr: 0.10,
    breakoutMinVolumeRatio: 1.20,
    rangeEdgeFraction: 0.25,
    rangeLongRsi: 45,
    rangeShortRsi: 55,

    // Data-quality thresholds.
    minVolumeRatio: 0.25,
    minAverageVolume: 0,
    timeframeMs: 5 * 60 * 1000,
    maxStalenessMs: 3 * 5 * 60 * 1000,

    // Bracket geometry.
    stopAtrMultiplier: 1.5,
    targetAtrMultiplier: 2.25,
    priceDecimals: 8,
});

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function positive(value) {
    return finite(value) && value > 0;
}

function numberOrDefault(value, fallback, minimum = -Infinity) {
    return finite(value) && value >= minimum ? value : fallback;
}

function normalizeConfig(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const config = { ...DEFAULTS };

    for (const key of [
        'fastPeriod', 'slowPeriod', 'atrPeriod', 'rsiPeriod',
        'volumeLookback', 'rangeLookback', 'bollingerPeriod', 'minCandles',
    ]) {
        config[key] = Math.max(1, Math.floor(numberOrDefault(source[key], DEFAULTS[key], 1)));
    }

    for (const key of [
        'compressionMaxBandwidth', 'compressionMaxAtrPct',
        'trendMinSeparationPct', 'trendMinSlopePct', 'trendMinAdx', 'trendRsiMidline',
        'pullbackTouchAtr', 'pullbackMaxExtensionAtr', 'breakoutBufferAtr',
        'breakoutMinVolumeRatio', 'rangeEdgeFraction', 'rangeLongRsi',
        'rangeShortRsi', 'minVolumeRatio', 'minAverageVolume',
        'timeframeMs', 'maxStalenessMs', 'stopAtrMultiplier',
        'targetAtrMultiplier', 'priceDecimals',
    ]) {
        config[key] = numberOrDefault(source[key], DEFAULTS[key], 0);
    }

    config.priceDecimals = Math.min(12, Math.floor(config.priceDecimals));
    config.minCandles = Math.max(
        config.minCandles,
        config.slowPeriod + 1,
        config.atrPeriod + 1,
        config.volumeLookback + 1,
        config.rangeLookback + 1,
        config.bollingerPeriod + 1,
    );

    return config;
}

function roundPrice(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function asMilliseconds(value) {
    if (value instanceof Date) return value.getTime();
    if (!finite(value) || value <= 0) return null;
    // Delta candle timestamps are commonly seconds; test and API callers may
    // also use JavaScript milliseconds. Normalize both without consulting time.
    return value < 1e11 ? value * 1000 : value;
}

function candleIsIncomplete(candle) {
    return candle.closed === false || candle.isClosed === false || candle.complete === false;
}

function validateCandles(candles, config, now) {
    const reasons = [];

    if (!Array.isArray(candles) || candles.length === 0) {
        return ['no_candles'];
    }
    if (candles.length < config.minCandles) {
        reasons.push(`insufficient_candles:${config.minCandles}`);
    }

    let previousTime = null;
    for (let index = 0; index < candles.length; index += 1) {
        const candle = candles[index];
        if (!candle || typeof candle !== 'object') {
            reasons.push(`invalid_candle:${index}`);
            continue;
        }

        if (candleIsIncomplete(candle)) reasons.push('incomplete_candle');

        const values = ['open', 'high', 'low', 'close', 'volume'];
        if (!values.every((key) => finite(candle[key]))) {
            reasons.push(`invalid_ohlcv:${index}`);
            continue;
        }
        if (!positive(candle.open) || !positive(candle.high) || !positive(candle.low) || !positive(candle.close)) {
            reasons.push(`non_positive_price:${index}`);
        }
        if (candle.high < Math.max(candle.open, candle.close)
            || candle.low > Math.min(candle.open, candle.close)
            || candle.high < candle.low
            || candle.volume < 0) {
            reasons.push(`invalid_ohlcv_geometry:${index}`);
        }

        const time = asMilliseconds(candle.time);
        if (time === null) {
            reasons.push(`invalid_timestamp:${index}`);
        } else if (previousTime !== null && time <= previousTime) {
            reasons.push('non_chronological_candles');
        }
        previousTime = time;
    }

    const latestTime = asMilliseconds(candles[candles.length - 1]?.time);
    const referenceTime = asMilliseconds(now);
    if (referenceTime !== null && latestTime !== null) {
        if (latestTime > referenceTime) reasons.push('future_candle');
        else if (referenceTime - latestTime > config.maxStalenessMs) reasons.push('stale_candles');
    }

    return [...new Set(reasons)];
}

function priorWindow(candles, lookback) {
    return candles.slice(Math.max(0, candles.length - lookback - 1), -1);
}

function computeIndicators(candles, config) {
    const closes = candles.map((candle) => candle.close);
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const volumes = candles.map((candle) => candle.volume);
    const latest = candles[candles.length - 1];

    const emaFast = calcEMA(closes, config.fastPeriod);
    const emaSlow = calcEMA(closes, config.slowPeriod);
    const emaSlowSlope = calcEMASlope(closes, config.slowPeriod);
    const atr = calcATR(highs, lows, closes, config.atrPeriod);
    const rsi = calcRSI(closes, config.rsiPeriod);
    const bollinger = calcBollingerBands(closes, config.bollingerPeriod, 2);
    const adx = calcADX(candles, config.atrPeriod);
    const averageVolume = calcAvgVolume(volumes, config.volumeLookback);
    const volumeRatio = averageVolume > 0 ? latest.volume / averageVolume : null;

    return {
        close: latest.close,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        emaFast,
        emaSlow,
        emaSlowSlope,
        emaSeparationPct: emaSlow > 0 ? Math.abs(emaFast - emaSlow) / emaSlow * 100 : null,
        slopePct: emaSlow > 0 ? emaSlowSlope / emaSlow * 100 : null,
        atr,
        atrPct: atr !== null && latest.close > 0 ? atr / latest.close * 100 : null,
        rsi,
        adx,
        bollinger,
        averageVolume,
        volumeRatio,
    };
}

function compressionMetrics(candles, config) {
    if (!Array.isArray(candles) || candles.length < Math.max(config.atrPeriod + 1, config.bollingerPeriod)) {
        return { compressed: false, bandwidth: null, atrPct: null };
    }

    const closes = candles.map((candle) => candle.close);
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const latestClose = closes[closes.length - 1];
    const bands = calcBollingerBands(closes, config.bollingerPeriod, 2);
    const atr = calcATR(highs, lows, closes, config.atrPeriod);
    const atrPct = atr !== null && latestClose > 0 ? atr / latestClose * 100 : null;
    const compressed = Boolean(
        bands
        && atrPct !== null
        && bands.bandwidth <= config.compressionMaxBandwidth
        && atrPct <= config.compressionMaxAtrPct
    );

    return {
        compressed,
        bandwidth: bands?.bandwidth ?? null,
        atrPct,
    };
}

function classifyFromIndicators(indicators, candles, config) {
    const previous = candles.slice(0, -1);
    const currentCompression = compressionMetrics(candles, config);
    const previousCompression = compressionMetrics(previous, config);

    const trendUp = indicators.emaFast > indicators.emaSlow
        && indicators.emaSeparationPct >= config.trendMinSeparationPct
        && indicators.slopePct >= config.trendMinSlopePct
        && (indicators.adx === null || indicators.adx.adx >= config.trendMinAdx)
        && (indicators.adx === null || indicators.adx.diPlus >= indicators.adx.diMinus)
        && indicators.close >= indicators.emaSlow
        && (indicators.rsi === null || indicators.rsi >= config.trendRsiMidline);
    const trendDown = indicators.emaFast < indicators.emaSlow
        && indicators.emaSeparationPct >= config.trendMinSeparationPct
        && indicators.slopePct <= -config.trendMinSlopePct
        && (indicators.adx === null || indicators.adx.adx >= config.trendMinAdx)
        && (indicators.adx === null || indicators.adx.diMinus >= indicators.adx.diPlus)
        && indicators.close <= indicators.emaSlow
        && (indicators.rsi === null || indicators.rsi <= 100 - config.trendRsiMidline);

    // A pre-breakout squeeze remains the active regime for the latest candle;
    // this lets a confirmed expansion select the breakout setup deterministically.
    if (currentCompression.compressed || previousCompression.compressed) {
        return {
            regime: 'compression',
            trendDirection: trendUp ? 'long' : trendDown ? 'short' : null,
            currentCompression,
            previousCompression,
        };
    }
    if (trendUp || trendDown) {
        return {
            regime: 'trend',
            trendDirection: trendUp ? 'long' : 'short',
            currentCompression,
            previousCompression,
        };
    }
    return {
        regime: 'range',
        trendDirection: null,
        currentCompression,
        previousCompression,
    };
}

function rangeBoundaries(candles, config) {
    const window = priorWindow(candles, config.rangeLookback);
    if (window.length === 0) return null;
    return {
        high: Math.max(...window.map((candle) => candle.high)),
        low: Math.min(...window.map((candle) => candle.low)),
        candles: window.length,
    };
}

function calculateGeometry(entry, direction, atr, options = {}) {
    const config = normalizeConfig(options);
    if (!positive(entry) || !positive(atr) || !['long', 'short'].includes(direction)) return null;

    const stopDistance = atr * config.stopAtrMultiplier;
    const targetDistance = atr * config.targetAtrMultiplier;
    const stopLoss = direction === 'long' ? entry - stopDistance : entry + stopDistance;
    const target = direction === 'long' ? entry + targetDistance : entry - targetDistance;
    if (!positive(stopLoss) || !positive(target)) return null;

    return {
        entry: roundPrice(entry, config.priceDecimals),
        stopLoss: roundPrice(stopLoss, config.priceDecimals),
        target: roundPrice(target, config.priceDecimals),
        atr: roundPrice(atr, config.priceDecimals),
        stopDistance: roundPrice(stopDistance, config.priceDecimals),
        targetDistance: roundPrice(targetDistance, config.priceDecimals),
        rewardRisk: roundPrice(targetDistance / stopDistance, config.priceDecimals),
        stopAtrMultiplier: config.stopAtrMultiplier,
        targetAtrMultiplier: config.targetAtrMultiplier,
    };
}

function baseResult(candles, config, validationReasons = []) {
    return {
        strategy: STRATEGY_ID,
        decision: 'REJECT',
        action: 'NO_TRADE',
        accepted: false,
        regime: null,
        trendDirection: null,
        setup: null,
        direction: null,
        entry: null,
        stopLoss: null,
        target: null,
        geometry: null,
        confidence: 0,
        rejectionReasons: validationReasons,
        indicators: null,
        metadata: {
            candleCount: Array.isArray(candles) ? candles.length : 0,
            latestCandleTime: Array.isArray(candles) && candles.length > 0
                ? candles[candles.length - 1].time ?? null
                : null,
            maxStalenessMs: config.maxStalenessMs,
        },
    };
}

function reject(result, reasons) {
    const merged = [...new Set([...(result.rejectionReasons || []), ...reasons])];
    return {
        ...result,
        decision: 'REJECT',
        action: 'NO_TRADE',
        accepted: false,
        rejectionReasons: merged,
    };
}

function accept(result, setup, direction, geometry, confidence) {
    return {
        ...result,
        decision: 'ENTER',
        action: direction === 'long' ? 'BUY' : 'SELL',
        accepted: true,
        setup,
        direction,
        entry: geometry.entry,
        stopLoss: geometry.stopLoss,
        target: geometry.target,
        geometry,
        confidence,
        rejectionReasons: [],
    };
}

function evaluate(candles, options = {}) {
    const config = normalizeConfig(options);
    const result = baseResult(candles, config);
    const validationReasons = validateCandles(candles, config, options?.now);
    if (validationReasons.length > 0) return reject(result, validationReasons);

    const indicators = computeIndicators(candles, config);
    result.indicators = {
        close: indicators.close,
        emaFast: indicators.emaFast,
        emaSlow: indicators.emaSlow,
        emaSlowSlope: indicators.emaSlowSlope,
        emaSeparationPct: indicators.emaSeparationPct,
        slopePct: indicators.slopePct,
        atr: indicators.atr,
        atrPct: indicators.atrPct,
        rsi: indicators.rsi,
        adx: indicators.adx,
        bollingerBandwidth: indicators.bollinger?.bandwidth ?? null,
        averageVolume: indicators.averageVolume,
        volumeRatio: indicators.volumeRatio,
    };
    result.metadata.volumeRatio = indicators.volumeRatio;

    if (indicators.atr === null || indicators.emaFast === null || indicators.emaSlow === null
        || indicators.averageVolume === null) {
        return reject(result, ['indicators_unavailable']);
    }
    if (indicators.averageVolume < config.minAverageVolume || indicators.averageVolume <= 0) {
        return reject(result, ['no_liquidity']);
    }
    if (indicators.volumeRatio < config.minVolumeRatio) {
        return reject(result, ['illiquid_volume']);
    }

    const classification = classifyFromIndicators(indicators, candles, config);
    const boundaries = rangeBoundaries(candles, config);
    result.regime = classification.regime;
    result.trendDirection = classification.trendDirection;
    result.metadata.compression = {
        current: classification.currentCompression,
        previous: classification.previousCompression,
    };
    result.metadata.range = boundaries;

    if (!boundaries || boundaries.high <= boundaries.low) {
        return reject(result, ['range_unavailable']);
    }

    const latest = candles[candles.length - 1];
    const buffer = indicators.atr * config.breakoutBufferAtr;
    const breakoutLong = latest.close > boundaries.high + buffer;
    const breakoutShort = latest.close < boundaries.low - buffer;

    if (classification.regime === 'compression') {
        if (!breakoutLong && !breakoutShort) {
            return reject(result, ['breakout_not_confirmed']);
        }
        if (indicators.volumeRatio < config.breakoutMinVolumeRatio) {
            return reject(result, ['breakout_volume_not_confirmed']);
        }

        const direction = breakoutLong ? 'long' : 'short';
        const geometry = calculateGeometry(latest.close, direction, indicators.atr, config);
        if (!geometry) return reject(result, ['invalid_geometry']);
        return accept(result, 'breakout', direction, geometry, 0.8);
    }

    if (classification.regime === 'trend') {
        const direction = classification.trendDirection;
        const touchDistance = indicators.atr * config.pullbackTouchAtr;
        const maxExtension = indicators.atr * config.pullbackMaxExtensionAtr;
        const longPullback = direction === 'long'
            && latest.low <= indicators.emaFast + touchDistance
            && latest.close >= indicators.emaFast
            && latest.close <= indicators.emaFast + maxExtension
            && latest.close >= latest.open;
        const shortPullback = direction === 'short'
            && latest.high >= indicators.emaFast - touchDistance
            && latest.close <= indicators.emaFast
            && latest.close >= indicators.emaFast - maxExtension
            && latest.close <= latest.open;

        if (!longPullback && !shortPullback) return reject(result, ['pullback_not_confirmed']);
        const geometry = calculateGeometry(latest.close, direction, indicators.atr, config);
        if (!geometry) return reject(result, ['invalid_geometry']);
        return accept(result, 'trend_pullback', direction, geometry, 0.75);
    }

    const rangeWidth = boundaries.high - boundaries.low;
    const rangePosition = (latest.close - boundaries.low) / rangeWidth;
    const longMeanReversion = rangePosition <= config.rangeEdgeFraction
        && indicators.rsi !== null
        && indicators.rsi <= config.rangeLongRsi
        && latest.close >= latest.open;
    const shortMeanReversion = rangePosition >= 1 - config.rangeEdgeFraction
        && indicators.rsi !== null
        && indicators.rsi >= config.rangeShortRsi
        && latest.close <= latest.open;

    if (!longMeanReversion && !shortMeanReversion) {
        return reject(result, ['range_entry_not_confirmed']);
    }
    const direction = longMeanReversion ? 'long' : 'short';
    const geometry = calculateGeometry(latest.close, direction, indicators.atr, config);
    if (!geometry) return reject(result, ['invalid_geometry']);
    return accept(result, 'range_mean_reversion', direction, geometry, 0.65);
}

function classifyRegime(candles, options = {}) {
    const config = normalizeConfig(options);
    const reasons = validateCandles(candles, config, options?.now);
    if (reasons.length > 0) {
        return { regime: null, trendDirection: null, rejectionReasons: reasons };
    }
    const indicators = computeIndicators(candles, config);
    if (indicators.atr === null || indicators.emaFast === null || indicators.emaSlow === null) {
        return { regime: null, trendDirection: null, rejectionReasons: ['indicators_unavailable'] };
    }
    return {
        ...classifyFromIndicators(indicators, candles, config),
        rejectionReasons: [],
    };
}

module.exports = {
    STRATEGY_ID,
    DEFAULTS,
    calculateGeometry,
    classifyRegime,
    decide: evaluate,
    evaluate,
};
