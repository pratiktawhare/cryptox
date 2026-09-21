/**
 * AffordabilityFilter.js
 *
 * Filters the list of scannable symbols down to those the bot can actually
 * afford to trade given the current wallet balance and config.
 *
 * Logic:
 *   effectiveBudget = min(config.budgetUSDT, actualAvailableBalance)
 *   riskAmount      = effectiveBudget × riskPerTradePct / 100
 *   minMarginNeeded = minContractQty × currentPrice / maxLeverage
 *
 *   If minMarginNeeded <= riskAmount → symbol is affordable
 *   Else                             → skipped silently
 *
 * This ensures the bot never attempts to trade coins where even the
 * minimum order size exceeds the available risk budget.
 *
 * At $10 budget with 5% risk → riskAmount = $0.50
 * Any coin where 1 contract margin < $0.50 will be included.
 */

/**
 * @param {string[]} symbols              - All symbols from CandleStore
 * @param {object}   config               - TradingConfig document
 * @param {number}   actualAvailableBalance - Real wallet available balance (USDT)
 * @param {object}   wsManager            - DeltaWebSocketManager (for live prices)
 * @param {object}   productCatalog       - ProductCatalog (for min qty / contract specs)
 * @returns {{
 *   affordable:      string[],
 *   skipped:         { symbol: string, reason: string, minCost: number, budget: number }[],
 *   effectiveBudget: number,
 *   riskAmount:      number,
 * }}
 */
function filterAffordable(symbols, config, actualAvailableBalance, wsManager, productCatalog) {
    // ── Step 1: Effective budget — user's configured budget, capped at real balance ──
    const budgetUSDT = config.budgetUSDT > 0 ? config.budgetUSDT : 10;
    const effectiveBudget = Math.min(budgetUSDT, actualAvailableBalance);

    // ── Step 2: Risk amount for this cycle ────────────────────────────────────
    const riskPct    = config.riskPerTradePct > 0 ? config.riskPerTradePct : 5;
    const riskAmount = effectiveBudget * (riskPct / 100);

    const affordable = [];
    const skipped    = [];

    for (const symbol of symbols) {
        // ── Current price from live ticker ────────────────────────────────────
        const price = wsManager?.getPrice(symbol);
        if (!price || price <= 0) {
            skipped.push({ symbol, reason: 'no_price', minCost: 0, budget: riskAmount });
            continue;
        }

        // ── Product spec: min order quantity and contract value ──────────────
        const spec = getProductSpec(symbol, productCatalog);
        if (!spec || spec.minQty <= 0) {
            skipped.push({ symbol, reason: 'no_product_spec', minCost: 0, budget: riskAmount });
            continue;
        }

        // ── Minimum margin required to open the smallest possible position ────
        // margin = notional / leverage = (qty × contractValue × price) / leverage
        const leverage   = config.maxLeverage > 0 ? config.maxLeverage : 20;
        const minCost    = (spec.minQty * spec.contractValue * price) / leverage;
        const maxAllowedMargin = Math.max(riskAmount, effectiveBudget * 0.1);

        if (minCost <= maxAllowedMargin && minCost <= effectiveBudget) {
            affordable.push(symbol);
        } else {
            skipped.push({
                symbol,
                reason:  'insufficient_budget',
                minCost: parseFloat(minCost.toFixed(6)),
                budget:  parseFloat(maxAllowedMargin.toFixed(6)),
            });
        }
    }

    return {
        affordable,
        skipped,
        effectiveBudget: parseFloat(effectiveBudget.toFixed(4)),
        riskAmount:      parseFloat(riskAmount.toFixed(6)),
    };
}

/**
 * Get the product specifications (minQty, contractValue) from ProductCatalog.
 *
 * @param {string} symbol
 * @param {object} productCatalog
 * @returns {{ minQty: number, contractValue: number }}
 */
function getProductSpec(symbol, productCatalog) {
    if (!productCatalog) return { minQty: 1, contractValue: 1 };

    try {
        const product = productCatalog.getBySymbol?.(symbol) ||
            productCatalog.getAll?.()?.find(p => p.symbol === symbol || p.ticker_name === symbol);

        if (!product) return { minQty: 1, contractValue: 1 };

        const contractValue = parseFloat(product.contract_value || 1);
        const minQty        = parseFloat(product.min_quantity    || 1);

        return {
            minQty: Math.max(minQty, 1),
            contractValue: contractValue > 0 ? contractValue : 1,
        };
    } catch {
        return { minQty: 1, contractValue: 1 };
    }
}

/**
 * Get the minimum order quantity for a symbol from ProductCatalog.
 *
 * @param {string} symbol
 * @param {object} productCatalog
 * @returns {number}
 */
function getMinQty(symbol, productCatalog) {
    return getProductSpec(symbol, productCatalog).minQty;
}

/**
 * Build a human-readable log message for the affordability result.
 *
 * @param {object} result - from filterAffordable()
 * @returns {string}
 */
function buildAffordabilityLog(result) {
    const { affordable, skipped, effectiveBudget, riskAmount } = result;
    const total = affordable.length + skipped.length;
    const noPrice = skipped.filter(s => s.reason === 'no_price').length;
    const tooExpensive = skipped.filter(s => s.reason === 'insufficient_budget').length;

    return [
        `Budget: $${effectiveBudget} → risk/trade: $${riskAmount}`,
        `Scanned: ${total} symbols`,
        `Affordable: ${affordable.length}`,
        tooExpensive > 0 ? `Too expensive: ${tooExpensive}` : null,
        noPrice > 0      ? `No price: ${noPrice}` : null,
    ].filter(Boolean).join(' | ');
}

module.exports = { filterAffordable, getProductSpec, getMinQty, buildAffordabilityLog };
