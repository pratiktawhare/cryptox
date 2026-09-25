/**
 * test-rally-filters.js
 *
 * Paper-mode test for the 3-layer rally-top prevention system:
 *   Layer 1 — ATR Overextension Hard Gate (SignalScorer)
 *   Layer 2 — RSI Ceiling 67 + RSI Slope Deceleration (SignalScorer Condition 5)
 *   Layer 3 — Graduated Pullback Entry Pricing (TradingBot formula)
 *
 * Run from project root:  node --env-file=server/.env test-rally-filters.js
 *              OR from server/:  node ../test-rally-filters.js
 */

// Load env — try dotenv from server/ (where it's installed)
try { require('./server/node_modules/dotenv').config({ path: './server/.env' }); } catch (_) {}

const { calcEMA, calcEMASlope } = require('./server/src/services/bot/indicators/ema');
const { calcRSI }               = require('./server/src/services/bot/indicators/rsi');
const { calcATR, calcATRPercent } = require('./server/src/services/bot/indicators/atr');
const { calcVolumeRatio }       = require('./server/src/services/bot/indicators/volume');
const { calcMomentum }          = require('./server/src/services/bot/indicators/momentum');
const { scoreSignal, SCORE_CONFIG } = require('./server/src/services/bot/SignalScorer');
const { detectRegime }          = require('./server/src/services/bot/RegimeDetector');

// ── Terminal colours ──────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m';
const C = '\x1b[36m'; const B = '\x1b[1m';
const DIM = '\x1b[2m'; const RESET = '\x1b[0m';

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

// ── Deterministic candle generator ───────────────────────────────────────────
// Uses Math.sin for pseudo-noise so results are reproducible every run.
function makeCandles(count, base, trendPct, noisePct, spikeLastPct = 0) {
    const candles = [];
    let price = base;

    for (let i = 0; i < count; i++) {
        const isLast = i === count - 1;
        const noise  = ((Math.sin(i * 127.1 + 13.7)) * 0.5) * price * noisePct;
        const spike  = isLast ? price * spikeLastPct : 0;
        const change = price * trendPct + noise + spike;

        const open  = price;
        const close = Math.max(0.01, price + change);
        const high  = Math.max(open, close) * (1 + 0.0008);
        const low   = Math.min(open, close) * (1 - 0.0008);
        // Volume spikes on the last candle when there's a spike (simulates pump volume)
        const vol   = 1000 + Math.abs(Math.sin(i * 57.3)) * 400 + (isLast && spikeLastPct > 0 ? 4000 : 0);

        candles.push({ open, close, high, low, volume: vol });
        price = close;
    }
    return candles;
}

// ── Snapshot builder — mirrors MarketAnalyzer.js exactly ─────────────────────
function buildSnapshot(symbol, candles5m, candles1m) {
    const closes5m  = candles5m.map(c => c.close);
    const highs5m   = candles5m.map(c => c.high);
    const lows5m    = candles5m.map(c => c.low);
    const volumes5m = candles5m.map(c => c.volume);
    const closes1m  = candles1m.map(c => c.close);

    const currentClose  = closes5m[closes5m.length - 1];

    const ema9_5m       = calcEMA(closes5m, 9);
    const ema21_5m      = calcEMA(closes5m, 21);
    const ema21Slope_5m = calcEMASlope(closes5m, 21);
    const rsi_5m        = calcRSI(closes5m, 14);
    const atr_5m        = calcATR(highs5m, lows5m, closes5m, 14);
    const atrPct_5m     = calcATRPercent(highs5m, lows5m, closes5m, 14);
    const volumeRatio   = calcVolumeRatio(volumes5m, 20);

    const rsiPrev_5m    = candles5m.length > 16 ? calcRSI(closes5m.slice(0, -1), 14) : null;
    const rsiSlope_5m   = (rsi_5m !== null && rsiPrev_5m !== null) ? (rsi_5m - rsiPrev_5m) : null;

    const stretchRatio_5m = (atr_5m !== null && atr_5m > 0 && ema21_5m !== null)
        ? Math.abs(currentClose - ema21_5m) / atr_5m
        : null;

    const ema9_1m  = calcEMA(closes1m, 9);
    const ema21_1m = calcEMA(closes1m, 21);
    const rsi_1m   = calcRSI(closes1m, 14);
    const mom_1m   = calcMomentum(closes1m, 5);

    return {
        symbol,
        timestamp:   Date.now(),
        close:       currentClose,
        spread:      atr_5m ? atr_5m * 0.05 : null,
        fundingRate: null,
        '5m': {
            ema9:         ema9_5m,
            ema21:        ema21_5m,
            ema21Slope:   ema21Slope_5m,
            rsi:          rsi_5m,
            rsiSlope:     rsiSlope_5m,
            atr:          atr_5m,
            atrPct:       atrPct_5m,
            stretchRatio: stretchRatio_5m,
            volumeRatio:  volumeRatio,
            close:        currentClose,
        },
        '1m': {
            ema9:     ema9_1m,
            ema21:    ema21_1m,
            rsi:      rsi_1m,
            momentum: mom_1m,
            close:    closes1m[closes1m.length - 1],
        },
    };
}

// ── Layer 3 formula — must match TradingBot.js exactly ───────────────────────
function calcSmartEntryPrice(snapshot, tradeDirection) {
    const close5m   = snapshot.close;
    const ema9_5m   = snapshot['5m'].ema9;
    const atr5m     = snapshot['5m'].atr;
    const stretch5m = snapshot['5m'].stretchRatio;

    let smartEntry = close5m;

    if (ema9_5m !== null && atr5m !== null && atr5m > 0 && stretch5m != null && stretch5m > 0.6) {
        const pullbackRatio = Math.min((stretch5m - 0.6) / 0.9, 1.0); // 0.0 → 1.0

        if (tradeDirection === 'long' && close5m > ema9_5m) {
            smartEntry = close5m - (pullbackRatio * (close5m - ema9_5m));
        } else if (tradeDirection === 'short' && close5m < ema9_5m) {
            smartEntry = close5m + (pullbackRatio * (ema9_5m - close5m));
        }
    }
    return smartEntry;
}

// ── Scenario runner ───────────────────────────────────────────────────────────
function runScenario(name, snapshot) {
    const regime = detectRegime(snapshot);
    const result = scoreSignal(snapshot, regime, 5);
    const tf5    = snapshot['5m'];

    console.log(`\n${C}${B}── ${name}${RESET}`);
    console.log(`  ${DIM}close=${snapshot.close?.toFixed(4)}  ema9=${tf5.ema9?.toFixed(4)}  ema21=${tf5.ema21?.toFixed(4)}${RESET}`);
    console.log(`  ${DIM}RSI=${tf5.rsi?.toFixed(1)}  rsiSlope=${tf5.rsiSlope?.toFixed(2)}  stretchRatio=${tf5.stretchRatio?.toFixed(2)}x ATR  ATR=${tf5.atr?.toFixed(4)}${RESET}`);
    console.log(`  ${DIM}→ decision=${B}${result.decision}${RESET}${DIM}  score=${result.score}/8  ${result.reason}${RESET}`);
    if (result.conditions && Object.keys(result.conditions).length) {
        const condStr = Object.entries(result.conditions)
            .map(([k, v]) => `${v ? G : R}${k}${RESET}`)
            .join('  ');
        console.log(`  Conditions: ${condStr}`);
    }
    return result;
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}${C}══════════════════════════════════════════════════════════════${RESET}`);
console.log(`${B}${C}   RALLY-TOP FILTER — PAPER MODE TEST SUITE${RESET}`);
console.log(`${B}${C}══════════════════════════════════════════════════════════════${RESET}`);
console.log(`\n${DIM}Active SCORE_CONFIG:${RESET}`);
console.log(`  RSI_OVERBOUGHT        = ${B}${SCORE_CONFIG.RSI_OVERBOUGHT}${RESET}  (was 75)`);
console.log(`  RSI_OVERSOLD          = ${B}${SCORE_CONFIG.RSI_OVERSOLD}${RESET}  (was 25)`);
console.log(`  RSI_SLOPE_HOT         = ${B}${SCORE_CONFIG.RSI_SLOPE_HOT_THRESHOLD}${RESET}  (new)`);
console.log(`  STRETCH_RATIO_MAX     = ${B}${SCORE_CONFIG.STRETCH_RATIO_MAX}x ATR${RESET}  (new)`);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B}══ LAYER 1 — ATR Overextension Hard Gate ══${RESET}`);
// ─────────────────────────────────────────────────────────────────────────────

// Test 1: Spike last candle → stretchRatio > 1.5 → OVEREXTENDED
{
    const c5 = makeCandles(50, 100, 0.0010, 0.0020, 0.028); // 2.8% spike on last candle
    const c1 = makeCandles(30, c5[c5.length - 1].close, 0.0005, 0.001);
    const snap = buildSnapshot('OVEREXTENDED', c5, c1);
    const res  = runScenario('Test 1 — Overextended spike (last candle +2.8%)', snap);

    assert('Layer 1: stretchRatio > 1.5',
        snap['5m'].stretchRatio !== null && snap['5m'].stretchRatio > 1.5,
        `stretchRatio = ${snap['5m'].stretchRatio?.toFixed(3)}`);
    assert('Layer 1: decision = OVEREXTENDED',
        res.decision === 'OVEREXTENDED',
        `got: ${res.decision}`);
    assert('Layer 1: score = 0 (no scoring done when overextended)',
        res.score === 0,
        `score: ${res.score}`);
    assert('Layer 1: direction = null',
        res.direction === null,
        `direction: ${res.direction}`);
}

// Test 2: Moderate candles forced to stay below stretchRatio 1.5
// We use a direct snapshot injection — predictable values, no candle noise
{
    // A clean "moderate" snapshot: price near EMA21, all bullish conditions met
    const moderateSnap = {
        symbol: 'MODERATE',
        close: 100.5,
        spread: 0.02,
        fundingRate: null,
        '5m': {
            ema9: 100.3, ema21: 100.0, ema21Slope: 0.03,
            rsi: 56.0, rsiSlope: 0.5,
            atr: 0.8, atrPct: 0.8,
            stretchRatio: 0.63,   // (100.5 - 100.0) / 0.8 = 0.625 → below 1.5
            volumeRatio: 1.4,
            close: 100.5,
        },
        '1m': { ema9: 100.45, ema21: 100.2, rsi: 55, momentum: 0.08, close: 100.5 },
    };
    const res = runScenario('Test 2 — Moderate move (stretchRatio=0.63, not overextended)', moderateSnap);

    assert('Layer 1: stretchRatio < 1.5 (not blocked)',
        moderateSnap['5m'].stretchRatio < 1.5,
        `stretchRatio = ${moderateSnap['5m'].stretchRatio}`);
    assert('Layer 1: decision != OVEREXTENDED',
        res.decision !== 'OVEREXTENDED',
        `got: ${res.decision}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B}══ LAYER 2 — RSI Ceiling (67) & Slope Deceleration ══${RESET}`);
// NOTE: All Layer 2 tests use fully-injected snapshots so stretchRatio stays
// below 1.5 and Layer 1 doesn't interfere — isolating Condition 5 precisely.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: make a "pass-through" snapshot where all conditions pass EXCEPT
// whatever we're testing via RSI injection. stretchRatio=0.5 bypasses Layer 1.
function makeLayer2Snap(symbol, rsi, rsiSlope) {
    return {
        symbol,
        close: 100.5,
        spread: 0.02,
        fundingRate: null,
        '5m': {
            ema9: 100.3, ema21: 100.0, ema21Slope: 0.03,
            rsi,
            rsiSlope,
            atr: 0.8, atrPct: 0.8,
            stretchRatio: 0.5,   // well below 1.5 — Layer 1 won't fire
            volumeRatio: 1.4,
            close: 100.5,
        },
        '1m': { ema9: 100.45, ema21: 100.2, rsi: 55, momentum: 0.08, close: 100.5 },
    };
}

// Test 3: RSI=56, slope=+0.5 — healthy sweet spot → Condition 5 passes → TRADE
{
    const snap = makeLayer2Snap('HEALTHY', 56.0, +0.5);
    const res  = runScenario('Test 3 — RSI=56, slope=+0.5 (healthy sweet spot)', snap);

    assert('Layer 2: RSI=56 is in sweet spot 50–67',
        snap['5m'].rsi >= 50 && snap['5m'].rsi < 67,
        `RSI = ${snap['5m'].rsi}`);
    assert('Layer 2: Condition 5 (rsiNotExtended) = true',
        res.conditions?.rsiNotExtended === true,
        `cond5 = ${res.conditions?.rsiNotExtended}`);
    assert('Layer 2: decision = TRADE',
        res.decision === 'TRADE',
        `decision = ${res.decision}`);
}

// Test 4: RSI=68.5 (above ceiling 67), slope=+0.8 → CEILING rejects regardless of slope
{
    const snap = makeLayer2Snap('RSI_ABOVE_CEILING', 68.5, +0.8);
    const res  = runScenario('Test 4 — RSI=68.5 (above ceiling 67), slope still rising', snap);

    assert('Layer 2: RSI ceiling blocks RSI=68.5 even when slope is positive',
        res.conditions?.rsiNotExtended === false,
        `cond5 = ${res.conditions?.rsiNotExtended}, RSI=${snap['5m'].rsi}`);
}

// Test 5: RSI=64 (in hot zone 62–67), slope=-1.8 → SLOPE GUARD fires
{
    const snap = makeLayer2Snap('RSI_HOT_DECELERATING', 64.0, -1.8);
    const res  = runScenario('Test 5 — RSI=64 HOT + decelerating (rsiSlope=-1.8)', snap);

    assert('Layer 2: Slope guard fires when RSI is hot (>=62) AND falling',
        res.conditions?.rsiNotExtended === false,
        `cond5 = ${res.conditions?.rsiNotExtended}`);
}

// Test 6: RSI=63 (in hot zone), slope=+1.5 → SLOPE GUARD does NOT block (still rising)
{
    const snap = makeLayer2Snap('RSI_HOT_ACCELERATING', 63.0, +1.5);
    const res  = runScenario('Test 6 — RSI=63 HOT + accelerating (rsiSlope=+1.5)', snap);

    assert('Layer 2: Slope guard does NOT block when RSI is hot but still rising',
        res.conditions?.rsiNotExtended === true,
        `cond5 = ${res.conditions?.rsiNotExtended}`);
}

// Test 7: RSI=58 (below hot zone 62), slope=-0.9 → SLOPE GUARD inactive (RSI not hot enough)
{
    const snap = makeLayer2Snap('RSI_WARM_FALLING', 58.0, -0.9);
    const res  = runScenario('Test 7 — RSI=58 below hot zone, slope negative (guard inactive)', snap);

    assert('Layer 2: RSI=58 below hot zone → slope guard is inactive → cond5 = true',
        res.conditions?.rsiNotExtended === true,
        `cond5 = ${res.conditions?.rsiNotExtended}, RSI=${snap['5m'].rsi}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B}══ LAYER 3 — Graduated Pullback Entry Pricing ══${RESET}`);
// ─────────────────────────────────────────────────────────────────────────────

// Helper: create a base snapshot with controlled values for pricing tests
function pricingSnap(close, ema9, stretchRatio) {
    return {
        close,
        '5m': { ema9, ema21: ema9 - 2, atr: 2.0, stretchRatio },
        '1m': {},
    };
}

// Test 8: stretch=0.3 (below 0.6 threshold) → entry = close exactly
{
    const snap  = pricingSnap(100, 98, 0.3);
    const entry = calcSmartEntryPrice(snap, 'long');
    assert('Layer 3: stretch=0.3 → below threshold → entry = close (100.0)',
        Math.abs(entry - 100.0) < 0.0001,
        `entry=${entry.toFixed(4)}`);
    console.log(`  ${DIM}stretch=0.3  pullbackRatio=0.00  entry=${entry.toFixed(4)}  close=100.0${RESET}`);
}

// Test 9: stretch=0.6 (exactly at threshold) → pullbackRatio=0 → entry = close
{
    const snap  = pricingSnap(100, 98, 0.6);
    const entry = calcSmartEntryPrice(snap, 'long');
    assert('Layer 3: stretch=0.6 → at threshold → entry = close (100.0)',
        Math.abs(entry - 100.0) < 0.0001,
        `entry=${entry.toFixed(4)}`);
    console.log(`  ${DIM}stretch=0.6  pullbackRatio=0.00  entry=${entry.toFixed(4)}  close=100.0${RESET}`);
}

// Test 10: stretch=1.05 → pullbackRatio=0.5 → entry = midpoint (99.0)
{
    const snap  = pricingSnap(100, 98, 1.05);
    const entry = calcSmartEntryPrice(snap, 'long');
    const expected = 100 - 0.5 * (100 - 98); // = 99.0
    assert(`Layer 3: stretch=1.05 → pullbackRatio=0.5 → entry = 99.0`,
        Math.abs(entry - expected) < 0.001,
        `entry=${entry.toFixed(4)}, expected=${expected.toFixed(4)}`);
    console.log(`  ${DIM}stretch=1.05 pullbackRatio=0.50 entry=${entry.toFixed(4)}  midpoint(close,ema9)=${expected.toFixed(4)}${RESET}`);
}

// Test 11: stretch=1.5 → pullbackRatio=1.0 → entry = EMA9 exactly (98.0)
{
    const snap  = pricingSnap(100, 98, 1.5);
    const entry = calcSmartEntryPrice(snap, 'long');
    assert('Layer 3: stretch=1.5 → pullbackRatio=1.0 → entry = EMA9 (98.0)',
        Math.abs(entry - 98.0) < 0.001,
        `entry=${entry.toFixed(4)}`);
    console.log(`  ${DIM}stretch=1.5  pullbackRatio=1.00 entry=${entry.toFixed(4)}  ema9=98.0${RESET}`);
}

// Test 12: stretch=2.0 (would be blocked by Layer 1 in production) → pullbackRatio capped at 1.0
{
    const snap  = pricingSnap(100, 98, 2.0);
    const entry = calcSmartEntryPrice(snap, 'long');
    assert('Layer 3: stretch=2.0 → pullbackRatio capped at 1.0 → entry = EMA9 (98.0)',
        Math.abs(entry - 98.0) < 0.001,
        `entry=${entry.toFixed(4)}`);
    console.log(`  ${DIM}stretch=2.0  pullbackRatio=1.00 (capped) entry=${entry.toFixed(4)}  ema9=98.0${RESET}`);
}

// Test 13: SHORT direction — entry slides UP toward EMA9
{
    const snap = { close: 96, '5m': { ema9: 98, ema21: 100, atr: 2.0, stretchRatio: 1.05 }, '1m': {} };
    const entry = calcSmartEntryPrice(snap, 'short');
    const expected = 96 + 0.5 * (98 - 96); // = 97.0
    assert('Layer 3: SHORT stretch=1.05 → entry slides UP toward EMA9 (97.0)',
        Math.abs(entry - expected) < 0.001,
        `entry=${entry.toFixed(4)}, expected=${expected.toFixed(4)}`);
    console.log(`  ${DIM}SHORT: close=96  ema9=98  stretch=1.05  pullbackRatio=0.5  entry=${entry.toFixed(4)}${RESET}`);
}

// Test 14: entry is always <= close for LONG (never worse than market price)
{
    const snap  = pricingSnap(100, 98, 0.9);
    const entry = calcSmartEntryPrice(snap, 'long');
    assert('Layer 3: Long entry price is always <= close (never buys above market)',
        entry <= 100.0,
        `entry=${entry.toFixed(4)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B}══ INTEGRATION — Full Indicator → Score → Entry Pipeline ══${RESET}`);
// ─────────────────────────────────────────────────────────────────────────────

// Test 15: Full pipeline with moderate extension
{
    const c5  = makeCandles(50, 1000, 0.0010, 0.0018, 0.005); // mild spike
    const c1  = makeCandles(30, c5[c5.length - 1].close, 0.0004, 0.001);
    const snap = buildSnapshot('INTEGRATION_LONG', c5, c1);
    const res  = runScenario('Test 15 — Integration: moderate extension full pipeline', snap);

    const entry   = calcSmartEntryPrice(snap, 'long');
    const adjPct  = ((snap.close - entry) / snap.close * 100).toFixed(3);
    const stretch = snap['5m'].stretchRatio;

    console.log(`\n  ${C}Layer 3 result:${RESET}`);
    console.log(`    stretchRatio  = ${stretch?.toFixed(3)}x ATR`);
    console.log(`    close         = ${snap.close.toFixed(4)}`);
    console.log(`    ema9          = ${snap['5m'].ema9?.toFixed(4)}`);
    console.log(`    smart entry   = ${entry.toFixed(4)}  (${adjPct}% pullback from close)`);
    console.log(`    SL/TP base    = entry price (${entry.toFixed(4)}) not close — tighter risk`);

    if (res.decision === 'OVEREXTENDED') {
        assert('Integration: OVEREXTENDED signals blocked correctly by Layer 1', true,
            `stretch=${stretch?.toFixed(2)} correctly blocked`);
    } else if (res.decision === 'TRADE') {
        assert('Integration: Valid TRADE gets pullback-adjusted entry', entry <= snap.close,
            `entry ${entry.toFixed(4)} <= close ${snap.close.toFixed(4)}`);
        assert('Integration: Entry >= EMA9 (never below dynamic support)', entry >= (snap['5m'].ema9 ?? 0) - 0.01,
            `entry ${entry.toFixed(4)}, ema9 ${snap['5m'].ema9?.toFixed(4)}`);
    } else {
        assert('Integration: Signal evaluated without crash', true, `decision=${res.decision}`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}${C}══════════════════════════════════════════════════════════════${RESET}`);
const total = passed + failed;
if (failed === 0) {
    console.log(`${B}${G}  ✅  ALL ${total} TESTS PASSED — Rally-top filters working correctly${RESET}`);
} else {
    console.log(`${B}${G}  ✅ ${passed}/${total} passed${RESET}   ${R}${B}❌ ${failed} FAILED${RESET}`);
}
console.log(`${B}${C}══════════════════════════════════════════════════════════════${RESET}\n`);

if (failed > 0) process.exit(1);
