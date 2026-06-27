import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useTradingMode } from '../../context/TradingModeContext';

const PortfolioSummary = () => {
    const { isPaper } = useTradingMode();
    const navigate = useNavigate();

    // Live mode state
    const [balances,  setBalances]  = useState([]);
    const [positions, setPositions] = useState([]);

    // Paper mode state
    const [paperWallet,    setPaperWallet]    = useState(null);
    const [paperPositions, setPaperPositions] = useState([]);

    const [loading, setLoading] = useState(true);
    const [noKey,   setNoKey]   = useState(false);

    const fetchData = useCallback(async () => {
        try {
            if (isPaper) {
                const [walletRes, posRes] = await Promise.all([
                    api.get('/paper/wallet'),
                    api.get('/paper/positions'),
                ]);
                setPaperWallet(walletRes.data.wallet);
                setPaperPositions(posRes.data.positions || []);
            } else {
                const [balRes, posRes] = await Promise.all([
                    api.get('/profile/portfolio/balances'),
                    api.get('/profile/portfolio/positions'),
                ]);
                setBalances(balRes.data.balances || []);
                setPositions(posRes.data.positions || []);
                setNoKey(!!(balRes.data.noKey || posRes.data.noKey));
            }
        } catch (err) {
            console.warn('Portfolio fetch error:', err.message);
        } finally {
            setLoading(false);
        }
    }, [isPaper]);

    useEffect(() => {
        setLoading(true);
        fetchData();
        const iv = setInterval(fetchData, 30000);
        return () => clearInterval(iv);
    }, [fetchData]);

    // ── Loading skeleton ──────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                {[1, 2, 3].map(i => (
                    <div key={i} className="bg-crypto-card border border-crypto-border rounded-xl p-3 md:p-5">
                        <div className="h-2.5 w-16 bg-crypto-border rounded animate-pulse mb-2.5" />
                        <div className="h-6 w-20 bg-crypto-border rounded animate-pulse" />
                    </div>
                ))}
            </div>
        );
    }

    // ── Paper mode ────────────────────────────────────────────────────────────
    if (isPaper) {
        const w = paperWallet || { balance: 0, available: 0, used: 0, equity: 0, totalRealised: 0, totalTrades: 0, returnPct: 0, winRate: 0, maxDrawdown: 0 };

        const totalUnrealised = paperPositions.reduce((sum, pos) => sum + parseFloat(pos.unrealisedPnl || 0), 0);
        const liveEquity = w.balance + totalUnrealised;
        const overallPnl = liveEquity - (w.startingBalance || 10000);
        const liveReturnPct = w.startingBalance > 0 ? (overallPnl / w.startingBalance) * 100 : 0;

        const statCards = [
            {
                label: 'Paper Equity',
                value: `$${liveEquity.toFixed(2)}`,
                sub: `Started at $${(w.startingBalance || 10000).toFixed(0)} · PnL: ${overallPnl >= 0 ? '+' : ''}$${overallPnl.toFixed(2)}`,
                color: 'text-crypto-heading',
                icon: '📄',
            },
            {
                label: 'Available Margin',
                value: `$${(w.available || 0).toFixed(2)}`,
                sub: `Locked: $${(w.used || 0).toFixed(2)}`,
                color: 'text-crypto-success',
                icon: '✅',
            },
            {
                label: 'Total Return',
                value: `${liveReturnPct >= 0 ? '+' : ''}${liveReturnPct.toFixed(2)}%`,
                sub: `Win rate: ${(w.winRate || 0).toFixed(1)}% · ${w.totalTrades || 0} trades`,
                color: overallPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
                icon: overallPnl >= 0 ? '📈' : '📉',
            },
        ];

        return (
            <div className="space-y-3 md:space-y-5 animate-fade-in">
                {/* Paper mode banner */}
                <div className="flex items-center gap-2 bg-crypto-primary/8 border border-crypto-primary/20 rounded-xl px-3 py-2 text-xs text-crypto-primary">
                    <span>📄</span>
                    <span className="leading-snug"><strong>Paper Mode</strong> — Simulated trades, no real money.</span>
                    <button
                        onClick={() => navigate('/positions')}
                        className="ml-auto text-crypto-primary/80 hover:text-crypto-primary underline underline-offset-2 cursor-pointer shrink-0 whitespace-nowrap"
                    >
                        Positions →
                    </button>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                    {statCards.map(card => (
                        <div key={card.label} className="bg-crypto-card border border-crypto-border rounded-xl p-3 md:p-5 hover:border-crypto-primary/20 transition-colors">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] md:text-xs font-medium text-crypto-muted uppercase tracking-wider">{card.label}</span>
                                <span className="text-sm md:text-lg">{card.icon}</span>
                            </div>
                            <p className={`text-lg md:text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
                            <p className="text-[10px] text-crypto-muted mt-1 leading-snug">{card.sub}</p>
                        </div>
                    ))}
                </div>

                {/* Open paper positions */}
                {paperPositions.length > 0 && (
                    <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-crypto-border flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-crypto-heading">Open Positions ({paperPositions.length})</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-[10px] text-crypto-muted uppercase tracking-wider">
                                        <th className="text-left px-3 md:px-5 py-2 md:py-3 font-medium">Symbol</th>
                                        <th className="text-right px-3 md:px-5 py-2 md:py-3 font-medium">Side</th>
                                        <th className="text-right px-3 md:px-5 py-2 md:py-3 font-medium hidden sm:table-cell">Entry</th>
                                        <th className="text-right px-3 md:px-5 py-2 md:py-3 font-medium">PnL</th>
                                        <th className="text-right px-3 md:px-5 py-2 md:py-3 font-medium hidden sm:table-cell">ROE</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-crypto-border/50">
                                    {paperPositions.map(p => {
                                        const pnl = parseFloat(p.unrealisedPnl || 0);
                                        const roe = parseFloat(p.roe || 0);
                                        return (
                                            <tr key={p._id} className="hover:bg-crypto-card-hover transition-colors">
                                                <td className="px-3 md:px-5 py-2 md:py-3 font-semibold text-crypto-heading text-xs md:text-sm">{p.symbol.replace('USD','')}</td>
                                                <td className={`px-3 md:px-5 py-2 md:py-3 text-right font-bold text-xs ${p.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {p.side === 'buy' ? '▲' : '▼'} <span className="hidden sm:inline">{p.side === 'buy' ? 'Long' : 'Short'}</span>
                                                </td>
                                                <td className="px-3 md:px-5 py-2 md:py-3 text-right tabular-nums text-xs hidden sm:table-cell">${parseFloat(p.entryPrice).toFixed(2)}</td>
                                                <td className={`px-3 md:px-5 py-2 md:py-3 text-right font-semibold tabular-nums text-xs md:text-sm ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                                </td>
                                                <td className={`px-3 md:px-5 py-2 md:py-3 text-right font-semibold tabular-nums text-xs hidden sm:table-cell ${roe >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {roe >= 0 ? '+' : ''}{roe.toFixed(1)}%
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Empty state */}
                {paperPositions.length === 0 && (
                    <div className="bg-crypto-card border border-crypto-border rounded-xl p-6 md:p-10 text-center">
                        <div className="text-3xl mb-2">📄</div>
                        <h3 className="text-sm font-semibold text-crypto-heading mb-1">No open paper positions</h3>
                        <p className="text-xs text-crypto-muted">Go to AI Signals and hit Execute to place a simulated trade.</p>
                    </div>
                )}
            </div>
        );
    }

    // ── Live mode ─────────────────────────────────────────────────────────────
    if (noKey) {
        return (
            <div className="bg-crypto-card border border-crypto-border rounded-xl p-6 md:p-10 text-center animate-fade-in">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-crypto-primary/10 mb-3">
                    <svg className="w-7 h-7 text-crypto-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                    </svg>
                </div>
                <h3 className="text-sm font-semibold text-crypto-heading mb-1">No API Key Configured</h3>
                <p className="text-xs text-crypto-muted mb-4 max-w-xs mx-auto">
                    Add your Delta Exchange API key in Settings to see live balances and positions.
                </p>
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={() => {/* handled by nav */}}
                        className="px-4 py-2 bg-crypto-primary/10 border border-crypto-primary/20 text-crypto-primary text-xs font-semibold rounded-lg hover:bg-crypto-primary/20 transition-all cursor-pointer"
                    >
                        ← Use Paper Mode instead
                    </button>
                </div>
            </div>
        );
    }

    // Live mode with data
    // Delta Exchange returns asset_symbol as 'USD' (not 'USDT')
    const usdBalance = balances.find(b => b.asset_symbol === 'USDT' || b.asset_symbol === 'USD')
        || { balance: '0', available_balance: '0' };
    const total      = parseFloat(usdBalance.balance       || 0);
    const available  = parseFloat(usdBalance.available_balance || 0);
    const marginUsed = Math.max(0, total - available);

    // All non-zero non-USD balances (other coins)
    const otherBalances = balances.filter(b =>
        b.asset_symbol !== 'USDT' && b.asset_symbol !== 'USD' && parseFloat(b.balance) > 0
    );

    const statCards = [
        {
            label: 'Total Equity',
            value: `$${total.toFixed(2)}`,
            sub: usdBalance.asset_symbol || 'USD',
            color: 'text-crypto-heading',
            icon: '💰'
        },
        {
            label: 'Available Margin',
            value: `$${available.toFixed(2)}`,
            sub: 'Free to trade',
            color: 'text-emerald-400',
            icon: '✅'
        },
        {
            label: 'Margin Used',
            value: `$${marginUsed.toFixed(2)}`,
            sub: `${positions.length} open position${positions.length !== 1 ? 's' : ''}`,
            color: marginUsed > 0 ? 'text-amber-400' : 'text-crypto-muted',
            icon: '🔒'
        },
    ];

    return (
        <div className="space-y-3 md:space-y-5 animate-fade-in">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                {statCards.map(card => (
                    <div key={card.label} className="bg-crypto-card border border-crypto-border rounded-xl p-3 md:p-5 hover:border-crypto-primary/20 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] md:text-xs font-medium text-crypto-muted uppercase tracking-wider">{card.label}</span>
                            <span className="text-sm md:text-lg">{card.icon}</span>
                        </div>
                        <p className={`text-lg md:text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
                        <p className="text-[10px] text-crypto-muted mt-1">{card.sub}</p>
                    </div>
                ))}
            </div>

            {positions.length > 0 && (
                <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-crypto-border">
                        <h3 className="text-sm font-semibold text-crypto-heading">Open Positions</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[10px] text-crypto-muted uppercase tracking-wider">
                                    <th className="text-left px-3 md:px-5 py-2 md:py-3 font-medium">Symbol</th>
                                    <th className="text-right px-3 md:px-5 py-2 md:py-3 font-medium hidden sm:table-cell">Size</th>
                                    <th className="text-right px-3 md:px-5 py-2 md:py-3 font-medium hidden sm:table-cell">Entry</th>
                                    <th className="text-right px-3 md:px-5 py-2 md:py-3 font-medium">PnL</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-crypto-border/50">
                                {positions.map(p => {
                                    const pnl = parseFloat(p.unrealized_pnl);
                                    return (
                                        <tr key={p.id} className="hover:bg-crypto-card-hover transition-colors">
                                            <td className="px-3 md:px-5 py-2 md:py-3 font-semibold text-crypto-heading text-xs md:text-sm">{p.product_symbol}</td>
                                            <td className="px-3 md:px-5 py-2 md:py-3 text-right tabular-nums text-xs hidden sm:table-cell">{p.size}</td>
                                            <td className="px-3 md:px-5 py-2 md:py-3 text-right tabular-nums text-xs hidden sm:table-cell">${parseFloat(p.entry_price).toFixed(2)}</td>
                                            <td className={`px-3 md:px-5 py-2 md:py-3 text-right font-semibold tabular-nums text-xs md:text-sm ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PortfolioSummary;
