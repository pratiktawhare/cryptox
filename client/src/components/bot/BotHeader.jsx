import React, { useState } from 'react';

export default function BotHeader({
    mode,
    onModeChange,
    isRunning,
    isScanning,
    countdownText,
    secondsLeft,
    wallet,
    onStart,
    onStop,
    onEmergencyStop,
    onScanNow,
    onOpenConfig,
    actionLoading,
    actionState,
}) {
    const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);

    return (
        <>
            <div className="bg-crypto-card/80 backdrop-blur-xl border border-crypto-border/80 rounded-2xl p-4 md:p-5 shadow-lg shadow-black/5 transition-all">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Title & Mode Switcher */}
                    <div className="flex items-center gap-3 md:gap-4 flex-wrap">
                        <div className="relative flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-tr from-crypto-primary/20 via-crypto-info/10 to-crypto-primary/5 border border-crypto-primary/30 shadow-inner shadow-crypto-primary/20">
                            <svg className="w-6 h-6 text-crypto-primary animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="10" rx="2" />
                                <circle cx="12" cy="5" r="2" />
                                <path d="M12 7v4" />
                                <line x1="8" y1="16" x2="8" y2="16" />
                                <line x1="16" y1="16" x2="16" y2="16" />
                            </svg>
                            {isRunning && (
                                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-crypto-success opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-crypto-success border-2 border-crypto-card"></span>
                                </span>
                            )}
                        </div>

                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl md:text-2xl font-black text-crypto-heading tracking-tight">
                                    Algorithmic Trading Bot
                                </h1>
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20">
                                    20x Margin Engine
                                </span>
                            </div>
                            <p className="text-xs text-crypto-muted mt-0.5">
                                Autonomous multi-symbol scanner · Regime adaptive · Groq AI fail-safe sentinel
                            </p>
                        </div>

                        {/* Mode Switcher Pill */}
                        <div className="flex items-center p-1 bg-crypto-bg border border-crypto-border rounded-xl">
                            <button
                                type="button"
                                onClick={() => onModeChange('paper')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                                    mode === 'paper'
                                        ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30 shadow-sm'
                                        : 'text-crypto-muted hover:text-crypto-heading'
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${mode === 'paper' ? 'bg-amber-500 animate-pulse' : 'bg-crypto-muted/40'}`} />
                                Paper Mode
                            </button>
                            <button
                                type="button"
                                onClick={() => onModeChange('live')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                                    mode === 'live'
                                        ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 shadow-sm'
                                        : 'text-crypto-muted hover:text-crypto-heading'
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${mode === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-crypto-muted/40'}`} />
                                Live Delta
                            </button>
                        </div>
                    </div>

                    {/* Right: Wallet Balance & Control Buttons */}
                    <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                        {/* Wallet Badge */}
                        <div
                            className="px-3.5 py-2 rounded-xl bg-crypto-bg border border-crypto-border flex items-center gap-2.5 relative group"
                            title={wallet?.error || undefined}
                        >
                            <div className={`w-7 h-7 rounded-lg bg-crypto-card flex items-center justify-center border ${
                                wallet?.error ? 'text-amber-400 border-amber-500/40' : 'text-crypto-primary border-crypto-border/60'
                            }`}>
                                {wallet?.error ? (
                                    <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                                        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                                        <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                                    </svg>
                                )}
                            </div>
                            <div>
                                <div className="text-[10px] uppercase font-bold tracking-wider text-crypto-muted flex items-center gap-1">
                                    <span>{mode === 'paper' ? 'Paper Balance' : 'Delta Wallet'}</span>
                                    {wallet?.error && (
                                        <span className="text-[9px] text-amber-400 normal-case font-medium">
                                            ({wallet.error.includes('IP not whitelisted') ? 'IP check' : 'API alert'})
                                        </span>
                                    )}
                                </div>
                                <div className="text-sm font-black text-crypto-heading tabular-nums">
                                    ${Number(wallet?.balance ?? wallet?.equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <span className="text-[10px] font-normal text-crypto-muted ml-1">USDT</span>
                                </div>
                            </div>
                        </div>

                        {/* Scan Now */}
                        <button
                            type="button"
                            disabled={!isRunning || isScanning || actionLoading}
                            onClick={onScanNow}
                            title={!isRunning ? 'Start bot first to run scans' : 'Trigger multi-symbol scan immediately'}
                            className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isScanning
                                    ? 'bg-crypto-primary/10 border-crypto-primary/30 text-crypto-primary'
                                    : 'bg-crypto-bg border-crypto-border text-crypto-heading hover:border-crypto-primary/50'
                            }`}
                        >
                            <svg className={`w-4 h-4 ${isScanning ? 'animate-spin text-crypto-primary' : 'text-crypto-muted'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            <span className="hidden sm:inline">{isScanning ? 'Scanning…' : 'Scan Now'}</span>
                        </button>

                        {/* Config */}
                        <button
                            type="button"
                            onClick={onOpenConfig}
                            title="Configure Strategy & Risk Parameters"
                            className="p-2.5 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-heading hover:border-crypto-primary/50 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                            <svg className="w-4 h-4 text-crypto-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                            <span className="hidden sm:inline">Settings</span>
                        </button>

                        {/* Running Status Badge & Next Scan Timer */}
                        {isRunning ? (
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold shadow-sm">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <span>Running</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-crypto-bg border border-crypto-border text-xs font-mono font-bold shadow-sm">
                                    <span className="text-crypto-muted font-sans font-medium text-[11px] hidden xs:inline">Next scan:</span>
                                    <span className={`tabular-nums ${isScanning || (secondsLeft != null && secondsLeft <= 10) ? 'text-crypto-primary font-black animate-pulse' : 'text-crypto-heading'}`}>
                                        {isScanning ? '⚡ Scanning…' : (countdownText ? `⏱ ${countdownText}` : 'Scheduled')}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-crypto-bg border border-crypto-border text-crypto-muted text-xs font-semibold">
                                <span className="w-2 h-2 rounded-full bg-crypto-muted/40" />
                                <span>Stopped</span>
                            </div>
                        )}

                        {/* Start / Stop Toggle with distinct Running / Starting / Stopping phases */}
                        {isRunning ? (
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={onStop}
                                className="px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 text-red-400 hover:text-red-300 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-60"
                                title="Stop the bot from scanning and trading"
                            >
                                {actionState === 'stopping' || (actionLoading && isRunning) ? (
                                    <>
                                        <svg className="w-4 h-4 animate-spin text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                        </svg>
                                        <span>Stopping Bot…</span>
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-3.5 h-3.5 fill-current text-red-400" viewBox="0 0 24 24">
                                            <rect x="5" y="5" width="14" height="14" rx="2" />
                                        </svg>
                                        <span>Stop Bot</span>
                                    </>
                                )}
                            </button>
                        ) : (
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={onStart}
                                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-crypto-primary to-crypto-primary-hover hover:from-crypto-primary-hover hover:to-crypto-primary text-white font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-crypto-primary/25 hover:shadow-crypto-primary/40 active:scale-95 disabled:opacity-60"
                                title="Start autonomous trading bot"
                            >
                                {actionState === 'starting' || (actionLoading && !isRunning) ? (
                                    <>
                                        <svg className="w-4 h-4 animate-spin text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                        </svg>
                                        <span>Starting Bot…</span>
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4 fill-current text-white" viewBox="0 0 24 24">
                                            <polygon points="5 3 19 12 5 21 5 3" />
                                        </svg>
                                        <span>Start Bot</span>
                                    </>
                                )}
                            </button>
                        )}

                        {/* Emergency Stop */}
                        <button
                            type="button"
                            onClick={() => setShowEmergencyConfirm(true)}
                            title="Emergency Stop: liquidates open positions & cancels orders"
                            className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 font-bold text-xs transition-all cursor-pointer"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="15" y1="9" x2="9" y2="15" />
                                <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Emergency Stop Confirmation Modal */}
            {showEmergencyConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-crypto-card border border-crypto-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
                        <div className="flex items-center gap-3 text-red-500">
                            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-crypto-heading">Emergency Stop ({mode.toUpperCase()})</h3>
                                <p className="text-xs text-crypto-muted">Immediate liquidation & safety shutdown</p>
                            </div>
                        </div>

                        <p className="text-xs text-crypto-text leading-relaxed">
                            This will immediately <strong className="text-red-400">cancel all active bracket orders</strong> and <strong className="text-red-400">market close any open positions</strong> in {mode} mode. The bot will be stopped.
                        </p>

                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowEmergencyConfirm(false)}
                                className="px-4 py-2 rounded-xl text-xs font-semibold text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowEmergencyConfirm(false);
                                    onEmergencyStop();
                                }}
                                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25 transition-all"
                            >
                                Yes, Liquidate & Stop
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
