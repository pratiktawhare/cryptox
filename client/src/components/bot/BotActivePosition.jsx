import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function SinglePositionCard({ trade, currentPrice, onCloseTrade, navigate }) {
    const [closing, setClosing] = useState(false);

    const handleClose = async () => {
        if (!trade || closing) return;
        setClosing(true);
        try {
            await onCloseTrade(trade.symbol);
        } finally {
            setClosing(false);
        }
    };

    const isLong = trade.direction === 'long';
    const markPrice = currentPrice || trade.markPrice || trade.entryPrice;
    const priceDiff = isLong ? (markPrice - trade.entryPrice) : (trade.entryPrice - markPrice);
    const contractVal = trade.contractValue || 1;
    const estGrossPnl = priceDiff * (trade.quantity || 0) * contractVal;
    const estExitFee = markPrice * (trade.quantity || 0) * contractVal * (0.0005 * 1.18);
    const estNetPnl = estGrossPnl - (trade.fees || 0) - estExitFee;
    const pnlPct = trade.margin > 0 ? (estNetPnl / trade.margin) * 100 : 0;
    const isWin = estNetPnl >= 0;

    // Visual Bracket Bar Math
    const sl = trade.stopLoss;
    const tp = trade.takeProfit;
    const ep = trade.entryPrice;

    // Range between SL and TP
    const totalBracketRange = Math.abs(tp - sl) || 1;
    let markPositionPct = 50;
    if (isLong) {
        markPositionPct = Math.max(0, Math.min(100, ((markPrice - sl) / totalBracketRange) * 100));
    } else {
        markPositionPct = Math.max(0, Math.min(100, ((sl - markPrice) / totalBracketRange) * 100));
    }

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-2xl p-5 md:p-6 shadow-xl relative overflow-hidden">
            {/* Subtle side glow */}
            <div className={`absolute top-0 right-0 w-48 h-48 rounded-full blur-3xl opacity-10 pointer-events-none ${
                isLong ? 'bg-emerald-500' : 'bg-rose-500'
            }`} />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-crypto-border/60">
                {/* Left: Coin, Direction, Leverage */}
                <div className="flex items-center gap-3">
                    <div className={`px-2.5 py-1 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border ${
                        isLong
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    }`}>
                        <span className={`w-2 h-2 rounded-full ${isLong ? 'bg-emerald-400' : 'bg-rose-400'} animate-pulse`} />
                        {trade.direction.toUpperCase()}
                    </div>

                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-black text-crypto-heading tracking-tight">
                                {trade.symbol.replace('USD', '/USD')}
                            </h2>
                            <span className="text-xs font-bold text-crypto-muted">
                                · {trade.leverage || 20}x Margin
                            </span>
                        </div>
                        <p className="text-[11px] text-crypto-muted">
                            Opened {new Date(trade.openedAt || trade.entryTime || trade.createdAt || Date.now()).toLocaleTimeString()} · {trade.quantity} contracts (${(trade.margin || 0).toFixed(2)} margin)
                        </p>
                    </div>
                </div>

                {/* Right: Net uPnL & Actions */}
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-right">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-crypto-muted">
                            Net Unrealized PnL
                        </div>
                        <div className={`text-xl font-black tabular-nums tracking-tight ${
                            isWin ? 'text-crypto-success' : 'text-crypto-danger'
                        }`}>
                            {isWin ? '+' : ''}${estNetPnl.toFixed(2)}
                            <span className="text-xs font-bold ml-1.5 opacity-90">
                                ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                            </span>
                        </div>
                        {pnlPct <= -20 && (
                            <div className="text-[10px] font-bold text-rose-400 mt-0.5 flex items-center justify-end gap-1">
                                <span>🛡️ Drawdown &gt; 20%</span>
                            </div>
                        )}
                        <div className={`text-xs font-bold tabular-nums mt-0.5 ${
                            isWin ? 'text-crypto-success' : 'text-crypto-danger'
                        }`}>
                            ≈ {isWin ? '+' : '-'}₹{(Math.abs(estNetPnl) * 85).toFixed(2)}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => navigate(`/?coin=${trade.symbol}`)}
                            title="Open TradingView Chart"
                            className="p-2.5 rounded-xl bg-crypto-bg border border-crypto-border hover:border-crypto-primary/40 text-crypto-heading text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                            <svg className="w-4 h-4 text-crypto-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                            </svg>
                            <span className="hidden sm:inline">Chart</span>
                        </button>

                        <button
                            type="button"
                            disabled={closing}
                            onClick={handleClose}
                            className="px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                        >
                            {closing ? (
                                <>
                                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M12 3a9 9 0 0 1 9 9" />
                                    </svg>
                                    Closing…
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                    Market Close
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Price Cards & Visual Bracket Tracker */}
            <div className="mt-5 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 bg-crypto-bg rounded-xl border border-crypto-border/60">
                        <div className="text-[10px] uppercase font-bold text-crypto-muted">Entry Price</div>
                        <div className="text-sm font-black text-crypto-heading tabular-nums mt-0.5">
                            ${Number(ep).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
                        </div>
                    </div>
                    <div className="p-3 bg-crypto-bg rounded-xl border border-crypto-border/60">
                        <div className="text-[10px] uppercase font-bold text-crypto-muted">Mark Price</div>
                        <div className="text-sm font-black text-crypto-heading tabular-nums mt-0.5">
                            ${Number(markPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
                        </div>
                    </div>
                    <div className="p-3 bg-red-500/5 rounded-xl border border-red-500/20">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-red-400">Stop Loss (SL)</span>
                            {trade.stopLossTrigger && (
                                <span className="text-[9px] font-bold text-red-400/80 font-mono">
                                    Trig: ${Number(trade.stopLossTrigger).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
                                </span>
                            )}
                        </div>
                        <div className="text-sm font-black text-red-400 tabular-nums mt-0.5">
                            ${Number(sl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
                        </div>
                    </div>
                    <div className="p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-emerald-400">Take Profit (TP)</span>
                            {trade.takeProfitTrigger && (
                                <span className="text-[9px] font-bold text-emerald-400/80 font-mono">
                                    Trig: ${Number(trade.takeProfitTrigger).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
                                </span>
                            )}
                        </div>
                        <div className="text-sm font-black text-emerald-400 tabular-nums mt-0.5">
                            ${Number(tp).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
                        </div>
                    </div>
                </div>

                {/* Interactive Visual Bracket Slider */}
                <div className="p-4 bg-crypto-bg/70 rounded-xl border border-crypto-border/60 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-red-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            Stop Loss (${Number(sl).toFixed(4)})
                        </span>
                        <span className="text-[11px] text-crypto-muted font-bold px-2 py-0.5 rounded-full bg-crypto-card border border-crypto-border">
                            Net R:R ≥ 1.50 Guaranteed
                        </span>
                        <span className="text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Take Profit (${Number(tp).toFixed(4)})
                        </span>
                    </div>

                    <div className="relative w-full h-3 bg-crypto-card rounded-full overflow-hidden border border-crypto-border shadow-inner">
                        <div
                            className={`h-full rounded-full transition-all duration-300 ${
                                markPositionPct >= 50
                                    ? 'bg-gradient-to-r from-crypto-primary to-emerald-400'
                                    : 'bg-gradient-to-r from-red-500 to-amber-400'
                            }`}
                            style={{ width: `${markPositionPct}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-crypto-muted">
                        <span>Distance to SL: {Math.abs(((markPrice - sl) / ep) * 100).toFixed(2)}%</span>
                        <span>Current: ${Number(markPrice).toFixed(4)}</span>
                        <span>Distance to TP: {Math.abs(((tp - markPrice) / ep) * 100).toFixed(2)}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function BotActivePosition({
    trades = [],
    trade = null,
    livePrices = {},
    currentPrice = null,
    isScanning = false,
    isRunning = false,
    countdownText = null,
    secondsLeft = null,
    mode = 'paper',
    onCloseTrade,
    onScanNow,
    symbolsAffordable = [],
}) {
    const navigate = useNavigate();

    const activeTrades = (Array.isArray(trades) && trades.length > 0)
        ? trades.filter(t => t && t.result === 'open')
        : (trade && trade.result === 'open' ? [trade] : []);

    if (activeTrades.length === 0) {
        // Standby / Scanning State
        return (
            <div className="bg-crypto-card/60 backdrop-blur-md border border-crypto-border/80 rounded-2xl p-6 md:p-8 text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,91,255,0.06)_0%,transparent_70%)] pointer-events-none" />

                <div className="max-w-md mx-auto relative z-10 flex flex-col items-center">
                    <div className="relative w-16 h-16 flex items-center justify-center mb-4">
                        {isRunning && (
                            <>
                                <div className="absolute inset-0 rounded-full bg-crypto-primary/10 animate-ping" />
                                <div className="absolute inset-2 rounded-full bg-crypto-primary/20 animate-pulse" />
                            </>
                        )}
                        <div className="w-12 h-12 rounded-2xl bg-crypto-bg border border-crypto-primary/30 flex items-center justify-center shadow-inner text-crypto-primary">
                            <svg className={`w-6 h-6 ${isScanning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 3a9 9 0 0 1 9 9" />
                            </svg>
                        </div>
                    </div>

                    <h3 className="text-base font-bold text-crypto-heading">
                        {isRunning ? 'Scanner Active — Standby for Optimal Setup' : 'Bot is Paused'}
                    </h3>
                    <p className="text-xs text-crypto-muted mt-1 leading-relaxed">
                        {isRunning
                            ? 'Evaluating multi-timeframe candles (5m/1m), EMA slopes, RSI momentum, and volume confirmations across affordable pairs.'
                            : `Press "Start Bot" in ${mode} mode to begin automated market scanning and bracket execution.`}
                    </p>

                    {isRunning && (
                        <div className="mt-3 flex items-center justify-center">
                            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-crypto-primary/10 border border-crypto-primary/25 text-crypto-primary text-xs font-bold font-mono shadow-sm">
                                <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-amber-400 animate-spin' : 'bg-crypto-primary animate-pulse'}`} />
                                <span className="text-crypto-muted font-sans font-medium">Next Scan in:</span>
                                <span className="tabular-nums tracking-wider text-crypto-heading font-bold">
                                    {isScanning ? '⚡ Scanning markets…' : (countdownText ? `⏱ ${countdownText}` : 'Scheduled')}
                                </span>
                            </div>
                        </div>
                    )}

                    {isRunning && symbolsAffordable.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-crypto-border/40 w-full">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-crypto-muted mb-2">
                                Affordable Coins for Sizing ({symbolsAffordable.length})
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-1.5">
                                {symbolsAffordable.slice(0, 8).map(sym => (
                                    <span
                                        key={sym}
                                        className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-crypto-bg border border-crypto-border text-crypto-heading"
                                    >
                                        {sym.replace('USD', '')}
                                    </span>
                                ))}
                                {symbolsAffordable.length > 8 && (
                                    <span className="text-[10px] text-crypto-muted">
                                        +{symbolsAffordable.length - 8} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {isRunning && (
                        <div className="mt-5 flex items-center gap-3">
                            <button
                                type="button"
                                disabled={isScanning}
                                onClick={onScanNow}
                                className="px-4 py-2 rounded-xl text-xs font-bold bg-crypto-primary/10 hover:bg-crypto-primary/20 text-crypto-primary border border-crypto-primary/20 transition-all cursor-pointer flex items-center gap-2"
                            >
                                <svg className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                </svg>
                                {isScanning ? 'Scanning Markets…' : 'Scan Markets Now'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Multiple or Single Active Positions View
    return (
        <div className="space-y-4">
            {/* Header Status Bar when trades are open */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-crypto-card/60 backdrop-blur-md p-3.5 rounded-2xl border border-crypto-border/80">
                <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <h3 className="text-sm font-black text-crypto-heading tracking-tight">
                        Active Bot Positions ({activeTrades.length})
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Live Tracking
                    </span>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                    {isRunning && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-crypto-primary/10 border border-crypto-primary/25 text-crypto-primary text-xs font-bold font-mono">
                            <span className={`w-1.5 h-1.5 rounded-full ${isScanning ? 'bg-amber-400 animate-spin' : 'bg-crypto-primary animate-pulse'}`} />
                            <span className="text-crypto-muted font-sans text-[11px] font-medium">Next Scan:</span>
                            <span className="tabular-nums tracking-wider text-crypto-heading">
                                {isScanning ? 'Scanning…' : (countdownText ? countdownText : 'Active')}
                            </span>
                        </div>
                    )}

                    {isRunning && (
                        <button
                            type="button"
                            disabled={isScanning}
                            onClick={onScanNow}
                            className="px-3 py-1 rounded-xl text-xs font-bold bg-crypto-primary/10 hover:bg-crypto-primary/20 text-crypto-primary border border-crypto-primary/20 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                            <svg className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            {isScanning ? 'Scanning…' : 'Scan More'}
                        </button>
                    )}
                </div>
            </div>

            {/* Render each active position card */}
            <div className="space-y-4">
                {activeTrades.map(t => {
                    const price = (livePrices && livePrices[t.symbol] != null)
                        ? livePrices[t.symbol]
                        : (t.symbol === trade?.symbol ? currentPrice : null);
                    return (
                        <SinglePositionCard
                            key={t._id || t.symbol}
                            trade={t}
                            currentPrice={price}
                            onCloseTrade={onCloseTrade}
                            navigate={navigate}
                        />
                    );
                })}
            </div>
        </div>
    );
}
