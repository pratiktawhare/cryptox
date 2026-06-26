# Phase 6 — Gemini AI Trade Signal Engine

> **Goal:** Every 5 minutes, the Gemini AI scans ALL available Delta Exchange perpetual futures, identifies the most interesting setups via a fast pre-screen, runs deep analysis on the top candidates, then produces actionable trade signals with entry, target, stop-loss, quantity, leverage, and detailed reasoning — all tailored to the user's budget and risk appetite.
>
> **No coin selection step.** Every coin is always available for charting, analysis, and trading. The AI decides which coins are worth signaling.

---

## Dependencies
- Phase 5 complete (MarketAnalyzer producing full AnalysisSnapshot)
- Google Gemini API key configured in `.env`

## Estimated Effort
- Backend: ~8 hours
- Frontend: ~6 hours

## NPM Packages Needed
```bash
cd server
npm install @google/generative-ai
```

## Environment Variables
```env
GEMINI_API_KEY=your_gemini_api_key_here
SIGNAL_INTERVAL_MS=300000   # 5 minutes = 300,000ms
```

---

## Backend Tasks

### 1. Gemini Client
**File:** `server/src/services/ai/GeminiClient.js`

**Configuration:**
- Model: `gemini-2.5-flash` (fast, cheap, supports structured output)
- Temperature: `0.15` (deterministic for trading decisions)
- Max output tokens: 8192
- Structured output: `responseMimeType: 'application/json'` + `responseSchema`
- Retry: 3 attempts, exponential backoff (1s, 2s, 4s)
- Timeout: 60 seconds per request
- Rate limit tracking: log input/output tokens per call

**Response Schema (enforced JSON):**
```javascript
const signalSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      symbol:        { type: 'string' },
      action:        { type: 'string', enum: ['LONG', 'SHORT', 'CLOSE', 'HOLD'] },
      confidence:    { type: 'number', minimum: 0, maximum: 100 },
      riskLevel:     { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      entryPrice:    { type: 'number' },
      targetPrice:   { type: 'number' },
      stopLoss:      { type: 'number' },
      suggestedLeverage: { type: 'number', minimum: 1, maximum: 20 },
      suggestedQuantityPct: { type: 'number', minimum: 1, maximum: 100 },
      riskRewardRatio: { type: 'string' },
      reasoning:     { type: 'string' },
      keyFactors:    { type: 'array', items: { type: 'string' } },
      warnings:      { type: 'array', items: { type: 'string' } },
      marketRegime:  { type: 'string', enum: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE', 'BREAKOUT'] },
      timeframe:     { type: 'string' }
    },
    required: ['symbol', 'action', 'confidence', 'entryPrice', 'reasoning']
  }
};
```

### 2. Prompt Builder
**File:** `server/src/services/ai/PromptBuilder.js`

**System Prompt Structure:**
```
You are CryptoX-AI, a professional quantitative trading analyst.

ROLE:
- You analyze crypto perpetual futures on Delta Exchange India
- Your decisions are conservative and risk-managed
- You only suggest trades when multiple indicators align (confluence)
- You NEVER chase pumps or revenge trade

HARD CONSTRAINTS (code-enforced, you cannot override):
- Maximum leverage: {maxLeverage}x
- Maximum single trade: {maxSingleTradePct}% of available balance
- Minimum risk-reward ratio: 1.5:1
- Maximum concurrent positions: {maxConcurrentPositions}
- Risk per trade: maximum {maxRiskPerTradePct}% of total equity

AI GUIDANCE (follow these unless you have strong reason not to):
- Prefer setups with confluence score > 60
- Do NOT trade against the higher-timeframe (4h) trend
- Weight Smart Money signals (order blocks, FVGs) heavily
- If BTC is in a strong move, avoid altcoin longs against BTC direction
- Consider funding rate — high positive rate = crowded long, higher short risk

SELF-LEARNING CONTEXT:
{recentCorrections}
- Your recent accuracy: {winRate}% over last {signalCount} signals
- Indicators that have been most reliable: {topIndicators}
- Common mistakes to avoid: {commonErrors}

OUTPUT FORMAT:
Return a JSON array of trade signals. Include ONLY coins where you have
a clear, high-conviction setup. If no good setup exists, return an empty array.
For each signal, provide detailed reasoning explaining your analysis step by step.
```

**User Prompt Structure:**
```
CURRENT TIME: {timestamp} IST
MARKET SESSION: {session}

═══ ACCOUNT STATUS ═══
Total Equity: {equity} USDT
Available Balance: {available} USDT
Unrealized P&L: {unrealizedPnL} USDT
Open Positions: {positionCount}/{maxPositions}

═══ OPEN POSITIONS ═══
{For each position:}
  {symbol} | {side} | Entry: {entry} | Current: {mark} | P&L: {pnl} ({pnlPct}%) | Leverage: {lev}x

═══ BTC MARKET OVERVIEW ═══
Price: {btcPrice} | 24h: {btc24h}% | Trend (4h): {btcTrend}
{btcIndicatorSummary}

═══ COIN ANALYSIS ═══
{For each candidate coin (pre-screened top movers):}
────── {symbol} ──────
Price: {price} | 24h: {change24h}% | Volume: {volume24h}
Confluence Score: {confluenceScore}/100 | Regime: {marketRegime}

Trend Indicators:
  EMA Alignment: {emaAlignment}
  ADX: {adx} ({adxInterpretation})
  Supertrend: {supertrendDirection}

Momentum:
  RSI(14): {rsi} ({rsiZone})
  MACD: {macdInterpretation}
  Stochastic RSI: K={stochK}, D={stochD}

Volume:
  OBV Trend: {obvTrend}
  VWAP Position: {vwapPosition}
  Volume vs Avg: {volumeRatio}x

Volatility:
  BB Position: {bbPosition}
  ATR: {atr} ({atrPct}% of price)

Candlestick Patterns: {patternList}

Key Levels:
  Strong Support: {supports}
  Strong Resistance: {resistances}

Smart Money:
  Order Blocks: {orderBlocks}
  Fair Value Gaps: {fvgs}
  Liquidity Zones: {liquidityZones}

Recent Trades for {symbol}: {recentTrades}
──────────────────────

INSTRUCTION: Analyze all coins above. For each coin where you see a clear,
high-conviction trading opportunity, output a signal with entry, target,
stop-loss, suggested leverage, and detailed step-by-step reasoning.
If no good setup exists for a coin, skip it entirely.
```

### 3. Signal Engine (Scheduler)
**File:** `server/src/services/ai/SignalEngine.js`

**Two-stage scanning (runs every 5 minutes):**

#### Stage 1: Fast Pre-Screen (all coins, ~2 seconds)
```
1. Get ALL perpetual futures from ProductCatalog (50+ coins)
2. For each coin, compute a quick "interest score" from the ticker map:
   - Absolute 24h change > 3%  → +20 points (momentum)
   - Volume above 2× daily average → +15 points (activity)
   - RSI(14) < 30 or > 70        → +15 points (extreme)
   - Near a known S/R level       → +10 points (setup)
   - Has an open position         → +20 points (must monitor)
   - In user's watchlist           → +10 points (user interest)
3. Sort by interest score, take top 10–15 candidates
4. Always include: BTC, ETH, and any coin with open positions
```

#### Stage 2: Deep Analysis (top candidates, ~10 seconds)
```
1. For each candidate: await MarketAnalyzer.analyze(symbol)
2. Get account balance + open positions from Delta API
3. Get self-learning context from AiCorrection collection
4. Build system prompt + user prompt via PromptBuilder
5. Call GeminiClient.generateSignal(systemPrompt, userPrompt)
6. Parse response → array of TradeSignal objects
7. For each signal:
   a. Calculate position sizing based on budget rules
   b. Calculate margin required, risk amount, liquidation price
   c. Save to MongoDB TradeSignal collection
   d. Emit Socket.IO event: 'new_signal'
8. Log: tokens used, latency, signal count, coins scanned
```

> **Why two stages?** Analyzing 50+ coins with full indicators every 5 minutes would be too slow and expensive on Gemini tokens. The pre-screen filters for interesting setups first, then the AI focuses its analysis on the best candidates. The user can still manually view charts/indicators for ANY coin at any time.

**Position sizing calculation:**
```javascript
function calculatePositionSize(signal, account, preferences) {
  const maxAllocation = account.available * (preferences.maxSingleTradePct / 100);
  const suggestedAllocation = maxAllocation * (signal.suggestedQuantityPct / 100);
  const leverage = Math.min(signal.suggestedLeverage, preferences.maxLeverage);
  const effectivePosition = suggestedAllocation * leverage;
  const quantity = effectivePosition / signal.entryPrice;
  const marginRequired = effectivePosition / leverage;
  const riskAmount = Math.abs(signal.entryPrice - signal.stopLoss) * quantity;
  const riskPctOfBudget = (riskAmount / account.equity) * 100;

  return {
    recommendedAllocationPct: signal.suggestedQuantityPct,
    recommendedAllocationAmount: suggestedAllocation,
    suggestedLeverage: leverage,
    effectivePosition,
    quantity,
    marginRequired,
    riskAmount,
    riskPctOfBudget,
    liquidationPrice: calculateLiquidation(signal, leverage)
  };
}
```

### 4. Trade Signal Model
**File:** `server/src/models/TradeSignal.js`

Full schema as specified in the master plan, plus:
- `mode: { type: String, enum: ['live', 'paper'] }`
- `positionSizing: { ... }` — calculated sizing details
- `indicatorsSnapshot: { ... }` — full indicator state at signal time
- `candlePatterns: [...]` — detected patterns
- `smartMoneyConcepts: { ... }` — OBs, FVGs, liquidity
- `keyLevels: { ... }` — S/R levels
- `confluenceScore: Number`
- `marketRegime: String`
- Indexes on: `{ status: 1, createdAt: -1 }`, `{ coinSymbol: 1, status: 1 }`

### 5. Signal Routes
**File:** `server/src/routes/signals.js`

```
GET  /api/signals              — paginated list (filter: coin, status, mode)
GET  /api/signals/:id          — single signal with full snapshot
PATCH /api/signals/:id/dismiss — mark as dismissed/cancelled
GET  /api/signals/stats        — accuracy stats (win rate, avg R:R)
```

---

## Frontend Tasks

### 6. Signals Page
**File:** `client/src/pages/Signals.jsx`

**Full-page signal feed:**
- Latest signals at top, reverse chronological
- Real-time: new signals push to top with slide-in animation
- **Filter tabs:** All | Active | Hit Target | Hit SL | Expired | Dismissed
- **Filter dropdown:** By coin, by confidence range, by signal type
- Empty state: "No signals yet. The AI scans all markets every 5 minutes for high-conviction setups."

### 7. Signal Card Component
**File:** `client/src/components/signals/SignalCard.jsx`

**Premium glassmorphic card:**
```
┌──────────────────────────────────────────────────────────────┐
│  🟢 LONG  BTC/USD                    Confidence: ██████░ 78% │
│                                                               │
│  Entry: $68,200    Target: $70,500    Stop Loss: $67,100     │
│  ├────────■──────────────────────────────────■─────────────┤  │
│  SL              ▲ Entry                    Target            │
│                                                               │
│  R:R Ratio: 2.8:1  │  Leverage: 5x  │  Margin: $450         │
│  Risk: $110 (1.2% of equity)                                 │
│                                                               │
│  ▼ AI Reasoning (click to expand)                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. BTC is in a confirmed uptrend on 4h (EMA 9>21>50) │  │
│  │ 2. RSI(14) at 45 — neutral with room to run           │  │
│  │ 3. Bullish engulfing pattern on 1h at strong support   │  │
│  │ 4. FVG at $68,000-$68,300 acting as demand zone       │  │
│  │ 5. Volume above 20-period average (1.4x)              │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  Patterns: [Bullish Engulfing] [Hammer]                      │
│  Regime: TRENDING_UP   │  Confluence: 72/100                 │
│                                                               │
│  [📈 Buy Now]    [✏️ Edit & Buy]    [❌ Dismiss]              │
└──────────────────────────────────────────────────────────────┘
```

**Features:**
- Gradient accent: green for LONG, red for SHORT, gray for HOLD
- Animated confidence ring (SVG circle)
- Expandable reasoning section
- Live price indicator showing current vs entry
- Click "Buy Now" → opens TradeConfirmDialog (Phase 7)
- Click "Edit & Buy" → opens TradeEditDialog (Phase 7)
- Click "Dismiss" → PATCH dismiss API

---

## Verification Checklist
- [ ] Gemini API key configured and test call returns valid JSON
- [ ] PromptBuilder produces well-structured prompts under token limit
- [ ] SignalEngine runs every 5 minutes and produces signals
- [ ] Signals are saved to MongoDB with all fields populated
- [ ] Signal cards render correctly with all data
- [ ] New signals push to frontend in real-time via Socket.IO
- [ ] Position sizing calculation is correct (margin, risk, leverage)
- [ ] Filter tabs work correctly on Signals page
- [ ] Expandable reasoning section renders markdown correctly
- [ ] Structured JSON output is valid and parseable every time
