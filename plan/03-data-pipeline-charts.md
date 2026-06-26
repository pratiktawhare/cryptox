# Phase 3 — Data Pipeline & Live Charts

> **Goal:** Connect to Delta Exchange, stream real-time prices, and render professional interactive candlestick charts.

---

## Step 3.1 — Delta Exchange REST API Client

#### [NEW] `server/src/services/deltaExchange.js`

```javascript
// Core API client class
class DeltaExchangeClient {
    constructor(apiKey, apiSecret) { ... }
    
    // HMAC-SHA256 signature generation
    generateSignature(method, timestamp, path, queryString, body) { ... }
    
    // Public endpoints (no auth needed)
    async getProducts()           // GET /v2/products — all tradable coins
    async getCandles(symbol, resolution, start, end)  // GET /v2/history/candles
    async getTicker(symbol)       // GET /v2/tickers — 24h stats
    
    // Authenticated endpoints (for future auto-trade)
    async getWallet()             // GET /v2/wallet/balances
    async testConnection()        // Verify API key works
}
```

**Key Details:**
- Base URL: `https://api.india.delta.exchange/v2`
- Signature: `HMAC-SHA256(secret, METHOD + TIMESTAMP + PATH + QUERY + BODY)`
- Headers: `api-key`, `timestamp`, `signature`
- Rate limiting: Implement token bucket to stay within Delta's weight limits

---

## Step 3.2 — Delta Exchange WebSocket Service

#### [NEW] `server/src/services/deltaWebSocket.js`

```javascript
class DeltaWebSocketManager {
    constructor() {
        this.ws = null;
        this.subscriptions = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 50;
        this.priceCache = {};    // Latest prices for all tracked coins
        this.candleCache = {};   // Latest candle data per coin per timeframe
    }
    
    connect() {
        // Connect to wss://public-socket.india.delta.exchange (public data)
        // Or wss://socket.india.delta.exchange (private, authenticated)
        // Auth method: 'key-auth' (NOT legacy 'auth' — deprecated since Dec 2025)
        // Subscribe to channels for tracked coins
    }
    
    subscribe(coins) {
        // Subscribe message format:
        // { type: "subscribe", payload: { channels: [
        //     { name: "candlesticks", symbols: ["BTCUSD", "ETHUSD"] },
        //     { name: "v2/ticker", symbols: ["BTCUSD", "ETHUSD"] }
        // ]}}
        // NOTE: mark_price, candlesticks, spot_price now on public-socket endpoint
        // NOTE: 7d, 2w, 30d candle resolutions removed by Delta (Oct 2025)
    }
    
    // Auto-reconnect with exponential backoff
    reconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        // Wait delay, then connect()
    }
    
    // Heartbeat: if no message in 30s, force reconnect
    startHeartbeat() { ... }
    
    // Emit events for new data
    onPriceUpdate(symbol, price) { ... }
    onCandleUpdate(symbol, candle) { ... }
}
```

**WebSocket → Socket.IO Bridge:**
- Backend WebSocket receives Delta Exchange data
- Normalizes the data format
- Emits via Socket.IO to connected frontend clients

---

## Step 3.3 — Socket.IO Server Bridge

#### [MODIFY] `server/src/app.js`
Add Socket.IO server initialization:
```javascript
const io = new Server(httpServer, { cors: { ... } });

io.on('connection', (socket) => {
    // Authenticate socket connection with JWT
    // Subscribe to price feeds
    // Relay real-time data to client
});

// DeltaWebSocket emits → Socket.IO relays to frontend
deltaWS.on('priceUpdate', (data) => io.emit('price:update', data));
deltaWS.on('candleUpdate', (data) => io.emit('candle:update', data));
```

---

## Step 3.4 — API Routes for Market Data

#### [NEW] `server/src/routes/market.js`
- `GET /api/market/products` — List available coins from Delta Exchange
- `GET /api/market/candles/:symbol` — Historical candles (params: resolution, start, end)
- `GET /api/market/ticker/:symbol` — Current 24h stats
- `GET /api/market/prices` — Current prices for all tracked coins

---

## Step 3.5 — TradingView Chart Component

#### [NEW] `client/src/components/charts/CandlestickChart.jsx`

```jsx
// Professional candlestick chart using TradingView Lightweight Charts
// Features:
// - Candlestick series with custom colors
// - Volume histogram overlay
// - Time range buttons: [1m] [5m] [15m] [1h] [4h] [1D]
// - Crosshair with price/time tooltip
// - Auto-resize on window resize
// - Real-time update via socket
// - Support/Resistance horizontal lines (from indicators)
// - Dark/Light theme adaptation
```

Key implementation:
```javascript
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
// NOTE: lightweight-charts v5 uses addSeries(Type) instead of addCandlestickSeries()

// Initialize chart in useEffect
const chart = createChart(containerRef.current, {
    layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme === 'dark' ? '#d1d4dc' : '#333',
    },
    grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
    },
    crosshair: { mode: 0 },
    timeScale: { timeVisible: true, secondsVisible: false },
});

const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#00e676',
    downColor: '#ff1744',
    borderUpColor: '#00e676',
    borderDownColor: '#ff1744',
    wickUpColor: '#00e676',
    wickDownColor: '#ff1744',
});

// Load historical data
candleSeries.setData(historicalCandles);

// Real-time update via WebSocket
socket.on('candle:update', (data) => {
    if (data.symbol === selectedCoin) {
        candleSeries.update(data.candle);
    }
});
```

#### [NEW] `client/src/components/charts/TimeframeSelector.jsx`
- Button group: 1m | 5m | 15m | 1h | 4h | 1D
- Active button highlighted with accent color
- Clicking changes chart resolution + re-fetches historical data

#### [NEW] `client/src/components/charts/VolumeChart.jsx`
- Volume histogram below candlestick chart
- Green bars for up candles, red for down

---

## Step 3.6 — Price Ticker Bar

#### [NEW] `client/src/components/layout/PriceTicker.jsx`
- Horizontally scrolling bar at top of dashboard
- Shows all tracked coins: `LOGO  BTC  $67,420  ↑2.3%`
- Color flash on price change (green up, red down)
- Click a coin → switches main chart to that coin
- Updates in real-time via Socket.IO

---

## Step 3.7 — WebSocket Hook

#### [NEW] `client/src/hooks/useSocket.js`
```javascript
// Custom hook for Socket.IO connection
export function useSocket() {
    // Connect to backend Socket.IO
    // Auto-reconnect
    // Cleanup on unmount
    // Return: socket instance, connection status
}
```

#### [NEW] `client/src/context/SocketContext.jsx`
- Provides socket instance to all components
- Connection status indicator in header

---

## Step 3.8 — Testing

- Start backend → verify WebSocket connects to Delta Exchange
- Verify candlestick data fetched via REST for BTCUSD
- Verify real-time price updates flowing via WebSocket
- Frontend chart renders historical candles
- Frontend chart updates in real-time
- Time range switching works
- Price ticker updates live
- Reconnection works after network interruption
