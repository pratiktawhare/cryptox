# Phase 10 — Notifications, Polish & Deployment

> **Goal:** Push notifications with sound alerts, mobile-responsive polish across all pages, final UX refinements, and deployment to Oracle Cloud "Always Free" VPS.

---

## Dependencies
- Phase 9 complete (all trading, analytics, and self-learning working)

## Estimated Effort
- Backend: ~4 hours
- Frontend: ~6 hours
- Deployment: ~3 hours

---

## Backend Tasks

### 1. Notification Service
**File:** `server/src/services/NotificationService.js`

**Real-time notification system via Socket.IO:**

```javascript
class NotificationService {
  constructor(io) {
    this.io = io;
  }

  // Called by SignalEngine when new high-confidence signal arrives
  async notifyNewSignal(userId, signal) {
    if (signal.confidence >= 70) {
      await this.create(userId, {
        type: 'signal',
        title: `${signal.signalType} ${signal.coinSymbol}`,
        message: `${signal.confidence}% confidence | Entry: $${signal.entryPrice} | R:R ${signal.riskRewardRatio}`,
        signalId: signal._id,
        priority: signal.confidence >= 85 ? 'high' : 'medium',
        sound: signal.confidence >= 85 ? 'signal_high' : 'signal_normal'
      });
    }
  }

  // Called by SignalTracker when target/SL is hit
  async notifySignalResolved(userId, signal, status) {
    const isWin = status === 'hit_target';
    await this.create(userId, {
      type: isWin ? 'alert' : 'alert',
      title: isWin ? `🎯 Target Hit: ${signal.coinSymbol}` : `🛑 Stop Loss: ${signal.coinSymbol}`,
      message: isWin
        ? `+${signal.outcomePnlPct.toFixed(1)}% profit on ${signal.signalType}`
        : `${signal.outcomePnlPct.toFixed(1)}% loss on ${signal.signalType}`,
      signalId: signal._id,
      priority: 'high',
      sound: isWin ? 'target_hit' : 'stoploss_hit'
    });
  }

  // Called by PositionTracker for P&L threshold alerts
  async notifyPnLThreshold(userId, position, threshold) {
    await this.create(userId, {
      type: 'alert',
      title: `${position.symbol} P&L Alert`,
      message: `Position is now ${threshold > 0 ? '+' : ''}${threshold}% (${position.side})`,
      priority: 'medium',
      sound: threshold > 0 ? 'pnl_positive' : 'pnl_negative'
    });
  }

  // Daily summary (runs at midnight IST via cron)
  async notifyDailySummary(userId) {
    const stats = await this.getDailyStats(userId);
    await this.create(userId, {
      type: 'system',
      title: '📊 Daily Trading Summary',
      message: `Signals: ${stats.signalCount} | Trades: ${stats.tradeCount} | P&L: ${stats.totalPnL > 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}`,
      priority: 'low'
    });
  }

  async create(userId, notification) {
    const doc = await Notification.create({ userId, ...notification });

    // Emit real-time via Socket.IO
    this.io.to(`user:${userId}`).emit('notification', {
      id: doc._id,
      ...notification,
      createdAt: doc.createdAt
    });

    return doc;
  }
}
```

### 2. Notification Model
**File:** `server/src/models/Notification.js`

```javascript
const notificationSchema = new Schema({
  userId:    { type: ObjectId, ref: 'User', required: true, index: true },
  signalId:  { type: ObjectId, ref: 'TradeSignal' },
  type:      { type: String, required: true, enum: ['signal', 'alert', 'system', 'resolved'] },
  title:     { type: String, required: true },
  message:   { type: String, required: true },
  priority:  { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  sound:     String,           // sound effect key
  isRead:    { type: Boolean, default: false, index: true },
  readAt:    Date
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
```

### 3. Notification Routes
**File:** `server/src/routes/notifications.js`

```
GET   /api/notifications           — paginated list (unread first)
GET   /api/notifications/unread    — count of unread notifications
PATCH /api/notifications/:id/read  — mark single as read
PATCH /api/notifications/read-all  — mark all as read
DELETE /api/notifications/:id      — delete single notification
```

### 4. Daily Summary Cron
**Modify:** `server/src/app.js`

```javascript
// Run daily summary at midnight IST (18:30 UTC)
const cron = require('node-cron');
cron.schedule('30 18 * * *', async () => {
  const users = await User.find({});
  for (const user of users) {
    await notificationService.notifyDailySummary(user._id);
  }
});
```

**NPM package:**
```bash
npm install node-cron
```

---

## Frontend Tasks

### 5. Notification Bell
**File:** `client/src/components/common/NotificationBell.jsx`

**Bell icon in header with dropdown:**
```
        🔔 (3)
        ┌─────────────────────────────────────┐
        │  Notifications              [Clear] │
        ├─────────────────────────────────────┤
        │  🟢 LONG BTC/USD 78%     2m ago    │
        │  Entry $68,200 | R:R 2.8:1         │
        │                                     │
        │  🎯 Target Hit: ETH/USD   15m ago  │
        │  +3.4% profit                      │
        │                                     │
        │  🛑 Stop Loss: SOL/USD    1h ago   │
        │  -1.6% loss                        │
        ├─────────────────────────────────────┤
        │  View all notifications →           │
        └─────────────────────────────────────┘
```

**Features:**
- Unread count badge (red circle with number)
- Dropdown on click (max 10 recent)
- Click notification → navigate to relevant signal/position
- Mark as read on click
- "Clear all" button
- Fade-in animation for new notifications

### 6. Sound Alert System
**File:** `client/src/components/common/SoundAlert.jsx`

**Audio feedback on notifications:**
- Pre-load sound files on app mount
- Play audio based on `notification.sound` key:
  - `signal_high` → distinctive chime (high confidence signal)
  - `signal_normal` → subtle ping
  - `target_hit` → cash register / success sound
  - `stoploss_hit` → warning tone
  - `pnl_positive` → subtle positive ping
  - `pnl_negative` → subtle negative ping
- Sound files: small MP3s stored in `client/public/sounds/`
- User toggle: Settings → "Enable notification sounds" (persisted in preferences)
- Respect browser autoplay policy: first interaction enables audio

### 7. Mobile Responsive Polish

**All pages need responsive treatment:**

#### Dashboard (`Dashboard.jsx`)
- Stack panels vertically on mobile (<768px)
- Chart takes full width, indicator panel below
- Header compresses: hide labels, show only icons
- Coin selector becomes a dropdown instead of horizontal scroll

#### Markets (`Markets.jsx`)
- Auto-switch to Grid view on mobile
- Search bar is full-width
- Category tabs scroll horizontally
- Table columns: hide volume + sparkline on small screens

#### Signals (`Signals.jsx`)
- Signal cards are full-width stacked
- Reasoning section starts collapsed
- Action buttons are full-width at bottom of card

#### Positions (`Positions.jsx`)
- Switch to card view on mobile
- Swipe-left gesture to reveal "Close" button
- P&L counter is large and prominent

#### Analytics (`Analytics.jsx`)
- Charts stack vertically
- Summary cards become 2-column grid
- Equity curve is full-width

**CSS approach:** Use Tailwind breakpoints (`sm:`, `md:`, `lg:`) consistently:
```css
/* Mobile first */
.grid-container {
  @apply grid grid-cols-1 gap-4;
  @apply md:grid-cols-2;
  @apply lg:grid-cols-3;
}
```

### 8. Final UX Polish

#### Loading States
- Every page has a skeleton loader (not just "Loading...")
- API calls show inline spinners on buttons
- Charts show placeholder shimmer before data loads

#### Error States
- Friendly error messages for all API failures
- Retry buttons on failed data loads
- Offline detection banner ("No internet connection")

#### Transitions & Animations
- Page transitions: fade-in (150ms)
- Card hover: subtle scale + shadow
- New signal arrival: slide-in from right
- P&L counter: animated number change (count up/down)
- Notification bell: shake animation on new notification
- Mode toggle: smooth slide with color transition

#### Accessibility
- All interactive elements have focus rings
- Color contrast meets WCAG AA standards
- Screen reader labels on icons
- Keyboard navigation through all dialogs

---

## Deployment — Oracle Cloud VPS

### Server Setup

#### Instance Provisioning
```
Shape:      VM.Standard.A1.Flex (ARM — Always Free)
OCPUs:      4
RAM:        24 GB
Boot Volume: 100 GB
OS:         Ubuntu 22.04 Minimal
Region:     Any (pick closest to you)
```

#### Install Stack
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install MongoDB 7
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [ arch=arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod

# Install PM2 (process manager)
sudo npm install -g pm2

# Install Nginx (reverse proxy)
sudo apt install -y nginx

# Install Certbot (HTTPS)
sudo apt install -y certbot python3-certbot-nginx
```

#### Clone & Build
```bash
# Clone project
cd /opt
sudo git clone <your-repo-url> cryptox
cd cryptox

# Backend
cd server
npm install --production
cp .env.example .env
nano .env  # Fill in: MONGO_URI, JWT_SECRET, ENCRYPTION_KEY, GEMINI_API_KEY, DELTA_*

# Frontend
cd ../client
npm install
npm run build   # Produces dist/ folder
```

#### PM2 Configuration
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'cryptox-server',
    script: 'src/app.js',
    cwd: '/opt/cryptox/server',
    instances: 1,
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/cryptox/error.log',
    out_file: '/var/log/cryptox/out.log'
  }]
};
```

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # auto-start on reboot
```

#### Nginx Configuration
```nginx
# /etc/nginx/sites-available/cryptox
server {
    listen 80;
    server_name your-domain.com;

    # Serve React frontend
    root /opt/cryptox/client/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.IO proxy
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cryptox /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

#### HTTPS (Let's Encrypt)
```bash
sudo certbot --nginx -d your-domain.com
# Auto-renewal is configured by default
```

#### Firewall
```bash
# Oracle Cloud: open ports 80, 443 in VCN Security List
# OS firewall:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 7 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

#### Delta Exchange API Key
> [!WARNING]
> You must add the VPS public IP to your Delta Exchange API key's allowed IP list. Go to Delta Exchange → API Management → Edit your key → Add the VPS IP.

---

## Update Checklist
- [ ] Notification bell shows unread count
- [ ] Clicking notification navigates to correct signal/position
- [ ] Sound plays on high-confidence signal arrival
- [ ] Sound toggle in settings works (persists across sessions)
- [ ] Daily summary notification arrives at midnight IST
- [ ] All pages are responsive at 375px, 768px, 1024px, 1440px widths
- [ ] Skeleton loaders appear before data loads
- [ ] Error states show friendly messages with retry buttons
- [ ] Page transitions are smooth (no flash of unstyled content)
- [ ] VPS: app accessible at https://your-domain.com
- [ ] VPS: WebSocket connections work through Nginx proxy
- [ ] VPS: MongoDB is running and data persists across restarts
- [ ] VPS: PM2 auto-restarts app on crash and on reboot
- [ ] VPS: HTTPS certificate is valid and auto-renewing
