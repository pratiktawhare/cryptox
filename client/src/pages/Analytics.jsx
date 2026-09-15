/**
 * Analytics.jsx — Phase 9
 *
 * Full analytics dashboard with:
 *   - Live equity curve (SVG line chart)
 *   - Win/loss donut chart
 *   - AI signal accuracy breakdown
 *   - Self-learning insights panel
 *   - Best & worst trades
 *   - Per-symbol performance heatmap
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useTradingMode } from '../context/TradingModeContext';
import NotificationBell from '../components/common/NotificationBell';
import MobileBottomNav from '../components/layout/MobileBottomNav';

// ─── Daily Report Card ────────────────────────────────────────────────────────

function DailyReportCard({ report }) {
    const [open, setOpen] = useState(false);
    const profitable = report.totalPnl >= 0;
    const pnlSign    = profitable ? '+' : '';

    return (
        <div
            className={`bg-crypto-card border rounded-xl overflow-hidden transition-all duration-200 cursor-pointer hover:shadow-lg ${
                profitable ? 'border-emerald-500/30' : 'border-red-500/30'
            }`}
            onClick={() => setOpen(o => !o)}
        >
            {/* Top colour bar */}
            <div className={`h-0.5 w-full ${profitable ? 'bg-gradient-to-r from-emerald-500/50 to-emerald-400' : 'bg-gradient-to-r from-red-500/50 to-red-400'}`} />

            <div className="p-3 md:p-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <div className="text-xs font-bold text-crypto-heading">{report.date}</div>
                        <div className="text-[10px] text-crypto-muted mt-0.5">
                            {report.totalTrades} trades · {report.totalCycles} cycles
                        </div>
                    </div>
                    <div className="text-right">
                        <div className={`text-sm font-bold tabular-nums ${profitable ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pnlSign}${report.totalPnl?.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-crypto-muted">
                            {report.winRate?.toFixed(0)}% win · ${report.totalMarginUsed?.toFixed(0)} deployed
                        </div>
                    </div>
                </div>

                {/* Quick stats row */}
                <div className="grid grid-cols-4 gap-1.5 mt-2.5">
                    {[
                        { label: 'Trades',  value: report.totalTrades },
                        { label: 'Wins',    value: report.wins, color: 'text-emerald-400' },
                        { label: 'Losses',  value: report.losses, color: 'text-red-400' },
                        { label: 'Avg Conf', value: `${report.avgConfidence?.toFixed(0)}%` },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="bg-crypto-bg-subtle rounded-lg p-1.5 text-center">
                            <div className="text-[9px] text-crypto-muted mb-0.5">{label}</div>
                            <div className={`text-[11px] font-bold ${color || 'text-crypto-heading'}`}>{value}</div>
                        </div>
                    ))}
                </div>

                {/* Expanded detail */}
                {open && (
                    <div className="mt-3 pt-3 border-t border-crypto-border/40 space-y-2 animate-fade-in">
                        {report.bestTrade?.symbol && (
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-crypto-muted">🏆 Best</span>
                                <span className="text-emerald-400 font-semibold">
                                    {report.bestTrade.symbol?.replace('USD','/USD')} +${report.bestTrade.pnl?.toFixed(2)}
                                </span>
                            </div>
                        )}
                        {report.worstTrade?.symbol && (
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-crypto-muted">📉 Worst</span>
                                <span className="text-red-400 font-semibold">
                                    {report.worstTrade.symbol?.replace('USD','/USD')} ${report.worstTrade.pnl?.toFixed(2)}
                                </span>
                            </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-crypto-muted">Avg Leverage</span>
                            <span className="text-crypto-heading font-semibold">{report.avgLeverage?.toFixed(1)}×</span>
                        </div>
                        {report.skipped > 0 && (
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-crypto-muted">Skipped (low balance)</span>
                                <span className="text-amber-400 font-semibold">{report.skipped}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Mini SVG Equity Curve ────────────────────────────────────────────────────

function EquityCurve({ points = [], width = 600, height = 180 }) {
    if (points.length < 2) {
        return (
            <div className="flex items-center justify-center h-44 text-crypto-muted text-sm">
                Not enough trades yet to draw equity curve
            </div>
        );
    }

    const values = points.map(p => p.equity);
    const minV   = Math.min(...values);
    const maxV   = Math.max(...values);
    const range  = maxV - minV || 1;

    const toX = (i) => (i / (points.length - 1)) * width;
    const toY = (v) => height - ((v - minV) / range) * (height - 20) - 10;

    const pathD = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.equity).toFixed(1)}`)
        .join(' ');

    // Fill area under curve
    const fillD = `${pathD} L ${toX(points.length - 1).toFixed(1)} ${height} L ${toX(0).toFixed(1)} ${height} Z`;

    const isPositive = values[values.length - 1] >= values[0];
    const color      = isPositive ? '#10b981' : '#ef4444';

    // Last point
    const lastX = toX(points.length - 1);
    const lastY = toY(values[values.length - 1]);

    return (
        <div className="w-full overflow-hidden">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
                <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                {/* Fill */}
                <path d={fillD} fill="url(#equityGrad)" />
                {/* Line */}
                <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {/* Live dot */}
                <circle cx={lastX} cy={lastY} r="4" fill={color} />
                <circle cx={lastX} cy={lastY} r="8" fill={color} fillOpacity="0.2" />
            </svg>
        </div>
    );
}

// ─── Win/Loss Donut ───────────────────────────────────────────────────────────

function WinLossDonut({ wins, losses, timeouts = 0 }) {
    const total = wins + losses + timeouts;
    if (total === 0) return (
        <div className="flex items-center justify-center h-32 text-crypto-muted text-xs">No signals yet</div>
    );

    const winPct     = (wins     / total) * 100;
    const lossPct    = (losses   / total) * 100;
    const timeoutPct = (timeouts / total) * 100;

    const r  = 40;
    const cx = 50;
    const cy = 50;
    const circ = 2 * Math.PI * r;

    function arc(start, pct, color) {
        const len    = (pct / 100) * circ;
        const offset = circ - (start / 100) * circ;
        return (
            <circle
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={color}
                strokeWidth="12"
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
        );
    }

    return (
        <div className="flex items-center gap-6">
            <svg viewBox="0 0 100 100" className="w-28 h-28 -rotate-90 shrink-0">
                {arc(0,                   winPct,  '#10b981')}
                {arc(winPct,              lossPct, '#ef4444')}
                {arc(winPct + lossPct,    timeoutPct, '#6b7280')}
            </svg>
            <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-crypto-muted">Win</span>
                    <span className="ml-auto font-bold text-emerald-400">{winPct.toFixed(0)}%</span>
                    <span className="text-crypto-muted">({wins})</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="text-crypto-muted">Loss</span>
                    <span className="ml-auto font-bold text-red-400">{lossPct.toFixed(0)}%</span>
                    <span className="text-crypto-muted">({losses})</span>
                </div>
                {timeouts > 0 && (
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-gray-500" />
                        <span className="text-crypto-muted">Timeout</span>
                        <span className="ml-auto font-bold text-crypto-muted">{timeoutPct.toFixed(0)}%</span>
                        <span className="text-crypto-muted">({timeouts})</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-crypto-heading', icon }) {
    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl p-3 md:p-4 hover:border-crypto-primary/20 transition-colors">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] md:text-[11px] font-medium text-crypto-muted uppercase tracking-wider">{label}</span>
                {icon && <span className="text-sm md:text-base">{icon}</span>}
            </div>
            <p className={`text-base md:text-xl font-bold tabular-nums ${color}`}>{value ?? '—'}</p>
            {sub && <p className="text-[10px] md:text-[11px] text-crypto-muted mt-0.5">{sub}</p>}
        </div>
    );
}

// ─── Main Analytics Page ──────────────────────────────────────────────────────

export default function Analytics() {
    const navigate = useNavigate();
    const { mode, isPaper } = useTradingMode();

    const [performance,     setPerformance]     = useState(null);
    const [equity,          setEquity]          = useState([]);
    const [signalStats,     setSignalStats]     = useState(null);
    const [learning,        setLearning]        = useState(null);
    const [bestWorst,       setBestWorst]       = useState(null);
    const [loading,         setLoading]         = useState(true);
    const [activeTab,       setActiveTab]       = useState('overview');
    const [dailyReports,    setDailyReports]    = useState([]);
    const [dailyReportMode, setDailyReportMode] = useState('paper');
    const [autoLogs,        setAutoLogs]        = useState([]);
    const [autoLogMode,     setAutoLogMode]     = useState('paper');
    const [autoLogLoading,  setAutoLogLoading]  = useState(false);

    const fetchAll = useCallback(async () => {
        try {
            const [perfRes, eqRes, sigRes, learnRes, bwRes, drRes, logsRes] = await Promise.all([
                api.get('/analytics/performance'),
                api.get(`/analytics/equity-curve?mode=${isPaper ? 'paper' : 'live'}&limit=150`),
                api.get('/analytics/signals?limit=100'),
                api.get('/analytics/learning'),
                api.get(`/analytics/best-worst?mode=${isPaper ? 'paper' : 'live'}`),
                api.get(`/automation/daily-reports?mode=${dailyReportMode}&limit=30`).catch(() => ({ data: { reports: [] } })),
                api.get(`/automation/logs?mode=${autoLogMode}&limit=100`).catch(() => ({ data: { logs: [] } })),
            ]);
            setPerformance(perfRes.data);
            setEquity(eqRes.data.points || []);
            setSignalStats(sigRes.data);
            setLearning(learnRes.data);
            setBestWorst(bwRes.data);
            setDailyReports(drRes.data.reports || []);
            setAutoLogs(logsRes.data.logs || []);
        } catch (err) {
            console.error('[Analytics] fetch error:', err.message);
        } finally {
            setLoading(false);
        }
    }, [isPaper, dailyReportMode, autoLogMode]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Re-fetch daily reports when mode tab switches
    useEffect(() => {
        api.get(`/automation/daily-reports?mode=${dailyReportMode}&limit=30`)
            .then(r => setDailyReports(r.data.reports || []))
            .catch(() => {});
    }, [dailyReportMode]);

    // Re-fetch automation logs when mode switches
    useEffect(() => {
        setAutoLogLoading(true);
        api.get(`/automation/logs?mode=${autoLogMode}&limit=100`)
            .then(r => setAutoLogs(r.data.logs || []))
            .catch(() => {})
            .finally(() => setAutoLogLoading(false));
    }, [autoLogMode]);

    const perf   = performance;
    const wallet = perf?.paper;
    const signals = perf?.signals;

    const TABS = [
        { key: 'overview',   label: '📊 Overview' },
        { key: 'signals',    label: '🤖 AI Signals' },
        { key: 'learning',   label: '🧠 Self-Learning' },
        { key: 'trades',     label: '🏆 Best / Worst' },
        { key: 'automation', label: '⚡ Automation Logs' },
    ];

    return (
        <div className="min-h-screen bg-crypto-bg text-crypto-text">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-crypto-card/90 backdrop-blur-md border-b border-crypto-border">
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate('/')}
                            className="p-1.5 rounded-lg text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle transition-all cursor-pointer"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                            </svg>
                        </button>
                        <div>
                            <h1 className="text-sm font-bold text-crypto-heading">Analytics</h1>
                            <p className="text-[10px] text-crypto-muted hidden sm:block">Risk, performance & AI self-learning</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isPaper ? 'text-crypto-primary bg-crypto-primary/10 border-crypto-primary/20' : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'}`}>
                            {isPaper ? '📄 PAPER' : '⚡ LIVE'}
                        </span>
                        <button
                            onClick={fetchAll}
                            className="p-1.5 rounded-lg text-crypto-muted hover:text-crypto-primary hover:bg-crypto-primary/10 transition-all cursor-pointer"
                            title="Refresh"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                        <NotificationBell />
                    </div>
                </div>

                {/* Tabs */}
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 flex gap-1 pb-2 overflow-x-auto no-scrollbar">
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                activeTab === tab.key
                                    ? 'bg-crypto-primary/15 text-crypto-primary'
                                    : 'text-crypto-muted hover:text-crypto-heading'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </header>

            <main className="max-w-[1440px] mx-auto px-4 md:px-6 py-3 md:py-6 pb-24 md:pb-6 space-y-4 md:space-y-6">
                {loading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="bg-crypto-card border border-crypto-border rounded-xl h-24 animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <>
                        {/* ── OVERVIEW TAB ── */}
                        {activeTab === 'overview' && (
                            <div className="space-y-3 md:space-y-6 animate-fade-in">
                                {/* Top KPIs */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                                    <StatCard label="Paper Equity"    value={`$${(wallet?.equity ?? 0).toFixed(2)}`}   sub={`Started $${(wallet?.startingBalance ?? 10000).toFixed(0)}`} color={wallet?.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} icon="📄" />
                                    <StatCard label="Paper Return"    value={`${wallet?.returnPct >= 0 ? '+' : ''}${(wallet?.returnPct ?? 0).toFixed(2)}%`} sub={`PnL: $${(wallet?.totalPnl ?? 0).toFixed(2)}`} color={(wallet?.returnPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} icon="📈" />
                                    <StatCard label="Win Rate"        value={`${wallet?.winRate ?? 0}%`}               sub={`${wallet?.totalTrades ?? 0} paper trades`}                color="text-crypto-heading" icon="🎯" />
                                    <StatCard label="Max Drawdown"    value={`-${(wallet?.maxDrawdown ?? 0).toFixed(1)}%`} sub={`Peak: $${(wallet?.peakEquity ?? 10000).toFixed(2)}`} color="text-amber-400" icon="📉" />
                                </div>

                                {/* Signal KPIs */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                                    <StatCard label="AI Signals"      value={signals?.total ?? 0}                      sub="Total generated"                                          color="text-crypto-heading" icon="🤖" />
                                    <StatCard label="Signal Win Rate" value={signals?.winRate ? `${signals.winRate}%` : '—'} sub={`${signals?.wins ?? 0} wins`}                     color="text-crypto-primary" icon="⚡" />
                                    <StatCard label="Avg R/R"         value={signals?.avgRR ? `1:${signals.avgRR}` : '—'}   sub="Achieved R/R ratio"                               color="text-crypto-heading" icon="⚖️" />
                                    <StatCard label="Available Margin" value={`$${(wallet?.available ?? 0).toFixed(2)}`}  sub={`Used: $${(10000 - (wallet?.available ?? 10000)).toFixed(2)}`} color="text-emerald-400" icon="✅" />
                                </div>

                                {/* Equity Curve */}
                                <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                    <div className="px-4 py-3 md:px-5 md:py-4 border-b border-crypto-border flex items-center justify-between">
                                        <div>
                                            <h2 className="text-sm font-bold text-crypto-heading">Equity Curve</h2>
                                            <p className="text-xs text-crypto-muted mt-0.5">{isPaper ? 'Paper' : 'Live'} account equity over time</p>
                                        </div>
                                        {equity.length > 0 && (
                                            <span className={`text-xs font-bold ${equity[equity.length - 1]?.equity >= (equity[0]?.equity ?? 0) ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {equity.length} data points
                                            </span>
                                        )}
                                    </div>
                                    <div className="p-3 md:p-5">
                                        <EquityCurve points={equity} width={800} height={200} />
                                    </div>
                                </div>

                                {/* Win/Loss + Summary */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
                                    <div className="bg-crypto-card border border-crypto-border rounded-xl p-4 md:p-5">
                                        <h3 className="text-sm font-bold text-crypto-heading mb-3 md:mb-4">Signal Outcomes</h3>
                                        <WinLossDonut
                                            wins={signals?.wins ?? 0}
                                            losses={(signals?.total ?? 0) - (signals?.wins ?? 0)}
                                            timeouts={0}
                                        />
                                    </div>
                                    <div className="bg-crypto-card border border-crypto-border rounded-xl p-4 md:p-5">
                                        <h3 className="text-sm font-bold text-crypto-heading mb-3 md:mb-4">Trade Performance</h3>
                                        <WinLossDonut
                                            wins={wallet?.totalWins ?? 0}
                                            losses={wallet?.totalLosses ?? 0}
                                            timeouts={0}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── AI SIGNALS TAB ── */}
                        {activeTab === 'signals' && (
                            <div className="space-y-4 md:space-y-6 animate-fade-in">
                                <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                    <div className="px-5 py-4 border-b border-crypto-border">
                                        <h2 className="text-sm font-bold text-crypto-heading">Signal Accuracy by Symbol</h2>
                                        <p className="text-xs text-crypto-muted mt-0.5">Based on {signalStats?.corrections?.length ?? 0} tracked signals</p>
                                    </div>
                                    {signalStats?.bySymbol?.length > 0 ? (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="text-xs text-crypto-muted uppercase tracking-wider border-b border-crypto-border">
                                                        <th className="text-left px-5 py-3 font-medium">Symbol</th>
                                                        <th className="text-right px-5 py-3 font-medium">Signals</th>
                                                        <th className="text-right px-5 py-3 font-medium">Win Rate</th>
                                                        <th className="text-right px-5 py-3 font-medium">Avg PnL%</th>
                                                        <th className="text-right px-5 py-3 font-medium">Avg R/R</th>
                                                        <th className="text-right px-5 py-3 font-medium">W/L/T</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-crypto-border/40">
                                                    {signalStats.bySymbol.map(row => (
                                                        <tr key={row.symbol} className="hover:bg-crypto-card-hover transition-colors">
                                                            <td className="px-5 py-3 font-semibold text-crypto-heading">{row.symbol}</td>
                                                            <td className="px-5 py-3 text-right tabular-nums text-crypto-muted">{row.total}</td>
                                                            <td className="px-5 py-3 text-right">
                                                                <span className={`font-bold ${parseFloat(row.winRate) >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                    {row.winRate}%
                                                                </span>
                                                            </td>
                                                            <td className={`px-5 py-3 text-right font-semibold tabular-nums ${parseFloat(row.avgPnlPct) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {row.avgPnlPct != null ? `${row.avgPnlPct > 0 ? '+' : ''}${row.avgPnlPct}%` : '—'}
                                                            </td>
                                                            <td className="px-5 py-3 text-right tabular-nums text-crypto-heading">
                                                                {row.avgRR ? `1:${row.avgRR}` : '—'}
                                                            </td>
                                                            <td className="px-5 py-3 text-right text-xs text-crypto-muted">
                                                                <span className="text-emerald-400">{row.wins}</span>
                                                                <span className="mx-1">/</span>
                                                                <span className="text-red-400">{row.losses}</span>
                                                                <span className="mx-1">/</span>
                                                                <span>{row.timeouts}</span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="p-10 text-center text-crypto-muted text-sm">
                                            No signal outcomes tracked yet. Outcomes are recorded when SL/TP is hit or signal expires after 24h.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── SELF-LEARNING TAB ── */}
                        {activeTab === 'learning' && (
                            <div className="space-y-4 md:space-y-6 animate-fade-in">
                                {/* Global Context */}
                                {learning?.global ? (
                                    <div className="bg-crypto-card border border-crypto-primary/20 rounded-xl p-5"
                                         style={{ boxShadow: '0 0 30px #6366f110' }}>
                                        <div className="flex items-center gap-2 mb-4">
                                            <span className="text-xl">🤖</span>
                                            <h2 className="text-sm font-bold text-crypto-heading">Global AI Learning Context</h2>
                                            <span className="text-xs text-crypto-muted ml-auto">{learning.global.totalSignals} signals analysed</span>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                                            <StatCard label="Global Win Rate" value={learning.global.globalWinRate} color="text-crypto-heading" icon="🎯" />
                                            <StatCard label="Avg R/R" value={`1:${learning.global.avgRRachieved}`} color="text-crypto-primary" icon="⚖️" />
                                            <StatCard label="Total Wins" value={learning.global.wins} color="text-emerald-400" icon="✅" />
                                            <StatCard label="Total Losses" value={learning.global.losses} color="text-red-400" icon="❌" />
                                        </div>
                                        <div className="mt-4 space-y-2">
                                            <div className="rounded-lg bg-crypto-bg-subtle border border-crypto-border p-3 text-xs">
                                                <span className="text-crypto-muted">Top performers: </span>
                                                <span className="text-emerald-400 font-mono">{learning.global.topPerformers || '—'}</span>
                                            </div>
                                            <div className="rounded-lg bg-crypto-bg-subtle border border-crypto-border p-3 text-xs">
                                                <span className="text-crypto-muted">Underperformers: </span>
                                                <span className="text-red-400 font-mono">{learning.global.underPerformers || '—'}</span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-crypto-card border border-crypto-border rounded-xl p-10 text-center">
                                        <div className="text-4xl mb-3">🤖</div>
                                        <h3 className="text-sm font-semibold text-crypto-heading mb-1">Learning in progress…</h3>
                                        <p className="text-xs text-crypto-muted">Self-learning data builds as AI signals hit SL/TP targets. Check back after a few signal cycles.</p>
                                    </div>
                                )}

                                {/* Top & Under performers */}
                                {learning?.topPerformers?.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
                                        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                            <div className="px-5 py-3 border-b border-crypto-border flex items-center gap-2">
                                                <span>✅</span>
                                                <h3 className="text-sm font-bold text-crypto-heading">Top Performers</h3>
                                            </div>
                                            <div className="divide-y divide-crypto-border/40">
                                                {learning.topPerformers.map((s, i) => (
                                                    <div key={s.symbol} className="flex items-center px-5 py-2.5 hover:bg-crypto-card-hover text-sm">
                                                        <span className="text-crypto-muted w-5">{i + 1}.</span>
                                                        <span className="font-semibold text-crypto-heading">{s.symbol}</span>
                                                        <span className="ml-auto font-bold text-emerald-400">{s.winRate}%</span>
                                                        <span className="text-crypto-muted text-xs ml-2">({s.total} signals)</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                            <div className="px-5 py-3 border-b border-crypto-border flex items-center gap-2">
                                                <span>⚠️</span>
                                                <h3 className="text-sm font-bold text-crypto-heading">Underperformers</h3>
                                            </div>
                                            <div className="divide-y divide-crypto-border/40">
                                                {learning.underPerformers.map((s, i) => (
                                                    <div key={s.symbol} className="flex items-center px-5 py-2.5 hover:bg-crypto-card-hover text-sm">
                                                        <span className="text-crypto-muted w-5">{i + 1}.</span>
                                                        <span className="font-semibold text-crypto-heading">{s.symbol}</span>
                                                        <span className="ml-auto font-bold text-red-400">{s.winRate}%</span>
                                                        <span className="text-crypto-muted text-xs ml-2">({s.total} signals)</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Recent outcomes */}
                                {learning?.recentOutcomes?.length > 0 && (
                                    <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                        <div className="px-5 py-3 border-b border-crypto-border">
                                            <h3 className="text-sm font-bold text-crypto-heading">Recent Signal Outcomes</h3>
                                        </div>
                                        <div className="divide-y divide-crypto-border/40">
                                            {learning.recentOutcomes.map((o, i) => (
                                                <div key={i} className="flex items-center px-5 py-2.5 text-sm hover:bg-crypto-card-hover">
                                                    <span className="mr-2 text-base">
                                                        {o.outcome === 'win' ? '✅' : o.outcome === 'loss' ? '❌' : '⏱️'}
                                                    </span>
                                                    <span className="font-semibold text-crypto-heading">{o.symbol}</span>
                                                    <span className={`ml-3 font-bold tabular-nums ${parseFloat(o.pnl) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {o.pnl != null ? `${parseFloat(o.pnl) > 0 ? '+' : ''}${o.pnl}%` : '—'}
                                                    </span>
                                                    <span className="ml-auto text-crypto-muted text-xs">{o.hours ? `${o.hours}h` : '—'}</span>
                                                    <span className="ml-3 text-crypto-muted text-xs">R/R: {o.rr ?? '—'}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── BEST / WORST TAB ── */}
                        {activeTab === 'trades' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 animate-fade-in">
                                {['best', 'worst'].map(type => {
                                    const trades = bestWorst?.[type] ?? [];
                                    const isGood = type === 'best';
                                    return (
                                        <div key={type} className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                            <div className="px-5 py-3 border-b border-crypto-border flex items-center gap-2">
                                                <span>{isGood ? '🏆' : '💀'}</span>
                                                <h3 className="text-sm font-bold text-crypto-heading">{isGood ? 'Best Trades' : 'Worst Trades'}</h3>
                                                <span className="text-xs text-crypto-muted ml-auto">{isPaper ? 'Paper' : 'Live'}</span>
                                            </div>
                                            {trades.length > 0 ? (
                                                <div className="divide-y divide-crypto-border/40">
                                                    {trades.map((t, i) => {
                                                        const pnl = t.realisedPnl ?? t.realisedPnl ?? 0;
                                                        return (
                                                            <div key={t._id || i} className="flex items-center px-5 py-3 hover:bg-crypto-card-hover text-sm">
                                                                <span className="text-crypto-muted w-5 text-xs">{i + 1}.</span>
                                                                <div>
                                                                    <span className="font-semibold text-crypto-heading">{t.symbol || t.product_symbol}</span>
                                                                    <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${t.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                                                        {t.side?.toUpperCase() || '—'}
                                                                    </span>
                                                                </div>
                                                                <span className={`ml-auto font-bold tabular-nums text-base ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="p-8 text-center text-crypto-muted text-xs">No closed trades yet</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {/* ── AUTOMATION LOGS TAB ── */}
                        {activeTab === 'automation' && (
                            <div className="space-y-4 md:space-y-6 animate-fade-in">

                                {/* Mode switcher */}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-crypto-muted font-medium">Mode:</span>
                                    {['paper','live'].map(m => (
                                        <button
                                            key={m}
                                            onClick={() => setAutoLogMode(m)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                                autoLogMode === m
                                                    ? m === 'live'
                                                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                        : 'bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20'
                                                    : 'text-crypto-muted hover:text-crypto-heading border border-transparent'
                                            }`}
                                        >
                                            {m === 'live' ? '💰' : '📄'} {m.charAt(0).toUpperCase() + m.slice(1)}
                                        </button>
                                    ))}
                                    <span className="ml-auto text-[10px] text-crypto-muted">{autoLogs.length} entries</span>
                                </div>

                                {/* Cycle logs table */}
                                <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                    <div className="px-5 py-3 border-b border-crypto-border flex items-center justify-between">
                                        <div>
                                            <h2 className="text-sm font-bold text-crypto-heading">AI Cycle Logs</h2>
                                            <p className="text-[10px] text-crypto-muted mt-0.5">Every automation cycle — trades placed, skipped, or errors</p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                setAutoLogLoading(true);
                                                api.get(`/automation/logs?mode=${autoLogMode}&limit=100`)
                                                    .then(r => setAutoLogs(r.data.logs || []))
                                                    .catch(() => {})
                                                    .finally(() => setAutoLogLoading(false));
                                            }}
                                            className="p-1.5 rounded-lg text-crypto-muted hover:text-crypto-primary hover:bg-crypto-primary/10 transition-all cursor-pointer"
                                            title="Refresh logs"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                        </button>
                                    </div>

                                    {autoLogLoading ? (
                                        <div className="p-6 space-y-2">
                                            {[...Array(5)].map((_,i) => <div key={i} className="h-8 bg-crypto-border/30 rounded animate-pulse" />)}
                                        </div>
                                    ) : autoLogs.length === 0 ? (
                                        <div className="p-10 text-center">
                                            <div className="text-3xl mb-2">⚡</div>
                                            <p className="text-sm text-crypto-muted">No automation cycles recorded yet</p>
                                            <p className="text-xs text-crypto-muted mt-1">Start automation in Settings → AI Trade Automation</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="text-[10px] text-crypto-muted uppercase tracking-wider border-b border-crypto-border bg-crypto-bg-subtle">
                                                        <th className="text-left px-4 py-2.5 font-medium">Time</th>
                                                        <th className="text-left px-4 py-2.5 font-medium">Symbol</th>
                                                        <th className="text-center px-4 py-2.5 font-medium">Action</th>
                                                        <th className="text-right px-4 py-2.5 font-medium">Conf</th>
                                                        <th className="text-right px-4 py-2.5 font-medium">Lev</th>
                                                        <th className="text-right px-4 py-2.5 font-medium">Margin</th>
                                                        <th className="text-left px-4 py-2.5 font-medium">Status</th>
                                                        <th className="text-left px-4 py-2.5 font-medium min-w-[160px]">Notes</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-crypto-border/30">
                                                    {autoLogs.map((log, i) => {
                                                        const isReversed = log.notes?.includes('[REVERSED]');
                                                        const actionColor =
                                                            log.cycleAction === 'NO_TRADE'       ? 'text-crypto-muted bg-crypto-border/20' :
                                                            log.cycleAction === 'SKIPPED_BALANCE' ? 'text-amber-400 bg-amber-500/10' :
                                                            log.cycleAction === 'ERROR'           ? 'text-red-400 bg-red-500/10' :
                                                            log.cycleAction === 'BUY'             ? 'text-emerald-400 bg-emerald-500/10' :
                                                            log.cycleAction === 'SELL'            ? 'text-red-400 bg-red-500/10' :
                                                                                                    'text-crypto-muted bg-crypto-border/10';
                                                        const outcomeColor =
                                                            log.outcome === 'open'    ? 'text-crypto-primary' :
                                                            log.outcome === 'win'     ? 'text-emerald-400' :
                                                            log.outcome === 'loss'    ? 'text-red-400' :
                                                            log.outcome === 'pending' ? 'text-amber-400' : 'text-crypto-muted';

                                                        return (
                                                            <tr key={log._id || i} className="hover:bg-crypto-card-hover transition-colors">
                                                                <td className="px-4 py-2.5 text-crypto-muted whitespace-nowrap">
                                                                    {new Date(log.createdAt).toLocaleString('en-IN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                                                                </td>
                                                                <td className="px-4 py-2.5 font-semibold text-crypto-heading">
                                                                    {log.symbol ? log.symbol.replace('USD', '/USD') : '—'}
                                                                </td>
                                                                <td className="px-4 py-2.5 text-center">
                                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${actionColor}`}>
                                                                        {isReversed && <span title="Reverse Mode">🔄</span>}
                                                                        {log.cycleAction || '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2.5 text-right tabular-nums text-crypto-heading">
                                                                    {log.confidence ? `${log.confidence}%` : '—'}
                                                                </td>
                                                                <td className="px-4 py-2.5 text-right tabular-nums text-crypto-muted">
                                                                    {log.leverage ? `${log.leverage}×` : '—'}
                                                                </td>
                                                                <td className="px-4 py-2.5 text-right tabular-nums text-crypto-heading">
                                                                    {log.marginUsed ? `$${log.marginUsed.toFixed(2)}` : '—'}
                                                                </td>
                                                                <td className="px-4 py-2.5">
                                                                    <span className={`font-semibold text-[10px] ${outcomeColor}`}>
                                                                        {log.outcome || '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2.5 text-crypto-muted max-w-[200px] truncate" title={log.notes}>
                                                                    {log.notes || '—'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                {/* Daily Reports inside the Automation tab */}
                                <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                                    <div className="px-5 py-3 border-b border-crypto-border flex items-center justify-between">
                                        <div>
                                            <h2 className="text-sm font-bold text-crypto-heading">📋 Daily AI Reports</h2>
                                            <p className="text-[10px] text-crypto-muted mt-0.5">Automation performance summaries — generated at end of each day</p>
                                        </div>
                                        <div className="flex gap-1">
                                            {['paper','live'].map(m => (
                                                <button
                                                    key={m}
                                                    onClick={() => setDailyReportMode(m)}
                                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
                                                        dailyReportMode === m
                                                            ? m === 'live'
                                                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                                : 'bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20'
                                                            : 'text-crypto-muted hover:text-crypto-heading'
                                                    }`}
                                                >
                                                    {m === 'live' ? '💰' : '📄'} {m.charAt(0).toUpperCase() + m.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="p-4">
                                        {dailyReports.length === 0 ? (
                                            <div className="py-8 text-center">
                                                <div className="text-2xl mb-2">📊</div>
                                                <p className="text-sm text-crypto-muted">No daily reports yet</p>
                                                <p className="text-xs text-crypto-muted mt-1">Reports appear after the first full day of automation</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                                {dailyReports.map(r => (
                                                    <DailyReportCard key={`${r.date}-${r.mode}`} report={r} />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>

            <MobileBottomNav />
        </div>
    );
}
