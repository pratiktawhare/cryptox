const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const TradingConfig = require('../src/models/TradingConfig');
const PaperPosition = require('../src/models/PaperPosition');
const { normalizeRegimeEnsembleResult } = require('../src/services/bot/strategySelector');
const { REGIME_ENSEMBLE_V1 } = require('../src/services/bot/strategyTypes');

test('TradingConfig defaults to regime_ensemble_v1 while accepting legacy strategies', async () => {
    const config = new TradingConfig({
        userId: new mongoose.Types.ObjectId(),
        mode: 'paper',
    });

    assert.equal(config.strategyType, REGIME_ENSEMBLE_V1);
    await assert.doesNotReject(config.validate());

    config.strategyType = 'trend_pullback';
    await assert.doesNotReject(config.validate());
});

test('paper position metadata accepts the new strategy identifier', async () => {
    const position = new PaperPosition({
        userId: new mongoose.Types.ObjectId(),
        symbol: 'TESTUSD',
        side: 'buy',
        size: 1,
        entryPrice: 100,
        strategyType: REGIME_ENSEMBLE_V1,
        strategyMetadata: { setup: 'trend_pullback', accepted: true },
    });

    await assert.doesNotReject(position.validate());
    assert.equal(position.strategyMetadata.setup, 'trend_pullback');
});

test('the integration adapter converts a pure ENTER result to the shared trade shape', () => {
    const normalized = normalizeRegimeEnsembleResult({
        decision: 'ENTER',
        action: 'BUY',
        accepted: true,
        confidence: 0.75,
        regime: 'trend',
        setup: 'trend_pullback',
        metadata: { volumeRatio: 1.4 },
    }, {
        config: { minSignalScore: 5 },
        regimeResult: { regime: 'UNCERTAIN', confidence: 0, reason: 'fallback' },
    });

    assert.equal(normalized.decision, 'TRADE');
    assert.equal(normalized.direction, 'long');
    assert.equal(normalized.score, 6);
    assert.equal(normalized.regime, 'TRENDING_UP');
    assert.equal(normalized.strategyMetadata.setup, 'trend_pullback');
});
