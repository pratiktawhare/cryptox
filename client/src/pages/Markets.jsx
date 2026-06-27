import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../services/api';
import NotificationBell from '../components/common/NotificationBell';
import MobileBottomNav from '../components/layout/MobileBottomNav';

const SOCKET_URL = import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
    : (typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : 'http://localhost:3001');

// ─── Utility helpers ──────────────────────────────────────────────────────────

function fmtPrice(n) {
    if (!n || isNaN(n)) return '—';
    if (n >= 10000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1)     return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return '$' + n.toFixed(6);
}

function fmtVolume(n) {
    if (!n || isNaN(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(2);
}

function getCoinInitials(symbol) {
    return symbol.replace('USD', '').slice(0, 3);
}

const COIN_COLORS = [
    '#f7931a', '#627eea', '#9945ff', '#00ffa3', '#e84142',
    '#2775ca', '#26a17b', '#0033ad', '#e6007a', '#16213e',
    '#f0b90b', '#00b4d8', '#8ac926', '#ff6b35', '#7209b7',
];

function coinColor(symbol) {
    let h = 0;
    for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
    return COIN_COLORS[h % COIN_COLORS.length];
}

// ─── Sparkline (mini SVG chart from last 20 candle closes) ───────────────────

function Sparkline({ data = [], isUp }) {
    if (data.length < 2) {
        return <div className="w-24 h-8 opacity-30 text-xs text-crypto-muted flex items-center">—</div>;
    }
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const w = 96, h = 32;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
            <polyline
                points={pts}
                fill="none"
                stroke={isUp ? '#10b981' : '#ef4444'}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

// ─── Category tabs ────────────────────────────────────────────────────────────

const TABS = [
    { key: 'all',     label: 'All Markets' },
    { key: 'gainers', label: '📈 Top Gainers' },
    { key: 'losers',  label: '📉 Top Losers' },
    { key: 'volume',  label: '🔥 Most Volume' },
    { key: 'watch',   label: '⭐ Watchlist' },
];

// ─── Main Markets Page ────────────────────────────────────────────────────────

const Markets = () => {
    const navigate = useNavigate();

    const [products, setProducts] = useState([]);
    const [tickers, setTickers] = useState({});     // symbol → ticker
    const [sparklines, setSparklines] = useState({}); // symbol → number[]
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState('all');
    const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'
    const [sortKey, setSortKey] = useState('volume24h');
    const [sortDir, setSortDir] = useState('desc');
    const [watchlist, setWatchlist] = useState(() => {
        try { return JSON.parse(localStorage.getItem('cx_watchlist') || '[]'); }
        catch { return []; }
    });
    const [loading, setLoading] = useState(true);

    // Refs for price flash animation
    const prevPrices = useRef({});
    const [flashing, setFlashing] = useState({});

    // ── Load products via REST on mount ────────────────────────────────────
    useEffect(() => {
        api.get('/market/products')
            .then(r => {
                setProducts(r.data.products || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    // ── Socket.IO — real-time ticker batch ─────────────────────────────────
    useEffect(() => {
        const socket = io(SOCKET_URL, { withCredentials: true });

        socket.on('product_catalog', (data) => {
            if (data.products?.length > 0) setProducts(data.products);
        });

        socket.on('market_ticker_batch', (batch) => {
            setTickers(prev => {
                const next = { ...prev, ...batch };
                // Detect price changes for flash
                const newFlash = {};
                Object.keys(batch).forEach(sym => {
                    const prevP = prev[sym]?.price;
                    const newP = batch[sym]?.price;
                    if (prevP && newP && prevP !== newP) {
                        newFlash[sym] = newP > prevP ? 'up' : 'down';
                    }
                });
                if (Object.keys(newFlash).length > 0) {
                    setFlashing(f => ({ ...f, ...newFlash }));
                    setTimeout(() => {
                        setFlashing(f => {
                            const cleared = { ...f };
                            Object.keys(newFlash).forEach(s => delete cleared[s]);
                            return cleared;
                        });
                    }, 800);
                }
                return next;
            });
        });

        // Collect closes for sparklines from individual candle updates
        socket.on('candle_update', ({ symbol, resolution, close }) => {
            if (resolution !== '1m') return;
            setSparklines(prev => {
                const arr = [...(prev[symbol] || []), close].slice(-20);
                return { ...prev, [symbol]: arr };
            });
        });

        return () => socket.disconnect();
    }, []);

    // ── Watchlist persistence ───────────────────────────────────────────────
    const toggleWatchlist = useCallback((symbol) => {
        setWatchlist(prev => {
            const next = prev.includes(symbol)
                ? prev.filter(s => s !== symbol)
                : [...prev, symbol].slice(0, 20);
            localStorage.setItem('cx_watchlist', JSON.stringify(next));
            return next;
        });
    }, []);

    // ── Sort column handler ─────────────────────────────────────────────────
    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    // ── Derived coin list ───────────────────────────────────────────────────
    const coins = useMemo(() => {
        let list = products.map(p => ({
            ...p,
            ticker: tickers[p.symbol] || null,
            price:    tickers[p.symbol]?.price    ?? null,
            change24h: tickers[p.symbol]?.change24h ?? null,
            volume24h: tickers[p.symbol]?.volume24h ?? null,
            high24h:  tickers[p.symbol]?.high24h  ?? null,
            low24h:   tickers[p.symbol]?.low24h   ?? null,
        }));

        // Filter by tab
        if (tab === 'watch') list = list.filter(c => watchlist.includes(c.symbol));
        if (tab === 'gainers') list = list.filter(c => c.change24h > 0).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, 30);
        if (tab === 'losers')  list = list.filter(c => c.change24h < 0).sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0)).slice(0, 30);
        if (tab === 'volume')  list = [...list].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 30);

        // Search
        if (search.trim()) {
            const q = search.trim().toUpperCase();
            list = list.filter(c =>
                c.symbol.includes(q) || c.description?.toUpperCase().includes(q) || c.displayName?.toUpperCase().includes(q)
            );
        }

        // Sort
        if (tab === 'all' || tab === 'watch') {
            list = [...list].sort((a, b) => {
                const av = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
                const bv = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
                return sortDir === 'asc' ? (av < bv ? -1 : 1) : (bv < av ? -1 : 1);
            });
        }

        return list;
    }, [products, tickers, tab, search, sortKey, sortDir, watchlist]);

    // ── Navigate to Dashboard chart ─────────────────────────────────────────
    const openChart = (symbol) => {
        navigate(`/?coin=${symbol}`);
    };

    // ── Sort icon helper ────────────────────────────────────────────────────
    const SortIcon = ({ col }) => (
        <span className="ml-1 opacity-60">
            {sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
    );

    return (
        <div className="min-h-screen bg-crypto-bg">
            {/* ── Header ── */}
            <div className="sticky top-0 z-20 bg-crypto-card/90 backdrop-blur-lg border-b border-crypto-border">
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
                    {/* Left: back + title */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate('/')}
                            className="p-2 rounded-lg hover:bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading transition-colors cursor-pointer"
                            title="Back to Dashboard"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <div>
                            <h1 className="text-base font-bold text-crypto-heading">Markets</h1>
                            <p className="text-xs text-crypto-muted">
                                {loading ? 'Loading…' : `${products.length} perpetual futures · Live`}
                            </p>
                        </div>
                    </div>

                    {/* Right: search + view toggle */}
                    <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                        <div className="relative flex-1 max-w-xs">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-crypto-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search coins…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-crypto-input border border-crypto-border text-crypto-heading placeholder-crypto-muted focus:outline-none focus:ring-2 focus:ring-crypto-primary/20 focus:border-crypto-primary transition-all"
                            />
                        </div>

                        {/* View toggle */}
                        <div className="flex rounded-lg border border-crypto-border overflow-hidden">
                            {['table', 'grid'].map(m => (
                                <button
                                    key={m}
                                    onClick={() => setViewMode(m)}
                                    className={`p-2 transition-colors cursor-pointer ${viewMode === m ? 'bg-crypto-primary/10 text-crypto-primary' : 'text-crypto-muted hover:text-crypto-heading'}`}
                                    title={m === 'table' ? 'Table view' : 'Grid view'}
                                >
                                    {m === 'table' ? (
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                            <path strokeLinecap="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
                                        </svg>
                                    ) : (
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                                            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                        <NotificationBell />
                    </div>
                </div>

                {/* Category tabs */}
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 flex gap-1 pb-2 overflow-x-auto no-scrollbar">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                                tab === t.key
                                    ? 'bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20'
                                    : 'text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Content ── */}
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-2 md:py-4 pb-24 md:pb-4">
                {loading ? (
                    <SkeletonTable />
                ) : coins.length === 0 ? (
                    <EmptyState tab={tab} search={search} />
                ) : viewMode === 'table' ? (
                    <TableView
                        coins={coins}
                        tickers={tickers}
                        sparklines={sparklines}
                        flashing={flashing}
                        watchlist={watchlist}
                        toggleWatchlist={toggleWatchlist}
                        openChart={openChart}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        handleSort={handleSort}
                        SortIcon={SortIcon}
                    />
                ) : (
                    <GridView
                        coins={coins}
                        sparklines={sparklines}
                        flashing={flashing}
                        watchlist={watchlist}
                        toggleWatchlist={toggleWatchlist}
                        openChart={openChart}
                    />
                )}
            </div>

            <MobileBottomNav />
        </div>
    );
};

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({ coins, sparklines, flashing, watchlist, toggleWatchlist, openChart, sortKey, handleSort, SortIcon }) {
    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-crypto-border">
                            <th className="py-2 md:py-3 px-3 md:px-4 text-left text-[10px] font-semibold text-crypto-muted hidden sm:table-cell w-8">#</th>
                            <th className="py-2 md:py-3 px-3 md:px-4 text-left text-[10px] font-semibold text-crypto-muted">
                                <button onClick={() => handleSort('symbol')} className="flex items-center cursor-pointer hover:text-crypto-heading transition-colors">
                                    Coin <SortIcon col="symbol" />
                                </button>
                            </th>
                            <th className="py-2 md:py-3 px-3 md:px-4 text-right text-[10px] font-semibold text-crypto-muted">
                                <button onClick={() => handleSort('price')} className="flex items-center ml-auto cursor-pointer hover:text-crypto-heading transition-colors">
                                    Price <SortIcon col="price" />
                                </button>
                            </th>
                            <th className="py-2 md:py-3 px-3 md:px-4 text-right text-[10px] font-semibold text-crypto-muted">
                                <button onClick={() => handleSort('change24h')} className="flex items-center ml-auto cursor-pointer hover:text-crypto-heading transition-colors">
                                    24h % <SortIcon col="change24h" />
                                </button>
                            </th>
                            <th className="py-2 md:py-3 px-3 md:px-4 text-right text-[10px] font-semibold text-crypto-muted hidden md:table-cell">
                                <button onClick={() => handleSort('volume24h')} className="flex items-center ml-auto cursor-pointer hover:text-crypto-heading transition-colors">
                                    Volume <SortIcon col="volume24h" />
                                </button>
                            </th>
                            <th className="py-2 md:py-3 px-3 md:px-4 text-right text-[10px] font-semibold text-crypto-muted hidden lg:table-cell">
                                24h Range
                            </th>
                            <th className="py-2 md:py-3 px-3 md:px-4 text-right text-[10px] font-semibold text-crypto-muted hidden sm:table-cell">
                                7d
                            </th>
                            <th className="py-2 md:py-3 px-2 md:px-4 w-8 md:w-10" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-crypto-border/50">
                        {coins.map((coin, i) => {
                            const isUp = (coin.change24h ?? 0) >= 0;
                            const flash = flashing[coin.symbol];
                            const isWatched = watchlist.includes(coin.symbol);

                            return (
                                <tr
                                    key={coin.symbol}
                                    className={`hover:bg-crypto-bg-subtle/50 transition-colors group cursor-pointer ${
                                        flash === 'up' ? 'bg-crypto-success/5' : flash === 'down' ? 'bg-crypto-danger/5' : ''
                                    }`}
                                    onClick={() => openChart(coin.symbol)}
                                >
                                    <td className="py-2 md:py-3 px-3 md:px-4 text-xs text-crypto-muted hidden sm:table-cell">{i + 1}</td>

                                    {/* Coin identity */}
                                    <td className="py-2 md:py-3 px-3 md:px-4">
                                        <div className="flex items-center gap-2 md:gap-3">
                                            <div
                                                className="w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-white text-[10px] md:text-xs font-bold flex-shrink-0"
                                                style={{ background: coinColor(coin.symbol) }}
                                            >
                                                {getCoinInitials(coin.symbol)}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-semibold text-crypto-heading text-xs md:text-sm truncate">{coin.displayName || coin.symbol.replace('USD','')}</div>
                                                <div className="text-[10px] text-crypto-muted hidden sm:block">{coin.symbol}</div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Price */}
                                    <td className="py-2 md:py-3 px-3 md:px-4 text-right">
                                        <span className={`font-bold tabular-nums text-xs md:text-sm transition-colors ${
                                            flash === 'up' ? 'text-crypto-success' :
                                            flash === 'down' ? 'text-crypto-danger' : 'text-crypto-heading'
                                        }`}>
                                            {fmtPrice(coin.price)}
                                        </span>
                                    </td>

                                    {/* 24h change */}
                                    <td className="py-2 md:py-3 px-3 md:px-4 text-right">
                                        {coin.change24h !== null ? (
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] md:text-xs font-semibold tabular-nums ${
                                                isUp ? 'bg-crypto-success/10 text-crypto-success' : 'bg-crypto-danger/10 text-crypto-danger'
                                            }`}>
                                                {isUp ? '▲' : '▼'} {Math.abs(coin.change24h).toFixed(2)}%
                                            </span>
                                        ) : <span className="text-crypto-muted">—</span>}
                                    </td>

                                    {/* Volume */}
                                    <td className="py-2 md:py-3 px-3 md:px-4 text-right text-crypto-muted tabular-nums text-xs hidden md:table-cell">
                                        {fmtVolume(coin.volume24h)}
                                    </td>

                                    {/* 24h range */}
                                    <td className="py-2 md:py-3 px-3 md:px-4 hidden lg:table-cell">
                                        {coin.price && coin.low24h && coin.high24h ? (
                                            <div className="flex flex-col items-end gap-1">
                                                <div className="relative w-20 h-1.5 bg-crypto-border rounded-full overflow-hidden">
                                                    <div
                                                        className="absolute inset-y-0 left-0 bg-crypto-primary/60 rounded-full"
                                                        style={{
                                                            width: `${Math.min(100, ((coin.price - coin.low24h) / (coin.high24h - coin.low24h || 1)) * 100)}%`
                                                        }}
                                                    />
                                                </div>
                                                <div className="text-[10px] text-crypto-muted tabular-nums">
                                                    {fmtPrice(coin.low24h)} – {fmtPrice(coin.high24h)}
                                                </div>
                                            </div>
                                        ) : <span className="text-crypto-muted text-xs">—</span>}
                                    </td>

                                    {/* Sparkline */}
                                    <td className="py-2 md:py-3 px-3 md:px-4 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                                        <Sparkline data={sparklines[coin.symbol] || []} isUp={isUp} />
                                    </td>

                                    {/* Star / Watchlist */}
                                    <td className="py-2 md:py-3 px-2 md:px-4" onClick={e => { e.stopPropagation(); toggleWatchlist(coin.symbol); }}>
                                        <button className={`p-1 rounded-lg transition-colors cursor-pointer ${
                                            isWatched ? 'text-yellow-400' : 'text-crypto-muted opacity-0 group-hover:opacity-100 hover:text-yellow-400'
                                        }`} title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}>
                                            <svg className="w-3.5 h-3.5" fill={isWatched ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─── Grid View ────────────────────────────────────────────────────────────────

function GridView({ coins, sparklines, flashing, watchlist, toggleWatchlist, openChart }) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-4">
            {coins.map((coin) => {
                const isUp = (coin.change24h ?? 0) >= 0;
                const flash = flashing[coin.symbol];
                const isWatched = watchlist.includes(coin.symbol);

                return (
                    <div
                        key={coin.symbol}
                        onClick={() => openChart(coin.symbol)}
                        className={`bg-crypto-card border border-crypto-border rounded-xl p-3 md:p-4 cursor-pointer hover:border-crypto-primary/40 hover:shadow-lg transition-all duration-200 group relative ${
                            flash === 'up' ? 'border-crypto-success/30' : flash === 'down' ? 'border-crypto-danger/30' : ''
                        }`}
                    >
                        {/* Star */}
                        <button
                            onClick={e => { e.stopPropagation(); toggleWatchlist(coin.symbol); }}
                            className={`absolute top-2.5 right-2.5 p-0.5 rounded cursor-pointer transition-colors ${
                                isWatched ? 'text-yellow-400' : 'text-crypto-muted opacity-0 group-hover:opacity-100 hover:text-yellow-400'
                            }`}
                        >
                            <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill={isWatched ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        </button>

                        {/* Header */}
                        <div className="flex items-center gap-1.5 md:gap-2.5 mb-2 md:mb-3">
                            <div
                                className="w-7 h-7 md:w-9 md:h-9 rounded-full flex items-center justify-center text-white text-[10px] md:text-xs font-bold flex-shrink-0"
                                style={{ background: coinColor(coin.symbol) }}
                            >
                                {getCoinInitials(coin.symbol)}
                            </div>
                            <div className="min-w-0">
                                <div className="font-semibold text-crypto-heading text-xs md:text-sm truncate">{coin.displayName || coin.symbol.replace('USD','')}</div>
                                <div className="text-[10px] md:text-xs text-crypto-muted truncate">{coin.symbol}</div>
                            </div>
                        </div>

                        {/* Price */}
                        <div className={`text-base md:text-xl font-bold tabular-nums mb-1 transition-colors ${
                            flash === 'up' ? 'text-crypto-success' :
                            flash === 'down' ? 'text-crypto-danger' : 'text-crypto-heading'
                        }`}>
                            {fmtPrice(coin.price)}
                        </div>

                        {/* Change badge */}
                        {coin.change24h !== null && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] md:text-xs font-semibold mb-2 md:mb-3 tabular-nums ${
                                isUp ? 'bg-crypto-success/10 text-crypto-success' : 'bg-crypto-danger/10 text-crypto-danger'
                            }`}>
                                {isUp ? '▲' : '▼'} {Math.abs(coin.change24h).toFixed(2)}%
                            </span>
                        )}

                        {/* Sparkline */}
                        <div className="mt-1">
                            <Sparkline data={sparklines[coin.symbol] || []} isUp={isUp} />
                        </div>

                        {/* Volume */}
                        <div className="text-[10px] md:text-xs text-crypto-muted mt-1.5 md:mt-2">
                            Vol: {fmtVolume(coin.volume24h)}
                        </div>

                        {/* Hover overlay */}
                        <div className="absolute inset-0 rounded-xl bg-crypto-primary/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-[10px] md:text-xs font-semibold text-crypto-primary bg-crypto-card/90 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border border-crypto-primary/20">
                                View Chart →
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Empty / Loading states ───────────────────────────────────────────────────

function EmptyState({ tab, search }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-crypto-primary/10 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-crypto-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                </svg>
            </div>
            <h3 className="text-base font-semibold text-crypto-heading mb-1">
                {search ? `No results for "${search}"` : tab === 'watch' ? 'No watchlist coins yet' : 'No coins found'}
            </h3>
            <p className="text-sm text-crypto-muted max-w-xs">
                {search ? 'Try a different search term.' : tab === 'watch' ? 'Star any coin to add it to your watchlist.' : 'Waiting for market data from Delta Exchange.'}
            </p>
        </div>
    );
}

function SkeletonTable() {
    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden">
            {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-crypto-border/50 last:border-0">
                    <div className="w-8 h-8 rounded-full bg-crypto-border animate-pulse" />
                    <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 bg-crypto-border rounded animate-pulse w-24" />
                        <div className="h-3 bg-crypto-border rounded animate-pulse w-16" />
                    </div>
                    <div className="h-4 bg-crypto-border rounded animate-pulse w-20" />
                    <div className="h-5 bg-crypto-border rounded animate-pulse w-14" />
                </div>
            ))}
        </div>
    );
}

export default Markets;
