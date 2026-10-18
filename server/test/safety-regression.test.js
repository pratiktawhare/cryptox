const test = require('node:test');
const assert = require('node:assert/strict');

const { assertLiveTradingAllowed } = require('../src/services/trading/liveTradingGuard');
const { calcRisk, checkDailyLimits } = require('../src/services/bot/RiskEngine');

const liveUser = { accountMode: 'live' };
const writeKey = { exchange: 'delta', isActive: true, permissions: 'read_write' };
const liveConfig = { botLiveAllowed: true };

test('live entry is blocked unless the user is in live mode', () => {
    assert.throws(
        () => assertLiveTradingAllowed({
            user: { accountMode: 'paper' },
            apiKey: writeKey,
            config: liveConfig,
        }),
        /paper mode/
    );
});

test('live entry is blocked for read-only API keys', () => {
    assert.throws(
        () => assertLiveTradingAllowed({
            user: liveUser,
            apiKey: { ...writeKey, permissions: 'read' },
            config: liveConfig,
        }),
        /read_write/
    );
});

test('live entry is blocked when the explicit environment gate is off', () => {
    assert.throws(
        () => assertLiveTradingAllowed({ user: liveUser, apiKey: writeKey, config: { botLiveAllowed: false } }),
        /ENABLE_LIVE_TRADING=true/
    );
});

test('reduce-only actions remain available when new entries are disabled', () => {
    assert.equal(
        assertLiveTradingAllowed({
            user: liveUser,
            apiKey: writeKey,
            config: { botLiveAllowed: false },
            allowReduceOnly: true,
        }),
        true
    );
});

test('reduce-only actions can unwind a live position after switching the UI to paper mode', () => {
    assert.equal(
        assertLiveTradingAllowed({
            user: { accountMode: 'paper' },
            apiKey: writeKey,
            config: { botLiveAllowed: false },
            allowReduceOnly: true,
        }),
        true
    );
});

test('daily and consecutive loss limits block new entries', () => {
    const config = {
        budgetUSDT: 100,
        maxDailyLossPct: 10,
        maxConsecutiveLosses: 3,
    };

    assert.equal(
        checkDailyLimits(config, 100, { dailyLoss: 10, consecutiveLosses: 0, cooldownUntil: null }).ok,
        false
    );
    assert.equal(
        checkDailyLimits(config, 100, { dailyLoss: 0, consecutiveLosses: 3, cooldownUntil: null }).ok,
        false
    );
});

test('risk sizing uses the stop distance and returns at least the configured net R:R', () => {
    const result = calcRisk({
        config: {
            budgetUSDT: 100,
            walletParts: 2,
            riskPerTradePct: 5,
            maxLeverage: 5,
            targetRoiPct: 2,
            minRewardRisk: 1,
            slAtrMultiplier: 1.5,
            tpSafetyMultiplier: 1.5,
            maxDailyLossPct: 10,
            maxConsecutiveLosses: 3,
        },
        actualAvailableBalance: 100,
        symbol: 'TESTUSD',
        direction: 'long',
        entryPrice: 100,
        atr: 1,
        spread: 0.05,
        fundingRate: 0,
        productSpec: { contract_value: 1, min_quantity: 1, tick_size: 0.01, max_leverage: 20 },
        dailyStats: { dailyLoss: 0, consecutiveLosses: 0, cooldownUntil: null },
    });

    assert.equal(result.valid, true, result.reason || 'risk result should be valid');
    assert.ok(result.qty > 0);
    assert.ok(result.cost.actualRR >= 1, `actual R:R was ${result.cost.actualRR}`);
});
