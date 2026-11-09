import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../context/ThemeContext';
import { useTradingMode } from '../context/TradingModeContext';
import ThemeToggle from '../components/layout/ThemeToggle';
import TradingModeToggle from '../components/layout/TradingModeToggle';
import NotificationBell from '../components/common/NotificationBell';
import MobileBottomNav from '../components/layout/MobileBottomNav';
import Button from '../components/common/Button';
import { playSound } from '../utils/soundAlert';

const TIMEFRAMES = [
    { value: '4h', label: '4 Hours (Recommended)', short: '4H', badge: '★ Default' },
    { value: '1h', label: '1 Hour', short: '1H' },
    { value: '15m', label: '15 Minutes', short: '15m' },
    { value: '1d', label: '1 Day', short: '1D' },
];

const SCAN_INTERVALS = [
    { value: 'manual', label: 'Manual Only (No Auto-Scan)' },
    { value: '15m', label: 'Every 15 Minutes' },
    { value: '30m', label: 'Every 30 Minutes' },
    { value: '1h', label: 'Every 1 Hour' },
    { value: '4h', label: 'Every 4 Hours (Candle Close)' },
];

const UniversalScanner = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { isPaper } = useTradingMode();
    const { socket } = useSocket();

    // Configuration & State
    const [timeframe, setTimeframe] = useState('4h');
    const [scanInterval, setScanInterval] = useState('1h');
    const [triggerDiffPct, setTriggerDiffPct] = useState(0.10);
    const [autoTradeMode, setAutoTradeMode] = useState('off'); // 'off' | 'paper' | 'live'
    const [maxLeverage, setMaxLeverage] = useState(3);
    const [tradeAllocation, setTradeAllocation] = useState(100);

    // Scanner execution state
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null);
    const [scanResults, setScanResults] = useState(null);
    const [lastScanTime, setLastScanTime] = useState(null);
    const [nextScanTime, setNextScanTime] = useState(null);

    // Filtering & Search
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'fresh_bullish' | 'fresh_bearish' | 'approaching' | 'favorites'
    const [sortBy, setSortBy] = useState('freshness'); // 'freshness' | 'spread' | 'volume' | 'symbol'
    const [favorites, setFavorites] = useState(new Set(['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD']));

    // Quick Trade Modal State
    const [tradeModalOpen, setTradeModalOpen] = useState(false);
    const [selectedCoin, setSelectedCoin] = useState(null);
    const [tradeSide, setTradeSide] = useState('buy');
    const [tradeSize, setTradeSize] = useState(1);
    const [tradeLeverage, setTradeLeverage] = useState(3);
    const [tradeStopLoss, setTradeStopLoss] = useState('');
    const [tradeTarget, setTradeTarget] = useState('');
    const [tradeExecuting, setTradeExecuting] = useState(false);
    const [tradeMessage, setTradeMessage] = useState(null);

    // ── Load Configuration on Mount ──
    useEffect(() => {
        loadConfig();
        loadCachedResults();
    }, []);

    const loadConfig = async () => {
        try {
            const res = await api.get('/scanner/config');
            if (res.data?.preferences) {
                const p = res.data.preferences;
                if (p.timeframe) setTimeframe(p.timeframe);
                if (p.interval) setScanInterval(p.interval);
                if (p.triggerDiffPct != null) setTriggerDiffPct(p.triggerDiffPct);
                if (p.autoTradeMode) setAutoTradeMode(p.autoTradeMode);
                if (p.maxLeverage) setMaxLeverage(p.maxLeverage);
                if (p.tradeAllocationUsdt) setTradeAllocation(p.tradeAllocationUsdt);
                if (p.favoriteCoins?.length) setFavorites(new Set(p.favoriteCoins));
            }
            if (res.data?.scheduler) {
                const s = res.data.scheduler;
                setIsScanning(s.isScanning || false);
                if (s.lastScanTime) setLastScanTime(s.lastScanTime);
                if (s.nextRunTimestamp) setNextScanTime(s.nextRunTimestamp);
            }
        } catch (err) {
            console.error('Error loading scanner config:', err);
        }
    };

    const loadCachedResults = async () => {
        try {
            const res = await api.get('/scanner/results');
            if (res.data?.result) {
                setScanResults(res.data.result);
                if (res.data.lastScanTime) setLastScanTime(res.data.lastScanTime);
            }
        } catch (err) {
            console.error('Error loading cached results:', err);
        }
    };

    // ── Socket.IO Event Listeners ──
    useEffect(() => {
        if (!socket) return;

        const handleProgress = (progress) => {
            setIsScanning(true);
            setScanProgress(progress);
        };

        const handleResults = (results) => {
            setIsScanning(false);
            setScanProgress(null);
            setScanResults(results);
            setLastScanTime(Date.now());
            // Play success chime if fresh crosses found
            if ((results?.freshBullish?.length || 0) + (results?.freshBearish?.length || 0) > 0) {
                playSound('signal_high');
            }
        };

        const handleConfigUpdated = (sched) => {
            if (sched?.interval) setScanInterval(sched.interval);
            if (sched?.nextRunTimestamp) setNextScanTime(sched.nextRunTimestamp);
        };

        socket.on('mc_scanner_progress', handleProgress);
        socket.on('mc_scanner_results', handleResults);
        socket.on('mc_scanner_config_updated', handleConfigUpdated);

        return () => {
            socket.off('mc_scanner_progress', handleProgress);
            socket.off('mc_scanner_results', handleResults);
            socket.off('mc_scanner_config_updated', handleConfigUpdated);
        };
    }, [socket]);

    // ── Trigger Manual Scan ──
    const handleRunScan = async () => {
        if (isScanning) return;
        setIsScanning(true);
        setScanProgress({ percent: 5, processed: 10, total: 194 });

        try {
            const res = await api.post('/scanner/run', {
                timeframe,
                triggerDiffPct,
                fastPeriod: 14,
                slowPeriod: 50,
            });
            if (res.data) {
                setScanResults(res.data);
                setLastScanTime(Date.now());
                if ((res.data.freshBullish?.length || 0) + (res.data.freshBearish?.length || 0) > 0) {
                    playSound('signal_high');
                }
            }
        } catch (err) {
            console.error('Scan error:', err);
        } finally {
            setIsScanning(false);
            setScanProgress(null);
        }
    };

    // ── Save Config Changes ──
    const handleSaveConfig = async (updates) => {
        try {
            const res = await api.patch('/scanner/config', updates);
            if (res.data?.preferences) {
                // Config synced
            }
        } catch (err) {
            console.error('Config save error:', err);
        }
    };

    const handleTimeframeChange = (tf) => {
        setTimeframe(tf);
        handleSaveConfig({ timeframe: tf });
    };

    const handleIntervalChange = (val) => {
        setScanInterval(val);
        handleSaveConfig({ interval: val });
    };

    const handleTriggerDiffChange = (val) => {
        const num = parseFloat(val);
        setTriggerDiffPct(num);
        handleSaveConfig({ triggerDiffPct: num });
    };

    const toggleFavorite = (sym) => {
        setFavorites((prev) => {
            const next = new Set(prev);
            if (next.has(sym)) next.delete(sym);
            else next.add(sym);
            handleSaveConfig({ favoriteCoins: Array.from(next) });
            return next;
        });
    };

    // ── Open Quick Trade Modal ──
    const handleOpenTradeModal = (coin) => {
        setSelectedCoin(coin);
        const isBull = coin.status.includes('BULLISH');
        setTradeSide(isBull ? 'buy' : 'sell');
        setTradeLeverage(maxLeverage);

        // Pre-fill size based on allocation
        const lev = maxLeverage || 3;
        const marginPerContract = coin.price / lev;
        const calcSize = Math.max(1, Math.floor(tradeAllocation / marginPerContract));
        setTradeSize(calcSize);

        // Pre-fill SL & TP
        if (coin.suggestedTrade) {
            setTradeStopLoss(coin.suggestedTrade.stopLoss || '');
            setTradeTarget(coin.suggestedTrade.target1 || '');
        } else {
            setTradeStopLoss(coin.slowValue ? coin.slowValue.toFixed(4) : '');
            setTradeTarget('');
        }

        setTradeMessage(null);
        setTradeModalOpen(true);
    };

    // ── Execute Trade from Modal ──
    const handleExecuteTrade = async () => {
        if (!selectedCoin) return;
        setTradeExecuting(true);
        setTradeMessage(null);

        try {
            const res = await api.post('/scanner/trade', {
                symbol: selectedCoin.symbol,
                side: tradeSide,
                mode: isPaper ? 'paper' : 'live',
                size: tradeSize,
                leverage: tradeLeverage,
                price: selectedCoin.price,
                stopLoss: tradeStopLoss,
                takeProfit: tradeTarget,
            });

            if (res.data?.success) {
                setTradeMessage({
                    type: 'success',
                    text: `✅ ${res.data.mode.toUpperCase()} Order Filled: ${tradeSide.toUpperCase()} ${tradeSize} ${selectedCoin.symbol}!`,
                });
                playSound('target_hit');
                setTimeout(() => {
                    setTradeModalOpen(false);
                    setTradeMessage(null);
                }, 1800);
            }
        } catch (err) {
            setTradeMessage({
                type: 'error',
                text: err.response?.data?.error || err.message,
            });
            playSound('stoploss_hit');
        } finally {
            setTradeExecuting(false);
        }
    };

    // ── Filtered and Sorted Coins List ──
    const filteredCoins = useMemo(() => {
        if (!scanResults?.all) return [];

        let list = [...scanResults.all];

        // Status Filter
        if (activeFilter === 'fresh_bullish') {
            list = list.filter((c) => c.status === 'FRESH_BULLISH_CROSS');
        } else if (activeFilter === 'fresh_bearish') {
            list = list.filter((c) => c.status === 'FRESH_BEARISH_CROSS');
        } else if (activeFilter === 'approaching') {
            list = list.filter((c) => c.status === 'SQUEEZE_APPROACHING');
        } else if (activeFilter === 'favorites') {
            list = list.filter((c) => favorites.has(c.symbol));
        }

        // Search Query Filter
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter((c) => c.symbol.toLowerCase().includes(q) || c.displayName?.toLowerCase().includes(q));
        }

        // Sorting
        if (sortBy === 'spread') {
            list.sort((a, b) => b.absSpreadPct - a.absSpreadPct);
        } else if (sortBy === 'volume') {
            list.sort((a, b) => (b.avgVolUsdt || 0) - (a.avgVolUsdt || 0));
        } else if (sortBy === 'symbol') {
            list.sort((a, b) => a.symbol.localeCompare(b.symbol));
        }

        return list;
    }, [scanResults, activeFilter, searchQuery, sortBy, favorites]);

    return (
        <div className="min-h-screen bg-crypto-bg text-crypto-text pb-20">
            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-30 bg-crypto-card/85 backdrop-blur-xl border-b border-crypto-border">
                <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="p-2 rounded-xl text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg transition-colors cursor-pointer"
                            title="Return to Dashboard"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-2">
                            <span className="text-base font-black text-crypto-heading tracking-tight">CryptoX</span>
                            <span className="text-crypto-border">/</span>
                            <span className="text-sm font-bold text-crypto-accent flex items-center gap-1.5">
                                <svg className="w-4 h-4 text-crypto-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 6v6l4 2" />
                                </svg>
                                MCdynamic Scanner
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-crypto-accent/15 text-crypto-accent border border-crypto-accent/25">
                                4H Primary
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3">
                        {/* Quick links */}
                        <button
                            type="button"
                            onClick={() => navigate('/markets')}
                            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-heading transition-colors"
                        >
                            All Markets
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/signals')}
                            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-heading transition-colors"
                        >
                            AI Signals
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/bot')}
                            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-heading transition-colors"
                        >
                            Auto Bot
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/positions')}
                            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-heading transition-colors"
                        >
                            Positions
                        </button>

                        <TradingModeToggle />
                        <ThemeToggle />
                        <NotificationBell />
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
                {/* 1. Hero Controls & Scanner Banner */}
                <div className="glass rounded-2xl p-5 md:p-6 border border-crypto-border relative overflow-hidden shadow-xl">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-crypto-accent/10 to-transparent pointer-events-none rounded-full blur-3xl -mr-20 -mt-20" />

                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2.5">
                                <h1 className="text-xl md:text-2xl font-black text-crypto-heading tracking-tight">
                                    MCdynamic Universal Market Scanner
                                </h1>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20">
                                    MC14 × MC50 Crossover
                                </span>
                            </div>
                            <p className="text-xs md:text-sm text-crypto-muted max-w-2xl leading-relaxed">
                                Evaluates every perpetual future on Delta Exchange (194+ coins) using John McGinley's self-adjusting
                                volatility dynamic formula. Detects high-probability trend turning points without moving-average lag.
                            </p>
                        </div>

                        {/* Primary Action Button */}
                        <div className="flex items-center gap-3">
                            <Button
                                onClick={handleRunScan}
                                disabled={isScanning}
                                className="w-full sm:w-auto px-6 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-crypto-accent to-crypto-primary text-black shadow-lg shadow-crypto-accent/25 hover:shadow-crypto-accent/40 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
                            >
                                {isScanning ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4 text-black" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Scanning 194 Coins ({scanProgress?.percent || 0}%)…
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                        </svg>
                                        Scan All 194 Coins Now
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Progress Bar (Visible while scanning) */}
                    {isScanning && (
                        <div className="mt-4 pt-4 border-t border-crypto-border space-y-1.5">
                            <div className="flex justify-between text-xs font-semibold text-crypto-muted">
                                <span>Scanning batches in parallel… ({scanProgress?.processed || 0} of {scanProgress?.total || 194} coins)</span>
                                <span className="text-crypto-accent font-bold">{scanProgress?.percent || 0}%</span>
                            </div>
                            <div className="w-full h-2 bg-crypto-bg rounded-full overflow-hidden border border-crypto-border">
                                <div
                                    className="h-full bg-gradient-to-r from-crypto-accent to-crypto-primary rounded-full transition-all duration-300"
                                    style={{ width: `${scanProgress?.percent || 5}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* 2. Interactive Controls Grid */}
                    <div className="mt-5 pt-5 border-t border-crypto-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                        {/* Timeframe Control */}
                        <div className="space-y-1.5">
                            <label className="text-crypto-heading font-bold flex items-center gap-1.5">
                                Timeframe (Manual)
                            </label>
                            <div className="grid grid-cols-4 gap-1 p-1 bg-crypto-bg rounded-xl border border-crypto-border">
                                {TIMEFRAMES.map((tf) => (
                                    <button
                                        key={tf.value}
                                        type="button"
                                        onClick={() => handleTimeframeChange(tf.value)}
                                        className={`py-1.5 text-center font-bold rounded-lg transition-all cursor-pointer ${
                                            timeframe === tf.value
                                                ? 'bg-crypto-accent text-black shadow-md'
                                                : 'text-crypto-muted hover:text-crypto-heading hover:bg-crypto-card'
                                        }`}
                                    >
                                        {tf.short}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Recurring Scan Interval */}
                        <div className="space-y-1.5">
                            <label className="text-crypto-heading font-bold flex items-center justify-between">
                                <span>Auto-Scan Interval</span>
                                {nextScanTime && scanInterval !== 'manual' && (
                                    <span className="text-[10px] text-crypto-accent">
                                        Next in {Math.max(1, Math.round((nextScanTime - Date.now()) / 60000))}m
                                    </span>
                                )}
                            </label>
                            <select
                                value={scanInterval}
                                onChange={(e) => handleIntervalChange(e.target.value)}
                                className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2 text-xs font-semibold text-crypto-heading focus:outline-none focus:border-crypto-accent cursor-pointer"
                            >
                                {SCAN_INTERVALS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Trigger Difference / Buffer */}
                        <div className="space-y-1.5">
                            <label className="text-crypto-heading font-bold flex items-center justify-between">
                                <span>Trigger Difference Buffer</span>
                                <span className="text-crypto-accent font-mono font-bold">
                                    {(triggerDiffPct || 0.1).toFixed(2)}%
                                </span>
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="range"
                                    min="0.02"
                                    max="0.50"
                                    step="0.01"
                                    value={triggerDiffPct}
                                    onChange={(e) => handleTriggerDiffChange(e.target.value)}
                                    className="w-full h-1.5 bg-crypto-bg rounded-lg appearance-none cursor-pointer accent-crypto-accent"
                                />
                            </div>
                            <p className="text-[10px] text-crypto-muted truncate">
                                Spread required to confirm crossover (filters whipsaws)
                            </p>
                        </div>

                        {/* Auto-Trading Mode */}
                        <div className="space-y-1.5">
                            <label className="text-crypto-heading font-bold flex items-center justify-between">
                                <span>Auto-Trade Mode</span>
                                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                                    autoTradeMode === 'off' ? 'bg-crypto-muted/15 text-crypto-muted' : 'bg-crypto-success/15 text-crypto-success'
                                }`}>
                                    {autoTradeMode}
                                </span>
                            </label>
                            <div className="grid grid-cols-3 gap-1 p-1 bg-crypto-bg rounded-xl border border-crypto-border">
                                {['off', 'paper', 'live'].map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => {
                                            setAutoTradeMode(mode);
                                            handleSaveConfig({ autoTradeMode: mode });
                                        }}
                                        className={`py-1.5 text-center font-bold rounded-lg transition-all uppercase text-[10px] cursor-pointer ${
                                            autoTradeMode === mode
                                                ? mode === 'live'
                                                    ? 'bg-crypto-danger text-white'
                                                    : mode === 'paper'
                                                    ? 'bg-crypto-primary text-black'
                                                    : 'bg-crypto-muted text-black'
                                                : 'text-crypto-muted hover:text-crypto-heading'
                                        }`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Metadata Footer */}
                    {lastScanTime && (
                        <div className="mt-4 pt-3 border-t border-crypto-border/50 flex flex-wrap items-center justify-between text-[11px] text-crypto-muted gap-2">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-crypto-success animate-pulse" />
                                <span>
                                    Last completed scan: <strong className="text-crypto-heading">{new Date(lastScanTime).toLocaleTimeString()}</strong>
                                </span>
                                <span>•</span>
                                <span>
                                    Analyzed <strong className="text-crypto-heading">{scanResults?.summary?.totalAnalyzed || 0}</strong> coins in{' '}
                                    <strong className="text-crypto-heading">{scanResults?.summary?.durationSeconds || '0'}s</strong>
                                </span>
                            </div>
                            <span className="text-crypto-muted">
                                Fast Period: <strong>MC14</strong> | Slow Period: <strong>MC50</strong> | TF: <strong>{timeframe.toUpperCase()}</strong>
                            </span>
                        </div>
                    )}
                </div>

                {/* 2. Quick Filter Status Counters */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <button
                        type="button"
                        onClick={() => setActiveFilter('fresh_bullish')}
                        className={`glass p-4 rounded-xl border text-left transition-all cursor-pointer ${
                            activeFilter === 'fresh_bullish'
                                ? 'border-crypto-success bg-crypto-success/10 shadow-lg shadow-crypto-success/10'
                                : 'border-crypto-border hover:border-crypto-success/40'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-crypto-success flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-crypto-success animate-ping" />
                                Fresh Bull Cross
                            </span>
                            <span className="text-lg font-black text-crypto-heading">
                                {scanResults?.summary?.counts?.freshBullish || 0}
                            </span>
                        </div>
                        <p className="text-[10px] text-crypto-muted mt-1">Crossed in last 1-2 bars</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter('fresh_bearish')}
                        className={`glass p-4 rounded-xl border text-left transition-all cursor-pointer ${
                            activeFilter === 'fresh_bearish'
                                ? 'border-crypto-danger bg-crypto-danger/10 shadow-lg shadow-crypto-danger/10'
                                : 'border-crypto-border hover:border-crypto-danger/40'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-crypto-danger flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-crypto-danger animate-ping" />
                                Fresh Bear Cross
                            </span>
                            <span className="text-lg font-black text-crypto-heading">
                                {scanResults?.summary?.counts?.freshBearish || 0}
                            </span>
                        </div>
                        <p className="text-[10px] text-crypto-muted mt-1">Crossed in last 1-2 bars</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter('approaching')}
                        className={`glass p-4 rounded-xl border text-left transition-all cursor-pointer ${
                            activeFilter === 'approaching'
                                ? 'border-amber-400 bg-amber-400/10 shadow-lg shadow-amber-400/10'
                                : 'border-crypto-border hover:border-amber-400/40'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-400">🟡 Squeeze / Pre-Cross</span>
                            <span className="text-lg font-black text-crypto-heading">
                                {scanResults?.summary?.counts?.approaching || 0}
                            </span>
                        </div>
                        <p className="text-[10px] text-crypto-muted mt-1">Spread &lt; 0.15% (breakout impending)</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter('favorites')}
                        className={`glass p-4 rounded-xl border text-left transition-all cursor-pointer ${
                            activeFilter === 'favorites'
                                ? 'border-crypto-accent bg-crypto-accent/10 shadow-lg shadow-crypto-accent/10'
                                : 'border-crypto-border hover:border-crypto-accent/40'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-crypto-accent">★ My Watchlist</span>
                            <span className="text-lg font-black text-crypto-heading">{favorites.size}</span>
                        </div>
                        <p className="text-[10px] text-crypto-muted mt-1">Starred coins</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter('all')}
                        className={`glass p-4 rounded-xl border text-left transition-all cursor-pointer ${
                            activeFilter === 'all'
                                ? 'border-crypto-primary bg-crypto-primary/10 shadow-lg shadow-crypto-primary/10'
                                : 'border-crypto-border hover:border-crypto-primary/40'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-crypto-heading">All Scanned</span>
                            <span className="text-lg font-black text-crypto-heading">
                                {scanResults?.summary?.totalAnalyzed || 0}
                            </span>
                        </div>
                        <p className="text-[10px] text-crypto-muted mt-1">Total coins tracked</p>
                    </button>
                </div>

                {/* 3. Search & Sort Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                        <svg className="w-4 h-4 text-crypto-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Filter by symbol (e.g. BTC, SOL, XRP)…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-crypto-card border border-crypto-border rounded-xl pl-9 pr-3 py-2 text-xs text-crypto-heading placeholder:text-crypto-muted focus:outline-none focus:border-crypto-accent"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-crypto-muted hover:text-crypto-heading text-xs"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-crypto-muted font-semibold">Sort by:</span>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="bg-crypto-card border border-crypto-border rounded-xl px-3 py-2 text-xs font-semibold text-crypto-heading focus:outline-none focus:border-crypto-accent cursor-pointer"
                        >
                            <option value="freshness">Freshness / Signal Priority</option>
                            <option value="spread">Largest MC Spread %</option>
                            <option value="volume">Trading Volume USDT</option>
                            <option value="symbol">Coin Name (A-Z)</option>
                        </select>
                    </div>
                </div>

                {/* 4. Results Table */}
                <div className="glass rounded-2xl border border-crypto-border overflow-hidden shadow-lg">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="border-b border-crypto-border bg-crypto-bg/60 text-crypto-muted font-bold text-[11px] uppercase tracking-wider">
                                    <th className="py-3 px-4 w-12 text-center">★</th>
                                    <th className="py-3 px-4">Coin</th>
                                    <th className="py-3 px-4">Price</th>
                                    <th className="py-3 px-4">MCdynamic Status</th>
                                    <th className="py-3 px-4">MC14 (Fast)</th>
                                    <th className="py-3 px-4">MC50 (Slow)</th>
                                    <th className="py-3 px-4">Spread %</th>
                                    <th className="py-3 px-4">Crossover Age</th>
                                    <th className="py-3 px-4">24h Vol</th>
                                    <th className="py-3 px-4 text-right">Quick Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-crypto-border/50">
                                {filteredCoins.length === 0 ? (
                                    <tr>
                                        <td colSpan="10" className="py-12 text-center text-crypto-muted">
                                            {isScanning ? (
                                                <div className="flex flex-col items-center gap-2">
                                                    <svg className="animate-spin w-6 h-6 text-crypto-accent" viewBox="0 0 24 24" fill="none">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                    </svg>
                                                    <p className="font-semibold">Analyzing market candles across 194 coins…</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    <p className="text-sm font-semibold text-crypto-heading">No coins match the active filter</p>
                                                    <p className="text-xs">Click "Scan All 194 Coins Now" above or reset your search.</p>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredCoins.map((coin) => {
                                        const isFreshBull = coin.status === 'FRESH_BULLISH_CROSS';
                                        const isFreshBear = coin.status === 'FRESH_BEARISH_CROSS';
                                        const isSqueeze = coin.status === 'SQUEEZE_APPROACHING';
                                        const isBullTrend = coin.status === 'BULLISH_EXPANSION';
                                        const isFav = favorites.has(coin.symbol);

                                        return (
                                            <tr
                                                key={coin.symbol}
                                                className={`transition-colors hover:bg-crypto-card/60 ${
                                                    isFreshBull
                                                        ? 'bg-crypto-success/5 font-semibold'
                                                        : isFreshBear
                                                        ? 'bg-crypto-danger/5 font-semibold'
                                                        : isSqueeze
                                                        ? 'bg-amber-400/5'
                                                        : ''
                                                }`}
                                            >
                                                {/* Favorite Star */}
                                                <td className="py-3 px-4 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleFavorite(coin.symbol)}
                                                        className={`text-base cursor-pointer hover:scale-125 transition-transform ${
                                                            isFav ? 'text-amber-400' : 'text-crypto-muted/40 hover:text-amber-400'
                                                        }`}
                                                    >
                                                        ★
                                                    </button>
                                                </td>

                                                {/* Coin Name */}
                                                <td className="py-3 px-4 font-bold text-crypto-heading">
                                                    <div
                                                        onClick={() => navigate(`/?coin=${coin.symbol}`)}
                                                        className="cursor-pointer group flex items-center gap-1.5"
                                                        title="Click to view interactive chart on Dashboard"
                                                    >
                                                        <span className="group-hover:text-crypto-accent group-hover:underline">
                                                            {coin.displayName || coin.symbol}
                                                        </span>
                                                        <svg className="w-3 h-3 text-crypto-muted opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                                        </svg>
                                                    </div>
                                                </td>

                                                {/* Price */}
                                                <td className="py-3 px-4 font-mono font-bold text-crypto-heading">
                                                    ${coin.price != null ? coin.price.toLocaleString() : 'N/A'}
                                                </td>

                                                {/* Status Badge */}
                                                <td className="py-3 px-4">
                                                    {isFreshBull && (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-black bg-crypto-success/15 text-crypto-success border border-crypto-success/30 animate-pulse">
                                                            🟢 Fresh Bull Cross
                                                        </span>
                                                    )}
                                                    {isFreshBear && (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-black bg-crypto-danger/15 text-crypto-danger border border-crypto-danger/30 animate-pulse">
                                                            🔴 Fresh Bear Cross
                                                        </span>
                                                    )}
                                                    {isSqueeze && (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-400/15 text-amber-400 border border-amber-400/30">
                                                            🟡 Pre-Cross Squeeze
                                                        </span>
                                                    )}
                                                    {isBullTrend && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-crypto-success">
                                                            📈 Bullish Trend
                                                        </span>
                                                    )}
                                                    {!isFreshBull && !isFreshBear && !isSqueeze && !isBullTrend && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-crypto-danger">
                                                            📉 Bearish Trend
                                                        </span>
                                                    )}
                                                </td>

                                                {/* MC14 */}
                                                <td className="py-3 px-4 font-mono text-crypto-heading">
                                                    ${coin.fastValue != null ? coin.fastValue.toFixed(4) : 'N/A'}
                                                </td>

                                                {/* MC50 */}
                                                <td className="py-3 px-4 font-mono text-crypto-muted">
                                                    ${coin.slowValue != null ? coin.slowValue.toFixed(4) : 'N/A'}
                                                </td>

                                                {/* Spread % */}
                                                <td className="py-3 px-4 font-mono font-bold">
                                                    <span className={coin.spreadPct > 0 ? 'text-crypto-success' : 'text-crypto-danger'}>
                                                        {coin.spreadPct > 0 ? '+' : ''}{coin.spreadPct}%
                                                    </span>
                                                </td>

                                                {/* Crossover Age */}
                                                <td className="py-3 px-4 text-crypto-muted font-medium">
                                                    {coin.barsSinceCross === 0
                                                        ? '⚡ Current bar'
                                                        : coin.barsSinceCross === 1
                                                        ? '1 candle ago'
                                                        : `${coin.barsSinceCross} candles ago`}
                                                </td>

                                                {/* 24h Volume */}
                                                <td className="py-3 px-4 font-mono text-crypto-muted">
                                                    ${coin.avgVolUsdt ? (coin.avgVolUsdt > 1000 ? `${(coin.avgVolUsdt / 1000).toFixed(0)}k` : coin.avgVolUsdt.toFixed(0)) : 'N/A'}
                                                </td>

                                                {/* Action */}
                                                <td className="py-3 px-4 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenTradeModal(coin)}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm ${
                                                            isFreshBull || isBullTrend
                                                                ? 'bg-crypto-success/15 hover:bg-crypto-success text-crypto-success hover:text-black border border-crypto-success/30'
                                                                : 'bg-crypto-danger/15 hover:bg-crypto-danger text-crypto-danger hover:text-white border border-crypto-danger/30'
                                                        }`}
                                                    >
                                                        {isFreshBull ? '⚡ Long Now' : isFreshBear ? '⚡ Short Now' : 'Trade'}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>

            {/* Quick Trade Dialog Modal */}
            {tradeModalOpen && selectedCoin && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
                    <div className="glass rounded-2xl p-6 border border-crypto-border max-w-md w-full space-y-5 shadow-2xl relative">
                        <div className="flex items-center justify-between border-b border-crypto-border pb-3">
                            <div className="flex items-center gap-2">
                                <span className={`w-3 h-3 rounded-full ${tradeSide === 'buy' ? 'bg-crypto-success' : 'bg-crypto-danger'}`} />
                                <h3 className="text-base font-black text-crypto-heading">
                                    Execute {tradeSide.toUpperCase()} Trade: {selectedCoin.symbol}
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setTradeModalOpen(false)}
                                className="text-crypto-muted hover:text-crypto-heading text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Trade Mode Banner */}
                        <div className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-between ${
                            isPaper
                                ? 'bg-crypto-primary/10 border-crypto-primary/25 text-crypto-primary'
                                : 'bg-crypto-danger/10 border-crypto-danger/25 text-crypto-danger'
                        }`}>
                            <span>Mode: {isPaper ? '📄 Paper Trading Simulator' : '⚡ Live Delta Exchange Order'}</span>
                            <span className="uppercase text-[10px] underline cursor-pointer" onClick={() => navigate('/settings')}>
                                Switch Mode
                            </span>
                        </div>

                        {/* Order Inputs */}
                        <div className="space-y-4 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-crypto-muted block mb-1">Direction</label>
                                    <div className="grid grid-cols-2 gap-1 bg-crypto-bg p-1 rounded-xl border border-crypto-border font-bold">
                                        <button
                                            type="button"
                                            onClick={() => setTradeSide('buy')}
                                            className={`py-1.5 rounded-lg text-center ${
                                                tradeSide === 'buy' ? 'bg-crypto-success text-black' : 'text-crypto-muted'
                                            }`}
                                        >
                                            BUY / LONG
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setTradeSide('sell')}
                                            className={`py-1.5 rounded-lg text-center ${
                                                tradeSide === 'sell' ? 'bg-crypto-danger text-white' : 'text-crypto-muted'
                                            }`}
                                        >
                                            SELL / SHORT
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-crypto-muted block mb-1">Contracts Qty</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={tradeSize}
                                        onChange={(e) => setTradeSize(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2 font-mono font-bold text-crypto-heading"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-crypto-muted block mb-1">Entry Price (Market)</label>
                                    <input
                                        type="text"
                                        disabled
                                        value={`$${selectedCoin.price}`}
                                        className="w-full bg-crypto-bg/50 border border-crypto-border/50 rounded-xl px-3 py-2 font-mono text-crypto-muted cursor-not-allowed"
                                    />
                                </div>
                                <div>
                                    <label className="text-crypto-muted block mb-1">Leverage</label>
                                    <select
                                        value={tradeLeverage}
                                        onChange={(e) => setTradeLeverage(parseInt(e.target.value))}
                                        className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2 font-bold text-crypto-heading cursor-pointer"
                                    >
                                        {[1, 2, 3, 5, 10].map((l) => (
                                            <option key={l} value={l}>
                                                {l}× Leverage
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-crypto-muted block mb-1">
                                        Stop Loss (MC50 Trailing)
                                    </label>
                                    <input
                                        type="text"
                                        value={tradeStopLoss}
                                        onChange={(e) => setTradeStopLoss(e.target.value)}
                                        placeholder="Dynamic Stop Loss"
                                        className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2 font-mono font-bold text-crypto-danger"
                                    />
                                </div>
                                <div>
                                    <label className="text-crypto-muted block mb-1">Target 1 (1:2.0 R:R)</label>
                                    <input
                                        type="text"
                                        value={tradeTarget}
                                        onChange={(e) => setTradeTarget(e.target.value)}
                                        placeholder="Take Profit Target"
                                        className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2 font-mono font-bold text-crypto-success"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Feedback message */}
                        {tradeMessage && (
                            <div className={`p-2.5 rounded-xl text-xs font-semibold ${
                                tradeMessage.type === 'success'
                                    ? 'bg-crypto-success/15 text-crypto-success border border-crypto-success/30'
                                    : 'bg-crypto-danger/15 text-crypto-danger border border-crypto-danger/30'
                            }`}>
                                {tradeMessage.text}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex items-center gap-3 pt-2">
                            <Button
                                onClick={() => setTradeModalOpen(false)}
                                className="w-1/3 bg-crypto-bg hover:bg-crypto-card text-crypto-muted py-2.5 rounded-xl font-bold text-xs"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleExecuteTrade}
                                disabled={tradeExecuting}
                                className={`w-2/3 py-2.5 rounded-xl font-black text-xs cursor-pointer shadow-lg transition-transform active:scale-95 ${
                                    tradeSide === 'buy'
                                        ? 'bg-crypto-success text-black hover:bg-crypto-success/90'
                                        : 'bg-crypto-danger text-white hover:bg-crypto-danger/90'
                                }`}
                            >
                                {tradeExecuting ? 'Submitting…' : `Confirm ${tradeSide.toUpperCase()} ${tradeSize} Contracts`}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <MobileBottomNav />
        </div>
    );
};

export default UniversalScanner;
