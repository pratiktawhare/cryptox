# Phase 7 — One-Click Trading & Order Management

> **Goal:** Execute trades from signal cards with one click (confirmation dialog), edit parameters before submitting, track all active positions in real-time, and view complete trade history with P&L.

---

## Dependencies
- Phase 6 complete (signals with entry/target/SL/quantity available)
- Delta Exchange API key with `read_write` permissions

## Estimated Effort
- Backend: ~8 hours
- Frontend: ~8 hours

---

## Backend Tasks

### 1. Order Executor
**File:** `server/src/services/trading/OrderExecutor.js`

**Pre-flight safety checks (inspired by NoFx trade_execution skill):**
```
Before placing any order:
1. Validate quantity > 0 and within hard limits
2. Get current market price from live ticker
3. Calculate notional value = quantity × price
4. Calculate effective value = notional × leverage
5. Check: notional ≤ maxSingleTradePct × available_balance
6. Check: total exposure (existing + new) ≤ account equity × maxExposurePct
7. Check: risk amount ≤ maxRiskPerTradePct × equity
8. If notional > 25% of equity → flag as "LARGE ORDER" requiring explicit confirmation
9. If notional > 100% of equity → REJECT immediately
10. If all checks pass → place order via Delta API
```

**Order placement flow:**
```javascript
async function executeOrder({ symbol, side, quantity, leverage, orderType, limitPrice, stopLoss, takeProfit }) {
  // 1. Set leverage on Delta
  await deltaAPI.setLeverage(productId, leverage);

  // 2. Place main order
  const order = await deltaAPI.createOrder({
    product_id: productId,
    size: quantity,
    side: side,                    // 'buy' or 'sell'
    order_type: orderType,         // 'limit_order' or 'market_order'
    limit_price: limitPrice,       // only for limit orders
  });

  // 3. Place stop-loss bracket order
  if (stopLoss) {
    await deltaAPI.createOrder({
      product_id: productId,
      size: quantity,
      side: side === 'buy' ? 'sell' : 'buy',
      order_type: 'limit_order',
      stop_order_type: 'stop_loss_order',
      stop_price: stopLoss,
      limit_price: stopLoss,
      reduce_only: true
    });
  }

  // 4. Place take-profit bracket order
  if (takeProfit) {
    await deltaAPI.createOrder({
      product_id: productId,
      size: quantity,
      side: side === 'buy' ? 'sell' : 'buy',
      order_type: 'limit_order',
      stop_order_type: 'take_profit_order',
      stop_price: takeProfit,
      limit_price: takeProfit,
      reduce_only: true
    });
  }

  // 5. Record in TradeHistory
  await TradeHistory.create({ ... });

  return { orderId: order.id, status: order.state, fillPrice: order.average_fill_price };
}
```

### 2. Position Tracker
**File:** `server/src/services/trading/PositionTracker.js`

**Polls positions every 10 seconds:**
- `GET /v2/positions` from Delta API
- For each position, compute:
  - Unrealized P&L = (markPrice - entryPrice) × quantity × (side === 'buy' ? 1 : -1)
  - P&L % = (unrealizedPnL / marginUsed) × 100
  - Duration since open
  - Distance to liquidation price
- Emit `positions_update` via Socket.IO every 10 seconds

**Data shape emitted:**
```javascript
{
  activePositions: [
    {
      symbol: 'BTCUSD',
      side: 'buy',
      quantity: 0.01,
      entryPrice: 68200,
      markPrice: 68500,
      leverage: 5,
      unrealizedPnL: 3.0,
      pnlPercent: 2.2,
      marginUsed: 136.4,
      liquidationPrice: 64000,
      duration: '2h 15m',
      signalId: '...'  // link back to the signal
    }
  ],
  totalUnrealizedPnL: 3.0,
  totalMarginUsed: 136.4,
  availableBalance: 863.6
}
```

### 3. Trade History Model
**File:** `server/src/models/TradeHistory.js`

```javascript
const tradeHistorySchema = new Schema({
  userId:        { type: ObjectId, ref: 'User', required: true },
  mode:          { type: String, enum: ['live', 'paper'], required: true },
  signalId:      { type: ObjectId, ref: 'TradeSignal' },
  symbol:        { type: String, required: true, index: true },
  side:          { type: String, enum: ['buy', 'sell'], required: true },
  orderType:     { type: String, enum: ['market_order', 'limit_order'] },
  quantity:      { type: Number, required: true },
  entryPrice:    { type: Number, required: true },
  exitPrice:     Number,
  leverage:      { type: Number, default: 1 },
  stopLoss:      Number,
  takeProfit:    Number,
  pnlAmount:     Number,
  pnlPercent:    Number,
  fees:          { type: Number, default: 0 },
  status:        { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open' },
  openedAt:      { type: Date, default: Date.now },
  closedAt:      Date,
  closeReason:   { type: String, enum: ['manual', 'target_hit', 'sl_hit', 'liquidated'] },
  notes:         String
}, { timestamps: true });

tradeHistorySchema.index({ userId: 1, mode: 1, status: 1 });
tradeHistorySchema.index({ userId: 1, mode: 1, closedAt: -1 });
```

### 4. Trading Routes
**File:** `server/src/routes/trading.js`

```
POST /api/trading/execute
  Body: { symbol, side, quantity, leverage, orderType, limitPrice, stopLoss, takeProfit, signalId? }
  Returns: { orderId, status, fillPrice, executedQty }
  Auth: required
  Safety: runs pre-flight checks before execution

GET /api/trading/positions
  Returns: { activePositions: [...], totalUnrealizedPnL, totalMarginUsed }
  Auth: required
  Source: live from Delta API

POST /api/trading/close/:symbol
  Body: { quantity? }  (optional — partial close)
  Returns: { orderId, status, fillPrice }
  Auth: required

GET /api/trading/history
  Query: ?mode=live&status=closed&page=1&limit=20&coin=BTCUSD
  Returns: { trades: [...], pagination: { page, total, pages } }
  Auth: required

GET /api/trading/history/stats
  Query: ?mode=live&days=30
  Returns: { winRate, avgWin, avgLoss, totalPnL, totalTrades, bestTrade, worstTrade, profitFactor }
  Auth: required
```

---

## Frontend Tasks

### 5. Trade Confirmation Dialog
**File:** `client/src/components/trading/TradeConfirmDialog.jsx`

**Modal overlay (triggered by "Buy Now" on signal card):**
```
┌──────────────────────────────────────────────────────────┐
│              ⚡ Confirm Trade                        [✕]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  LONG BTC/USD                                            │
│                                                          │
│  Entry Price:     $68,200  (live: $68,195 ✓)            │
│  Quantity:        0.01 BTC                               │
│  Leverage:        5x                                     │
│  Order Type:      Limit Order                            │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Stop Loss:       $67,100  (-1.6%)                      │
│  Take Profit:     $70,500  (+3.4%)                      │
│  R:R Ratio:       2.1:1                                  │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Margin Required: $136.40                                │
│  Risk Amount:     $11.00  (1.1% of equity)              │
│  Potential Profit: $23.00                                │
│                                                          │
│  ⚠️  Are you sure you want to place this trade?          │
│                                                          │
│       [  ❌ No, Cancel  ]    [  ✅ Yes, Execute  ]        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Behavior:**
- Pre-fills all values from the signal
- Shows live price comparison (entry vs current)
- Yes button: calls `POST /api/trading/execute`
- Loading spinner during execution
- Success: green toast + close dialog
- Error: red toast with error message

### 6. Trade Edit Dialog
**File:** `client/src/components/trading/TradeEditDialog.jsx`

**Same layout as confirm, but ALL fields are editable:**
- Quantity: number input with +/- buttons
- Leverage: slider (1x – maxLeverage)
- Order Type: dropdown (Market / Limit)
- Limit Price: number input (only for limit orders)
- Stop Loss: number input
- Take Profit: number input

**Live recalculation on every change:**
- Margin, risk, R:R ratio, potential profit update instantly
- Validation: red border + error text if leverage > max, or risk > budget limit
- "Reset to AI Suggestion" button to restore original values

### 7. Positions Page
**File:** `client/src/pages/Positions.jsx`

**Two-tab layout:**

#### Tab 1: Active Positions
```
┌──────────────────────────────────────────────────────────────────┐
│  📊 Active Positions                    Total P&L: +$42.50 🟢   │
├──────────────────────────────────────────────────────────────────┤
│  Symbol  │ Side │ Entry    │ Current  │ P&L      │ Lev │ Action │
│  BTCUSD  │ LONG │ $68,200  │ $68,500  │ +$3.00   │ 5x  │ [Close]│
│  ETHUSD  │ SHORT│ $3,480   │ $3,450   │ +$1.50   │ 3x  │ [Close]│
│  SOLUSD  │ LONG │ $142.50  │ $145.00  │ +$2.50   │ 2x  │ [Close]│
└──────────────────────────────────────────────────────────────────┘
```

- Real-time updates via Socket.IO (positions_update)
- Green/red row backgrounds based on P&L
- Close button → confirmation: "Close BTCUSD position?" [Yes/No]
- Summary bar at top: total unrealized P&L, margin used, available balance

#### Tab 2: Trade History
```
┌──────────────────────────────────────────────────────────────────────┐
│  📜 Trade History                                                    │
│  Win Rate: 65%  │  Total P&L: +$127.50  │  Trades: 20               │
├──────────────────────────────────────────────────────────────────────┤
│  Date       │ Symbol │ Side │ Entry   │ Exit    │ P&L    │ Reason   │
│  Jun 12     │ BTCUSD │ LONG │ $67,800 │ $68,500 │ +$7.00 │ Target   │
│  Jun 11     │ ETHUSD │ SHORT│ $3,500  │ $3,520  │ -$2.00 │ SL Hit   │
│  Jun 11     │ SOLUSD │ LONG │ $140.00 │ $145.00 │ +$5.00 │ Manual   │
└──────────────────────────────────────────────────────────────────────┘
```

- Paginated (20 per page)
- Filter by coin, date range, side
- Color coding: green for profit, red for loss
- Summary stats bar: win rate, avg win, avg loss, best/worst trade, profit factor

### 8. Position Card (Mobile)
**File:** `client/src/components/positions/PositionCard.jsx`

- Mobile-friendly card for each active position
- Animated P&L counter (live updating number)
- Progress bar: SL ←──■──→ TP showing where current price is
- Swipe-left to close position (with confirmation)

---

## Navigation Update

**Modify:** Dashboard sidebar/header
- Add "Positions" icon + link
- Badge showing active position count

**Modify:** `client/src/App.jsx`
- Add route: `<Route path="/positions" element={<Positions />} />`

---

## Verification Checklist
- [ ] "Buy Now" on signal card opens confirmation dialog with correct values
- [ ] "Edit & Buy" opens editable dialog, recalculates on change
- [ ] After confirming, order is placed on Delta Exchange successfully
- [ ] Stop-loss and take-profit bracket orders are placed
- [ ] New position appears in Active Positions within 10 seconds
- [ ] P&L updates in real-time as price moves
- [ ] Close position button works (market order to close)
- [ ] Closed trade appears in Trade History with correct P&L
- [ ] Trade history stats (win rate, total P&L) are calculated correctly
- [ ] Safety checks reject orders exceeding budget limits
- [ ] Large order warning appears for orders > 25% of equity
- [ ] Mobile: position cards are swipeable and readable
