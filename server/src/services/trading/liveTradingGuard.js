/**
 * Fail-closed authorization for authenticated Delta trading actions.
 *
 * Opening or increasing a live position requires all of:
 *   1. TRADING_MODE=live
 *   2. ENABLE_LIVE_TRADING=true
 *   3. the user's accountMode=live
 *   4. an active Delta key with read_write permission
 *
 * Reduce-only actions may be allowed while the global opening switch is off,
 * so an operator can still safely unwind an existing position.
 */

function liveTradingError(message) {
    const error = new Error(message);
    error.code = 'LIVE_TRADING_BLOCKED';
    return error;
}

function assertLiveTradingAllowed({ user, apiKey, config, allowReduceOnly = false } = {}) {
    if (!user) {
        throw liveTradingError('Live trading requires an authenticated user');
    }

    if (!apiKey || apiKey.exchange !== 'delta' || apiKey.isActive !== true) {
        throw liveTradingError('An active Delta Exchange API key is required for live trading');
    }

    if (apiKey.permissions !== 'read_write') {
        throw liveTradingError('The active Delta API key must have read_write permission for trading');
    }

    // Risk-reducing actions must remain available so disabling new entries does
    // not strand an already-open position.
    if (allowReduceOnly) return true;

    if (user.accountMode !== 'live') {
        throw liveTradingError('Live trading is blocked because the account is in paper mode');
    }

    if (!config?.botLiveAllowed) {
        throw liveTradingError(
            'Live order placement is disabled. Set TRADING_MODE=live and ENABLE_LIVE_TRADING=true explicitly.'
        );
    }

    return true;
}

module.exports = { assertLiveTradingAllowed, liveTradingError };
