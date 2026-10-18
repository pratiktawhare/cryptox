const STRATEGY_DETAILS = {
    trend_pullback: {
        title: 'Trend Pullback',
        description: 'Dynamic EMA9 limit discount entries on trending coins.',
    },
    radar_fleet: {
        title: 'Radar Fleet',
        description: 'Parallel monitoring of compressed coins with event-driven breakout entries.',
    },
    breakout_straddle: {
        title: 'Breakout Straddle',
        description: 'Dual tripwires around a tight range for focused volatility expansion trades.',
    },
    adaptive_hybrid: {
        title: 'Adaptive Hybrid',
        description: 'Uses trend pullbacks normally and routes compressed markets to the breakout pipeline.',
    },
    regime_ensemble_v1: {
        title: 'Regime Ensemble v1',
        description: 'Research ensemble for regime-aware signal evaluation and paper-forward validation.',
    },
};

const firstDefined = (...values) => values.find(value => value !== undefined && value !== null);

const displayNumber = (value, suffix = '') => {
    if (value === undefined || value === null || value === '') return '—';
    return `${value}${suffix}`;
};

export default function BotStrategySafety({ status, mode = 'paper' }) {
    const config = status?.config || {};
    const effectiveSafety = status?.effectiveSafetySettings
        || status?.effective_safety_settings
        || status?.effectiveSafety
        || status?.effective_safety
        || status?.safety
        || config.effectiveSafetySettings
        || config.effective_safety_settings
        || config.effectiveSafety
        || config.effective_safety
        || config.safety
        || {};

    const strategyType = config.strategyType
        || config.strategy_type
        || status?.strategyType
        || status?.strategy_type
        || 'regime_ensemble_v1';
    const strategy = STRATEGY_DETAILS[strategyType] || {
        title: strategyType.replace(/_/g, ' '),
        description: 'Active strategy reported by the TradingBot runtime.',
    };
    const isResearchStrategy = strategyType === 'regime_ensemble_v1'
        || effectiveSafety.paperFirst === true
        || effectiveSafety.paper_first === true
        || status?.paperFirst === true
        || status?.paper_first === true
        || config.paperFirst === true
        || config.paper_first === true;

    const liveEntryEnabled = firstDefined(
        effectiveSafety.liveEntryEnabled,
        effectiveSafety.live_entry_enabled,
        effectiveSafety.liveEntriesEnabled,
        effectiveSafety.live_entries_enabled,
        effectiveSafety.liveEntry,
        effectiveSafety.allowLiveEntry,
        effectiveSafety.allow_live_entry,
        effectiveSafety.allowLiveEntries,
        effectiveSafety.allow_live_entries,
        effectiveSafety.botLiveAllowed,
        status?.liveEntryEnabled,
        status?.live_entry_enabled,
        status?.liveEntriesEnabled,
        status?.live_entries_enabled,
        status?.allowLiveEntry,
        status?.allow_live_entry,
        status?.botLiveAllowed,
        config.liveEntryEnabled,
        config.live_entry_enabled,
        config.liveEntriesEnabled,
        config.live_entries_enabled,
        config.allowLiveEntry,
        config.allow_live_entry,
        config.allowLiveEntries,
        config.allow_live_entries,
        config.botLiveAllowed,
    );
    const liveEntryDisabled = isResearchStrategy
        || effectiveSafety.liveEntryDisabled === true
        || effectiveSafety.live_entry_disabled === true
        || effectiveSafety.liveEntriesDisabled === true
        || effectiveSafety.live_entries_disabled === true
        || effectiveSafety.liveEntryBlocked === true
        || effectiveSafety.live_entry_blocked === true
        || effectiveSafety.botLiveAllowed === false
        || status?.liveEntryDisabled === true
        || status?.live_entry_disabled === true
        || status?.botLiveAllowed === false
        || config.liveEntryDisabled === true
        || config.live_entry_disabled === true
        || config.liveEntriesDisabled === true
        || config.live_entries_disabled === true
        || config.botLiveAllowed === false
        || liveEntryEnabled === false;

    const liveEntryNeutral = !liveEntryDisabled && mode === 'paper';
    const liveEntryLabel = liveEntryDisabled
        ? 'Live entry disabled'
        : liveEntryNeutral
            ? 'Live entry not active in paper mode'
            : liveEntryEnabled === true
                ? 'Live entry enabled'
                : 'Live entry status unavailable';
    const liveEntryBadge = liveEntryDisabled
        ? 'Blocked'
        : liveEntryNeutral
            ? 'Paper mode'
            : liveEntryEnabled === true ? 'Allowed' : 'Review gate';

    const riskPerTrade = firstDefined(
        effectiveSafety.riskPerTradePct,
        effectiveSafety.risk_per_trade_pct,
        effectiveSafety.maxRiskPerTradePct,
        effectiveSafety.max_risk_per_trade_pct,
        config.riskPerTradePct,
    );
    const maxDailyLoss = firstDefined(
        effectiveSafety.maxDailyLossPct,
        effectiveSafety.max_daily_loss_pct,
        config.maxDailyLossPct,
    );
    const maxConsecutiveLosses = firstDefined(
        effectiveSafety.maxConsecutiveLosses,
        effectiveSafety.max_consecutive_losses,
        config.maxConsecutiveLosses,
    );
    const minSignalScore = firstDefined(
        effectiveSafety.minSignalScore,
        effectiveSafety.min_signal_score,
        config.minSignalScore,
    );
    const stopDistance = firstDefined(
        effectiveSafety.slAtrMultiplier,
        effectiveSafety.sl_atr_multiplier,
        config.slAtrMultiplier,
    );
    const tpSafety = firstDefined(
        effectiveSafety.tpSafetyMultiplier,
        effectiveSafety.tp_safety_multiplier,
        config.tpSafetyMultiplier,
    );

    return (
        <section
            aria-label="Active strategy and effective safety settings"
            className="bg-crypto-card border border-crypto-border/80 rounded-2xl p-4 md:p-5 shadow-sm"
        >
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] gap-5">
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-crypto-muted">
                            Active Strategy
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            isResearchStrategy
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-crypto-primary/10 text-crypto-primary border-crypto-primary/30'
                        }`}>
                            {isResearchStrategy ? 'Paper-first · Research mode' : 'Execution mode'}
                        </span>
                    </div>

                    <div>
                        <h2 className="text-lg font-black text-crypto-heading tracking-tight">
                            {strategy.title}
                        </h2>
                        <code className="text-[10px] text-crypto-muted">{strategyType}</code>
                        <p className="text-[11px] text-crypto-muted mt-2 leading-relaxed">
                            {strategy.description}
                        </p>
                    </div>

                    {isResearchStrategy && (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300 leading-relaxed">
                            <strong className="text-amber-200">Research guardrail:</strong>{' '}
                            evaluate this strategy in paper mode first. It is not approved for live entries.
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-crypto-muted">
                            Effective Safety Settings
                        </span>
                        <span className="text-[10px] text-crypto-muted">
                            Runtime values for {mode} mode
                        </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <SafetyValue label="Risk / trade" value={displayNumber(riskPerTrade, '%')} />
                        <SafetyValue label="Daily loss stop" value={displayNumber(maxDailyLoss, '%')} />
                        <SafetyValue label="Loss breaker" value={displayNumber(maxConsecutiveLosses)} />
                        <SafetyValue label="Min signal" value={displayNumber(minSignalScore, ' / 8')} />
                        <SafetyValue label="Stop distance" value={displayNumber(stopDistance, 'x ATR')} />
                        <SafetyValue label="TP safety" value={displayNumber(tpSafety, 'x')} />
                    </div>

                    <div className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                        liveEntryDisabled
                            ? 'bg-rose-500/10 border-rose-500/30'
                            : liveEntryNeutral
                                ? 'bg-amber-500/10 border-amber-500/25'
                                : 'bg-emerald-500/10 border-emerald-500/25'
                    }`}>
                        <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${liveEntryDisabled ? 'bg-rose-400' : liveEntryNeutral ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            <div className="min-w-0">
                                <p className={`text-xs font-black ${liveEntryDisabled ? 'text-rose-300' : liveEntryNeutral ? 'text-amber-300' : 'text-emerald-300'}`}>
                                    {liveEntryLabel}
                                </p>
                                <p className="text-[10px] text-crypto-muted truncate">
                                    {liveEntryDisabled
                                        ? 'New live positions are blocked; existing positions can still be reduced.'
                                        : liveEntryNeutral
                                            ? 'Switch to live mode to review the live-entry safety gate.'
                                            : liveEntryEnabled === true
                                                ? 'Live entry gate is open for the active configuration.'
                                                : 'The runtime did not provide a live-entry gate value.'}
                                </p>
                            </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap ${
                            liveEntryDisabled
                                ? 'bg-rose-500/15 text-rose-300'
                                : liveEntryNeutral
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : 'bg-emerald-500/15 text-emerald-300'
                        }`}>
                            {liveEntryBadge}
                        </span>
                    </div>
                </div>
            </div>
        </section>
    );
}

function SafetyValue({ label, value }) {
    return (
        <div className="p-2.5 rounded-xl bg-crypto-bg border border-crypto-border/70">
            <p className="text-[10px] text-crypto-muted truncate">{label}</p>
            <p className="text-xs font-black text-crypto-heading tabular-nums mt-0.5">{value}</p>
        </div>
    );
}
