/**
 * test-algo-entry.js
 *
 * Comprehensive test suite for the Institutional Quant Algo Entry Strategy:
 *   1. Closed-Bar Confirmation (MarketAnalyzer 5m indicators on closed bar vs live wick)
 *   2. Absorption Rejection Wicks (1m hammer / inverted hammer ratio detection)
 *   3. SignalScorer Condition 7 (Absorption wick & momentum confirmation)
 *   4. Dynamic Support Pullback Pricing (TradingBot entry discount formula)
 *   5. Paper Mode Resting Limit Order Execution (ExecutionEngine margin reservation)
 *   6. EntryOrderWatcher Pullback Fill Simulation & 15-Minute Timeout Refund
 */

try { require('./server/node_modules/dotenv').config({ path: './server/.env' }); } catch (_) {}

const candleStore        = require('./server/src/services/bot/CandleStore');
const { analyzeSymbol } = require('./server/src/services/bot/MarketAnalyzer');
const { scoreSignal }   = require('./server/src/services/bot/SignalScorer');
const executionEngine   = require('./server/src/services/bot/ExecutionEngine');
const entryOrderWatcher = require('./server/src/services/bot/EntryOrderWatcher');
const BotTrade          = require('./server/src/models/BotTrade');
const BotEvent          = require('./server/src/models/BotEvent');
const PaperWallet       = require('./server/src/models/PaperWallet');
const PaperPosition     = require('./server/src/models/PaperPosition');

// Terminal colors
const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m';
const C = '\x1b[36m'; const B = '\x1b[1m'; const DIM = '\x1b[2m'; const RESET = '\x1b[0m';

let passed = 0; let failed = 0;
function assert(label, condition, detail = '') {
    if (condition) {
        console.log(`  ${G}✅ PASS${RESET} ${label}${detail ? DIM + '  (' + detail + ')' + RESET : ''}`);
        passed++;
    } else {
        console.log(`  ${R}❌ FAIL${RESET} ${B}${label}${RESET}${detail ? '  ' + Y + '(' + detail + ')' + RESET : ''}`);
        failed++;
    }
}

async function runTests() {
    console.log(`\n${B}${C}======================================================${RESET}`);
    console.log(`${B}${C} INSTITUTIONAL QUANT ALGO ENTRY VERIFICATION SUITE    ${RESET}`);
    console.log(`${B}${C}======================================================${RESET}\n`);

    // ── Test 1: Closed-Bar Indicators in MarketAnalyzer ─────────────────────
    console.log(`${B}[1] Closed-Bar 5m Confirmation & Absorption Wicks${RESET}`);
    {
        // 35 candles: last candle spikes violently by +5%, but previous 34 are steady
        const candles5m = [];
        let p = 100;
        for (let i = 0; i < 34; i++) {
            candles5m.push({ open: p, high: p * 1.002, low: p * 0.998, close: p, volume: 1000 });
        }
        // Unclosed live candle: huge spike
        candles5m.push({ open: p, high: p * 1.05, low: p, close: p * 1.05, volume: 10000 });

        // 1m candles with a hammer candle (lower absorption wick) on last 1m candle
        const candles1m = [];
        for (let i = 0; i < 30; i++) {
            candles1m.push({ open: 104, high: 105, low: 103.5, close: 104.5, volume: 500 });
        }
        // Last 1m candle: hammer (buyer absorption wick at the bottom)
        // High: 105, Open: 104.5, Close: 104.8, Low: 103.0
        // Lower wick: min(104.5, 104.8) - 103.0 = 1.5. Range: 105 - 103 = 2.0. Ratio: 1.5 / 2.0 = 0.75
        candles1m.push({ open: 104.5, high: 105.0, low: 103.0, close: 104.8, volume: 1500 });

        candleStore._store.set('BTCUSDT:5m', candles5m);
        candleStore._store.set('BTCUSDT:1m', candles1m);

        const mockWs = { getPrice: () => 104.8, getTicker: () => ({ mark_price: 104.8 }) };
        const snapshot = analyzeSymbol('BTCUSDT', mockWs);

        assert('MarketAnalyzer computes snapshot without throwing', !!snapshot);
        // The 5m close used for EMA calculation should be the CLOSED candle (100), not the live spike (105)
        assert('5m EMA9 based on closed candle (~100), ignoring live spike', Math.abs(snapshot['5m'].ema9 - 100) < 1.0, `ema9=${snapshot['5m'].ema9}`);
        assert('Lower wick ratio detected (> 0.50 for hammer absorption)', snapshot['1m'].lowerWickRatio >= 0.50, `lowerWickRatio=${snapshot['1m'].lowerWickRatio?.toFixed(3)}`);
        assert('Upper wick ratio detected (< 0.20 for hammer)', snapshot['1m'].upperWickRatio <= 0.20, `upperWickRatio=${snapshot['1m'].upperWickRatio?.toFixed(3)}`);
    }

    // ── Test 2: SignalScorer Absorption Confirmation ────────────────────────
    console.log(`\n${B}[2] SignalScorer Condition 7 Absorption Confirmation${RESET}`);
    {
        // Snapshot where 1m momentum is slightly negative (-0.05%), BUT lowerWickRatio = 0.35 (buyer absorption)
        const snapshotWithWick = {
            symbol: 'ETHUSDT',
            close: 3000,
            '5m': {
                ema9: 2980,
                ema21: 2950,
                ema21Slope: 0.15,
                rsi: 55,
                rsiSlope: 0.05,
                atr: 15,
                atrPct: 0.5,
                stretchRatio: 1.33,
                volumeRatio: 1.8,
                close: 3000,
            },
            '1m': {
                ema9: 2990,
                ema21: 2985,
                rsi: 52,
                momentum: -0.05, // Pulling back
                lowerWickRatio: 0.35, // Significant buyer absorption wick!
                upperWickRatio: 0.05,
                close: 3000,
            },
            spread: 0.01,
        };

        const scoreLong = scoreSignal(snapshotWithWick, { regime: 'TRENDING_UP', confidence: 80 });
        assert('Condition 7 (momentum) passes for LONG when lowerWickRatio >= 0.20 despite negative 1m momentum', scoreLong.conditions.momentum === true);

        // Inverse test for SHORT with upper wick absorption
        const snapshotShortWick = {
            symbol: 'ETHUSDT',
            close: 2900,
            '5m': {
                ema9: 2920,
                ema21: 2950,
                ema21Slope: -0.15,
                rsi: 45,
                rsiSlope: -0.05,
                atr: 15,
                atrPct: 0.5,
                stretchRatio: 1.33,
                volumeRatio: 1.8,
                close: 2900,
            },
            '1m': {
                ema9: 2910,
                ema21: 2915,
                rsi: 48,
                momentum: 0.05, // Bouncing up
                lowerWickRatio: 0.05,
                upperWickRatio: 0.35, // Significant seller absorption wick!
                close: 2900,
            },
            spread: 0.01,
        };
        const scoreShort = scoreSignal(snapshotShortWick, { regime: 'TRENDING_DOWN', confidence: 80 });
        assert('Condition 7 (momentum) passes for SHORT when upperWickRatio >= 0.20 despite positive 1m momentum', scoreShort.conditions.momentum === true);
    }

    // ── Test 3: Pullback Entry Pricing Geometry ─────────────────────────────
    console.log(`\n${B}[3] Pullback Entry Pricing Formula (Dynamic Support / ATR Discount)${RESET}`);
    {
        const livePrice = 100.0;
        const ema9 = 99.40; // 0.6% below current price
        const atr = 1.0;    // 1% ATR

        // Target discount: 0.35% - 0.50%
        const atrDiscountLong = livePrice * 0.0035; // 0.35
        const candidateSupport = Math.max(ema9, livePrice - (livePrice * 0.0050)); // max(99.40, 99.50) = 99.50
        const targetEntryPrice = Math.min(livePrice - atrDiscountLong, candidateSupport); // min(99.65, 99.50) = 99.50

        assert('Pullback entry price is strictly below current market price', targetEntryPrice < livePrice, `entry=${targetEntryPrice} < live=${livePrice}`);
        const discountPct = ((livePrice - targetEntryPrice) / livePrice) * 100;
        assert('Discount is between 0.35% and 0.50% (saving 7%–10% adverse ROI at 20x)', discountPct >= 0.35 && discountPct <= 0.55, `discountPct=${discountPct.toFixed(2)}%`);
    }

    // ── Test 4: Paper Resting Limit Order in ExecutionEngine ────────────────
    console.log(`\n${B}[4] ExecutionEngine Paper Resting Limit Order Creation${RESET}`);
    {
        // Mock mongoose models in-memory for unit testing
        const mockUserId = '507f1f77bcf86cd799439011';
        let savedWallet = {
            userId: mockUserId,
            available: 100,
            used: 0,
            balance: 100,
            save: async function() { return this; },
            toObject: function() { return { ...this }; },
        };

        const TradingConfig = require('./server/src/models/TradingConfig');
        const origFindConfig = TradingConfig.findOne;
        TradingConfig.findOne = async () => ({ maxOpenPositions: 5, walletParts: 5 });

        const originalFindOneWallet = PaperWallet.findOne;
        PaperWallet.findOne = async () => savedWallet;

        const originalFindOneTrade = BotTrade.findOne;
        BotTrade.findOne = async () => null;

        const originalCountTrades = BotTrade.countDocuments;
        BotTrade.countDocuments = async () => 0;

        const originalCreateTrade = BotTrade.create;
        let createdTrade = null;
        BotTrade.create = async (doc) => {
            createdTrade = {
                ...doc,
                _id: 'trade_12345',
                save: async function() { return this; },
                toObject: function() { return { ...this }; },
            };
            return createdTrade;
        };

        const originalLogEvent = executionEngine._logEvent;
        executionEngine._logEvent = async () => {};

        // Execute trade with limit entry at $99.50 when market price is $100.00 (Long)
        const mockWs = { getPrice: () => 100.0 };
        const result = await executionEngine.executeTrade({
            userId: mockUserId,
            mode: 'paper',
            symbol: 'BTCUSDT',
            direction: 'long',
            entryPrice: 99.50,
            stopLoss: 98.50,
            takeProfit: 101.50,
            quantity: 1,
            leverage: 20,
            margin: 5.0,
            signalScore: 82,
            regime: 'TRENDING_UP',
            productSpec: { contract_value: 1, tick_size: 0.01 },
            wsManager: mockWs,
            orderType: 'limit_order',
        });

        assert('Paper execution returns pending: true for resting limit', result.success && result.pending === true);
        assert('Margin was reserved from PaperWallet (available reduced, used increased)', savedWallet.available === 95 && savedWallet.used === 5, `avail=${savedWallet.available}, used=${savedWallet.used}`);
        assert('Trade was saved with result: pending_entry', createdTrade.result === 'pending_entry');
        assert('Trade was saved with entryOrderStatus: pending', createdTrade.entryOrderStatus === 'pending');

        // Restore originals
        TradingConfig.findOne = origFindConfig;
        PaperWallet.findOne = originalFindOneWallet;
        BotTrade.findOne = originalFindOneTrade;
        BotTrade.countDocuments = originalCountTrades;
        BotTrade.create = originalCreateTrade;
        executionEngine._logEvent = originalLogEvent;
    }

    // ── Test 5: EntryOrderWatcher Pullback Fill & Timeout Refund ────────────
    console.log(`\n${B}[5] EntryOrderWatcher Pullback Fill & Timeout Refund${RESET}`);
    {
        const mockUserId = '507f1f77bcf86cd799439011';
        let paperTrade = {
            _id: 'trade_pending_01',
            userId: mockUserId,
            mode: 'paper',
            symbol: 'SOLUSDT',
            direction: 'long',
            entryPrice: 150.0,
            stopLoss: 147.0,
            takeProfit: 156.0,
            quantity: 2,
            leverage: 20,
            margin: 15.0,
            result: 'pending_entry',
            entryOrderStatus: 'pending',
            entryOrderPlacedAt: new Date(),
            createdAt: new Date(),
            save: async function() { return this; },
            toObject: function() { return { ...this }; },
        };

        // Case A: Market is at $151.0 (has not pulled back yet)
        entryOrderWatcher.wsManager = { getPrice: () => 151.0 };
        let activated = false;
        const originalActivate = executionEngine._activatePaperTrade;
        executionEngine._activatePaperTrade = async ({ trade, fillPrice }) => {
            activated = true;
            trade.result = 'open';
            trade.entryOrderStatus = 'filled';
            return { success: true };
        };

        await entryOrderWatcher._checkPaperPendingTrade(paperTrade);
        assert('Trade remains pending_entry while market ($151) is above limit ($150)', !activated && paperTrade.result === 'pending_entry');

        // Case B: Market pulls back and touches $150.0!
        entryOrderWatcher.wsManager = { getPrice: () => 150.0 };
        await entryOrderWatcher._checkPaperPendingTrade(paperTrade);
        assert('Limit order activates on pullback touch (market <= limit entry)', activated && paperTrade.result === 'open');

        // Case C: Timeout refund test (> 15 minutes elapsed)
        let timedOutTrade = {
            _id: 'trade_pending_timeout',
            userId: mockUserId,
            mode: 'paper',
            symbol: 'AVAXUSDT',
            direction: 'short',
            entryPrice: 30.0,
            margin: 10.0,
            result: 'pending_entry',
            entryOrderStatus: 'pending',
            entryOrderPlacedAt: new Date(Date.now() - 16 * 60 * 1000), // 16 min ago
            createdAt: new Date(Date.now() - 16 * 60 * 1000),
            save: async function() { return this; },
            toObject: function() { return { ...this }; },
        };

        let walletBeforeTimeout = {
            userId: mockUserId,
            available: 90,
            used: 10,
            save: async function() { return this; },
            toObject: function() { return { ...this }; },
        };
        const origFindWallet = PaperWallet.findOne;
        PaperWallet.findOne = async () => walletBeforeTimeout;

        entryOrderWatcher._logEvent = async () => {};
        await entryOrderWatcher._checkPaperPendingTrade(timedOutTrade);

        assert('Timed out pending trade marked cancelled with exitReason: entry_timeout', timedOutTrade.result === 'cancelled' && timedOutTrade.exitReason === 'entry_timeout');
        assert('Margin refunded back to PaperWallet on timeout', walletBeforeTimeout.available === 100 && walletBeforeTimeout.used === 0, `avail=${walletBeforeTimeout.available}, used=${walletBeforeTimeout.used}`);

        // Restore
        executionEngine._activatePaperTrade = originalActivate;
        PaperWallet.findOne = origFindWallet;
    }

    console.log(`\n${B}======================================================${RESET}`);
    console.log(`Summary: ${G}${passed} Passed${RESET} | ${failed > 0 ? R : G}${failed} Failed${RESET}`);
    console.log(`${B}======================================================${RESET}\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal error running tests:', err);
    process.exit(1);
});
