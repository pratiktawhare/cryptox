/**
 * BreakoutScanner.js
 *
 * Scans candidate crypto symbols for Volatility Compression (TTM Squeeze)
 * and calculates Dual Breakout Tripwires (Upper Resistance & Lower Support)
 * with Anti-Wick ATR Buffers.
 */

const candleStore = require('./CandleStore');
const { calcBollingerBands } = require('./indicators/bollinger');
const { calcKeltnerChannels } = require('./indicators/keltner');
const { calcATR } = require('./indicators/atr');

class BreakoutScanner {
    /**
     * Checks if a symbol's 5m candles have been in a TTM Squeeze for consecutive bars.
     *
     * @param {object[]} candles5m - Array of 5m candles
     * @param {number} minConsecutiveBars - Default 3
     * @returns {{ inSqueeze: boolean, consecutiveCount: number, currentBandwidth: number|null }}
     */
    checkSqueezeHistory(candles5m, minConsecutiveBars = 3) {
        if (!candles5m || candles5m.length < 25) {
            return { inSqueeze: false, consecutiveCount: 0, currentBandwidth: null };
        }

        // Use confirmed closed candles
        const closed = candles5m.slice(0, -1);
        if (closed.length < 22) {
            return { inSqueeze: false, consecutiveCount: 0, currentBandwidth: null };
        }

        let consecutive = 0;
        let latestBandwidth = null;

        // Check the last N bars in reverse
        for (let i = closed.length - 1; i >= Math.max(0, closed.length - 10); i--) {
            const sub = closed.slice(0, i + 1);
            const subCloses = sub.map(c => c.close);
            const subHighs  = sub.map(c => c.high);
            const subLows   = sub.map(c => c.low);

            const bb = calcBollingerBands(subCloses, 20, 2.0);
            const kc = calcKeltnerChannels(subHighs, subLows, subCloses, 20, 14, 1.5);

            if (!bb || !kc) break;

            if (latestBandwidth === null) {
                latestBandwidth = bb.bandwidth;
            }

            const squeeze = bb.upper <= kc.upper && bb.lower >= kc.lower;
            if (squeeze) {
                consecutive++;
            } else {
                break; // streak broken
            }
        }

        return {
            inSqueeze: consecutive >= minConsecutiveBars,
            consecutiveCount: consecutive,
            currentBandwidth: latestBandwidth,
        };
    }

    /**
     * Evaluates a single symbol for Breakout Straddle setup.
     *
     * @param {string} symbol
     * @param {object} config - TradingConfig
     * @param {object} wsManager
     * @returns {Promise<object|null>} Tripwire setup or null
     */
    async evaluateSymbol(symbol, config = {}, wsManager = null) {
        const sym = symbol.toUpperCase();

        // 1. Ensure candle buffers exist
        await candleStore.ensureCandles(sym, '5m', 40);
        await candleStore.ensureCandles(sym, '1m', 30);

        const candles5m = candleStore.getCandles(sym, '5m', 40);
        if (!candles5m || candles5m.length < 25) return null;

        const closed5m = candles5m.slice(0, -1);
        const closedCloses = closed5m.map(c => c.close);
        const closedHighs  = closed5m.map(c => c.high);
        const closedLows   = closed5m.map(c => c.low);

        const minSqueezeBars = config.breakoutSqueezeBars || 3;
        const squeezeStatus = this.checkSqueezeHistory(candles5m, minSqueezeBars);

        if (!squeezeStatus.inSqueeze) {
            return null; // Not coiled enough
        }

        // 2. Compute 20-candle consolidation boundaries
        const lookback = Math.min(20, closed5m.length);
        const recentHighs = closedHighs.slice(-lookback);
        const recentLows  = closedLows.slice(-lookback);

        const rangeHigh = Math.max(...recentHighs);
        const rangeLow  = Math.min(...recentLows);
        const atr = calcATR(closedHighs, closedLows, closedCloses, 14) || ((rangeHigh - rangeLow) * 0.1);

        // 3. Anti-wick buffer
        const bufferMultiplier = config.breakoutAtrBufferMultiplier || 0.15;
        const atrBuffer = atr * bufferMultiplier;

        const upperTripwire = rangeHigh + atrBuffer;
        const lowerTripwire = rangeLow - atrBuffer;

        // 4. Target Take Profit and Stop Loss geometry (for 20x leverage)
        const targetRoiPct = config.breakoutTargetRoiPct || 10; // e.g. 10% ROI
        const leverage = config.maxLeverage || 20;
        const targetPriceMovePct = targetRoiPct / leverage / 100; // e.g. 10 / 20 / 100 = 0.005 (0.50%)

        const takeProfitLong = upperTripwire * (1 + targetPriceMovePct);
        const stopLossLong   = rangeHigh - (atrBuffer * 0.5); // just inside the broken range

        const takeProfitShort = lowerTripwire * (1 - targetPriceMovePct);
        const stopLossShort   = rangeLow + (atrBuffer * 0.5);

        // 5. Current price
        let currentPrice = closedCloses[closedCloses.length - 1];
        if (wsManager?.getPrice) {
            const p = wsManager.getPrice(sym);
            if (p && p > 0) currentPrice = p;
        }

        return {
            symbol: sym,
            inSqueeze: true,
            squeezeBars: squeezeStatus.consecutiveCount,
            bandwidth: squeezeStatus.currentBandwidth,
            currentPrice,
            rangeHigh,
            rangeLow,
            atr,
            atrBuffer,
            upperTripwire,
            lowerTripwire,
            takeProfitLong,
            stopLossLong,
            takeProfitShort,
            stopLossShort,
            targetRoiPct,
            targetPriceMovePct,
            armedAt: Date.now(),
        };
    }

    /**
     * Scans an array of symbols and returns all armed breakout candidates.
     *
     * @param {string[]} symbols
     * @param {object} config
     * @param {object} wsManager
     * @returns {Promise<object[]>}
     */
    async scanAll(symbols, config = {}, wsManager = null) {
        const results = [];
        for (const symbol of symbols) {
            try {
                const setup = await this.evaluateSymbol(symbol, config, wsManager);
                if (setup) results.push(setup);
            } catch (err) {
                console.warn(`[BreakoutScanner] Error evaluating ${symbol}:`, err.message);
            }
        }
        return results;
    }
}

module.exports = new BreakoutScanner();
