const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    mcDynamic,
    mcDynamicPair,
    evaluateDualCrossover,
} = require('../src/services/custom_strategy/McDynamicIndicator');

describe('McGinley Dynamic Indicator Engine', () => {
    it('should compute MC values without NaN or infinite values', () => {
        const prices = [100, 102, 105, 103, 107, 110, 115, 112, 108, 105];
        const md14 = mcDynamic(prices, 14);

        assert.equal(md14.length, prices.length);
        assert.equal(md14[0], 100);
        assert.ok(md14[md14.length - 1] > 100);
        assert.ok(!md14.some(v => isNaN(v) || v == null));
    });

    it('should compute dual pair (MC14 and MC50) correctly', () => {
        const candles = Array.from({ length: 60 }, (_, i) => ({
            close: 100 + i * 0.5 + Math.sin(i) * 2,
            time: 1700000000 + i * 14400,
        }));

        const { fast, slow } = mcDynamicPair(candles, 14, 50);
        assert.equal(fast.length, 60);
        assert.equal(slow.length, 60);
        // Fast MC should react faster than Slow MC in an uptrend
        assert.ok(fast[59] > slow[59], 'Fast MC14 should be higher than Slow MC50 in an uptrend');
    });

    it('should accurately identify a FRESH_BULLISH_CROSS when MC14 crosses above MC50', () => {
        // Construct candles where price was flat at 100, then dipped to 95, then surged up to trigger fresh cross
        const candles = [];
        for (let i = 0; i < 50; i++) {
            candles.push({ close: 100, time: 1000 + i * 14400, high: 101, low: 99, open: 100 });
        }
        for (let i = 0; i < 15; i++) {
            candles.push({ close: 95, time: 2000 + i * 14400, high: 96, low: 94, open: 95 });
        }
        for (let i = 0; i < 5; i++) {
            const p = 110 + i * 5;
            candles.push({ close: p, time: 3000 + i * 14400, high: p + 2, low: p - 2, open: p });
        }

        const evalResult = evaluateDualCrossover(candles.slice(0, 70), 14, 50, 0.05);

        assert.equal(evalResult.status, 'FRESH_BULLISH_CROSS');
        assert.ok(evalResult.fastValue > evalResult.slowValue, 'MC14 should be greater than MC50');
        assert.ok(evalResult.spreadPct > 0, 'Spread should be positive');
    });

    it('should accurately identify a FRESH_BEARISH_CROSS when MC14 crosses below MC50', () => {
        // Construct candles where price was flat at 100, then rose to 105, then dropped to trigger fresh cross
        const candles = [];
        for (let i = 0; i < 50; i++) {
            candles.push({ close: 100, time: 1000 + i * 14400, high: 101, low: 99, open: 100 });
        }
        for (let i = 0; i < 15; i++) {
            candles.push({ close: 105, time: 2000 + i * 14400, high: 106, low: 104, open: 105 });
        }
        for (let i = 0; i < 3; i++) {
            const p = 90 - i * 5;
            candles.push({ close: p, time: 3000 + i * 14400, high: p + 2, low: p - 2, open: p });
        }

        const evalResult = evaluateDualCrossover(candles.slice(0, 67), 14, 50, 0.05);

        assert.equal(evalResult.status, 'FRESH_BEARISH_CROSS');
        assert.ok(evalResult.fastValue < evalResult.slowValue, 'MC14 should be less than MC50');
        assert.ok(evalResult.spreadPct < 0, 'Spread should be negative');
    });
});
