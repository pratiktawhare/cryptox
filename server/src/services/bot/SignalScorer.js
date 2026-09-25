/**
 * SignalScorer.js
 *
 * Evaluates entry conditions for LONG and SHORT setups.
 * Returns a score 0–8, direction, and individual condition breakdown.
 *
 * Scoring system (each condition = 1 point, max 8):
 *
 *  LONG conditions:
 *   1. 5m EMA9 > EMA21                 (trend direction)
 *   2. 5m EMA21 slope > 0              (trend momentum)
 *   3. 5m close > EMA21                (price above trend)
 *   4. 5m RSI > 50                     (momentum midline)
 *   5. 5m RSI < 75                     (not overbought)
 *   6. 1m EMA9 > EMA21                 (short-term trend aligned)
 *   7. 1m momentum > threshold         (short-term momentum positive)
 *   8. 5m volume ratio > 1.0           (volume confirms move)
 *
 *  SHORT conditions: all reversed
 *
 * Returns the BETTER of LONG/SHORT score (or LONG if tied).
 * If neither meets minScore → decision = NO_SETUP
 */

const { isMomentumConfirming } = require('./indicators/momentum');
const { regimeAllowsTrade }    = require('./RegimeDetector');

// ── Configurable condition thresholds ────────────────────────────────────────
const SCORE_CONFIG = {
    // RSI boundaries
    RSI_BULL_MIN:        50,    // RSI must be > this for long
    RSI_BEAR_MAX:        50,    // RSI must be < this for short
    RSI_OVERBOUGHT:      67,    // long rejected if RSI >= this (tightened from 75 — sweet spot ends at 67)
    RSI_OVERSOLD:        33,    // short rejected if RSI <= this (tightened from 25)

    // RSI deceleration: if RSI exceeds this threshold AND slope is negative → Condition 5 fails.
    // Catches setups where RSI is 63-66 but already rolling over — momentum peaked last bar.
    RSI_SLOPE_HOT_THRESHOLD: 62,

    // Overextension gate: if |close - EMA21| / ATR exceeds this, hard-reject before scoring.
    // Prevents entries after the coin has already run 1.5+ ATRs from its baseline.
    STRETCH_RATIO_MAX: 1.5,

    // Volume confirmation
    VOLUME_CONFIRM_MIN:  1.0,   // volume ratio must be > this

    // Momentum threshold (% ROC)
    MOMENTUM_THRESHOLD:  0.05,  // min momentum % to count as confirmation
};

/**
 * Score a single direction (long or short) against the market snapshot.
 *
 * @param {'long'|'short'} direction
 * @param {object}         snapshot   - from MarketAnalyzer
 * @param {object}         regime     - from RegimeDetector.detectRegime()
 * @returns {{ score: number, conditions: object }}
 */
function scoreDirection(direction, snapshot, regimeResult) {
    const isLong = direction === 'long';
    const tf5    = snapshot['5m'];
    const tf1    = snapshot['1m'];

    const conditions = {};
    let score = 0;

    // ── Condition 1: 5m EMA alignment ────────────────────────────────────────
    if (tf5.ema9 !== null && tf5.ema21 !== null) {
        const pass = isLong ? (tf5.ema9 > tf5.ema21) : (tf5.ema9 < tf5.ema21);
        conditions.emaAlignment = pass;
        if (pass) score++;
    } else {
        conditions.emaAlignment = false;
    }

    // ── Condition 2: 5m EMA21 slope direction ─────────────────────────────────
    if (tf5.ema21Slope !== null) {
        const pass = isLong ? (tf5.ema21Slope > 0) : (tf5.ema21Slope < 0);
        conditions.emaSlope = pass;
        if (pass) score++;
    } else {
        conditions.emaSlope = false;
    }

    // ── Condition 3: Price above/below EMA21 ─────────────────────────────────
    if (tf5.close !== null && tf5.ema21 !== null) {
        const pass = isLong ? (tf5.close > tf5.ema21) : (tf5.close < tf5.ema21);
        conditions.priceVsEma21 = pass;
        if (pass) score++;
    } else {
        conditions.priceVsEma21 = false;
    }

    // ── Condition 4: RSI midline ──────────────────────────────────────────────
    if (tf5.rsi !== null) {
        const pass = isLong
            ? (tf5.rsi > SCORE_CONFIG.RSI_BULL_MIN)
            : (tf5.rsi < SCORE_CONFIG.RSI_BEAR_MAX);
        conditions.rsiMidline = pass;
        if (pass) score++;
    } else {
        conditions.rsiMidline = false;
    }

    // ── Condition 5: RSI not over-extended (ceiling + deceleration guard) ────────
    if (tf5.rsi !== null) {
        // Part A: RSI ceiling — must be below overbought / above oversold
        const ceiling = isLong
            ? (tf5.rsi < SCORE_CONFIG.RSI_OVERBOUGHT)
            : (tf5.rsi > SCORE_CONFIG.RSI_OVERSOLD);

        // Part B: RSI deceleration guard — if RSI is in the "warm zone" (>= HOT_THRESHOLD)
        // it must still be rising. A falling RSI here means momentum peaked last bar.
        // (Only activates when rsiSlope data is available from MarketAnalyzer)
        const rsiHot = isLong
            ? (tf5.rsi >= SCORE_CONFIG.RSI_SLOPE_HOT_THRESHOLD)
            : (tf5.rsi <= (100 - SCORE_CONFIG.RSI_SLOPE_HOT_THRESHOLD));
        const slopeOk = !rsiHot
            || (tf5.rsiSlope !== null && (isLong ? tf5.rsiSlope >= 0 : tf5.rsiSlope <= 0));

        const pass = ceiling && slopeOk;
        conditions.rsiNotExtended = pass;
        if (pass) score++;
    } else {
        conditions.rsiNotExtended = false;
    }

    // ── Condition 6: 1m EMA alignment (short-term trend) ─────────────────────
    if (tf1.ema9 !== null && tf1.ema21 !== null) {
        const pass = isLong ? (tf1.ema9 > tf1.ema21) : (tf1.ema9 < tf1.ema21);
        conditions.shortTermEma = pass;
        if (pass) score++;
    } else {
        conditions.shortTermEma = false;
    }

    // ── Condition 7: 1m momentum ─────────────────────────────────────────────
    if (tf1.momentum !== null) {
        const pass = isMomentumConfirming(tf1.momentum, direction, SCORE_CONFIG.MOMENTUM_THRESHOLD);
        conditions.momentum = pass;
        if (pass) score++;
    } else {
        conditions.momentum = false;
    }

    // ── Condition 8: Volume confirmation ─────────────────────────────────────
    if (tf5.volumeRatio !== null) {
        const pass = tf5.volumeRatio > SCORE_CONFIG.VOLUME_CONFIRM_MIN;
        conditions.volumeConfirm = pass;
        if (pass) score++;
    } else {
        conditions.volumeConfirm = false;
    }

    return { score, conditions };
}

/**
 * Score a market snapshot for both directions, return the best signal.
 *
 * @param {object} snapshot       - from MarketAnalyzer.analyzeSymbol()
 * @param {object} regimeResult   - from RegimeDetector.detectRegime()
 * @param {number} minScore       - minimum score to return a TRADE decision
 * @param {object} [groqResult]   - optional AI regime (may adjust result)
 * @returns {{
 *   direction: 'long'|'short'|null,
 *   score: number,
 *   maxScore: number,
 *   conditions: object,
 *   regime: string,
 *   regimeConfidence: number,
 *   decision: string,
 *   reason: string,
 * }}
 */
function scoreSignal(snapshot, regimeResult, minScore = 5, groqResult = null) {
    const regime = regimeResult?.regime || 'UNCERTAIN';

    // ── Layer 1: Overextension hard gate ─────────────────────────────────────
    // If price is more than STRETCH_RATIO_MAX ATRs from EMA21, the coin already ran.
    // Hard-reject before any scoring — no score is calculated.
    const stretchRatio = snapshot['5m']?.stretchRatio;
    if (stretchRatio != null && stretchRatio > SCORE_CONFIG.STRETCH_RATIO_MAX) {
        return {
            direction:        null,
            score:            0,
            maxScore:         8,
            conditions:       {},
            longScore:        0,
            shortScore:       0,
            regime,
            regimeConfidence: regimeResult?.confidence ?? 0,
            regimeReason:     regimeResult?.reason ?? '',
            groqRegime:       groqResult?.marketRegime ?? null,
            groqConfidence:   groqResult?.confidence ?? null,
            groqRiskAdj:      groqResult?.riskAdjustment ?? 1.0,
            decision:         'OVEREXTENDED',
            reason:           `Price is ${stretchRatio.toFixed(2)}x ATR from EMA21 (max ${SCORE_CONFIG.STRETCH_RATIO_MAX}x) — rally overextended, skipping entry`,
        };
    }

    // ── Score both directions ─────────────────────────────────────────────────
    const longResult  = scoreDirection('long',  snapshot, regimeResult);
    const shortResult = scoreDirection('short', snapshot, regimeResult);

    // ── Pick the better direction ─────────────────────────────────────────────
    let direction;
    let score;
    let conditions;

    if (longResult.score >= shortResult.score) {
        direction  = 'long';
        score      = longResult.score;
        conditions = longResult.conditions;
    } else {
        direction  = 'short';
        score      = shortResult.score;
        conditions = shortResult.conditions;
    }

    // ── Apply Groq AI risk adjustment ─────────────────────────────────────────
    // If AI recommends reduced risk, raise the minimum score requirement by at most +1
    // (e.g. 6/8 becomes 7/8). Never demand 8/8 perfection, allowing high-quality 7/8 setups to execute.
    let effectiveMinScore = minScore;
    if (groqResult?.riskAdjustment != null && groqResult.riskAdjustment < 0.8) {
        effectiveMinScore = Math.min(minScore + 1, 7);
    }

    // ── Check regime allows this direction ────────────────────────────────────
    const regimeOk = regimeAllowsTrade(regime, direction);

    // ── Build decision ────────────────────────────────────────────────────────
    let decision;
    let reason;

    if (score < effectiveMinScore) {
        decision = 'NO_SETUP';
        reason = `Score ${score}/${effectiveMinScore} minimum not met for ${direction}`;
    } else if (!regimeOk) {
        // High technical score (>=6/8) confirms multi-timeframe indicator alignment,
        // which safely qualifies the trade even if the regime classification was mildly hesitant (RANGING/UNCERTAIN).
        // Dangerous HIGH_VOLATILITY (flash spike > 3% ATR) is always respected as a safety block.
        if (score >= Math.max(effectiveMinScore, 6) && regime !== 'HIGH_VOLATILITY') {
            decision = 'TRADE';
            reason = `Score ${score}/8 overrides mild regime (${regime}) for ${direction}`;
        } else {
            decision = 'REJECT';
            reason = `Regime ${regime} does not allow ${direction} trades`;
        }
    } else {
        decision = 'TRADE';
        reason = `Score ${score}/8, regime ${regime}, direction ${direction}`;
    }

    return {
        direction,
        score,
        maxScore: 8,
        conditions,
        longScore:  longResult.score,
        shortScore: shortResult.score,
        regime,
        regimeConfidence: regimeResult?.confidence ?? 0,
        regimeReason:     regimeResult?.reason ?? '',
        groqRegime:       groqResult?.marketRegime ?? null,
        groqConfidence:   groqResult?.confidence ?? null,
        groqRiskAdj:      groqResult?.riskAdjustment ?? 1.0,
        decision,
        reason,
    };
}

/**
 * Score an array of market snapshots (multi-symbol scan).
 * Returns them sorted by score descending.
 *
 * @param {object[]} snapshots      - array from MarketAnalyzer.analyzeSymbols()
 * @param {object}   regimeMap      - { [symbol]: regimeResult }
 * @param {number}   minScore
 * @param {object}   [groqResult]
 * @returns {object[]}  - scored results, sorted by score desc
 */
function scoreSymbols(snapshots, regimeMap, minScore = 5, groqResult = null) {
    return snapshots
        .map(snapshot => ({
            snapshot,
            result: scoreSignal(snapshot, regimeMap[snapshot.symbol], minScore, groqResult),
        }))
        .sort((a, b) => b.result.score - a.result.score);
}

module.exports = { scoreSignal, scoreSymbols, scoreDirection, SCORE_CONFIG };
