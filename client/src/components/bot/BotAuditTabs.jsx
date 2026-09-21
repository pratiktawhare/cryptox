import React, { useState } from 'react';
import api from '../../services/api';
import BotEquityChart from './BotEquityChart';

const CONDITION_LABELS = {
    emaAlignment: '5m EMA9 / EMA21 Alignment',
    emaSlope: '5m EMA21 Slope Direction',
    priceVsEma21: '5m Price vs EMA21 Position',
    rsiMidline: '5m RSI Midline (Bull/Bear)',
    rsiNotExtended: '5m RSI Not Over-extended',
    shortTermEma: '1m EMA Alignment (Entry Timing)',
    momentum: '1m Momentum Confirmation',
    volumeConfirm: 'Volume > Average (Confirmation)',
};

function getDecisionBadge(decision) {
    switch (decision) {
        case 'TRADE':
            return {
                label: '⚡ TRADE EXECUTED',
                style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                dot: 'bg-emerald-400',
            };
        case 'SKIPPED_RISK':
            return {
                label: '🛑 RISK REJECT',
                style: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
                dot: 'bg-rose-400',
            };
        case 'SKIPPED_COST':
            return {
                label: '💸 HIGH COST / FEES',
                style: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                dot: 'bg-amber-400',
            };
        case 'SKIPPED_OPEN_POSITION':
            return {
                label: '🔒 1/1 OPEN POS LIMIT',
                style: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                dot: 'bg-amber-400',
            };
        case 'SKIPPED_COOLDOWN':
            return {
                label: '⏳ SAFETY COOLDOWN',
                style: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                dot: 'bg-amber-400',
            };
        case 'SKIPPED_BUDGET':
            return {
                label: '💰 BUDGET LIMIT',
                style: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                dot: 'bg-amber-400',
            };
        case 'REJECT':
            return {
                label: '✗ REJECTED',
                style: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
                dot: 'bg-rose-400',
            };
        case 'NO_SETUP':
        default:
            return {
                label: '⏳ LOW SCORE',
                style: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
                dot: 'bg-zinc-400',
            };
    }
}

export default function BotAuditTabs({
    trades = [],
    signals = [],
    events = [],
    mode = 'paper',
    onRefresh,
}) {
    const [activeTab, setActiveTab] = useState('trades');

    // Backtest state
    const [btSymbol, setBtSymbol] = useState('DOGEUSD');
    const [btDays, setBtDays] = useState(7);
    const [btBalance, setBtBalance] = useState('10');
    const [btRunning, setBtRunning] = useState(false);
    const [btResult, setBtResult] = useState(null);
    const [btError, setBtError] = useState('');

    const [expandedSignalId, setExpandedSignalId] = useState(null);
    const [signalFilter, setSignalFilter] = useState('ALL');
    const [signalSearch, setSignalSearch] = useState('');

    // Filter counts
    const tradeCount = signals.filter(s => s.decision === 'TRADE').length;
    const riskCount = signals.filter(s => ['SKIPPED_RISK', 'SKIPPED_COST', 'REJECT'].includes(s.decision)).length;
    const safetyCount = signals.filter(s => ['SKIPPED_OPEN_POSITION', 'SKIPPED_COOLDOWN', 'SKIPPED_BUDGET'].includes(s.decision)).length;
    const lowScoreCount = signals.filter(s => s.decision === 'NO_SETUP').length;

    const filteredSignals = signals.filter(sig => {
        if (signalFilter === 'TRADES' && sig.decision !== 'TRADE') return false;
        if (signalFilter === 'REJECTED' && !['SKIPPED_RISK', 'SKIPPED_COST', 'REJECT'].includes(sig.decision)) return false;
        if (signalFilter === 'SAFETY' && !['SKIPPED_OPEN_POSITION', 'SKIPPED_COOLDOWN', 'SKIPPED_BUDGET'].includes(sig.decision)) return false;
        if (signalFilter === 'LOW_SCORE' && sig.decision !== 'NO_SETUP') return false;

        if (signalSearch.trim()) {
            const q = signalSearch.toLowerCase().trim();
            const sym = (sig.symbol || '').toLowerCase();
            const rsn = (sig.rejectReason || sig.reason || '').toLowerCase();
            const dec = (sig.decision || '').toLowerCase();
            if (!sym.includes(q) && !rsn.includes(q) && !dec.includes(q)) return false;
        }
        return true;
    });

    // Run backtest
    const handleRunBacktest = async (e) => {
        e.preventDefault();
        setBtError('');
        setBtRunning(true);
        try {
            const now = Date.now();
            const fromTs = now - (btDays * 24 * 60 * 60 * 1000);
            const res = await api.post('/bot/backtest', {
                symbol: btSymbol,
                from: new Date(fromTs).toISOString(),
                to: new Date(now).toISOString(),
                startBalance: parseFloat(btBalance) || 10,
                config: {
                    maxLeverage: 20,
                    budgetUSDT: parseFloat(btBalance) || 10,
                },
            });
            setBtResult(res.data);
        } catch (err) {
            setBtError(err.response?.data?.error || err.message || 'Backtest failed');
        } finally {
            setBtRunning(false);
        }
    };

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-2xl p-4 md:p-6 shadow-sm space-y-4">
            {/* Tab Navigation Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-crypto-border">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    {[
                        { key: 'trades',   label: `Trades (${trades.length})`, icon: '📊' },
                        { key: 'signals',  label: `Scan & Decision Logs (${signals.length})`, icon: '📋' },
                        { key: 'events',   label: `Live Events (${events.length})`, icon: '⚡' },
                        { key: 'backtest', label: 'Backtest Sandbox', icon: '🧪' },
                    ].map(tab => (
                        <button
                            type="button"
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                                activeTab === tab.key
                                    ? 'bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/30 shadow-sm'
                                    : 'text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg'
                            }`}
                        >
                            <span>{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={onRefresh}
                    title="Refresh logs"
                    className="self-end sm:self-auto p-2 rounded-xl text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg text-xs font-semibold flex items-center gap-1 transition-colors"
                >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    Refresh
                </button>
            </div>

            {/* TAB 1: TRADES HISTORY */}
            {activeTab === 'trades' && (
                <div className="overflow-x-auto">
                    {trades.length === 0 ? (
                        <div className="py-12 text-center text-crypto-muted">
                            <p className="text-xs">No trade history recorded for {mode} mode yet.</p>
                            <p className="text-[11px] mt-1">Trades will automatically appear here once triggered by the scanner.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-crypto-border/60 text-[10px] font-bold uppercase tracking-wider text-crypto-muted">
                                    <th className="pb-2">Time</th>
                                    <th className="pb-2">Symbol</th>
                                    <th className="pb-2">Side</th>
                                    <th className="pb-2">Entry</th>
                                    <th className="pb-2">Exit</th>
                                    <th className="pb-2">Leverage</th>
                                    <th className="pb-2">Net PnL</th>
                                    <th className="pb-2">Fees</th>
                                    <th className="pb-2">Exit Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-crypto-border/40">
                                {trades.map((t, idx) => {
                                    const isWin = (t.netPnl || 0) >= 0;
                                    const isLong = t.direction === 'long';
                                    const exitBadge = {
                                        take_profit:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                                        stop_loss:    'bg-red-500/10 text-red-400 border-red-500/20',
                                        manual_close: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                                        open:         'bg-amber-500/10 text-amber-400 border-amber-500/20',
                                    }[t.exitReason || t.result] || 'bg-crypto-bg text-crypto-muted border-crypto-border';

                                    return (
                                        <tr key={t._id || idx} className="hover:bg-crypto-bg/40 transition-colors">
                                            <td className="py-3 text-crypto-muted whitespace-nowrap">
                                                {new Date(t.openedAt || t.entryTime || t.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="py-3 font-bold text-crypto-heading whitespace-nowrap">
                                                {t.symbol.replace('USD', '/USD')}
                                            </td>
                                            <td className="py-3 whitespace-nowrap">
                                                <span className={`font-black text-[10px] uppercase px-2 py-0.5 rounded-md border ${
                                                    isLong ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                                }`}>
                                                    {t.direction?.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="py-3 font-medium tabular-nums text-crypto-heading">
                                                ${Number(t.entryPrice).toFixed(4)}
                                            </td>
                                            <td className="py-3 font-medium tabular-nums text-crypto-heading">
                                                {t.exitPrice ? `$${Number(t.exitPrice).toFixed(4)}` : '—'}
                                            </td>
                                            <td className="py-3 text-crypto-muted tabular-nums">
                                                {t.leverage || 20}x
                                            </td>
                                            <td className={`py-3 font-black tabular-nums whitespace-nowrap ${
                                                t.result === 'open' ? 'text-amber-400' : isWin ? 'text-crypto-success' : 'text-crypto-danger'
                                            }`}>
                                                {t.result === 'open' ? (
                                                    'Open'
                                                ) : (
                                                    <div>
                                                        <div>{isWin ? '+' : ''}${(t.netPnl || 0).toFixed(2)}</div>
                                                        <div className="text-[10px] font-bold opacity-80">
                                                            ≈ {isWin ? '+' : '-'}₹{(Math.abs(t.netPnl || 0) * 85).toFixed(2)}
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-3 text-crypto-muted tabular-nums">
                                                ${(t.fees || 0).toFixed(4)}
                                            </td>
                                            <td className="py-3 whitespace-nowrap">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${exitBadge}`}>
                                                    {(t.exitReason || t.result || '').replace('_', ' ')}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* TAB 2: SCAN & DECISION LOGS TABLE (ZERO BLACKBOX) */}
            {activeTab === 'signals' && (
                <div className="space-y-4">
                    {/* Filter Pills & Live Search Bar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-crypto-bg/40 p-3 rounded-xl border border-crypto-border/60">
                        {/* Filter Pills */}
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                            {[
                                { key: 'ALL', label: `All (${signals.length})` },
                                { key: 'TRADES', label: `Trades (${tradeCount})`, color: 'text-emerald-400' },
                                { key: 'REJECTED', label: `Risk Rejected (${riskCount})`, color: 'text-rose-400' },
                                { key: 'SAFETY', label: `Safety Gates (${safetyCount})`, color: 'text-amber-400' },
                                { key: 'LOW_SCORE', label: `Low Score (${lowScoreCount})`, color: 'text-zinc-400' },
                            ].map(f => (
                                <button
                                    type="button"
                                    key={f.key}
                                    onClick={() => setSignalFilter(f.key)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                                        signalFilter === f.key
                                            ? 'bg-crypto-card text-crypto-heading border border-crypto-primary/40 shadow-sm'
                                            : 'text-crypto-muted hover:text-crypto-heading'
                                    }`}
                                >
                                    <span className={f.color}>{f.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Search Input */}
                        <div className="relative w-full sm:w-64">
                            <input
                                type="text"
                                value={signalSearch}
                                onChange={e => setSignalSearch(e.target.value)}
                                placeholder="Filter symbol or reject reason…"
                                className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-crypto-card border border-crypto-border text-crypto-heading text-xs placeholder:text-crypto-muted/60 focus:outline-none focus:border-crypto-primary/50"
                            />
                            <svg className="w-3.5 h-3.5 text-crypto-muted absolute left-2.5 top-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            {signalSearch && (
                                <button
                                    onClick={() => setSignalSearch('')}
                                    className="absolute right-2.5 top-2 text-crypto-muted hover:text-crypto-heading text-xs"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Table View */}
                    {filteredSignals.length === 0 ? (
                        <div className="py-12 text-center text-crypto-muted border border-crypto-border/50 rounded-xl bg-crypto-bg/20">
                            <div className="text-2xl mb-2">🔍</div>
                            <p className="text-xs font-bold text-crypto-heading">No scan cycle logs match current filter.</p>
                            <p className="text-[11px] mt-1 text-crypto-muted">
                                {signals.length === 0
                                    ? 'Evaluated market setups with 8-condition scoring and risk checks will appear here automatically.'
                                    : 'Try selecting "All" or clearing the search query.'}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-crypto-border/60">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-crypto-border/80 bg-crypto-bg-subtle text-[10px] font-bold uppercase tracking-wider text-crypto-muted">
                                        <th className="py-2.5 px-3">Time</th>
                                        <th className="py-2.5 px-3">Symbol / Setup</th>
                                        <th className="py-2.5 px-3 text-center">Decision / Status</th>
                                        <th className="py-2.5 px-3 text-center">Score</th>
                                        <th className="py-2.5 px-3 min-w-[240px]">Why Rejected / Decision Rationale (No Blackbox)</th>
                                        <th className="py-2.5 px-3">Indicators / Regime</th>
                                        <th className="py-2.5 px-3 text-right">Details</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-crypto-border/30">
                                    {filteredSignals.map((sig, idx) => {
                                        const isExpanded = expandedSignalId === (sig._id || idx);
                                        const badge = getDecisionBadge(sig.decision);
                                        const isLong = sig.direction === 'long';
                                        const isShort = sig.direction === 'short';
                                        const score = sig.score || 0;
                                        const maxScore = sig.maxScore || 8;
                                        const whyText = sig.rejectReason || sig.reason || (sig.decision === 'TRADE' ? 'Setup qualified all 8 rules & risk gates — trade placed' : 'Evaluation finished');

                                        return (
                                            <React.Fragment key={sig._id || idx}>
                                                <tr
                                                    onClick={() => setExpandedSignalId(isExpanded ? null : (sig._id || idx))}
                                                    className={`hover:bg-crypto-card-hover/80 transition-colors cursor-pointer ${
                                                        isExpanded ? 'bg-crypto-card/60' : ''
                                                    }`}
                                                >
                                                    {/* Time */}
                                                    <td className="py-3 px-3 text-crypto-muted whitespace-nowrap font-mono text-[11px]">
                                                        {new Date(sig.timestamp || sig.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                    </td>

                                                    {/* Symbol */}
                                                    <td className="py-3 px-3 whitespace-nowrap">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-black text-crypto-heading">
                                                                {sig.symbol ? sig.symbol.replace('USD', '/USD') : '—'}
                                                            </span>
                                                            {sig.direction && (
                                                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${
                                                                    isLong
                                                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                                                }`}>
                                                                    {sig.direction}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {/* Decision */}
                                                    <td className="py-3 px-3 text-center whitespace-nowrap">
                                                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${badge.style}`}>
                                                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                                                            {badge.label}
                                                        </span>
                                                    </td>

                                                    {/* Score */}
                                                    <td className="py-3 px-3 text-center whitespace-nowrap">
                                                        <span className={`inline-flex items-center gap-1 font-mono font-bold text-xs px-2 py-0.5 rounded-md ${
                                                            score >= 5 ? 'bg-emerald-500/15 text-emerald-400' :
                                                            score >= 3 ? 'bg-amber-500/15 text-amber-400' :
                                                            'bg-zinc-500/15 text-zinc-400'
                                                        }`}>
                                                            {score}/{maxScore}
                                                        </span>
                                                    </td>

                                                    {/* Why Rejected / Rationale */}
                                                    <td className="py-3 px-3 text-xs">
                                                        <div className="font-medium text-crypto-heading break-words max-w-md" title={whyText}>
                                                            {whyText}
                                                        </div>
                                                    </td>

                                                    {/* Indicators / Regime */}
                                                    <td className="py-3 px-3 whitespace-nowrap text-[11px] text-crypto-muted">
                                                        <div>
                                                            <span className="font-semibold text-crypto-heading">
                                                                {sig.groqRegime || sig.regime || 'UNCERTAIN'}
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] font-mono mt-0.5">
                                                            RSI: {sig.rsi_5m ? sig.rsi_5m.toFixed(1) : '—'}
                                                            {sig.volumeRatio ? ` · Vol: ${sig.volumeRatio.toFixed(1)}x` : ''}
                                                        </div>
                                                    </td>

                                                    {/* Expand Toggle */}
                                                    <td className="py-3 px-3 text-right whitespace-nowrap">
                                                        <span className="text-crypto-primary font-bold text-[11px] hover:underline">
                                                            {isExpanded ? '▲ Hide' : '▼ Details'}
                                                        </span>
                                                    </td>
                                                </tr>

                                                {/* Expanded Detail Panel */}
                                                {isExpanded && (
                                                    <tr className="bg-crypto-bg/60 border-y border-crypto-border/50">
                                                        <td colSpan="7" className="p-4 space-y-3">
                                                            {/* Rejection / Decision Banner */}
                                                            <div className={`p-3 rounded-xl border flex items-start gap-3 ${
                                                                sig.decision === 'TRADE'
                                                                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                                                                    : sig.decision?.startsWith('SKIPPED') || sig.decision === 'REJECT'
                                                                    ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                                                                    : 'bg-crypto-card border-crypto-border text-crypto-muted'
                                                            }`}>
                                                                <span className="text-lg">
                                                                    {sig.decision === 'TRADE' ? '✅' : 'ℹ️'}
                                                                </span>
                                                                <div className="flex-1">
                                                                    <div className="text-xs font-bold uppercase tracking-wider text-crypto-heading">
                                                                        Zero-Blackbox Decision Breakdown: {badge.label}
                                                                    </div>
                                                                    <p className="text-xs mt-0.5 leading-relaxed font-sans">
                                                                        {whyText}
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            {/* 8-Condition Technical Checklist */}
                                                            {sig.conditions && Object.keys(sig.conditions).length > 0 && (
                                                                <div>
                                                                    <div className="text-[10px] font-bold uppercase tracking-wider text-crypto-muted mb-1.5">
                                                                        8-Condition Technical Rules ({score}/8 Passed)
                                                                    </div>
                                                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                                        {Object.entries(sig.conditions).map(([cond, passed]) => (
                                                                            <div
                                                                                key={cond}
                                                                                className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-1.5 ${
                                                                                    passed
                                                                                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                                                                                        : 'bg-zinc-800/20 border-crypto-border/40 text-crypto-muted'
                                                                                }`}
                                                                            >
                                                                                <span className="font-medium text-[11px] truncate" title={CONDITION_LABELS[cond] || cond}>
                                                                                    {CONDITION_LABELS[cond] || cond.replace(/([A-Z])/g, ' $1')}
                                                                                </span>
                                                                                <span className={`font-black text-[10px] px-1.5 py-0.5 rounded ${
                                                                                    passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700/30 text-zinc-400'
                                                                                }`}>
                                                                                    {passed ? 'PASS' : 'FAIL'}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Telemetry Snapshot Cards */}
                                                            <div>
                                                                <div className="text-[10px] font-bold uppercase tracking-wider text-crypto-muted mb-1.5">
                                                                    Market & Account Context Snapshot
                                                                </div>
                                                                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                                                                    <div className="bg-crypto-card border border-crypto-border/60 rounded-lg p-2">
                                                                        <div className="text-[9px] text-crypto-muted">5m RSI</div>
                                                                        <div className="text-xs font-bold text-crypto-heading font-mono">
                                                                            {sig.rsi_5m != null ? sig.rsi_5m.toFixed(1) : '—'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-crypto-card border border-crypto-border/60 rounded-lg p-2">
                                                                        <div className="text-[9px] text-crypto-muted">1m RSI</div>
                                                                        <div className="text-xs font-bold text-crypto-heading font-mono">
                                                                            {sig.rsi_1m != null ? sig.rsi_1m.toFixed(1) : '—'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-crypto-card border border-crypto-border/60 rounded-lg p-2">
                                                                        <div className="text-[9px] text-crypto-muted">5m ATR</div>
                                                                        <div className="text-xs font-bold text-crypto-heading font-mono">
                                                                            {sig.atr_5m != null ? `$${sig.atr_5m.toFixed(4)}` : '—'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-crypto-card border border-crypto-border/60 rounded-lg p-2">
                                                                        <div className="text-[9px] text-crypto-muted">Volume Ratio</div>
                                                                        <div className="text-xs font-bold text-crypto-heading font-mono">
                                                                            {sig.volumeRatio != null ? `${sig.volumeRatio.toFixed(2)}×` : '—'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-crypto-card border border-crypto-border/60 rounded-lg p-2">
                                                                        <div className="text-[9px] text-crypto-muted">Spread</div>
                                                                        <div className="text-xs font-bold text-crypto-heading font-mono">
                                                                            {sig.spread != null ? `${(sig.spread * 100).toFixed(3)}%` : '—'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-crypto-card border border-crypto-border/60 rounded-lg p-2">
                                                                        <div className="text-[9px] text-crypto-muted">Wallet / Budget</div>
                                                                        <div className="text-xs font-bold text-crypto-heading font-mono">
                                                                            {sig.walletBalance != null ? `$${sig.walletBalance.toFixed(2)}` : '—'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: LIVE EVENT LOG */}
            {activeTab === 'events' && (
                <div className="space-y-1.5 font-mono text-xs max-h-96 overflow-y-auto pr-1">
                    {events.length === 0 ? (
                        <div className="py-12 text-center text-crypto-muted font-sans">
                            <p className="text-xs">No live event logs captured yet.</p>
                        </div>
                    ) : (
                        events.map((ev, idx) => {
                            const levelColor = {
                                error: 'text-red-400 bg-red-500/10 border-red-500/20',
                                warn:  'text-amber-400 bg-amber-500/10 border-amber-500/20',
                                info:  'text-crypto-heading bg-crypto-bg border-crypto-border/40',
                            }[ev.level] || 'text-crypto-muted bg-crypto-bg border-crypto-border/40';

                            return (
                                <div key={ev._id || idx} className={`p-2 rounded-lg border flex items-start gap-2.5 ${levelColor}`}>
                                    <span className="text-[10px] text-crypto-muted opacity-80 whitespace-nowrap pt-0.5">
                                        {new Date(ev.timestamp || ev.createdAt).toLocaleTimeString()}
                                    </span>
                                    <span className="font-bold text-[10px] uppercase px-1.5 py-0.5 rounded bg-crypto-card/60">
                                        {ev.eventType}
                                    </span>
                                    <span className="text-xs flex-1 break-words font-sans">
                                        {ev.message}
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* TAB 4: BACKTEST SANDBOX */}
            {activeTab === 'backtest' && (
                <div className="space-y-5">
                    {/* Controls Form */}
                    <form onSubmit={handleRunBacktest} className="p-4 bg-crypto-bg/50 border border-crypto-border/70 rounded-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-bold text-crypto-heading">Strategy Replay Sandbox</h4>
                                <p className="text-xs text-crypto-muted">
                                    Simulate historical 5m candle replay with realistic fees, 20x margin, and zero lookahead bias.
                                </p>
                            </div>
                        </div>

                        {btError && (
                            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                                {btError}
                            </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {/* Symbol */}
                            <div>
                                <label className="text-[11px] font-bold text-crypto-muted uppercase block mb-1">Coin Symbol</label>
                                <select
                                    value={btSymbol}
                                    onChange={e => setBtSymbol(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-crypto-card border border-crypto-border text-crypto-heading text-xs font-bold"
                                >
                                    <option value="DOGEUSD">DOGE/USD ($0.08 low cost)</option>
                                    <option value="XRPUSD">XRP/USD ($0.50 low cost)</option>
                                    <option value="ADAUSD">ADA/USD ($0.35 low cost)</option>
                                    <option value="BTCUSD">BTC/USD (Flagship)</option>
                                    <option value="ETHUSD">ETH/USD (Large Cap)</option>
                                    <option value="SOLUSD">SOL/USD (High Beta)</option>
                                </select>
                            </div>

                            {/* Replay Period */}
                            <div>
                                <label className="text-[11px] font-bold text-crypto-muted uppercase block mb-1">Time Window</label>
                                <select
                                    value={btDays}
                                    onChange={e => setBtDays(parseInt(e.target.value))}
                                    className="w-full px-3 py-2 rounded-xl bg-crypto-card border border-crypto-border text-crypto-heading text-xs font-bold"
                                >
                                    <option value={1}>Last 24 Hours</option>
                                    <option value={3}>Last 3 Days</option>
                                    <option value={7}>Last 7 Days</option>
                                    <option value={14}>Last 14 Days</option>
                                    <option value={30}>Last 30 Days</option>
                                </select>
                            </div>

                            {/* Initial Budget */}
                            <div>
                                <label className="text-[11px] font-bold text-crypto-muted uppercase block mb-1">Start Capital ($)</label>
                                <input
                                    type="number"
                                    value={btBalance}
                                    onChange={e => setBtBalance(e.target.value)}
                                    placeholder="10"
                                    className="w-full px-3 py-2 rounded-xl bg-crypto-card border border-crypto-border text-crypto-heading text-xs font-bold tabular-nums"
                                />
                            </div>

                            {/* Run Button */}
                            <div className="flex items-end">
                                <button
                                    type="submit"
                                    disabled={btRunning}
                                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-crypto-primary to-crypto-info hover:from-crypto-primary-hover hover:to-crypto-info text-white font-bold text-xs shadow-md shadow-crypto-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                                >
                                    {btRunning ? (
                                        <>
                                            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="12" cy="12" r="9" />
                                                <path d="M12 3a9 9 0 0 1 9 9" />
                                            </svg>
                                            Simulating…
                                        </>
                                    ) : (
                                        <>
                                            <span>▶</span> Run Simulation
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </form>

                    {/* Backtest Results Display */}
                    {btResult && (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            {/* Summary KPIs */}
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                <div className="p-3 bg-crypto-bg rounded-xl border border-crypto-border">
                                    <div className="text-[10px] font-bold text-crypto-muted uppercase">Final Balance</div>
                                    <div className={`text-base font-black tabular-nums mt-0.5 ${
                                        btResult.finalBalance >= btResult.startBalance ? 'text-crypto-success' : 'text-crypto-danger'
                                    }`}>
                                        ${btResult.finalBalance?.toFixed(2)}
                                        <span className="text-xs ml-1">
                                            ({btResult.returnPct >= 0 ? '+' : ''}{btResult.returnPct?.toFixed(1)}%)
                                        </span>
                                    </div>
                                </div>

                                <div className="p-3 bg-crypto-bg rounded-xl border border-crypto-border">
                                    <div className="text-[10px] font-bold text-crypto-muted uppercase">Win Rate</div>
                                    <div className="text-base font-black text-crypto-heading tabular-nums mt-0.5">
                                        {btResult.winRatePct?.toFixed(1)}%
                                        <span className="text-xs text-crypto-muted font-normal ml-1">
                                            ({btResult.wins}W / {btResult.losses}L)
                                        </span>
                                    </div>
                                </div>

                                <div className="p-3 bg-crypto-bg rounded-xl border border-crypto-border">
                                    <div className="text-[10px] font-bold text-crypto-muted uppercase">Profit Factor</div>
                                    <div className="text-base font-black text-crypto-heading tabular-nums mt-0.5">
                                        {btResult.profitFactor?.toFixed(2) || '0.00'}
                                    </div>
                                </div>

                                <div className="p-3 bg-crypto-bg rounded-xl border border-crypto-border">
                                    <div className="text-[10px] font-bold text-crypto-muted uppercase">Max Drawdown</div>
                                    <div className="text-base font-black text-red-400 tabular-nums mt-0.5">
                                        {btResult.maxDrawdownPct?.toFixed(1)}%
                                    </div>
                                </div>

                                <div className="p-3 bg-crypto-bg rounded-xl border border-crypto-border">
                                    <div className="text-[10px] font-bold text-crypto-muted uppercase">5m Candles Replayed</div>
                                    <div className="text-base font-black text-crypto-heading tabular-nums mt-0.5">
                                        {btResult.candlesEvaluated}
                                    </div>
                                </div>
                            </div>

                            {/* Backtest Equity Curve */}
                            <BotEquityChart
                                data={btResult.equityCurve}
                                initialBalance={btResult.startBalance}
                                title={`${btResult.symbol} Backtest Equity Replay`}
                            />

                            {/* Simulated Trades Table */}
                            {btResult.trades?.length > 0 && (
                                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-crypto-border text-[10px] uppercase font-bold text-crypto-muted">
                                                <th className="pb-1.5">Entry Time</th>
                                                <th className="pb-1.5">Side</th>
                                                <th className="pb-1.5">Entry Price</th>
                                                <th className="pb-1.5">Exit Price</th>
                                                <th className="pb-1.5">Contracts</th>
                                                <th className="pb-1.5">Net PnL</th>
                                                <th className="pb-1.5">Result</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-crypto-border/40">
                                            {btResult.trades.map((tr, i) => (
                                                <tr key={i} className="hover:bg-crypto-bg/40">
                                                    <td className="py-2 text-crypto-muted">
                                                        {new Date(tr.entryTime).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="py-2 font-bold uppercase text-[10px]">
                                                        <span className={tr.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'}>
                                                            {tr.direction}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 tabular-nums text-crypto-heading">${tr.entryPrice}</td>
                                                    <td className="py-2 tabular-nums text-crypto-heading">${tr.exitPrice}</td>
                                                    <td className="py-2 tabular-nums text-crypto-muted">{tr.quantity}</td>
                                                    <td className={`py-2 font-bold tabular-nums ${tr.netPnl >= 0 ? 'text-crypto-success' : 'text-crypto-danger'}`}>
                                                        {tr.netPnl >= 0 ? '+' : ''}${tr.netPnl.toFixed(4)}
                                                    </td>
                                                    <td className="py-2">
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                            tr.result === 'win'
                                                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                                : 'bg-red-500/10 text-red-400 border-red-500/20'
                                                        }`}>
                                                            {tr.exitReason?.replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
