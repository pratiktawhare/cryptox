# Phase 5 — Technical Analysis Engine

> **Goal:** Compute 35+ candlestick patterns, 20+ indicators, 4-method S/R detection, Smart Money Concepts, and multi-timeframe confluence scoring — all server-side, ready to feed to the AI.

---

## Dependencies
- Phase 4 complete (ProductCatalog, candle data available)

## Estimated Effort
- Backend: ~10 hours (analysis is computation-heavy)
- Frontend: ~4 hours (indicator panel + chart overlays)

## NPM Packages Needed
```bash
cd server
npm install technicalindicators
```
The `technicalindicators` package provides: EMA, SMA, RSI, MACD, Bollinger Bands, Stochastic, ADX, ATR, OBV, CCI, Williams %R, ROC, VWAP, Ichimoku, Parabolic SAR, and many candlestick pattern detections.

---

## Backend Tasks

### 1. Pattern Detector
**File:** `server/src/services/analysis/PatternDetector.js`

**Detects 35+ candlestick patterns:**

| Category | Patterns (14 each + 7 continuation) |
|---|---|
| **Bullish Reversal** | Hammer, Inverted Hammer, Bullish Engulfing, Piercing Line, Morning Star, Morning Doji Star, Three White Soldiers, Bullish Harami, Bullish Harami Cross, Three Inside Up, Three Outside Up, Tweezer Bottom, Bullish Abandoned Baby, Dragonfly Doji |
| **Bearish Reversal** | Shooting Star, Hanging Man, Bearish Engulfing, Dark Cloud Cover, Evening Star, Evening Doji Star, Three Black Crows, Bearish Harami, Bearish Harami Cross, Three Inside Down, Three Outside Down, Tweezer Top, Bearish Abandoned Baby, Gravestone Doji |
| **Continuation/Indecision** | Doji, Long-Legged Doji, Spinning Top, Bullish Marubozu, Bearish Marubozu, Rising Three Methods, Falling Three Methods |

**Implementation approach:**
- Use `technicalindicators` built-in pattern functions where available (covers ~25 patterns)
- Custom implementations for: Tweezer Top/Bottom, Abandoned Baby, Rising/Falling Three Methods, Marubozu
- Each pattern returns: `{ name, type, reliability, timeframe, candle_index }`

**API:**
```javascript
const patterns = PatternDetector.detect(candles);
// Returns: [{ name: 'bullish_engulfing', type: 'bullish_reversal', reliability: 'strong', index: 198 }, ...]
```

### 2. Indicator Engine
**File:** `server/src/services/analysis/IndicatorEngine.js`

**Computes 20+ indicators in a single pass:**

#### Trend Indicators
| Indicator | Config | Library Function |
|---|---|---|
| EMA (9, 21, 50, 200) | `EMA({ period, values })` | technicalindicators |
| SMA (50, 200) | `SMA({ period, values })` | technicalindicators |
| Ichimoku Cloud | `IchimokuCloud({ high, low, close, ... })` | technicalindicators |
| ADX (14) | `ADX({ high, low, close, period })` | technicalindicators |
| Supertrend (10, 3) | Custom: ATR-based trend | Custom implementation |
| Parabolic SAR | `PSAR({ high, low, step, max })` | technicalindicators |

#### Momentum Indicators
| Indicator | Library Function |
|---|---|
| RSI (14) | `RSI({ period, values })` |
| Stochastic RSI (14,14,3,3) | `StochasticRSI({ rsiPeriod, stochasticPeriod, kPeriod, dPeriod, values })` |
| MACD (12, 26, 9) | `MACD({ fastPeriod, slowPeriod, signalPeriod, values })` |
| Williams %R (14) | `WilliamsR({ high, low, close, period })` |
| CCI (20) | `CCI({ high, low, close, period })` |
| ROC (12) | `ROC({ period, values })` |

#### Volume Indicators
| Indicator | Implementation |
|---|---|
| OBV | `OBV({ close, volume })` |
| VWAP | `VWAP({ high, low, close, volume })` |
| CMF (20) | Custom: Chaikin Money Flow |
| Volume Profile | Custom: price-bucketed volume histogram |
| Volume SMA (20) | `SMA({ period, values: volumes })` |

#### Volatility Indicators
| Indicator | Implementation |
|---|---|
| Bollinger Bands (20, 2) | `BollingerBands({ period, stdDev, values })` |
| ATR (14) | `ATR({ high, low, close, period })` |
| Keltner Channels (20, 2) | Custom: EMA ± multiplier × ATR |

**API:**
```javascript
const snapshot = IndicatorEngine.compute(candles);
// Returns full indicator snapshot object with all values + interpretations
```

**Interpretation layer** — for each indicator, compute a human-readable interpretation:
- RSI: `zone: 'oversold' | 'neutral' | 'overbought'`, `interpretation: 'Approaching oversold territory...'`
- MACD: `interpretation: 'Bullish crossover, histogram increasing...'`
- etc.

### 3. Support & Resistance Detection
**File:** `server/src/services/analysis/SupportResistance.js`

**4 methods, merged + ranked:**

#### Method 1: Swing Highs/Lows
- Scan last 200 candles for local maxima/minima (5-candle window)
- Weight by: number of times level was tested, recency, timeframe

#### Method 2: Pivot Points
- Classic: PP = (H + L + C) / 3, R1-R3, S1-S3
- Fibonacci Pivots: 38.2%, 61.8%, 100% extensions
- Camarilla: tighter levels for intraday

#### Method 3: Volume Profile Nodes
- Bucket price range into N bins (20 bins)
- Count volume in each bin
- POC = bin with highest volume
- VAH/VAL = 70% volume coverage boundaries
- High Volume Nodes = strong S/R

#### Method 4: Fibonacci Retracement
- Auto-detect major swing high → swing low (last 100 candles)
- Calculate: 23.6%, 38.2%, 50%, 61.8%, 78.6%
- Extensions: 127.2%, 161.8% for targets

**Merge logic:**
- Group levels within 0.5% price proximity → single level
- Count how many methods agree on each level
- Rank: 3+ methods = STRONG, 2 methods = MODERATE, 1 method = WEAK

**Output:**
```javascript
{
  supports: [{ price: 66500, strength: 'strong', methods: ['swing', 'fibonacci', 'volume_profile'] }, ...],
  resistances: [{ price: 69200, strength: 'moderate', methods: ['pivot', 'swing'] }, ...]
}
```

### 4. Smart Money Concepts
**File:** `server/src/services/analysis/SmartMoneyConcepts.js`

#### Order Blocks
- Scan for the last bullish/bearish candle before a strong impulsive move (>2× ATR)
- Bullish OB: last bearish candle before a strong bullish impulse
- Bearish OB: last bullish candle before a strong bearish impulse
- Output: `{ priceZone: [low, high], type: 'bullish_OB' | 'bearish_OB', strength: 'strong' | 'moderate' }`

#### Fair Value Gaps (FVGs)
- Three-candle pattern where:
  - Bullish FVG: candle3.low > candle1.high (gap up)
  - Bearish FVG: candle3.high < candle1.low (gap down)
- Track if FVG has been filled (price revisited the zone)
- Output: `{ high, low, direction: 'up' | 'down', filled: boolean }`

#### Liquidity Sweeps
- Price briefly breaks a key swing high/low (by < 0.3%) then reverses
- Indicates institutional stop-hunting
- Output: `{ level, type: 'buy_side' | 'sell_side', swept: boolean }`

#### Break of Structure (BOS)
- Higher-high breaks in uptrend / lower-low breaks in downtrend
- Confirms trend continuation or reversal
- Output: `{ level, type: 'bullish_bos' | 'bearish_bos' }`

### 5. Confluence Scorer
**File:** `server/src/services/analysis/ConfluenceScorer.js`

**Multi-timeframe analysis:**
```
Higher TF (4h) → Determines BIAS (trend direction)
Middle TF (1h) → Determines STRUCTURE (key levels, trend strength)
Lower TF (15m) → Determines ENTRY (exact timing, patterns)
```

**Scoring algorithm (0–100):**
| Factor | Weight | Points |
|---|---|---|
| All 3 TFs agree on direction | 30 | 0 or 30 |
| RSI + MACD agree on momentum | 15 | 0 or 15 |
| EMA alignment (9 > 21 > 50) | 10 | 0 or 10 |
| Price at S/R level (strong) | 15 | 0 or 15 |
| Candlestick pattern (strong reliability) | 10 | 0 or 10 |
| Smart Money confluence (OB + FVG) | 10 | 0 or 10 |
| Volume confirmation (above avg) | 10 | 0 or 10 |

### 6. Market Analyzer (Orchestrator)
**File:** `server/src/services/analysis/MarketAnalyzer.js`

**Single entry point for full analysis:**
```javascript
const snapshot = await MarketAnalyzer.analyze('BTCUSD');
// Internally:
// 1. Fetch candles: 15m (200), 1h (200), 4h (200)
// 2. Run PatternDetector on each TF
// 3. Run IndicatorEngine on each TF
// 4. Run SupportResistance (using 1h candles)
// 5. Run SmartMoneyConcepts (using 15m candles)
// 6. Run ConfluenceScorer across all TFs
// 7. Return combined AnalysisSnapshot object
```

**AnalysisSnapshot schema:**
```javascript
{
  symbol: 'BTCUSD',
  timestamp: Date,
  currentPrice: 68500,
  timeframes: {
    '15m': { indicators: {...}, patterns: [...] },
    '1h':  { indicators: {...}, patterns: [...] },
    '4h':  { indicators: {...}, patterns: [...] }
  },
  supportResistance: { supports: [...], resistances: [...] },
  smartMoney: { orderBlocks: [...], fvgs: [...], liquiditySweeps: [...], bos: [...] },
  confluenceScore: 72,
  marketRegime: 'TRENDING_UP'  // TRENDING_UP, TRENDING_DOWN, RANGING, VOLATILE, BREAKOUT
}
```

---

## Frontend Tasks

### 7. Indicator Panel
**File:** `client/src/components/dashboard/IndicatorPanel.jsx`

**Collapsible panel below the chart:**
- **Tabs:** Trend | Momentum | Volume | Volatility | Patterns | SMC
- Each tab shows current indicator values with:
  - Color coding: 🟢 bullish, 🔴 bearish, 🟡 neutral
  - Value + interpretation text
- Pattern tab: list of detected patterns with reliability badges (Strong/Moderate/Weak)
- SMC tab: order blocks, FVGs, liquidity zones as a mini table

### 8. Chart Overlays
**Modify:** `client/src/components/dashboard/TradingChart.jsx`

**Add overlays (togglable via buttons):**
- S/R levels as horizontal price lines (color by strength)
- Bollinger Bands as upper/lower line series
- EMA lines (9=yellow, 21=blue, 50=orange, 200=white)
- Order Block zones as semi-transparent rectangle markers
- FVG zones as hatched rectangles
- Pattern markers as triangle/arrow annotations on candles

---

## Verification Checklist
- [ ] PatternDetector detects at least 30 patterns on sample BTC data
- [ ] IndicatorEngine computes all 20+ indicators without errors
- [ ] S/R levels are reasonable (within current price range)
- [ ] Smart Money zones don't overlap excessively
- [ ] Confluence score correlates with visual chart alignment
- [ ] Indicator panel renders all tabs with correct values
- [ ] Chart overlays toggle on/off without performance issues
- [ ] Full analysis for 1 coin completes in <3 seconds
