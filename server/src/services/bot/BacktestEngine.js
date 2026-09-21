/**
 * BacktestEngine.js
 *
 * Replays historical market data against the exact TradingBot logic:
 *   Candles -> Technical Indicators -> RegimeDetector -> SignalScorer -> RiskEngine (20x margin, exact fees, ATR bracket protection)
 *
 * Features:
 *   - Public candle fetch from Delta Exchange India (/v2/history/candles).
 *   - Auto-chunking/pagination for arbitrary date ranges.
 *   - Realistic execution simulation (entry at next candle open, maker entry fee 0.02%, taker exit fee 0.05%, spread slippage).
 *   - Dynamic position sizing respecting starting budget (e.g. $10) and leverage.
 *   - Generates comprehensive performance metrics and full equity curve data points for frontend visualization.
 */

const axios = require('axios');
const config = require('../../config/env');
const productCatalog = require('../ProductCatalog');

const { calcEMA, calcEMASlope } = require('./indicators/ema');
const { calcRSI } = require('./indicators/rsi');
const { calcATR, calcATRPercent } = require('./indicators/atr');
const { calcVolumeRatio } = require('./indicators/volume');
const { calcMomentum } = require('./indicators/momentum');
const { detectRegime } = require('./RegimeDetector');
const { scoreSignal } = require('./SignalScorer');
const { calcRisk } = require('./RiskEngine');

class BacktestEngine {
    /**
     * Run a complete historical backtest.
     *
     * @param {object} params
     * @param {string} [params.symbol='DOGEUSD']
     * @param {string|number|Date} [params.from]
     * @param {string|number|Date} [params.to]
     * @param {number} [params.startBalance=10]
     * @param {object} [params.config] - Strategy overrides (budgetUSDT, riskPerTradePct, maxLeverage, etc.)
     *
     * @returns {Promise<object>}
     */
    async runBacktest(params = {}) {
        const symbol = (params.symbol || 'DOGEUSD').toUpperCase();
        const startBalance = parseFloat(params.startBalance || 10);

        // Ensure catalog is initialized for contract specifications
        if (!productCatalog.isReady) {
            await productCatalog.init();
        }

        const productSpec = productCatalog.getBySymbol(symbol);
        const contractValue = parseFloat(productSpec?.contract_value || 1);

        // Date bounds (default to last 14 days if not specified)
        const nowSec = Math.floor(Date.now() / 1000);
        const defaultStartSec = nowSec - 14 * 24 * 60 * 60; // 14 days ago

        const startTs = params.from
            ? Math.floor(new Date(params.from).getTime() / 1000)
            : defaultStartSec;
        const endTs = params.to
            ? Math.floor(new Date(params.to).getTime() / 1000)
            : nowSec;

        // Configuration with sensible defaults
        const stratConfig = {
            budgetUSDT: startBalance,
            riskPerTradePct: 5,
            targetRoiPct: 5,
            maxDailyLossPct: 10,
            maxConsecutiveLosses: 3,
            cooldownSeconds: 60,
            minRewardRisk: 0.05,
            minSignalScore: 5,
            slAtrMultiplier: 5.0,
            tpSafetyMultiplier: 2.0,
            maxLeverage: 20,
            maxOpenPositions: 1,
            ...(params.config || {}),
        };

        console.log(`[BacktestEngine] 🧪 Starting backtest for ${symbol} from ${new Date(startTs * 1000).toISOString()} to ${new Date(endTs * 1000).toISOString()} (Budget: $${startBalance})`);

        // 1. Fetch historical 5m candles in chunks
        const candles = await this._fetchHistoricalCandles(symbol, startTs, endTs);
        if (!candles || candles.length < 50) {
            throw new Error(`Insufficient historical candles fetched (${candles?.length || 0}) for ${symbol}. Try a wider date range.`);
        }

        console.log(`[BacktestEngine] 📊 Loaded ${candles.length} historical 5m candles. Simulating strategy...`);

        // 2. Simulation State
        let currentBalance = startBalance;
        let peakBalance = startBalance;
        let maxDrawdown = 0;
        let openPosition = null;

        const trades = [];
        const equityCurve = [
            { time: candles[0].time * 1000, balance: startBalance }
        ];

        let dailyLoss = 0;
        let consecutiveLosses = 0;
        let cooldownUntil = 0;
        let currentDayStr = '';

        // 3. Candle-by-candle replay
        for (let i = 35; i < candles.length; i++) {
            const candle = candles[i];
            const candleDateStr = new Date(candle.time * 1000).toISOString().slice(0, 10);

            // Roll over daily loss counter at midnight UTC
            if (candleDateStr !== currentDayStr) {
                currentDayStr = candleDateStr;
                dailyLoss = 0;
            }

            // ── Check open position for TP / SL hit ──────────────────────────
            if (openPosition) {
                const isLong = openPosition.direction === 'long';
                let exitPrice = null;
                let exitReason = null;

                if (isLong) {
                    if (candle.low <= openPosition.stopLoss) {
                        exitPrice = openPosition.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (candle.high >= openPosition.takeProfit) {
                        exitPrice = openPosition.takeProfit;
                        exitReason = 'take_profit';
                    }
                } else {
                    if (candle.high >= openPosition.stopLoss) {
                        exitPrice = openPosition.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (candle.low <= openPosition.takeProfit) {
                        exitPrice = openPosition.takeProfit;
                        exitReason = 'take_profit';
                    }
                }

                if (exitPrice !== null) {
                    const priceDiff = isLong ? (exitPrice - openPosition.entryPrice) : (openPosition.entryPrice - exitPrice);
                    const grossPnl = priceDiff * openPosition.quantity * contractValue;
                    const exitFee = exitPrice * openPosition.quantity * contractValue * (0.0005 * 1.18); // 0.05% taker fee + 18% GST
                    const totalFees = openPosition.entryFee + exitFee;
                    const netPnl = grossPnl - totalFees;
                    const isWin = netPnl >= 0;

                    currentBalance += netPnl;

                    // Track drawdown
                    peakBalance = Math.max(peakBalance, currentBalance);
                    const dd = peakBalance > 0 ? ((peakBalance - currentBalance) / peakBalance) * 100 : 0;
                    maxDrawdown = Math.max(maxDrawdown, dd);

                    // Update daily risk stats
                    if (!isWin) {
                        dailyLoss += Math.abs(netPnl);
                        consecutiveLosses += 1;
                    } else {
                        consecutiveLosses = 0;
                    }
                    cooldownUntil = (candle.time * 1000) + (stratConfig.cooldownSeconds * 1000);

                    trades.push({
                        symbol,
                        direction: openPosition.direction,
                        entryTime: openPosition.entryTime,
                        exitTime: candle.time * 1000,
                        durationMinutes: Math.round((candle.time * 1000 - openPosition.entryTime) / 60000),
                        entryPrice: openPosition.entryPrice,
                        exitPrice,
                        quantity: openPosition.quantity,
                        leverage: openPosition.leverage,
                        margin: openPosition.margin,
                        grossPnl: parseFloat(grossPnl.toFixed(4)),
                        fees: parseFloat(totalFees.toFixed(4)),
                        netPnl: parseFloat(netPnl.toFixed(4)),
                        result: isWin ? 'win' : 'loss',
                        exitReason,
                        balanceAfter: parseFloat(currentBalance.toFixed(2)),
                    });

                    equityCurve.push({
                        time: candle.time * 1000,
                        balance: parseFloat(currentBalance.toFixed(2)),
                        trade: exitReason,
                    });

                    openPosition = null;
                }
            }

            // ── Evaluate new entry signal if no open position ────────────────
            if (!openPosition && currentBalance > 1.0) {
                // Check safety gates
                const dailyStats = { dailyLoss, consecutiveLosses, cooldownUntil };
                const effectiveBudget = Math.min(stratConfig.budgetUSDT, currentBalance);
                const maxDailyLoss = effectiveBudget * (stratConfig.maxDailyLossPct / 100);

                if (dailyLoss >= maxDailyLoss || consecutiveLosses >= stratConfig.maxConsecutiveLosses || (candle.time * 1000) < cooldownUntil) {
                    continue; // Skip this bar due to risk circuit breaker
                }

                // Window of 35 candles for indicators
                const window = candles.slice(i - 35, i + 1);
                const closes = window.map(c => c.close);
                const highs = window.map(c => c.high);
                const lows = window.map(c => c.low);
                const volumes = window.map(c => c.volume);

                const currentClose = closes[closes.length - 1];
                const ema9_5m = calcEMA(closes, 9);
                const ema21_5m = calcEMA(closes, 21);
                const ema21Slope_5m = calcEMASlope(closes, 21);
                const rsi_5m = calcRSI(closes, 14);
                const atr_5m = calcATR(highs, lows, closes, 14);
                const atrPct_5m = calcATRPercent(highs, lows, closes, 14);
                const volumeRatio = calcVolumeRatio(volumes, 20);

                if (atr_5m === null || rsi_5m === null) continue;

                // 1m approximation from current bar price action
                const snap1m = {
                    ema9: ema9_5m,
                    ema21: ema21_5m,
                    rsi: rsi_5m,
                    momentum: window.length >= 2 ? ((currentClose - window[window.length - 2].close) / window[window.length - 2].close) * 100 : 0,
                    close: currentClose,
                };

                const snapshot = {
                    symbol,
                    close: currentClose,
                    spread: atr_5m * 0.05,
                    fundingRate: 0.0001,
                    '5m': {
                        ema9: ema9_5m,
                        ema21: ema21_5m,
                        ema21Slope: ema21Slope_5m,
                        rsi: rsi_5m,
                        atr: atr_5m,
                        atrPct: atrPct_5m,
                        volumeRatio,
                        close: currentClose,
                    },
                    '1m': snap1m,
                };

                const regimeResult = detectRegime(snapshot);
                const scoreResult = scoreSignal(snapshot, regimeResult, stratConfig.minSignalScore);

                if (scoreResult.decision === 'TRADE' && scoreResult.score >= stratConfig.minSignalScore) {
                    // Next candle open simulates realistic execution without lookahead bias
                    const nextCandle = i + 1 < candles.length ? candles[i + 1] : null;
                    const entryPrice = nextCandle ? nextCandle.open : currentClose;

                    const riskResult = calcRisk({
                        config: stratConfig,
                        actualAvailableBalance: currentBalance,
                        symbol,
                        direction: scoreResult.direction,
                        entryPrice,
                        atr: atr_5m,
                        spread: snapshot.spread,
                        fundingRate: snapshot.fundingRate,
                        productSpec,
                        dailyStats,
                    });

                    if (riskResult.valid && riskResult.qty > 0) {
                        const entryFee = entryPrice * riskResult.qty * contractValue * (0.0002 * 1.18); // 0.02% maker fee + 18% GST
                        openPosition = {
                            symbol,
                            direction: scoreResult.direction,
                            entryTime: (nextCandle ? nextCandle.time : candle.time) * 1000,
                            entryPrice,
                            stopLoss: riskResult.stopLoss,
                            takeProfit: riskResult.takeProfit,
                            quantity: riskResult.qty,
                            leverage: riskResult.leverage,
                            margin: riskResult.margin,
                            entryFee,
                        };
                    }
                }
            }
        }

        // 4. Aggregate Performance Metrics
        const totalTrades = trades.length;
        const wins = trades.filter(t => t.result === 'win').length;
        const losses = trades.filter(t => t.result === 'loss').length;
        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

        const totalNetProfit = currentBalance - startBalance;
        const returnPct = startBalance > 0 ? (totalNetProfit / startBalance) * 100 : 0;

        let grossProfitSum = 0;
        let grossLossSum = 0;
        for (const t of trades) {
            if (t.netPnl >= 0) grossProfitSum += t.netPnl;
            else grossLossSum += Math.abs(t.netPnl);
        }

        const profitFactor = grossLossSum > 0 ? grossProfitSum / grossLossSum : grossProfitSum > 0 ? 999 : 0;
        const avgWin = wins > 0 ? grossProfitSum / wins : 0;
        const avgLoss = losses > 0 ? grossLossSum / losses : 0;
        const avgTradePnl = totalTrades > 0 ? totalNetProfit / totalTrades : 0;

        console.log(`[BacktestEngine] ✅ Backtest complete: ${totalTrades} trades | Win Rate: ${winRate.toFixed(1)}% | Return: ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}% | Max DD: ${maxDrawdown.toFixed(1)}%`);

        return {
            symbol,
            from: new Date(startTs * 1000).toISOString(),
            to: new Date(endTs * 1000).toISOString(),
            candleCount: candles.length,
            startBalance: parseFloat(startBalance.toFixed(2)),
            finalBalance: parseFloat(currentBalance.toFixed(2)),
            netProfit: parseFloat(totalNetProfit.toFixed(2)),
            returnPct: parseFloat(returnPct.toFixed(2)),
            totalTrades,
            wins,
            losses,
            winRate: parseFloat(winRate.toFixed(1)),
            profitFactor: parseFloat(profitFactor.toFixed(2)),
            maxDrawdown: parseFloat(maxDrawdown.toFixed(1)),
            avgWin: parseFloat(avgWin.toFixed(4)),
            avgLoss: parseFloat(avgLoss.toFixed(4)),
            avgTradePnl: parseFloat(avgTradePnl.toFixed(4)),
            equityCurve,
            trades: trades.slice(-100), // Return last 100 trades for review
        };
    }

    // ─── Historical Candle Ingestion ───────────────────────────────────────────

    async _fetchHistoricalCandles(symbol, startTs, endTs) {
        const resolution = '5m';
        const resSeconds = 5 * 60; // 300s per candle
        const chunkSize = 500 * resSeconds; // fetch in 500-candle intervals

        const candleMap = new Map();
        let curStart = startTs;

        while (curStart < endTs) {
            const curEnd = Math.min(curStart + chunkSize, endTs);
            try {
                const resp = await axios.get(`${config.deltaBaseUrl}/v2/history/candles`, {
                    timeout: 10_000,
                    params: {
                        symbol,
                        resolution,
                        start: curStart,
                        end: curEnd,
                    },
                });

                const batch = resp.data?.result || [];
                for (const c of batch) {
                    if (c.time && c.open && c.close) {
                        candleMap.set(parseInt(c.time), {
                            time: parseInt(c.time),
                            open: parseFloat(c.open),
                            high: parseFloat(c.high),
                            low: parseFloat(c.low),
                            close: parseFloat(c.close),
                            volume: parseFloat(c.volume || 0),
                        });
                    }
                }

                if (batch.length === 0) {
                    curStart = curEnd;
                } else {
                    const maxTime = Math.max(...batch.map(b => parseInt(b.time)));
                    curStart = Math.max(maxTime + resSeconds, curEnd);
                }
            } catch (err) {
                console.warn(`[BacktestEngine] Chunk fetch warn (${symbol}):`, err.message);
                curStart += chunkSize;
            }
        }

        return [...candleMap.values()].sort((a, b) => a.time - b.time);
    }
}

module.exports = new BacktestEngine();
