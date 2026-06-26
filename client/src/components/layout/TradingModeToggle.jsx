/**
 * TradingModeToggle.jsx
 *
 * Premium LIVE / PAPER mode switcher for the header.
 * Shows a confirmation dialog when switching to LIVE mode.
 */

import React, { useState } from 'react';
import { useTradingMode } from '../../context/TradingModeContext';

export default function TradingModeToggle() {
    const { mode, isLive, isPaper, setMode, loading } = useTradingMode();
    const [confirming, setConfirming] = useState(false);

    if (loading) {
        return <div className="w-28 h-8 bg-crypto-border animate-pulse rounded-full" />;
    }

    const handleClick = () => {
        if (isPaper) {
            // Switching to LIVE — show confirmation
            setConfirming(true);
        } else {
            // Switching to PAPER — instant, safe
            setMode('paper');
        }
    };

    return (
        <>
            {/* Toggle Pill */}
            <button
                onClick={handleClick}
                title={isLive ? 'Switch to Paper Trading (safe)' : 'Switch to Live Trading'}
                className={`
                    relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold
                    border transition-all duration-300 cursor-pointer select-none
                    ${isLive
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                        : 'bg-crypto-primary/10 border-crypto-primary/30 text-crypto-primary hover:bg-crypto-primary/20'
                    }
                `}
            >
                {/* Animated dot */}
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive ? 'bg-emerald-400 animate-live-dot' : 'bg-crypto-primary'}`} />

                {isLive ? (
                    <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                        </svg>
                        LIVE
                    </>
                ) : (
                    <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
                        </svg>
                        PAPER
                    </>
                )}
            </button>

            {/* Confirmation Modal — only shown when switching PAPER → LIVE */}
            {confirming && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
                    <div className="w-full max-w-sm mx-4 bg-crypto-card border border-emerald-500/30 rounded-2xl overflow-hidden shadow-2xl"
                         style={{ boxShadow: '0 0 60px #10b98120' }}>
                        {/* Accent */}
                        <div className="h-1 bg-gradient-to-r from-emerald-600 to-emerald-400" />

                        <div className="p-6">
                            {/* Warning icon */}
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                                </svg>
                            </div>

                            <h2 className="text-base font-bold text-crypto-heading text-center mb-1">Switch to LIVE Trading?</h2>
                            <p className="text-sm text-crypto-muted text-center mb-5 leading-relaxed">
                                Real money will be used for all trades. Make sure your Delta Exchange API key has <strong className="text-crypto-heading">read + write</strong> permissions and your account is funded.
                            </p>

                            {/* Checklist */}
                            <div className="space-y-2 mb-5">
                                {[
                                    'API key with trade permissions is set',
                                    'Account has sufficient USDT margin',
                                    'You understand the risks involved',
                                ].map(item => (
                                    <div key={item} className="flex items-center gap-2 text-xs text-crypto-muted">
                                        <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                        {item}
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setConfirming(false)}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-crypto-muted bg-crypto-input border border-crypto-border hover:text-crypto-heading transition-all cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => { setMode('live'); setConfirming(false); }}
                                    className="flex-[2] py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_20px_#10b98130] transition-all cursor-pointer"
                                >
                                    Go Live ⚡
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
