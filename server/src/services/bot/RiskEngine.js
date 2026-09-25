/**
 * RiskEngine.js
 *
 * Computes position sizing, stop loss, and take profit for a trade setup.
 * Then validates the full setup through CostEngine for net viability.
 *
 * Position sizing formula (linear perpetuals):
 *   riskAmt   = effectiveBudget × riskPerTradePct / 100
 *   slDist    = ATR × slAtrMultiplier                    (price points)
 *   qty       = riskAmt / (contractValue × slDist)       (contracts)
 *   qty       = clamp(qty, minQty, maxQtyFromLeverage)
 *
 * SL/TP formula:
 *   sl = entry ∓ (ATR × slAtrMultiplier)
 *   tpFromRR   = entry ± (slDist × minRewardRisk)
 *   tpFromCost = entry ± (breakEvenAbs × tpSafetyMultiplier)
 *   tp = best of (tpFromRR, tpFromCost)       → whichever is more conservative
 *
 * All daily/consecutive-loss limits are checked here before sizing.
 */

const { calcTradeCosts } = require('./CostEngine');

/**
 * @param {object} params
 * @param {object} params.config                - TradingConfig document
 * @param {number} params.actualAvailableBalance - Real wallet available margin (USDT)
 * @param {string} params.symbol
 * @param {string} params.direction             - 'long' | 'short'
 * @param {number} params.entryPrice
 * @param {number} params.atr                   - ATR in price points
 * @param {number} [params.spread]              - bid-ask spread (optional)
 * @param {number} [params.fundingRate]         - current funding rate (optional)
 * @param {object} [params.productSpec]         - product spec from ProductCatalog
 * @param {object} [params.dailyStats]          - { dailyLoss, consecutiveLosses }
 *
 * @returns {{
 *   valid:           boolean,
 *   reason:          string|null,
 *   qty:             number|null,
 *   entryPrice:      number|null,
 *   stopLoss:        number|null,
 *   takeProfit:      number|null,
 *   leverage:        number|null,
 *   margin:          number|null,
 *   effectiveBudget: number|null,
 *   riskAmt:         number|null,
 *   cost:            object|null,   (full CostEngine output)
 * }}
 */
function calcRisk(params) {
    const {
        config,
        actualAvailableBalance,
        symbol,
        direction,
        entryPrice,
        atr,
        spread        = null,
        fundingRate   = null,
        productSpec   = null,
        dailyStats    = null,
    } = params;

    const isLong = direction === 'long';

    // ── Step 0: Pre-trade cooldown gate ──────────────────────────────────────
    if (dailyStats) {
        const { cooldownUntil } = dailyStats;

        // Cooldown
        if (cooldownUntil && Date.now() < cooldownUntil) {
            const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
            return fail(`Cooldown active — ${remainSec}s remaining`);
        }
    }

    // ── Step 1: Effective budget & Wallet Part Sizing ─────────────────────────
    const budgetUSDT = config.budgetUSDT > 0 ? config.budgetUSDT : 10;
    const walletParts = Math.max(1, config.walletParts || 1);
    const targetPartMargin = budgetUSDT / walletParts;

    if (actualAvailableBalance <= 0) {
        return fail('No available balance');
    }

    // Guard: remaining balance must cover at least 60% of target part margin to avoid dust trades
    if (actualAvailableBalance < targetPartMargin * 0.60) {
        return fail(`Insufficient available balance ($${actualAvailableBalance.toFixed(2)}) for target wallet part ($${targetPartMargin.toFixed(2)})`);
    }

    // ── Step 2: Risk amount per trade ─────────────────────────────────────────
    const riskPct = config.riskPerTradePct > 0 ? config.riskPerTradePct : 5;
    const effectiveBudget = Math.min(budgetUSDT, actualAvailableBalance);
    const riskAmt = effectiveBudget * (riskPct / 100);

    // ── Step 3: ATR guard ─────────────────────────────────────────────────────
    if (!atr || atr <= 0) {
        return fail('ATR not available — cannot calculate SL distance');
    }

    // ── Step 4: Position sizing ───────────────────────────────────────────────
    const contractValue = parseFloat(productSpec?.contract_value || 1);
    const minQty        = parseFloat(productSpec?.min_quantity || 1);
    const tickSize      = parseFloat(productSpec?.tick_size    || 0.001);
    const leverage      = Math.min(config.maxLeverage || 20, parseFloat(productSpec?.max_leverage || 100));

    // Maximum contracts affordable within real available balance at this leverage
    const maxQtyFromBalance = Math.floor((actualAvailableBalance * leverage) / (contractValue * entryPrice));

    // Check minimum contract margin requirement against wallet part
    const minContractMargin = (minQty * contractValue * entryPrice) / leverage;
    if (minContractMargin > targetPartMargin * 1.30) {
        return fail(`Coin minimum order ($${minContractMargin.toFixed(2)} margin) exceeds wallet part budget ($${targetPartMargin.toFixed(2)})`);
    }

    // Target Margin per trade = equal fraction of configured budget (budgetUSDT / walletParts)
    // Capped by actual available balance
    const targetMargin = Math.min(targetPartMargin, actualAvailableBalance);
    const targetNotional = targetMargin * leverage;
    const rawQtyFromParts = Math.round(targetNotional / (contractValue * entryPrice));

    let qty = Math.min(Math.max(minQty, rawQtyFromParts), maxQtyFromBalance);

    if (qty < minQty) {
        return fail(`Budget insufficient for minimum contract size (${minQty} contracts require $${((minQty * contractValue * entryPrice) / leverage).toFixed(2)} margin)`);
    }

    // ── Step 5: Margin check ──────────────────────────────────────────────────
    const margin = (qty * contractValue * entryPrice) / leverage;
    if (margin > actualAvailableBalance) {
        return fail(`Required margin ($${margin.toFixed(2)}) exceeds available balance ($${actualAvailableBalance.toFixed(2)})`);
    }

    // ── Step 6: Take Profit (Target) calculation ─────────────────────────────
    // Target Net Profit = Margin * (targetRoiPct / 100)
    // Required Price Move = (Target Net Profit + Total Costs) / (qty * contractValue)
    // = entryPrice * (targetRoiPct / (100 * leverage)) + breakEvenAbs
    const targetRoiPct = config.targetRoiPct > 0 ? config.targetRoiPct : 5;
    const minRR        = config.targetRoiPct > 0 ? 0.05 : (config.minRewardRisk > 0 ? config.minRewardRisk : 0.05);

    // Preliminary target price based on targeted ROI %
    const roiPriceDist = entryPrice * (targetRoiPct / (100 * leverage));
    const tpPreliminary = isLong
        ? entryPrice + roiPriceDist
        : entryPrice - roiPriceDist;

    // Estimate break-even points from exchange fees and spread
    const cost = calcTradeCosts({
        entryPrice,
        targetPrice:   tpPreliminary,
        stopPrice:     isLong ? (entryPrice * 0.95) : (entryPrice * 1.05),
        direction,
        qty,
        contractValue,
        spread,
        fundingRate,
        minRewardRisk: minRR,
    });

    // Required Target distance = required ROI price move + breakEvenAbs (Delta fees with GST + spread)
    const requiredTpDist = Math.max(
        roiPriceDist + cost.breakEvenAbs,
        cost.breakEvenAbs * (config.tpSafetyMultiplier || 1.5),
        entryPrice * 0.002 // at least 0.2% move to safely clear spread
    );

    const takeProfit = isLong
        ? parseFloat((entryPrice + requiredTpDist).toFixed(8))
        : parseFloat((entryPrice - requiredTpDist).toFixed(8));

    // Early Take Profit Trigger (triggers at 75% of target distance so limit order rests in order book early)
    // E.g. +0.33% target limit triggers early at +0.25%
    const tpTriggerDist = requiredTpDist * 0.75;
    const takeProfitTrigger = isLong
        ? parseFloat((entryPrice + tpTriggerDist).toFixed(8))
        : parseFloat((entryPrice - tpTriggerDist).toFixed(8));

    // ── Step 7: Stop Loss calculation (Target × Multiplier) ───────────────────
    // Multiplies target distance by configured multiplier (e.g. 0.33% target × 4x = 1.32% stop loss)
    const slMultiplier = config.slAtrMultiplier > 0 ? config.slAtrMultiplier : 4.0;
    let slDistance = requiredTpDist * slMultiplier;

    // Safeguard 1: Ensure SL distance does NOT exceed 85% of liquidation distance
    // For 20x leverage, liquidation occurs around ~4.5% to 5.0% adverse move.
    // Clamping to 85% of (1/leverage) ensures SL always triggers cleanly before liquidation.
    const maxSafeSlDistance = entryPrice * ((1 / leverage) * 0.85);
    if (slDistance > maxSafeSlDistance) {
        slDistance = maxSafeSlDistance;
    }

    // Safeguard 2: Minimum safe distance to prevent instant SL on spread/noise (at least 0.2% or 0.5x target)
    const minSafeSlDistance = Math.max(requiredTpDist * 0.5, entryPrice * 0.002);
    if (slDistance < minSafeSlDistance) {
        slDistance = minSafeSlDistance;
    }

    const stopLoss = isLong
        ? parseFloat((entryPrice - slDistance).toFixed(8))
        : parseFloat((entryPrice + slDistance).toFixed(8));

    if (stopLoss <= 0) {
        return fail('Calculated SL price is invalid (≤ 0)');
    }

    // Early Stop Loss Trigger (triggers at 82% of stop loss distance to guarantee aggressive marketable exit)
    // E.g. -1.50% stop loss limit triggers early at -1.23%
    const slTriggerDist = slDistance * 0.82;
    const stopLossTrigger = isLong
        ? parseFloat((entryPrice - slTriggerDist).toFixed(8))
        : parseFloat((entryPrice + slTriggerDist).toFixed(8));

    // ── Step 8: Validate full trade viability with CostEngine ────────────────
    const finalCost = calcTradeCosts({
        entryPrice,
        targetPrice:   takeProfit,
        stopPrice:     stopLoss,
        direction,
        qty,
        contractValue,
        spread,
        fundingRate,
        minRewardRisk: minRR,
    });

    if (!finalCost.viable) {
        return fail(`Cost engine rejected: ${finalCost.rejectReason}`);
    }

    // ── Step 11: Tick size rounding ───────────────────────────────────────────
    const roundToTick = (price, tick) => {
        if (!tick || tick <= 0) return price;
        return parseFloat((Math.round(price / tick) * tick).toFixed(8));
    };

    return {
        valid:             true,
        reason:            null,
        symbol,
        direction,
        qty,
        entryPrice:        roundToTick(entryPrice,        tickSize),
        stopLoss:          roundToTick(stopLoss,          tickSize),
        stopLossTrigger:   roundToTick(stopLossTrigger,   tickSize),
        takeProfit:        roundToTick(takeProfit,        tickSize),
        takeProfitTrigger: roundToTick(takeProfitTrigger, tickSize),
        leverage,
        contractValue,
        margin:            parseFloat(margin.toFixed(6)),
        effectiveBudget:   parseFloat(effectiveBudget.toFixed(4)),
        riskAmt:           parseFloat(riskAmt.toFixed(6)),
        slDistance:        parseFloat(slDistance.toFixed(8)),
        cost:              finalCost,
    };
}

// ── Helper: failed result ─────────────────────────────────────────────────────
function fail(reason) {
    return {
        valid: false, reason,
        qty: null, entryPrice: null, stopLoss: null, stopLossTrigger: null, takeProfit: null, takeProfitTrigger: null,
        leverage: null, margin: null, effectiveBudget: null, riskAmt: null, cost: null,
    };
}

/**
 * Validate daily stats against config limits (standalone check, no sizing).
 * Used by TradingBot at the start of each scan cycle.
 *
 * @param {object} config
 * @param {number} actualAvailableBalance
 * @param {object} dailyStats  - { dailyLoss, consecutiveLosses, cooldownUntil }
 * @returns {{ ok: boolean, reason: string|null }}
 */
function checkDailyLimits(config, actualAvailableBalance, dailyStats) {
    if (dailyStats.cooldownUntil && Date.now() < dailyStats.cooldownUntil) {
        const remainSec = Math.ceil((dailyStats.cooldownUntil - Date.now()) / 1000);
        return { ok: false, reason: `Cooldown: ${remainSec}s remaining` };
    }
    return { ok: true, reason: null };
}

module.exports = { calcRisk, checkDailyLimits };
