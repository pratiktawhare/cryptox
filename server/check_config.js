require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cryptox');
    const TradingConfig = require('./src/models/TradingConfig');
    const configs = await TradingConfig.find({}).lean();
    console.log('\n=== TRADING CONFIGS ===\n');
    for (const c of configs) {
        console.log(`Mode: ${c.mode}  |  User: ${c.userId}`);
        console.log(`  targetRoiPct:      ${c.targetRoiPct}`);
        console.log(`  tpSafetyMultiplier:${c.tpSafetyMultiplier}`);
        console.log(`  minRewardRisk:     ${c.minRewardRisk}`);
        console.log(`  slAtrMultiplier:   ${c.slAtrMultiplier}`);
        console.log(`  maxLeverage:       ${c.maxLeverage}`);
        console.log(`  riskPerTradePct:   ${c.riskPerTradePct}`);
        console.log(`  budgetUSDT:        ${c.budgetUSDT}`);
        console.log(`  minSignalScore:    ${c.minSignalScore}`);
        console.log(`  reverseMode:       ${c.reverseMode}`);
        console.log('');
    }
    await mongoose.disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
