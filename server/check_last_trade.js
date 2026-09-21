/**
 * check_last_trade.js
 * Run from: d:\Projects\cryptox\server
 * Usage: node check_last_trade.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cryptox';
    await mongoose.connect(uri);
    console.log('Connected to MongoDB:', uri, '\n');

    const BotTrade = require('./src/models/BotTrade');

    const trades = await BotTrade.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

    if (!trades.length) {
        console.log('No trades found in database.');
        process.exit(0);
    }

    for (const t of trades) {
        const contractValue = t.contractValue || 1;
        const notional      = t.entryPrice * t.quantity * contractValue;
        const exitNotional  = (t.exitPrice || t.entryPrice) * t.quantity * contractValue;

        const expectedEntryFee          = notional * (0.0002 * 1.18);
        const expectedExitFee_correct   = notional * (0.0005 * 1.18);          // on entry notional (correct)
        const expectedExitFee_buggy     = exitNotional * (0.0005 * 1.18);      // on exit notional (old bug)
        const expectedTotalFees_correct = expectedEntryFee + expectedExitFee_correct;
        const expectedTotalFees_buggy   = expectedEntryFee + expectedExitFee_buggy + (t.slippage || 0);

        const isLong        = t.direction === 'long';
        const grossAtTP     = t.takeProfit
            ? (isLong ? (t.takeProfit - t.entryPrice) : (t.entryPrice - t.takeProfit)) * t.quantity * contractValue
            : null;
        const grossAtActual = t.exitPrice
            ? (isLong ? (t.exitPrice - t.entryPrice) : (t.entryPrice - t.exitPrice)) * t.quantity * contractValue
            : null;

        // What the TP should yield net
        const netAtTP_correct = grossAtTP !== null ? grossAtTP - expectedTotalFees_correct : null;
        const netAtTP_buggy   = grossAtTP !== null ? grossAtTP - expectedTotalFees_buggy   : null;

        console.log('═'.repeat(72));
        console.log(`  ${t.symbol}  ${t.direction?.toUpperCase()}  [${t.mode}]  →  ${t.result?.toUpperCase()} via ${t.exitReason || 'n/a'}`);
        console.log('═'.repeat(72));
        console.log(`  Entry:     $${t.entryPrice}`);
        console.log(`  TP:        $${t.takeProfit}   (dist: ${t.takeProfit != null ? Math.abs(t.takeProfit - t.entryPrice).toFixed(6) : 'n/a'})`);
        console.log(`  SL:        $${t.stopLoss}    (dist: ${t.stopLoss != null ? Math.abs(t.stopLoss - t.entryPrice).toFixed(6) : 'n/a'})`);
        console.log(`  Exit:      $${t.exitPrice || '(open)'}   (dist: ${t.exitPrice != null ? Math.abs(t.exitPrice - t.entryPrice).toFixed(6) : 'n/a'})`);
        console.log(`  Qty:       ${t.quantity} contracts  ×  CV=${contractValue}  ×  ${t.leverage}x  →  Margin=$${(t.margin||0).toFixed(4)}`);
        console.log(`  Notional:  $${notional.toFixed(6)}  (entry)   $${exitNotional.toFixed(6)}  (exit)`);
        console.log('─'.repeat(72));
        console.log(`  Gross PnL (stored):        $${(t.grossPnl||0).toFixed(6)}`);
        console.log(`  Gross PnL (recalculated):  $${(grossAtActual||0).toFixed(6)}`);
        console.log(`  Gross @ exact TP:          $${(grossAtTP||0).toFixed(6)}`);
        console.log('─'.repeat(72));
        console.log(`  Fees stored in DB:         $${(t.fees||0).toFixed(6)}`);
        console.log(`  Slippage stored in DB:     $${(t.slippage||0).toFixed(6)}`);
        console.log(`  Net PnL stored in DB:      $${(t.netPnl||0).toFixed(6)}`);
        console.log('─'.repeat(72));
        console.log(`  ── Fee breakdown ──`);
        console.log(`  Entry fee (maker+GST 0.0236%): $${expectedEntryFee.toFixed(6)}`);
        console.log(`  Exit fee on ENTRY notional:    $${expectedExitFee_correct.toFixed(6)}  ← CORRECT`);
        console.log(`  Exit fee on EXIT notional:     $${expectedExitFee_buggy.toFixed(6)}   ← was wrong (old)`);
        console.log(`  Total (CORRECT):               $${expectedTotalFees_correct.toFixed(6)}`);
        console.log(`  Total (OLD BUG w/ dbl-slip):   $${expectedTotalFees_buggy.toFixed(6)}`);
        console.log(`  Overcharge by old bug:         $${(expectedTotalFees_buggy - expectedTotalFees_correct).toFixed(6)}`);
        console.log('─'.repeat(72));
        console.log(`  Net @ TP (CORRECT method):     $${(netAtTP_correct||0).toFixed(6)}`);
        console.log(`  Net @ TP (OLD BUG method):     $${(netAtTP_buggy||0).toFixed(6)}`);
        console.log(`  Net PnL as stored:             $${(t.netPnl||0).toFixed(6)}`);
        // ── Diagnose: re-derive what RiskEngine should have computed ──────────────
        // Config-assumed values (defaults if not stored)
        const assumedTargetRoiPct  = 5; // %
        const assumedLeverage      = t.leverage || 20;
        const roiPriceDist         = t.entryPrice * (assumedTargetRoiPct / (100 * assumedLeverage));
        // breakEvenAbs from CostEngine formula: totalCost / notional * entryPrice
        const roundTrip            = notional * 0.000826; // 0.0826% round-trip with GST
        const slipEst              = 0.005 * 0.5 * t.quantity * contractValue; // spread estimate
        const totalCostEst         = roundTrip + slipEst;
        const breakEvenAbsEst      = (totalCostEst / notional) * t.entryPrice;
        const requiredTpDist       = Math.max(
            roiPriceDist + breakEvenAbsEst,
            breakEvenAbsEst * 1.5,
            t.entryPrice * 0.002
        );
        const expectedTP = isLong
            ? t.entryPrice + requiredTpDist
            : t.entryPrice - requiredTpDist;
        const actualTpDist = t.takeProfit != null ? Math.abs(t.takeProfit - t.entryPrice) : null;

        console.log(`  ── RiskEngine TP diagnosis ──`);
        console.log(`  roiPriceDist (${assumedTargetRoiPct}% ROI on ${assumedLeverage}x):  $${roiPriceDist.toFixed(6)}`);
        console.log(`  roundTrip fees (0.0826%):         $${roundTrip.toFixed(6)}`);
        console.log(`  slippage estimate:                $${slipEst.toFixed(6)}`);
        console.log(`  breakEvenAbs estimate:            $${breakEvenAbsEst.toFixed(6)}`);
        console.log(`  requiredTpDist (computed):        $${requiredTpDist.toFixed(6)}`);
        console.log(`  Expected TP (computed):           $${expectedTP.toFixed(6)}`);
        console.log(`  Actual TP in DB:                  $${t.takeProfit}`);
        console.log(`  Actual TP dist:                   $${actualTpDist != null ? actualTpDist.toFixed(6) : 'n/a'}`);
        console.log(`  TP DISCREPANCY (should-actual):   $${actualTpDist != null ? (requiredTpDist - actualTpDist).toFixed(6) : 'n/a'} ${actualTpDist != null && requiredTpDist > actualTpDist + 0.001 ? '⚠️ TP TOO CLOSE!' : '✅ OK'}`);
        console.log(`  Gross needed to break even:       $${totalCostEst.toFixed(6)}`);
        console.log(`  Gross @ stored TP:                $${(grossAtTP||0).toFixed(6)}`);
        console.log(`  Feasible? (gross > totalCost):    ${(grossAtTP||0) > totalCostEst ? '✅ YES' : '🚨 NO — would always lose!'}`);
        console.log(`  Score: ${t.signalScore || 'n/a'}  |  Regime: ${t.regime || 'n/a'}  |  Duration: ${t.durationSeconds || 'n/a'}s`);
        console.log(`  Opened: ${t.entryTime || t.createdAt}   Closed: ${t.exitTime || 'still open'}`);
        console.log('');

    }

    await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
