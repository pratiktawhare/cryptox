import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SliderField({ label, hint, value, min, max, step = 1, unit = '', onChange }) {
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-crypto-heading font-medium">{label}</label>
                <span className="text-xs font-bold text-crypto-primary tabular-nums">
                    {value}{unit}
                </span>
            </div>
            <input
                type="range"
                min={min} max={max} step={step}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-crypto-border accent-crypto-primary"
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

function ModePanel({ mode, status, config, onSave, onToggle, toggling = false }) {
    const isLive    = mode === 'live';
    const isRunning = status?.running;
    const accent    = isLive ? 'amber' : 'blue';

    const [cfg, setCfg]     = useState(config || {});
    const [saving, setSaving] = useState(false);
    const [msg, setMsg]     = useState('');

    useEffect(() => { setCfg(config || {}); }, [config]);

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
    const minThreshold   = ((cfg.estimatedWalletUSD || 1000) * 0.05).toFixed(2);

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

            {/* Start/Stop button */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm font-bold text-crypto-heading">
                        {isLive ? '💰 Live' : '📄 Paper'} Automation
                    </div>
                    <div className={`text-[10px] mt-0.5 font-semibold flex items-center gap-1 ${isRunning ? 'text-emerald-400' : 'text-crypto-muted'}`}>
                        {isRunning
                            ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Running</>
                            : <><span className="inline-block w-1.5 h-1.5 rounded-full bg-crypto-border" /> Stopped</>
                        }
                    </div>
                </div>
                <button
                    onClick={() => onToggle(mode, !isRunning)}
                    disabled={toggling}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        isRunning
                            ? 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                            : isLive
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                    }`}
                >
                    {toggling
                        ? (isRunning ? '⏳ Stopping…' : '⏳ Starting…')
                        : (isRunning ? '⏹ Stop Automation' : '▶ Start AI Automation')
                    }
                </button>
            </div>

            <div className="border-t border-crypto-border/30 pt-4 space-y-4">

                {/* Interval */}
                <SliderField
                    label="Scan Interval"
                    hint={`AI scans every ${cfg.intervalMinutes || 30} minutes for a new trade`}
                    value={cfg.intervalMinutes || 30}
                    min={15} max={240} step={15} unit=" min"
                    onChange={v => update('intervalMinutes', v)}
                />

                {/* Estimated wallet */}
                <div>
                    <label className="text-xs text-crypto-heading font-medium block mb-1">Estimated Wallet Size (USD)</label>
                    <input
                        type="number"
                        min={10} step={10}
                        value={cfg.estimatedWalletUSD || 1000}
                        onChange={e => update('estimatedWalletUSD', Number(e.target.value))}
                        className="w-full text-xs px-3 py-2 rounded-lg bg-crypto-input border border-crypto-border text-crypto-heading focus:outline-none focus:ring-1 focus:ring-crypto-primary/30 focus:border-crypto-primary transition-all"
                    />
                    <p className="text-[10px] text-crypto-muted mt-0.5">
                        Reference wallet size. Automation pauses when actual balance &lt; ${minThreshold} (5%).
                    </p>
                </div>

                {/* Trade % */}
                <SliderField
                    label="Trade Size (% of wallet)"
                    hint={`~$${marginPerTrade} margin per trade · Leverage amplifies position size`}
                    value={cfg.tradePct || 20}
                    min={5} max={80} unit="%"
                    onChange={v => update('tradePct', v)}
                />

                {/* Min confidence */}
                <SliderField
                    label="Minimum Confidence"
                    hint={`Only execute trades where AI confidence ≥ ${cfg.minConfidence || 70}%`}
                    value={cfg.minConfidence || 70}
                    min={60} max={95} unit="%"
                    onChange={v => update('minConfidence', v)}
                />

                {/* Leverage range */}
                <div className="grid grid-cols-2 gap-3">
                    <SliderField
                        label="Min Leverage"
                        value={cfg.minLeverage || 10}
                        min={2} max={cfg.maxLeverage || 20} unit="×"
                        onChange={v => update('minLeverage', Math.min(v, cfg.maxLeverage || 20))}
                    />
                    <SliderField
                        label="Max Leverage"
                        value={cfg.maxLeverage || 20}
                        min={cfg.minLeverage || 10} max={20} unit="×"
                        onChange={v => update('maxLeverage', Math.max(v, cfg.minLeverage || 10))}
                    />
                </div>
                <p className="text-[10px] text-crypto-muted -mt-2">AI picks leverage within this range based on setup quality</p>

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
                    </div>
                )}

                {/* Summary box */}
                <div className="bg-crypto-bg-subtle rounded-lg px-3 py-2.5 text-[10px] text-crypto-muted space-y-0.5">
                    <div className="font-semibold text-crypto-heading text-[11px] mb-1">Summary</div>
                    <div>⏱ Scans every <strong className="text-crypto-heading">{cfg.intervalMinutes || 30}m</strong></div>
                    <div>💵 Margin per trade: <strong className="text-crypto-heading">${marginPerTrade}</strong> ({cfg.tradePct || 20}% of ${cfg.estimatedWalletUSD || 1000})</div>
                    <div>🎯 Min confidence: <strong className="text-crypto-heading">{cfg.minConfidence || 70}%</strong></div>
                    <div>⚡ Leverage: AI picks <strong className="text-crypto-heading">{cfg.minLeverage || 10}–{cfg.maxLeverage || 20}×</strong></div>
                    <div>⛔ Pauses if balance &lt; <strong className="text-crypto-heading">${minThreshold}</strong></div>
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
    const [tab, setTab]           = useState('paper');
    const [status, setStatus]     = useState({ paper: { running: false, config: {} }, live: { running: false, config: {} } });
    const [loading, setLoading]   = useState(true);
    const [toggling, setToggling] = useState(false);
    const [toggleMsg, setToggleMsg] = useState('');

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
                await api.post('/automation/start', { mode });
                // Optimistically flip the button immediately, then sync from server
                setStatus(prev => ({ ...prev, [mode]: { ...prev[mode], running: true } }));
                setToggleMsg('✓ Automation started');
            } else {
                await api.post('/automation/stop', { mode });
                setStatus(prev => ({ ...prev, [mode]: { ...prev[mode], running: false } }));
                setToggleMsg('✓ Automation stopped');
            }
            // Sync full config from server in background
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
            {/* Header */}
            <div className="px-5 py-4 border-b border-crypto-border">
                <h3 className="text-sm font-bold text-crypto-heading">AI Trade Automation</h3>
                <p className="text-xs text-crypto-muted mt-0.5">
                    Automatically scan for trades every N minutes and execute when confidence is high enough
                </p>
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
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                    </button>
                ))}
            </div>

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
                    toggling={toggling}
                />
            </div>
        </div>
    );
};

export default AutomationSettings;
