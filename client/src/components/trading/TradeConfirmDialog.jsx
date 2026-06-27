import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useTradingMode } from '../../context/TradingModeContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import TradingChart from '../dashboard/TradingChart';

/**
 * TradeConfirmDialog
 *
 * Full-screen modal for reviewing & placing a trade.
 * Pre-fills from a signal or lets user type manually.
 * Supports autocomplete, live ticker, and side-by-side TradingChart.
 */

const SIDES = ['buy', 'sell'];
const ORDER_TYPES = [
    { value: 'limit_order',  label: 'Limit' },
    { value: 'market_order', label: 'Market' },
];

function Field({ label, children, hint }) {
    return (
        <div>
            <label className="block text-[10px] text-crypto-muted uppercase tracking-wider mb-1">
                {label}
            </label>
            {children}
            {hint && <p className="mt-0.5 text-[10px] text-crypto-muted/70">{hint}</p>}
        </div>
    );
}

function NumInput({ value, onChange, placeholder, disabled, step = 'any', min }) {
    return (
        <input
            type="number"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            step={step}
            min={min}
            className="w-full px-3 py-2 bg-crypto-input border border-crypto-border rounded-lg text-sm text-crypto-heading placeholder-crypto-muted/50 focus:outline-none focus:ring-1 focus:ring-crypto-primary/40 focus:border-crypto-primary/60 transition-all disabled:opacity-40"
        />
    );
}

export default function TradeConfirmDialog({ open, onClose, signal, symbol: symbolProp, onSuccess }) {
    const overlayRef = useRef(null);
    const navigate = useNavigate();
    const { isPaper } = useTradingMode();
    const { socket } = useSocket();
    const { theme } = useTheme();

    // Form state
    const [symbol,    setSymbol]    = useState('');
    const [side,      setSide]      = useState('buy');
    const [orderType, setOrderType] = useState('limit_order');
    const [price,     setPrice]     = useState('');
    const [size,      setSize]      = useState('1');
    const [leverage,  setLeverage]  = useState('3');
    const [stopLoss,  setStopLoss]  = useState('');
    const [takeProfit, setTakeProfit] = useState('');

    // Autocomplete & Live Price state
    const [products, setProducts] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [liveTicker, setLiveTicker] = useState(null);

    // UI state
    const [loading,  setLoading]  = useState(false);
    const [error,    setError]    = useState('');
    const [success,  setSuccess]  = useState(false);

    // Fetch active products on open
    useEffect(() => {
        if (!open) return;
        api.get('/market/products')
            .then(res => {
                setProducts(res.data.products || []);
            })
            .catch(err => console.error('[TradeConfirmDialog] Failed to load products:', err));
    }, [open]);

    // Check if entered symbol is valid
    const isValidSymbol = products.some(p => p.symbol === symbol?.toUpperCase());

    // Filter autocomplete list as symbol changes
    useEffect(() => {
        if (!symbol) {
            setSuggestions(products.slice(0, 5));
            return;
        }
        const query = symbol.toUpperCase();
        const filtered = products.filter(p => p.symbol.includes(query) || p.displayName?.includes(query));
        setSuggestions(filtered.slice(0, 6));
    }, [symbol, products]);

    // Real-time ticker stream
    useEffect(() => {
        if (!socket || !open || !isValidSymbol) {
            setLiveTicker(null);
            return;
        }

        const sym = symbol.toUpperCase();

        const handleTicker = (data) => {
            if (data.symbol === sym) setLiveTicker(data);
        };
        const handleBatch = (batch) => {
            if (batch[sym]) setLiveTicker(batch[sym]);
        };

        socket.on('ticker', handleTicker);
        socket.on('market_ticker_batch', handleBatch);

        return () => {
            socket.off('ticker', handleTicker);
            socket.off('market_ticker_batch', handleBatch);
        };
    }, [socket, open, symbol, isValidSymbol, products]);

    // Pre-fill from signal
    useEffect(() => {
        if (!open) return;
        setError('');
        setSuccess(false);

        if (signal) {
            setSymbol(signal.symbol || symbolProp || '');
            setSide(signal.action?.toLowerCase() === 'sell' ? 'sell' : 'buy');
            setOrderType('limit_order');
            setPrice(signal.entry ? String(signal.entry) : '');
            setSize(signal.quantity ? String(signal.quantity) : '1');
            setLeverage(signal.leverage ? String(signal.leverage) : '3');
            setStopLoss(signal.stopLoss ? String(signal.stopLoss) : '');
            setTakeProfit(signal.target1 ? String(signal.target1) : '');
        } else {
            setSymbol(symbolProp || '');
            setSide('buy');
            setOrderType('market_order');
            setPrice('');
            setSize('1');
            setLeverage('3');
            setStopLoss('');
            setTakeProfit('');
        }
    }, [open, signal, symbolProp]);

    // Close on backdrop click
    const handleOverlayClick = (e) => {
        if (e.target === overlayRef.current) onClose();
    };

    // Close on Escape
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        if (open) window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);

    const handleViewChart = () => {
        onClose();
        navigate(`/?coin=${symbol.toUpperCase()}`);
    };

    // ── Derived calculations ──
    const entryNum  = parseFloat(price) || (liveTicker?.price || 0);
    const slNum     = parseFloat(stopLoss) || 0;
    const tpNum     = parseFloat(takeProfit) || 0;
    const leverageN = parseInt(leverage) || 1;
    const sizeN     = parseInt(size) || 1;

    const risk   = entryNum > 0 && slNum > 0 ? Math.abs(entryNum - slNum) : 0;
    const reward = entryNum > 0 && tpNum > 0 ? Math.abs(tpNum - entryNum) : 0;
    const rr     = risk > 0 ? (reward / risk).toFixed(2) : '—';
    const margin  = entryNum > 0 ? ((entryNum * sizeN) / leverageN).toFixed(2) : '—';
    const riskUsd = risk > 0 ? (risk * sizeN).toFixed(2) : '—';
    const pnlPct  = entryNum > 0 && tpNum > 0
        ? (((Math.abs(tpNum - entryNum) / entryNum) * leverageN) * 100).toFixed(1)
        : '—';

    // ── Submit ──
    const handleSubmit = async () => {
        setError('');
        setLoading(true);
        try {
            const payload = {
                symbol:     symbol.toUpperCase(),
                side,
                size:       parseInt(size),
                orderType,
                leverage:   parseInt(leverage),
                stopLoss:   stopLoss ? parseFloat(stopLoss) : undefined,
                takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
                signalId:   signal?._id,
                source:     signal ? 'signal' : 'manual',
            };
            if (orderType === 'limit_order' && price) {
                payload.price = parseFloat(price);
            }

            // Route to paper or live endpoint based on current mode
            const endpoint = isPaper ? '/paper/order' : '/trading/order';
            const res = await api.post(endpoint, payload);
            setSuccess(true);
            setTimeout(() => {
                onSuccess && onSuccess(res.data.trade || res.data.position);
                onClose();
                setSuccess(false);
            }, 1400);
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Order failed');
        } finally {
            setLoading(false);
        }
    };

    if (!open) return null;

    const isBuy = side === 'buy';

    return (
        <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in"
        >
            <div className={`w-[calc(100%-1rem)] mx-2 mb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:mb-0 sm:mx-0 sm:w-full bg-crypto-card border border-crypto-border rounded-2xl sm:rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${
                isValidSymbol ? 'sm:max-w-5xl' : 'sm:max-w-md'
            }`}
                style={{ boxShadow: `0 0 60px ${isBuy ? '#10b98120' : '#ef444420'}` }}
            >
                {/* Accent bar */}
                <div className={`h-1 w-full ${isBuy ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' : 'bg-gradient-to-r from-red-600 to-red-400'}`} />

                {/* Main Content Layout */}
                <div className="flex flex-col md:flex-row">
                    {/* Left Column: Live Chart (only on desktop if valid symbol) */}
                    {isValidSymbol && (
                        <div className="hidden md:flex md:w-3/5 border-r border-crypto-border bg-crypto-bg/40 p-5 flex-col min-h-[460px]">
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-crypto-heading tracking-wide">Live Interactive Chart</span>
                                    <div className="w-1.5 h-1.5 rounded-full bg-crypto-success animate-live-dot" />
                                </div>
                                <button
                                    onClick={handleViewChart}
                                    className="text-xs text-crypto-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                    Full Chart ↗
                                </button>
                            </div>
                            {socket && (
                                <div className="h-[430px] rounded-xl overflow-hidden border border-crypto-border/50">
                                    <TradingChart
                                        symbol={symbol.toUpperCase()}
                                        socket={socket}
                                        isDarkMode={theme === 'dark'}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Right Column: Order Form */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-crypto-border">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-base font-bold text-crypto-heading">Place Order</h2>
                                    {/* Mode badge */}
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                        isPaper
                                            ? 'text-crypto-primary bg-crypto-primary/10 border-crypto-primary/20'
                                            : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                                    }`}>
                                        {isPaper ? '📄 PAPER' : '⚡ LIVE'}
                                    </span>
                                </div>
                                <p className="text-xs text-crypto-muted mt-0.5">
                                    {isPaper
                                        ? 'Simulated trade — no real money'
                                        : signal ? 'Pre-filled from AI signal · review' : 'Live trade with real funds'
                                    }
                                </p>
                            </div>
                            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading transition-colors cursor-pointer">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Body */}
                        <div className="px-5 py-4 space-y-4 max-h-[62vh] overflow-y-auto">

                            {/* Symbol + Side */}
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Symbol">
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={symbol}
                                            onChange={e => {
                                                setSymbol(e.target.value.toUpperCase());
                                                setShowSuggestions(true);
                                            }}
                                            onFocus={() => setShowSuggestions(true)}
                                            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                            placeholder="BTCUSD"
                                            className="w-full px-3 py-2 bg-crypto-input border border-crypto-border rounded-lg text-sm text-crypto-heading placeholder-crypto-muted/50 uppercase focus:outline-none focus:ring-1 focus:ring-crypto-primary/40 focus:border-crypto-primary/60 transition-all"
                                        />
                                        {showSuggestions && suggestions.length > 0 && (
                                            <div className="absolute left-0 right-0 mt-1 bg-crypto-card border border-crypto-border rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
                                                {suggestions.map(p => (
                                                    <button
                                                        key={p.symbol}
                                                        type="button"
                                                        onMouseDown={() => {
                                                            setSymbol(p.symbol);
                                                            setShowSuggestions(false);
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-xs font-semibold text-crypto-heading hover:bg-crypto-bg-subtle transition-colors flex justify-between items-center cursor-pointer"
                                                    >
                                                        <span>{p.symbol}</span>
                                                        <span className="text-[10px] text-crypto-muted">{p.displayName}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {/* Live Price Display */}
                                    {isValidSymbol && liveTicker && (
                                        <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                                            <span className="text-crypto-muted">Live:</span>
                                            <span className="font-bold text-crypto-heading tabular-nums">${liveTicker.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
                                            <span className={`font-bold ${liveTicker.change24h >= 0 ? 'text-crypto-success' : 'text-crypto-danger'}`}>
                                                {liveTicker.change24h >= 0 ? '+' : ''}{liveTicker.change24h?.toFixed(2)}%
                                            </span>
                                        </div>
                                    )}
                                </Field>
                                <Field label="Direction">
                                    <div className="flex rounded-lg overflow-hidden border border-crypto-border">
                                        {SIDES.map(s => (
                                            <button
                                                key={s}
                                                onClick={() => setSide(s)}
                                                className={`flex-1 py-2 text-sm font-bold capitalize transition-all cursor-pointer ${
                                                    side === s
                                                        ? s === 'buy'
                                                            ? 'bg-emerald-500 text-white'
                                                            : 'bg-red-500 text-white'
                                                        : 'bg-crypto-input text-crypto-muted hover:text-crypto-heading'
                                                }`}
                                            >
                                                {s === 'buy' ? '▲ Buy' : '▼ Sell'}
                                            </button>
                                        ))}
                                    </div>
                                </Field>
                            </div>

                            {/* Order type */}
                            <Field label="Order Type">
                                <div className="flex gap-2">
                                    {ORDER_TYPES.map(ot => (
                                        <button
                                            key={ot.value}
                                            onClick={() => setOrderType(ot.value)}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                                                orderType === ot.value
                                                    ? 'bg-crypto-primary/15 text-crypto-primary border-crypto-primary/30'
                                                    : 'bg-crypto-input text-crypto-muted border-crypto-border hover:text-crypto-heading'
                                            }`}
                                        >
                                            {ot.label}
                                        </button>
                                    ))}
                                </div>
                            </Field>

                            {/* Price (only for limit) */}
                            {orderType === 'limit_order' && (
                                <Field label="Entry Price (USDT)" hint="Leave blank to use current market price">
                                    <NumInput value={price} onChange={setPrice} placeholder="e.g. 63000" />
                                </Field>
                            )}

                            {/* Size + Leverage */}
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Size (contracts)" hint="Integer ≥ 1">
                                    <NumInput value={size} onChange={setSize} placeholder="1" step="1" min="1" />
                                </Field>
                                <Field label="Leverage" hint="1× – 20× max">
                                    <div className="relative">
                                        <NumInput value={leverage} onChange={setLeverage} placeholder="3" step="1" min="1" />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-crypto-muted pointer-events-none">×</span>
                                    </div>
                                </Field>
                            </div>

                            {/* Stop Loss + Take Profit */}
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Stop Loss" hint="Required for safety">
                                    <NumInput value={stopLoss} onChange={setStopLoss} placeholder={isBuy ? 'Below entry' : 'Above entry'} />
                                </Field>
                                <Field label="Take Profit (TP1)">
                                    <NumInput value={takeProfit} onChange={setTakeProfit} placeholder={isBuy ? 'Above entry' : 'Below entry'} />
                                </Field>
                            </div>

                            {/* Trade summary */}
                            <div className="rounded-xl border border-crypto-border bg-crypto-bg-subtle p-3 grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                                {[
                                    { label: 'Est. Margin', value: margin !== '—' ? `$${margin}` : '—' },
                                    { label: 'Risk/Reward', value: rr !== '—' ? `1:${rr}` : '—', color: parseFloat(rr) >= 2 ? 'text-emerald-400' : 'text-yellow-400' },
                                    { label: 'Risk (USD)', value: riskUsd !== '—' ? `$${riskUsd}` : '—', color: 'text-red-400' },
                                    { label: 'Potential PnL', value: pnlPct !== '—' ? `+${pnlPct}%` : '—', color: 'text-emerald-400' },
                                ].map(({ label, value, color }) => (
                                    <div key={label} className="flex items-center justify-between">
                                        <span className="text-crypto-muted">{label}</span>
                                        <span className={`font-semibold tabular-nums ${color || 'text-crypto-heading'}`}>{value}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Signal AI context (if from signal) */}
                            {signal?.reasoning && (
                                <div className="rounded-xl border border-crypto-primary/15 bg-crypto-primary/5 p-3">
                                    <div className="text-[10px] text-crypto-primary uppercase tracking-wide mb-1 flex items-center gap-1">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                        </svg>
                                        AI Reasoning
                                    </div>
                                    <p className="text-[11px] text-crypto-heading/80 leading-relaxed line-clamp-3">{signal.reasoning}</p>
                                </div>
                            )}

                            {/* Error */}
                            {error && (
                                <div className="rounded-xl border border-red-500/20 bg-red-500/8 p-3">
                                    <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
                                </div>
                            )}

                            {/* Success */}
                            {success && (
                                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <p className="text-xs text-emerald-400 font-semibold">Order placed successfully!</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-5 pb-5 pt-3 border-t border-crypto-border flex gap-3">
                            <button
                                onClick={onClose}
                                disabled={loading}
                                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-crypto-muted bg-crypto-input border border-crypto-border hover:text-crypto-heading hover:border-crypto-border/80 transition-all cursor-pointer disabled:opacity-40"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={loading || success || !symbol || !size}
                                className={`flex-[2] py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                                    isBuy
                                        ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_0_20px_#10b98130]'
                                        : 'bg-red-500 hover:bg-red-400 text-white shadow-[0_0_20px_#ef444430]'
                                }`}
                            >
                                {loading ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                                            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                        </svg>
                                        Placing…
                                    </>
                                ) : success ? (
                                    '✓ Placed!'
                                ) : (
                                    `${isBuy ? '▲ Buy' : '▼ Sell'} ${symbol || '—'}${isPaper ? ' (Paper)' : ''}`
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
