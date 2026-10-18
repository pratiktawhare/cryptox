/**
 * StrategySelector.js
 *
 * Keeps strategy selection separate from execution. Existing strategies keep
 * their current scorer and the regime ensemble is loaded only when selected,
 * so the backend remains bootable before its pure module is present.
 */

const { detectRegime } = require('./RegimeDetector');
const { scoreSignal } = require('./SignalScorer');
const {
    DEFAULT_STRATEGY_TYPE,
    REGIME_ENSEMBLE_V1,
} = require('./strategyTypes');

function loadRegimeEnsembleV1() {
    try {
        return require('./strategies/regimeEnsembleV1');
    } catch (err) {
        // Keep compatibility with the already-added underscore-named module
        // while the canonical strategies/regimeEnsembleV1.js path is migrated.
        if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('strategies/regimeEnsembleV1')) {
            try {
                return require('./regime_ensemble_v1');
            } catch (fallbackErr) {
                if (fallbackErr.code === 'MODULE_NOT_FOUND') {
                    throw new Error(
                        'regime_ensemble_v1 is selected but server/src/services/bot/strategies/regimeEnsembleV1.js is not available'
                    );
                }
                throw fallbackErr;
            }
        }
        throw err;
    }
}

function getStrategyEvaluator(moduleExports) {
    if (typeof moduleExports === 'function') return moduleExports;
    if (typeof moduleExports?.evaluate === 'function') return moduleExports.evaluate;
    if (typeof moduleExports?.evaluateRegimeEnsembleV1 === 'function') {
        return moduleExports.evaluateRegimeEnsembleV1;
    }
    if (typeof moduleExports?.generateSignal === 'function') return moduleExports.generateSignal;
    return null;
}

/**
 * Call the pure strategy module using the object contract. A two-argument
 * function is also supported for candle-based modules that use (candles, config).
 */
function evaluateRegimeEnsembleV1(input) {
    const moduleExports = loadRegimeEnsembleV1();
    const evaluator = getStrategyEvaluator(moduleExports);
    if (!evaluator) {
        throw new Error(
            'regime_ensemble_v1 must export a function, evaluate(), evaluateRegimeEnsembleV1(), or generateSignal()'
        );
    }

    const config = typeof input.config?.toObject === 'function'
        ? input.config.toObject()
        : (input.config || {});
    const strategyOptions = {
        ...config,
        ...(input.now !== undefined ? { now: input.now } : {}),
    };
    const candleEvaluator = evaluator.length >= 2
        || moduleExports?.STRATEGY_ID === REGIME_ENSEMBLE_V1
        || typeof moduleExports?.decide === 'function';
    const result = candleEvaluator
        ? evaluator(input.candles || input.snapshot, strategyOptions, input)
        : evaluator(input);

    return result && typeof result === 'object' ? result : {};
}

function directionFromResult(result) {
    if (result.direction === 'long' || result.direction === 'short') return result.direction;
    if (result.action === 'BUY') return 'long';
    if (result.action === 'SELL') return 'short';
    return null;
}

function canonicalRegime(regime, direction) {
    const knownRegimes = new Set([
        'TRENDING_UP', 'TRENDING_DOWN', 'RANGING',
        'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'UNCERTAIN',
    ]);
    if (knownRegimes.has(regime)) return regime;
    if (regime === 'trend') return direction === 'short' ? 'TRENDING_DOWN' : 'TRENDING_UP';
    if (regime === 'compression' || regime === 'range') return 'RANGING';
    return null;
}

function normalizeRegimeResult(result, fallback) {
    if (result?.regimeResult?.regime) {
        const direction = directionFromResult(result) || result.trendDirection;
        return {
            ...result.regimeResult,
            regime: canonicalRegime(result.regimeResult.regime, direction)
                || result.regimeResult.regime,
        };
    }
    if (result?.regime) {
        const direction = directionFromResult(result) || result.trendDirection;
        const regime = canonicalRegime(result.regime, direction);
        return {
            ...(fallback || {}),
            regime: regime || fallback?.regime || 'UNCERTAIN',
            confidence: result.regimeConfidence ?? result.confidence ?? fallback?.confidence ?? 0,
            reason: result.regimeReason ?? fallback?.reason ?? 'Regime ensemble result',
        };
    }
    return fallback;
}

/**
 * Normalize the pure module's output to the signal shape consumed by the
 * existing TradingBot, RiskEngine, and paper execution flow.
 */
function normalizeRegimeEnsembleResult(rawResult, input) {
    const result = rawResult?.signal && typeof rawResult.signal === 'object'
        ? rawResult.signal
        : rawResult;
    const regimeResult = normalizeRegimeResult(result, input.regimeResult);
    const direction = directionFromResult(result);
    const confidenceScore = Number(result.confidence) * 8;
    const accepted = result.accepted === true || result.decision === 'ENTER';
    const score = Number.isFinite(Number(result.score))
        ? Number(result.score)
        : (accepted
            ? (Number.isFinite(confidenceScore) ? confidenceScore : (input.config.minSignalScore ?? 5))
            : 0);
    const maxScore = Number.isFinite(Number(result.maxScore)) ? Number(result.maxScore) : 8;
    const metadata = result.strategyMetadata || {
        ...(result.metadata || {}),
        strategy: result.strategy,
        setup: result.setup,
        accepted: result.accepted,
        rejectionReasons: result.rejectionReasons,
        geometry: result.geometry,
    };
    const rawDecision = result.decision;
    const decision = rawDecision === 'ENTER' || result.accepted === true
        ? 'TRADE'
        : rawDecision === 'REJECT' || rawDecision === 'NO_TRADE'
            ? 'NO_SETUP'
            : rawDecision || (
                direction && score >= (input.config.minSignalScore ?? 5) ? 'TRADE' : 'NO_SETUP'
            );

    return {
        ...result,
        direction,
        score,
        maxScore,
        conditions: result.conditions || result.votes || {},
        regime: regimeResult?.regime || null,
        regimeConfidence: regimeResult?.confidence ?? 0,
        regimeReason: regimeResult?.reason || '',
        decision,
        reason: result.reason
            || result.rejectionReasons?.join(', ')
            || `regime_ensemble_v1 returned ${decision}`,
        strategyMetadata: metadata,
    };
}

/**
 * Select the signal evaluator for one market snapshot.
 *
 * @returns {{ scoreResult: object, regimeResult: object, strategyMetadata: object }}
 */
function selectStrategy({
    strategyType = DEFAULT_STRATEGY_TYPE,
    snapshot,
    config = {},
    groqResult = null,
    regimeResult = null,
    candles = null,
    now,
}) {
    const detectedRegime = regimeResult || detectRegime(snapshot);

    if (strategyType === REGIME_ENSEMBLE_V1) {
        const result = normalizeRegimeEnsembleResult(
            evaluateRegimeEnsembleV1({
                symbol: snapshot?.symbol,
                snapshot,
                config,
                regimeResult: detectedRegime,
                groqResult,
                candles,
                now,
            }),
            { snapshot, config, regimeResult: detectedRegime }
        );

        return {
            scoreResult: result,
            regimeResult: normalizeRegimeResult(result, detectedRegime),
            strategyMetadata: result.strategyMetadata,
        };
    }

    return {
        scoreResult: scoreSignal(snapshot, detectedRegime, config.minSignalScore, groqResult),
        regimeResult: detectedRegime,
        strategyMetadata: {},
    };
}

module.exports = {
    evaluateRegimeEnsembleV1,
    normalizeRegimeEnsembleResult,
    selectStrategy,
};
