import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../services/api';
import TradeConfirmDialog from '../components/trading/TradeConfirmDialog';
import NotificationBell from '../components/common/NotificationBell';

const SOCKET_URL = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : 'http://localhost:3001';

// ─── Signal card color helpers ────────────────────────────────────────────────

function confidenceColor(confidence) {
    if (confidence >= 80) return { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' };
    if (confidence >= 65) return { text: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' };
    return { text: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20' };
}

function actionStyle(action) {
    return action === 'BUY'
        ? { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', glow: '#10b981' }
        : { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', glow: '#ef4444' };
}

function timeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

function fmtPrice(n) {
    if (!n || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n >= 100 ? 2 : 4 });
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SignalCard({ signal, onTrade }) {
    const [expanded, setExpanded] = useState(false);
    const style = actionStyle(signal.action);
    const conf  = confidenceColor(signal.confidence);
    const isBuy = signal.action === 'BUY';

    return (
        <div
            className="bg-crypto-card border border-crypto-border rounded-2xl overflow-hidden hover:border-opacity-60 transition-all duration-300 group"
            style={{ borderColor: expanded ? style.glow + '40' : undefined, boxShadow: expanded ? `0 0 20px ${style.glow}15` : undefined }}
        >
            {/* Top bar */}
            <div className={`h-0.5 w-full ${isBuy ? 'bg-gradient-to-r from-emerald-500/50 to-emerald-400' : 'bg-gradient-to-r from-red-500/50 to-red-400'}`} />

            {/* Main content */}
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    {/* Left: symbol + action */}
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold border ${style.bg} ${style.border}`}>
                            <span className={style.text}>{isBuy ? '▲' : '▼'}</span>
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-crypto-heading">
                                    {signal.symbol.replace('USD', '/USD')}
                                </span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${style.bg} ${style.text} border ${style.border}`}>
                                    {signal.action}
                                </span>
                                <span className="text-xs text-crypto-muted bg-crypto-bg-subtle px-1.5 py-0.5 rounded">
                                    {signal.leverage}×
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-crypto-muted">{signal.timeframe} · {signal.tradeType}</span>
                                {signal.avgVolumeUsdt > 0 && (
                                    <>
                                        <span className="text-xs text-crypto-muted">·</span>
                                        <span className="text-xs text-crypto-muted">Vol: ${signal.avgVolumeUsdt >= 1000 ? `${Math.round(signal.avgVolumeUsdt / 1000)}k` : signal.avgVolumeUsdt.toFixed(0)}</span>
                                    </>
                                )}
                                <span className="text-xs text-crypto-muted">·</span>
                                <span className="text-xs text-crypto-muted">{timeAgo(signal.createdAt)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right: confidence ring */}
                    <div className="text-right flex-shrink-0">
                        <div className={`text-lg font-bold tabular-nums ${conf.text}`}>
                            {signal.confidence}%
                        </div>
                        <div className="text-[10px] text-crypto-muted">confidence</div>
                    </div>
                </div>

                {/* Price levels */}
                <div className="mt-3 grid grid-cols-4 gap-2">
                    {[
                        { label: 'Entry', value: signal.entry, highlight: true },
                        { label: 'Stop', value: signal.stopLoss, bad: true },
                        { label: 'TP1', value: signal.target1, good: true },
                        { label: 'TP2', value: signal.target2, good: true },
                    ].map(({ label, value, highlight, good, bad }) => (
                        <div key={label} className={`rounded-lg p-2 text-center ${
                            highlight ? 'bg-crypto-primary/10 border border-crypto-primary/20' :
                            good ? 'bg-emerald-500/8 border border-emerald-500/15' :
                            bad ? 'bg-red-500/8 border border-red-500/15' :
                            'bg-crypto-bg-subtle border border-crypto-border'
                        }`}>
                            <div className="text-[9px] text-crypto-muted uppercase tracking-wide mb-0.5">{label}</div>
                            <div className={`text-xs font-bold tabular-nums ${
                                highlight ? 'text-crypto-primary' :
                                good ? 'text-emerald-400' :
                                bad ? 'text-red-400' : 'text-crypto-heading'
                            }`}>
                                {fmtPrice(value)}
                            </div>
                        </div>
                    ))}
                </div>

                {/* R/R and tags */}
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    {signal.riskReward && (
                        <span className="text-xs text-crypto-muted bg-crypto-bg-subtle px-2 py-0.5 rounded-md">
                            R/R: 1:{signal.riskReward}
                        </span>
                    )}
                    {signal.tags?.slice(0, 4).map(tag => (
                        <span key={tag} className="text-[10px] text-crypto-primary bg-crypto-primary/8 px-2 py-0.5 rounded-full border border-crypto-primary/15">
                            {tag}
                        </span>
                    ))}
                    <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                        signal.status === 'pending' ? 'text-yellow-400 bg-yellow-400/8 border-yellow-400/20' :
                        signal.status === 'hit_tp1' || signal.status === 'hit_tp2' ? 'text-emerald-400 bg-emerald-400/8 border-emerald-400/20' :
                        signal.status === 'hit_sl' ? 'text-red-400 bg-red-400/8 border-red-400/20' :
                        'text-crypto-muted bg-crypto-bg-subtle border-crypto-border'
                    }`}>
                        {signal.status}
                    </span>
                </div>

                {/* Expand button */}
                <button
                    onClick={() => setExpanded(e => !e)}
                    className="mt-3 w-full text-xs text-crypto-muted hover:text-crypto-heading flex items-center justify-center gap-1 py-1 rounded-lg hover:bg-crypto-bg-subtle transition-colors cursor-pointer"
                >
                    {expanded ? 'Less detail ↑' : 'View reasoning ↓'}
                </button>
            </div>

            {/* Expanded: reasoning + SMC + actions */}
            {expanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-crypto-border/50 pt-3 animate-fade-in">
                    {/* Reasoning */}
                    <div>
                        <div className="text-[10px] text-crypto-muted uppercase tracking-wide mb-1">AI Reasoning</div>
                        <p className="text-xs text-crypto-heading/90 leading-relaxed">{signal.reasoning}</p>
                    </div>

                    {signal.smcContext && (
                        <div>
                            <div className="text-[10px] text-crypto-muted uppercase tracking-wide mb-1">SMC Context</div>
                            <p className="text-xs text-crypto-muted leading-relaxed">{signal.smcContext}</p>
                        </div>
                    )}

                    {signal.invalidationLevel && (
                        <div className="flex items-center gap-2">
                            <div className="text-[10px] text-crypto-muted uppercase tracking-wide">Invalidation:</div>
                            <div className="text-xs font-bold text-orange-400">{fmtPrice(signal.invalidationLevel)}</div>
                        </div>
                    )}

                    {/* Indicators mini row */}
                    {signal.indicatorSnapshot && (
                        <div className="grid grid-cols-4 gap-1.5">
                            {[
                                { label: 'RSI', value: signal.indicatorSnapshot.rsi?.toFixed(1) },
                                { label: 'EMA', value: signal.indicatorSnapshot.emaTrend },
                                { label: 'MACD', value: signal.indicatorSnapshot.macdTrend },
                                { label: 'ADX', value: signal.indicatorSnapshot.adx?.toFixed(1) },
                            ].map(({ label, value }) => (
                                <div key={label} className="bg-crypto-bg-subtle rounded-lg p-1.5 text-center">
                                    <div className="text-[9px] text-crypto-muted mb-0.5">{label}</div>
                                    <div className="text-[10px] font-semibold text-crypto-heading truncate">{value ?? '—'}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* SMC tags */}
                    {signal.smcSnapshot && (
                        <div className="flex gap-1.5 flex-wrap">
                            {signal.smcSnapshot.hasOrderBlocks && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">Order Block</span>}
                            {signal.smcSnapshot.hasFvg && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">FVG</span>}
                            {signal.smcSnapshot.hasLiquiditySweep && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">Liq. Sweep</span>}
                            {signal.smcSnapshot.premiumDiscount && <span className={`text-[9px] px-1.5 py-0.5 rounded border ${signal.smcSnapshot.premiumDiscount === 'discount' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{signal.smcSnapshot.premiumDiscount}</span>}
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={() => onTrade && onTrade(signal)}
                            disabled={signal.status !== 'pending'}
                            className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                signal.status === 'pending'
                                    ? `${style.bg} ${style.text} ${style.border} hover:opacity-80`
                                    : 'bg-crypto-bg-subtle text-crypto-muted border-crypto-border cursor-not-allowed'
                            }`}
                        >
                            {signal.status === 'pending' ? `Execute ${signal.action}` : 'Signal Closed'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main Signals Page ────────────────────────────────────────────────────────

const Signals = () => {
    const navigate = useNavigate();
    const [signals, setSignals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all | BUY | SELL
    const [confFilter, setConfFilter] = useState('all'); // all | 80-90 | 80+
    const [search, setSearch] = useState('');
    const [scanning, setScanning] = useState(false);
    const [tradeSignal, setTradeSignal] = useState(null); // signal being traded
    const [scanResult, setScanResult] = useState(null); // manual scan outcome

    // Load signals from REST
    const loadSignals = useCallback(async () => {
        try {
            const res = await api.get('/signals/latest?limit=50');
            setSignals(res.data.signals || []);
        } catch (err) {
            console.error('Failed to load signals:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleClearClosed = useCallback(async () => {
        if (!window.confirm('Are you sure you want to delete all closed signals?')) return;
        try {
            await api.delete('/signals/closed');
            loadSignals();
        } catch (err) {
            console.error('Failed to clear closed signals:', err);
        }
    }, [loadSignals]);

    useEffect(() => {
        loadSignals();
    }, [loadSignals]);

    // Real-time new signals via Socket.IO
    useEffect(() => {
        const socket = io(SOCKET_URL, { withCredentials: true });

        socket.on('new_signal', (signal) => {
            setSignals(prev => {
                const filtered = prev.filter(s => s._id !== signal._id);
                return [signal, ...filtered].slice(0, 50);
            });
        });

        return () => socket.disconnect();
    }, []);

    // On-demand scan for a specific coin
    const handleAnalyzeNow = async (symbol) => {
        if (!symbol) return;
        setScanning(true);
        setScanResult(null);
        try {
            const res = await api.post(`/signals/analyze/${symbol}`, {
                action: filter,
                confidenceRange: confFilter
            });
            if (res.data) {
                setScanResult({
                    symbol: res.data.signal?.symbol || res.data.saved?.symbol || res.data.mtf?.symbol || symbol,
                    action: res.data.action || res.data.signal?.action || 'NO_TRADE',
                    confidence: res.data.confidence !== undefined ? res.data.confidence : (res.data.signal?.confidence || 0),
                    reasoning: res.data.reasoning || res.data.signal?.reasoning || 'No active trading setup found.',
                    saved: res.data.saved,
                    signal: res.data.signal,
                    avgVolumeUsdt: res.data.avgVolumeUsdt || res.data.signal?.avgVolumeUsdt || res.data.saved?.avgVolumeUsdt || null
                });
                loadSignals();
            }
        } catch (err) {
            console.error('On-demand analysis failed:', err);
            setScanResult({
                symbol,
                action: 'ERROR',
                confidence: 0,
                reasoning: err.response?.data?.error || err.message || 'Failed to complete analysis.'
            });
        } finally {
            setScanning(false);
        }
    };

    // Filtered + searched signals
    const displayed = signals.filter(s => {
        if (filter !== 'all' && s.action !== filter) return false;
        if (search && !s.symbol.toUpperCase().includes(search.toUpperCase())) return false;
        if (confFilter !== 'all') {
            if (confFilter === '80+') {
                if (s.confidence < 80) return false;
            } else if (confFilter.includes('-')) {
                const [low, high] = confFilter.split('-').map(Number);
                if (s.confidence < low || s.confidence > high) return false;
            }
        }
        return true;
    });

    const buyCount  = signals.filter(s => s.action === 'BUY').length;
    const sellCount = signals.filter(s => s.action === 'SELL').length;
    const avgConf   = signals.length
        ? (signals.reduce((a, s) => a + s.confidence, 0) / signals.length).toFixed(1)
        : '—';

    return (
        <div className="min-h-screen bg-crypto-bg">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-crypto-card/90 backdrop-blur-lg border-b border-crypto-border">
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate('/')}
                            className="p-2 rounded-lg hover:bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading transition-colors cursor-pointer"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base font-bold text-crypto-heading">AI Signals</h1>
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
                                <span className="text-xs text-emerald-400">Live</span>
                            </div>
                            <p className="text-xs text-crypto-muted">Gemini AI · 195 coins · On-Demand Scan</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <div className="flex items-center gap-1 mr-1">
                            {['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD'].map(sym => (
                                <button
                                    key={sym}
                                    onClick={() => handleAnalyzeNow(sym)}
                                    disabled={scanning}
                                    className="px-2 py-1 rounded bg-crypto-bg-subtle border border-crypto-border text-[10px] font-bold text-crypto-muted hover:text-crypto-primary hover:border-crypto-primary/30 transition-all cursor-pointer disabled:opacity-50"
                                >
                                    {sym.replace('USD', '')}
                                </button>
                            ))}
                        </div>
                        <input
                            type="text"
                            placeholder="Filter coin…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-crypto-input border border-crypto-border text-crypto-heading placeholder-crypto-muted focus:outline-none focus:ring-1 focus:ring-crypto-primary/30 focus:border-crypto-primary transition-all w-24 sm:w-32"
                        />
                        <button
                            onClick={() => handleAnalyzeNow(search || 'RANDOM')}
                            disabled={scanning}
                            className="px-3 py-1.5 bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20 rounded-lg text-xs font-semibold hover:bg-crypto-primary/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                        >
                            {scanning ? (
                                <>
                                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Scanning…
                                </>
                            ) : '⚡ Scan'}
                        </button>
                        <NotificationBell />
                    </div>
                </div>

                {/* Stats bar */}
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 pb-2 flex items-center gap-6">
                    <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-emerald-400 font-semibold">{buyCount} BUY</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-2 h-2 rounded-full bg-red-400" />
                        <span className="text-red-400 font-semibold">{sellCount} SELL</span>
                    </div>
                    <div className="text-xs text-crypto-muted">
                        Avg confidence: <span className="text-crypto-heading font-semibold">{avgConf}%</span>
                    </div>

                    <button
                        onClick={handleClearClosed}
                        className="px-2.5 py-1 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-all cursor-pointer flex items-center gap-1"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Clear Closed
                    </button>

                    <div className="ml-auto flex gap-3 items-center">
                        {/* Action Filter */}
                        <div className="flex gap-1">
                            {['all', 'BUY', 'SELL'].map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                                        filter === f
                                            ? f === 'BUY' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                            : f === 'SELL' ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                            : 'bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20'
                                            : 'text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle'
                                    }`}
                                >
                                    {f === 'all' ? 'All' : f}
                                </button>
                            ))}
                        </div>

                        <div className="h-4 w-px bg-crypto-border hidden sm:block" />

                        {/* Confidence Filter */}
                        <div className="flex gap-1 flex-wrap justify-end">
                            {[
                                { key: 'all', label: 'All' },
                                { key: '50-60', label: '50-60%' },
                                { key: '60-70', label: '60-70%' },
                                { key: '70-80', label: '70-80%' },
                                { key: '80-90', label: '80-90%' },
                                { key: '90-100', label: '90-100%' }
                            ].map(c => (
                                <button
                                    key={c.key}
                                    onClick={() => setConfFilter(c.key)}
                                    className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-[10px] sm:text-xs font-medium transition-all cursor-pointer ${
                                        confFilter === c.key
                                            ? 'bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20'
                                            : 'text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle border border-transparent'
                                    }`}
                                >
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-4">
                {scanResult && (
                    <div className={`mb-6 p-5 rounded-2xl border backdrop-blur-lg animate-fade-in relative ${
                        scanResult.action === 'NO_TRADE'
                            ? 'bg-yellow-500/5 border-yellow-500/20'
                            : scanResult.action === 'ERROR'
                            ? 'bg-red-500/5 border-red-500/20'
                            : scanResult.action === 'BUY'
                            ? 'bg-emerald-500/5 border-emerald-500/20'
                            : 'bg-red-500/5 border-red-500/20'
                    }`}>
                        <button
                            onClick={() => setScanResult(null)}
                            className="absolute top-4 right-4 text-crypto-muted hover:text-crypto-heading cursor-pointer text-lg"
                        >
                            &times;
                        </button>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-crypto-primary bg-crypto-primary/10 px-2 py-0.5 rounded">
                                Live AI Scan Result
                            </span>
                            <span className="text-xs text-crypto-muted">•</span>
                            <span className="text-xs font-semibold text-crypto-heading text-opacity-90">
                                {scanResult.symbol.replace('USD', '/USD')}
                            </span>
                            {scanResult.avgVolumeUsdt > 0 && (
                                <>
                                    <span className="text-xs text-crypto-muted">•</span>
                                    <span className="text-xs text-crypto-muted">
                                        5m Avg Vol: ${Number(scanResult.avgVolumeUsdt.toFixed(0)).toLocaleString()} USDT
                                    </span>
                                </>
                            )}
                        </div>
                        <h4 className="text-sm font-bold text-crypto-heading mb-1.5 flex items-center gap-2">
                            {scanResult.action === 'NO_TRADE' ? (
                                <>
                                    <span className="text-yellow-400">⬜ No Trade Setup</span>
                                    <span className="text-xs font-normal text-crypto-muted">(Confidence: {scanResult.confidence}%)</span>
                                </>
                            ) : scanResult.action === 'ERROR' ? (
                                <span className="text-red-400">❌ Scan Error</span>
                            ) : (
                                <>
                                    <span className={scanResult.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                                        {scanResult.action === 'BUY' ? '▲ BUY Signal Generated' : '▼ SELL Signal Generated'}
                                    </span>
                                    <span className="text-xs font-normal text-crypto-muted">(Confidence: {scanResult.confidence}%)</span>
                                </>
                            )}
                        </h4>
                        <p className="text-xs text-crypto-muted leading-relaxed max-w-3xl">
                            {scanResult.reasoning}
                        </p>
                        {scanResult.action !== 'NO_TRADE' && scanResult.action !== 'ERROR' && (
                            <button
                                onClick={() => {
                                    setTradeSignal(scanResult.saved || scanResult.signal);
                                    setScanResult(null);
                                }}
                                className="mt-3 px-3 py-1.5 bg-crypto-primary text-white rounded-lg text-xs font-semibold hover:bg-crypto-primary/90 transition-colors cursor-pointer"
                            >
                                Execute Trade Now
                            </button>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="bg-crypto-card border border-crypto-border rounded-2xl h-40 animate-pulse" />
                        ))}
                    </div>
                ) : displayed.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-crypto-primary/10 flex items-center justify-center mb-4">
                            <svg className="w-7 h-7 text-crypto-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                            </svg>
                        </div>
                        <h3 className="text-base font-semibold text-crypto-heading mb-1">No signals yet</h3>
                        <p className="text-sm text-crypto-muted max-w-xs">
                            The AI signal engine is in on-demand mode. Enter a coin above and click Analyze Now to scan.
                        </p>
                        <div className="flex gap-2 justify-center flex-wrap mt-4">
                            <button
                                onClick={() => handleAnalyzeNow('RANDOM')}
                                className="px-4 py-2 bg-crypto-primary text-white rounded-lg text-sm font-semibold hover:bg-crypto-primary/90 transition-all cursor-pointer flex items-center gap-1.5"
                            >
                                🎲 Random Cheap
                            </button>
                            <button
                                onClick={() => handleAnalyzeNow('BTCUSD')}
                                className="px-4 py-2 bg-crypto-bg-subtle border border-crypto-border text-crypto-heading rounded-lg text-sm font-semibold hover:bg-crypto-card-hover transition-colors cursor-pointer"
                            >
                                ⚡ BTC
                            </button>
                            <button
                                onClick={() => handleAnalyzeNow('ETHUSD')}
                                className="px-4 py-2 bg-crypto-bg-subtle border border-crypto-border text-crypto-heading rounded-lg text-sm font-semibold hover:bg-crypto-card-hover transition-colors cursor-pointer"
                            >
                                ⚡ ETH
                            </button>
                            <button
                                onClick={() => handleAnalyzeNow('SOLUSD')}
                                className="px-4 py-2 bg-crypto-bg-subtle border border-crypto-border text-crypto-heading rounded-lg text-sm font-semibold hover:bg-crypto-card-hover transition-colors cursor-pointer"
                            >
                                ⚡ SOL
                            </button>
                            <button
                                onClick={() => handleAnalyzeNow('XRPUSD')}
                                className="px-4 py-2 bg-crypto-bg-subtle border border-crypto-border text-crypto-heading rounded-lg text-sm font-semibold hover:bg-crypto-card-hover transition-colors cursor-pointer"
                            >
                                ⚡ XRP
                            </button>
                            <button
                                onClick={() => handleAnalyzeNow('DOGEUSD')}
                                className="px-4 py-2 bg-crypto-bg-subtle border border-crypto-border text-crypto-heading rounded-lg text-sm font-semibold hover:bg-crypto-card-hover transition-colors cursor-pointer"
                            >
                                ⚡ DOGE
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {displayed.map(signal => (
                            <SignalCard
                                key={signal._id}
                                signal={signal}
                                onTrade={(s) => setTradeSignal(s)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Trade Dialog — pre-filled from signal */}
            <TradeConfirmDialog
                open={!!tradeSignal}
                signal={tradeSignal}
                onClose={() => setTradeSignal(null)}
                onSuccess={() => {
                    setTradeSignal(null);
                    navigate('/positions');
                }}
            />
        </div>
    );
};

export default Signals;
