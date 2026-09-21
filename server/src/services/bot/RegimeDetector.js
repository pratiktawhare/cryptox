/**
 * RegimeDetector.js
 *
 * Classifies current market conditions for a symbol using the normalized
 * snapshot from MarketAnalyzer.
 *
 * Regimes:
 *   TRENDING_UP      — EMA aligned bullishly, slope positive, RSI > 50
 *   TRENDING_DOWN    — EMA aligned bearishly, slope negative, RSI < 50
 *   RANGING          — EMAs close together, flat slope, no momentum
 *   HIGH_VOLATILITY  — ATR% above threshold (risky, reduce/avoid)
 *   LOW_VOLATILITY   — ATR% below threshold (spread may exceed profit)
 *   UNCERTAIN        — Conflicting signals, no clear regime
 *
 * All thresholds are configurable at the top of this file.
 */

// ── Configurable thresholds ──────────────────────────────────────────────────

const THRESHOLDS = {
    // ATR as % of price
    HIGH_VOLATILITY_ATR_PCT:  3.0,   // ATR > 3% of price → HIGH_VOLATILITY (black swan / spike danger)
    LOW_VOLATILITY_ATR_PCT:   0.025, // ATR < 0.025% of price → LOW_VOLATILITY (only when dead flat/frozen)

    // EMA proximity: if |EMA9 - EMA21| / EMA21 < this % → EMAs are too close → RANGING candidate
    EMA_PROXIMITY_PCT: 0.10,

    // EMA21 slope: below this % of price per candle → considered flat
    EMA_SLOPE_FLAT_PCT: 0.002, // % of price per candle

    // RSI midline for trend confirmation
    RSI_BULL_MIN: 45,
    RSI_BEAR_MAX: 55,

    // Minimum EMA separation to call a clear trend (% of price)
    EMA_TREND_MIN_SEPARATION_PCT: 0.02,
};

/**
 * Classify market regime for a symbol.
 *
 * @param {object} snapshot - Output from MarketAnalyzer.analyzeSymbol()
 * @returns {{ regime: string, confidence: number, reason: string }}
 */
function detectRegime(snapshot) {
    if (!snapshot) {
        return { regime: 'UNCERTAIN', confidence: 0, reason: 'No market snapshot available' };
    }

    const tf5 = snapshot['5m'];
    if (!tf5) {
        return { regime: 'UNCERTAIN', confidence: 0, reason: 'No 5m data' };
    }

    const { ema9, ema21, ema21Slope, rsi, atrPct } = tf5;

    // ── Guard: not enough indicator data ────────────────────────────────────
    if (ema9 === null || ema21 === null) {
        return { regime: 'UNCERTAIN', confidence: 0, reason: 'EMA data unavailable' };
    }

    // ── 1. High volatility guard (extreme spikes/flash crashes - highest priority) ───
    if (atrPct !== null && atrPct > THRESHOLDS.HIGH_VOLATILITY_ATR_PCT) {
        return {
            regime:     'HIGH_VOLATILITY',
            confidence: Math.min(1, atrPct / (THRESHOLDS.HIGH_VOLATILITY_ATR_PCT * 2)),
            reason:     `ATR% ${atrPct.toFixed(2)}% exceeds high-volatility threshold ${THRESHOLDS.HIGH_VOLATILITY_ATR_PCT}%`,
        };
    }

    // ── 2. EMA alignment & relative slope (% of price) ──────────────────────
    const emaProximityPct = ema21 > 0
        ? Math.abs(ema9 - ema21) / ema21 * 100
        : 0;

    const slope = ema21Slope ?? 0;
    // Calculate slope as % of EMA21 price so it scales identically for all coin price ranges
    const slopePct = ema21 > 0 ? (slope / ema21) * 100 : 0;

    const slopeFlat   = Math.abs(slopePct) < THRESHOLDS.EMA_SLOPE_FLAT_PCT;
    const emaTooClose = emaProximityPct < THRESHOLDS.EMA_PROXIMITY_PCT;

    // ── 3. Trending up (takes precedence over calm/low-volatility) ───────────
    const bullishEMA   = ema9 > ema21 && emaProximityPct >= THRESHOLDS.EMA_TREND_MIN_SEPARATION_PCT;
    const bullishSlope = slopePct > THRESHOLDS.EMA_SLOPE_FLAT_PCT;
    const bullishRSI   = rsi !== null ? rsi > THRESHOLDS.RSI_BULL_MIN : true; // pass if unavailable

    if (bullishEMA && bullishSlope && bullishRSI) {
        const confidence = Math.min(1, (
            (bullishEMA   ? 0.4 : 0) +
            (bullishSlope ? 0.3 : 0) +
            (bullishRSI   ? 0.3 : 0)
        ));
        return {
            regime:     'TRENDING_UP',
            confidence,
            reason:     `EMA9(${ema9.toFixed(4)}) > EMA21(${ema21.toFixed(4)}), slope +${slopePct.toFixed(4)}%, RSI ${rsi?.toFixed(1)}`,
        };
    }

    // ── 4. Trending down ─────────────────────────────────────────────────────
    const bearishEMA   = ema9 < ema21 && emaProximityPct >= THRESHOLDS.EMA_TREND_MIN_SEPARATION_PCT;
    const bearishSlope = slopePct < -THRESHOLDS.EMA_SLOPE_FLAT_PCT;
    const bearishRSI   = rsi !== null ? rsi < THRESHOLDS.RSI_BEAR_MAX : true;

    if (bearishEMA && bearishSlope && bearishRSI) {
        const confidence = Math.min(1, (
            (bearishEMA   ? 0.4 : 0) +
            (bearishSlope ? 0.3 : 0) +
            (bearishRSI   ? 0.3 : 0)
        ));
        return {
            regime:     'TRENDING_DOWN',
            confidence,
            reason:     `EMA9(${ema9.toFixed(4)}) < EMA21(${ema21.toFixed(4)}), slope ${slopePct.toFixed(4)}%, RSI ${rsi?.toFixed(1)}`,
        };
    }

    // ── 5. Low volatility check (only if not in a clear trend) ───────────────
    if (atrPct !== null && atrPct < THRESHOLDS.LOW_VOLATILITY_ATR_PCT) {
        return {
            regime:     'LOW_VOLATILITY',
            confidence: Math.min(1, (THRESHOLDS.LOW_VOLATILITY_ATR_PCT - atrPct) / THRESHOLDS.LOW_VOLATILITY_ATR_PCT),
            reason:     `ATR% ${atrPct.toFixed(3)}% below low-volatility threshold ${THRESHOLDS.LOW_VOLATILITY_ATR_PCT}%`,
        };
    }

    // ── 6. Ranging: EMAs close + flat slope ──────────────────────────────────
    if (emaTooClose && slopeFlat) {
        return {
            regime:     'RANGING',
            confidence: Math.min(1, 1 - emaProximityPct / THRESHOLDS.EMA_PROXIMITY_PCT),
            reason:     `EMAs within ${emaProximityPct.toFixed(3)}% and slope flat (${slopePct.toFixed(4)}%)`,
        };
    }

    // ── 7. Fallback ───────────────────────────────────────────────────────────
    return {
        regime:     'UNCERTAIN',
        confidence: 0.3,
        reason:     `Mixed signals: EMA sep ${emaProximityPct.toFixed(3)}%, slope ${slopePct.toFixed(4)}%, RSI ${rsi?.toFixed(1) ?? 'n/a'}`,
    };
}

/**
 * Returns whether a regime permits trading.
 *
 * @param {string} regime
 * @param {'long'|'short'} direction
 * @returns {boolean}
 */
function regimeAllowsTrade(regime, direction) {
    if (regime === 'TRENDING_UP'   && direction === 'long')  return true;
    if (regime === 'TRENDING_DOWN' && direction === 'short') return true;
    // Low volatility does not invalidate technical setups; scalping/fading thrives in calm, steady conditions
    if (regime === 'LOW_VOLATILITY') return true;
    return false; // HIGH_VOLATILITY, RANGING, UNCERTAIN
}

module.exports = { detectRegime, regimeAllowsTrade, THRESHOLDS };
