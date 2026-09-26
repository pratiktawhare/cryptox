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
    // ── Step 1: Wallet Part Sizing ────────────────────────────────────────────
    const budgetUSDT = config.budgetUSDT > 0 ? config.budgetUSDT : 10;
    const walletParts = Math.max(1, config.walletParts || 1);
    const targetPartMargin = budgetUSDT / walletParts;

    // Minimum balance required to open any new position for a wallet part
    // Must have at least 60% of target part margin available
    if (actualAvailableBalance < targetPartMargin * 0.60) {
        return {
            affordable: [],
            skipped: symbols.map(symbol => ({
                symbol,
                reason: 'insufficient_part_balance',
                minCost: 0,
                budget: parseFloat(targetPartMargin.toFixed(4)),
            })),
            effectiveBudget: parseFloat(actualAvailableBalance.toFixed(4)),
            riskAmount: parseFloat(targetPartMargin.toFixed(6)),
        };
    }

    // Maximum margin allowed for 1 coin's minimum order (wallet part + 25% rounding buffer)
    const maxAllowedMargin = targetPartMargin * 1.25;

    const affordable = [];
    const skipped    = [];

    for (const symbol of symbols) {
        // ── Current price from live ticker or candle store fallback ──────────
        let price = null;
        if (wsManager?.getPrice) {
            const p = wsManager.getPrice(symbol);
            if (p && p > 0) price = p;
        }
        if (!price && wsManager?.getTicker) {
            const ticker = wsManager.getTicker(symbol);
            if (ticker?.price) price = parseFloat(ticker.price);
            else if (ticker?.close) price = parseFloat(ticker.close);
            else if (ticker?.mark_price) price = parseFloat(ticker.mark_price);
        }
        if (!price) {
            try {
                const candleStore = require('./CandleStore');
                const lastCandle = candleStore.getLastCandle(symbol, '1m') || candleStore.getLastCandle(symbol, '5m');
                if (lastCandle?.close) price = lastCandle.close;
            } catch (e) { /* ignore */ }
        }

        if (!price || price <= 0) {
            skipped.push({ symbol, reason: 'no_price', minCost: 0, budget: maxAllowedMargin });
            continue;
        }

        // ── 24h Volume / Liquidity check (filters illiquid contracts prone to slippage) ──
        const minVol = config.breakoutMin24hVolumeUSDT || 0;
        if (minVol > 0 && wsManager?.getTicker) {
            const ticker = wsManager.getTicker(symbol);
            const vol24h = parseFloat(ticker?.volume24h || ticker?.volume || 0);
            const turnover24h = parseFloat(ticker?.turnover24h || (vol24h * price) || 0);
            if (turnover24h > 0 && turnover24h < minVol) {
                skipped.push({ symbol, reason: 'low_liquidity', minCost: 0, budget: turnover24h });
                continue;
            }
        }

        // ── Product spec: min order quantity and contract value ──────────────
        const spec = getProductSpec(symbol, productCatalog);
        if (!spec || spec.minQty <= 0) {
            skipped.push({ symbol, reason: 'no_product_spec', minCost: 0, budget: maxAllowedMargin });
            continue;
        }

        // ── Minimum margin required to open the smallest possible position ────
        // margin = notional / leverage = (qty × contractValue × price) / leverage
        const leverage = config.maxLeverage > 0 ? config.maxLeverage : 20;
        const minCost  = (spec.minQty * spec.contractValue * price) / leverage;

        if (minCost <= maxAllowedMargin && minCost <= actualAvailableBalance) {
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
        effectiveBudget: parseFloat(actualAvailableBalance.toFixed(4)),
        riskAmount:      parseFloat(targetPartMargin.toFixed(6)),
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
