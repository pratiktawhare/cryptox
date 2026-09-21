import React, { useState, useMemo } from 'react';

export default function BotEquityChart({ data = [], initialBalance = 10, title = 'Strategy Equity Curve' }) {
    const [hoveredPoint, setHoveredPoint] = useState(null);

    // Compute curve points
    const points = useMemo(() => {
        if (!Array.isArray(data) || data.length === 0) {
            return [
                { time: Date.now() - 3600000, balance: initialBalance },
                { time: Date.now(), balance: initialBalance }
            ];
        }
        return data;
    }, [data, initialBalance]);

    // Metrics
    const balances = points.map(p => p.balance);
    const minBal = Math.min(...balances);
    const maxBal = Math.max(...balances);
    const currentBal = balances[balances.length - 1];
    const startBal = balances[0] || initialBalance;
    const netReturnPct = startBal > 0 ? ((currentBal - startBal) / startBal) * 100 : 0;
    const isProfitable = currentBal >= startBal;

    // SVG sizing
    const width = 800;
    const height = 240;
    const padding = { top: 20, right: 30, bottom: 30, left: 50 };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Y scale range with 10% breathing room
    const yRange = (maxBal - minBal) || (startBal * 0.1) || 1;
    const yMin = Math.max(0, minBal - yRange * 0.15);
    const yMax = maxBal + yRange * 0.15;

    // Convert data to SVG coordinates
    const coords = useMemo(() => {
        if (points.length === 1) {
            return [{ x: padding.left + chartWidth / 2, y: padding.top + chartHeight / 2, ...points[0] }];
        }
        return points.map((p, idx) => {
            const x = padding.left + (idx / (points.length - 1)) * chartWidth;
            const y = padding.top + chartHeight - ((p.balance - yMin) / (yMax - yMin)) * chartHeight;
            return { x, y, ...p };
        });
    }, [points, yMin, yMax, chartWidth, chartHeight, padding.left, padding.top]);

    // SVG Path generator (smooth line)
    const linePath = useMemo(() => {
        if (coords.length < 2) return '';
        let path = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 1; i < coords.length; i++) {
            const prev = coords[i - 1];
            const curr = coords[i];
            const cx = (prev.x + curr.x) / 2;
            path += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
        }
        return path;
    }, [coords]);

    // Gradient Area Path
    const areaPath = useMemo(() => {
        if (coords.length < 2) return '';
        const bottomY = padding.top + chartHeight;
        return `${linePath} L ${coords[coords.length - 1].x} ${bottomY} L ${coords[0].x} ${bottomY} Z`;
    }, [linePath, coords, padding.top, chartHeight]);

    // Baseline Y for start balance
    const baselineY = padding.top + chartHeight - ((startBal - yMin) / (yMax - yMin)) * chartHeight;

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-2xl p-4 md:p-5 shadow-sm">
            {/* Header / Summary */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                    <h3 className="text-sm font-bold text-crypto-heading tracking-tight flex items-center gap-2">
                        <svg className="w-4 h-4 text-crypto-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-.28 6.368" />
                        </svg>
                        {title}
                    </h3>
                    <p className="text-[11px] text-crypto-muted">
                        Simulated account growth from initial ${startBal.toFixed(2)} capital
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <div className="text-[10px] uppercase font-bold text-crypto-muted">Current Equity</div>
                        <div className={`text-base font-black tabular-nums ${isProfitable ? 'text-crypto-success' : 'text-crypto-danger'}`}>
                            ${currentBal.toFixed(2)}
                            <span className="text-xs font-bold ml-1">
                                ({netReturnPct >= 0 ? '+' : ''}{netReturnPct.toFixed(2)}%)
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* SVG Chart */}
            <div className="relative w-full overflow-hidden">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="w-full h-48 md:h-56 select-none overflow-visible"
                    onMouseLeave={() => setHoveredPoint(null)}
                >
                    <defs>
                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={isProfitable ? '#10b981' : '#6366f1'} stopOpacity="0.28" />
                            <stop offset="100%" stopColor={isProfitable ? '#10b981' : '#6366f1'} stopOpacity="0.0" />
                        </linearGradient>
                    </defs>

                    {/* Gridlines */}
                    {[0, 0.25, 0.5, 0.75, 1].map(r => {
                        const y = padding.top + chartHeight * r;
                        const val = yMax - r * (yMax - yMin);
                        return (
                            <g key={r}>
                                <line
                                    x1={padding.left}
                                    y1={y}
                                    x2={padding.left + chartWidth}
                                    y2={y}
                                    stroke="currentColor"
                                    className="text-crypto-border/40"
                                    strokeDasharray="4 4"
                                    strokeWidth="1"
                                />
                                <text
                                    x={padding.left - 8}
                                    y={y + 3}
                                    textAnchor="end"
                                    className="fill-current text-[10px] text-crypto-muted font-mono"
                                >
                                    ${val.toFixed(val >= 100 ? 0 : 2)}
                                </text>
                            </g>
                        );
                    })}

                    {/* Baseline reference line */}
                    {baselineY >= padding.top && baselineY <= padding.top + chartHeight && (
                        <line
                            x1={padding.left}
                            y1={baselineY}
                            x2={padding.left + chartWidth}
                            y2={baselineY}
                            stroke="#94a3b8"
                            strokeDasharray="2 2"
                            strokeWidth="1"
                            strokeOpacity="0.5"
                        />
                    )}

                    {/* Area under curve */}
                    <path d={areaPath} fill="url(#equityGrad)" />

                    {/* Main Curve Line */}
                    <path
                        d={linePath}
                        fill="none"
                        stroke={isProfitable ? '#10b981' : '#6366f1'}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                    />

                    {/* Data Points */}
                    {coords.map((pt, idx) => {
                        const isWin = pt.trade === 'take_profit';
                        const isLoss = pt.trade === 'stop_loss';
                        return (
                            <g key={idx}>
                                <circle
                                    cx={pt.x}
                                    y={pt.y}
                                    r={isWin || isLoss ? 4.5 : 2.5}
                                    className={`cursor-pointer transition-all duration-150 ${
                                        isWin ? 'fill-emerald-400 stroke-crypto-card' :
                                        isLoss ? 'fill-red-400 stroke-crypto-card' :
                                        'fill-crypto-primary stroke-crypto-card'
                                    }`}
                                    strokeWidth="2"
                                    onMouseEnter={() => setHoveredPoint(pt)}
                                />
                            </g>
                        );
                    })}

                    {/* Hover vertical cursor */}
                    {hoveredPoint && (
                        <line
                            x1={hoveredPoint.x}
                            y1={padding.top}
                            x2={hoveredPoint.x}
                            y2={padding.top + chartHeight}
                            stroke="currentColor"
                            className="text-crypto-primary"
                            strokeWidth="1"
                            strokeDasharray="3 3"
                        />
                    )}
                </svg>

                {/* Floating Tooltip */}
                {hoveredPoint && (
                    <div
                        className="absolute z-20 pointer-events-none -translate-x-1/2 -translate-y-full px-3 py-1.5 rounded-xl bg-crypto-card border border-crypto-border shadow-xl text-xs font-semibold backdrop-blur-md"
                        style={{
                            left: `${(hoveredPoint.x / width) * 100}%`,
                            top: `${(hoveredPoint.y / height) * 100 - 8}%`,
                        }}
                    >
                        <div className="text-[10px] text-crypto-muted">
                            {new Date(hoveredPoint.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="font-bold text-crypto-heading tabular-nums">
                            Balance: ${hoveredPoint.balance.toFixed(2)}
                        </div>
                        {hoveredPoint.trade && (
                            <div className={`text-[10px] font-bold uppercase tracking-wider ${
                                hoveredPoint.trade === 'take_profit' ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                                {hoveredPoint.trade.replace('_', ' ')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
