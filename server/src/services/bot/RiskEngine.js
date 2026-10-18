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
 *   tpFromRR   = entry ± (slDist × minRewardRisk plus execution costs)
 *   tpFromCost = entry ± (breakEvenAbs × tpSafetyMultiplier)
 *   tp = best of (tpFromRR, tpFromCost)       → whichever is more conservative
 *
 * All daily/consecutive-loss limits are checked here before sizing.
 */

const { calcTradeCosts } = require('./CostEngine');

function positive(value) {
    return Number.isFinite(value) && value > 0;
}

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
 * @param {object} [params.strategyGeometry]     - optional strategy-proposed
 *                                                { entry, stopLoss, target }
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
        strategyGeometry = null,
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

        const limits = checkDailyLimits(config, actualAvailableBalance, dailyStats);
        if (!limits.ok) return fail(limits.reason);
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
    const riskPct = config.riskPerTradePct > 0 ? config.riskPerTradePct : 1;
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
    let margin = (qty * contractValue * entryPrice) / leverage;
    if (margin > actualAvailableBalance) {
        return fail(`Required margin ($${margin.toFixed(2)}) exceeds available balance ($${actualAvailableBalance.toFixed(2)})`);
    }

    // ── Step 6: Take Profit (Target) calculation ─────────────────────────────
    // Target Net Profit = Margin * (targetRoiPct / 100)
    // Required Price Move = (Target Net Profit + Total Costs) / (qty * contractValue)
    // = entryPrice * (targetRoiPct / (100 * leverage)) + breakEvenAbs
    const targetRoiPct = config.targetRoiPct > 0 ? config.targetRoiPct : 5;
    // The configured minimum R:R must be honored even when a target ROI is
    // configured. The previous hard-coded 0.05 allowed trades whose expected
    // reward was only a few cents for every dollar risked.
    const minRR        = Math.max(1.0, config.minRewardRisk > 0 ? config.minRewardRisk : 1.0);

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

    // Use ATR for the stop distance. The previous implementation used
    // `target distance × multiplier`, while ignoring ATR entirely and often
    // produced a structurally negative reward/risk profile.
    const slMultiplier = config.slAtrMultiplier > 0 ? config.slAtrMultiplier : 1.5;
    const maxSafeSlDistance = entryPrice * ((1 / leverage) * 0.85);
    const minSafeSlDistance = Math.max(atr * 0.5, entryPrice * 0.002);
    const proposedStopDistance = strategyGeometry?.stopLoss
        ? Math.abs(entryPrice - Number(strategyGeometry.stopLoss))
        : null;
    const proposedTargetDistance = strategyGeometry?.target
        ? Math.abs(Number(strategyGeometry.target) - entryPrice)
        : null;
    let slDistance = Math.min(
        positive(proposedStopDistance) ? proposedStopDistance : atr * slMultiplier,
        maxSafeSlDistance
    );
    slDistance = Math.max(slDistance, Math.min(minSafeSlDistance, maxSafeSlDistance));

    // Required target distance clears costs, the configured ROI objective, and
    // the configured minimum net R:R against the ATR-derived stop.
    const requiredTpDist = Math.max(
        roiPriceDist + cost.breakEvenAbs,
        positive(proposedTargetDistance) ? proposedTargetDistance : 0,
        slDistance * minRR + cost.breakEvenAbs * (minRR + 1),
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

    // ── Step 7: Stop Loss calculation ─────────────────────────────────────────
    const stopLoss = isLong
        ? parseFloat((entryPrice - slDistance).toFixed(8))
        : parseFloat((entryPrice + slDistance).toFixed(8));

    if (stopLoss <= 0) {
        return fail('Calculated SL price is invalid (≤ 0)');
    }

    // Enforce the configured dollar risk from the actual stop distance. The
    // old implementation sized from wallet parts only, so a wide stop could
    // risk far more than riskPerTradePct advertised.
    const maxQtyByRisk = Math.floor(riskAmt / (contractValue * slDistance));
    if (maxQtyByRisk < minQty) {
        return fail(`Configured risk budget ($${riskAmt.toFixed(4)}) cannot cover the minimum position at the calculated stop distance`);
    }
    qty = Math.min(qty, maxQtyByRisk);
    if (qty < minQty) {
        return fail(`Risk-based position size is below minimum quantity (${minQty})`);
    }
    margin = (qty * contractValue * entryPrice) / leverage;

    // Stop Loss Trigger: Keep trigger very close to the stop loss limit price (97% of SL distance)
    // so the trade is given room to breathe until ~1%, while keeping a tight buffer so Delta executes reliably.
    // E.g. -1.00% stop loss limit triggers at -0.97%, instead of triggering prematurely at -0.75% or -0.82%.
    const slTriggerDist = slDistance * 0.97;
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

    const finalStopLoss = roundToTick(stopLoss, tickSize);
    let finalStopLossTrigger = roundToTick(stopLossTrigger, tickSize);

    // Ensure stopLossTrigger is very close to stopLoss but strictly separated by at least 1 tick
    // so Delta Exchange has a distinct trigger that activates right before the limit floor.
    if (tickSize && tickSize > 0) {
        if (isLong && finalStopLossTrigger <= finalStopLoss) {
            finalStopLossTrigger = parseFloat((finalStopLoss + tickSize).toFixed(8));
        } else if (!isLong && finalStopLossTrigger >= finalStopLoss) {
            finalStopLossTrigger = parseFloat((finalStopLoss - tickSize).toFixed(8));
        }
    }

    return {
        valid:             true,
        reason:            null,
        symbol,
        direction,
        qty,
        entryPrice:        roundToTick(entryPrice,        tickSize),
        stopLoss:          finalStopLoss,
        stopLossTrigger:   finalStopLossTrigger,
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
    const stats = dailyStats || {};
    if (stats.cooldownUntil && Date.now() < stats.cooldownUntil) {
        const remainSec = Math.ceil((stats.cooldownUntil - Date.now()) / 1000);
        return { ok: false, reason: `Cooldown: ${remainSec}s remaining` };
    }

    const effectiveBudget = Math.min(
        config?.budgetUSDT > 0 ? config.budgetUSDT : actualAvailableBalance,
        Math.max(0, actualAvailableBalance || 0)
    );
    const maxDailyLossPct = config?.maxDailyLossPct > 0 ? config.maxDailyLossPct : 0;
    const maxDailyLoss = effectiveBudget * (maxDailyLossPct / 100);
    if (maxDailyLossPct > 0 && (stats.dailyLoss || 0) >= maxDailyLoss) {
        return {
            ok: false,
            reason: `Daily loss limit reached ($${Number(stats.dailyLoss || 0).toFixed(4)} / $${maxDailyLoss.toFixed(4)})`,
        };
    }

    const maxConsecutiveLosses = config?.maxConsecutiveLosses > 0 ? config.maxConsecutiveLosses : 0;
    if (maxConsecutiveLosses > 0 && (stats.consecutiveLosses || 0) >= maxConsecutiveLosses) {
        return {
            ok: false,
            reason: `Consecutive-loss limit reached (${stats.consecutiveLosses} / ${maxConsecutiveLosses})`,
        };
    }

    return { ok: true, reason: null };
}

module.exports = { calcRisk, checkDailyLimits };
