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
     * Checks if a symbol's 5m candles have been in a Volatility Compression / Squeeze for consecutive bars.
     *
     * In crypto perpetuals, standard 2.0σ BB inside 1.5 ATR KC is statistically rare (occurring <3% of the time).
     * We support crypto-calibrated compression:
     * 1. Standard Crypto Keltner: BB(2.0) inside KC(kcMultiplier, default 2.0).
     * 2. Bollinger Bandwidth Compression: Bandwidth <= maxBandwidth (default 1.5% / 0.015).
     *
     * @param {object[]} candles5m - Array of 5m candles
     * @param {number} minConsecutiveBars - Default 2
     * @param {number} kcMultiplier - Default 2.0
     * @param {number} maxBandwidth - Default 0.015 (1.5%)
     * @returns {{ inSqueeze: boolean, consecutiveCount: number, currentBandwidth: number|null, squeezeType: string|null }}
     */
    checkSqueezeHistory(candles5m, minConsecutiveBars = 2, kcMultiplier = 2.0, maxBandwidth = 0.015) {
        if (!candles5m || candles5m.length < 25) {
            return { inSqueeze: false, consecutiveCount: 0, currentBandwidth: null, squeezeType: null };
        }

        // Use confirmed closed candles
        const closed = candles5m.slice(0, -1);
        if (closed.length < 22) {
            return { inSqueeze: false, consecutiveCount: 0, currentBandwidth: null, squeezeType: null };
        }

        let consecutive = 0;
        let latestBandwidth = null;
        let latestSqueezeType = null;

        // Check the last N bars in reverse
        for (let i = closed.length - 1; i >= Math.max(0, closed.length - 10); i--) {
            const sub = closed.slice(0, i + 1);
            const subCloses = sub.map(c => c.close);
            const subHighs  = sub.map(c => c.high);
            const subLows   = sub.map(c => c.low);

            const bb = calcBollingerBands(subCloses, 20, 2.0);
            const kc = calcKeltnerChannels(subHighs, subLows, subCloses, 20, 14, kcMultiplier);

            if (!bb || !kc) break;

            if (latestBandwidth === null) {
                latestBandwidth = bb.bandwidth;
            }

            const inKeltner = bb.upper <= kc.upper && bb.lower >= kc.lower;
            const inBandwidth = bb.bandwidth <= maxBandwidth;
            const squeeze = inKeltner || inBandwidth;

            if (squeeze) {
                consecutive++;
                if (!latestSqueezeType) {
                    if (inKeltner && inBandwidth) latestSqueezeType = 'DUAL_COMPRESSION';
                    else if (inKeltner) latestSqueezeType = 'KC_CONTAINED';
                    else latestSqueezeType = 'BANDWIDTH_SQUEEZE';
                }
            } else {
                break; // streak broken
            }
        }

        return {
            inSqueeze: consecutive >= minConsecutiveBars,
            consecutiveCount: consecutive,
            currentBandwidth: latestBandwidth,
            squeezeType: latestSqueezeType,
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

        const minSqueezeBars = config.breakoutSqueezeBars !== undefined ? config.breakoutSqueezeBars : 2;
        const kcMultiplier = config.breakoutKcMultiplier !== undefined ? config.breakoutKcMultiplier : 2.0;
        const maxBandwidth = config.breakoutMaxBandwidth !== undefined ? config.breakoutMaxBandwidth : 0.015;

        const squeezeStatus = this.checkSqueezeHistory(candles5m, minSqueezeBars, kcMultiplier, maxBandwidth);

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

        // 4. Target Take Profit and Stop Loss geometry (strictly follows bot setting config.slAtrMultiplier)
        // Multiplies target distance by configured multiplier (e.g. 0.33% target × 5x = ~1.65% stop loss), matching RiskEngine.js
        const targetRoiPct = config.breakoutTargetRoiPct || config.targetRoiPct || 6; // e.g. 6% ROI
        const leverage = config.maxLeverage || 20;
        const baseTargetPriceMovePct = targetRoiPct / leverage / 100;
        // Include round-trip fee buffer (0.0826%) so net target ROI is fully preserved
        const targetPriceMovePct = Math.max(baseTargetPriceMovePct + 0.000826, 0.003);

        const tpDistanceLong  = upperTripwire * targetPriceMovePct;
        const tpDistanceShort = lowerTripwire * targetPriceMovePct;

        const takeProfitLong  = upperTripwire + tpDistanceLong;
        const takeProfitShort = lowerTripwire - tpDistanceShort;

        // Stop Loss distance: Follow configured bot setting (config.slAtrMultiplier, default 5.0x Target Distance)
        // Matches RiskEngine.js: slDistance = requiredTpDist * slMultiplier
        const slMultiplier = (config.slAtrMultiplier && config.slAtrMultiplier > 0) ? config.slAtrMultiplier : 5.0;
        let slDistanceLong  = Math.max(tpDistanceLong * slMultiplier, atr * slMultiplier);
        let slDistanceShort = Math.max(tpDistanceShort * slMultiplier, atr * slMultiplier);

        // Safeguard 1: Ensure SL does NOT exceed 85% of liquidation distance (e.g. max ~4.25% at 20x)
        const maxSafeSlLong = upperTripwire * ((1 / leverage) * 0.85);
        if (slDistanceLong > maxSafeSlLong) {
            slDistanceLong = maxSafeSlLong;
        }
        const maxSafeSlShort = lowerTripwire * ((1 / leverage) * 0.85);
        if (slDistanceShort > maxSafeSlShort) {
            slDistanceShort = maxSafeSlShort;
        }

        // Safeguard 2: Minimum safe distance to prevent instant noise stops (at least 0.8% of price or 1x TP distance)
        const minSafeSlLong = Math.max(upperTripwire * 0.008, tpDistanceLong);
        if (slDistanceLong < minSafeSlLong) {
            slDistanceLong = minSafeSlLong;
        }
        const minSafeSlShort = Math.max(lowerTripwire * 0.008, tpDistanceShort);
        if (slDistanceShort < minSafeSlShort) {
            slDistanceShort = minSafeSlShort;
        }

        const stopLossLong   = upperTripwire - slDistanceLong;
        const stopLossShort  = lowerTripwire + slDistanceShort;

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
            squeezeType: squeezeStatus.squeezeType,
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
