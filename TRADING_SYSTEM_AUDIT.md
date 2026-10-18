# CryptoX trading-system audit

Date: 2026-10-18

## Scope and safety boundary

This review covers the repository's market-data, AI, strategy, paper, backtest,
risk, and Delta order paths. Credentials and the local `.env` were not read.
No live order, account mutation, or deployment was performed.

There is no defensible way to promise constant or “unrealistic” profits. A
strategy that appears to do that in a short backtest is usually exploiting
lookahead, optimistic fills, selection bias, leverage, or an unmodeled failure
mode. The correct first goal is **cost-aware, out-of-sample positive
expectancy with bounded drawdown**, followed by a long paper-forward test.

## System map

- React/Vite client under `client/`.
- Express/Mongoose server under `server/`.
- Delta Exchange India is the only implemented exchange.
- Three materially different execution paths exist:
  - manual paper/live orders;
  - `AutomationEngine` AI signal execution;
  - `TradingBot` strategies (`trend_pullback`, breakout/radar, hybrid).
- Paper trading is split between `PaperTradingEngine` and
  `ExecutionEngine._executePaper`, so paper results are not one consistent
  ledger.
- The AI layer supplies signals and regime context; it is not evidence of
  predictive edge by itself. The deterministic filters and execution model
  determine realized P&L.

## Highest-risk findings

### Critical: live trading was not fail-closed

`config.botLiveAllowed` required both `TRADING_MODE=live` and
`ENABLE_LIVE_TRADING=true`, but the live bot, automation, and manual order
paths did not consistently enforce it. Account mode and API-key permissions
were also not a server-side trading boundary.

### High: the backtest and paper fills were optimistic

The prior model used exact stop/target prices, omitted or inconsistently
applied slippage and funding, charged maker fees for every simulated entry,
and dropped open positions at the end of a test. Paper and backtest accounting
also used different execution paths.

### High: configured risk limits were decorative

Daily-loss and consecutive-loss settings were stored and displayed but not
enforced by `checkDailyLimits`. Position quantity was primarily derived from
wallet-part margin rather than the dollar loss implied by the stop distance.

### High: the default reward/risk geometry was structurally weak

The old risk calculation multiplied target distance to create a much wider
stop, while the configured minimum R:R was bypassed whenever `targetRoiPct`
was set. High win rate cannot compensate indefinitely for a net R:R below 1
after fees and adverse execution.

### High: user scoping was unsafe in AI automation

Several automation queries used the first/most-recent user or global updates.
That could mix preferences, paper wallets, logs, and live identity. The
automation control path now carries the authenticated user ID and rejects a
second user taking ownership of an active mode.

## Changes made in this pass

1. Added `server/src/services/trading/liveTradingGuard.js`.
   - New entries require explicit environment enablement, user `accountMode`
     `live`, an active Delta key, and `read_write` permissions.
   - Reduce-only cancellation/close actions remain available to unwind risk.
2. Applied that guard to `OrderExecutor`, live bot start, automation live
   start/execution, and live order/bracket mutation routes.
3. Removed the unsafe bracket-order fallback that retried an entry without
   stop-loss/take-profit protection.
4. Enforced daily-loss and consecutive-loss gates.
5. Changed risk sizing to cap quantity using `riskAmount / stopDistance`.
6. Made stop distance ATR-based and made configured minimum net R:R apply even
   when a target ROI is configured. Defaults are now 1.0 R:R and 1.5 ATR.
7. Improved the backtest execution model with adverse slippage, configurable
   entry/exit fees, funding accrual, gap-through handling, mark-to-market
   drawdown, and forced end-of-test liquidation.
8. Added isolated regression tests in
   `server/test/safety-regression.test.js` and a targeted server test script.
9. Added fail-closed bracket verification for the direct live bot execution
   path; an unverified filled entry attempts a reduce-only unwind instead of
   being recorded as protected.
10. Scoped each running `TradingBot` instance to the authenticated owner so
    starting one user's bot cannot scan every enabled user's configuration.

## New strategy added: `regime_ensemble_v1`

The old entry strategies are still available for comparison, but paper
configurations now migrate to a new deterministic regime ensemble. It uses
completed 5-minute candles and selects among:

- confirmed-volume volatility breakouts after compression;
- trend pullbacks only when EMA, slope, ADX/DI, price location, and RSI agree;
- range-edge mean reversion only in non-trending markets with RSI and candle
  reversal confirmation.

The pure evaluator rejects stale/incomplete/illiquid data and returns explicit
reasons. Its proposed 1.5 ATR stop and 2.25 ATR target are passed through the
shared RiskEngine, which still enforces costs, minimum net R:R, and dollar-risk
position sizing. The strategy is paper-first and new live entries are blocked.
Detailed rules are in `STRATEGY_REGIME_ENSEMBLE_V1.md`.

## What is still not proven

The changes above improve safety and measurement; they do **not** prove that
any strategy is profitable. A live-market backtest was intentionally not run
automatically because this repository fetches external Delta data and the
existing ad-hoc scripts load environment credentials or call external AI
services. No claim of profitability should be made until the following report
is produced from fixed, reproducible data.

## Required research protocol before any live consideration

1. Freeze a candle dataset and record its source, timezone, resolution, and
   completeness. Use only completed candles at each decision timestamp.
2. Split chronologically into train, validation, and untouched test periods.
   Use walk-forward evaluation; do not repeatedly tune on the final period.
3. Replay the production strategy functions, not a look-alike test script.
4. Model bid/ask or a conservative spread, maker/taker fees, GST where
   applicable, funding at its timestamps, partial/non-fills for limits,
   gap-through stops, latency, and forced liquidation of open positions.
5. Compare each strategy with simple baselines: buy-and-hold, flat/no-trade,
   moving-average trend, and a random-entry control with the same exits/costs.
6. Report net expectancy per trade, profit factor, max and average drawdown,
   exposure, turnover, worst losing streak, monthly returns, tail loss, and
   sensitivity to fees/slippage. Win rate alone is not a decision metric.
7. Require stability across symbols and market regimes. Reject a strategy if
   one symbol, one month, or one parameter value explains most of the result.
8. Run a paper-forward period with the same live data feed and execution
   rules. A candidate should survive at least several weeks and a meaningful
   trade count before a tiny, manually approved live experiment is considered.

Suggested promotion gates are deliberately conservative, not guarantees:

- positive net expectancy after doubled assumed slippage;
- profit factor above 1.1 on untouched data, not just training data;
- bounded drawdown agreed in advance, with no limit breach;
- no dependence on reverse mode, extreme leverage, or one asset;
- paper-forward results consistent with the backtest within a predeclared
  tolerance;
- an operator-approved live key with a separate low-risk budget and an
  independent kill switch.

## Public-project research conclusion

Open-source bots and strategy repositories can provide implementation ideas,
but their README claims are not audited proof of live profitability. Public
leaderboards and screenshots are especially vulnerable to survivorship and
selection bias. This project should borrow engineering patterns—event-sourced
fills, reproducible datasets, walk-forward evaluation, and exchange-side risk
reconciliation—not copy a claimed “best strategy”.

The public Freqtrade project is a useful engineering reference rather than a
profit guarantee. Its own README says to start in dry-run and use the software
at the operator's risk. Its official documentation also provides a dedicated
lookahead-analysis command because full-data indicator calculation can make a
backtest look profitable while cheating with future candles. Those are the
same classes of failure found in this repository's partial-candle and
optimistic-fill paths.

References reviewed:

- https://github.com/freqtrade/freqtrade
- https://www.freqtrade.io/en/stable/lookahead-analysis/
- https://www.freqtrade.io/en/stable/backtesting/

## Checks run

From `server/`:

```text
npm test
node --check src/services/trading/liveTradingGuard.js
node --check src/services/trading/OrderExecutor.js
node --check src/services/bot/RiskEngine.js
node --check src/services/bot/BacktestEngine.js
node --check src/services/bot/ExecutionEngine.js
node --check src/services/bot/PositionMonitor.js
node --check src/services/bot/EntryOrderWatcher.js
node --check src/services/ai/AutomationEngine.js
node --check src/routes/automation.js
node --check src/routes/bot.js
```

The targeted test suite passes. The client lint command remains an existing
gap (`npm run lint` previously reported 102 problems); it was not changed as
part of this backend safety slice. The repository still has unrelated
uncommitted files; they were preserved.

## Next concrete step

Build a deterministic offline replay command that accepts a local candle file,
runs every current strategy through the revised cost/risk model, and writes a
per-strategy walk-forward report. Only that report can tell us whether to keep
`trend_pullback`, breakout/radar, a simpler baseline, or no-trade. Until it
passes the promotion gates, keep live **entry** permission disabled.
