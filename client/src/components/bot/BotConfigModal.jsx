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
    const [walletParts, setWalletParts] = useState(config.walletParts ?? 1);
    const [smartGuard, setSmartGuard] = useState(config.smartLossGuard ?? false);
    const [strategyType, setStrategyType] = useState(config.strategyType ?? 'trend_pullback');
    const [breakoutSqueezeBars, setBreakoutSqueezeBars] = useState(config.breakoutSqueezeBars ?? 2);
    const [breakoutKcMultiplier, setBreakoutKcMultiplier] = useState(config.breakoutKcMultiplier ?? 2.0);
    const [breakoutMaxBandwidth, setBreakoutMaxBandwidth] = useState(config.breakoutMaxBandwidth ?? 0.015);
    const [breakoutCandidatesCount, setBreakoutCandidatesCount] = useState(config.breakoutCandidatesCount ?? 50);
    const [breakoutMaxArmedFleet, setBreakoutMaxArmedFleet] = useState(config.breakoutMaxArmedFleet ?? 15);
    const [breakoutThrottleSeconds, setBreakoutThrottleSeconds] = useState(config.breakoutThrottleSeconds ?? 15);
    const [breakoutMin24hVolumeUSDT, setBreakoutMin24hVolumeUSDT] = useState(config.breakoutMin24hVolumeUSDT ?? 50000);
    const [breakoutRvolMin, setBreakoutRvolMin] = useState(config.breakoutRvolMin ?? 1.2);
    const [breakoutTargetRoiPct, setBreakoutTargetRoiPct] = useState(config.breakoutTargetRoiPct ?? 10);

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
            setWalletParts(config.walletParts ?? 1);
            setSmartGuard(config.smartLossGuard ?? false);
            setStrategyType(config.strategyType ?? 'trend_pullback');
            setBreakoutSqueezeBars(config.breakoutSqueezeBars ?? 2);
            setBreakoutKcMultiplier(config.breakoutKcMultiplier ?? 2.0);
            setBreakoutMaxBandwidth(config.breakoutMaxBandwidth ?? 0.015);
            setBreakoutCandidatesCount(config.breakoutCandidatesCount ?? 50);
            setBreakoutMaxArmedFleet(config.breakoutMaxArmedFleet ?? 15);
            setBreakoutThrottleSeconds(config.breakoutThrottleSeconds ?? 15);
            setBreakoutMin24hVolumeUSDT(config.breakoutMin24hVolumeUSDT ?? 50000);
            setBreakoutRvolMin(config.breakoutRvolMin ?? 1.2);
            setBreakoutTargetRoiPct(config.breakoutTargetRoiPct ?? 10);
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
                walletParts: Number(walletParts),
                smartLossGuard: Boolean(smartGuard),
                strategyType,
                breakoutSqueezeBars: Number(breakoutSqueezeBars),
                breakoutKcMultiplier: Number(breakoutKcMultiplier),
                breakoutMaxBandwidth: Number(breakoutMaxBandwidth),
                breakoutCandidatesCount: Number(breakoutCandidatesCount),
                breakoutMaxArmedFleet: Number(breakoutMaxArmedFleet),
                breakoutThrottleSeconds: Number(breakoutThrottleSeconds),
                breakoutMin24hVolumeUSDT: Number(breakoutMin24hVolumeUSDT),
                breakoutRvolMin: Number(breakoutRvolMin),
                breakoutTargetRoiPct: Number(breakoutTargetRoiPct),
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
        setWalletParts(1);
        setSmartGuard(false);
        setStrategyType('trend_pullback');
        setBreakoutSqueezeBars(2);
        setBreakoutKcMultiplier(2.0);
        setBreakoutMaxBandwidth(0.015);
        setBreakoutCandidatesCount(50);
        setBreakoutMaxArmedFleet(15);
        setBreakoutThrottleSeconds(15);
        setBreakoutMin24hVolumeUSDT(50000);
        setBreakoutRvolMin(1.2);
        setBreakoutTargetRoiPct(10);
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

                        {/* Wallet Parts Divider */}
                        <div className="p-4 bg-crypto-bg border border-crypto-border rounded-2xl space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <label className="text-xs font-bold text-crypto-heading flex items-center gap-1.5">
                                        <span>🍕</span> Wallet Parts (Trade Sizing)
                                    </label>
                                    <span className="text-[11px] text-crypto-muted">
                                        Divide your budget into equal parts — each part is one trade's margin
                                    </span>
                                </div>
                                <span className="px-2.5 py-1 rounded-lg bg-crypto-primary/10 border border-crypto-primary/20 text-crypto-primary text-xs font-black tabular-nums">
                                    {walletParts === 1 ? 'Full Budget' : `1 / ${walletParts} per trade`}
                                </span>
                            </div>

                            {/* Part presets */}
                            <div className="grid grid-cols-6 gap-2">
                                {[1, 2, 3, 4, 5, 10].map(p => (
                                    <button
                                        type="button"
                                        key={p}
                                        onClick={() => setWalletParts(p)}
                                        className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                            walletParts === p
                                                ? 'bg-crypto-primary text-white border-crypto-primary shadow-md shadow-crypto-primary/25'
                                                : 'bg-crypto-card border-crypto-border text-crypto-muted hover:text-crypto-heading'
                                        }`}
                                    >
                                        {p === 1 ? 'Full' : `÷${p}`}
                                    </button>
                                ))}
                            </div>

                            {/* Live calculation preview */}
                            <div className="p-3 bg-crypto-primary/10 border border-crypto-primary/20 rounded-xl flex items-start gap-2.5">
                                <div className="text-base flex-shrink-0">💡</div>
                                <div className="text-[11px] text-crypto-muted leading-relaxed">
                                    With a <strong className="text-crypto-heading">${parseFloat(budget || 0).toFixed(2)} budget</strong> split into{' '}
                                    <strong className="text-crypto-primary">{walletParts} part{walletParts !== 1 ? 's' : ''}</strong>, each trade uses{' '}
                                    <strong className="text-crypto-heading">${(parseFloat(budget || 0) / walletParts).toFixed(2)} margin</strong>{' '}
                                    → <strong className="text-crypto-primary">${((parseFloat(budget || 0) / walletParts) * leverage).toFixed(2)} notional</strong> at {leverage}x leverage.
                                    <span className="block mt-1 font-semibold text-crypto-primary/90">
                                        ⚡ Effective max concurrent trades: {Math.min(maxOpenPositions, walletParts)} {Math.min(maxOpenPositions, walletParts) === 1 ? 'trade' : 'trades'}
                                        {maxOpenPositions > walletParts ? ` (capped by ${walletParts} wallet parts)` : ''}.
                                    </span>
                                </div>
                            </div>
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
                                {(() => {
                                    const estTargetPct = Math.max((targetRoiPct / (leverage || 20)) + 0.08, 0.2);
                                    const estSlPct = (estTargetPct * slAtrMultiplier).toFixed(2);
                                    return (
                                        <>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-xs font-semibold text-crypto-heading">
                                                    Stop-Loss Distance ({slAtrMultiplier}x Target)
                                                </label>
                                                <span className="text-xs font-bold text-crypto-primary tabular-nums">
                                                    ~{estSlPct}% SL ({slAtrMultiplier >= 5.0 ? 'Noise-Immune ★' : slAtrMultiplier >= 4.0 ? 'Wide' : 'Tight'})
                                                </span>
                                            </div>
                                            <input
                                                type="range"
                                                min="1.0"
                                                max="8.0"
                                                step="0.5"
                                                value={slAtrMultiplier}
                                                onChange={e => setSlAtrMultiplier(parseFloat(e.target.value))}
                                                className="w-full accent-crypto-primary cursor-pointer"
                                            />
                                            <div className="flex justify-between text-[10px] text-crypto-muted mt-0.5">
                                                <span>1.0x</span>
                                                <span className="text-crypto-primary font-bold">4.0x (Recommended)</span>
                                                <span>8.0x (Wide Safety)</span>
                                            </div>
                                            <span className="text-[10px] text-crypto-muted mt-1 block">
                                                Stop loss is set to {slAtrMultiplier}x your target ({estTargetPct.toFixed(2)}% target × {slAtrMultiplier}x = ~{estSlPct}% adverse move).
                                            </span>
                                        </>
                                    );
                                })()}
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

                    {/* Section 3: Strategy Mode Pipeline */}
                    <div className="space-y-4 pt-4 border-t border-crypto-border/60">
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-crypto-primary">
                                3. Strategy Execution Pipeline
                            </h3>
                            <p className="text-[11px] text-crypto-muted">
                                Select how the bot identifies setups: Trend Pullback, Volatility Squeeze Breakout, or Adaptive Hybrid.
                            </p>
                        </div>

                        {/* Strategy Selector Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            {[
                                {
                                    id: 'trend_pullback',
                                    title: 'Trend Pullback',
                                    badge: 'Default',
                                    icon: '📈',
                                    desc: 'Dynamic EMA9 limit discount entry on trending coins.',
                                },
                                {
                                    id: 'radar_fleet',
                                    title: 'Radar Fleet',
                                    badge: 'Multi-Asset Armada ★',
                                    icon: '📡',
                                    desc: 'Arms up to 15-20 coiled coins in parallel. Instant sub-second trigger on live breach.',
                                },
                                {
                                    id: 'breakout_straddle',
                                    title: 'Breakout Straddle',
                                    badge: 'Single / Dual Focus',
                                    icon: '⚡',
                                    desc: 'Dual tripwires around range. Focused on top 1-2 most compressed coins.',
                                },
                                {
                                    id: 'adaptive_hybrid',
                                    title: 'Adaptive Hybrid',
                                    badge: 'Smart Dual',
                                    icon: '🔀',
                                    desc: 'Rides trend pullbacks; auto-deploys Radar Fleet if market is compressing.',
                                },
                            ].map(st => (
                                <button
                                    type="button"
                                    key={st.id}
                                    onClick={() => setStrategyType(st.id)}
                                    className={`p-3 rounded-2xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                                        strategyType === st.id
                                            ? 'bg-crypto-primary/10 border-crypto-primary shadow-sm shadow-crypto-primary/20'
                                            : 'bg-crypto-bg border-crypto-border text-crypto-muted hover:border-crypto-border/80'
                                    }`}
                                >
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-base">{st.icon}</span>
                                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                                                strategyType === st.id
                                                    ? 'bg-crypto-primary text-white'
                                                    : 'bg-crypto-card text-crypto-muted'
                                            }`}>
                                                {st.badge}
                                            </span>
                                        </div>
                                        <h4 className={`text-xs font-bold ${strategyType === st.id ? 'text-crypto-primary' : 'text-crypto-heading'}`}>
                                            {st.title}
                                        </h4>
                                    </div>
                                    <p className="text-[10px] text-crypto-muted mt-1 leading-snug">
                                        {st.desc}
                                    </p>
                                </button>
                            ))}
                        </div>

                        {/* Breakout Straddle & Radar Fleet Parameters Box */}
                        {(strategyType === 'radar_fleet' || strategyType === 'breakout_straddle' || strategyType === 'adaptive_hybrid') && (
                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-3.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                                        <span>📡</span> {strategyType === 'radar_fleet' ? 'Radar Fleet Armada Controls' : 'Breakout Straddle Calibration'}
                                    </label>
                                    <span className="text-[10px] font-bold text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded">
                                        {strategyType === 'radar_fleet' ? 'Sub-Second WebSocket Monitoring' : 'Crypto Anti-Fakeout Active'}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {/* Squeeze Sensitivity Preset */}
                                    <div>
                                        <label className="text-[11px] font-semibold text-crypto-heading block mb-1">
                                            Squeeze Sensitivity / Mode
                                        </label>
                                        <select
                                            value={`${breakoutKcMultiplier}-${breakoutMaxBandwidth}`}
                                            onChange={e => {
                                                const [kc, bw] = e.target.value.split('-').map(Number);
                                                setBreakoutKcMultiplier(kc);
                                                setBreakoutMaxBandwidth(bw);
                                            }}
                                            className="w-full px-2.5 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                        >
                                            <option value="2-0.015">Balanced (KC 2.0 / BW ≤ 1.5% ★)</option>
                                            <option value="2.2-0.02">High Frequency (KC 2.2 / BW ≤ 2.0%)</option>
                                            <option value="1.8-0.01">Ultra-Tight (KC 1.8 / BW ≤ 1.0%)</option>
                                            <option value="1.5-0.008">Strict Equities (KC 1.5 / BW ≤ 0.8%)</option>
                                        </select>
                                        <span className="text-[10px] text-crypto-muted mt-0.5 block">Compression criteria</span>
                                    </div>

                                    {/* Min Squeeze Bars */}
                                    <div>
                                        <label className="text-[11px] font-semibold text-crypto-heading block mb-1">
                                            Min Squeeze Bars (5m)
                                        </label>
                                        <select
                                            value={breakoutSqueezeBars}
                                            onChange={e => setBreakoutSqueezeBars(parseInt(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                        >
                                            <option value={1}>1 Bar (Fast Trigger - 5m)</option>
                                            <option value={2}>2 Bars (Active - 10m ★)</option>
                                            <option value={3}>3 Bars (Patient - 15m)</option>
                                            <option value={4}>4 Bars (20m)</option>
                                            <option value={6}>6 Bars (30m Deep Coil)</option>
                                        </select>
                                        <span className="text-[10px] text-crypto-muted mt-0.5 block">Consecutive flat bars</span>
                                    </div>

                                    {/* RVOL Surge Threshold */}
                                    <div>
                                        <label className="text-[11px] font-semibold text-crypto-heading block mb-1">
                                            Volume Surge (RVOL)
                                        </label>
                                        <select
                                            value={breakoutRvolMin}
                                            onChange={e => setBreakoutRvolMin(parseFloat(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                        >
                                            <option value={1.1}>1.1x (Fast Scalp)</option>
                                            <option value={1.2}>1.2x (Active Scalp ★)</option>
                                            <option value={1.5}>1.5x (Moderate)</option>
                                            <option value={1.8}>1.8x (Institutional)</option>
                                            <option value={2.2}>2.2x (Ultra Strict)</option>
                                        </select>
                                        <span className="text-[10px] text-crypto-muted mt-0.5 block">Breach volume filter</span>
                                    </div>

                                    {/* Breakout Target ROI */}
                                    <div>
                                        <label className="text-[11px] font-semibold text-crypto-heading block mb-1">
                                            Breakout Target ROI
                                        </label>
                                        <select
                                            value={breakoutTargetRoiPct}
                                            onChange={e => setBreakoutTargetRoiPct(parseFloat(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                        >
                                            <option value={6}>+6% ROI (~0.30% move)</option>
                                            <option value={8}>+8% ROI (~0.40% move)</option>
                                            <option value={10}>+10% ROI (~0.50% move ★)</option>
                                            <option value={15}>+15% ROI (~0.75% move)</option>
                                        </select>
                                        <span className="text-[10px] text-crypto-muted mt-0.5 block">Fast scalp exit</span>
                                    </div>

                                    {/* Radar Fleet Size */}
                                    <div>
                                        <label className="text-[11px] font-semibold text-crypto-heading block mb-1">
                                            Armed Fleet Capacity
                                        </label>
                                        <select
                                            value={breakoutMaxArmedFleet}
                                            onChange={e => setBreakoutMaxArmedFleet(parseInt(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                        >
                                            <option value={5}>5 Coins (Conservative)</option>
                                            <option value={10}>10 Coins (Active)</option>
                                            <option value={15}>15 Coins (Recommended ★)</option>
                                            <option value={20}>20 Coins (Full Armada)</option>
                                        </select>
                                        <span className="text-[10px] text-crypto-muted mt-0.5 block">Simultaneous tripwires</span>
                                    </div>

                                    {/* Flash-Crash Throttle */}
                                    <div>
                                        <label className="text-[11px] font-semibold text-crypto-heading block mb-1">
                                            Flash-Crash Throttle
                                        </label>
                                        <select
                                            value={breakoutThrottleSeconds}
                                            onChange={e => setBreakoutThrottleSeconds(parseInt(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                        >
                                            <option value={10}>10s (Fast Scalp)</option>
                                            <option value={15}>15s (Recommended ★)</option>
                                            <option value={30}>30s (Conservative)</option>
                                        </select>
                                        <span className="text-[10px] text-crypto-muted mt-0.5 block">Spacing between entries</span>
                                    </div>

                                    {/* Min 24h Volume */}
                                    <div>
                                        <label className="text-[11px] font-semibold text-crypto-heading block mb-1">
                                            Min 24h Volume Filter
                                        </label>
                                        <select
                                            value={breakoutMin24hVolumeUSDT}
                                            onChange={e => setBreakoutMin24hVolumeUSDT(parseInt(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading text-xs font-bold"
                                        >
                                            <option value={25000}>$25,000 USDT</option>
                                            <option value={50000}>$50,000 USDT (Recommended ★)</option>
                                            <option value={100000}>$100,000 USDT (Top Tier)</option>
                                        </select>
                                        <span className="text-[10px] text-crypto-muted mt-0.5 block">Prevents slippage traps</span>
                                    </div>
                                </div>

                                <div className="text-[10px] text-crypto-muted leading-relaxed pt-1 border-t border-amber-500/20">
                                    💡 <strong>Radar Fleet Architecture:</strong> Concurrently monitors up to {breakoutMaxArmedFleet} coiled coins on real-time WebSocket ticks ($0 margin cost until breach). The moment any coin breaks out with &ge; {breakoutRvolMin}x volume surge, it fires an instant market order and disarms the opposing trigger (OCO).
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section 4: Groq AI Sentinel */}
                    <div className="space-y-3 pt-4 border-t border-crypto-border/60">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-crypto-primary">
                                    4. Groq AI Macro Sentinel
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

                    {/* Section 5: Smart Loss Guard */}
                    <div className="space-y-3 pt-4 border-t border-crypto-border/60">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-crypto-primary">
                                5. Smart Loss Guard
                            </h3>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={smartGuard}
                                    onChange={(e) => setSmartGuard(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-crypto-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
                            </label>
                        </div>
                        <div className={`p-3.5 rounded-2xl border flex items-start gap-3 transition-colors ${
                            smartGuard
                                ? 'bg-rose-500/10 border-rose-500/25'
                                : 'bg-crypto-bg border-crypto-border/80'
                        }`}>
                            <div className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                smartGuard ? 'bg-rose-500/20 text-rose-400' : 'bg-crypto-border/40 text-crypto-muted'
                            }`}>
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-black ${
                                        smartGuard ? 'text-rose-400' : 'text-crypto-heading'
                                    }`}>
                                        {smartGuard ? '🛡️ Smart Loss Guard — ACTIVE' : 'Smart Loss Guard — Disabled'}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                        smartGuard
                                            ? 'bg-rose-500/20 text-rose-300'
                                            : 'bg-crypto-border/30 text-crypto-muted'
                                    }`}>
                                        {smartGuard ? 'Auto-Rescue ON' : 'Standard SL Only'}
                                    </span>
                                </div>
                                <p className="text-[11px] text-crypto-muted leading-relaxed">
                                    Scans all open positions during every scan cycle. If an open trade experiences an unrealised loss &gt; 20% on margin (ROI &lt; -20%) and market technicals confirm a sharp trend reversal against the trade with negative momentum, the bot immediately places a limit sell/close order at the current market price to protect capital.
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
