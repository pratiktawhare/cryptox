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
const { calcRisk, checkDailyLimits } = require('./RiskEngine');
const { FEES } = require('./CostEngine');
const { selectStrategy } = require('./strategySelector');
const { DEFAULT_STRATEGY_TYPE } = require('./strategyTypes');

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
            riskPerTradePct: 1,
            targetRoiPct: 5,
            maxDailyLossPct: 10,
            maxConsecutiveLosses: 3,
            cooldownSeconds: 60,
            minRewardRisk: 1.0,
            minSignalScore: 5,
            slAtrMultiplier: 1.5,
            tpSafetyMultiplier: 2.0,
            maxLeverage: 5,
            maxOpenPositions: 1,
            strategyType: DEFAULT_STRATEGY_TYPE,
            // Conservative execution assumptions. Callers can override these
            // for exchange-specific fee tiers and measured market quality.
            entryFeeRate: FEES.MAKER_RATE,
            exitFeeRate: FEES.TAKER_RATE,
            slippageBps: 2,
            fundingRate: 0.0001,
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
            if (openPosition && openPosition.entryTime <= candle.time * 1000) {
                const isLong = openPosition.direction === 'long';
                let exitPrice = null;
                let exitReason = null;

                if (isLong) {
                    if (candle.low <= openPosition.stopLoss) {
                        // If the bar opens through the stop, a stop cannot fill
                        // at the requested price. Use the worse open price.
                        exitPrice = candle.open <= openPosition.stopLoss ? candle.open : openPosition.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (candle.high >= openPosition.takeProfit) {
                        exitPrice = candle.open >= openPosition.takeProfit ? candle.open : openPosition.takeProfit;
                        exitReason = 'take_profit';
                    }
                } else {
                    if (candle.high >= openPosition.stopLoss) {
                        exitPrice = candle.open >= openPosition.stopLoss ? candle.open : openPosition.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (candle.low <= openPosition.takeProfit) {
                        exitPrice = candle.open <= openPosition.takeProfit ? candle.open : openPosition.takeProfit;
                        exitReason = 'take_profit';
                    }
                }

                if (exitPrice !== null) {
                    // Apply adverse slippage to the executable exit price.
                    const slip = exitPrice * (stratConfig.slippageBps / 10_000);
                    exitPrice = isLong ? exitPrice - slip : exitPrice + slip;
                    const priceDiff = isLong ? (exitPrice - openPosition.entryPrice) : (openPosition.entryPrice - exitPrice);
                    const grossPnl = priceDiff * openPosition.quantity * contractValue;
                    const exitFee = exitPrice * openPosition.quantity * contractValue * stratConfig.exitFeeRate;
                    const holdHours = Math.max(0, (candle.time * 1000 - openPosition.entryTime) / 3_600_000);
                    const fundingPeriods = holdHours / 8;
                    const fundingDirection = isLong ? 1 : -1;
                    const fundingCost = Math.max(
                        0,
                        stratConfig.fundingRate * fundingPeriods * openPosition.entryNotional * fundingDirection
                    );
                    const totalFees = openPosition.entryFee + exitFee;
                    const netPnl = grossPnl - totalFees - fundingCost;
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
                        fundingCost: parseFloat(fundingCost.toFixed(4)),
                        slippage: parseFloat((openPosition.entrySlippage + slip * openPosition.quantity * contractValue).toFixed(4)),
                        strategyType: openPosition.strategyType,
                        strategyMetadata: openPosition.strategyMetadata,
                        regime: openPosition.regime,
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
                // Check the same cooldown and loss gates used in live scans.
                const dailyStats = { dailyLoss, consecutiveLosses, cooldownUntil };
                const limitCheck = checkDailyLimits(stratConfig, currentBalance, dailyStats);
                if (!limitCheck.ok) continue;

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
                    fundingRate: stratConfig.fundingRate,
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
                const strategyResult = selectStrategy({
                    strategyType: stratConfig.strategyType || DEFAULT_STRATEGY_TYPE,
                    snapshot,
                    config: stratConfig,
                    regimeResult,
                    candles: window,
                    now: candle.time * 1000,
                });
                const scoreResult = strategyResult.scoreResult;

                if (scoreResult.decision === 'TRADE' && scoreResult.score >= stratConfig.minSignalScore) {
                    // Next candle open simulates realistic execution without lookahead bias
                    const nextCandle = i + 1 < candles.length ? candles[i + 1] : null;
                    const plannedEntryPrice = nextCandle ? nextCandle.open : currentClose;
                    const tradeDirection = stratConfig.reverseMode
                        ? (scoreResult.direction === 'long' ? 'short' : 'long')
                        : scoreResult.direction;
                    const entrySlip = plannedEntryPrice * (stratConfig.slippageBps / 10_000);
                    const entryPrice = tradeDirection === 'long'
                        ? plannedEntryPrice + entrySlip
                        : plannedEntryPrice - entrySlip;

                    const riskResult = calcRisk({
                        config: stratConfig,
                        actualAvailableBalance: currentBalance,
                        symbol,
                        direction: tradeDirection,
                        entryPrice,
                        atr: atr_5m,
                        spread: snapshot.spread,
                        fundingRate: snapshot.fundingRate,
                        productSpec,
                        strategyGeometry: scoreResult.geometry,
                        dailyStats,
                    });

                    if (riskResult.valid && riskResult.qty > 0) {
                        const entryNotional = entryPrice * riskResult.qty * contractValue;
                        const entryFee = entryNotional * stratConfig.entryFeeRate;
                        openPosition = {
                            symbol,
                            direction: tradeDirection,
                            entryTime: (nextCandle ? nextCandle.time : candle.time) * 1000,
                            entryPrice,
                            stopLoss: riskResult.stopLoss,
                            takeProfit: riskResult.takeProfit,
                            quantity: riskResult.qty,
                            leverage: riskResult.leverage,
                            margin: riskResult.margin,
                            entryFee,
                            entryNotional,
                            entrySlippage: entrySlip * riskResult.qty * contractValue,
                            reverseMode: Boolean(stratConfig.reverseMode),
                            strategyType: stratConfig.strategyType || DEFAULT_STRATEGY_TYPE,
                            strategyMetadata: strategyResult.strategyMetadata || {},
                            regime: strategyResult.regimeResult?.regime || null,
                        };
                    }
                }
            }

            // Mark open risk to market on every completed bar so drawdown is
            // not understated merely because a stop has not closed yet.
            if (openPosition && openPosition.entryTime <= candle.time * 1000) {
                const isLong = openPosition.direction === 'long';
                const unrealised = (isLong
                    ? candle.close - openPosition.entryPrice
                    : openPosition.entryPrice - candle.close)
                    * openPosition.quantity * contractValue;
                const markedEquity = currentBalance + unrealised - openPosition.entryFee;
                peakBalance = Math.max(peakBalance, markedEquity);
                const dd = peakBalance > 0 ? ((peakBalance - markedEquity) / peakBalance) * 100 : 0;
                maxDrawdown = Math.max(maxDrawdown, dd);
            }
        }

        // Do not hide the P&L of a position that is still open when the data
        // ends. Force a conservative market close at the final close and apply
        // the same costs as an intraperiod exit.
        if (openPosition) {
            const lastCandle = candles[candles.length - 1];
            const isLong = openPosition.direction === 'long';
            const rawExitPrice = lastCandle.close;
            const slip = rawExitPrice * (stratConfig.slippageBps / 10_000);
            const exitPrice = isLong ? rawExitPrice - slip : rawExitPrice + slip;
            const priceDiff = isLong
                ? exitPrice - openPosition.entryPrice
                : openPosition.entryPrice - exitPrice;
            const grossPnl = priceDiff * openPosition.quantity * contractValue;
            const exitFee = exitPrice * openPosition.quantity * contractValue * stratConfig.exitFeeRate;
            const holdHours = Math.max(0, (lastCandle.time * 1000 - openPosition.entryTime) / 3_600_000);
            const fundingCost = Math.max(
                0,
                stratConfig.fundingRate * (holdHours / 8) * openPosition.entryNotional * (isLong ? 1 : -1)
            );
            const fees = openPosition.entryFee + exitFee;
            const netPnl = grossPnl - fees - fundingCost;
            currentBalance += netPnl;
            peakBalance = Math.max(peakBalance, currentBalance);
            maxDrawdown = Math.max(
                maxDrawdown,
                peakBalance > 0 ? ((peakBalance - currentBalance) / peakBalance) * 100 : 0
            );

            trades.push({
                symbol,
                direction: openPosition.direction,
                entryTime: openPosition.entryTime,
                exitTime: lastCandle.time * 1000,
                durationMinutes: Math.round((lastCandle.time * 1000 - openPosition.entryTime) / 60000),
                entryPrice: openPosition.entryPrice,
                exitPrice,
                quantity: openPosition.quantity,
                leverage: openPosition.leverage,
                margin: openPosition.margin,
                grossPnl: parseFloat(grossPnl.toFixed(4)),
                fees: parseFloat(fees.toFixed(4)),
                fundingCost: parseFloat(fundingCost.toFixed(4)),
                slippage: parseFloat((openPosition.entrySlippage + slip * openPosition.quantity * contractValue).toFixed(4)),
                strategyType: openPosition.strategyType,
                strategyMetadata: openPosition.strategyMetadata,
                regime: openPosition.regime,
                netPnl: parseFloat(netPnl.toFixed(4)),
                result: netPnl >= 0 ? 'win' : 'loss',
                exitReason: 'end_of_test',
                balanceAfter: parseFloat(currentBalance.toFixed(2)),
            });
            equityCurve.push({
                time: lastCandle.time * 1000,
                balance: parseFloat(currentBalance.toFixed(2)),
                trade: 'end_of_test',
            });
            openPosition = null;
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
            strategyType: stratConfig.strategyType || DEFAULT_STRATEGY_TYPE,
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
