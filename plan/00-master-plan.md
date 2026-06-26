# CryptoX — AI-Powered Crypto Trading Intelligence Platform (v3)

> **Personal, secure, AI-driven crypto analysis dashboard with real-time charts, intelligent trade signals, budget management, leverage support, and self-learning capabilities.**

---

## What Changed in v3

| Change | v2 (Old) | v3 (New) |
|---|---|---|
| **Database** | SQLite + better-sqlite3 | **MongoDB + Mongoose** |
| **Candlestick Patterns** | Basic (Doji, Hammer, Engulfing) | **35+ patterns** (all major reversal + continuation) |
| **Indicators** | RSI, MACD, Bollinger, EMA, ATR | **20+ indicators** including Ichimoku, Stochastic, ADX, OBV, VWAP, Fibonacci, Supertrend |
| **Support/Resistance** | Simple pivot points | **4 detection methods** (Swing, Pivot, Volume Profile, Fibonacci) |
| **Advanced Concepts** | None | **Smart Money Concepts** (Order Blocks, FVGs, Liquidity Sweeps) |
| **Confluence** | Single timeframe | **Multi-timeframe confluence scoring** |

---

## Application Overview

CryptoX is a private, single-user crypto trading intelligence platform that connects to Delta Exchange via API, streams real-time market data, runs a comprehensive technical analysis engine with 35+ candle patterns and 20+ indicators across multiple timeframes, then uses Google Gemini AI to synthesize everything into actionable trade signals with entry, target, stop-loss, position sizing, leverage suggestions, and detailed reasoning — all tailored to your budget and risk appetite.

---

## Tech Stack

| Layer | Technology | Change |
|---|---|---|
| Frontend | Vite + React | — |
| Charts | TradingView Lightweight Charts | — |
| Styling | Tailwind CSS v4 | 🆕 Changed from Vanilla CSS |
| Backend | Node.js + Express | — |
| **Database** | **MongoDB + Mongoose** | 🆕 Changed from SQLite |
| Auth | JWT (HttpOnly cookies) | — |
| Exchange WS | Native `ws` → Delta Exchange | — |
| Client WS | Socket.IO (backend → frontend) | — |
| **Indicators** | **`technicalindicators` (v2.x or `@wahack/technicalindicators`) + custom pattern implementations** | 🆕 Expanded |
| AI | Google Gemini 2.5 Flash via `@google/generative-ai` (structured JSON output) | — |
| Encryption | AES-256-GCM (API keys at rest) | — |
| Passwords | bcrypt | — |

### MongoDB Setup
```bash
# Using mongoose ODM
npm install mongoose
```
- **Connection:** `mongodb://localhost:27017/cryptox` (local MongoDB instance)
- **Or:** MongoDB Atlas free tier (cloud, 512MB free) if you prefer cloud
- Mongoose provides schema validation, middleware hooks, and clean query API

---

## MongoDB Schema Design

### User Schema
```javascript
const userSchema = new Schema({
    username:      { type: String, unique: true, required: true, minlength: 3 },
    passwordHash:  { type: String, required: true },
    displayName:   { type: String, default: 'Trader' },
    lastLogin:     { type: Date }
}, { timestamps: true });
```

### API Key Schema
```javascript
const apiKeySchema = new Schema({
    userId:              { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name:                { type: String, required: true },
    exchange:            { type: String, default: 'delta', enum: ['delta', 'binance'] },
    apiKeyEncrypted:     { type: String, required: true },
    apiSecretEncrypted:  { type: String, required: true },
    iv:                  { type: String, required: true },
    authTag:             { type: String, required: true },
    isActive:            { type: Boolean, default: false },
    permissions:         { type: String, default: 'read', enum: ['read', 'read_write'] }
}, { timestamps: true });
```

### User Preferences Schema
```javascript
const preferencesSchema = new Schema({
    userId:     { type: Schema.Types.ObjectId, ref: 'User', unique: true },
    
    // Budget & Portfolio
    totalBudget:             { type: Number, default: 0 },
    budgetCurrency:          { type: String, default: 'INR', enum: ['INR', 'USD'] },
    maxConcurrentPositions:  { type: Number, default: 5 },
    maxSingleTradePct:       { type: Number, default: 30 },
    minReservePct:           { type: Number, default: 20 },
    
    // Leverage
    maxLeverage:             { type: Number, default: 10, min: 1, max: 20 },
    autoLeverageSuggestion:  { type: Boolean, default: true },
    
    // Risk
    riskTolerance:           { type: String, default: 'medium', enum: ['low', 'medium', 'high'] },
    maxRiskPerTradePct:      { type: Number, default: 2.0 },
    
    // Coins
    trackedCoins:            [{ type: String }],  // ['BTCUSD', 'ETHUSD', ...]
    
    // Profit
    profitTargetPct:         { type: Number, default: 2.0 },
    
    // Scan
    scanFrequency:           { type: String, default: '5m', enum: ['1m', '5m', '15m', 'manual'] },
    
    // Notifications
    notificationSound:       { type: Boolean, default: true },
    notificationTypes:       [{ type: String }],  // ['signal', 'alert', 'system']
    
    // Theme
    theme:                   { type: String, default: 'dark', enum: ['dark', 'light'] }
}, { timestamps: true });
```

### Trade Signal Schema
```javascript
const tradeSignalSchema = new Schema({
    coinSymbol:    { type: String, required: true, index: true },
    signalType:    { type: String, required: true, enum: ['LONG', 'SHORT', 'NEUTRAL'] },
    confidence:    { type: Number, required: true, min: 0, max: 100 },
    riskLevel:     { type: String, required: true, enum: ['LOW', 'MEDIUM', 'HIGH'] },
    
    // Prices
    entryPrice:    { type: Number, required: true },
    targetPrice:   { type: Number, required: true },
    stopLoss:      { type: Number, required: true },
    riskRewardRatio: { type: String },
    
    // Position Sizing
    positionSizing: {
        recommendedAllocationPct: Number,
        recommendedAllocationAmount: Number,
        suggestedLeverage:  Number,
        effectivePosition:  Number,
        marginRequired:     Number,
        liquidationPrice:   Number,
        riskAmount:         Number,
        riskPctOfBudget:    Number
    },
    
    // Analysis
    reasoning:           { type: String, required: true },
    keyFactors:          [{ type: String }],
    warnings:            [{ type: String }],
    
    // Indicator Snapshot (full state at signal time)
    indicatorsSnapshot: {
        rsi:             { value: Number, zone: String, interpretation: String },
        macd:            { macd: Number, signal: Number, histogram: Number, interpretation: String },
        bollingerBands:  { upper: Number, middle: Number, lower: Number, position: String },
        stochastic:      { k: Number, d: Number, interpretation: String },
        adx:             { value: Number, plusDI: Number, minusDI: Number, interpretation: String },
        ichimoku:        { tenkan: Number, kijun: Number, cloudTop: Number, cloudBottom: Number, interpretation: String },
        obv:             { trend: String, interpretation: String },
        vwap:            { value: Number, position: String },
        supertrend:      { value: Number, direction: String },
        atr:             { value: Number, percentOfPrice: Number },
        emaAlignment:    { type: String },
        fibonacciLevels: { type: Map, of: Number },
        pivotPoints:     { type: Map, of: Number },
        volumeProfile:   { hva: Number, lva: Number, poc: Number }
    },
    
    // Patterns Detected
    candlePatterns: [{
        name:        String,
        type:        { type: String, enum: ['bullish_reversal', 'bearish_reversal', 'continuation', 'indecision'] },
        reliability: { type: String, enum: ['strong', 'moderate', 'weak'] },
        timeframe:   String
    }],
    
    // Smart Money Concepts
    smartMoneyConcepts: {
        orderBlocks:     [{ price: Number, type: String, strength: String }],
        fairValueGaps:   [{ high: Number, low: Number, filled: Boolean }],
        liquiditySweeps: [{ level: Number, type: String, swept: Boolean }]
    },
    
    // Support/Resistance
    keyLevels: {
        supports:    [{ price: Number, strength: String, method: String }],
        resistances: [{ price: Number, strength: String, method: String }]
    },
    
    // Multi-timeframe
    timeframesAnalyzed: [{ type: String }],
    confluenceScore:    { type: Number, min: 0, max: 100 },
    marketRegime:       { type: String, enum: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE', 'BREAKOUT'] },
    
    // Outcome Tracking
    status:        { type: String, default: 'active', enum: ['active', 'hit_target', 'hit_stoploss', 'expired', 'cancelled'] },
    outcomePrice:  Number,
    outcomePnlPct: Number,
    isCorrect:     Boolean,
    resolvedAt:    Date
}, { timestamps: true });

tradeSignalSchema.index({ status: 1, createdAt: -1 });
tradeSignalSchema.index({ coinSymbol: 1, status: 1 });
```

### Budget Allocation Schema
```javascript
const budgetAllocationSchema = new Schema({
    userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true },
    signalId:          { type: Schema.Types.ObjectId, ref: 'TradeSignal', required: true },
    coinSymbol:        { type: String, required: true },
    allocatedAmount:   { type: Number, required: true },
    leverage:          { type: Number, default: 1 },
    effectivePosition: { type: Number, required: true },
    entryPrice:        { type: Number, required: true },
    liquidationPrice:  Number,
    status:            { type: String, default: 'active', enum: ['active', 'closed'] },
    pnlAmount:         Number,
    closedAt:          Date
}, { timestamps: true });
```

### AI Corrections Schema
```javascript
const aiCorrectionSchema = new Schema({
    signalId:            { type: Schema.Types.ObjectId, ref: 'TradeSignal', required: true },
    predictedDirection:  { type: String, required: true },
    actualDirection:     { type: String, required: true },
    errorType:           String,         // 'false_breakout', 'ignored_divergence', etc.
    lessonLearned:       String,         // AI-generated lesson
    indicatorsThatFailed: [{ type: String }],
    indicatorsThatWorked: [{ type: String }]
}, { timestamps: true });
```

### Notification Schema
```javascript
const notificationSchema = new Schema({
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    signalId:  { type: Schema.Types.ObjectId, ref: 'TradeSignal' },
    type:      { type: String, required: true, enum: ['signal', 'alert', 'system', 'resolved'] },
    title:     { type: String, required: true },
    message:   { type: String, required: true },
    isRead:    { type: Boolean, default: false }
}, { timestamps: true });
```

---

## 🆕 Comprehensive Technical Analysis Engine

### Candlestick Patterns (35+ Patterns)

#### Bullish Reversal Patterns (14)
| # | Pattern | Candles | Reliability | Signal |
|---|---|---|---|---|
| 1 | **Hammer** | 1 | Moderate | Selling exhaustion, buyers stepping in |
| 2 | **Inverted Hammer** | 1 | Moderate | Potential buying interest after downtrend |
| 3 | **Bullish Engulfing** | 2 | Strong | Buyers overwhelm sellers completely |
| 4 | **Piercing Line** | 2 | Moderate | Close above 50% of prior bearish body |
| 5 | **Morning Star** | 3 | Strong | Classic three-candle reversal |
| 6 | **Morning Doji Star** | 3 | Strong | Even more indecision before reversal |
| 7 | **Three White Soldiers** | 3 | Strong | Three consecutive strong bull candles |
| 8 | **Bullish Harami** | 2 | Moderate | Small body inside prior bearish body |
| 9 | **Bullish Harami Cross** | 2 | Moderate | Doji inside prior bearish body |
| 10 | **Three Inside Up** | 3 | Strong | Harami confirmed by third candle |
| 11 | **Three Outside Up** | 3 | Strong | Engulfing confirmed by third candle |
| 12 | **Tweezer Bottom** | 2 | Moderate | Equal lows — double support |
| 13 | **Bullish Abandoned Baby** | 3 | Strong | Rare, gap down then gap up |
| 14 | **Dragonfly Doji** | 1 | Moderate | Buyers reject lower prices completely |

#### Bearish Reversal Patterns (14)
| # | Pattern | Candles | Reliability | Signal |
|---|---|---|---|---|
| 15 | **Shooting Star** | 1 | Moderate | Rejection at higher prices |
| 16 | **Hanging Man** | 1 | Moderate | Potential exhaustion at top |
| 17 | **Bearish Engulfing** | 2 | Strong | Sellers overwhelm buyers |
| 18 | **Dark Cloud Cover** | 2 | Moderate | Close below 50% of prior bullish body |
| 19 | **Evening Star** | 3 | Strong | Classic three-candle top reversal |
| 20 | **Evening Doji Star** | 3 | Strong | Doji at the peak |
| 21 | **Three Black Crows** | 3 | Strong | Three consecutive strong bear candles |
| 22 | **Bearish Harami** | 2 | Moderate | Small body inside prior bullish body |
| 23 | **Bearish Harami Cross** | 2 | Moderate | Doji inside prior bullish body |
| 24 | **Three Inside Down** | 3 | Strong | Harami confirmed bearish |
| 25 | **Three Outside Down** | 3 | Strong | Engulfing confirmed bearish |
| 26 | **Tweezer Top** | 2 | Moderate | Equal highs — double resistance |
| 27 | **Bearish Abandoned Baby** | 3 | Strong | Rare, gap up then gap down |
| 28 | **Gravestone Doji** | 1 | Moderate | Total rejection of bullish push |

#### Continuation & Indecision Patterns (7+)
| # | Pattern | Candles | Signal |
|---|---|---|---|
| 29 | **Doji** | 1 | Market indecision — wait for confirmation |
| 30 | **Long-Legged Doji** | 1 | High indecision with wide range |
| 31 | **Spinning Top** | 1 | Weak conviction, trend may pause |
| 32 | **Bullish Marubozu** | 1 | Pure bullish conviction, continuation |
| 33 | **Bearish Marubozu** | 1 | Pure bearish conviction, continuation |
| 34 | **Rising Three Methods** | 5 | Bullish continuation after pause |
| 35 | **Falling Three Methods** | 5 | Bearish continuation after pause |

---

### Technical Indicators (20+)

#### Trend Indicators
| Indicator | What It Measures | Key Values |
|---|---|---|
| **EMA** (9, 21, 50, 200) | Trend direction & dynamic support/resistance | Crossovers, alignment |
| **SMA** (50, 200) | Long-term trend (Golden/Death Cross) | 50 crossing 200 |
| **Ichimoku Cloud** | Trend, momentum, support/resistance all-in-one | Tenkan-Kijun cross, cloud color, price vs cloud |
| **ADX** (14) | Trend strength (not direction) | >25 trending, <20 ranging |
| **Supertrend** (10, 3) | Trend following with dynamic stop | Direction flip = signal |
| **Parabolic SAR** | Trailing stop + trend direction | Dot flip above/below price |

#### Momentum Indicators
| Indicator | What It Measures | Key Values |
|---|---|---|
| **RSI** (14) | Overbought/oversold momentum | >70 overbought, <30 oversold |
| **Stochastic RSI** (14, 14, 3, 3) | RSI of RSI — more sensitive | K/D crossovers in extreme zones |
| **MACD** (12, 26, 9) | Trend momentum & crossovers | Signal line crossover, histogram direction |
| **Williams %R** (14) | Overbought/oversold (inverted scale) | >-20 overbought, <-80 oversold |
| **CCI** (20) | Deviation from statistical mean | >100 overbought, <-100 oversold |
| **ROC** (12) | Rate of price change | Divergence from price |

#### Volume Indicators
| Indicator | What It Measures | Key Values |
|---|---|---|
| **OBV** (On-Balance Volume) | Cumulative volume flow | Divergence from price trend |
| **VWAP** | Volume-weighted average price | Price above = bullish, below = bearish |
| **CMF** (Chaikin Money Flow, 20) | Buying/selling pressure | >0 accumulation, <0 distribution |
| **Volume Profile** | Volume at each price level | POC, HVN, LVN identification |
| **Volume SMA** (20) | Average volume for comparison | Current vs average ratio |

#### Volatility Indicators
| Indicator | What It Measures | Key Values |
|---|---|---|
| **Bollinger Bands** (20, 2) | Volatility envelope around price | Squeeze, expansion, position |
| **ATR** (14) | Average price range — volatility | Stop-loss sizing, position sizing |
| **Keltner Channels** (20, 2) | Volatility with EMA base | Squeeze detection with BB |

---

### Support & Resistance Detection (4 Methods)

```
Method 1: SWING HIGHS/LOWS
  ├── Scan last 200 candles for local maxima/minima
  ├── Higher timeframe pivots weighted more heavily
  └── Strength: number of times level was tested

Method 2: PIVOT POINTS (Classic + Fibonacci + Camarilla)
  ├── Classic: PP = (H + L + C) / 3
  ├── R1-R3 and S1-S3 calculated
  ├── Fibonacci Pivots: uses 38.2%, 61.8%, 100% ratios
  └── Camarilla: tighter levels for intraday

Method 3: VOLUME PROFILE NODES
  ├── Point of Control (POC): highest volume price
  ├── Value Area High (VAH): 70% volume upper bound
  ├── Value Area Low (VAL): 70% volume lower bound
  └── High Volume Nodes = strong S/R

Method 4: FIBONACCI RETRACEMENT
  ├── Identify major swing high → swing low
  ├── Calculate: 23.6%, 38.2%, 50%, 61.8%, 78.6%
  ├── Extensions: 127.2%, 161.8% for targets
  └── Confluence with other methods = strongest levels
```

Levels from all 4 methods are **merged and ranked** by confluence:
- Level appears in 3+ methods → **STRONG** (shown on chart as thick line)
- Level appears in 2 methods → **MODERATE** (medium line)
- Level appears in 1 method → **WEAK** (thin dotted line)

---

### 🆕 Smart Money Concepts (SMC)

```javascript
// Detected and fed to AI for institutional-grade analysis:

orderBlocks: [
    // Zones where institutional orders were placed
    { priceZone: [66800, 67200], type: 'bullish_OB', strength: 'strong' }
],

fairValueGaps: [
    // Imbalance zones that price tends to fill
    { high: 68500, low: 67800, direction: 'up', filled: false }
],

liquiditySweeps: [
    // Where retail stop-losses were hunted
    { level: 66500, type: 'sell_side', swept: true, timestamp: '...' }
]
```

---

### Multi-Timeframe Confluence

The engine analyzes **3 timeframes simultaneously** and scores confluence:

```
Higher Timeframe (4h/1D) → Determines BIAS (trend direction)
Middle Timeframe (1h)    → Determines STRUCTURE (key levels)
Lower Timeframe (15m)    → Determines ENTRY (exact timing)

Confluence Score (0-100):
  All 3 align = 80-100 (strong signal)
  2 of 3 align = 50-79  (moderate signal)
  1 or 0 align = 0-49   (weak/no signal)
```

---

## Updated AI Prompt Architecture

The AI now receives a **massively richer context**:

```
┌──────────────────────────────────────────────────────────┐
│              AI ANALYSIS PROMPT (v3)                       │
├──────────────────────────────────────────────────────────┤
│                                                            │
│ 1. SYSTEM ROLE (Professional Quant Analyst)                │
│                                                            │
│ 2. SELF-LEARNING CONTEXT (accuracy, past mistakes)         │
│                                                            │
│ 3. USER PROFILE (risk, budget, leverage max)               │
│                                                            │
│ 4. MARKET DATA (price, volume, last 200 candles)           │
│                                                            │
│ 5. TREND INDICATORS                                        │
│    EMA alignment, Ichimoku cloud, ADX, Supertrend, PSAR   │
│                                                            │
│ 6. MOMENTUM INDICATORS                                     │
│    RSI, Stochastic RSI, MACD, Williams %R, CCI            │
│                                                            │
│ 7. VOLUME INDICATORS                                       │
│    OBV, VWAP, CMF, Volume Profile                          │
│                                                            │
│ 8. VOLATILITY                                              │
│    Bollinger Bands, ATR, Keltner Channels                  │
│                                                            │
│ 9. CANDLESTICK PATTERNS DETECTED                          │
│    List of all patterns found on current + recent candles  │
│                                                            │
│ 10. SUPPORT & RESISTANCE LEVELS                           │
│     Merged from 4 methods with strength ratings            │
│                                                            │
│ 11. SMART MONEY CONCEPTS                                  │
│     Order blocks, FVGs, liquidity sweeps                   │
│                                                            │
│ 12. MULTI-TIMEFRAME CONFLUENCE                            │
│     15m / 1h / 4h bias alignment                           │
│                                                            │
│ 13. OUTPUT SCHEMA (enforced JSON)                         │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

---

## Updated Project Structure

```
d:\Projects\cryptox\
├── client\                         # Vite + React Frontend
│   └── (same as v2 — no changes to frontend structure)
│
├── server\
│   ├── src\
│   │   ├── config\
│   │   │   ├── env.js
│   │   │   └── database.js         # 🆕 MongoDB/Mongoose connection
│   │   ├── models\                  # 🆕 Mongoose schemas
│   │   │   ├── User.js
│   │   │   ├── ApiKey.js
│   │   │   ├── UserPreferences.js
│   │   │   ├── TradeSignal.js
│   │   │   ├── BudgetAllocation.js
│   │   │   ├── AiCorrection.js
│   │   │   └── Notification.js
│   │   ├── middleware\
│   │   ├── routes\
│   │   ├── services\
│   │   │   ├── deltaExchange.js
│   │   │   ├── deltaWebSocket.js
│   │   │   ├── indicatorEngine.js   # 🆕 20+ indicators
│   │   │   ├── patternDetector.js   # 🆕 35+ candle patterns
│   │   │   ├── supportResistance.js # 🆕 4-method S/R engine
│   │   │   ├── smartMoney.js        # 🆕 SMC detection
│   │   │   ├── confluenceScorer.js  # 🆕 Multi-timeframe scoring
│   │   │   ├── aiAnalysis.js
│   │   │   ├── positionSizing.js
│   │   │   ├── signalGenerator.js
│   │   │   ├── selfLearning.js
│   │   │   └── notificationService.js
│   │   ├── utils\
│   │   └── app.js
│   ├── .env
│   └── package.json
│
├── .gitignore
└── README.md
```

Key new services added:
- **`patternDetector.js`** — Detects all 35+ candlestick patterns
- **`supportResistance.js`** — 4-method S/R with merge + strength ranking
- **`smartMoney.js`** — Order blocks, fair value gaps, liquidity sweeps
- **`confluenceScorer.js`** — Multi-timeframe alignment scoring

---

## Phase Breakdown (Updated)

| Phase | Name | Key Changes from v2 |
|---|---|---|
| **1** | Foundation & Setup Wizard | MongoDB connection instead of SQLite |
| **2** | Profile & Budget Management | Mongoose models instead of raw SQL |
| **3** | Data Pipeline & Charts | No changes |
| **4** | Indicators, Patterns & AI | 🆕 Massively expanded — patterns, indicators, S/R, SMC, confluence |
| **5** | Signals, Notifications & Learning | Self-learning now tracks which indicators/patterns worked vs failed |
| **6** | Polish & Theming | No changes |

---

## Verification Plan

### Automated Tests
```bash
# Verify MongoDB connection
node -e "require('./src/config/database.js').then(() => console.log('Connected'))"

# Verify all 35+ patterns detect correctly on sample data
node -e "require('./src/services/patternDetector.js').runTests()"

# Verify all indicators calculate correctly
node -e "require('./src/services/indicatorEngine.js').runTests()"

# Verify S/R detection with 4 methods
node -e "require('./src/services/supportResistance.js').runTests()"

# Full signal generation test
node -e "require('./src/services/signalGenerator.js').testAnalysis('BTCUSD')"
```

### Manual Verification
Same 20-point checklist as v2, plus:
- Verify MongoDB collections created with correct indexes
- Verify pattern detection shows in signal card dropdown
- Verify S/R levels render on chart (thick/medium/thin lines)
- Verify confluence score appears on signal card
- Verify Fibonacci levels display on chart
- Verify Ichimoku cloud renders as overlay (if time permits)
