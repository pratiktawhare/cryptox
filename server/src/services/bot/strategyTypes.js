/**
 * Shared strategy identifiers used by configuration and paper audit records.
 */

const REGIME_ENSEMBLE_V1 = 'regime_ensemble_v1';
const DEFAULT_STRATEGY_TYPE = REGIME_ENSEMBLE_V1;

const STRATEGY_TYPES = Object.freeze([
    DEFAULT_STRATEGY_TYPE,
    'trend_pullback',
    'breakout_straddle',
    'radar_fleet',
    'adaptive_hybrid',
    REGIME_ENSEMBLE_V1,
]);

module.exports = {
    DEFAULT_STRATEGY_TYPE,
    REGIME_ENSEMBLE_V1,
    STRATEGY_TYPES,
};
