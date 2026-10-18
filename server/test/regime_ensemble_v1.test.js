const test = require('node:test');
const assert = require('node:assert/strict');

const strategy = require('../src/services/bot/regime_ensemble_v1');

const BASE_TIME = 1_700_000_000_000;
const CANDLE_MS = 5 * 60 * 1000;

function candle(index, close, {
    open = close,
    high = Math.max(open, close) + 0.2,
    low = Math.min(open, close) - 0.2,
    volume = 100,
} = {}) {
    return {
        time: BASE_TIME + index * CANDLE_MS,
        open,
        high,
        low,
        close,
        volume,
    };
}

function evaluationOptions(candles, overrides = {}) {
    return {
        now: candles[candles.length - 1].time + 60 * 1000,
        ...overrides,
    };
}

function trendPullbackCandles() {
    const candles = [];
    for (let index = 0; index < 39; index += 1) {
        const close = 100 + index * 0.5;
        candles.push(candle(index, close, {
            open: close - 0.1,
            high: close + 0.3,
            low: close - 0.3,
        }));
    }
    candles.push(candle(39, 117.8, {
        open: 117.4,
        high: 118.2,
        low: 116.9,
    }));
    return candles;
}

function compressedBreakoutCandles(volume = 200) {
    const candles = [];
    for (let index = 0; index < 39; index += 1) {
        const close = 100 + (index % 2 ? 0.05 : -0.05);
        candles.push(candle(index, close, {
            open: 100 + (index % 2 ? 0.02 : -0.02),
            high: 100.2,
            low: 99.8,
        }));
    }
    candles.push(candle(39, 101, {
        open: 100.1,
        high: 101.3,
        low: 99.9,
        volume,
    }));
    return candles;
}

function rangeMeanReversionCandles() {
    const candles = [];
    for (let index = 0; index < 39; index += 1) {
        const phase = index % 10;
        const close = phase < 5 ? 100 + phase : 105 - (phase - 5);
        candles.push(candle(index, close, {
            high: close + 0.5,
            low: close - 0.5,
        }));
    }
    candles.push(candle(39, 100, {
        open: 99.5,
        high: 100.7,
        low: 99.2,
    }));
    return candles;
}

test('trend regime selects a bullish trend-pullback with ATR geometry', () => {
    const candles = trendPullbackCandles();
    const result = strategy.evaluate(candles, evaluationOptions(candles));

    assert.equal(result.decision, 'ENTER');
    assert.equal(result.action, 'BUY');
    assert.equal(result.regime, 'trend');
    assert.equal(result.setup, 'trend_pullback');
    assert.equal(result.direction, 'long');
    assert.equal(result.rejectionReasons.length, 0);
    assert.ok(result.indicators.atr > 0);
    assert.equal(result.geometry.entry, result.entry);
    assert.equal(result.geometry.stopLoss, result.stopLoss);
    assert.equal(result.geometry.target, result.target);
    assert.equal(result.geometry.rewardRisk, 1.5);
    assert.ok(result.stopLoss < result.entry);
    assert.ok(result.target > result.entry);
});

test('compression breakout requires a confirmed close and elevated volume', () => {
    const candles = compressedBreakoutCandles();
    const result = strategy.decide(candles, evaluationOptions(candles));

    assert.equal(result.decision, 'ENTER');
    assert.equal(result.regime, 'compression');
    assert.equal(result.setup, 'breakout');
    assert.equal(result.direction, 'long');
    assert.ok(result.metadata.compression.previous.compressed);
    assert.ok(result.indicators.volumeRatio >= strategy.DEFAULTS.breakoutMinVolumeRatio);

    const lowVolumeResult = strategy.evaluate(
        compressedBreakoutCandles(100),
        evaluationOptions(candles)
    );
    assert.equal(lowVolumeResult.decision, 'REJECT');
    assert.deepEqual(lowVolumeResult.rejectionReasons, ['breakout_volume_not_confirmed']);
});

test('range regime selects mean reversion only at an RSI-confirmed edge', () => {
    const candles = rangeMeanReversionCandles();
    const result = strategy.evaluate(candles, evaluationOptions(candles));

    assert.equal(result.decision, 'ENTER');
    assert.equal(result.regime, 'range');
    assert.equal(result.setup, 'range_mean_reversion');
    assert.equal(result.direction, 'long');
    assert.ok(result.indicators.rsi <= strategy.DEFAULTS.rangeLongRsi);

    const middle = candles.slice(0, -1).concat(candle(39, 102, {
        open: 101.8,
        high: 102.5,
        low: 101.5,
    }));
    const middleResult = strategy.evaluate(middle, evaluationOptions(middle));
    assert.equal(middleResult.decision, 'REJECT');
    assert.deepEqual(middleResult.rejectionReasons, ['range_entry_not_confirmed']);
});

test('stale, illiquid, and incomplete inputs return explicit rejection reasons', () => {
    const candles = trendPullbackCandles();

    const stale = strategy.evaluate(candles, evaluationOptions(candles, {
        now: candles[candles.length - 1].time + strategy.DEFAULTS.maxStalenessMs + 1,
    }));
    assert.equal(stale.decision, 'REJECT');
    assert.deepEqual(stale.rejectionReasons, ['stale_candles']);

    const illiquidCandles = candles.map((item, index) => (
        index === candles.length - 1 ? { ...item, volume: 10 } : item
    ));
    const illiquid = strategy.evaluate(illiquidCandles, evaluationOptions(illiquidCandles));
    assert.equal(illiquid.decision, 'REJECT');
    assert.deepEqual(illiquid.rejectionReasons, ['illiquid_volume']);

    const incompleteCandles = candles.map((item, index) => (
        index === candles.length - 1 ? { ...item, closed: false } : item
    ));
    const incomplete = strategy.evaluate(incompleteCandles, evaluationOptions(incompleteCandles));
    assert.equal(incomplete.decision, 'REJECT');
    assert.deepEqual(incomplete.rejectionReasons, ['incomplete_candle']);
});

test('the pure evaluator is repeatable and the geometry helper is deterministic', () => {
    const candles = rangeMeanReversionCandles();
    const before = JSON.stringify(candles);
    const options = evaluationOptions(candles);
    const first = strategy.evaluate(candles, options);
    const second = strategy.evaluate(candles, options);

    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(candles), before);
    assert.deepEqual(strategy.calculateGeometry(100, 'long', 2), {
        entry: 100,
        stopLoss: 97,
        target: 104.5,
        atr: 2,
        stopDistance: 3,
        targetDistance: 4.5,
        rewardRisk: 1.5,
        stopAtrMultiplier: 1.5,
        targetAtrMultiplier: 2.25,
    });
});
