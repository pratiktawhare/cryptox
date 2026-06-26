# Phase 8 — Paper Trading (Dummy Mode)

> **Goal:** Identical trading experience but with virtual money. No real orders placed. All simulated trades stored in MongoDB. User can test the AI's accuracy and practice trading without financial risk.

---

## Dependencies
- Phase 7 complete (trading infrastructure, position tracking, trade history)

## Estimated Effort
- Backend: ~6 hours
- Frontend: ~3 hours (mostly reusing Phase 7 components)

---

## Core Concept

The paper trading system is a **full simulation layer** that:
1. Uses the SAME market data (live prices from Delta Exchange)
2. Uses the SAME AI signals (same analysis, same prompts)
3. Simulates order fills with realistic slippage and fees
4. Maintains a virtual wallet balance in MongoDB
5. Tracks virtual positions with real-time P&L (against live prices)
6. Records all trades in a separate collection for independent analytics

**Two accounts are created on first-time setup:**
- **LIVE account** → real money, real Delta Exchange API calls
- **PAPER account** → virtual wallet, simulated fills, no API calls to Delta

---

## Backend Tasks

### 1. Paper Wallet Model
**File:** `server/src/models/PaperWallet.js`

```javascript
const paperWalletSchema = new Schema({
  userId:          { type: ObjectId, ref: 'User', required: true, unique: true },
  balance:         { type: Number, required: true, default: 100000 },  // Starting balance
  initialBalance:  { type: Number, required: true, default: 100000 },
  currency:        { type: String, default: 'INR' },
  equitySnapshots: [{
    timestamp: { type: Date, default: Date.now },
    equity:    Number,    // balance + unrealized P&L
    balance:   Number,    // cash balance
    positions: Number     // count of open positions
  }],
  totalTradesExecuted: { type: Number, default: 0 },
  totalPnL:            { type: Number, default: 0 },
  createdAt:           { type: Date, default: Date.now }
}, { timestamps: true });
```

### 2. Paper Position Model
**File:** `server/src/models/PaperPosition.js`

```javascript
const paperPositionSchema = new Schema({
  userId:        { type: ObjectId, ref: 'User', required: true },
  signalId:      { type: ObjectId, ref: 'TradeSignal' },
  symbol:        { type: String, required: true },
  side:          { type: String, enum: ['buy', 'sell'], required: true },
  quantity:      { type: Number, required: true },
  entryPrice:    { type: Number, required: true },
  leverage:      { type: Number, default: 1 },
  stopLoss:      Number,
  takeProfit:    Number,
  marginUsed:    { type: Number, required: true },
  status:        { type: String, enum: ['open', 'closed'], default: 'open' },
  exitPrice:     Number,
  pnlAmount:     Number,
  pnlPercent:    Number,
  fees:          { type: Number, default: 0 },
  closeReason:   { type: String, enum: ['manual', 'target_hit', 'sl_hit', 'liquidated'] },
  openedAt:      { type: Date, default: Date.now },
  closedAt:      Date
}, { timestamps: true });

paperPositionSchema.index({ userId: 1, status: 1 });
```

### 3. Paper Trading Engine
**File:** `server/src/services/trading/PaperTradingEngine.js`

**Core methods:**

#### `openPosition(userId, orderParams)`
```javascript
async openPosition(userId, { symbol, side, quantity, leverage, limitPrice, stopLoss, takeProfit, signalId }) {
  const wallet = await PaperWallet.findOne({ userId });
  const currentPrice = this.getTickerPrice(symbol);

  // Simulate fill price with slippage (0.02% - 0.08% random)
  const slippage = (Math.random() * 0.06 + 0.02) / 100;
  const fillPrice = limitPrice || (side === 'buy'
    ? currentPrice * (1 + slippage)
    : currentPrice * (1 - slippage));

  // Calculate margin
  const notionalValue = quantity * fillPrice;
  const marginRequired = notionalValue / leverage;

  // Simulate taker fee (use Delta's actual rate)
  const fee = notionalValue * 0.0005;  // 0.05% taker fee

  // Check sufficient balance
  if (wallet.balance < marginRequired + fee) {
    throw new Error('Insufficient virtual balance');
  }

  // Deduct margin + fee from wallet
  wallet.balance -= (marginRequired + fee);
  await wallet.save();

  // Create paper position
  const position = await PaperPosition.create({
    userId, signalId, symbol, side, quantity,
    entryPrice: fillPrice, leverage, stopLoss, takeProfit,
    marginUsed: marginRequired, fees: fee
  });

  return position;
}
```

#### `closePosition(userId, positionId, reason)`
```javascript
async closePosition(userId, positionId, reason = 'manual') {
  const position = await PaperPosition.findById(positionId);
  const currentPrice = this.getTickerPrice(position.symbol);

  // Simulate exit slippage
  const slippage = (Math.random() * 0.06 + 0.02) / 100;
  const exitPrice = position.side === 'buy'
    ? currentPrice * (1 - slippage)
    : currentPrice * (1 + slippage);

  // Calculate P&L
  const priceDiff = position.side === 'buy'
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice;
  const pnlAmount = priceDiff * position.quantity * position.leverage;
  const pnlPercent = (pnlAmount / position.marginUsed) * 100;
  const exitFee = position.quantity * exitPrice * 0.0005;

  // Update position
  position.status = 'closed';
  position.exitPrice = exitPrice;
  position.pnlAmount = pnlAmount - exitFee;
  position.pnlPercent = pnlPercent;
  position.fees += exitFee;
  position.closeReason = reason;
  position.closedAt = new Date();
  await position.save();

  // Return margin + P&L to wallet
  const wallet = await PaperWallet.findOne({ userId });
  wallet.balance += position.marginUsed + pnlAmount - exitFee;
  wallet.totalPnL += pnlAmount - exitFee;
  wallet.totalTradesExecuted += 1;
  await wallet.save();

  return position;
}
```

#### `checkStopLossAndTakeProfit()` (runs every 5 seconds)
```javascript
async checkSLTP() {
  const openPositions = await PaperPosition.find({ status: 'open' });
  for (const pos of openPositions) {
    const price = this.getTickerPrice(pos.symbol);
    if (!price) continue;

    // Check stop-loss
    if (pos.stopLoss) {
      if (pos.side === 'buy' && price <= pos.stopLoss) {
        await this.closePosition(pos.userId, pos._id, 'sl_hit');
      }
      if (pos.side === 'sell' && price >= pos.stopLoss) {
        await this.closePosition(pos.userId, pos._id, 'sl_hit');
      }
    }

    // Check take-profit
    if (pos.takeProfit) {
      if (pos.side === 'buy' && price >= pos.takeProfit) {
        await this.closePosition(pos.userId, pos._id, 'target_hit');
      }
      if (pos.side === 'sell' && price <= pos.takeProfit) {
        await this.closePosition(pos.userId, pos._id, 'target_hit');
      }
    }

    // Check liquidation (simplified: if P&L exceeds margin)
    const priceDiff = pos.side === 'buy' ? price - pos.entryPrice : pos.entryPrice - price;
    const unrealizedPnL = priceDiff * pos.quantity * pos.leverage;
    if (unrealizedPnL <= -pos.marginUsed * 0.95) {
      await this.closePosition(pos.userId, pos._id, 'liquidated');
    }
  }
}
```

#### Equity Snapshots (runs every hour)
```javascript
async takeSnapshot(userId) {
  const wallet = await PaperWallet.findOne({ userId });
  const positions = await PaperPosition.find({ userId, status: 'open' });

  let unrealizedPnL = 0;
  for (const pos of positions) {
    const price = this.getTickerPrice(pos.symbol);
    const diff = pos.side === 'buy' ? price - pos.entryPrice : pos.entryPrice - price;
    unrealizedPnL += diff * pos.quantity * pos.leverage;
  }

  wallet.equitySnapshots.push({
    equity: wallet.balance + unrealizedPnL,
    balance: wallet.balance,
    positions: positions.length
  });

  // Keep last 720 snapshots (30 days × 24 hours)
  if (wallet.equitySnapshots.length > 720) {
    wallet.equitySnapshots = wallet.equitySnapshots.slice(-720);
  }

  await wallet.save();
}
```

### 4. Paper Trading Routes
**File:** `server/src/routes/paper.js`

```
GET  /api/paper/wallet              — virtual balance, equity, total P&L
POST /api/paper/execute             — simulated trade (same params as live)
GET  /api/paper/positions           — virtual open positions (with live P&L)
POST /api/paper/close/:positionId   — close virtual position
GET  /api/paper/history             — virtual closed trades (paginated)
GET  /api/paper/history/stats       — virtual win rate, avg win/loss, etc.
POST /api/paper/wallet/reset        — reset wallet to initial balance
PATCH /api/paper/wallet/set-balance — set custom starting balance
```

### 5. User Model Update
**Modify:** `server/src/models/User.js`

Add field:
```javascript
accountMode: { type: String, enum: ['live', 'paper'], default: 'paper' }
```

### 6. Setup Wizard Update
**Modify:** `server/src/routes/setup.js`

On first-time setup completion:
```javascript
// Create paper wallet with default balance
await PaperWallet.create({
  userId: user._id,
  balance: 100000,      // ₹1,00,000 default
  initialBalance: 100000,
  currency: 'INR'
});
```

---

## Frontend Tasks

### 7. Mode Toggle in Header
**Modify:** `client/src/components/layout/Header.jsx` (or Dashboard header)

**Toggle switch in top navigation bar:**
```
[🔴 LIVE] ← toggle → [📄 PAPER]
```

- **LIVE mode:** Red accent dot, label "Real Money"
- **PAPER mode:** Blue accent dot, label "Practice Mode"
- Switching mode:
  - Calls `PATCH /api/auth/mode` to save preference
  - All trading API calls switch to paper endpoints
  - Visual: subtle blue top-border in paper mode vs red in live mode

### 8. Trading Context Provider
**File:** `client/src/context/TradingContext.jsx`

```javascript
const TradingContext = createContext();

export function TradingProvider({ children }) {
  const [mode, setMode] = useState('paper');  // 'live' or 'paper'

  // Returns the correct API base path based on mode
  const tradingBase = mode === 'live' ? '/api/trading' : '/api/paper';

  // All components use this context to determine endpoints
  return (
    <TradingContext.Provider value={{ mode, setMode, tradingBase }}>
      {children}
    </TradingContext.Provider>
  );
}
```

### 9. Paper Settings Section
**Modify:** Settings page

- Starting balance input (number field with currency)
- "Reset Wallet" button → confirms → resets to initial balance
- Current virtual balance display
- Equity curve mini-chart from snapshots

---

## Verification Checklist
- [ ] Setup wizard creates paper wallet automatically
- [ ] Mode toggle switches between LIVE and PAPER
- [ ] Paper mode: "Buy Now" creates virtual position (no Delta API call)
- [ ] Paper positions show real-time P&L against live market prices
- [ ] Stop-loss and take-profit auto-trigger on virtual positions
- [ ] Virtual wallet balance updates correctly on open/close
- [ ] Paper trade history is separate from live trade history
- [ ] Paper stats (win rate, total P&L) are calculated independently
- [ ] Reset wallet clears all positions and restores initial balance
- [ ] Custom starting balance can be set in settings
- [ ] Blue visual accent is visible in paper mode (header border, mode badge)
- [ ] Liquidation triggers when P&L exceeds 95% of margin
- [ ] Slippage simulation produces realistic fill prices
