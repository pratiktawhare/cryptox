import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import ThemeToggle from '../components/layout/ThemeToggle';
import TradingModeToggle from '../components/layout/TradingModeToggle';
import NotificationBell from '../components/common/NotificationBell';
import PortfolioSummary from '../components/dashboard/PortfolioSummary';
import TradingChart from '../components/dashboard/TradingChart';
import ApiKeyManager from '../components/profile/ApiKeyManager';
import AiPreferencesManager from '../components/profile/AiPreferencesManager';
import Button from '../components/common/Button';
import TradeConfirmDialog from '../components/trading/TradeConfirmDialog';

// ── Nav items ──
const NAV_ITEMS = [
    {
        key: 'portfolio',
        label: 'Portfolio',
        icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
        ),
    },
    {
        key: 'market',
        label: 'Live Market',
        icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
        ),
    },
    {
        key: 'settings',
        label: 'Settings',
        icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        ),
    },
];

const SOCKET_URL = import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
    : (typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : 'http://localhost:3001');

const Dashboard = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user, logout } = useAuth();
    const { theme } = useTheme();
    const [activeTab, setActiveTab] = useState('portfolio');
    const [livePrices, setLivePrices] = useState({});
    const [socketInstance, setSocketInstance] = useState(null);
    const [wsConnected, setWsConnected] = useState(false);

    // Read ?coin= from URL (navigated from Markets page)
    const urlCoin = searchParams.get('coin');
    const [selectedSymbol, setSelectedSymbol] = useState(urlCoin || 'BTCUSD');
    const [tradeOpen, setTradeOpen] = useState(false);

    // When URL coin changes (e.g. user navigated from Markets), switch to market tab + coin
    useEffect(() => {
        if (urlCoin) {
            setSelectedSymbol(urlCoin);
            setActiveTab('market');
        }
    }, [urlCoin]);

    // ── Socket connection ──
    useEffect(() => {
        const socket = io(SOCKET_URL, { withCredentials: true, reconnectionAttempts: 10 });

        socket.on('connect', () => {
            setSocketInstance(socket);
            setWsConnected(true);
        });

        socket.on('disconnect', () => setWsConnected(false));

        socket.on('ticker', (data) => {
            setLivePrices((prev) => ({ ...prev, [data.symbol]: data }));
        });

        // Also receive batch updates
        socket.on('market_ticker_batch', (batch) => {
            setLivePrices((prev) => ({ ...prev, ...batch }));
        });

        return () => socket.disconnect();
    }, []);

    // Sorted tickers (show only coins that have live prices)
    const tickers = useMemo(() => Object.values(livePrices), [livePrices]);

    return (
        <div className="min-h-screen bg-crypto-bg">
            {/* ── Top bar ── */}
            <header className="sticky top-0 z-30 bg-crypto-card/80 backdrop-blur-lg border-b border-crypto-border">
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
                    {/* Left */}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-crypto-primary/10 flex items-center justify-center">
                                <svg className="w-4 h-4 text-crypto-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                                    <polyline points="16 7 22 7 22 13" />
                                </svg>
                            </div>
                            <span className="text-base font-bold text-crypto-heading tracking-tight">CryptoX</span>
                        </div>
                        <div className="h-5 w-px bg-crypto-border hidden md:block" />

                        {/* Nav */}
                        <nav className="hidden md:flex items-center gap-1">
                            {NAV_ITEMS.map((item) => (
                                <button
                                    key={item.key}
                                    onClick={() => setActiveTab(item.key)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                                        activeTab === item.key
                                            ? 'bg-crypto-primary/10 text-crypto-primary'
                                            : 'text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle'
                                    }`}
                                >
                                    {item.icon}
                                    {item.label}
                                </button>
                            ))}

                            {/* Markets link — navigates to /markets page */}
                            <button
                                onClick={() => navigate('/markets')}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle transition-all duration-200 cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                                </svg>
                                All Markets
                            </button>

                            {/* AI Signals link */}
                            <button
                                onClick={() => navigate('/signals')}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle transition-all duration-200 cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                </svg>
                                AI Signals
                            </button>

                            {/* Positions link */}
                            <button
                                onClick={() => navigate('/positions')}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle transition-all duration-200 cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                                </svg>
                                Positions
                            </button>

                            {/* Analytics link */}
                            <button
                                onClick={() => navigate('/analytics')}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle transition-all duration-200 cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                                </svg>
                                Analytics
                            </button>
                        </nav>
                    </div>

                    {/* Right */}
                    <div className="flex items-center gap-3">
                        {/* WebSocket status */}
                        <div className="hidden sm:flex items-center gap-1.5 text-xs text-crypto-muted">
                            <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-crypto-success animate-live-dot' : 'bg-crypto-danger'}`} />
                            {wsConnected ? 'Live' : 'Offline'}
                        </div>

                        <div className="h-5 w-px bg-crypto-border" />

                        {/* LIVE / PAPER toggle */}
                        <TradingModeToggle />

                        <div className="h-5 w-px bg-crypto-border" />

                        {/* Notification Bell */}
                        <NotificationBell />

                        <div className="h-5 w-px bg-crypto-border" />

                        <span className="text-xs text-crypto-muted hidden sm:block">
                            {user?.displayName || user?.username}
                        </span>

                        <ThemeToggle />

                        <Button variant="ghost" size="sm" onClick={logout}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                            </svg>
                        </Button>
                    </div>
                </div>

                {/* Mobile nav */}
                <div className="md:hidden flex border-t border-crypto-border">
                    {NAV_ITEMS.map((item) => (
                        <button
                            key={item.key}
                            onClick={() => setActiveTab(item.key)}
                            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors cursor-pointer ${
                                activeTab === item.key ? 'text-crypto-primary' : 'text-crypto-muted'
                            }`}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}
                    <button
                        onClick={() => navigate('/markets')}
                        className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-crypto-muted cursor-pointer"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                        </svg>
                        Markets
                    </button>
                </div>
            </header>

            {/* ── Content ── */}
            <main className="max-w-[1440px] mx-auto px-4 md:px-6 py-6">
                {/* Portfolio tab */}
                {activeTab === 'portfolio' && <PortfolioSummary />}

                {/* Settings tab */}
                {activeTab === 'settings' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <ApiKeyManager />
                        <AiPreferencesManager />
                    </div>
                )}

                {/* Market tab */}
                {activeTab === 'market' && (
                    <div className="space-y-5">
                        {/* Quick coin selector */}
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {tickers.slice(0, 8).map((t) => {
                                const isSelected = selectedSymbol === t.symbol;
                                const isUp = (t.change24h ?? 0) >= 0;
                                return (
                                    <button
                                        key={t.symbol}
                                        onClick={() => setSelectedSymbol(t.symbol)}
                                        className={`flex-shrink-0 bg-crypto-card border rounded-xl px-3 py-2.5 text-left transition-all duration-200 cursor-pointer min-w-[110px] ${
                                            isSelected
                                                ? 'border-crypto-primary ring-1 ring-crypto-primary/20 shadow-md'
                                                : 'border-crypto-border hover:border-crypto-primary/30'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-crypto-heading">{t.symbol.replace('USD', '')}</span>
                                            <span className={`text-[10px] font-semibold ${isUp ? 'text-crypto-success' : 'text-crypto-danger'}`}>
                                                {isUp ? '+' : ''}{t.change24h?.toFixed(2)}%
                                            </span>
                                        </div>
                                        <div className="text-sm font-bold text-crypto-heading tabular-nums">
                                            ${t.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </div>
                                    </button>
                                );
                            })}

                            {/* View all markets button */}
                            <button
                                onClick={() => navigate('/markets')}
                                className="flex-shrink-0 bg-crypto-card border border-dashed border-crypto-border rounded-xl px-4 py-2.5 text-crypto-muted hover:text-crypto-primary hover:border-crypto-primary/40 transition-all cursor-pointer min-w-[100px] flex flex-col items-center justify-center gap-1"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
                                </svg>
                                <span className="text-[10px] font-medium">All Markets</span>
                            </button>
                        </div>

                        {/* Chart */}
                        {socketInstance ? (
                            <TradingChart
                                symbol={selectedSymbol}
                                socket={socketInstance}
                                isDarkMode={theme === 'dark'}
                                onNewOrder={(sym) => {
                                    setSelectedSymbol(sym);
                                    setTradeOpen(true);
                                }}
                            />
                        ) : (
                            <div className="bg-crypto-card border border-crypto-border rounded-xl h-[460px] flex items-center justify-center">
                                <div className="flex flex-col items-center gap-3 text-crypto-muted">
                                    <svg className="animate-spin h-6 w-6 text-crypto-primary" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    <span className="text-sm">Connecting to data stream…</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            <TradeConfirmDialog
                open={tradeOpen}
                onClose={() => setTradeOpen(false)}
                symbol={selectedSymbol}
                onSuccess={() => {}}
            />
        </div>
    );
};

export default Dashboard;
