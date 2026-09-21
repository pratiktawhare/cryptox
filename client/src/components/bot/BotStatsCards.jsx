import React from 'react';

export default function BotStatsCards({ status, performance, aiRegime, mode }) {
    const stats = status?.stats || {};
    const config = status?.config || {};
    const perf = performance || {};

    // Regime formatting
    const regime = status?.lastRegime?.regime || 'WAITING';
    const regimeConfidence = status?.lastRegime?.confidence ?? 0;
    const regimeReason = status?.lastRegime?.reason || 'Awaiting initial scan cycle';

    const regimeColors = {
        TRENDING_UP:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', label: 'Trending Up' },
        TRENDING_DOWN:   { bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/30',    label: 'Trending Down' },
        RANGING:         { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   label: 'Ranging / Consolidation' },
        HIGH_VOLATILITY: { bg: 'bg-purple-500/10',  text: 'text-purple-400',  border: 'border-purple-500/30',  label: 'High Volatility' },
        LOW_VOLATILITY:  { bg: 'bg-blue-500/10',    text: 'text-blue-400',    border: 'border-blue-500/30',    label: 'Low Volatility' },
        UNCERTAIN:       { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    border: 'border-zinc-500/30',    label: 'Uncertain' },
        WAITING:         { bg: 'bg-crypto-bg',      text: 'text-crypto-muted',border: 'border-crypto-border',  label: 'Standby' },
    };
    const currentRegime = regimeColors[regime] || regimeColors.UNCERTAIN;

    // AI formatting
    const aiActive = Boolean(aiRegime?.regime && aiRegime.regime !== 'UNKNOWN');
    const aiRisk = aiRegime?.riskAdjustment ?? 1.0;
    const aiBias = aiRegime?.macroBias || (aiActive ? aiRegime.regime : 'Standby');

    // Net PnL formatting
    const netPnl = perf.netPnl != null ? perf.netPnl : 0;
    const winRate = perf.winRate != null ? perf.winRate : 0;
    const totalTrades = perf.totalTrades || 0;
    const wins = perf.wins || 0;
    const losses = perf.losses || 0;

    // Circuit breakers
    const dailyLoss = stats.dailyLoss || 0;
    const effectiveBudget = config.budgetUSDT || 10;
    const maxDailyLoss = effectiveBudget * ((config.maxDailyLossPct || 10) / 100);
    const dailyLossPct = maxDailyLoss > 0 ? Math.min(100, (dailyLoss / maxDailyLoss) * 100) : 0;
    const consecutiveLosses = stats.consecutiveLosses || 0;
    const maxConsecutiveLosses = config.maxConsecutiveLosses || 3;
    const isCooldown = stats.cooldownUntil && Date.now() < stats.cooldownUntil;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {/* 1. Market Regime Card */}
            <div className="bg-crypto-card border border-crypto-border/80 hover:border-crypto-primary/40 rounded-2xl p-4 transition-all shadow-sm hover:shadow-md">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-crypto-muted flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-crypto-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                            <polyline points="16 7 22 7 22 13" />
                        </svg>
                        Market Regime
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${currentRegime.bg} ${currentRegime.text} ${currentRegime.border}`}>
                        {Math.round(regimeConfidence * 100)}% Conf
                    </span>
                </div>

                <div className="text-base font-black text-crypto-heading tracking-tight flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${currentRegime.bg.replace('/10', '')} animate-pulse`} />
                    {currentRegime.label}
                </div>

                <p className="text-[11px] text-crypto-muted mt-2 line-clamp-2" title={regimeReason}>
                    {regimeReason}
                </p>

                <div className="mt-3 pt-2.5 border-t border-crypto-border/60 flex items-center justify-between text-[11px]">
                    <span className="text-crypto-muted">Affordable Coins:</span>
                    <span className="font-semibold text-crypto-heading tabular-nums">
                        {status?.symbolsAffordable?.length ?? 0} scanned
                    </span>
                </div>
            </div>

            {/* 2. Groq AI Macro Sentinel Card */}
            <div className="bg-crypto-card border border-crypto-border/80 hover:border-crypto-primary/40 rounded-2xl p-4 transition-all shadow-sm hover:shadow-md">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-crypto-muted flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                        Groq AI Sentinel
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        aiActive
                            ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
                    }`}>
                        {aiActive ? 'LLM Active' : 'Pure TA Fallback'}
                    </span>
                </div>

                <div className="text-base font-black text-crypto-heading tracking-tight flex items-center gap-2">
                    <span className="capitalize">{aiBias.replace(/_/g, ' ')}</span>
                </div>

                <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-crypto-muted">Risk Multiplier:</span>
                        <span className="font-bold text-crypto-heading tabular-nums">
                            {aiRisk.toFixed(2)}x {aiRisk < 1.0 ? '(Defensive)' : '(Standard)'}
                        </span>
                    </div>
                    <div className="w-full bg-crypto-bg rounded-full h-1.5 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${
                                aiRisk < 0.6 ? 'bg-amber-400' : 'bg-crypto-primary'
                            }`}
                            style={{ width: `${Math.min(100, aiRisk * 100)}%` }}
                        />
                    </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-crypto-border/60 flex items-center justify-between text-[11px]">
                    <span className="text-crypto-muted">Model:</span>
                    <span className="font-semibold text-crypto-heading truncate max-w-[120px]" title={aiRegime?.model || 'llama-3.3-70b-versatile'}>
                        {aiRegime?.model ? aiRegime.model.split('/').pop() : 'llama-3.3-70b'}
                    </span>
                </div>
            </div>

            {/* 3. Session Performance Card */}
            <div className="bg-crypto-card border border-crypto-border/80 hover:border-crypto-primary/40 rounded-2xl p-4 transition-all shadow-sm hover:shadow-md">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-crypto-muted flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-crypto-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Bot Net Realized PnL
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-crypto-bg border border-crypto-border text-crypto-muted">
                        {totalTrades} trades
                    </span>
                </div>

                <div className={`text-xl font-black tracking-tight tabular-nums flex items-baseline gap-1.5 ${
                    netPnl > 0 ? 'text-crypto-success' : netPnl < 0 ? 'text-crypto-danger' : 'text-crypto-heading'
                }`}>
                    {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                    <span className="text-xs font-semibold text-crypto-muted">
                        USDT
                    </span>
                </div>
                <div className={`text-xs font-bold tabular-nums mt-0.5 ${
                    netPnl > 0 ? 'text-crypto-success' : netPnl < 0 ? 'text-crypto-danger' : 'text-crypto-muted'
                }`}>
                    ≈ {netPnl >= 0 ? '+' : '-'}₹{(Math.abs(netPnl) * 85).toFixed(2)}
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-crypto-muted">Win Rate:</span>
                    <span className="font-bold text-crypto-heading tabular-nums">
                        {winRate.toFixed(1)}% <span className="font-normal text-crypto-muted">({wins}W / {losses}L)</span>
                    </span>
                </div>

                <div className="mt-3 pt-2.5 border-t border-crypto-border/60 flex items-center justify-between text-[11px]">
                    <span className="text-crypto-muted">Total Fees:</span>
                    <span className="font-semibold text-crypto-muted tabular-nums">
                        ${(perf.totalFees || 0).toFixed(4)}
                    </span>
                </div>
            </div>

            {/* 4. Circuit Breaker & Safety Guardrail Card */}
            <div className="bg-crypto-card border border-crypto-border/80 hover:border-crypto-primary/40 rounded-2xl p-4 transition-all shadow-sm hover:shadow-md">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-crypto-muted flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                        </svg>
                        Safety Circuit Breaker
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        isCooldown
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    }`}>
                        {isCooldown ? 'Cooldown' : 'Armed & Safe'}
                    </span>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-crypto-muted">Daily Loss Limit:</span>
                        <span className="font-bold text-crypto-heading tabular-nums">
                            ${dailyLoss.toFixed(2)} / ${maxDailyLoss.toFixed(2)}
                        </span>
                    </div>
                    <div className="w-full bg-crypto-bg rounded-full h-1.5 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${
                                dailyLossPct >= 80 ? 'bg-red-500' : dailyLossPct >= 50 ? 'bg-amber-400' : 'bg-crypto-success'
                            }`}
                            style={{ width: `${dailyLossPct}%` }}
                        />
                    </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-crypto-border/60 flex items-center justify-between text-[11px]">
                    <span className="text-crypto-muted">Consecutive Losses:</span>
                    <span className="font-semibold text-crypto-heading tabular-nums">
                        {consecutiveLosses} / {maxConsecutiveLosses} max
                    </span>
                </div>
            </div>
        </div>
    );
}
