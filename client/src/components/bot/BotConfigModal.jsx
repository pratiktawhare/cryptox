import React, { useState, useEffect } from 'react';
import api from '../../services/api';

export default function BotConfigModal({ isOpen, onClose, config = {}, mode = 'paper', onSave, reverseMode = false }) {
    const [budget, setBudget] = useState(String(config.budgetUSDT ?? 10));
    const [resetWalletBalance, setResetWalletBalance] = useState('10');
    const [resettingWallet, setResettingWallet] = useState(false);
    const [resetSuccessMsg, setResetSuccessMsg] = useState('');
    const [leverage, setLeverage] = useState(config.maxLeverage ?? 20);
    const [targetRoiPct, setTargetRoiPct] = useState(config.targetRoiPct ?? 5);
    const [maxOpenPositions, setMaxOpenPositions] = useState(config.maxOpenPositions ?? 5);
    const [riskPerTrade, setRiskPerTrade] = useState(config.riskPerTradePct ?? 5);
    const [maxDailyLoss, setMaxDailyLoss] = useState(config.maxDailyLossPct ?? 10);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(config.maxConsecutiveLosses ?? 3);
    const [minSignalScore, setMinSignalScore] = useState(config.minSignalScore ?? (mode === 'live' ? 6 : 5));
    const [minRewardRisk, setMinRewardRisk] = useState(config.minRewardRisk ?? 0.05);
    const [slAtrMultiplier, setSlAtrMultiplier] = useState(config.slAtrMultiplier ?? 5.0);
    const [cooldownSeconds, setCooldownSeconds] = useState(config.cooldownSeconds ?? 60);
    const [scanIntervalMinutes, setScanIntervalMinutes] = useState(config.scanIntervalMinutes ?? 5);
    const [aiEnabled, setAiEnabled] = useState(config.aiEnabled ?? true);
    const [aiIntervalSeconds, setAiIntervalSeconds] = useState(config.aiIntervalSeconds ?? 1800);

    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        if (config) {
            setBudget(String(config.budgetUSDT ?? 10));
            setLeverage(config.maxLeverage ?? 20);
            setTargetRoiPct(config.targetRoiPct ?? 5);
            setMaxOpenPositions(config.maxOpenPositions ?? 5);
            setRiskPerTrade(config.riskPerTradePct ?? 5);
            setMaxDailyLoss(config.maxDailyLossPct ?? 10);
            setMaxConsecutiveLosses(config.maxConsecutiveLosses ?? 3);
            setMinSignalScore(config.minSignalScore ?? (mode === 'live' ? 6 : 5));
            setMinRewardRisk(config.minRewardRisk ?? 0.05);
            setSlAtrMultiplier(config.slAtrMultiplier ?? 5.0);
            setCooldownSeconds(config.cooldownSeconds ?? 60);
            setScanIntervalMinutes(config.scanIntervalMinutes ?? 5);
            setAiEnabled(config.aiEnabled ?? true);
            setAiIntervalSeconds(config.aiIntervalSeconds ?? 1800);
        }
    }, [config, mode]);

    if (!isOpen) return null;

    const handleSave = async (e) => {
        e.preventDefault();
        setErrorMsg('');

        const numericBudget = parseFloat(budget);
        if (isNaN(numericBudget) || numericBudget <= 0) {
            setErrorMsg('Please enter a valid positive budget amount in USDT.');
            return;
        }

        setSaving(true);
        try {
            await onSave({
                budgetUSDT: numericBudget,
                maxLeverage: Number(leverage),
                targetRoiPct: Number(targetRoiPct),
                maxOpenPositions: Number(maxOpenPositions),
                riskPerTradePct: Number(riskPerTrade),
                maxDailyLossPct: Number(maxDailyLoss),
                maxConsecutiveLosses: Number(maxConsecutiveLosses),
                minSignalScore: Number(minSignalScore),
                minRewardRisk: Number(minRewardRisk),
                slAtrMultiplier: Number(slAtrMultiplier),
                cooldownSeconds: Number(cooldownSeconds),
                scanIntervalMinutes: Number(scanIntervalMinutes),
                aiEnabled: Boolean(aiEnabled),
                aiIntervalSeconds: Number(aiIntervalSeconds),
            });
            onClose();
        } catch (err) {
            setErrorMsg(err.response?.data?.error || err.message || 'Failed to update configuration');
        } finally {
            setSaving(false);
        }
    };

    const handleResetDefaults = () => {
        setBudget('10');
        setLeverage(20);
        setTargetRoiPct(5);
        setMaxOpenPositions(5);
        setRiskPerTrade(5);
        setMaxDailyLoss(10);
        setMaxConsecutiveLosses(3);
        setMinSignalScore(mode === 'live' ? 6 : 5);
        setMinRewardRisk(0.05);
        setSlAtrMultiplier(5.0);
        setCooldownSeconds(60);
        setScanIntervalMinutes(5);
        setAiEnabled(true);
        setAiIntervalSeconds(1800);
    };

    const handleResetPaperWallet = async () => {
        setErrorMsg('');
        setResetSuccessMsg('');
        const amt = parseFloat(resetWalletBalance);
        if (isNaN(amt) || amt <= 0) {
            setErrorMsg('Please enter a valid positive paper balance amount (e.g. $5, $10, $1,000).');
            return;
        }

        setResettingWallet(true);
        try {
            await api.post('/paper/reset', { balance: amt });
            setResetSuccessMsg(`Paper wallet successfully reset to $${amt.toFixed(2)} USDT.`);
            setBudget(String(amt));
            setTimeout(() => setResetSuccessMsg(''), 4000);
        } catch (err) {
            setErrorMsg(err.response?.data?.error || err.message || 'Failed to reset paper wallet');
        } finally {
            setResettingWallet(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-crypto-card border border-crypto-border rounded-3xl max-w-2xl w-full p-6 md:p-8 shadow-2xl space-y-6 my-8 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-crypto-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-crypto-primary/10 border border-crypto-primary/20 flex items-center justify-center text-crypto-primary">
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-crypto-heading tracking-tight">
                                TradingBot Settings ({mode.toUpperCase()} MODE)
                            </h2>
                            <p className="text-xs text-crypto-muted">
                                Configure leverage, sizing budget, risk parameters, and AI sentinel
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-xl text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {errorMsg && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2">
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {errorMsg}
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-6">
                    {/* Section 1: Capital & Leverage */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-crypto-primary">
                            1. Capital & Leverage (Low-Budget Support)
                        </h3>

                        {/* Free Budget Input */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs font-bold text-crypto-heading">
                                    Strategy Budget (USDT)
                                </label>
                                <span className="text-[11px] text-crypto-muted">
                                    Free numeric input · Default $10
                                </span>
                            </div>
                            <div className="relative">
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-crypto-muted font-bold text-sm">
                                    $
                                </span>
                                <input
                                    type="number"
                                    step="any"
                                    value={budget}
                                    onChange={e => setBudget(e.target.value)}
                                    placeholder="10.00"
                                    className="w-full pl-8 pr-16 py-2.5 rounded-xl bg-crypto-bg border border-crypto-border focus:border-crypto-primary text-crypto-heading text-sm font-black tabular-nums transition-all focus:outline-none"
                                />
                                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-crypto-muted uppercase">
                                    USDT
                                </span>
                            </div>
                            <p className="text-[11px] text-crypto-muted mt-1.5 leading-normal">
                                The affordability pre-filter uses this budget to only scan coins where 1 contract's margin is affordable at your leverage. Sizing will never exceed this budget.
                            </p>
                        </div>

                        {/* Paper Wallet Reset Card (Paper mode only) */}
                        {mode === 'paper' && (
                            <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                        </svg>
                                        Reset Virtual Paper Wallet Balance
                                    </label>
                                    <span className="text-[10px] text-crypto-muted">No limits (e.g. $5, $10, $1,000)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-crypto-muted font-bold text-xs">$</span>
                                        <input
                                            type="number"
                                            step="any"
                                            min="0.01"
                                            value={resetWalletBalance}
                                            onChange={e => setResetWalletBalance(e.target.value)}
                                            placeholder="10.00"
                                            className="w-full pl-6 pr-3 py-2 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold tabular-nums focus:outline-none focus:border-amber-500"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        disabled={resettingWallet}
                                        onClick={handleResetPaperWallet}
                                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs shadow-md shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
                                    >
                                        {resettingWallet ? 'Resetting…' : 'Reset Wallet'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {[5, 10, 50, 100, 1000].map(amt => (
                                        <button
                                            type="button"
                                            key={amt}
                                            onClick={() => {
                                                setResetWalletBalance(String(amt));
                                                setBudget(String(amt));
                                            }}
                                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-crypto-bg border border-crypto-border text-crypto-muted hover:text-crypto-heading cursor-pointer"
                                        >
                                            ${amt}
                                        </button>
                                    ))}
                                </div>
                                {resetSuccessMsg && (
                                    <p className="text-[11px] text-emerald-400 font-bold animate-pulse">
                                        ✓ {resetSuccessMsg}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Leverage Selector */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs font-bold text-crypto-heading">
                                    Execution Leverage
                                </label>
                                <span className="text-[11px] font-bold text-crypto-primary tabular-nums">
                                    {leverage}x Margin
                                </span>
                            </div>
                            <div className="grid grid-cols-6 gap-2">
                                {[5, 10, 15, 20, 25, 50].map(lev => (
                                    <button
                                        type="button"
                                        key={lev}
                                        onClick={() => setLeverage(lev)}
                                        className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                            leverage === lev
                                                ? 'bg-crypto-primary text-white border-crypto-primary shadow-md shadow-crypto-primary/25'
                                                : 'bg-crypto-bg border-crypto-border text-crypto-muted hover:text-crypto-heading hover:border-crypto-border/80'
                                        }`}
                                    >
                                        {lev}x {lev === 20 ? '★' : ''}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-crypto-muted mt-1.5">
                                20x margin is the recommended default. Sizing and TP targets automatically adjust to your leverage.
                            </p>
                        </div>

                        {/* Target Expected ROI on Margin Control */}
                        <div className="p-4 bg-crypto-bg border border-crypto-border rounded-2xl space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <label className="text-xs font-bold text-crypto-heading flex items-center gap-1.5">
                                        <span>🎯</span> Target Expected ROI on Margin (%)
                                    </label>
                                    <span className="text-[11px] text-crypto-muted">
                                        Small ROI + wide stop loss = Ultra-high win rate
                                    </span>
                                </div>
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-black tabular-nums">
                                    {targetRoiPct}% Return
                                </span>
                            </div>

                            <input
                                type="range"
                                min="1"
                                max="25"
                                step="0.5"
                                value={targetRoiPct}
                                onChange={e => setTargetRoiPct(parseFloat(e.target.value))}
                                className="w-full accent-emerald-400 cursor-pointer"
                            />

                            {/* ROI Presets */}
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    { roi: 3, label: '3% Ultra-Scalp' },
                                    { roi: 5, label: '5% Quick Win ★' },
                                    { roi: 8, label: '8% Balanced' },
                                    { roi: 12, label: '12% Extended' },
                                    { roi: 20, label: '20% Swing' },
                                ].map(preset => (
                                    <button
                                        type="button"
                                        key={preset.roi}
                                        onClick={() => setTargetRoiPct(preset.roi)}
                                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                                            targetRoiPct === preset.roi
                                                ? 'bg-emerald-500 text-black border-emerald-400 font-black shadow-sm'
                                                : 'bg-crypto-card border-crypto-border text-crypto-muted hover:text-crypto-heading'
                                        }`}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>

                            {/* Dynamic Live Price Move Calculation */}
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-2.5">
                                <div className="text-base flex-shrink-0">⚡</div>
                                <div className="text-[11px] text-crypto-muted leading-relaxed">
                                    At <strong className="text-crypto-heading">{leverage}x leverage</strong>, achieving a <strong className="text-emerald-400">{targetRoiPct}% net ROI</strong> on margin requires only a <strong className="text-emerald-400">~{((targetRoiPct + 0.0826 * leverage) / leverage).toFixed(2)}% price move</strong> (covering Delta's 0.0826% fees + GST). Paired with a wide stop loss, trades hit take-profit with extreme consistency!
                                </div>
                            </div>
                        </div>

                        {/* Real Delta Exchange Fee Notice */}
                        <div className="p-3 bg-crypto-bg border border-crypto-border/80 rounded-2xl flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span className="text-crypto-muted">
                                    <strong className="text-crypto-heading">Real Delta Fee Simulation:</strong> 0.02% Maker + 0.05% Taker + 18% GST (0.0826% round trip) deducted on every trade.
                                </span>
                            </div>
                            <span className="text-[10px] text-crypto-primary font-bold px-2 py-0.5 rounded bg-crypto-primary/10">Active</span>
                        </div>

                        {/* Max Simultaneous Open Trades */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs font-bold text-crypto-heading">
                                    Max Simultaneous Open Trades
                                </label>
                                <span className="text-[11px] font-bold text-crypto-primary tabular-nums">
                                    {maxOpenPositions} {maxOpenPositions === 1 ? 'Position' : 'Positions'}
                                </span>
                            </div>
                            <div className="grid grid-cols-5 gap-2">
                                {[1, 2, 3, 5, 10].map(cnt => (
                                    <button
                                        type="button"
                                        key={cnt}
                                        onClick={() => setMaxOpenPositions(cnt)}
                                        className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                            maxOpenPositions === cnt
                                                ? 'bg-crypto-primary text-white border-crypto-primary shadow-md shadow-crypto-primary/25'
                                                : 'bg-crypto-bg border-crypto-border text-crypto-muted hover:text-crypto-heading hover:border-crypto-border/80'
                                        }`}
                                    >
                                        {cnt} {cnt === 5 ? '★' : ''}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-crypto-muted mt-1.5">
                                Allow the bot to open multiple affordable coin setups concurrently without blocking on 1 trade.
                            </p>
                        </div>
                    </div>

                    {/* Section 2: Risk Management & Circuit Breakers */}
                    <div className="space-y-4 pt-4 border-t border-crypto-border/60">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-crypto-primary">
                            2. Risk Management & Protective Brackets
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Risk Per Trade */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-semibold text-crypto-heading">Risk Per Trade (%)</label>
                                    <span className="text-xs font-bold text-crypto-heading tabular-nums">{riskPerTrade}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max="15"
                                    step="0.5"
                                    value={riskPerTrade}
                                    onChange={e => setRiskPerTrade(parseFloat(e.target.value))}
                                    className="w-full accent-crypto-primary cursor-pointer"
                                />
                                <span className="text-[10px] text-crypto-muted">Max account risk on Stop-Loss</span>
                            </div>

                            {/* Max Daily Loss */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-semibold text-crypto-heading">Max Daily Loss (%)</label>
                                    <span className="text-xs font-bold text-crypto-heading tabular-nums">{maxDailyLoss}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="2"
                                    max="25"
                                    step="1"
                                    value={maxDailyLoss}
                                    onChange={e => setMaxDailyLoss(parseFloat(e.target.value))}
                                    className="w-full accent-crypto-primary cursor-pointer"
                                />
                                <span className="text-[10px] text-crypto-muted">Halts trading until midnight UTC</span>
                            </div>

                            {/* Max Consecutive Losses */}
                            <div>
                                <label className="text-xs font-semibold text-crypto-heading block mb-1">
                                    Consecutive Loss Breaker
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    max="10"
                                    value={maxConsecutiveLosses}
                                    onChange={e => setMaxConsecutiveLosses(parseInt(e.target.value) || 3)}
                                    className="w-full px-3 py-2 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold tabular-nums"
                                />
                                <span className="text-[10px] text-crypto-muted">Losses before circuit breaker triggers</span>
                            </div>

                            {/* Min Signal Score */}
                            <div>
                                <label className="text-xs font-semibold text-crypto-heading block mb-1">
                                    Min Signal Score (out of 8)
                                </label>
                                <select
                                    value={minSignalScore}
                                    onChange={e => setMinSignalScore(parseInt(e.target.value))}
                                    className="w-full px-3 py-2 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                >
                                    <option value={4}>4 / 8 (Aggressive)</option>
                                    <option value={5}>5 / 8 (Balanced - Default Paper)</option>
                                    <option value={6}>6 / 8 (High Conviction - Default Live)</option>
                                    <option value={7}>7 / 8 (Ultra Strict)</option>
                                    <option value={8}>8 / 8 (All Conditions Required)</option>
                                </select>
                            </div>
                        </div>

                        {/* Stop-Loss Distance & Min Reward/Risk */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-semibold text-crypto-heading">
                                        Stop-Loss Distance ({slAtrMultiplier}x ATR)
                                    </label>
                                    <span className="text-xs font-bold text-crypto-primary tabular-nums">
                                        {slAtrMultiplier >= 5.0 ? 'Noise-Immune (Never Hits ★)' : slAtrMultiplier >= 4.0 ? 'Wide (High Win Rate)' : 'Standard'}
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="2.0"
                                    max="8.0"
                                    step="0.5"
                                    value={slAtrMultiplier}
                                    onChange={e => setSlAtrMultiplier(parseFloat(e.target.value))}
                                    className="w-full accent-crypto-primary cursor-pointer"
                                />
                                <div className="flex justify-between text-[10px] text-crypto-muted mt-0.5">
                                    <span>2.0x</span>
                                    <span className="text-crypto-primary font-bold">5.0x (Noise-Immune ★)</span>
                                    <span>8.0x (Disaster Only)</span>
                                </div>
                                <span className="text-[10px] text-crypto-muted mt-1 block">
                                    Keeps SL far away so normal market noise never hits it, safely buffered before liquidation.
                                </span>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-semibold text-crypto-heading">
                                        Min Net Reward / Risk Ratio
                                    </label>
                                    <span className="text-xs font-bold text-crypto-heading tabular-nums">
                                        {minRewardRisk}x R:R
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="0.05"
                                    max="1.5"
                                    step="0.05"
                                    value={minRewardRisk}
                                    onChange={e => setMinRewardRisk(parseFloat(e.target.value))}
                                    className="w-full accent-crypto-primary cursor-pointer"
                                />
                                <div className="flex justify-between text-[10px] text-crypto-muted mt-0.5">
                                    <span className="text-crypto-primary font-bold">0.05x (High Win Rate Scalp ★)</span>
                                    <span>0.25x</span>
                                    <span>1.0x (Strict)</span>
                                </div>
                                <span className="text-[10px] text-crypto-muted mt-1 block">
                                    Allows small profit targets with wide stops for extreme win rate and quick exits.
                                </span>
                            </div>
                        </div>

                        {/* Cooldown & Scan Interval */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-semibold text-crypto-heading block mb-1">
                                    Post-Trade Cooldown (seconds)
                                </label>
                                <input
                                    type="number"
                                    min="10"
                                    max="3600"
                                    step="10"
                                    value={cooldownSeconds}
                                    onChange={e => setCooldownSeconds(parseInt(e.target.value) || 60)}
                                    className="w-full px-3 py-2 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold tabular-nums"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-crypto-heading block mb-1">
                                    Scan Interval (Minutes)
                                </label>
                                <select
                                    value={scanIntervalMinutes}
                                    onChange={e => setScanIntervalMinutes(parseInt(e.target.value))}
                                    className="w-full px-3 py-2 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                >
                                    <option value={1}>1 Minute</option>
                                    <option value={3}>3 Minutes</option>
                                    <option value={5}>5 Minutes (Default 5m candles)</option>
                                    <option value={15}>15 Minutes</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Section 3: Groq AI Sentinel */}
                    <div className="space-y-3 pt-4 border-t border-crypto-border/60">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-crypto-primary">
                                    3. Groq AI Macro Sentinel
                                </h3>
                                <p className="text-[11px] text-crypto-muted">
                                    30m background LLM analysis. Non-blocking with 100% pure TA fail-safe fallback.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={aiEnabled}
                                    onChange={e => setAiEnabled(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-crypto-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-crypto-primary"></div>
                            </label>
                        </div>
                    </div>

                    {/* Section 4: Trading Direction */}
                    <div className="space-y-3 pt-4 border-t border-crypto-border/60">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-crypto-primary">
                            4. Trading Direction
                        </h3>
                        <div className={`p-3.5 rounded-2xl border flex items-start gap-3 ${
                            reverseMode
                                ? 'bg-violet-500/10 border-violet-500/25'
                                : 'bg-crypto-bg border-crypto-border/80'
                        }`}>
                            <div className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                reverseMode ? 'bg-violet-500/20 text-violet-400' : 'bg-crypto-primary/10 text-crypto-primary'
                            }`}>
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 1l4 4-4 4" />
                                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                                    <path d="M7 23l-4-4 4-4" />
                                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                                </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-black ${
                                        reverseMode ? 'text-violet-400' : 'text-crypto-heading'
                                    }`}>
                                        {reverseMode ? '🔄 Fade Rally Mode — ACTIVE' : 'Trend-Following Mode — ACTIVE'}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                        reverseMode
                                            ? 'bg-violet-500/20 text-violet-300'
                                            : 'bg-emerald-500/15 text-emerald-400'
                                    }`}>
                                        {reverseMode ? 'Counter-Trend' : 'With-Trend'}
                                    </span>
                                </div>
                                <p className="text-[11px] text-crypto-muted leading-relaxed">
                                    {reverseMode
                                        ? 'The bot is entering OPPOSITE the detected signal direction. Bullish setups → Short. Bearish setups → Long. Great for fading overbought rallies with small TP + wide SL.'
                                        : 'The bot follows the trend direction: Bullish setups → Long, Bearish setups → Short.'}
                                </p>
                                <p className="text-[10px] text-crypto-muted mt-1.5">
                                    Toggle this mode using the <strong className="text-crypto-heading">🔄 Fade Rally</strong> button in the header bar.
                                </p>
                            </div>
                        </div>
                    </div>


                    <div className="pt-4 border-t border-crypto-border flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={handleResetDefaults}
                            className="px-3.5 py-2 rounded-xl text-xs font-semibold text-crypto-muted hover:text-crypto-heading transition-colors"
                        >
                            Reset Defaults
                        </button>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-crypto-primary hover:bg-crypto-primary-hover text-white shadow-lg shadow-crypto-primary/25 active:scale-95 transition-all disabled:opacity-50"
                            >
                                {saving ? 'Saving…' : 'Save Strategy Settings'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
