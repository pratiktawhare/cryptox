# Regime Ensemble v1

Status: **paper-first research strategy**

This is the new default for paper TradingBot configurations. It is not enabled
for new live entries. It replaces the old single-entry mindset with a regime
selector that chooses a setup only when the market structure matches it.

## Decision pipeline

Input is completed 5-minute OHLCV data only. The live CandleStore removes the
currently forming candle before evaluation.

1. Reject invalid, incomplete, stale, future, non-chronological, or illiquid
   data.
2. Calculate EMA, EMA slope, ATR, RSI, ADX/DI, Bollinger bandwidth, and volume
   ratio.
3. Classify the market in this priority order:
   - **Compression**: Bollinger and ATR-percent squeeze.
   - **Trend**: EMA separation/slope, ADX, price location, DI, and RSI agree.
   - **Range**: valid non-trending market that is not compressed.
4. Choose exactly one setup:
   - compression → confirmed breakout with ATR buffer and volume expansion;
   - trend → pullback to the fast EMA with a reversal candle;
   - range → edge mean reversion with RSI confirmation and reversal candle.
5. If the setup is not confirmed, return `NO_TRADE` with machine-readable
   rejection reasons.
6. Pass the proposed geometry through the shared RiskEngine, which can widen a
   target to cover costs/R:R requirements and can reduce quantity to respect
   dollar risk.

## Initial geometry and limits

- Stop: `1.5 × ATR`.
- Target: `2.25 × ATR` (1.5R before costs).
- Paper default risk: 1% per trade.
- Paper default maximum leverage: 5x.
- Paper default maximum open positions: 1.
- Minimum effective net R:R: 1.0.
- Reverse mode is ignored for this strategy; it is not a validated edge.
- New live entries are rejected while this strategy is selected.

These values are starting hypotheses, not optimized truths. They must be
validated with walk-forward tests across symbols and market regimes. The
strategy intentionally prefers fewer trades over forced activity.

## Files

- Pure evaluator: `server/src/services/bot/regime_ensemble_v1.js`
- Selection adapter: `server/src/services/bot/strategySelector.js`
- Identifiers/defaults: `server/src/services/bot/strategyTypes.js`
- Paper/backtest integration: `server/src/services/bot/TradingBot.js` and
  `server/src/services/bot/BacktestEngine.js`
- UI configuration: `client/src/components/bot/BotConfigModal.jsx`
- Runtime safety summary: `client/src/components/bot/BotStrategySafety.jsx`
- Tests: `server/test/regime_ensemble_v1.test.js` and
  `server/test/regime-ensemble-integration.test.js`

## What would count as success

The strategy should not be promoted because it produces a high win rate in a
short sample. It needs:

- positive net expectancy after fees, slippage, and funding;
- stable performance on an untouched time period;
- no dependence on one symbol or one regime;
- bounded drawdown and losing streaks;
- paper-forward behavior close to the replay model;
- no live entry until those checks are recorded.

## First public-data smoke check

Using the revised replay engine on Delta public 5-minute candles from
2026-10-04 10:24 UTC through 2026-10-18 10:24 UTC, with a $100 starting
balance, 1% risk, 5x maximum leverage, 1.0 minimum R:R, and 1.5 ATR stops:

| Symbol | Trades | Return | Profit factor | Max drawdown | Win rate |
|---|---:|---:|---:|---:|---:|
| BTCUSD | 6 | -2.21% | 0.66 | 3.8% | 16.7% |
| ETHUSD | 3 | -4.33% | 0.00 | 4.3% | 0.0% |
| DOGEUSD | 6 | +4.48% | 2.25 | 4.0% | 50.0% |
| SOLUSD | 3 | -3.87% | 0.00 | 3.9% | 0.0% |

This is **not** evidence of profitability: it is only 18 trades over one short
period and four symbols. It does show why the paper default must be treated as
an experiment, and why asset/regime selection and longer walk-forward testing
are still required. The legacy trend-pullback comparison was also mixed, so no
strategy was promoted to live use.
