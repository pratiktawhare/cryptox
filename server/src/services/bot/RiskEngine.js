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

    // ── Step 1: Effective budget ──────────────────────────────────────────────
    const budgetUSDT = config.budgetUSDT > 0 ? config.budgetUSDT : 10;
    const effectiveBudget = Math.min(budgetUSDT, actualAvailableBalance);

    if (effectiveBudget <= 0) {
        return fail('Effective budget is zero — no available balance');
    }

    // ── Step 2: Risk amount per trade ─────────────────────────────────────────
    const riskPct = config.riskPerTradePct > 0 ? config.riskPerTradePct : 5;
    const riskAmt = effectiveBudget * (riskPct / 100);

    // ── Step 3: ATR guard ─────────────────────────────────────────────────────
    if (!atr || atr <= 0) {
        return fail('ATR not available — cannot calculate SL distance');
    }

    // ── Step 4: Stop Loss ─────────────────────────────────────────────────────
    // Wide Stop Loss: default 5.0x ATR with a minimum 3.5% price distance floor.
    // Clamped before liquidation price so liquidation never happens before SL.
    const leverage     = Math.min(config.maxLeverage || 20, parseFloat(productSpec?.max_leverage || 100));
    const slMultiplier = config.slAtrMultiplier > 0 ? config.slAtrMultiplier : 5.0;
    const atrDistance  = atr * slMultiplier;
    const minPercentFloor = entryPrice * 0.035; // at least 3.5% adverse price move
    let slDistance   = Math.max(atrDistance, minPercentFloor);

    // Safeguard: Ensure SL distance does NOT exceed 85% of liquidation distance
    // For 20x leverage, liquidation occurs around ~4.5% to 5.0% adverse move.
    // Clamping to 85% of (1/leverage) ensures SL always triggers cleanly before liquidation.
    const maxSafeSlDistance = entryPrice * ((1 / leverage) * 0.85);
    if (slDistance > maxSafeSlDistance) {
        slDistance = maxSafeSlDistance;
    }

    const stopLoss     = isLong
        ? parseFloat((entryPrice - slDistance).toFixed(8))
        : parseFloat((entryPrice + slDistance).toFixed(8));

    if (stopLoss <= 0) {
        return fail('Calculated SL price is invalid (≤ 0)');
    }

    // ── Step 5: Position sizing ───────────────────────────────────────────────
    // contractValue: how many USDT each contract represents at par
    const contractValue = parseFloat(productSpec?.contract_value || 1);
    const minQty        = parseFloat(productSpec?.min_quantity || 1);
    const tickSize      = parseFloat(productSpec?.tick_size    || 0.001);

    // Maximum contracts affordable within real available balance at this leverage
    const maxQtyFromBalance = Math.floor((actualAvailableBalance * leverage) / (contractValue * entryPrice));

    let qty;
    const walletParts = config.walletParts > 0 ? config.walletParts : 2;

    if (walletParts) {
        // Divide wallet balance into N parts:
        // Target Margin per trade = effectiveBudget / walletParts
        // Target Notional per trade = targetMargin * leverage
        // E.g. $10 budget / 2 parts = ~$5 margin * 20x leverage = ~$100 overall trade
        const targetMargin   = effectiveBudget / walletParts;
        const targetNotional = targetMargin * leverage;
        const rawQtyFromParts = Math.round(targetNotional / (contractValue * entryPrice));

        qty = Math.min(Math.max(minQty, rawQtyFromParts), maxQtyFromBalance);
    } else {
        // Fallback: ATR-risk sizing
        const rawQty = riskAmt / (contractValue * slDistance);
        const maxQtyFromBudget = Math.floor((effectiveBudget * leverage) / (contractValue * entryPrice));
        qty = Math.min(Math.floor(rawQty), maxQtyFromBudget, maxQtyFromBalance);
        if (qty < minQty && maxQtyFromBudget >= minQty) {
            qty = minQty;
        }
    }

    if (qty < minQty) {
        return fail(`Budget insufficient for minimum contract size (${minQty} contracts require $${((minQty * contractValue * entryPrice) / leverage).toFixed(2)} margin)`);
    }

    // ── Step 6: Margin check ──────────────────────────────────────────────────
    const margin = (qty * contractValue * entryPrice) / leverage;
    if (margin > actualAvailableBalance) {
        return fail(`Required margin ($${margin.toFixed(2)}) exceeds available balance ($${actualAvailableBalance.toFixed(2)})`);
    }

    // ── Step 7: Take Profit — targeted ROI or ATR momentum ───────────────────
    // If targetRoiPct is configured (e.g. 5% ROI on margin):
    // Position Notional = Margin * leverage
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

    // ── Step 8: Cost engine — estimate break-even points ─────────────────────
    const cost = calcTradeCosts({
        entryPrice,
        targetPrice:   tpPreliminary,
        stopPrice:     stopLoss,
        direction,
        qty,
        contractValue,
        spread,
        fundingRate,
        minRewardRisk: minRR,
    });

    // ── Step 9: Adjust TP to guarantee break-even + requested net ROI ────────
    // Target distance = required ROI price move + breakEvenAbs (Delta fees with GST + spread)
    const requiredTpDist = Math.max(
        roiPriceDist + cost.breakEvenAbs,
        cost.breakEvenAbs * (config.tpSafetyMultiplier || 1.5),
        entryPrice * 0.002 // at least 0.2% move to safely clear spread
    );

    const takeProfit = isLong
        ? parseFloat((entryPrice + requiredTpDist).toFixed(8))
        : parseFloat((entryPrice - requiredTpDist).toFixed(8));

    // ── Step 10: Re-run cost engine with final TP ─────────────────────────────
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
        valid:           true,
        reason:          null,
        symbol,
        direction,
        qty,
        entryPrice:      roundToTick(entryPrice, tickSize),
        stopLoss:        roundToTick(stopLoss,   tickSize),
        takeProfit:      roundToTick(takeProfit,  tickSize),
        leverage,
        contractValue,
        margin:          parseFloat(margin.toFixed(6)),
        effectiveBudget: parseFloat(effectiveBudget.toFixed(4)),
        riskAmt:         parseFloat(riskAmt.toFixed(6)),
        slDistance:      parseFloat(slDistance.toFixed(8)),
        cost:            finalCost,
    };
}

// ── Helper: failed result ─────────────────────────────────────────────────────
function fail(reason) {
    return {
        valid: false, reason,
        qty: null, entryPrice: null, stopLoss: null, takeProfit: null,
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
