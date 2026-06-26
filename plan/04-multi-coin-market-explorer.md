# Phase 4 — Multi-Coin Market Explorer

> **Goal:** Show ALL tradable cryptocurrencies from Delta Exchange India with live prices, search, filters, sparklines, and quick-access charts. **Every coin is immediately chartable, analyzable, and tradable — no coin selection step required.** The setup wizard does NOT ask the user to pick coins.

---

## Dependencies
- Phase 3 complete (WebSocket infrastructure, TradingChart working)

## Estimated Effort
- Backend: ~4 hours
- Frontend: ~6 hours

---

## Backend Tasks

### 1. Product Catalog Service
**File:** `server/src/services/ProductCatalog.js`

**Responsibilities:**
- On server boot, fetch `GET https://api.india.delta.exchange/v2/products`
- Filter: `contract_type === 'perpetual_futures'` AND `state === 'live'`
- Cache product list in memory (Map by symbol)
- Auto-refresh every 6 hours via `setInterval`
- Extract per product:
  - `id` (needed for order placement)
  - `symbol` (e.g., `BTCUSD`, `ETHUSD`, `SOLUSD`)
  - `description` (e.g., "Bitcoin Perpetual")
  - `tick_size` (minimum price increment)
  - `contract_value` (notional per contract)
  - `maker_commission_rate`, `taker_commission_rate`
  - `maintenance_margin` (for liquidation calculation)
- Expose on Socket.IO: emit `product_catalog` on client connect

**API Endpoint:**
```
GET /api/market/products
Response: { products: [...], count: 52 }
```

### 2. Enhanced WebSocket Manager
**Modify:** `server/src/services/DeltaWebSocketManager.js`

**Changes:**
- Subscribe to 1m candle channels for ALL products in catalog (not just user-selected)
- Maintain a live ticker map in memory:
  ```javascript
  tickerMap = {
    BTCUSD: { price: 68500, change24h: 2.3, volume24h: 1230000, high24h: 69000, low24h: 67000 },
    ETHUSD: { price: 3450, change24h: -0.8, ... },
    ...
  }
  ```
- Emit `market_ticker_batch` every 2 seconds via Socket.IO (full map, efficient)
- Track 24h high/low/volume from candle accumulation

### 3. Historical Candles Endpoint
**Modify:** `server/src/routes/market.js`

**New endpoint:**
```
GET /api/market/candles/:symbol/:resolution?start=&end=
```
- Fetches from Delta REST API: `GET /v2/history/candles?resolution=1m&symbol=BTCUSD&start=...&end=...`
- Returns OHLCV array formatted for lightweight-charts

---

## Frontend Tasks

### 4. Markets Page
**File:** `client/src/pages/Markets.jsx`

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  🔍 Search coins...                    [Grid] [Table] view   │
├──────────────────────────────────────────────────────────────┤
│  [All] [Top Gainers] [Top Losers] [Most Volume] [⭐ Watchlist] │
├──────────────────────────────────────────────────────────────┤
│  # │ Coin       │ Price     │ 24h %   │ Volume   │ Sparkline │
│  1 │ BTC/USD    │ $68,500   │ +2.3%   │ 1.23B    │ ~~~~~/~~  │
│  2 │ ETH/USD    │ $3,450    │ -0.8%   │ 456M     │ ~~\~~~~   │
│  3 │ SOL/USD    │ $142.50   │ +5.1%   │ 234M     │ ~~/~~~~~  │
│  ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

**Features:**
- **Search bar:** Instant filter by symbol (debounced 150ms)
- **Category tabs:**
  - All — all perpetual futures
  - Top Gainers — sorted by 24h% descending (green)
  - Top Losers — sorted by 24h% ascending (red)
  - Most Volume — sorted by 24h volume descending
  - Watchlist — user's starred coins only
- **Column sorting:** Click any header to sort asc/desc
- **Click any coin → navigates to Dashboard** with that coin's full chart, indicators, analysis, and trading panel loaded
- **No "tracked coins" concept** — every coin is always accessible. Watchlist is only for personal quick-access, not for limiting functionality
- **Table/Grid toggle:** Table view (dense data) vs Grid view (cards with logos)

### 5. Coin Row Component
**File:** `client/src/components/markets/CoinRow.jsx`

- Coin icon/avatar (first 2 chars of symbol as colored circle)
- Live-updating price with green/red flash animation on change
- 24h change % with color coding (green positive, red negative)
- Volume formatted with K/M/B suffixes
- Sparkline mini-chart (last 24h, using lightweight-charts `LineSeries` in a 100×30 canvas)
- Star icon (⭐) to toggle watchlist membership

### 6. Market Grid Card
**File:** `client/src/components/markets/MarketGrid.jsx`

- Card layout for grid view
- Glassmorphic card with coin avatar, name, price, change badge
- Mini sparkline inside card
- Hover: scale-up effect + "View Chart →" overlay

### 7. Watchlist Manager
**File:** `client/src/components/markets/WatchlistManager.jsx`

- Persisted in MongoDB: `UserPreferences.watchlist: [String]`
- Add/remove via star icon on any coin row
- API: `PATCH /api/profile/preferences` to update watchlist array
- Max 20 coins in watchlist

### 8. Navigation Update
**Modify:** `client/src/pages/Dashboard.jsx` sidebar/header

- Add "Markets" icon+link to navigation
- Markets page accessible from sidebar icon (grid icon)
- Pass `?coin=SOLUSD` query param when navigating from Markets → Dashboard

---

## Route Registration
**Modify:** `server/src/app.js`
- Initialize `ProductCatalog` on boot (before WebSocket)
- Pass catalog to `DeltaWebSocketManager` so it knows which channels to subscribe

**Modify:** `client/src/App.jsx`
- Add route: `<Route path="/markets" element={<Markets />} />`

---

## Verification Checklist
- [ ] `/api/market/products` returns 50+ perpetual futures
- [ ] Market page loads and shows all coins with live prices
- [ ] Search filters coins instantly
- [ ] Category tabs sort correctly (gainers/losers/volume)
- [ ] Clicking a coin navigates to Dashboard with correct chart
- [ ] Watchlist star persists across page reloads
- [ ] Sparkline mini-charts render and update
- [ ] Grid view shows cards with hover effects
- [ ] Mobile: table scrolls horizontally, grid stacks vertically
