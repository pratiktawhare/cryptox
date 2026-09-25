/**
 * scan-frequency-test.js
 *
 * Market Scan Frequency & Opportunity Analysis:
 *   Part 1: Real-time Live Market Scan across 15 major perpetual symbols.
 *   Part 2: 24-Hour Rolling Historical Back-Scan (288 cycles of 5m bars)
 *           to calculate empirical trade frequency, setups per day, and
 *           distribution of scores.
 */

try { require('./server/node_modules/dotenv').config({ path: './server/.env' }); } catch (_) {}

const axios             = require('./server/node_modules/axios');
const candleStore       = require('./server/src/services/bot/CandleStore');
const { analyzeSymbol } = require('./server/src/services/bot/MarketAnalyzer');
const { detectRegime }  = require('./server/src/services/bot/RegimeDetector');
const { scoreSignal }   = require('./server/src/services/bot/SignalScorer');

// Test symbols (high liquidity perpetuals)
const SYMBOLS = [
    'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD',
    'SUIUSD', 'AVAXUSD', 'ADAUSD', 'NEARUSD', 'LINKUSD',
    'BNBUSD', 'LTCUSD', 'TIAUSD', 'INJUSD', 'ARBUSD',
];

const DELTA_URL = 'https://api.india.delta.exchange';

// Colors
const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m';
const C = '\x1b[36m'; const B = '\x1b[1m'; const DIM = '\x1b[2m'; const RESET = '\x1b[0m';

async function fetchHistorical(symbol, resolution, count) {
    const resMin = resolution === '1m' ? 1 : 5;
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - count * resMin * 60;
    try {
        const resp = await axios.get(`${DELTA_URL}/v2/history/candles`, {
            timeout: 10000,
            params: { symbol, resolution, start: startTs, end: endTs },
        });
        const raw = resp.data?.result || [];
        return raw
            .filter(c => c.time && c.open && c.close)
            .map(c => ({
                time: parseInt(c.time),
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close),
                volume: parseFloat(c.volume || 0),
            }))
            .sort((a, b) => a.time - b.time);
    } catch (e) {
        return [];
    }
}

async function main() {
    console.log(`\n${B}${C}========================================================================${RESET}`);
    console.log(`${B}${C}    CRYPTOX BOT — REAL MARKET SCAN FREQUENCY & OPPORTUNITY ANALYSIS     ${RESET}`);
    console.log(`${B}${C}========================================================================${RESET}\n`);

    console.log(`📡 Fetching live and historical market data for ${SYMBOLS.length} perpetual contracts from Delta Exchange India...\n`);

    const marketData = {};
    for (const sym of SYMBOLS) {
        process.stdout.write(`  Downloading ${sym.padEnd(8)} (5m + 1m candles)... `);
        // Fetch last 300 5m candles (~25 hours) and 100 1m candles
        const c5m = await fetchHistorical(sym, '5m', 300);
        const c1m = await fetchHistorical(sym, '1m', 100);
        marketData[sym] = { c5m, c1m };
        console.log(`${G}✓${RESET} (${c5m.length} 5m, ${c1m.length} 1m)`);
        // Small delay to be polite to Delta public API
        await new Promise(r => setTimeout(r, 120));
    }

    // ── PART 1: LIVE MARKET SCAN RIGHT NOW ──────────────────────────────────
    console.log(`\n${B}${C}────────────────────────────────────────────────────────────────────────${RESET}`);
    console.log(`${B} PART 1: CURRENT LIVE MARKET SCAN (Right Now: ${new Date().toLocaleTimeString()})${RESET}`);
    console.log(`${B}${C}────────────────────────────────────────────────────────────────────────${RESET}\n`);

    const liveCandidates = [];

    for (const sym of SYMBOLS) {
        const { c5m, c1m } = marketData[sym];
        if (c5m.length < 35 || c1m.length < 22) continue;

        candleStore.seedCandles(sym, '5m', c5m);
        candleStore.seedCandles(sym, '1m', c1m);

        const currentPrice = c1m[c1m.length - 1]?.close || c5m[c5m.length - 1]?.close;
        const mockWs = { getPrice: () => currentPrice, getTicker: () => ({ mark_price: currentPrice }) };

        const snapshot = analyzeSymbol(sym, mockWs);
        if (!snapshot) continue;

        const regimeResult = detectRegime(snapshot);
        const scoreMin5 = scoreSignal(snapshot, regimeResult, 5);
        const scoreMin6 = scoreSignal(snapshot, regimeResult, 6);

        liveCandidates.push({
            symbol: sym,
            price: currentPrice,
            regime: regimeResult.regime,
            confidence: regimeResult.confidence,
            score: scoreMin5.score,
            decision5: scoreMin5.decision,
            decision6: scoreMin6.decision,
            direction: scoreMin5.direction,
            rsi: snapshot['5m']?.rsi?.toFixed(1) ?? 'N/A',
            stretch: snapshot['5m']?.stretchRatio?.toFixed(2) ?? 'N/A',
            momentum: (snapshot['1m']?.momentum ?? 0).toFixed(2),
            lowerWick: (snapshot['1m']?.lowerWickRatio ?? 0).toFixed(2),
            upperWick: (snapshot['1m']?.upperWickRatio ?? 0).toFixed(2),
            reason: scoreMin5.reason || 'N/A',
        });
    }

    console.log(`Symbol    | Price ($)   | Regime          | Score | Decision (min=5) | Decision (min=6) | Dir   | RSI  | Stretch | 1m Mom | 1m Wick`);
    console.log(`----------+-------------+-----------------+-------+------------------+------------------+-------+------+---------+--------+--------`);

    for (const c of liveCandidates) {
        const decCol5 = c.decision5 === 'TRADE' ? `${G}TRADE   ${RESET}` : (c.decision5 === 'OVEREXTENDED' ? `${Y}OVEREXT ${RESET}` : `${DIM}NO_SETUP${RESET}`);
        const decCol6 = c.decision6 === 'TRADE' ? `${G}TRADE   ${RESET}` : `${DIM}NO_SETUP${RESET}`;
        const dirCol = c.direction === 'long' ? `${G}LONG ${RESET}` : (c.direction === 'short' ? `${R}SHORT${RESET}` : `---  `);
        const wickStr = `${c.lowerWick}L/${c.upperWick}U`;

        console.log(
            `${B}${c.symbol.padEnd(9)}${RESET} | ` +
            `${String(c.price).padEnd(11)} | ` +
            `${c.regime.padEnd(15)} | ` +
            `${String(c.score).padEnd(5)} | ` +
            `${decCol5}         | ` +
            `${decCol6}         | ` +
            `${dirCol} | ` +
            `${String(c.rsi).padEnd(4)} | ` +
            `${String(c.stretch + 'x').padEnd(7)} | ` +
            `${String(c.momentum + '%').padEnd(6)} | ` +
            `${wickStr}`
        );
    }

    const liveTrades5 = liveCandidates.filter(c => c.decision5 === 'TRADE');
    const liveTrades6 = liveCandidates.filter(c => c.decision6 === 'TRADE');
    console.log(`\n👉 Right now in the current market:`);
    console.log(`   - Qualifying TRADE opportunities with minScore=5: ${B}${liveTrades5.length > 0 ? G + liveTrades5.length : Y + '0'}${RESET} / ${liveCandidates.length} coins`);
    console.log(`   - Qualifying TRADE opportunities with minScore=6: ${B}${liveTrades6.length > 0 ? G + liveTrades6.length : Y + '0'}${RESET} / ${liveCandidates.length} coins`);

    // ── PART 2: 24-HOUR HISTORICAL SCAN ROLLING SIMULATION ──────────────────
    console.log(`\n${B}${C}────────────────────────────────────────────────────────────────────────${RESET}`);
    console.log(`${B} PART 2: 24-HOUR HISTORICAL ROLLING SCAN SIMULATION (288 Cycles of 5m bars)${RESET}`);
    console.log(`${B}${C}────────────────────────────────────────────────────────────────────────${RESET}\n`);
    console.log(`Simulating bot scan every 5 minutes across the past 24 hours (288 candles per coin)...\n`);

    const statsPerSymbol = {};
    let totalScanCycles = 0;
    let totalTradeSignalsMin5 = 0;
    let totalTradeSignalsMin6 = 0;

    for (const sym of SYMBOLS) {
        const { c5m } = marketData[sym];
        if (c5m.length < 50) continue;

        statsPerSymbol[sym] = {
            totalEvaluated: 0,
            scoreDistribution: { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0 },
            tradesMin5: 0,
            tradesMin6: 0,
            overextendedBlocked: 0,
            timestampsOfTrades: [],
        };

        // Window size: 40 candles minimum required
        for (let i = 40; i < c5m.length; i++) {
            const sub5m = c5m.slice(0, i + 1);
            // Construct pseudo 1m candles for that 5m bar to supply realistic 1m context
            const last5 = sub5m[sub5m.length - 1];
            const pseudo1m = [];
            for (let k = 0; k < 25; k++) {
                pseudo1m.push({
                    open: last5.open,
                    high: last5.high,
                    low: last5.low,
                    close: last5.close,
                    volume: last5.volume / 5,
                });
            }

            candleStore.seedCandles(sym, '5m', sub5m);
            candleStore.seedCandles(sym, '1m', pseudo1m);

            const mockWs = { getPrice: () => last5.close, getTicker: () => ({ mark_price: last5.close }) };
            const snapshot = analyzeSymbol(sym, mockWs);
            if (!snapshot) continue;

            const regimeResult = detectRegime(snapshot);
            const scoreMin5 = scoreSignal(snapshot, regimeResult, 5);
            const scoreMin6 = scoreSignal(snapshot, regimeResult, 6);

            statsPerSymbol[sym].totalEvaluated++;
            statsPerSymbol[sym].scoreDistribution[scoreMin5.score] = (statsPerSymbol[sym].scoreDistribution[scoreMin5.score] || 0) + 1;

            if (scoreMin5.decision === 'OVEREXTENDED') {
                statsPerSymbol[sym].overextendedBlocked++;
            }

            if (scoreMin5.decision === 'TRADE' && scoreMin5.score >= 5) {
                statsPerSymbol[sym].tradesMin5++;
                totalTradeSignalsMin5++;
                statsPerSymbol[sym].timestampsOfTrades.push(last5.time);
            }

            if (scoreMin6.decision === 'TRADE' && scoreMin6.score >= 6) {
                statsPerSymbol[sym].tradesMin6++;
                totalTradeSignalsMin6++;
            }
        }
        totalScanCycles = Math.max(totalScanCycles, statsPerSymbol[sym].totalEvaluated);
    }

    console.log(`Symbol    | 5m Bars | Score >= 5 Trades | Score >= 6 Trades | Overextended Blocked | Signals / Day`);
    console.log(`----------+---------+-------------------+-------------------+----------------------+--------------`);

    for (const sym of SYMBOLS) {
        const st = statsPerSymbol[sym];
        if (!st) continue;
        console.log(
            `${B}${sym.padEnd(9)}${RESET} | ` +
            `${String(st.totalEvaluated).padEnd(7)} | ` +
            `${String(st.tradesMin5).padEnd(17)} | ` +
            `${String(st.tradesMin6).padEnd(17)} | ` +
            `${String(st.overextendedBlocked).padEnd(20)} | ` +
            `${G}${(st.tradesMin5).toFixed(1)}/day${RESET}`
        );
    }

    console.log(`\n${B}${C}========================================================================${RESET}`);
    console.log(`${B} SUMMARY: EMPIRICAL TRADING FREQUENCY ACROSS PORTFOLIO${RESET}`);
    console.log(`${B}${C}========================================================================${RESET}\n`);

    const hoursSimulated = (totalScanCycles * 5) / 60;
    const signalsPerHourMin5 = totalTradeSignalsMin5 / (hoursSimulated || 1);
    const signalsPerDayMin5 = signalsPerHourMin5 * 24;
    const signalsPerWeekMin5 = signalsPerDayMin5 * 7;

    const signalsPerHourMin6 = totalTradeSignalsMin6 / (hoursSimulated || 1);
    const signalsPerDayMin6 = signalsPerHourMin6 * 24;
    const signalsPerWeekMin6 = signalsPerDayMin6 * 7;

    console.log(`📊 Period Analyzed: ~${hoursSimulated.toFixed(1)} hours (${totalScanCycles} scans every 5 minutes)`);
    console.log(`🎯 Portfolio: ${SYMBOLS.length} perpetual contracts`);
    console.log(`\nAt minSignalScore = 5 (Default):`);
    console.log(`   • Total Qualifying Trade Signals: ${B}${G}${totalTradeSignalsMin5}${RESET}`);
    console.log(`   • Average Frequency:              ${B}${G}~${signalsPerDayMin5.toFixed(1)} signals per day${RESET} (~${signalsPerHourMin5.toFixed(2)} / hour)`);
    console.log(`   • Weekly Estimated Trade Signals: ${B}${G}~${Math.round(signalsPerWeekMin5)} trade setups per week${RESET}`);
    console.log(`   • Average time between signals:   ${B}${G}~${(60 / (signalsPerHourMin5 || 1)).toFixed(0)} minutes${RESET}`);

    console.log(`\nAt minSignalScore = 6 (Conservative / High Quality):`);
    console.log(`   • Total Qualifying Trade Signals: ${B}${C}${totalTradeSignalsMin6}${RESET}`);
    console.log(`   • Average Frequency:              ${B}${C}~${signalsPerDayMin6.toFixed(1)} signals per day${RESET}`);
    console.log(`   • Weekly Estimated Trade Signals: ${B}${C}~${Math.round(signalsPerWeekMin6)} trade setups per week${RESET}`);

    console.log(`\n💡 ${B}Verdict on "Once a month?":${RESET}`);
    if (signalsPerDayMin5 >= 1) {
        console.log(`   ${G}NO! The bot definitely does NOT trade once a month.${RESET}`);
        console.log(`   Scanning across 15+ coins every 5 minutes generates roughly ${B}${Math.round(signalsPerDayMin5)} trade opportunities per day${RESET}.`);
        console.log(`   Even with maxOpenPositions limits (e.g., 3-5 concurrent trades), the bot stays active throughout every trading day.`);
    } else {
        console.log(`   ${Y}Signals are sparse. Consider lowering minScore to 5 or expanding candidate coins.${RESET}`);
    }
    console.log(`\n${B}${C}========================================================================${RESET}\n`);
}

main().catch(err => {
    console.error('Fatal error in scan frequency test:', err);
});
