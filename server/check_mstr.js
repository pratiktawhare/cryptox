require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cryptox');
    console.log('Connected\n');

    // Load ProductCatalog - it fetches from Delta on init, use cached file or check DB
    // Instead, let's just look at what the RiskEngine would compute step-by-step
    // for MSTRBUSD with the actual config values

    const entry     = 169.73;
    const direction = 'short';
    const isLong    = false;
    const qty       = 2;
    const cv        = 0.1;
    const leverage  = 20;
    const targetRoiPct = 5;
    const tpSafetyMultiplier = 2;
    const riskPerTradePct = 15;
    const budgetUSDT = 10;
    const slAtrMultiplier = 5;

    // Tick sizes to test
    const tickSizes = [0.01, 0.05, 0.1, 0.5, 1.0];

    const notional = entry * qty * cv; // = 169.73 × 2 × 0.1 = 33.946

    // Assume ATR from 5m candles for MSTR - typical is 0.5-2.0
    // Let's reverse-engineer: what ATR gives slDistance that results in qty=2?
    // rawQty = riskAmt / (cv × slDistance)
    // riskAmt = budgetUSDT × riskPerTradePct/100 = 10 × 0.15 = 1.5
    const riskAmt = budgetUSDT * (riskPerTradePct / 100);
    // maxSafeSlDistance = entry × (1/leverage) × 0.85 = 169.73 × 0.05 × 0.85 = 7.213
    const maxSafeSlDistance = entry * (1 / leverage) * 0.85;
    // For qty=2: rawQty would be 2, so slDistance = riskAmt / (cv × rawQty) = 1.5 / (0.1 × 2) = 7.5 > maxSafe
    // => qty was clamped from floor(rawQty) to 2 via maxQtyFromMargin
    // maxQtyFromMargin = floor((budget × leverage) / (cv × entry)) = floor((10×20)/(0.1×169.73)) = floor(11.78) = 11
    const maxQtyFromMargin = Math.floor((budgetUSDT * leverage) / (cv * entry));
    // rawQty = riskAmt / (cv × maxSafeSlDistance) = 1.5 / (0.1 × 7.213) = 20.8
    const rawQty = riskAmt / (cv * maxSafeSlDistance);

    console.log('=== MSTRBUSD SHORT — Step by Step ===\n');
    console.log(`Entry: $${entry}  |  Direction: ${direction}  |  qty=${qty}  |  CV=${cv}  |  ${leverage}x`);
    console.log(`riskAmt = budgetUSDT(${budgetUSDT}) × ${riskPerTradePct}% = $${riskAmt}`);
    console.log(`maxSafeSlDistance = ${entry} × (1/${leverage}) × 0.85 = $${maxSafeSlDistance.toFixed(6)}`);
    console.log(`rawQty = riskAmt / (CV × maxSafeSlDist) = ${riskAmt} / (${cv} × ${maxSafeSlDistance.toFixed(4)}) = ${rawQty.toFixed(2)}`);
    console.log(`maxQtyFromMargin = floor(budget×leverage / (CV×entry)) = floor(${budgetUSDT*leverage} / ${(cv*entry).toFixed(2)}) = ${maxQtyFromMargin}`);
    console.log(`qty used = min(floor(${rawQty.toFixed(2)}), ${maxQtyFromMargin}) = ${Math.min(Math.floor(rawQty), maxQtyFromMargin)}`);
    console.log(`Actual qty in DB = 2 (was minQty=1 clamped or floor of rawQty)`);

    const slDist = maxSafeSlDistance;
    const sl = entry + slDist; // short
    const margin = (qty * cv * entry) / leverage;

    console.log(`\nSL = $${sl.toFixed(6)}`);
    console.log(`Margin = (${qty} × ${cv} × ${entry}) / ${leverage} = $${margin.toFixed(4)}`);
    console.log(`Notional = ${qty} × ${cv} × ${entry} = $${notional.toFixed(4)}`);

    // CostEngine breakEvenAbs
    const makerGST = 0.0002 * 1.18;
    const takerGST = 0.0005 * 1.18;
    const entryFee = notional * makerGST;
    const exitFee  = notional * takerGST;
    // Spread/slippage: DEFAULT_SPREAD_PCT = 0.0005, slippageFactor = 0.5
    const spreadEst    = entry * 0.0005;
    const slippageCost = spreadEst * 0.5 * qty * cv;
    const totalCost    = entryFee + exitFee + slippageCost;
    const breakEvenAbs = (totalCost / notional) * entry;

    const roiPriceDist = entry * (targetRoiPct / (100 * leverage));

    const requiredTpDist = Math.max(
        roiPriceDist + breakEvenAbs,
        breakEvenAbs * tpSafetyMultiplier,
        entry * 0.002
    );

    console.log(`\n=== CostEngine ===`);
    console.log(`entryFee  = $${entryFee.toFixed(6)}`);
    console.log(`exitFee   = $${exitFee.toFixed(6)}`);
    console.log(`slippage  = $${slippageCost.toFixed(6)}`);
    console.log(`totalCost = $${totalCost.toFixed(6)}`);
    console.log(`breakEvenAbs = $${breakEvenAbs.toFixed(6)}`);
    console.log(`\n=== TP Calculation ===`);
    console.log(`roiPriceDist   = ${entry} × (${targetRoiPct}% / (100 × ${leverage})) = $${roiPriceDist.toFixed(6)}`);
    console.log(`requiredTpDist = max(`);
    console.log(`  roiPriceDist + breakEvenAbs = $${(roiPriceDist + breakEvenAbs).toFixed(6)},`);
    console.log(`  breakEvenAbs × ${tpSafetyMultiplier}          = $${(breakEvenAbs * tpSafetyMultiplier).toFixed(6)},`);
    console.log(`  entry × 0.002               = $${(entry * 0.002).toFixed(6)}`);
    console.log(`) = $${requiredTpDist.toFixed(6)}`);
    console.log(`\nExpected TP = ${entry} - ${requiredTpDist.toFixed(6)} = $${(entry - requiredTpDist).toFixed(6)}`);
    console.log(`Actual TP in DB = $169.67  (dist=$0.06)`);
    console.log(`\nGross at expected TP = ${requiredTpDist.toFixed(4)} × ${qty} × ${cv} = $${(requiredTpDist * qty * cv).toFixed(6)}`);
    console.log(`Gross at actual TP   = 0.06 × ${qty} × ${cv} = $${(0.06 * qty * cv).toFixed(6)}`);
    console.log(`\n💥 CONCLUSION: Actual TP ($169.67) is $${(requiredTpDist - 0.06).toFixed(4)} CLOSER than it should be.`);
    console.log(`   → This trade was IMPOSSIBLE to win. Gross=$0.012, Fees=$${totalCost.toFixed(4)}.`);

    for (const tick of tickSizes) {
        const roundedTP = parseFloat((Math.round((entry - requiredTpDist) / tick) * tick).toFixed(8));
        console.log(`   Tick=${tick}: correct TP would round to $${roundedTP}`);
    }

    await mongoose.disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
