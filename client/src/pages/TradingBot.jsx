import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTradingMode } from '../context/TradingModeContext';
import { useSocket } from '../context/SocketContext';

import BotHeader from '../components/bot/BotHeader';
import BotStatsCards from '../components/bot/BotStatsCards';
import BotActivePosition from '../components/bot/BotActivePosition';
import BotEquityChart from '../components/bot/BotEquityChart';
import BotConfigModal from '../components/bot/BotConfigModal';
import BotAuditTabs from '../components/bot/BotAuditTabs';
import NotificationBell from '../components/common/NotificationBell';
import MobileBottomNav from '../components/layout/MobileBottomNav';

export default function TradingBot() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { mode: globalMode, setMode: setGlobalMode } = useTradingMode();
    const { socket, connected: socketConnected } = useSocket();

    // Active mode in this tab
    const [mode, setMode] = useState(globalMode || 'paper');

    // Bot data state
    const [statusData, setStatusData] = useState(null);
    const [walletData, setWalletData] = useState(null);
    const [trades, setTrades] = useState([]);
    const [signals, setSignals] = useState([]);
    const [events, setEvents] = useState([]);
    const [performance, setPerformance] = useState(null);
    const [livePrices, setLivePrices] = useState({});

    // UI state
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [conflictModalOpen, setConflictModalOpen] = useState(false);
    const [conflictMessage, setConflictMessage] = useState('');

    // Keep global mode in sync
    const handleModeChange = useCallback((newMode) => {
        setMode(newMode);
        setWalletData(null);
        setGlobalMode(newMode);
    }, [setGlobalMode]);

    // Keep local mode in sync when global mode changes externally
    useEffect(() => {
        if (globalMode && globalMode !== mode) {
            setMode(globalMode);
            setWalletData(null);
        }
    }, [globalMode]);

    // Fetch unified bot data
    const fetchBotData = useCallback(async () => {
        try {
            const [statusRes, walletRes, tradesRes, signalsRes, eventsRes, perfRes] = await Promise.all([
                api.get('/bot/status').catch(e => ({ data: null })),
                api.get(`/bot/wallet/${mode}`).catch(e => ({ data: null })),
                api.get('/bot/trades', { params: { mode, limit: 50 } }).catch(e => ({ data: { trades: [] } })),
                api.get('/bot/signals', { params: { mode, limit: 50 } }).catch(e => ({ data: { signals: [] } })),
                api.get('/bot/events', { params: { mode, limit: 50 } }).catch(e => ({ data: { events: [] } })),
                api.get('/bot/performance', { params: { mode } }).catch(e => ({ data: null })),
            ]);

            if (statusRes.data) {
                const normalized = { ...statusRes.data };
                if (normalized.paper) {
                    const r = Boolean(normalized.paper.isRunning ?? normalized.paper.running);
                    normalized.paper.isRunning = r;
                    normalized.paper.running = r;
                }
                if (normalized.live) {
                    const r = Boolean(normalized.live.isRunning ?? normalized.live.running);
                    normalized.live.isRunning = r;
                    normalized.live.running = r;
                }
                setStatusData(normalized);
            }
            if (walletRes.data) setWalletData(walletRes.data);

            const tradesList = Array.isArray(tradesRes.data) ? tradesRes.data : (tradesRes.data?.trades || []);
            const signalsList = Array.isArray(signalsRes.data) ? signalsRes.data : (signalsRes.data?.signals || []);
            const eventsList = Array.isArray(eventsRes.data) ? eventsRes.data : (eventsRes.data?.events || []);
            setTrades(tradesList);
            setSignals(signalsList);
            setEvents(eventsList);

            if (perfRes.data) setPerformance(perfRes.data);
        } catch (err) {
            console.error('[TradingBot] Error fetching data:', err.message);
        } finally {
            setLoading(false);
        }
    }, [mode]);

    useEffect(() => {
        setLoading(true);
        fetchBotData();
    }, [fetchBotData]);

    // Socket.IO real-time event listeners
    useEffect(() => {
        if (!socket) return;

        const handleTradeOpened = (payload) => {
            if (payload?.mode === mode) {
                setStatusData(prev => {
                    if (!prev) return prev;
                    const prevMode = prev[mode] || {};
                    const currentOpenTrades = prevMode.openTrades || [];
                    const updatedOpenTrades = [payload.trade, ...currentOpenTrades.filter(t => t._id !== payload.trade._id)];
                    return {
                        ...prev,
                        [mode]: {
                            ...prevMode,
                            openTrade: updatedOpenTrades[0] || null,
                            openTrades: updatedOpenTrades,
                        }
                    };
                });
                setTrades(prev => [payload.trade, ...prev]);
                fetchBotData();
            }
        };

        const handleTradeClosed = (payload) => {
            if (payload?.mode === mode) {
                setStatusData(prev => {
                    if (!prev) return prev;
                    const prevMode = prev[mode] || {};
                    const currentOpenTrades = prevMode.openTrades || [];
                    const updatedOpenTrades = currentOpenTrades.filter(t => t.symbol !== payload.symbol && t._id !== payload.trade?._id);
                    return {
                        ...prev,
                        [mode]: {
                            ...prevMode,
                            openTrade: updatedOpenTrades[0] || null,
                            openTrades: updatedOpenTrades,
                        }
                    };
                });
                fetchBotData();
            }
        };

        const handlePositionUpdated = (payload) => {
            if (payload?.mode === mode && payload.symbol) {
                setLivePrices(prev => ({ ...prev, [payload.symbol]: payload.currentPrice }));
            }
        };

        const handleBotEvent = (payload) => {
            if (payload?.mode === mode || payload?.mode === 'all') {
                setEvents(prev => [{
                    eventType: payload.eventType,
                    message: payload.message,
                    level: payload.level || 'info',
                    timestamp: new Date().toISOString(),
                }, ...prev.slice(0, 49)]);
            }
        };

        const handleSignalLogged = (payload) => {
            if (payload?.mode === mode && payload?.signal) {
                setSignals(prev => [payload.signal, ...prev.filter(s => s._id !== payload.signal._id)].slice(0, 100));
            }
        };

        const handleScanComplete = (payload) => {
            if (payload?.mode === mode) {
                setStatusData(prev => prev ? ({
                    ...prev,
                    [mode]: {
                        ...prev[mode],
                        isScanning: false,
                        symbolsAffordable: payload.symbolsAffordable || prev[mode]?.symbolsAffordable,
                    }
                }) : prev);
                fetchBotData();
            }
        };

        const handleTicker = (ticker) => {
            if (ticker?.symbol && ticker?.mark_price) {
                setLivePrices(prev => ({
                    ...prev,
                    [ticker.symbol]: parseFloat(ticker.mark_price)
                }));
            }
        };

        const handleWalletUpdate = (payload) => {
            if (mode === 'live' && payload?.wallet) {
                setWalletData(prev => ({
                    ...prev,
                    balance: payload.wallet.equity ?? payload.wallet.balance ?? 0,
                    available: payload.wallet.available ?? 0,
                    used: payload.wallet.used ?? 0,
                    equity: payload.wallet.equity ?? payload.wallet.balance ?? 0,
                    unrealisedPnl: payload.wallet.unrealisedPnl ?? 0,
                }));
            }
        };

        const handlePaperWalletUpdate = (payload) => {
            if (mode === 'paper') {
                if (payload?.wallet) {
                    setWalletData(payload.wallet);
                }
                fetchBotData();
            }
        };

        const handleBotStatus = (payload) => {
            if (payload?.mode) {
                const runningBool = Boolean(payload.isRunning ?? payload.running);
                setStatusData(prev => {
                    const base = prev ? { ...prev } : {};
                    base[payload.mode] = {
                        ...(base[payload.mode] || {}),
                        ...payload,
                        isRunning: runningBool,
                        running: runningBool,
                        isScanning: Boolean(payload.isScanning),
                    };
                    return base;
                });
            }
        };

        socket.on('bot_trade_opened', handleTradeOpened);
        socket.on('bot_trade_closed', handleTradeClosed);
        socket.on('bot_position_updated', handlePositionUpdated);
        socket.on('bot_event', handleBotEvent);
        socket.on('bot_signal_logged', handleSignalLogged);
        socket.on('bot_scan_complete', handleScanComplete);
        socket.on('bot_status', handleBotStatus);
        socket.on('ticker', handleTicker);
        socket.on('wallet_update', handleWalletUpdate);
        socket.on('paper_order_placed', handlePaperWalletUpdate);
        socket.on('paper_position_closed', handlePaperWalletUpdate);

        return () => {
            socket.off('bot_trade_opened', handleTradeOpened);
            socket.off('bot_trade_closed', handleTradeClosed);
            socket.off('bot_position_updated', handlePositionUpdated);
            socket.off('bot_event', handleBotEvent);
            socket.off('bot_signal_logged', handleSignalLogged);
            socket.off('bot_scan_complete', handleScanComplete);
            socket.off('bot_status', handleBotStatus);
            socket.off('ticker', handleTicker);
            socket.off('wallet_update', handleWalletUpdate);
            socket.off('paper_order_placed', handlePaperWalletUpdate);
            socket.off('paper_position_closed', handlePaperWalletUpdate);
        };
    }, [socket, mode, fetchBotData]);

    // Active mode slice
    const currentModeStatus = statusData ? statusData[mode] : null;
    const isRunning = Boolean(currentModeStatus?.isRunning ?? currentModeStatus?.running);
    const isScanning = Boolean(currentModeStatus?.isScanning);
    const openTrades = currentModeStatus?.openTrades || (currentModeStatus?.openTrade ? [currentModeStatus.openTrade] : []);
    const openTrade = openTrades[0] || null;
    const aiRegime = statusData?.aiRegime || null;
    const nextScanAt = currentModeStatus?.nextScanAt || null;

    // Second-by-second countdown for next scan cycle
    const [secondsLeft, setSecondsLeft] = useState(null);

    useEffect(() => {
        if (!isRunning || !nextScanAt) {
            setSecondsLeft(null);
            return;
        }

        const tick = () => {
            const diff = Math.max(0, Math.floor((new Date(nextScanAt).getTime() - Date.now()) / 1000));
            setSecondsLeft(diff);
        };

        tick();
        const iv = setInterval(tick, 1000);
        return () => clearInterval(iv);
    }, [isRunning, nextScanAt]);

    const formatCountdown = (totalSec) => {
        if (totalSec === null || totalSec === undefined) return null;
        if (totalSec <= 0 || isScanning) return 'Scanning market…';
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const countdownText = formatCountdown(secondsLeft);

    // Track detailed action phase ('starting' | 'stopping' | 'scanning' | null)
    const [actionState, setActionState] = useState(null);

    // Actions
    const handleStart = async () => {
        setActionLoading(true);
        setActionState('starting');
        try {
            // Optimistic update to immediately show running state and stop button
            setStatusData(prev => {
                const base = prev ? { ...prev } : {};
                base[mode] = {
                    ...(base[mode] || {}),
                    isRunning: true,
                    running: true,
                };
                return base;
            });

            await api.post('/bot/start', { mode });
            await fetchBotData();
        } catch (err) {
            // Revert on error
            setStatusData(prev => {
                const base = prev ? { ...prev } : {};
                base[mode] = {
                    ...(base[mode] || {}),
                    isRunning: false,
                    running: false,
                };
                return base;
            });

            if (err.response?.status === 409) {
                setConflictMessage(err.response?.data?.error || 'Conflict: AI Automation is currently running in live mode.');
                setConflictModalOpen(true);
            } else {
                alert(err.response?.data?.error || err.message || 'Failed to start bot');
            }
        } finally {
            setActionLoading(false);
            setActionState(null);
        }
    };

    const handleStop = async () => {
        setActionLoading(true);
        setActionState('stopping');
        try {
            // Optimistic update to immediately show stopped state
            setStatusData(prev => {
                const base = prev ? { ...prev } : {};
                base[mode] = {
                    ...(base[mode] || {}),
                    isRunning: false,
                    running: false,
                };
                return base;
            });

            await api.post('/bot/stop', { mode });
            await fetchBotData();
        } catch (err) {
            alert(err.response?.data?.error || err.message || 'Failed to stop bot');
        } finally {
            setActionLoading(false);
            setActionState(null);
        }
    };

    const handleEmergencyStop = async () => {
        setActionLoading(true);
        try {
            await api.post('/bot/emergency-stop', { mode });
            await fetchBotData();
        } catch (err) {
            alert(err.response?.data?.error || err.message || 'Failed to execute emergency stop');
        } finally {
            setActionLoading(false);
        }
    };

    const handleCloseTrade = async (symbol) => {
        setActionLoading(true);
        try {
            await api.post('/bot/close-trade', { mode, symbol });
            await fetchBotData();
        } catch (err) {
            alert(err.response?.data?.error || err.message || 'Failed to close trade');
        } finally {
            setActionLoading(false);
        }
    };

    const handleScanNow = async () => {
        setActionLoading(true);
        try {
            await api.post('/bot/scan-now', { mode });
            // Optimistically set scanning state
            setStatusData(prev => prev ? ({
                ...prev,
                [mode]: {
                    ...prev[mode],
                    isScanning: true,
                }
            }) : prev);
        } catch (err) {
            alert(err.response?.data?.error || err.message || 'Failed to initiate scan');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSaveConfig = async (newConfig) => {
        await api.put(`/bot/config/${mode}`, newConfig);
        await fetchBotData();
    };

    // Construct live equity curve points from closed trades
    const equityCurveData = useMemo(() => {
        const initial = currentModeStatus?.config?.budgetUSDT || 10;
        if (!trades || trades.length === 0) {
            return [{ time: Date.now() - 3600000, balance: initial }, { time: Date.now(), balance: initial }];
        }

        // Reverse to chronological order (oldest first)
        const sorted = [...trades].sort((a, b) => new Date(a.createdAt || a.openedAt).getTime() - new Date(b.createdAt || b.openedAt).getTime());
        
        let runningBalance = initial;
        const pts = [{ time: new Date(sorted[0].createdAt || sorted[0].openedAt).getTime() - 60000, balance: initial }];

        for (const t of sorted) {
            if (t.result !== 'open') {
                runningBalance += (t.netPnl || 0);
                pts.push({
                    time: new Date(t.closedAt || t.updatedAt || Date.now()).getTime(),
                    balance: parseFloat(runningBalance.toFixed(2)),
                    trade: t.exitReason || (t.netPnl >= 0 ? 'take_profit' : 'stop_loss'),
                });
            }
        }
        return pts;
    }, [trades, currentModeStatus]);

    return (
        <div className="min-h-screen bg-crypto-bg text-crypto-text">
            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-30 bg-crypto-card/85 backdrop-blur-xl border-b border-crypto-border">
                <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="p-2 rounded-xl text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg transition-colors cursor-pointer"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-2">
                            <span className="text-base font-black text-crypto-heading tracking-tight">CryptoX</span>
                            <span className="text-crypto-border">/</span>
                            <span className="text-sm font-bold text-crypto-primary">Autonomous Bot</span>
                            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-crypto-success animate-live-dot' : 'bg-crypto-muted/40'}`} />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Quick link to Charts */}
                        <button
                            type="button"
                            onClick={() => navigate('/markets')}
                            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-heading transition-colors"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                            </svg>
                            Live Markets
                        </button>

                        {/* Positions Page Link */}
                        <button
                            type="button"
                            onClick={() => navigate('/positions')}
                            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-crypto-bg border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-heading transition-colors"
                        >
                            Positions
                        </button>

                        <NotificationBell />
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-24 md:pb-8 space-y-6">
                {/* 1. Header with Controls & Mode Switch */}
                <BotHeader
                    mode={mode}
                    onModeChange={handleModeChange}
                    isRunning={isRunning}
                    isScanning={isScanning}
                    countdownText={countdownText}
                    secondsLeft={secondsLeft}
                    wallet={walletData}
                    onStart={handleStart}
                    onStop={handleStop}
                    onEmergencyStop={handleEmergencyStop}
                    onScanNow={handleScanNow}
                    onOpenConfig={() => setConfigModalOpen(true)}
                    actionLoading={actionLoading}
                    actionState={actionState}
                />

                {/* 2. Top Stats & Telemetry Grid */}
                <BotStatsCards
                    status={currentModeStatus}
                    performance={performance}
                    aiRegime={aiRegime}
                    mode={mode}
                />

                {/* 3. Real-Time Active Trade / Scanning Radar */}
                <BotActivePosition
                    trades={openTrades}
                    trade={openTrade}
                    livePrices={livePrices}
                    currentPrice={openTrade ? livePrices[openTrade.symbol] : null}
                    isScanning={isScanning}
                    isRunning={isRunning}
                    countdownText={countdownText}
                    secondsLeft={secondsLeft}
                    mode={mode}
                    onCloseTrade={handleCloseTrade}
                    onScanNow={handleScanNow}
                    symbolsAffordable={currentModeStatus?.symbolsAffordable || []}
                />

                {/* 4. Equity Performance Curve */}
                <BotEquityChart
                    data={equityCurveData}
                    initialBalance={currentModeStatus?.config?.budgetUSDT || 10}
                    title={`${mode.toUpperCase()} Mode Live Account Equity`}
                />

                {/* 5. Tabbed Audit Console & Backtest Sandbox */}
                <BotAuditTabs
                    trades={trades}
                    signals={signals}
                    events={events}
                    mode={mode}
                    onRefresh={fetchBotData}
                />
            </main>

            {/* Strategy Configuration Modal */}
            <BotConfigModal
                isOpen={configModalOpen}
                onClose={() => setConfigModalOpen(false)}
                config={currentModeStatus?.config || {}}
                mode={mode}
                onSave={handleSaveConfig}
            />

            {/* 409 Conflict Warning Dialog */}
            {conflictModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
                    <div className="bg-crypto-card border border-crypto-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
                        <div className="flex items-center gap-3 text-amber-500">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-crypto-heading">Mutual Exclusion Active</h3>
                                <p className="text-xs text-crypto-muted">409 Conflict Safeguard</p>
                            </div>
                        </div>

                        <p className="text-xs text-crypto-text leading-relaxed">
                            {conflictMessage}
                        </p>
                        <p className="text-xs text-crypto-muted">
                            To protect your real Delta Exchange wallet from competing order conflicts, you cannot run both the Live TradingBot and Live AI Automation at the same time.
                        </p>

                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setConflictModalOpen(false)}
                                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-crypto-primary text-white shadow-lg shadow-crypto-primary/25"
                            >
                                Understood
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Bottom Navigation Bar */}
            <MobileBottomNav />
        </div>
    );
}
