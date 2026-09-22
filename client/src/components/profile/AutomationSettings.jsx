import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import TradeConfirmDialog from '../trading/TradeConfirmDialog';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function NumberField({ label, hint, value, min, max, step = 1, unit = '', onChange }) {
    const [raw, setRaw] = useState(String(value ?? ''));

    useEffect(() => { setRaw(String(value ?? '')); }, [value]);

    const commit = () => {
        const n = parseFloat(raw);
        if (isNaN(n)) { setRaw(String(value ?? '')); return; }
        const clamped = max != null ? Math.min(max, Math.max(min ?? 0, n)) : Math.max(min ?? 0, n);
        setRaw(String(clamped));
        onChange(clamped);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-crypto-heading font-medium">{label}</label>
                {unit && <span className="text-[10px] text-crypto-muted">{unit}</span>}
            </div>
            <input
                type="number"
                min={min} max={max} step={step}
                value={raw}
                onChange={e => setRaw(e.target.value)}
                onBlur={commit}
                onKeyDown={e => e.key === 'Enter' && commit()}
                className="w-full text-xs px-3 py-2 rounded-lg bg-crypto-input border border-crypto-border text-crypto-heading focus:outline-none focus:ring-1 focus:ring-crypto-primary/30 focus:border-crypto-primary transition-all tabular-nums"
            />
            {hint && <p className="text-[10px] text-crypto-muted mt-0.5">{hint}</p>}
        </div>
    );
}

function Toggle({ label, hint, checked, onChange }) {
    return (
        <label className="flex items-center justify-between cursor-pointer select-none gap-3">
            <div>
                <div className="text-xs text-crypto-heading font-medium">{label}</div>
                {hint && <div className="text-[10px] text-crypto-muted">{hint}</div>}
            </div>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${checked ? 'bg-crypto-primary' : 'bg-crypto-border'}`}
            >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
        </label>
    );
}

// ─── Mode Panel ───────────────────────────────────────────────────────────────

function ModePanel({
    mode,
    status,
    config,
    onSave,
    onToggle,
    onToggleReverse,
    toggling = false,
    reverseToggling = false,
    onAnalyzeNow,
    analyzing = false
}) {
    const isLive       = mode === 'live';
    const isRunning    = status?.running;
    const isReversed   = !!config?.reverseMode;

    const [cfg, setCfg]   = useState(config || {});
    const [saving, setSaving] = useState(false);
    const [msg, setMsg]   = useState('');
    const [liveWallet, setLiveWallet] = useState(null);
    const [walletLoading, setWalletLoading] = useState(false);

    useEffect(() => { setCfg(config || {}); }, [config]);

    // Auto-fetch live wallet when on live tab
    useEffect(() => {
        if (isLive) fetchLiveWallet();
    }, [isLive]);

    const fetchLiveWallet = async () => {
        setWalletLoading(true);
        try {
            const res = await api.get('/analytics/live-wallet');
            setLiveWallet(res.data);
        } catch {
            setLiveWallet(null);
        } finally {
            setWalletLoading(false);
        }
    };

    const update = (key, val) => setCfg(prev => ({ ...prev, [key]: val }));

    const handleSave = async () => {
        setSaving(true);
        setMsg('');
        try {
            await onSave(mode, cfg);
            setMsg('✓ Saved');
        } catch {
            setMsg('⚠ Save failed');
        } finally {
            setSaving(false);
            setTimeout(() => setMsg(''), 3000);
        }
    };

    const marginPerTrade = ((cfg.estimatedWalletUSD || 1000) * (cfg.tradePct || 20) / 100).toFixed(2);
    const minThresholdAmt = ((cfg.estimatedWalletUSD || 1000) * ((cfg.minBalancePct ?? 5) / 100)).toFixed(2);

    return (
        <div className={`space-y-4 ${isLive ? 'border border-amber-500/20 rounded-xl p-4 bg-amber-500/3' : ''}`}>
            {/* Live warning */}
            {isLive && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
                    <span className="text-amber-400 text-sm flex-shrink-0">⚠️</span>
                    <p className="text-[11px] text-amber-300 leading-relaxed">
                        <strong>Real Money Mode.</strong> Automation will place actual orders on Delta Exchange using your live API keys. Double-check all settings before starting.
                    </p>
                </div>
            )}

            {/* Live wallet snapshot */}
            {isLive && (
                <div className="bg-crypto-bg-subtle border border-crypto-border/40 rounded-xl px-3 py-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-crypto-heading">💰 Delta Exchange Wallet</span>
                        <button
                            onClick={fetchLiveWallet}
                            disabled={walletLoading}
                            className="text-[10px] text-crypto-primary hover:text-crypto-primary/80 disabled:opacity-50 cursor-pointer"
                        >
                            {walletLoading ? '⏳ Refreshing…' : '↻ Refresh'}
                        </button>
                    </div>
                    {liveWallet?.wallet ? (
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { label: 'Balance', val: liveWallet.wallet.balance, prefix: '$' },
                                { label: 'Available', val: liveWallet.wallet.available, prefix: '$' },
                                { label: 'In Positions', val: liveWallet.wallet.blocked, prefix: '$' },
                                { label: 'Unrealised PnL', val: liveWallet.wallet.unrealised, prefix: '$', color: liveWallet.wallet.unrealised >= 0 ? 'text-emerald-400' : 'text-red-400' },
                            ].map(({ label, val, prefix, color }) => (
                                <div key={label} className="bg-crypto-bg rounded-lg px-2.5 py-2">
                                    <div className="text-[9px] text-crypto-muted">{label}</div>
                                    <div className={`text-xs font-bold tabular-nums ${color || 'text-crypto-heading'}`}>
                                        {val != null ? `${prefix}${parseFloat(val).toFixed(4)}` : '—'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-crypto-muted">
                            {walletLoading ? 'Fetching from Delta Exchange…' : 'No API key found or unable to connect.'}
                        </p>
                    )}
                    {liveWallet?.openPositions?.length > 0 && (
                        <div className="mt-2 space-y-1">
                            <div className="text-[10px] font-semibold text-crypto-heading">Open Positions ({liveWallet.openPositions.length})</div>
                            {liveWallet.openPositions.map((p, i) => (
                                <div key={i} className="flex items-center justify-between text-[10px] px-2 py-1 bg-crypto-bg rounded-lg">
                                    <span className="text-crypto-heading font-medium">{p.symbol}</span>
                                    <span className={`font-semibold px-1.5 py-0.5 rounded text-[9px] ${p.side === 'buy' ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>{p.side.toUpperCase()}</span>
                                    <span className="text-crypto-muted">{p.size} × {p.leverage}×</span>
                                    <span className={p.unrealisedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                        {p.unrealisedPnl >= 0 ? '+' : ''}${p.unrealisedPnl.toFixed(3)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Reverse Mode active banner */}
            {isReversed && isRunning && (
                <div className="flex items-start gap-2 bg-orange-500/15 border border-orange-500/30 rounded-lg px-3 py-2.5 animate-pulse-slow">
                    <span className="text-orange-400 text-sm flex-shrink-0">🔄</span>
                    <p className="text-[11px] text-orange-300 leading-relaxed">
                        <strong>Reverse Engineering Mode is ON.</strong> AI BUY signals → executed as SELL, AI SELL signals → executed as BUY. SL and TP are swapped.
                    </p>
                </div>
            )}

            {/* Start/Stop button row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                    <div className="text-sm font-bold text-crypto-heading">
                        {isLive ? '💰 Live' : '📄 Paper'} Automation
                    </div>
                    <div className={`text-[10px] mt-0.5 font-semibold flex items-center gap-1 ${isRunning ? (isReversed ? 'text-orange-400' : 'text-emerald-400') : 'text-crypto-muted'}`}>
                        {isRunning
                            ? <><span className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse ${isReversed ? 'bg-orange-400' : 'bg-emerald-400'}`} />{isReversed ? 'Running (Reversed)' : 'Running'}</>
                            : <><span className="inline-block w-1.5 h-1.5 rounded-full bg-crypto-border" /> Stopped</>
                        }
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                        type="button"
                        onClick={() => onAnalyzeNow && onAnalyzeNow(mode)}
                        disabled={analyzing}
                        className="px-3 py-2 rounded-xl text-xs font-bold border border-crypto-primary/30 bg-crypto-primary/10 text-crypto-primary hover:bg-crypto-primary/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                        title={`Run on-demand AI market scan for ${isLive ? 'Live' : 'Paper'} mode`}
                    >
                        {analyzing ? (
                            <>
                                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span>Scanning…</span>
                            </>
                        ) : (
                            <>
                                <span>⚡</span>
                                <span>Analyze Now</span>
                            </>
                        )}
                    </button>

                    <button
                        onClick={() => onToggle(mode, !isRunning)}
                        disabled={toggling || reverseToggling}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            isRunning
                                ? 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                                : isLive
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                        }`}
                    >
                        {toggling
                            ? (isRunning ? '⏳ Stopping…' : '⏳ Starting…')
                            : (isRunning && !isReversed ? '⏹ Stop' : '▶ Start Normal')
                        }
                    </button>

                    <button
                        onClick={() => onToggleReverse(mode, !isRunning || !isReversed)}
                        disabled={toggling || reverseToggling}
                        title="Reverse Engineering Mode: AI BUY → executed SELL, AI SELL → executed BUY"
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            isRunning && isReversed
                                ? 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                                : 'bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20'
                        }`}
                    >
                        {reverseToggling ? '⏳…' : isRunning && isReversed ? '⏹ Stop Reverse' : '🔄 Start Reversed'}
                    </button>
                </div>
            </div>

            {/* Reverse Engineering Mode toggle card */}
            <div className={`rounded-xl border px-3 py-3 space-y-2 transition-all ${
                isReversed
                    ? 'bg-orange-500/10 border-orange-500/30'
                    : 'bg-crypto-bg-subtle border-crypto-border/40'
            }`}>
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs font-bold text-crypto-heading flex items-center gap-1.5">
                            🔄 Reverse Engineering Mode
                            {isReversed && <span className="text-[10px] font-semibold text-orange-400 bg-orange-500/15 border border-orange-500/30 px-1.5 py-0.5 rounded-full">ACTIVE</span>}
                        </div>
                        <div className="text-[10px] text-crypto-muted mt-0.5 leading-relaxed">
                            When active: AI predicts BUY → system executes SELL, and vice-versa.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            update('reverseMode', !cfg.reverseMode);
                            onSave(mode, { ...cfg, reverseMode: !cfg.reverseMode }).catch(() => {});
                        }}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-3 ${cfg.reverseMode ? 'bg-orange-500' : 'bg-crypto-border'}`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${cfg.reverseMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>

            <div className="border-t border-crypto-border/30 pt-4 space-y-4">

                {/* Interval */}
                <NumberField
                    label="Scan Interval (minutes)"
                    hint={`AI scans every ${cfg.intervalMinutes || 30} minutes for a new trade`}
                    value={cfg.intervalMinutes || 30}
                    min={1} step={1} unit="min"
                    onChange={v => update('intervalMinutes', v)}
                />

                {/* Estimated wallet */}
                <NumberField
                    label="Estimated Wallet Size"
                    hint={`Margin per trade: ~$${marginPerTrade} (${cfg.tradePct || 20}% of wallet)`}
                    value={cfg.estimatedWalletUSD || 1000}
                    min={0} step={1} unit="USD"
                    onChange={v => update('estimatedWalletUSD', v)}
                />

                {/* Trade % */}
                <NumberField
                    label="Trade Size (% of wallet)"
                    hint={`~$${marginPerTrade} margin per trade at ${cfg.leverage || cfg.maxLeverage || 20}× leverage`}
                    value={cfg.tradePct || 20}
                    min={0} max={100} step={1} unit="%"
                    onChange={v => update('tradePct', v)}
                />

                {/* Min confidence */}
                <NumberField
                    label="Minimum Confidence"
                    hint={`Only execute trades where AI confidence ≥ ${cfg.minConfidence || 70}%`}
                    value={cfg.minConfidence || 70}
                    min={0} max={100} step={1} unit="%"
                    onChange={v => update('minConfidence', v)}
                />

                {/* Leverage range */}
                <div className="grid grid-cols-2 gap-3">
                    <NumberField
                        label="Min Leverage"
                        value={cfg.minLeverage || 10}
                        min={1} step={1} unit="×"
                        onChange={v => update('minLeverage', v)}
                    />
                    <NumberField
                        label="Max Leverage"
                        value={cfg.maxLeverage || 20}
                        min={1} step={1} unit="×"
                        onChange={v => update('maxLeverage', v)}
                    />
                </div>
                <p className="text-[10px] text-crypto-muted -mt-2">AI picks leverage within this range based on setup quality</p>

                {/* Min balance threshold */}
                <NumberField
                    label="Min Balance Threshold"
                    hint={`Automation pauses if balance < $${minThresholdAmt} (${cfg.minBalancePct ?? 5}% of estimated wallet)`}
                    value={cfg.minBalancePct ?? 5}
                    min={0} max={100} step={1} unit="%"
                    onChange={v => update('minBalancePct', v)}
                />

                {/* Trail SL */}
                <Toggle
                    label="Trail Stop Loss"
                    hint="Move SL to breakeven at 1R profit, lock +0.5R at 2R profit"
                    checked={cfg.trailStopLoss ?? true}
                    onChange={v => update('trailStopLoss', v)}
                />

                {/* Daily report */}
                <Toggle
                    label="Daily Performance Report"
                    hint="Send in-app notification with day's trading summary"
                    checked={cfg.dailyReportEnabled ?? true}
                    onChange={v => update('dailyReportEnabled', v)}
                />

                {cfg.dailyReportEnabled && (
                    <div>
                        <label className="text-xs text-crypto-heading font-medium block mb-1">Report Time (IST)</label>
                        <input
                            type="time"
                            value={cfg.dailyReportTime || '23:59'}
                            onChange={e => update('dailyReportTime', e.target.value)}
                            className="text-xs px-3 py-2 rounded-lg bg-crypto-input border border-crypto-border text-crypto-heading focus:outline-none focus:ring-1 focus:ring-crypto-primary/30 focus:border-crypto-primary transition-all"
                        />
                        <p className="text-[10px] text-crypto-muted mt-0.5">Report fires within 30 minutes of this time (IST)</p>
                    </div>
                )}

                {/* Summary box */}
                <div className="bg-crypto-bg-subtle rounded-lg px-3 py-2.5 text-[10px] text-crypto-muted space-y-0.5">
                    <div className="font-semibold text-crypto-heading text-[11px] mb-1">Summary</div>
                    <div>⏱ Scans every <strong className="text-crypto-heading">{cfg.intervalMinutes || 30}m</strong></div>
                    <div>💵 Margin per trade: <strong className="text-crypto-heading">${marginPerTrade}</strong> ({cfg.tradePct || 20}% of ${cfg.estimatedWalletUSD || 1000})</div>
                    <div>🎯 Min confidence: <strong className="text-crypto-heading">{cfg.minConfidence || 70}%</strong></div>
                    <div>⚡ Leverage: AI picks <strong className="text-crypto-heading">{cfg.minLeverage || 10}–{cfg.maxLeverage || 20}×</strong></div>
                    <div>⛔ Pauses if balance &lt; <strong className="text-crypto-heading">${minThresholdAmt}</strong> ({cfg.minBalancePct ?? 5}%)</div>
                    {cfg.reverseMode && <div className="text-orange-400 font-semibold">🔄 Reverse Engineering Mode: ON</div>}
                </div>

                {/* Save */}
                <div className="flex items-center justify-between pt-1">
                    {msg && (
                        <span className={`text-[11px] font-semibold ${msg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
                            {msg}
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="ml-auto px-4 py-2 bg-crypto-primary text-white rounded-lg text-xs font-bold hover:bg-crypto-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {saving ? 'Saving…' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const AutomationSettings = () => {
    const navigate = useNavigate();
    const [tab, setTab]               = useState('paper');
    const [status, setStatus]         = useState({ paper: { running: false, config: {} }, live: { running: false, config: {} } });
    const [loading, setLoading]       = useState(true);
    const [toggling, setToggling]     = useState(false);
    const [reverseToggling, setRevToggling] = useState(false);
    const [toggleMsg, setToggleMsg]   = useState('');

    // On-demand Analysis State
    const [analyzing, setAnalyzing]         = useState(false);
    const [analyzeSymbol, setAnalyzeSymbol] = useState('');
    const [scanResult, setScanResult]       = useState(null);
    const [tradeSignal, setTradeSignal]     = useState(null);
    const [scanError, setScanError]         = useState('');

    const loadStatus = useCallback(async () => {
        try {
            const res = await api.get('/automation/status');
            setStatus(res.data);
        } catch (err) {
            console.error('Failed to load automation status', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    const handleSave = async (mode, cfg) => {
        await api.patch('/automation/settings', { mode, settings: cfg });
        await loadStatus();
    };

    const handleToggle = async (mode, start) => {
        setToggling(true);
        setToggleMsg(start ? '⏳ Starting…' : '⏳ Stopping…');
        try {
            if (start) {
                // /reverse with enable=false for reverseMode means: start with reverseMode=false (normal)
                // Reuse the atomic endpoint: stop → set reverseMode=false → start
                await api.post('/automation/reverse', { mode, enable: false });  // stop + clear flag
                await api.post('/automation/start', { mode });                   // start fresh (normal)
                setStatus(prev => ({ ...prev, [mode]: { ...prev[mode], running: true, config: { ...prev[mode]?.config, reverseMode: false } } }));
                setToggleMsg('✓ Automation started (normal mode)');
            } else {
                await api.post('/automation/stop', { mode });
                setStatus(prev => ({ ...prev, [mode]: { ...prev[mode], running: false } }));
                setToggleMsg('✓ Automation stopped');
            }
            loadStatus().catch(() => {});
        } catch (err) {
            const detail = err?.response?.data?.error || err.message || 'Unknown error';
            setToggleMsg(`⚠ ${detail}`);
            console.error('Toggle failed', detail);
        } finally {
            setToggling(false);
            setTimeout(() => setToggleMsg(''), 5000);
        }
    };

    const handleToggleReverse = async (mode, start) => {
        setRevToggling(true);
        setToggleMsg(start ? '⏳ Starting in Reverse Mode…' : '⏳ Stopping…');
        try {
            // Single atomic endpoint: stops engine → saves reverseMode → restarts
            await api.post('/automation/reverse', { mode, enable: start });

            if (start) {
                setStatus(prev => ({ ...prev, [mode]: { ...prev[mode], running: true, config: { ...prev[mode]?.config, reverseMode: true } } }));
                setToggleMsg('✓ Reverse Engineering Mode started 🔄');
            } else {
                setStatus(prev => ({ ...prev, [mode]: { ...prev[mode], running: false, config: { ...prev[mode]?.config, reverseMode: false } } }));
                setToggleMsg('✓ Automation stopped');
            }
            loadStatus().catch(() => {});
        } catch (err) {
            const detail = err?.response?.data?.error || err.message || 'Unknown error';
            setToggleMsg(`⚠ ${detail}`);
            console.error('Reverse toggle failed', detail);
        } finally {
            setRevToggling(false);
            setTimeout(() => setToggleMsg(''), 5000);
        }
    };

    const handleAnalyzeNow = async (specificSymbol) => {
        const symbolToScan = (typeof specificSymbol === 'string' && specificSymbol.length > 0 && specificSymbol !== 'live' && specificSymbol !== 'paper')
            ? specificSymbol
            : (analyzeSymbol.trim() || 'RANDOM');

        setAnalyzing(true);
        setScanError('');
        setScanResult(null);

        try {
            const res = await api.post(`/signals/analyze/${symbolToScan}`, {
                action: 'all',
                confidenceRange: 'all',
                mode: tab
            });
            if (res.data) {
                setScanResult({
                    symbol: res.data.signal?.symbol || res.data.saved?.symbol || res.data.mtf?.symbol || symbolToScan,
                    action: res.data.action || res.data.signal?.action || 'NO_TRADE',
                    confidence: res.data.confidence !== undefined ? res.data.confidence : (res.data.signal?.confidence || 0),
                    reasoning: res.data.reasoning || res.data.signal?.reasoning || 'No active trading setup found.',
                    signal: res.data.signal,
                    saved: res.data.saved,
                    reversedSignal: res.data.reversedSignal,
                    isReversed: !!res.data.isReversed,
                    avgVolumeUsdt: res.data.avgVolumeUsdt || res.data.signal?.avgVolumeUsdt || res.data.saved?.avgVolumeUsdt || null,
                    time: new Date().toLocaleTimeString()
                });
            }
        } catch (err) {
            console.error('Analyze now failed:', err);
            const detail = err.response?.data?.error || err.message || 'Failed to complete market analysis.';
            setScanError(detail);
            setScanResult({
                symbol: symbolToScan,
                action: 'ERROR',
                confidence: 0,
                reasoning: detail
            });
        } finally {
            setAnalyzing(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-crypto-card border border-crypto-border rounded-xl p-8 animate-pulse">
                <div className="h-4 bg-crypto-border rounded w-1/3 mb-4" />
                <div className="h-10 bg-crypto-border rounded mb-3" />
                <div className="h-10 bg-crypto-border rounded" />
            </div>
        );
    }

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden animate-fade-in">
            {/* Header with Analyze Now Action Bar */}
            <div className="px-5 py-4 border-b border-crypto-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-crypto-heading">AI Trade Automation</h3>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20">
                            v2.1 Scalp Engine
                        </span>
                    </div>
                    <p className="text-xs text-crypto-muted mt-0.5">
                        Scheduled auto-trading & on-demand market analysis with micro-targets & wide stop loss
                    </p>
                </div>

                {/* Quick Analyze Bar */}
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Auto (Cheap coins)"
                            value={analyzeSymbol}
                            onChange={e => setAnalyzeSymbol(e.target.value.toUpperCase())}
                            onKeyDown={e => e.key === 'Enter' && handleAnalyzeNow()}
                            className="text-xs px-2.5 py-1.5 rounded-lg bg-crypto-input border border-crypto-border text-crypto-heading placeholder-crypto-muted/50 focus:outline-none focus:ring-1 focus:ring-crypto-primary/40 focus:border-crypto-primary transition-all w-36"
                        />
                        {analyzeSymbol && (
                            <button
                                type="button"
                                onClick={() => setAnalyzeSymbol('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-crypto-muted hover:text-crypto-heading text-xs cursor-pointer"
                            >
                                &times;
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={() => handleAnalyzeNow()}
                        disabled={analyzing}
                        className="px-3.5 py-1.5 bg-gradient-to-r from-crypto-primary to-indigo-600 hover:from-crypto-primary/90 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow-md shadow-crypto-primary/20 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                        title="Run immediate market scan using current settings"
                    >
                        {analyzing ? (
                            <>
                                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span>Scanning…</span>
                            </>
                        ) : (
                            <>
                                <span className="text-sm">⚡</span>
                                <span>Analyze Now</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Tab switcher */}
            <div className="flex border-b border-crypto-border">
                {['paper', 'live'].map(m => (
                    <button
                        key={m}
                        onClick={() => setTab(m)}
                        className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                            tab === m
                                ? m === 'live'
                                    ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/5'
                                    : 'text-crypto-primary border-b-2 border-crypto-primary bg-crypto-primary/5'
                                : 'text-crypto-muted hover:text-crypto-heading'
                        }`}
                    >
                        {m === 'live' ? '💰' : '📄'} {m.charAt(0).toUpperCase() + m.slice(1)} Trading
                        {status[m]?.running && (
                            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${status[m]?.config?.reverseMode ? 'bg-orange-400' : 'bg-emerald-400'}`} />
                        )}
                    </button>
                ))}
            </div>

            {/* Live AI Scan Loading Indicator */}
            {analyzing && (
                <div className="mx-5 mt-4 p-4 rounded-xl border border-crypto-primary/30 bg-crypto-primary/5 flex items-center gap-3 animate-pulse">
                    <div className="w-8 h-8 rounded-lg bg-crypto-primary/20 flex items-center justify-center text-crypto-primary flex-shrink-0">
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <div className="text-xs font-bold text-crypto-heading flex items-center gap-2">
                            <span>🤖 AI Market Scan in Progress…</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-crypto-primary/20 text-crypto-primary font-semibold">
                                {tab.toUpperCase()} Mode
                            </span>
                        </div>
                        <p className="text-[11px] text-crypto-muted mt-0.5">
                            Evaluating candle momentum, ATR volatility, structural support/resistance, and scoring highest relevance setup...
                        </p>
                    </div>
                </div>
            )}

            {/* Live AI Scan Result Card */}
            {scanResult && !analyzing && (
                <div className={`mx-5 mt-4 p-4 md:p-5 rounded-2xl border backdrop-blur-md animate-fade-in relative shadow-lg ${
                    scanResult.action === 'NO_TRADE'
                        ? 'bg-amber-500/5 border-amber-500/30'
                        : scanResult.action === 'ERROR'
                        ? 'bg-red-500/5 border-red-500/30'
                        : scanResult.action === 'BUY'
                        ? 'bg-emerald-500/5 border-emerald-500/30'
                        : 'bg-red-500/5 border-red-500/30'
                }`}>
                    {/* Close button */}
                    <button
                        onClick={() => setScanResult(null)}
                        className="absolute top-3.5 right-4 text-crypto-muted hover:text-crypto-heading text-lg leading-none cursor-pointer"
                        title="Dismiss result"
                    >
                        &times;
                    </button>

                    {/* Badges row */}
                    <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-crypto-primary bg-crypto-primary/10 px-2 py-0.5 rounded-md border border-crypto-primary/20 flex items-center gap-1">
                            <span>⚡</span> Live Market Analysis
                        </span>
                        <span className="text-xs font-bold text-crypto-heading bg-crypto-bg px-2 py-0.5 rounded border border-crypto-border">
                            {scanResult.symbol.replace('USD', '/USD')}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${tab === 'live' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-crypto-primary/15 text-crypto-primary border border-crypto-primary/30'}`}>
                            {tab === 'live' ? '💰 Live Mode' : '📄 Paper Mode'}
                        </span>
                        {scanResult.avgVolumeUsdt > 0 && (
                            <span className="text-[10px] text-crypto-muted bg-crypto-bg px-2 py-0.5 rounded border border-crypto-border">
                                5m Vol: ${Number(scanResult.avgVolumeUsdt.toFixed(0)).toLocaleString()} USDT
                            </span>
                        )}
                        {scanResult.time && (
                            <span className="text-[10px] text-crypto-muted ml-auto mr-5">
                                {scanResult.time}
                            </span>
                        )}
                    </div>

                    {/* Action Title & Confidence */}
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <div className={`text-base font-bold flex items-center gap-1.5 ${
                            scanResult.action === 'BUY' ? 'text-emerald-400' :
                            scanResult.action === 'SELL' ? 'text-red-400' :
                            scanResult.action === 'NO_TRADE' ? 'text-amber-400' : 'text-red-400'
                        }`}>
                            {scanResult.action === 'BUY' && <span>▲ BUY Signal Generated</span>}
                            {scanResult.action === 'SELL' && <span>▼ SELL Signal Generated</span>}
                            {scanResult.action === 'NO_TRADE' && <span>⬜ Neutral / No Trade Setup</span>}
                            {scanResult.action === 'ERROR' && <span>❌ Analysis Error</span>}
                        </div>

                        {scanResult.confidence > 0 && (
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs text-crypto-muted">Confidence:</span>
                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-crypto-card border border-crypto-border text-crypto-heading tabular-nums">
                                    {scanResult.confidence}%
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Reverse mode banner */}
                    {scanResult.isReversed && scanResult.reversedSignal && (
                        <div className="mb-3 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 text-xs flex items-center gap-2">
                            <span>🔄</span>
                            <span>
                                <strong>Reverse Engineering Mode Active:</strong> Original AI: {scanResult.signal?.action} @ {scanResult.signal?.entry} → Executed as <strong className="text-white">{scanResult.reversedSignal.action}</strong>
                            </span>
                        </div>
                    )}

                    {/* Pricing / Levels Grid if active setup */}
                    {scanResult.action !== 'NO_TRADE' && scanResult.action !== 'ERROR' && scanResult.signal && (
                        (() => {
                            const activeSig = (scanResult.isReversed && scanResult.reversedSignal) ? scanResult.reversedSignal : scanResult.signal;
                            const entry = activeSig.entry || 0;
                            const tp = activeSig.target1 || 0;
                            const sl = activeSig.stopLoss || 0;
                            const tpPct = entry && tp ? Math.abs(((tp - entry) / entry) * 100).toFixed(2) : null;
                            const slPct = entry && sl ? Math.abs(((sl - entry) / entry) * 100).toFixed(2) : null;

                            return (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                                    <div className="bg-crypto-bg/80 border border-crypto-border/60 rounded-xl p-2.5">
                                        <div className="text-[10px] text-crypto-muted uppercase tracking-wider">Entry Price</div>
                                        <div className="text-sm font-bold text-crypto-heading font-mono mt-0.5">
                                            ${entry > 0 ? entry : 'Market'}
                                        </div>
                                    </div>

                                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-2.5">
                                        <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold flex items-center justify-between">
                                            <span>Target (TP)</span>
                                            {tpPct && <span className="text-[9px]">+{tpPct}%</span>}
                                        </div>
                                        <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                                            ${tp || '—'}
                                        </div>
                                        <div className="text-[9px] text-emerald-400/70 mt-0.5">Micro scalp target</div>
                                    </div>

                                    <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-2.5">
                                        <div className="text-[10px] text-red-400 uppercase tracking-wider font-semibold flex items-center justify-between">
                                            <span>Stop Loss (SL)</span>
                                            {slPct && <span className="text-[9px]">-{slPct}%</span>}
                                        </div>
                                        <div className="text-sm font-bold text-red-400 font-mono mt-0.5">
                                            ${sl || '—'}
                                        </div>
                                        <div className="text-[9px] text-red-400/70 mt-0.5">Wide structural safety</div>
                                    </div>

                                    <div className="bg-crypto-bg/80 border border-crypto-border/60 rounded-xl p-2.5">
                                        <div className="text-[10px] text-crypto-muted uppercase tracking-wider">Leverage & Qty</div>
                                        <div className="text-sm font-bold text-crypto-heading font-mono mt-0.5">
                                            {activeSig.leverage || 10}× · {activeSig.quantity || 1} contracts
                                        </div>
                                        <div className="text-[9px] text-crypto-muted mt-0.5">Sized for {tab} budget</div>
                                    </div>
                                </div>
                            );
                        })()
                    )}

                    {/* AI Reasoning */}
                    <div className="bg-crypto-bg/50 border border-crypto-border/50 rounded-xl p-3 text-xs text-crypto-muted leading-relaxed">
                        <span className="font-semibold text-crypto-heading mr-1">AI Analysis:</span>
                        {scanResult.reasoning}
                    </div>

                    {/* Retry / Relevance Note if present */}
                    {scanResult.signal?.retryNote && (
                        <p className="mt-2 text-[11px] text-cyan-400/90 flex items-center gap-1.5 font-medium">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {scanResult.signal.retryNote}
                        </p>
                    )}

                    {/* Action Button: 1-Click Execution */}
                    {scanResult.action !== 'NO_TRADE' && scanResult.action !== 'ERROR' && (
                        <div className="mt-3.5 flex items-center gap-3 flex-wrap">
                            <button
                                onClick={() => {
                                    const toExec = (scanResult.isReversed && scanResult.reversedSignal) ? scanResult.reversedSignal : (scanResult.saved || scanResult.signal);
                                    setTradeSignal(toExec);
                                }}
                                className="px-4 py-2 bg-gradient-to-r from-crypto-primary to-indigo-600 hover:from-crypto-primary/90 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-crypto-primary/20 transition-all cursor-pointer flex items-center gap-2"
                            >
                                <span>⚡</span>
                                <span>Review & Execute Trade ({tab.toUpperCase()})</span>
                            </button>

                            <button
                                onClick={() => navigate('/signals')}
                                className="px-3 py-2 text-xs font-medium text-crypto-muted hover:text-crypto-heading bg-crypto-bg border border-crypto-border rounded-xl transition-colors cursor-pointer"
                            >
                                View All Signals →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Panel */}
            <div className="px-5 py-5">
                {/* Toggle feedback banner */}
                {toggleMsg && (
                    <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
                        toggleMsg.startsWith('✓') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        toggleMsg.startsWith('⚠') ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        'bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20'
                    }`}>
                        {toggleMsg}
                    </div>
                )}
                <ModePanel
                    mode={tab}
                    status={status[tab]}
                    config={status[tab]?.config}
                    onSave={handleSave}
                    onToggle={handleToggle}
                    onToggleReverse={handleToggleReverse}
                    toggling={toggling}
                    reverseToggling={reverseToggling}
                    onAnalyzeNow={handleAnalyzeNow}
                    analyzing={analyzing}
                />
            </div>

            {/* Trade Confirmation Dialog */}
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

export default AutomationSettings;
