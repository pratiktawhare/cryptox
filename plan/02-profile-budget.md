# Phase 2 — Profile, Settings & Budget Management (Updated)

> **Goal:** Build the complete settings infrastructure — API key management, budget/portfolio configuration, leverage settings, scan frequency, and all trading preferences.

---

## Step 2.1 — API Key Management Backend

#### [NEW] `server/src/routes/apiKeys.js`
All routes protected by auth middleware:
- `POST /api/keys` — Add new API key (encrypt → store)
- `GET /api/keys` — List all keys (masked: `••••a3f2`)
- `PUT /api/keys/:id/activate` — Set as active, deactivate others
- `DELETE /api/keys/:id` — Remove key
- `POST /api/keys/:id/test` — Test Delta Exchange connection

#### [NEW] `server/src/models/apiKeyModel.js`
- CRUD operations with encryption/decryption
- Only one active key per user at a time

---

## Step 2.2 — Budget & Preferences Backend

#### [NEW] `server/src/routes/preferences.js`
- `GET /api/preferences` — Get all user preferences
- `PUT /api/preferences` — Update any subset of preferences
- `GET /api/preferences/available-coins` — Fetch tradable coins from Delta Exchange

#### [NEW] `server/src/routes/budget.js`
- `GET /api/budget/summary` — Portfolio overview (budget, allocated, available, active positions)
- `GET /api/budget/allocations` — List all active allocations
- `PUT /api/budget/update` — Update total budget amount

#### [NEW] `server/src/models/preferencesModel.js`
- Get/update preferences with defaults
- Validate budget, leverage, and risk values

#### [NEW] `server/src/models/budgetModel.js`
- `getPortfolioSummary(userId)` → total, allocated, available, reserve
- `createAllocation(signalId, amount, leverage, ...)`
- `closeAllocation(allocationId, pnl)`
- `getActiveAllocations(userId)`

---

## Step 2.3 — Profile Page Frontend

#### [NEW] `client/src/pages/Profile.jsx`
Tabbed layout with smooth tab transitions:
- **Tab 1: 🔑 API Keys**
- **Tab 2: 💰 Budget & Portfolio**
- **Tab 3: ⚙️ Trading Preferences**
- **Tab 4: 📊 AI Performance** (placeholder, built in Phase 5)

---

## Step 2.4 — API Key Manager Component

#### [NEW] `client/src/components/settings/ApiKeyManager.jsx`
- **"+ Add API Key"** button → opens modal form
- Modal form:
  - Key Name (e.g., "My Delta Key")
  - Exchange: dropdown (Delta Exchange pre-selected)
  - API Key: monospace input
  - API Secret: masked input with show/hide
  - Permissions: Read Only (default) / Read & Write
- **Key list** — cards showing:
  - Name, exchange icon, masked key `••••a3f2`
  - 🟢 Active / ⚪ Inactive badge
  - Buttons: [Activate] [Test] [Delete]
- Confirm modal for delete: "This action cannot be undone"
- Success/error toasts for all actions

---

## Step 2.5 — Budget & Portfolio Panel

#### [NEW] `client/src/components/settings/BudgetPanel.jsx`

```
┌─────────────────────────────────────────────────────┐
│  💰 Budget & Portfolio Management                    │
│                                                      │
│  ┌─ Total Budget ──────────────────────────────────┐│
│  │                                                  ││
│  │  ₹ [50,000]  Currency: [INR ▾]     [Update]    ││
│  │                                                  ││
│  │  Quick set: [₹10K] [₹25K] [₹50K] [₹1L] [₹5L] ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Live Allocation ──────────────────────────────┐ │
│  │                                                  │ │
│  │  Allocated    ■■■■■■░░░░░░░░░  30% (₹15,000)  │ │
│  │  Reserved     ░░░▓▓░░░░░░░░░░  20% (₹10,000)  │ │
│  │  Available    ░░░░░░░░░■■■■■■  50% (₹25,000)  │ │
│  │                                                  │ │
│  │  Active Positions: 2 / 5 max                     │ │
│  │                                                  │ │
│  │  ┌────────┬────────┬─────────┬──────┬────────┐ │ │
│  │  │ Coin   │ Side   │ Margin  │ Lev  │ P&L    │ │ │
│  │  ├────────┼────────┼─────────┼──────┼────────┤ │ │
│  │  │ BTCUSD │ LONG ↑ │ ₹8,000  │ 5x   │ +₹420  │ │ │
│  │  │ ETHUSD │ SHORT↓ │ ₹7,000  │ 3x   │ -₹180  │ │ │
│  │  └────────┴────────┴─────────┴──────┴────────┘ │ │
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Leverage Settings ─────────────────────────────┐│
│  │                                                  ││
│  │  Maximum Leverage:                                ││
│  │  [1x]──[2x]──[3x]──[5x]──[●10x]               ││
│  │                                                  ││
│  │  ☑ Let AI suggest optimal leverage per trade     ││
│  │                                                  ││
│  │  ⚠️ Higher leverage = higher liquidation risk    ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Diversification Rules ─────────────────────────┐│
│  │                                                  ││
│  │  Max per single trade:  [────●──────] 30%       ││
│  │  Min reserve (always):  [──●────────] 20%       ││
│  │  Max concurrent trades: [5 ▾]                   ││
│  │  Max risk per trade:    [────●──────] 2%        ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│                              [💾 Save All Changes]   │
└─────────────────────────────────────────────────────┘
```

---

## Step 2.6 — Trading Preferences Panel

#### [NEW] `client/src/components/settings/TradingPreferences.jsx`

```
┌─────────────────────────────────────────────────────┐
│  ⚙️ Trading Preferences                             │
│                                                      │
│  ┌─ Coin Watchlist ────────────────────────────────┐│
│  │                                                  ││
│  │  🔍 [Search coins...]                           ││
│  │                                                  ││
│  │  Selected (4):                                   ││
│  │  [✕ BTCUSD] [✕ ETHUSD] [✕ SOLUSD] [✕ XRPUSD] ││
│  │                                                  ││
│  │  Available:                                      ││
│  │  ☐ LINKUSD   Chainlink    Vol: $2.1M            ││
│  │  ☐ AVAXUSD   Avalanche    Vol: $1.8M            ││
│  │  ☐ MATICUSD  Polygon      Vol: $1.2M            ││
│  │  ...                                             ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Risk Appetite ─────────────────────────────────┐│
│  │                                                  ││
│  │  [🛡️ Conservative]  [⚖️ Balanced]  [🔥 Aggressive]  ││
│  │        ●                                         ││
│  │                                                  ││
│  │  Conservative:                                   ││
│  │  • Only signals with ≥80% confidence             ││
│  │  • Max 3x leverage suggestion                    ││
│  │  • Tighter stop-losses                           ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Profit Target ─────────────────────────────────┐│
│  │                                                  ││
│  │  Target profit per trade:                        ││
│  │  [──────●──────────] 2.0%                       ││
│  │  Range: 0.5% — 20%                              ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Scan Frequency ───────────────────────────────┐ │
│  │                                                  │ │
│  │  How often should AI scan for trade signals?     │ │
│  │                                                  │ │
│  │  (●) ⚡ Every 1 minute                          │ │
│  │      Aggressive — catches fast moves             │ │
│  │      Higher AI API usage                         │ │
│  │                                                  │ │
│  │  ( ) 📊 Every 5 minutes  ★ Recommended          │ │
│  │      Balanced — good signal quality              │ │
│  │                                                  │ │
│  │  ( ) 🕐 Every 15 minutes                        │ │
│  │      Conservative — fewer but higher quality     │ │
│  │                                                  │ │
│  │  ( ) 🖱️ On-demand only                          │ │
│  │      Manual — click "Analyze" to scan            │ │
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Notifications ─────────────────────────────────┐│
│  │                                                  ││
│  │  🔔 New signal alerts:    [●━━━ ON]             ││
│  │  🔊 Notification sound:   [●━━━ ON]             ││
│  │  📊 Signal resolved:      [●━━━ ON]             ││
│  │  ⚙️ System alerts:        [━━━● OFF]            ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│                              [💾 Save All Changes]   │
└─────────────────────────────────────────────────────┘
```

---

## Step 2.7 — Common Components

#### [NEW] `client/src/components/common/Modal.jsx`
- Overlay + centered card
- Close on backdrop click or Escape key
- Slide-up animation on open
- Fade-out on close

#### [NEW] `client/src/components/common/Slider.jsx`
- Custom styled range input
- Shows current value
- Min/Max labels
- Accent color thumb

#### [NEW] `client/src/components/common/Select.jsx`
- Custom dropdown with search
- Multi-select support (for coins)
- Chip display for selected items

#### [NEW] `client/src/components/common/Toast.jsx`
- Position: top-right, stacked
- Types: success (green), error (red), warning (yellow), info (blue)
- Auto-dismiss with progress bar
- Manual dismiss with X

#### [NEW] `client/src/components/common/SegmentedControl.jsx`
- Pill-style toggle group
- Smooth sliding indicator
- Used for risk appetite, mode toggle

#### [NEW] `client/src/hooks/useBudget.js`
```javascript
// Custom hook for budget state
// Fetches portfolio summary from backend
// Returns: totalBudget, allocated, available, activePositions, loading
// Provides: updateBudget(), refreshSummary()
```

---

## Step 2.8 — Testing

| Test | Expected |
|---|---|
| Add Delta Exchange API key | Encrypted in DB, shows masked in UI |
| Activate key | Green badge, previous key deactivated |
| Test connection | Success/error toast |
| Delete key | Confirmation modal → removed |
| Set budget ₹50,000 | Saved, allocation bar shows 100% available |
| Set max leverage 10x | Saved, slider at max |
| Select 4 coins | Chips displayed, saved to DB |
| Set scan to 5min | Radio selected, saved |
| Change risk appetite | Description updates, saved |
| Toggle notification sound | Preference saved |
| Page refresh | All settings persist |
