# Phase 9 — Risk Management, Analytics & Self-Learning

> **Goal:** Track signal accuracy, learn from past mistakes to improve future predictions, enforce budget/risk rules, and display comprehensive analytics dashboards.

---

## Dependencies
- Phase 8 complete (both live and paper trading functional)

## Estimated Effort
- Backend: ~6 hours
- Frontend: ~6 hours

---

## Backend Tasks

### 1. Signal Tracker
**File:** `server/src/services/ai/SignalTracker.js`

**Monitors active signals against live price (runs every 30 seconds):**

```javascript
async trackActiveSignals() {
  const activeSignals = await TradeSignal.find({ status: 'active' });

  for (const signal of activeSignals) {
    const price = this.getTickerPrice(signal.coinSymbol);
    if (!price) continue;

    // Check if target was hit
    if (signal.signalType === 'LONG' && price >= signal.targetPrice) {
      await this.resolveSignal(signal, 'hit_target', price);
    }
    if (signal.signalType === 'SHORT' && price <= signal.targetPrice) {
      await this.resolveSignal(signal, 'hit_target', price);
    }

    // Check if stop-loss was hit
    if (signal.signalType === 'LONG' && price <= signal.stopLoss) {
      await this.resolveSignal(signal, 'hit_stoploss', price);
    }
    if (signal.signalType === 'SHORT' && price >= signal.stopLoss) {
      await this.resolveSignal(signal, 'hit_stoploss', price);
    }

    // Check if signal expired (48 hours old)
    const ageHours = (Date.now() - signal.createdAt) / (1000 * 60 * 60);
    if (ageHours > 48) {
      await this.resolveSignal(signal, 'expired', price);
    }
  }
}

async resolveSignal(signal, status, outcomePrice) {
  const pnlPct = signal.signalType === 'LONG'
    ? ((outcomePrice - signal.entryPrice) / signal.entryPrice) * 100
    : ((signal.entryPrice - outcomePrice) / signal.entryPrice) * 100;

  signal.status = status;
  signal.outcomePrice = outcomePrice;
  signal.outcomePnlPct = pnlPct;
  signal.isCorrect = status === 'hit_target';
  signal.resolvedAt = new Date();
  await signal.save();

  // Trigger self-learning
  await SelfLearning.recordOutcome(signal);

  // Emit notification
  this.emitNotification(signal, status);
}
```

### 2. Self-Learning System
**File:** `server/src/services/ai/SelfLearning.js`

**After each resolved signal:**

```javascript
async recordOutcome(signal) {
  // 1. Determine which indicators supported the correct direction
  const snapshot = signal.indicatorsSnapshot;
  const actualDirection = signal.isCorrect ? signal.signalType : (signal.signalType === 'LONG' ? 'SHORT' : 'LONG');

  const indicatorsWorked = [];
  const indicatorsFailed = [];

  // Check RSI
  if (snapshot.rsi) {
    const rsiBullish = snapshot.rsi.value < 30;
    const rsiBearish = snapshot.rsi.value > 70;
    if ((actualDirection === 'LONG' && rsiBullish) || (actualDirection === 'SHORT' && rsiBearish)) {
      indicatorsWorked.push('RSI');
    } else if ((actualDirection === 'LONG' && rsiBearish) || (actualDirection === 'SHORT' && rsiBullish)) {
      indicatorsFailed.push('RSI');
    }
  }

  // ... similar checks for MACD, EMA, Bollinger, ADX, etc.

  // 2. Categorize error type
  let errorType = null;
  if (!signal.isCorrect) {
    if (signal.candlePatterns?.some(p => p.name.includes('engulfing'))) {
      errorType = 'pattern_false_signal';
    } else if (Math.abs(snapshot.rsi?.value - 50) < 10) {
      errorType = 'weak_momentum';
    } else {
      errorType = 'trend_reversal';
    }
  }

  // 3. Generate lesson learned via Gemini (lightweight call)
  const lesson = await this.generateLesson(signal, indicatorsWorked, indicatorsFailed, errorType);

  // 4. Save correction
  await AiCorrection.create({
    signalId: signal._id,
    predictedDirection: signal.signalType,
    actualDirection,
    isCorrect: signal.isCorrect,
    errorType,
    lessonLearned: lesson,
    indicatorsThatWorked: indicatorsWorked,
    indicatorsThatFailed: indicatorsFailed,
    confluenceScore: signal.confluenceScore,
    marketRegime: signal.marketRegime
  });
}

async generateLesson(signal, worked, failed, errorType) {
  const prompt = `A ${signal.signalType} signal on ${signal.coinSymbol} at $${signal.entryPrice} ${signal.isCorrect ? 'was correct' : 'was wrong'}.
Indicators that worked: ${worked.join(', ') || 'none'}
Indicators that failed: ${failed.join(', ') || 'none'}
Error type: ${errorType || 'none'}
Confluence score was: ${signal.confluenceScore}/100
Market regime: ${signal.marketRegime}

Write a 1-2 sentence lesson learned for future trading decisions.`;

  const response = await geminiClient.generateContent(prompt);
  return response.text();
}
```

**Building self-learning context for prompts:**
```javascript
async buildLearningContext() {
  const recentCorrections = await AiCorrection.find()
    .sort({ createdAt: -1 })
    .limit(20);

  const stats = {
    total: recentCorrections.length,
    correct: recentCorrections.filter(c => c.isCorrect).length,
    winRate: 0,
    topIndicators: {},
    commonErrors: {}
  };

  stats.winRate = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;

  // Count indicator reliability
  for (const corr of recentCorrections) {
    for (const ind of corr.indicatorsThatWorked) {
      stats.topIndicators[ind] = (stats.topIndicators[ind] || 0) + 1;
    }
    if (corr.errorType) {
      stats.commonErrors[corr.errorType] = (stats.commonErrors[corr.errorType] || 0) + 1;
    }
  }

  // Format for prompt
  return {
    winRate: stats.winRate,
    signalCount: stats.total,
    topIndicators: Object.entries(stats.topIndicators)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => `${name} (${count}/${stats.total} correct)`),
    commonErrors: Object.entries(stats.commonErrors)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([type, count]) => `${type}: ${count} occurrences`),
    recentLessons: recentCorrections
      .filter(c => !c.isCorrect && c.lessonLearned)
      .slice(0, 5)
      .map(c => c.lessonLearned)
  };
}
```

### 3. AI Correction Model
**File:** `server/src/models/AiCorrection.js`

```javascript
const aiCorrectionSchema = new Schema({
  signalId:            { type: ObjectId, ref: 'TradeSignal', required: true },
  predictedDirection:  { type: String, required: true },
  actualDirection:     { type: String, required: true },
  isCorrect:           { type: Boolean, required: true },
  errorType:           String,
  lessonLearned:       String,
  indicatorsThatWorked: [String],
  indicatorsThatFailed: [String],
  confluenceScore:     Number,
  marketRegime:        String
}, { timestamps: true });

aiCorrectionSchema.index({ createdAt: -1 });
```

### 4. Risk Manager
**File:** `server/src/services/RiskManager.js`

**Called before every trade execution (live and paper):**

```javascript
class RiskManager {
  async validateTrade(userId, orderParams) {
    const prefs = await UserPreferences.findOne({ userId });
    const account = await this.getAccountState(userId, orderParams.mode);

    const errors = [];

    // 1. Max single trade %
    const tradeValue = orderParams.quantity * orderParams.entryPrice;
    const maxTradeValue = account.available * (prefs.maxSingleTradePct / 100);
    if (tradeValue > maxTradeValue) {
      errors.push(`Trade value $${tradeValue} exceeds max ${prefs.maxSingleTradePct}% ($${maxTradeValue})`);
    }

    // 2. Max concurrent positions
    if (account.openPositions >= prefs.maxConcurrentPositions) {
      errors.push(`Already at max ${prefs.maxConcurrentPositions} concurrent positions`);
    }

    // 3. Max leverage
    if (orderParams.leverage > prefs.maxLeverage) {
      errors.push(`Leverage ${orderParams.leverage}x exceeds max ${prefs.maxLeverage}x`);
    }

    // 4. Risk per trade %
    const riskAmount = Math.abs(orderParams.entryPrice - orderParams.stopLoss) * orderParams.quantity;
    const maxRisk = account.equity * (prefs.maxRiskPerTradePct / 100);
    if (riskAmount > maxRisk) {
      errors.push(`Risk $${riskAmount} exceeds max ${prefs.maxRiskPerTradePct}% ($${maxRisk})`);
    }

    // 5. Reserve check
    const reserveAmount = account.equity * (prefs.minReservePct / 100);
    const marginRequired = tradeValue / orderParams.leverage;
    if (account.available - marginRequired < reserveAmount) {
      errors.push(`Would breach ${prefs.minReservePct}% reserve requirement`);
    }

    // 6. Daily loss limit
    const todayLoss = await this.getTodayRealizedLoss(userId, orderParams.mode);
    if (todayLoss > account.equity * 0.05) {  // 5% daily loss limit
      errors.push('Daily loss limit reached. No new trades allowed today.');
    }

    return {
      isValid: errors.length === 0,
      errors,
      isLargeOrder: tradeValue > account.equity * 0.25,
      warnings: tradeValue > account.equity * 0.15
        ? [`Large trade: ${((tradeValue / account.equity) * 100).toFixed(1)}% of equity`]
        : []
    };
  }
}
```

---

## Frontend Tasks

### 5. Analytics Page
**File:** `client/src/pages/Analytics.jsx`

**Full analytics dashboard with charts and stats:**

```
┌──────────────────────────────────────────────────────────────┐
│  📊 Trading Analytics          [LIVE ▼] [Last 30 days ▼]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │  Win Rate    │ │  Total P&L  │ │  Profit     │            │
│  │   65%        │ │  +$127.50   │ │  Factor     │            │
│  │  🟢 13/20   │ │  🟢         │ │   1.8x      │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Equity Curve                                        │    │
│  │  $10,200 ─╲╱─────╱──────╱─────╱╲─────╱──            │    │
│  │  $10,000 ──────────────────────────────────           │    │
│  │  $9,800  ─────────╲──────╲──────╲────────            │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────┐  ┌───────────────────────────┐    │
│  │  P&L by Coin          │  │  Accuracy by Confluence   │    │
│  │  BTC  ████████ +$85   │  │  80-100: 78% ████████    │    │
│  │  ETH  ███ +$30        │  │  60-79:  62% ██████      │    │
│  │  SOL  ██ +$15         │  │  40-59:  45% ████        │    │
│  │  XRP  █ -$3           │  │  0-39:   30% ███         │    │
│  └──────────────────────┘  └───────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  AI Learning Insights                                │    │
│  │                                                      │    │
│  │  Most Reliable Indicators:                           │    │
│  │  1. EMA Alignment (12/15 correct)                    │    │
│  │  2. RSI (10/15 correct)                              │    │
│  │  3. MACD Crossover (9/15 correct)                    │    │
│  │                                                      │    │
│  │  Common Mistakes:                                    │    │
│  │  • Pattern false signals (4 times)                   │    │
│  │  • Weak momentum entries (3 times)                   │    │
│  │                                                      │    │
│  │  Recent Lessons:                                     │    │
│  │  "Avoid LONG entries when RSI > 65 on 4h timeframe"  │    │
│  │  "EMA alignment is strong but needs volume confirm"  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Chart library:** Use lightweight-charts for equity curve, vanilla SVG for donut/bar charts

**Sections:**
1. **Summary Cards:** Win rate, total P&L, profit factor, total trades, best/worst trade
2. **Equity Curve:** Line chart showing account value over time (from snapshots)
3. **P&L by Coin:** Horizontal bar chart
4. **Accuracy by Confluence Score:** Shows higher confluence = better accuracy
5. **AI Learning Insights:** Most reliable indicators, common mistakes, recent lessons
6. **Mode selector:** LIVE vs PAPER analytics are separate

### 6. Analytics Components
**Files:**
- `client/src/components/analytics/EquityCurve.jsx` — line chart from equity snapshots
- `client/src/components/analytics/WinRateChart.jsx` — donut chart (wins vs losses)
- `client/src/components/analytics/PnLByCoins.jsx` — horizontal bar chart
- `client/src/components/analytics/LearningInsights.jsx` — indicator reliability + lessons

---

## Navigation Update
- Add "Analytics" icon + link to navigation
- Route: `<Route path="/analytics" element={<Analytics />} />`

---

## Verification Checklist
- [ ] Signal tracker auto-resolves signals when target/SL is hit
- [ ] Expired signals are marked after 48 hours
- [ ] AI corrections are saved with correct indicator analysis
- [ ] Lesson generation produces meaningful 1-2 sentence insights
- [ ] Self-learning context is included in AI prompts (check prompt logs)
- [ ] Risk manager rejects trades exceeding budget limits
- [ ] Daily loss limit pauses new signal generation
- [ ] Analytics page renders all charts with correct data
- [ ] Equity curve shows data from snapshots
- [ ] Win rate is accurate against resolved signals
- [ ] LIVE and PAPER analytics are independent
- [ ] Confluence score correlation is visible in accuracy chart
