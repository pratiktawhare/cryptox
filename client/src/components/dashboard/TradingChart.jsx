import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';
import api from '../../services/api';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];

const TradingChart = ({ symbol, socket, isDarkMode, onNewOrder }) => {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const seriesRef = useRef(null);
    const [resolution, setResolution] = useState('15m');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // ── Create / recreate chart when symbol or resolution changes ──
    useEffect(() => {
        if (!containerRef.current) return;

        const colors = {
            bg: 'transparent',
            text: isDarkMode ? '#5e6b83' : '#697386',
            grid: isDarkMode ? '#1e2536' : '#ebedf0',
            upColor: '#0cce6b',
            downColor: '#ff4d6a',
        };

        const chart = createChart(containerRef.current, {
            layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
            grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: colors.grid },
            rightPriceScale: { borderColor: colors.grid },
            crosshair: {
                vertLine: { labelBackgroundColor: isDarkMode ? '#635bff' : '#635bff' },
                horzLine: { labelBackgroundColor: isDarkMode ? '#635bff' : '#635bff' },
            },
            autoSize: true,
        });
        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, {
            upColor: colors.upColor,
            downColor: colors.downColor,
            borderVisible: false,
            wickUpColor: colors.upColor,
            wickDownColor: colors.downColor,
        });
        seriesRef.current = series;

        // Fetch history
        const fetchHistory = async () => {
            setLoading(true);
            setError('');
            try {
                const res = await api.get('/market/history', { params: { symbol, resolution } });
                const data = (res.data || [])
                    .map((d) => ({
                        time: parseInt(d.time),
                        open: parseFloat(d.open),
                        high: parseFloat(d.high),
                        low: parseFloat(d.low),
                        close: parseFloat(d.close),
                    }))
                    .filter((d) => !isNaN(d.time) && !isNaN(d.open))
                    .sort((a, b) => a.time - b.time);

                if (data.length > 0) {
                    const samplePrice = data[data.length - 1].close;
                    let precision = 2;
                    let minMove = 0.01;

                    if (samplePrice < 0.1) {
                        precision = 6;
                        minMove = 0.000001;
                    } else if (samplePrice < 1) {
                        precision = 5;
                        minMove = 0.00001;
                    } else if (samplePrice < 10) {
                        precision = 4;
                        minMove = 0.0001;
                    } else if (samplePrice < 100) {
                        precision = 3;
                        minMove = 0.001;
                    }

                    series.applyOptions({
                        priceFormat: {
                            type: 'price',
                            precision,
                            minMove,
                        },
                    });

                    series.setData(data);
                    chart.timeScale().fitContent();
                } else {
                    setError('No data available for this symbol.');
                }
            } catch (err) {
                console.error('Chart data error:', err);
                setError('Failed to load chart data.');
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();

        return () => {
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [symbol, resolution, isDarkMode]);

    // ── Live candle updates ──
    useEffect(() => {
        if (!socket || !seriesRef.current) return;

        const handler = (data) => {
            if (data.symbol === symbol && data.resolution === resolution) {
                try {
                    seriesRef.current.update({
                        time: data.time,
                        open: data.open,
                        high: data.high,
                        low: data.low,
                        close: data.close,
                    });
                } catch (e) {
                    // series may be detached during symbol change
                }
            }
        };

        socket.on('candle_update', handler);
        return () => socket.off('candle_update', handler);
    }, [socket, symbol, resolution]);

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden flex flex-col animate-fade-in">
            {/* Header */}
            <div className="px-4 py-2.5 border-b border-crypto-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold text-crypto-heading truncate">{symbol}</h3>
                    {onNewOrder && (
                        <button
                            onClick={() => onNewOrder(symbol)}
                            className="px-2 py-1 bg-crypto-primary hover:bg-crypto-primary/95 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm flex-shrink-0"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Order
                        </button>
                    )}
                    {loading && (
                        <div className="flex items-center gap-1 text-[10px] text-crypto-primary flex-shrink-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-crypto-primary animate-live-dot" />
                            Live
                        </div>
                    )}
                    {error && <span className="text-[10px] text-crypto-danger truncate">{error}</span>}
                </div>

                {/* Timeframe pills */}
                <div className="flex gap-0.5 bg-crypto-bg-subtle rounded-lg p-0.5 flex-shrink-0">
                    {TIMEFRAMES.map((tf) => (
                        <button
                            key={tf}
                            onClick={() => setResolution(tf)}
                            className={`px-2 py-0.5 md:px-3 md:py-1 rounded-md text-[10px] md:text-xs font-semibold transition-all duration-200 cursor-pointer ${
                                resolution === tf
                                    ? 'bg-crypto-primary text-white shadow-sm'
                                    : 'text-crypto-muted hover:text-crypto-heading'
                            }`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart canvas */}
            <div className="relative h-[260px] md:h-[420px]">
                <div ref={containerRef} className="absolute inset-0" />
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-crypto-card/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-2">
                            <svg className="animate-spin h-6 w-6 text-crypto-primary" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span className="text-xs text-crypto-muted">Fetching {symbol} candles…</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TradingChart;
